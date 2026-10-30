#!/usr/bin/env node
// The scorecard runner. One command runs every build on every model and writes one record per
// build per model to results/, then names the changes since the last sweep and rebuilds the page.
//
//   node run.js                               every build found under the root, every model in settings.json
//   node run.js --builds data-answers,sourced-brief --models haiku-5-5
//   node run.js --mock                        every build's scripted stand-in; records go to results-test/, never the page
//   node run.js --page-only                   rebuild SCORECARD.md and scorecard.html from results/
//
// What a job (one build, one model) does:
//   1. Reads the build's harness.json. A missing field or path refuses the job before any process starts.
//   2. Copies the build into runs/<sweep>/<build>-<model>/ (node_modules linked; .env, .git, results
//      and old run folders left behind) and scans its data folder for the answer key. A hit refuses
//      the job before any model call.
//   3. Runs the build's own harness in the copy: node eval/run_eval.js --model ... --label <sweep>-<model>.
//   4. Reads the copy's result.json, scans the run folder and the transcript for the answer key
//      again, recomputes the cost from the tokens and the build's prices file, and writes the
//      scorecard record. A refused run stays on the record, uncounted.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findAdapters } from "./lib/adapters.js";
import { stageCopy, applyOverlays } from "./lib/stage.js";
import { keyNames, scanForKey, transcriptReads } from "./lib/gates.js";
import { pricesInfo, deriveRecord, modelTag } from "./lib/record.js";
import { compareSweep, loadRecords, describeChanges } from "./compare.js";
import { writePages } from "./page.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));

export function localIso(d = new Date()) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString(); }
export function sweepId(d = new Date()) { return `S${localIso(d).slice(0, 16).replace(/[-:T]/g, "")}`; }
export function loadSettings(dir = HERE) { return JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")); }

export function apiKey(dir = HERE) {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const envFile = path.join(dir, ".env");
  if (fs.existsSync(envFile)) { const m = /^ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?/m.exec(fs.readFileSync(envFile, "utf8")); if (m) return m[1].trim(); }
  return null;
}

function runHarness({ copy, adapter, model, label, mock, key, log, maxMinutes }) {
  return new Promise((resolve) => {
    const args = [path.join(copy, adapter.harness), "--label", label];
    if (mock) args.push("--mock"); else { args.push("--model", model.id); if (model.effort) args.push("--effort", model.effort); }
    const env = { ...process.env };
    if (key) env.ANTHROPIC_API_KEY = key;
    const out = fs.openSync(log, "w");
    const child = spawn(process.execPath, args, { cwd: copy, env, stdio: ["ignore", out, out] });
    const started = Date.now();
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, maxMinutes * 60000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer); fs.closeSync(out);
      resolve({ code, signal, minutes: Math.round((Date.now() - started) / 6000) / 10, timed_out: signal === "SIGKILL" });
    });
    child.on("error", (e) => { clearTimeout(timer); fs.closeSync(out); resolve({ code: null, error: String(e.message || e), minutes: 0 }); });
  });
}

// One build on one model. Returns the scorecard record (always written, even when refused).
export async function runJob({ settings, sweep, entry, model, mock = false, overlays = [], runsDir, resultsDir, key = null, say = () => {} }) {
  const started_at = localIso();
  const tag = modelTag(model);
  const mode = mock ? "mock" : "harness";
  const adapter = entry.adapter || { build: entry.name, title: entry.name, gates: { held: "", of: 0 }, bar: null };
  const jobDir = path.join(runsDir, sweep, `${entry.name}-${tag}`);
  const recordPath = path.join(resultsDir, `${sweep}-${entry.name}-${tag}.json`);
  fs.mkdirSync(resultsDir, { recursive: true });
  const finish = (record) => { fs.writeFileSync(recordPath, JSON.stringify(record, null, 2)); return record; };
  const refuse = (gate, detail) => {
    say(`  ${entry.name} on ${tag}: REFUSED (${gate}: ${detail})`);
    return finish(deriveRecord({ sweep, adapter, model, mode, started_at, harness: null, harness_path: null, prices: null, refused: { gate, detail } }));
  };

  // Gate: the adapter, before any process.
  if (entry.error) return refuse("adapter", entry.error);

  // The staging copy, then the planted changes (tests only), then the blind gate before the model.
  fs.mkdirSync(jobDir, { recursive: true });
  const skipped = [];
  const copy = stageCopy(entry.dir, path.join(jobDir, "copy"), skipped);
  applyOverlays(copy, overlays);
  const warnings = skipped.length ? [`${skipped.length} file${skipped.length === 1 ? "" : "s"} could not be copied into the staging copy: ${skipped.slice(0, 3).join(", ")}`] : [];
  const expectedDir = path.join(copy, adapter.expected);
  const names = keyNames(expectedDir);
  const before = scanForKey(path.join(copy, adapter.data), expectedDir, names);
  if (before.length) return refuse("answer key reachable before the run", `${adapter.data}/${before[0]}; no model call was made`);

  // The build's own harness, in the copy.
  const label = `${sweep}-${tag}`;
  const log = path.join(jobDir, "harness.log");
  say(`  ${entry.name} on ${tag}: running ${adapter.harness}${mock ? " --mock" : ""} (log: ${path.relative(HERE, log)})`);
  const run = await runHarness({ copy, adapter, model, label, mock, key, log, maxMinutes: Number(adapter.max_minutes) });
  if (run.timed_out) warnings.push(`harness stopped after ${adapter.max_minutes} minutes`);
  if (run.error) warnings.push(`harness could not start: ${run.error}`);

  // The record the build wrote, and the blind gate after the model.
  const runFolder = path.join(copy, mock ? adapter.runs_mock : adapter.runs, label);
  const harnessPath = path.join(runFolder, adapter.record);
  let harness = null;
  if (fs.existsSync(harnessPath)) { try { harness = JSON.parse(fs.readFileSync(harnessPath, "utf8")); } catch (e) { warnings.push(`harness record unreadable: ${e.message}`); } }
  else warnings.push(`harness exited with code ${run.code} and wrote no ${adapter.record}; see harness.log`);
  const after = [...scanForKey(runFolder, expectedDir, names).filter((h) => !h.startsWith(adapter.record)), ...transcriptReads(path.join(runFolder, "transcript.json"), names)];
  const prices = pricesInfo(path.join(copy, adapter.prices), settings.prices_max_age_days);
  const record = deriveRecord({
    sweep, adapter, model, mode, started_at, harness, harness_path: path.relative(HERE, harnessPath), prices, warnings, timing: run,
    refused: after.length ? { gate: "answer key reachable in the run folder", detail: after[0] } : null,
  });
  say(`  ${entry.name} on ${tag}: ${record.refused ? "REFUSED (" + record.refused.gate + ": " + record.refused.detail + ")" : `${record.matched} of ${record.of_cases} cases, gates ${record.gates_held} of ${record.of_gates}, ${record.passed ? "bar met" : "bar not met"}${record.cost_usd != null ? ", US$" + record.cost_usd.toFixed(3) : ""}, ${run.minutes} min`}${record.warnings.length ? "\n    " + record.warnings.join("\n    ") : ""}`);
  return finish(record);
}

