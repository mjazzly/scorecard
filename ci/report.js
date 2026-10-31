#!/usr/bin/env node
// CI step: reads a sweep's records from results/, writes the job summary, and decides the run.
//
// A case "breaks" when it matched on its build's last record (same build, same model) and misses
// now. The smallest model is noisy on some builds, so one miss is only a suspect: the workflow reruns
// the builds with a suspect case once (`--plan` names them), and the run is red only when the same
// case misses on the rerun too, or when any job is refused. A build missing its bar is not by itself
// red: the gate is "nothing that held has broken". Both records stay on the record. On green,
// --green writes ci/last-green.json, which the badge reads.
//
// Only a build whose smallest passing model (read from the records before this run) is the model CI
// ran is gated. Any other build is watched: it runs, its misses are listed, but it cannot turn the
// run red and is not rerun. It becomes gated by itself once it passes on that model. A refusal is
// red for every build, gated or watched, because it means the pipeline itself broke.
//
//   node ci/report.js --sweep S1 --plan               names the builds to rerun (GITHUB_OUTPUT rerun=...)
//   node ci/report.js --sweep S1 [--rerun S1r] [--green] [--summary FILE]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecords, previousOf, compareRecords, compareSweep, describeChanges, smallestPassing } from "../compare.js";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const sweep = arg("sweep");
if (!sweep) { console.error("usage: node ci/report.js --sweep S... [--plan] [--rerun S...r] [--green] [--summary FILE]"); process.exit(2); }
const rerun = arg("rerun");
const resultsDir = path.resolve(HERE, arg("results", "results"));
const summaryFile = arg("summary", process.env.GITHUB_STEP_SUMMARY || null);
const settings = JSON.parse(fs.readFileSync(path.join(HERE, "settings.json"), "utf8"));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const money = (x) => (x == null ? "no cost" : `US$${x.toFixed(3)}`);
const state = (m) => (m === true ? "match" : m === false ? "miss" : "absent");
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const same = (a, b) => a.build === b.build && a.model === b.model && (a.effort ?? null) === (b.effort ?? null);

const all = loadRecords(resultsDir);
const recs = all.filter((r) => r.sweep === sweep);
const again = rerun ? all.filter((r) => r.sweep === rerun) : [];

// Gated or watched, from the records before this run.
const before = all.filter((r) => r.sweep !== sweep && r.sweep !== rerun);
const passingOn = smallestPassing(before);
const gated = (r) => passingOn[r.build]?.model_tag === r.model_tag;

// The first look: every refusal, and every case that matched on the last record and misses now.
const red = [], suspects = [], cleared = [], watched = [];
if (!recs.length) red.push({ build: "every build", model: "", case: "", why: `no records for sweep ${sweep}: the sweep did not run` });
const rows = recs.map((r) => {
  const prev = previousOf(all.filter((x) => x.sweep !== rerun), r);
  const c = compareRecords(prev, r, settings);
  if (r.refused) red.push({ build: r.build, model: r.model, case: "", why: `refused (${r.refused.gate}: ${r.refused.detail})` });
  else for (const x of c.cases_changed) if (x.from === true && x.to !== true) {
    const s = { build: r.build, model: r.model, rec: r, case: x.id, name: x.name, why: `${state(x.from)} on ${prev.sweep}, ${state(x.to)} on ${sweep}` };
    if (gated(r)) suspects.push(s);
    else watched.push({ ...s, why: `${s.why}; watched, not gated: its smallest passing model is ${passingOn[r.build]?.model_tag ?? "none on the record"}` });
  }
  return { r, prev };
});

if (argv.includes("--plan")) {
  const builds = [...new Set(suspects.map((s) => s.build))];
  console.log(builds.length ? `rerun once: ${builds.join(", ")} (${suspects.map((s) => `${s.build} ${s.case}`).join(", ")})` : "nothing to rerun");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `rerun=${builds.join(",")}\n`);
  process.exit(0);
}

// The verdict: a suspect is red only when the rerun misses the same case, or there was no rerun.
for (const s of suspects) {
  const second = again.find((r) => same(r, s.rec));
  if (!second) red.push({ ...s, why: `${s.why}; not rerun` });
  else if (second.refused) red.push({ ...s, why: `${s.why}; the rerun was refused (${second.refused.gate}: ${second.refused.detail})` });
  else if (second.cases[s.case]?.match !== true) red.push({ ...s, why: `${s.why}; ${state(second.cases[s.case]?.match ?? null)} again on the rerun ${rerun}` });
  else cleared.push({ ...s, why: `${s.why}; match on the rerun ${rerun}` });
}
const green = red.length === 0;
const total = [...recs, ...again].reduce((n, r) => n + (r.cost_usd || 0), 0);

