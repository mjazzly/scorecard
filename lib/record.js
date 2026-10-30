// One scorecard record per build per model per sweep, derived from the build's own harness record
// and checked equal to it. The scorecard adds nothing the build's checker did not say.
import fs from "node:fs";

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// The prices file's source line says when it was read ("read 25 Oct 2026"). That date is the age.
export function pricesInfo(pricesPath, maxAgeDays, now = new Date()) {
  const out = { path: pricesPath, read: null, age_days: null, stale: false, table: null, warning: null };
  try { out.table = JSON.parse(fs.readFileSync(pricesPath, "utf8")); } catch (e) { out.warning = `prices file unreadable: ${e.message}`; return out; }
  const m = /read (\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/.exec(out.table.source || "");
  if (!m) { out.warning = "prices file carries no read date in its source line"; return out; }
  const d = new Date(Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])));
  out.read = d.toISOString().slice(0, 10);
  out.age_days = Math.floor((now - d) / 86400000);
  if (out.age_days > maxAgeDays) { out.stale = true; out.warning = `prices read ${out.read}, ${out.age_days} days ago, older than ${maxAgeDays} days`; }
  return out;
}

// The same formula every build uses: each input token once, at the rate it was charged.
export function costFrom(tokens, prices) {
  if (!tokens || !prices) return null;
  return ((tokens.input || 0) * prices.input + (tokens.cache_write || 0) * prices.cache_write_5m + (tokens.cache_read || 0) * prices.cache_read + (tokens.output || 0) * prices.output) / 1e6;
}

export function modelTag(model) { return `${model.id.replace(/^claude-/, "")}${model.effort ? "-" + model.effort : ""}`; }

// harness: the build's result.json, parsed (or null when none was written).
export function deriveRecord({ sweep, adapter, model, mode, started_at, harness, harness_path, prices, refused = null, warnings = [], timing = {} }) {
  // The builds' own rule carries over: a run the build's harness did not count (it never reached the
  // model, or did not finish) is not a test result. It stays on the record as refused, with the reason.
  if (!refused && (mode === "harness" || mode === "imported") && harness && !harness.counted) {
    const reached = (harness.total_input || 0) + (harness.tokens?.output || 0) > 0;
    refused = { gate: reached ? "run did not finish" : "run never reached the model", detail: harness.error || harness.note || "no tokens were used" };
  }
  const v = harness?.verdict || null;
  const cases = {};
  for (const [id, c] of Object.entries(harness?.cases || {})) cases[id] = { match: c.match === true, name: c.name || c.transcript || id };
  const ids = Object.keys(cases);
  const matched = ids.filter((id) => cases[id].match).length;
  const held = v ? v[adapter.gates.held] : null;
  const gatesHeld = held == null ? null : typeof held === "boolean" ? (held ? 1 : 0) : Number(held);
  const gatesOf = typeof adapter.gates.of === "number" ? adapter.gates.of : v ? v[adapter.gates.of] ?? null : null;
  const noVerdict = !v || typeof v.passed !== "boolean";
  if (noVerdict && !refused) warnings = [...warnings, harness ? "checker returned no verdict: counted as a fail" : "no harness record was written: counted as a fail"];
  const tokens = harness?.tokens || null;
  // Priced for the model the harness says it ran (a mock run names no model and so has no cost).
  const cost = costFrom(tokens, prices?.table?.[harness?.model ?? model.id]);
  const harnessCost = harness?.cost_usd ?? null;
  if (cost != null && harnessCost != null && Math.abs(cost - harnessCost) > 1e-9) warnings = [...warnings, `cost recomputed (US$${cost.toFixed(4)}) differs from the harness figure (US$${harnessCost.toFixed(4)})`];
  if (prices?.warning) warnings = [...warnings, prices.warning];
  const version = harness ? `${harness.skill_version || "unknown"} / ${harness.server_version || "unknown"}` : null;
  // A sweep record and an imported one (a blind run of the build's own harness, read from its results
  // folder) are both counted; a mock or test record never is.
  const counted = !refused && (mode === "harness" || mode === "imported") && !!harness?.counted && !noVerdict;
  return {
    sweep, build: adapter.build, title: adapter.title, version, skill_version: harness?.skill_version ?? null, server_version: harness?.server_version ?? null,
    model: model.id, effort: model.effort ?? null, model_tag: modelTag(model), rank: model.rank,
    date: started_at.slice(0, 10), started_at, mode, counted, refused,
    cases, matched, of_cases: ids.length, gates_held: gatesHeld, of_gates: gatesOf,
    passed: refused ? false : noVerdict ? false : v.passed, no_verdict: noVerdict, bar: adapter.bar,
    model_calls: harness?.model_calls ?? null, tokens, cost_usd: cost, harness_cost_usd: harnessCost,
    prices_read: prices?.read ?? null, prices_age_days: prices?.age_days ?? null,
    minutes: timing.minutes ?? null, warnings, harness_record: harness_path, harness_verdict: v,
  };
}

// Case 1's test: every number on the scorecard record equals the build's own record.
export function equalsHarness(record, harness) {
  const diffs = [];
  const hc = harness?.cases || {};
  const hm = Object.values(hc).filter((c) => c.match === true).length;
  if (record.matched !== hm) diffs.push(`matched ${record.matched} vs harness ${hm}`);
  if (record.of_cases !== Object.keys(hc).length) diffs.push(`of_cases ${record.of_cases} vs harness ${Object.keys(hc).length}`);
  if (record.passed !== (harness?.verdict?.passed === true)) diffs.push(`passed ${record.passed} vs harness ${harness?.verdict?.passed}`);
  if (record.model_calls !== (harness?.model_calls ?? null)) diffs.push(`model_calls ${record.model_calls} vs harness ${harness?.model_calls}`);
  if (JSON.stringify(record.tokens) !== JSON.stringify(harness?.tokens ?? null)) diffs.push("tokens differ");
  const hcost = harness?.cost_usd ?? null;
  if ((record.cost_usd == null) !== (hcost == null) || (hcost != null && Math.abs(record.cost_usd - hcost) > 1e-9)) diffs.push(`cost ${record.cost_usd} vs harness ${hcost}`);
  for (const [id, c] of Object.entries(hc)) if (record.cases[id]?.match !== (c.match === true)) diffs.push(`case ${id} ${record.cases[id]?.match} vs harness ${c.match}`);
  return diffs;
}
