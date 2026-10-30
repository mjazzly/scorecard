// The blind gate. The lesson of the tracker's first run: the answer key was shipped inside the
// folder the model worked on, the model read it, and the run could not be counted. Here the check
// is in code, before the model is called and again after it has finished.
import fs from "node:fs";
import path from "node:path";

// Every file under the expected folder, by name, with its bytes. A copy of the key is recognised
// wherever it lands by name and content together: a build may write a file that shares a key
// file's name (the normaliser holds rows in data/held/04_date.json, named after its input), and
// a correct output may equal a key file byte for byte under another name; neither is the key.
export function keyNames(expectedDir) {
  const names = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : names.set(e.name, fs.readFileSync(path.join(d, e.name))); };
  if (fs.existsSync(expectedDir)) walk(expectedDir);
  return names;
}

// Hits: a file with a key file's name and content, a folder named "expected", or a link that
// resolves inside the expected folder. Returned as paths relative to the folder scanned.
export function scanForKey(folder, expectedDir, names = keyNames(expectedDir)) {
  const hits = [];
  if (!fs.existsSync(folder)) return hits;
  const expectedReal = fs.existsSync(expectedDir) ? fs.realpathSync(expectedDir) : null;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), rel = path.relative(folder, p);
      if (e.isSymbolicLink()) {
        let target = null;
        try { target = fs.realpathSync(p); } catch {}
        if (target && expectedReal && (target === expectedReal || target.startsWith(expectedReal + path.sep))) hits.push(`${rel} links to the answer key`);
        else if (e.name === "expected") hits.push(`${rel} is a link named expected`);
        continue;
      }
      if (e.isDirectory()) {
        if (e.name === "expected") hits.push(`${rel}/ is a folder named expected`);
        walk(p);
      } else if (names.has(e.name)) {
        let same = false;
        try { same = names.get(e.name).equals(fs.readFileSync(p)); } catch {}
        if (same) hits.push(`${rel} is a copy of a file in the answer key`);
      }
    }
  };
  walk(folder);
  return hits;
}

// After the run: did any tool call name a key file? The transcript records every call's input.
export function transcriptReads(transcriptPath, names) {
  const hits = [];
  if (!fs.existsSync(transcriptPath)) return hits;
  let t;
  try { t = JSON.parse(fs.readFileSync(transcriptPath, "utf8")); } catch { return hits; }
  for (const entry of t.transcript || []) {
    if (entry.who !== "tool") continue;
    const text = JSON.stringify(entry.input || {});
    for (const n of names.keys()) if (text.includes(n)) hits.push(`tool call ${entry.name} named ${n}`);
  }
  return hits;
}
