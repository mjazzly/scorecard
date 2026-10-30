#!/usr/bin/env node
// The comparison. Against the previous record for the same build and model it names every case that
// changed state, every cost that moved by more than the set share, every version move, and the
// smallest model that passes each build.
//
//   node compare.js                 the latest sweep in results/ against what came before it
//   node compare.js --sweep S2026...  one sweep
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadRecords(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } })
    .filter((r) => r && r.build && r.model_tag)
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0));
}

const same = (a, b) => a.build === b.build && a.model === b.model && (a.effort ?? null) === (b.effort ?? null);

// The previous record: the latest earlier run of the same build on the same model that was not
// refused and holds a verdict. Any version: a version move is one of the changes named.
export function previousOf(all, rec) {
  return all.filter((r) => same(r, rec) && r.started_at < rec.started_at && !r.refused && r.of_cases > 0).at(-1) || null;
}

export function compareRecords(prev, cur, settings) {
  const share = settings.cost_move_share ?? 0.3;
  const out = { build: cur.build, title: cur.title, model_tag: cur.model_tag, sweep: cur.sweep, previous: prev?.sweep ?? null, refused: cur.refused,
    version: { from: prev?.version ?? null, to: cur.version, changed: !!prev && prev.version !== cur.version },
    passed: { from: prev?.passed ?? null, to: cur.passed, changed: !!prev && prev.passed !== cur.passed },
    cases_changed: [], cost: { from: prev?.cost_usd ?? null, to: cur.cost_usd, share: null, moved: false, tolerance: share } };
  if (!prev) return out;
  for (const id of new Set([...Object.keys(prev.cases), ...Object.keys(cur.cases)])) {
    const a = prev.cases[id]?.match ?? null, b = cur.cases[id]?.match ?? null;
    if (a !== b) out.cases_changed.push({ id, name: cur.cases[id]?.name || prev.cases[id]?.name || id, from: a, to: b });
  }
  if (prev.cost_usd != null && cur.cost_usd != null && prev.cost_usd > 0) {
    out.cost.share = (cur.cost_usd - prev.cost_usd) / prev.cost_usd;
    out.cost.moved = Math.abs(out.cost.share) > share;
  }
  return out;
}

// Per build: the latest version on the record and, at that version, the latest counted record per
// model. The scorecard table is built from this, and the smallest passing model is read off it.
export function latest(all) {
  const out = {};
  for (const r of all.filter((x) => x.counted && !x.refused)) {
    const b = out[r.build] || (out[r.build] = { build: r.build, title: r.title, version: null, version_since: null, models: {} });
    if (b.version !== r.version) {
      if (b.version == null || r.started_at > b.version_since) { b.version = r.version; b.version_since = r.started_at; b.models = {}; }
      else continue;
    }
    if (!b.models[r.model_tag] || r.started_at > b.models[r.model_tag].started_at) b.models[r.model_tag] = r;
  }
  return out;
}

export function smallestPassing(all) {
  const out = {};
  for (const [build, b] of Object.entries(latest(all))) {
    const passing = Object.values(b.models).filter((r) => r.passed).sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99) || (x.cost_usd ?? 0) - (y.cost_usd ?? 0));
    out[build] = passing[0] ? { model_tag: passing[0].model_tag, model: passing[0].model, cost_usd: passing[0].cost_usd, version: b.version } : null;
  }
  return out;
}

export function compareSweep(all, sweep, settings) {
  const recs = all.filter((r) => r.sweep === sweep);
  return { sweep, comparisons: recs.map((r) => compareRecords(previousOf(all, r), r, settings)), smallest: smallestPassing(all), refused: recs.filter((r) => r.refused) };
}

const money = (x) => (x == null ? "no cost" : `US$${x.toFixed(3)}`);
const state = (m) => (m === true ? "match" : m === false ? "miss" : "absent");

export function describeChanges(ch) {
  const lines = [`changes since the last run (sweep ${ch.sweep}):`];
  for (const c of ch.comparisons) {
    const head = `  ${c.build} on ${c.model_tag}`;
    if (c.refused) { lines.push(`${head}: refused (${c.refused.gate}: ${c.refused.detail})`); continue; }
    if (!c.previous) { lines.push(`${head}: first record, nothing to compare`); continue; }
    const parts = [];
    if (c.version.changed) parts.push(`version ${c.version.from} to ${c.version.to}`);
    for (const x of c.cases_changed) parts.push(`${x.id} ${state(x.from)} to ${state(x.to)}`);
    if (c.cost.moved) parts.push(`cost ${money(c.cost.from)} to ${money(c.cost.to)} (${c.cost.share > 0 ? "+" : ""}${Math.round(c.cost.share * 100)}%)`);
    if (c.passed.changed) parts.push(`bar ${c.passed.from ? "met" : "not met"} to ${c.passed.to ? "met" : "not met"}`);
    lines.push(`${head}: ${parts.length ? parts.join("; ") : "no change"} (against ${c.previous})`);
  }
  lines.push("smallest passing model:");
  for (const [b, s] of Object.entries(ch.smallest)) lines.push(`  ${b}: ${s ? `${s.model_tag} at ${s.version}, ${money(s.cost_usd)}` : "none on the record"}`);
  return lines.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--sweep");
  const settings = JSON.parse(fs.readFileSync(path.join(HERE, "settings.json"), "utf8"));
  const all = loadRecords(path.join(HERE, argv.includes("--test") ? "results-test" : "results"));
  if (!all.length) { console.log("no records yet"); process.exit(0); }
  const sweep = i >= 0 ? argv[i + 1] : all.at(-1).sweep;
  console.log(describeChanges(compareSweep(all, sweep, settings)));
}
