// The staging copy. A build never runs in its own folder: the scorecard copies it into a fresh
// folder per run, links node_modules, and runs the build's own harness there. Its results folder,
// run folders, key file and git history stay behind.
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);
const SKIP_FILES = new Set([".env", ".DS_Store"]);
const SKIP_EVAL = new Set(["runs", "runs-mock", "results"]);

// File by file, like the builds' own harnesses: some shared folders list a file they then refuse
// to open, and one such file must not stop the copy. Every skipped file is returned.
export function stageCopy(srcDir, destDir, skipped = []) {
  const src = fs.realpathSync(srcDir);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = rel ? path.join(rel, e.name) : e.name, parts = r.split(path.sep);
      if (SKIP_DIRS.has(parts[0])) continue;
      if (parts[0] === "eval" && parts.length >= 2 && SKIP_EVAL.has(parts[1])) continue;
      if (SKIP_FILES.has(e.name) || e.name.endsWith(".pdf") || e.name.endsWith(".tar.gz")) continue;
      if (e.isDirectory()) { fs.mkdirSync(path.join(destDir, r), { recursive: true }); walk(r); }
      else if (e.isFile()) { try { fs.copyFileSync(path.join(src, r), path.join(destDir, r)); } catch (err) { skipped.push(`${r} (${err.code || err.message})`); } }
    }
  };
  walk("");
  const nm = path.join(src, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(destDir, "node_modules"), "dir");
  fs.mkdirSync(path.join(destDir, "eval", "results"), { recursive: true });
  return destDir;
}

// Overlays are how a test plants a change in the copy and never in the build: a skill with a rule
// removed, a prices file with a price doubled, a version line bumped, a file dropped into data/.
// Each overlay is { path, content } or { path, from } (a file to copy in) or { path, edit: fn }.
export function applyOverlays(destDir, overlays = []) {
  for (const o of overlays) {
    const target = path.join(destDir, o.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (o.from) fs.copyFileSync(o.from, target);
    else if (o.edit) fs.writeFileSync(target, o.edit(fs.readFileSync(target, "utf8")));
    else fs.writeFileSync(target, o.content);
  }
}