const L = [];
L.push(`## Scorecard sweep ${sweep}: ${green ? "green" : "red"}`, "");
L.push(green
  ? "No case that matched on its build's last record misses now (a single miss is confirmed on one rerun), and no job was refused."
  : `**${red.length} ${red.length === 1 ? "problem" : "problems"}**: a case that matched on its build's last record missed on the sweep and again on its rerun, or a job was refused.`, "");
const caseCell = (x) => cell(x.case ? `${x.case}${x.name && x.name !== x.case ? ` (${x.name})` : ""}` : "");
if (!green) {
  L.push("| Build | Model | Case | What happened |", "|---|---|---|---|");
  for (const x of red) L.push(`| ${cell(x.build)} | ${cell(x.model)} | ${caseCell(x)} | ${cell(x.why)} |`);
  L.push("");
}
if (watched.length) {
  L.push("Watched builds (run and listed, not gated, because the model CI runs is not their smallest passing model):", "", "| Build | Model | Case | What happened |", "|---|---|---|---|");
  for (const x of watched) L.push(`| ${cell(x.build)} | ${cell(x.model)} | ${caseCell(x)} | ${cell(x.why)} |`);
  L.push("");
}
if (cleared.length) {
  L.push("Missed once and matched on the rerun (model noise, not counted against the run):", "", "| Build | Model | Case | What happened |", "|---|---|---|---|");
  for (const x of cleared) L.push(`| ${cell(x.build)} | ${cell(x.model)} | ${caseCell(x)} | ${cell(x.why)} |`);
  L.push("");
}
L.push("| Build | Model | Run | Gate | Commit | Cases matched | Gates held | Bar | Cost | Against |", "|---|---|---|---|---|---|---|---|---|---|");
const line = (r, against) => `| ${cell(r.title || r.build)} | ${cell(r.model)}${r.effort ? ` (${r.effort})` : ""} | ${r.sweep} | ${gated(r) ? "gated" : "watched"} | ${r.commit ? r.commit.slice(0, 7) + (r.dirty ? " (changed)" : "") : "none"} | ${r.refused ? "refused" : `${r.matched} of ${r.of_cases}`} | ${r.gates_held ?? "none"} of ${r.of_gates ?? "none"} | ${r.passed ? "met" : "not met"} | ${money(r.cost_usd)} | ${against} |`;
for (const { r, prev } of rows) L.push(line(r, prev ? prev.sweep : "first record"));
for (const r of again) L.push(line(r, "rerun"));
L.push("", `**Run cost: ${money(total)}** on ${recs.length + again.length} ${recs.length + again.length === 1 ? "job" : "jobs"}${again.length ? `, ${again.length} of them ${again.length === 1 ? "a rerun" : "reruns"}` : ""}.`, "");
L.push("<details><summary>Changes since the last run</summary>", "", "```", describeChanges(compareSweep(all.filter((x) => x.sweep !== rerun), sweep, settings)), "```", "", "</details>", "");
const text = L.join("\n");
console.log(text);
if (summaryFile) fs.appendFileSync(summaryFile, text + "\n");

// Annotations: the same verdict on the run's page and on the commit's checks.
if (process.env.GITHUB_ACTIONS) {
  const esc = (t) => String(t).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const x of red) console.log(`::error title=${esc(x.case ? "Case broke" : "Run refused")}::${esc(`${x.build} on ${x.model}${x.case ? `, case ${x.case}` : ""}: ${x.why}`)}`);
  for (const x of watched) console.log(`::warning title=Watched::${esc(`${x.build} on ${x.model}, case ${x.case}: ${x.why}`)}`);
  for (const x of cleared) console.log(`::warning title=Missed once::${esc(`${x.build} on ${x.model}, case ${x.case}: ${x.why}`)}`);
  if (green) console.log(`::notice title=Green::${esc(`sweep ${sweep}: ${rows.map(({ r }) => `${r.build} ${r.matched} of ${r.of_cases}`).join(", ")}${again.length ? `; rerun ${again.map((r) => `${r.build} ${r.matched} of ${r.of_cases}`).join(", ")}` : ""}; ${money(total)}`)}`);
}

if (green && argv.includes("--green")) {
  const started = recs.map((r) => r.started_at).sort()[0];
  const badge = { schemaVersion: 1, label: "last green run", message: day(started), color: "2e7d32" };
  fs.writeFileSync(path.join(HERE, "ci", "last-green.json"), JSON.stringify(badge, null, 2) + "\n");
  console.log(`ci/last-green.json: ${badge.message}`);
}
process.exit(green ? 0 : 1);
