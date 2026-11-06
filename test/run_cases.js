#!/usr/bin/env node
// The scorecard's own case set: the harness is itself tested. Every case runs on the builds'
// scripted stand-ins (--mock in each build: no model, no key, seconds) or on fixture records copied
// from the builds' own results folders. Nothing here touches a build: every planted change goes
// into a staging copy under runs/test/.
//
//   node test/run_cases.js                       cases 1 to 6, A and B on every build under the root
//   node test/run_cases.js --builds meeting-tracker-server,sourced-brief
//   node test/run_cases.js --live                also case 2b: a skill copy with one rule removed, run on
//                                                the smallest model with your key (about US$0.05)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HERE, sweep, runJob, loadSettings, apiKey, localIso } from "../run.js";
import { findAdapters, loadAdapter } from "../lib/adapters.js";
import { stageCopy } from "../lib/stage.js";
import { scanForKey, keyNames } from "../lib/gates.js";
import { deriveRecord, equalsHarness, costFrom } from "../lib/record.js";
import { compareRecords, loadRecords, previousOf, latest } from "../compare.js";

const argv = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const LIVE = argv.includes("--live");
const settings = loadSettings();
const ROOT = path.resolve(HERE, arg("root", settings.root || ".."));
const BUILDS = arg("builds") ? arg("builds").split(",").map((s) => s.trim()) : null;
let T = path.join(HERE, "runs", "test");
const FIX = path.join(HERE, "test", "fixtures");
const quiet = () => {};
const TRACKER = "meeting-tracker-server";
const haiku = settings.models.find((m) => m.id === "claude-haiku-5-5") || settings.models[0];
const opus = settings.models.find((m) => m.id === "claude-opus-5-5") || settings.models.at(-1);
const trackerAdapter = JSON.parse(fs.readFileSync(path.join(HERE, "adapters", `${TRACKER}.harness.json`), "utf8"));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));
const later = (iso, minutes) => localIso(new Date(new Date(iso).getTime() + minutes * 60000));

