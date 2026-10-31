// The lock: builds.lock pins each build to one commit, so a locked sweep (the one CI runs) is
// reproducible. A locked sweep refuses any build whose checkout is not at its pinned commit, any
// build found under the root that the lock does not name, and names every pinned build it cannot find.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function readLock(dir) {
  const file = path.join(dir, "builds.lock");
  if (!fs.existsSync(file)) throw new Error(`no builds.lock in ${dir}`);
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!lock.builds || typeof lock.builds !== "object") throw new Error("builds.lock has no builds");
  for (const [name, b] of Object.entries(lock.builds)) {
    if (!b.repo || !/^[0-9a-f]{40}$/.test(b.commit || "")) throw new Error(`builds.lock: ${name} needs a repo and a full 40 character commit`);
  }
  return lock;
}

// The commit a build folder is checked out at, and whether a tracked file differs from it.
// Null when the folder is not a git checkout (the test scratch copies are not).
export function commitOf(dir) {
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try { return { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--untracked-files=no") !== "" }; }
  catch { return { commit: null, dirty: null }; }
}

// Marks each found entry against the lock (entry.error, entry.gate) and adds an entry for every
// pinned build that was not found, so each one is refused on the record by name.
export function applyLock(entries, lock) {
  const out = entries.map((e) => {
    const pin = lock.builds[e.name];
    if (e.error) return e;
    if (!pin) return { ...e, gate: "lock", error: `${e.name} is not in builds.lock` };
    const { commit } = commitOf(e.dir);
    if (commit !== pin.commit) return { ...e, gate: "lock", error: `builds.lock pins ${pin.commit.slice(0, 7)}, the checkout is at ${commit ? commit.slice(0, 7) : "no commit"}` };
    return e;
  });
  for (const name of Object.keys(lock.builds)) {
    if (!out.some((e) => e.name === name)) out.push({ name, dir: null, adapter: null, gate: "lock", error: `${name} is in builds.lock but not under the root` });
  }
  return out;
}