async function pool(jobs, n) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (next < jobs.length) { const i = next++; results[i] = await jobs[i](); } }));
  return results;
}

// The sweep: every build found under the root, every model chosen, in parallel up to the setting.
export async function sweep({ settings, root, builds = null, models = null, mock = false, overlays = {}, sweep: id = sweepId(), runsDir, resultsDir, parallel, key, say = console.log, page = true, scorecardDir = HERE }) {
  runsDir = runsDir || path.join(scorecardDir, "runs");
  resultsDir = resultsDir || path.join(scorecardDir, mock ? "results-test" : "results");
  const chosen = (models || settings.models).map((m) => typeof m === "string" ? settings.models.find((s) => s.id === m || modelTag(s) === m) || { id: m, effort: null, rank: 99 } : m);
  const entries = findAdapters(root).filter((e) => !builds || builds.includes(e.name));
  say(`sweep ${id}${mock ? " (mock)" : ""}: ${entries.length} build${entries.length === 1 ? "" : "s"} under ${root}, models ${chosen.map(modelTag).join(", ")}`);
  for (const e of entries) if (e.error) say(`  ${e.name}: ${e.error}`);
  const jobs = [];
  for (const entry of entries) for (const model of chosen) jobs.push(() => runJob({ settings, sweep: id, entry, model, mock, overlays: overlays[entry.name] || [], runsDir, resultsDir, key, say }));
  const records = await pool(jobs, parallel ?? settings.parallel ?? 2);
  fs.mkdirSync(path.join(runsDir, id), { recursive: true });
  fs.writeFileSync(path.join(runsDir, id, "sweep.json"), JSON.stringify({ sweep: id, mock, root, models: chosen, records: records.map((r) => `${r.sweep}-${r.build}-${r.model_tag}.json`) }, null, 2));
  const all = loadRecords(resultsDir);
  const changes = compareSweep(all, id, settings);
  say("\n" + describeChanges(changes));
  if (page && !mock) say("page written: " + writePages(resultsDir, settings, scorecardDir).join(", "));
  return { sweep: id, records, changes };
}

// ---------- command line ----------
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
  const flag = (name) => argv.includes(`--${name}`);
  const settings = loadSettings();
  const root = path.resolve(HERE, arg("root", settings.root || ".."));
  if (flag("page-only")) { console.log("page written: " + writePages(path.join(HERE, "results"), settings, HERE).join(", ")); process.exit(0); }
  const mock = flag("mock");
  const key = mock ? null : apiKey();
  if (!mock && !key) { console.error("No API key. Put ANTHROPIC_API_KEY=... in .env in this folder (see .env.example), or set it in the environment, or run with --mock."); process.exit(2); }
  const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);
  const r = await sweep({ settings, root, builds: list(arg("builds")), models: list(arg("models")), mock, parallel: arg("parallel") ? Number(arg("parallel")) : undefined, key, page: !flag("no-page"), sweep: arg("sweep") || undefined });
  const bad = r.records.filter((x) => x.refused || !x.passed);
  process.exit(bad.length ? 1 : 0);
}