// A fresh scratch folder. Where the last one cannot be removed (a shared folder with deletion off),
// a stamped folder is used instead; everything under runs/ is ignored by git either way.
try { fs.rmSync(T, { recursive: true, force: true }); } catch { T = path.join(HERE, "runs", `test-${localIso().slice(0, 16).replace(/[-:T]/g, "")}`); }
fs.mkdirSync(T, { recursive: true });
const results = [];
let n = 0;
async function kase(id, title, fn) {
  const t0 = Date.now();
  let ok = false, detail = "";
  try { const r = await fn(); ok = r.ok; detail = r.detail; } catch (e) { ok = false; detail = `threw: ${e.stack || e}`; }
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  results.push({ id, title, ok, detail, secs });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${title}  (${secs}s)\n      ${detail}`);
  n++;
}
const entries = () => findAdapters(ROOT).filter((e) => !BUILDS || BUILDS.includes(e.name));
const trackerEntry = () => findAdapters(ROOT).find((e) => e.name === TRACKER);
const sub = (name) => ({ runsDir: path.join(T, name, "runs"), resultsDir: path.join(T, name, "results") });
const derive = (harness, model, sweepId, prices, started_at = harness.started_at) => deriveRecord({ sweep: sweepId, adapter: trackerAdapter, model, mode: "harness", started_at, harness, harness_path: "fixture", prices: { table: prices, read: "2026-10-25", age_days: 5 } });

console.log(`scorecard case set: root ${ROOT}, builds ${entries().map((e) => e.name).join(", ") || "none"}${LIVE ? ", live case 2b on" : ""}\n`);

// 1. Clean sweep: every build, both models, mock. Every record written; every number equals the build's own record.
await kase("1", "Clean sweep", async () => {
  const r = await sweep({ settings, root: ROOT, builds: BUILDS, mock: true, ...sub("c1"), say: quiet, page: false });
  const want = entries().length * settings.models.length;
  const problems = [];
  for (const rec of r.records) {
    if (rec.refused) { problems.push(`${rec.build} on ${rec.model_tag} refused: ${rec.refused.detail}`); continue; }
    const hp = path.join(HERE, rec.harness_record || "");
    if (!fs.existsSync(hp)) { problems.push(`${rec.build} on ${rec.model_tag}: no harness record (${rec.warnings.join("; ")})`); continue; }
    const diffs = equalsHarness(rec, JSON.parse(fs.readFileSync(hp, "utf8")));
    if (diffs.length) problems.push(`${rec.build} on ${rec.model_tag}: ${diffs.join(", ")}`);
    if (!rec.passed) problems.push(`${rec.build} on ${rec.model_tag}: mock did not meet the bar`);
  }
  const written = fs.readdirSync(sub("c1").resultsDir).length;
  return { ok: written === want && r.records.length === want && !problems.length, detail: `${written} of ${want} records written; ${problems.length ? problems.join(" | ") : "every number equals the build's own record"}` };
});

// 2a. Planted regression, record form: one case flipped to miss must be named, and nothing else.
await kase("2a", "Planted regression (record)", async () => {
  const prevH = fixture("tracker-opus.json"), prices = fixture("tracker-prices.json");
  const curH = structuredClone(prevH);
  curH.cases["03_northgate_claims.txt"].match = false; curH.verdict.five_matched -= 1;
  const prev = derive(prevH, opus, "S1", prices), cur = derive(curH, opus, "S2", prices, later(prevH.started_at, 60));
  const c = compareRecords(prev, cur, settings);
  const ok = c.cases_changed.length === 1 && c.cases_changed[0].id === "03_northgate_claims.txt" && c.cases_changed[0].from === true && c.cases_changed[0].to === false && !c.cost.moved && !c.version.changed;
  return { ok, detail: `named: ${c.cases_changed.map((x) => `${x.id} match to miss`).join(", ") || "nothing"}; cost moved ${c.cost.moved}; version changed ${c.version.changed}` };
});

// 2b. Planted regression, live form: the tracker skill with the owner rule removed, on the smallest model.
if (LIVE) await kase("2b", "Planted regression (live, owner rule removed)", async () => {
  const key = apiKey();
  if (!key) return { ok: false, detail: "no API key in .env" };
  const entry = trackerEntry();
  if (!entry) return { ok: false, detail: "tracker not under the root" };
  const overlays = [{ path: "skill/SKILL.md", edit: (t) => t.split("\n").filter((l) => !l.startsWith("- **The owner is the person the transcript names")).join("\n").replace(/ Then check each row's owner against the sentence on its source line; an owner the sentence does not name becomes "not stated"\./, "") }];
  const rec = await runJob({ settings, sweep: "Slive", entry, model: haiku, overlays, ...sub("c2b"), key, say: console.log });
  const prevH = fixture("tracker-haiku.json"), prices = fixture("tracker-prices.json");
  const prev = derive(prevH, haiku, "S0", prices, "2026-01-01T00:00:00.000Z");
  const c = compareRecords(prev, rec, settings);
  const red = c.cases_changed.filter((x) => x.to === false);
  return { ok: !rec.refused && red.length > 0, detail: rec.refused ? `refused: ${rec.refused.detail}` : `${rec.matched} of ${rec.of_cases}; turned red: ${red.map((x) => x.id).join(", ") || "none (the model held the rule without being told; nothing to name)"}; cost ${rec.cost_usd?.toFixed(3)}` };
});

// 3. Planted cost shift: one price doubled must show the cost move and nothing else.
await kase("3", "Planted cost shift", async () => {
  const h = fixture("tracker-opus.json"), prices = fixture("tracker-prices.json");
  const doubled = structuredClone(prices); doubled[opus.id].output *= 2;
  const prev = derive(h, opus, "S1", prices), cur = derive(h, opus, "S2", doubled, later(h.started_at, 60));
  const c = compareRecords(prev, cur, settings);
  const ok = c.cost.moved && c.cost.share > 0 && c.cases_changed.length === 0 && !c.version.changed && !c.passed.changed && Math.abs(cur.cost_usd - costFrom(h.tokens, doubled[opus.id])) < 1e-9;
  return { ok, detail: `cost US$${prev.cost_usd.toFixed(3)} to US$${cur.cost_usd.toFixed(3)} (${c.cost.share > 0 ? "+" : ""}${Math.round(c.cost.share * 100)}%, moved ${c.cost.moved}); cases changed ${c.cases_changed.length}; version changed ${c.version.changed}; bar changed ${c.passed.changed}` };
});

// 4. The answer key in the run folder: refused before any model call, and the refusal on the record.
await kase("4", "Answer key in the run folder", async () => {
  const entry = trackerEntry();
  if (!entry) return { ok: false, detail: "tracker not under the root" };
  const keyFile = fs.readdirSync(path.join(entry.dir, entry.adapter.expected)).find((f) => f.endsWith(".json"));
  const overlays = [{ path: `${entry.adapter.data}/${keyFile}`, from: path.join(entry.dir, entry.adapter.expected, keyFile) }];
  const rec = await runJob({ settings, sweep: "S4", entry, model: haiku, mock: true, overlays, ...sub("c4"), say: quiet });
  const logExists = fs.existsSync(path.join(sub("c4").runsDir, "S4", `${TRACKER}-${rec.model_tag}`, "harness.log"));
  const onRecord = JSON.parse(fs.readFileSync(path.join(sub("c4").resultsDir, `S4-${TRACKER}-${rec.model_tag}.json`), "utf8")).refused;
  // The second form: a key file dropped into a finished run folder is found by the same scan.
  const clean = await runJob({ settings, sweep: "S4b", entry, model: haiku, mock: true, ...sub("c4"), say: quiet });
  const copy = path.join(sub("c4").runsDir, "S4b", `${TRACKER}-${clean.model_tag}`, "copy");
  const runFolder = path.join(copy, entry.adapter.runs_mock, `S4b-${clean.model_tag}`);
  fs.copyFileSync(path.join(entry.dir, entry.adapter.expected, keyFile), path.join(runFolder, "data", keyFile));
  const after = scanForKey(runFolder, path.join(copy, entry.adapter.expected), keyNames(path.join(copy, entry.adapter.expected)));
  const ok = !!rec.refused && rec.refused.gate.includes("before the run") && !logExists && rec.counted === false && !!onRecord && !clean.refused && after.length === 1;
  return { ok, detail: `before the run: ${rec.refused ? `refused (${rec.refused.detail})` : "NOT refused"}, harness started: ${logExists}, on the record: ${!!onRecord}; after the run: ${after[0] || "not found"}` };
});

// 5. A broken adapter: a missing checker path refuses before any process, with the field named.
await kase("5", "Broken adapter", async () => {
  const entry = trackerEntry();
  if (!entry) return { ok: false, detail: "tracker not under the root" };
  const root = path.join(T, "c5", "root");
  const dir = stageCopy(entry.dir, path.join(root, "tracker-broken"));
  const a = JSON.parse(fs.readFileSync(path.join(dir, "harness.json"), "utf8")); delete a.checker; a.build = "tracker-broken";
  fs.writeFileSync(path.join(dir, "harness.json"), JSON.stringify(a, null, 2));
  const r = await sweep({ settings, root, mock: true, models: [haiku], ...sub("c5"), say: quiet, page: false });
  const rec = r.records[0];
  const jobDir = path.join(sub("c5").runsDir, rec.sweep, `tracker-broken-${rec.model_tag}`);
  const ok = r.records.length === 1 && !!rec.refused && rec.refused.gate === "adapter" && /checker/.test(rec.refused.detail) && !fs.existsSync(jobDir);
  return { ok, detail: `${rec.refused ? `refused (${rec.refused.detail})` : "NOT refused"}; process started: ${fs.existsSync(jobDir)}` };
});

// 6. Identical rerun: the same build, model and inputs give the same cases; cost inside the tolerance.
await kase("6", "Identical rerun", async () => {
  const entry = trackerEntry();
  if (!entry) return { ok: false, detail: "tracker not under the root" };
  const a = await runJob({ settings, sweep: "S6a", entry, model: haiku, mock: true, ...sub("c6"), say: quiet });
  const b = await runJob({ settings, sweep: "S6b", entry, model: haiku, mock: true, ...sub("c6"), say: quiet });
  const c = compareRecords(a, b, settings);
  const prices = fixture("data-answers-prices.json");
  const da = { ...trackerAdapter, build: "data-answers", gates: { held: "refusals_held", of: "of_refusals" } };
  const dx = (h, s) => deriveRecord({ sweep: s, adapter: da, model: haiku, mode: "harness", started_at: h.started_at, harness: h, harness_path: "fixture", prices: { table: prices } });
  const p = dx(fixture("data-answers-haiku-a.json"), "S1"), q = dx(fixture("data-answers-haiku-b.json"), "S2");
  const cc = compareRecords(p, q, settings);
  const ok = c.cases_changed.length === 0 && a.matched === b.matched && !cc.cost.moved && Math.abs(cc.cost.share) <= settings.cost_move_share;
  return { ok, detail: `mock rerun: ${a.matched} of ${a.of_cases} both times, cases changed ${c.cases_changed.length}; real pair: US$${p.cost_usd.toFixed(3)} and US$${q.cost_usd.toFixed(3)} (${Math.round(cc.cost.share * 100)}%, tolerance ${Math.round(settings.cost_move_share * 100)}%)` };
});

// A. A new version of one build appears as a new version with the change named against the previous one.
await kase("A", "New version", async () => {
  const entry = trackerEntry();
  if (!entry) return { ok: false, detail: "tracker not under the root" };
  // The bump is from whatever version the skill carries now, so the case holds after a real version move.
  const m = /Version: v(\d+)\.(\d+)/.exec(fs.readFileSync(path.join(entry.dir, "skill/SKILL.md"), "utf8"));
  if (!m) return { ok: false, detail: "no Version line in the tracker's skill" };
  const from = `v${m[1]}.${m[2]}`, to = `v${m[1]}.${Number(m[2]) + 1}`;
  const overlays = [{ path: "skill/SKILL.md", edit: (t) => t.replace(`Version: ${from}`, `Version: ${to}`) }];
  const rec = await runJob({ settings, sweep: "S6c", entry, model: haiku, mock: true, overlays, ...sub("c6"), say: quiet });
  const all = loadRecords(sub("c6").resultsDir);
  const c = compareRecords(previousOf(all, rec), rec, settings);
  const ok = rec.skill_version === to && c.version.changed && c.version.from.startsWith(`${from} /`) && c.version.to.startsWith(`${to} /`) && c.cases_changed.length === 0;
  return { ok, detail: `version ${c.version.from} to ${c.version.to}, named against ${c.previous}; cases changed ${c.cases_changed.length}` };
});

// B. A new build added by adapter alone appears on the next sweep with no change to run.js.
await kase("B", "New build by adapter alone", async () => {
  const root = path.join(T, "cB", "root");
  fs.mkdirSync(root, { recursive: true });
  const have = entries();
  for (const e of have) fs.symlinkSync(e.dir, path.join(root, e.name), "dir");
  const src = have.find((e) => e.name === "spreadsheet-normaliser") || have[0];
  if (!src) return { ok: false, detail: "no build under the root to copy" };
  const dir = stageCopy(src.dir, path.join(root, "fifth-build"));
  const a = JSON.parse(fs.readFileSync(path.join(dir, "harness.json"), "utf8")); a.build = "fifth-build"; a.title = "Fifth build";
  fs.writeFileSync(path.join(dir, "harness.json"), JSON.stringify(a, null, 2));
  const found = findAdapters(root);
  const r = await sweep({ settings, root, builds: ["fifth-build"], mock: true, models: [haiku], ...sub("cB"), say: quiet, page: false });
  const rec = r.records[0];
  const ok = found.length === have.length + 1 && found.some((e) => e.name === "fifth-build" && !e.error) && !!rec && !rec.refused && rec.build === "fifth-build" && rec.passed;
  return { ok, detail: `${found.length} builds found (${have.length} before); fifth-build ${rec ? `${rec.matched} of ${rec.of_cases}, ${rec.passed ? "bar met" : "bar not met"}` : "no record"}; run.js untouched` };
});

// ---------- the record of this run ----------
const passed = results.filter((r) => r.ok).length;
const lines = [`# Scorecard case set, run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "",
  `${passed} of ${results.length} passed. Builds under the root: ${entries().map((e) => e.name).join(", ") || "none"}.${LIVE ? " Case 2b ran live." : " Case 2b (live) not run; pass --live with a key in .env."}`, "",
  "| Case | Result | Detail | Seconds |", "|---|---|---|---|",
  ...results.map((r) => `| ${r.id}. ${r.title} | ${r.ok ? "pass" : "FAIL"} | ${r.detail.replace(/\|/g, "/")} | ${r.secs} |`), ""];
fs.writeFileSync(path.join(HERE, "test", "RESULTS.md"), lines.join("\n"));
console.log(`\n${passed} of ${results.length} passed; written to test/RESULTS.md`);
process.exit(passed === results.length ? 0 : 1);
