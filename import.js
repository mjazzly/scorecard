#!/usr/bin/env node
// The import. Brings each build's own past runs into results/, so the version record starts with
// the history the builds already hold. Only blind runs of the build's own harness on a model in
// settings.json are imported; manual chat runs, mock runs and one-case runs stay out. Each record is
// marked imported, derived exactly as a sweep record is, and points at the file it came from.
// Running it again rewrites the same files.
//
//   node import.js            every build under the root
//   node import.js --builds sourced-brief
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAdapters } from "./lib/adapters.js";
import { deriveRecord, pricesInfo, modelTag } from "./lib/record.js";
import { writePages } from "./page.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const settings = JSON.parse(fs.readFileSync(path.join(HERE, "settings.json"), "utf8"));
const root = path.resolve(HERE, arg("root") || settings.root || "..");
const builds = arg("builds") ? arg("builds").split(",").map((s) => s.trim()) : null;
const resultsDir = path.join(HERE, "results");
fs.mkdirSync(resultsDir, { recursive: true });

// A run the scorecard made and a build later copied into its own results folder is already on the
// record under its sweep; its label is "<sweep>-<model tag>".
const swept = new Set(fs.readdirSync(resultsDir).filter((f) => f.startsWith("S") && f.endsWith(".json"))
  .map((f) => { try { const r = JSON.parse(fs.readFileSync(path.join(resultsDir, f), "utf8")); return `${r.build}|${r.sweep}-${r.model_tag}`; } catch { return null; } }));
let imported = 0;
for (const e of findAdapters(root).filter((x) => !builds || builds.includes(x.name))) {
  if (e.error) { console.log(`${e.name}: skipped (${e.error})`); continue; }
  const dir = path.join(e.dir, "eval", "results");
  if (!fs.existsSync(dir)) { console.log(`${e.name}: no results folder`); continue; }
  const prices = pricesInfo(path.join(e.dir, e.adapter.prices), settings.prices_max_age_days);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    let h;
    try { h = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { console.log(`  ${e.name} ${f}: unreadable, skipped`); continue; }
    const model = settings.models.find((m) => m.id === h.model && (m.effort ?? null) === (h.effort ?? null));
    const why = swept.has(`${e.name}|${h.label}`) ? `already on the record from sweep ${String(h.label).split("-")[0]}` : h.mode !== "harness" ? `${h.mode || "no mode"} run` : h.blind !== true ? "not blind" : !h.tokens ? "no token record" : !model ? `model ${h.model}${h.effort ? " " + h.effort : ""} not in settings.json` : null;
    if (why) { console.log(`  ${e.name} ${f}: skipped (${why})`); continue; }
    const sweep = `I${String(h.started_at).slice(0, 16).replace(/[-:T]/g, "")}`;
    const rec = deriveRecord({ sweep, adapter: e.adapter, model, mode: "imported", started_at: h.started_at, harness: h, harness_path: path.relative(HERE, path.join(dir, f)), prices });
    fs.writeFileSync(path.join(resultsDir, `${sweep}-${e.name}-${modelTag(model)}.json`), JSON.stringify(rec, null, 2));
    imported++;
    console.log(`  ${e.name} ${f}: imported as ${sweep}, ${rec.version}, ${rec.matched} of ${rec.of_cases}, ${rec.passed ? "bar met" : "bar not met"}${rec.refused ? ", refused: " + rec.refused.detail : ""}`);
  }
}
console.log(`${imported} runs imported`);
console.log("page written: " + writePages(resultsDir, settings, HERE).join(", "));
