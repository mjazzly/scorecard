#!/usr/bin/env node
// The page. Rebuilds SCORECARD.md and scorecard.html from results/: one table of builds down and
// models across (cases matched, gates held, cost), the changes since the last sweep, and the
// version record. Every number comes from a counted record; a refused run is listed, never scored.
//
//   node page.js          rebuild both from results/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecords, latest, smallestPassing, compareSweep } from "./compare.js";
import { modelTag } from "./lib/record.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const money = (x) => (x == null ? "no cost" : `US$${x.toFixed(3)}`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function summarise(all, settings) {
  const counted = all.filter((r) => r.counted && !r.refused);
  const table = latest(all), smallest = smallestPassing(all);
  // Sweeps are the scorecard's own runs; imported records keep their history but are not sweeps.
  // A CI rerun (sweep id ending in r) belongs to the sweep it confirms and is not a sweep of its own.
  const sweeps = [...new Set(all.filter((r) => r.mode !== "imported").map((r) => r.sweep.replace(/r$/, "")))].sort();
  const last = sweeps.at(-1) || null;
  const importedRuns = counted.filter((r) => r.mode === "imported").length;
  const models = [...settings.models.map(modelTag)];
  for (const r of counted) if (!models.includes(r.model_tag)) models.push(r.model_tag);
  const sweepCost = Object.values(smallest).every((s) => s && s.cost_usd != null) && Object.keys(smallest).length ? Object.values(smallest).reduce((n, s) => n + s.cost_usd, 0) : null;
  const versions = {};
  for (const r of counted) {
    const b = versions[r.build] || (versions[r.build] = {});
    const v = b[r.version] || (b[r.version] = { version: r.version, since: r.date, models: {} });
    if (r.date < v.since) v.since = r.date;
    if (!v.models[r.model_tag] || r.started_at > v.models[r.model_tag].started_at) v.models[r.model_tag] = r;
  }
  const unpassed = Object.entries(smallest).filter(([, x]) => !x).map(([b]) => table[b]?.title || b);
  return { counted, table, smallest, sweeps, last, models, sweepCost, unpassed, versions, changes: last ? compareSweep(all, last, settings) : null,
    numbers: { builds: Object.keys(table).length, runs: counted.length, imported: importedRuns, sweeps: sweeps.length, sweep_cost: sweepCost } };
}

// The sweep cost is only stated when every build has a passing model; otherwise the page names the
// builds that have none, which is the more useful fact.
function sweepLine(s, md) {
  const b = (x) => (md ? `**${x}**` : `<b>${esc(x)}</b>`);
  if (s.sweepCost != null) return `A full sweep on the smallest passing models costs ${b(money(s.sweepCost))}.`;
  if (s.unpassed.length) return `No model passes ${s.unpassed.map(b).join(" or ")} on the latest version.`;
  return "";
}

function cellText(r, mark) {
  if (!r) return "no counted run";
  return `${r.matched} of ${r.of_cases} cases, gates ${r.gates_held ?? "?"} of ${r.of_gates ?? "?"}, ${money(r.cost_usd)}, ${r.passed ? "bar met" : "bar not met"}${mark ? " (smallest passing)" : ""}`;
}

