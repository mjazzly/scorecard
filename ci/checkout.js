#!/usr/bin/env node
// CI step: clones each build in builds.lock beside the scorecard, at its pinned commit, and installs
// its dependencies from its own lockfile. Every build's repo is public, so no token is used.
//
//   node ci/checkout.js              into the scorecard's parent folder (the root a sweep reads)
//   node ci/checkout.js --root DIR
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readLock, commitOf } from "../lib/lock.js";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const i = argv.indexOf("--root");
const root = path.resolve(i >= 0 ? argv[i + 1] : path.join(HERE, ".."));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

const lock = readLock(HERE);
for (const [name, pin] of Object.entries(lock.builds)) {
  const dir = path.join(root, pin.repo.split("/")[1]);
  if (path.resolve(dir) === HERE) throw new Error(`${name}: its folder would be the scorecard's own`);
  console.log(`\n${name}: ${pin.repo} at ${pin.commit}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  run("git", ["init", "-q"], dir);
  run("git", ["remote", "add", "origin", `https://github.com/${pin.repo}.git`], dir);
  run("git", ["fetch", "-q", "--depth", "1", "origin", pin.commit], dir);
  run("git", ["checkout", "-q", "--detach", "FETCH_HEAD"], dir);
  const at = commitOf(dir).commit;
  if (at !== pin.commit) throw new Error(`${name}: checked out ${at}, builds.lock pins ${pin.commit}`);
  run("npm", ["ci", "--no-audit", "--no-fund"], dir);
}
console.log(`\n${Object.keys(lock.builds).length} builds checked out under ${root}`);
