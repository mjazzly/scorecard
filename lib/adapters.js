// Adapters: one harness.json per build, found by scanning a root folder. Nothing in a build is read
// until its adapter has every field and every path it names exists.
import fs from "node:fs";
import path from "node:path";

export const REQUIRED = ["build", "title", "harness", "server", "skill", "data", "expected", "answers", "prices", "checker", "runs", "runs_mock", "record", "gates", "bar", "max_minutes"];
const PATHS = ["harness", "skill", "data", "expected", "answers", "prices", "checker"];

// Every immediate subfolder of root that holds a harness.json. Symlinks are followed, so a scratch
// root of links to real builds works the same as the real root.
export function findAdapters(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    let real;
    try { real = fs.realpathSync(dir); } catch { continue; }
    if (!fs.statSync(real).isDirectory()) continue;
    const file = path.join(real, "harness.json");
    if (!fs.existsSync(file)) continue;
    out.push(loadAdapter(real, file));
  }
  return out;
}

export function loadAdapter(dir, file = path.join(dir, "harness.json")) {
  let adapter = null, error = null;
  try { adapter = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { error = `adapter unreadable: ${e.message}`; }
  if (adapter && !error) error = validate(adapter, dir);
  return { dir, file, adapter, error, name: adapter?.build || path.basename(dir) };
}

// The error names the field, so a refusal on the record says what to fix.
export function validate(a, dir) {
  for (const f of REQUIRED) if (a[f] == null || a[f] === "") return `adapter field missing: ${f}`;
  if (typeof a.server !== "object" || !a.server.file || !a.server.data_env) return "adapter field missing: server.file and server.data_env";
  if (typeof a.gates !== "object" || !a.gates.held || a.gates.of == null) return "adapter field missing: gates.held and gates.of";
  if (!(Number(a.max_minutes) > 0)) return "adapter field invalid: max_minutes";
  for (const f of [...PATHS, ["server", "file"]]) {
    const rel = Array.isArray(f) ? a.server.file : a[f];
    if (!fs.existsSync(path.join(dir, rel))) return `adapter path not found: ${Array.isArray(f) ? "server.file" : f} (${rel})`;
  }
  return null;
}