export function renderMarkdown(s) {
  const L = [];
  L.push("# Scorecard", "", `Rebuilt from \`results/\` on ${new Date().toISOString().slice(0, 10)}. **${s.numbers.builds} builds**, **${s.numbers.runs} counted runs**${s.numbers.imported ? ` (${s.numbers.imported} imported from the builds' own records)` : ""} and **${s.numbers.sweeps} sweeps**. ${sweepLine(s, true)}`, "");
  L.push("## Builds by model", "", `| Build | Version | ${s.models.join(" | ")} |`, `|---|---|${s.models.map(() => "---").join("|")}|`);
  for (const b of Object.values(s.table)) L.push(`| ${b.title} | ${b.version} | ${s.models.map((m) => cellText(b.models[m], s.smallest[b.build]?.model_tag === m)).join(" | ")} |`);
  L.push("", "Cases: the build's own case set, matched by the build's own checker. Gates: the stop and decline cases in that set. Cost: every token at the price in the build's prices file, caching counted. The bar is each build's own pass rule.", "");
  if (s.changes) {
    L.push(`## Changes since the last run (sweep ${s.last})`, "", "| Build | Model | Against | Version | Cases changed | Cost | Bar |", "|---|---|---|---|---|---|---|");
    for (const c of s.changes.comparisons) {
      if (c.refused) { L.push(`| ${c.title || c.build} | ${c.model_tag} | refused | | ${c.refused.gate}: ${c.refused.detail} | | |`); continue; }
      const cases = c.cases_changed.length ? c.cases_changed.map((x) => `${x.id} ${x.from === true ? "match" : x.from === false ? "miss" : "absent"} to ${x.to === true ? "match" : x.to === false ? "miss" : "absent"}`).join("; ") : "none";
      const cost = c.previous ? `${money(c.cost.from)} to ${money(c.cost.to)}${c.cost.share != null ? ` (${c.cost.share > 0 ? "+" : ""}${Math.round(c.cost.share * 100)}%${c.cost.moved ? ", moved" : ""})` : ""}` : money(c.cost.to);
      L.push(`| ${c.title || c.build} | ${c.model_tag} | ${c.previous || "first record"} | ${c.version.changed ? `${c.version.from} to ${c.version.to}` : c.version.to} | ${cases} | ${cost} | ${c.passed.changed ? `${c.passed.from ? "met" : "not met"} to ${c.passed.to ? "met" : "not met"}` : c.passed.to ? "met" : "not met"} |`);
    }
    L.push("", `A cost that moved by more than ${Math.round((s.changes.comparisons[0]?.cost.tolerance ?? 0.3) * 100)}% against the previous record is marked moved.`, "");
  }
  L.push("## Version record", "", `| Build | Version | First recorded | ${s.models.join(" | ")} |`, `|---|---|---|${s.models.map(() => "---").join("|")}|`);
  for (const [build, vs] of Object.entries(s.versions)) for (const v of Object.values(vs).sort((a, b) => (a.since < b.since ? -1 : 1)))
    L.push(`| ${s.table[build]?.title || build} | ${v.version} | ${v.since} | ${s.models.map((m) => (v.models[m] ? `${v.models[m].matched} of ${v.models[m].of_cases}, ${v.models[m].passed ? "met" : "not met"}` : "")).join(" | ")} |`);
  L.push("");
  return L.join("\n");
}

export function renderHtml(s) {
  const maxCost = Math.max(0.001, ...Object.values(s.table).flatMap((b) => Object.values(b.models).map((r) => r.cost_usd || 0)));
  const cell = (r, mark) => {
    if (!r) return `<td class="cell empty">no counted run</td>`;
    const w = Math.round(((r.cost_usd || 0) / maxCost) * 100);
    return `<td class="cell ${r.passed ? "met" : "notmet"}${mark ? " smallest" : ""}"><div class="line"><b>${r.matched} of ${r.of_cases}</b> cases</div><div class="line">gates <b>${r.gates_held ?? "?"} of ${r.of_gates ?? "?"}</b></div><div class="line">${money(r.cost_usd)}</div><div class="bar"><span style="width:${w}%"></span></div><div class="verdict">${r.passed ? "bar met" : "bar not met"}${mark ? " · smallest passing" : ""}</div></td>`;
  };
  const rows = Object.values(s.table).map((b) => `<tr><th scope="row"><b>${esc(b.title)}</b><small>${esc(b.version)}</small></th>${s.models.map((m) => cell(b.models[m], s.smallest[b.build]?.model_tag === m)).join("")}</tr>`).join("\n");
  let changes = "";
  if (s.changes) {
    const st = (v) => (v === true ? "match" : v === false ? "miss" : "absent");
    const trs = s.changes.comparisons.map((c) => {
      if (c.refused) return `<tr><td><b>${esc(c.title || c.build)}</b></td><td>${esc(c.model_tag)}</td><td>refused</td><td colspan="4">${esc(c.refused.gate)}: ${esc(c.refused.detail)}</td></tr>`;
      const cases = c.cases_changed.length ? c.cases_changed.map((x) => `<b>${esc(x.id)}</b> ${st(x.from)} to ${st(x.to)}`).join("<br>") : "none";
      const cost = c.previous ? `${money(c.cost.from)} to ${money(c.cost.to)}${c.cost.share != null ? ` (${c.cost.share > 0 ? "+" : ""}${Math.round(c.cost.share * 100)}%${c.cost.moved ? ", <b>moved</b>" : ""})` : ""}` : money(c.cost.to);
      return `<tr><td><b>${esc(c.title || c.build)}</b></td><td>${esc(c.model_tag)}</td><td>${esc(c.previous || "first record")}</td><td>${c.version.changed ? `<b>${esc(c.version.from)} to ${esc(c.version.to)}</b>` : esc(c.version.to)}</td><td>${cases}</td><td>${cost}</td><td>${c.passed.changed ? `<b>${c.passed.from ? "met" : "not met"} to ${c.passed.to ? "met" : "not met"}</b>` : c.passed.to ? "met" : "not met"}</td></tr>`;
    }).join("\n");
    changes = `<section><h2>Changes since the last run <small>sweep ${esc(s.last)}</small></h2><table class="plain"><thead><tr><th>Build</th><th>Model</th><th>Against</th><th>Version</th><th>Cases changed</th><th>Cost</th><th>Bar</th></tr></thead><tbody>${trs}</tbody></table><p class="note">A cost that moved by more than ${Math.round((s.changes.comparisons[0]?.cost.tolerance ?? 0.3) * 100)}% against the previous record is marked <b>moved</b>.</p></section>`;
  }
  const versions = Object.entries(s.versions).flatMap(([build, vs]) => Object.values(vs).sort((a, b) => (a.since < b.since ? -1 : 1)).map((v) => `<tr><td><b>${esc(s.table[build]?.title || build)}</b></td><td>${esc(v.version)}</td><td>${v.since}</td>${s.models.map((m) => `<td>${v.models[m] ? `${v.models[m].matched} of ${v.models[m].of_cases}, ${v.models[m].passed ? "met" : "not met"}` : ""}</td>`).join("")}</tr>`)).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scorecard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#1a2330;--muted:#6b7684;--line:#e6e9ee;--marine:#1f4e79;--amber:#c9922a;--met:#eef6ee;--notmet:#fbeeee;--paper:#f6f7f9}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Manrope,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.5}
main{max-width:1100px;margin:0 auto;padding:40px 24px 56px}h1{font-size:30px;margin:0 0 6px;letter-spacing:-.01em}h1 i{display:inline-block;width:10px;height:10px;background:var(--marine);margin-right:10px;vertical-align:middle}h1 em{display:inline-block;width:10px;height:10px;background:var(--amber);margin-left:10px;vertical-align:middle}
h2{font-size:18px;margin:36px 0 12px}h2 small{color:var(--muted);font-weight:400;font-size:13px;margin-left:8px}.lead{color:var(--muted);margin:0 0 20px}
.numbers{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0 8px}.numbers div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;min-height:88px}.numbers b{display:block;font-size:26px;line-height:1.1}.numbers span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:12px 14px;border-bottom:1px solid var(--line)}thead th{font-size:13px;color:var(--muted);font-weight:600;background:#fafbfc}tr:last-child td,tr:last-child th{border-bottom:0}
th[scope=row]{width:190px;background:#fafbfc}th[scope=row] small{display:block;color:var(--muted);font-weight:400;font-size:12px}
.cell{width:220px}.cell .line{font-size:14px}.cell.met{background:var(--met)}.cell.notmet{background:var(--notmet)}.cell.empty{color:var(--muted)}.cell.smallest .verdict{color:var(--amber);font-weight:700}
.verdict{font-size:12px;margin-top:6px;color:var(--muted)}.bar{height:6px;background:#e9edf2;border-radius:3px;margin-top:8px;overflow:hidden}.bar span{display:block;height:100%;background:var(--marine)}
.plain td,.plain th{font-size:14px}.note{color:var(--muted);font-size:13px}footer{margin-top:48px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:14px}
@media(max-width:800px){.numbers{grid-template-columns:repeat(2,1fr)}table{display:block;overflow-x:auto}}
</style></head><body><main>
<h1><i></i>Scorecard<em></em></h1>
<p class="lead">Every build on every model, run by one command, on the record. Rebuilt from <code>results/</code> on ${new Date().toISOString().slice(0, 10)}.</p>
<div class="numbers"><div><b>${s.numbers.builds}</b><span>builds covered</span></div><div><b>${s.numbers.runs}</b><span>counted runs on the record${s.numbers.imported ? `, ${s.numbers.imported} imported from the builds' own records` : ""}</span></div><div><b>${s.numbers.sweeps}</b><span>sweeps</span></div>${s.sweepCost != null ? `<div><b>${money(s.sweepCost)}</b><span>one full sweep on the smallest passing models</span></div>` : `<div><b>${s.numbers.builds - s.unpassed.length} of ${s.numbers.builds}</b><span>builds with a passing model; none yet for ${s.unpassed.map(esc).join(", ")}</span></div>`}</div>
<section><h2>Builds by model</h2><table><thead><tr><th>Build</th>${s.models.map((m) => `<th>${esc(m)}</th>`).join("")}</tr></thead><tbody>
${rows}
</tbody></table><p class="note"><b>Cases</b>: the build's own case set, matched by the build's own checker. <b>Gates</b>: the stop and decline cases in that set. <b>Cost</b>: every token at the price in the build's prices file, caching counted; the bars share one scale across the table. The <b>bar</b> is each build's own pass rule.</p></section>
${changes}
<section><h2>Version record</h2><table class="plain"><thead><tr><th>Build</th><th>Version</th><th>First recorded</th>${s.models.map((m) => `<th>${esc(m)}</th>`).join("")}</tr></thead><tbody>
${versions}
</tbody></table></section>
<footer>Megat Jazly · <a href="https://mjazzly.github.io">mjazzly.github.io</a></footer>
</main></body></html>
`;
}

export function writePages(resultsDir, settings, outDir = HERE) {
  const s = summarise(loadRecords(resultsDir), settings);
  const md = path.join(outDir, "SCORECARD.md"), html = path.join(outDir, "scorecard.html");
  fs.writeFileSync(md, renderMarkdown(s));
  fs.writeFileSync(html, renderHtml(s));
  return [md, html];
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const settings = JSON.parse(fs.readFileSync(path.join(HERE, "settings.json"), "utf8"));
  console.log("page written: " + writePages(path.join(HERE, "results"), settings, HERE).join(", "));
}
