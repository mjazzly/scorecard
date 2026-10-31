#!/usr/bin/env node
// CI step: reads one sweep's records from results/, writes the job summary, and decides the run.
// The run is red when any case that matched on the build's last record (same build, same model)
// misses now, or when any job in the sweep was refused. A build missing its bar is not by itself
// red: the gate is "nothing that held has broken", so a build that has never met its bar on the
// smallest model can still be watched. On green, --green writes ci/last-green.json, the badge.
//
//   node ci/report.js --sweep S202611010917 [--green] [--summary FILE]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecords, previousOf, compareRecords, compareSweep, describeChanges } from "../compare.js";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const sweep = arg("sweep");
if (!sweep) { console.error("usage: node ci/report.js --sweep S... [--green] [--summary FILE]"); process.exit(2); }
const resultsDir = path.resolve(HERE, arg("results", "results"));
const summaryFile = arg("summary", process.env.GITHUB_STEP_SUMMARY || null);
const settings = JSON.parse(fs.readFileSync(path.join(HERE, "settings.json"), "utf8"));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const money = (x) => (x == null ? "no cost" : `US$${x.toFixed(3)}`);
const state = (m) => (m === true ? "match" : m === false ? "miss" : "absent");
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function judge(all, sweepId) {
  const recs = all.filter((r) => r.sweep === sweepId);
  const red = [];
  if (!recs.length) red.push({ build: "every build", model: "", case: "", why: `no records for sweep ${sweepId}: the sweep did not run` });
  const rows = recs.map((r) => {
    const prev = previousOf(all, r);
    const c = compareRecords(prev, r, settings);
    if (r.refused) red.push({ build: r.build, model: r.model, case: "", why: `refused (${r.refused.gate}: ${r.refused.detail})` });
    else for (const x of c.cases_changed) if (x.from === true && x.to !== true) red.push({ build: r.build, model: r.model, case: x.id, name: x.name, why: `${state(x.from)} on ${prev.sweep}, ${state(x.to)} now` });
    return { r, prev, c };
  });
  return { recs, rows, red, green: red.length === 0 };
}

const all = loadRecords(resultsDir);
const { recs, rows, red, green } = judge(all, sweep);
const total = recs.reduce((s, r) => s + (r.cost_usd || 0), 0);
const L = [];
L.push(`## Scorecard sweep ${sweep}: ${green ? "green" : "red"}`, "");
L.push(green
  ? "No case that matched on its build's last record misses now, and no job was refused."
  : `**${red.length} ${red.length === 1 ? "problem" : "problems"}**: a case that matched on its build's last record misses now, or a job was refused.`, "");
if (!green) {
  L.push("| Build | Model | Case | What happened |", "|---|---|---|---|");
  for (const x of red) L.push(`| ${cell(x.build)} | ${cell(x.model)} | ${cell(x.case ? `${x.case}${x.name && x.name !== x.case ? ` (${x.name})` : ""}` : "")} | ${cell(x.why)} |`);
  L.push("");
}
L.push("| Build | Model | Commit | Cases matched | Gates held | Bar | Cost | Against |", "|---|---|---|---|---|---|---|---|");
for (const { r, prev } of rows) {
  L.push(`| ${cell(r.title || r.build)} | ${cell(r.model)}${r.effort ? ` (${r.effort})` : ""} | ${r.commit ? r.commit.slice(0, 7) + (r.dirty ? " (changed)" : "") : "none"} | ${r.refused ? "refused" : `${r.matched} of ${r.of_cases}`} | ${r.gates_held ?? "none"} of ${r.of_gates ?? "none"} | ${r.passed ? "met" : "not met"} | ${money(r.cost_usd)} | ${prev ? prev.sweep : "first record"} |`);
}
L.push("", `**Sweep cost: ${money(total)}** on ${recs.length} ${recs.length === 1 ? "job" : "jobs"}.`, "");
L.push("<details><summary>Changes since the last run</summary>", "", "```", describeChanges(compareSweep(all, sweep, settings)), "```", "", "</details>", "");
const text = L.join("\n");
console.log(text);
if (summaryFile) fs.appendFileSync(summaryFile, text + "\n");

if (green && argv.includes("--green")) {
  const started = recs.map((r) => r.started_at).sort()[0];
  const badge = { schemaVersion: 1, label: "last green run", message: day(started), color: "2e7d32" };
  fs.writeFileSync(path.join(HERE, "ci", "last-green.json"), JSON.stringify(badge, null, 2) + "\n");
  console.log(`ci/last-green.json: ${badge.message}`);
}
process.exit(green ? 0 : 1);
