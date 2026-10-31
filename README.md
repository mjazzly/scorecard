# Scorecard, v1.2

[![sweep](https://github.com/mjazzly/scorecard/actions/workflows/sweep.yml/badge.svg?branch=main)](https://github.com/mjazzly/scorecard/actions/workflows/sweep.yml) ![last green run](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmjazzly%2Fscorecard%2Fmain%2Fci%2Flast-green.json)

After any change to a skill, a tool server or a model, someone has to rerun every build's case set on every model, compare the results with the last run, and decide whether the change broke anything and which model is now the cheapest that passes. For four builds that is four commands in four folders and a comparison by eye. This build runs **every build on every model with one command** and keeps **one scorecard**: build by model by version, cases matched, gates held, cost per run, and the change since the last run. It names the smallest model that passes each build. A run whose answer key was reachable by the model is refused and never counted.

It is one harness above four: the [meeting tracker](https://github.com/mjazzly/meeting-tracker-assistant), the [spreadsheet normaliser](https://github.com/mjazzly/spreadsheet-normaliser), [data answers](https://github.com/mjazzly/data-answers) and the [sourced brief](https://github.com/mjazzly/sourced-brief). Each of those already has its own harness, checker, expected results, answers file and prices file. **Nothing inside them is rewritten.** Each gets one small file, `harness.json`, that says where those pieces are and what its pass bar is; the scorecard reads the adapter, copies the build into a fresh folder, runs the build's own harness there, and takes the build's own verdict.

Four gates are enforced in code, so a run cannot be counted by mistake:

1. **The answer key reachable.** Before the model is called, the copy's data folder is scanned for any file that is a copy of a file in the build's expected folder, or a folder or link named `expected`; a hit refuses the run with no model call. After the run the run folder and the transcript are scanned again. A refused run stays on the record, uncounted, with the path that tripped it.
2. **An adapter missing a field or a path.** Refused before any process starts, with the field named.
3. **A checker that returns no verdict.** Counted as a fail, never a pass.
4. **A prices file older than 60 days.** A warning on the record, read from the date in the file's own source line.

The builds' own rule carries over too: a run the build's harness did not count, because it never reached the model or did not finish, is refused with that reason and never compared against.

## Files

| Path | What it is |
|---|---|
| `run.js` | The runner: finds every `harness.json` under the root, copies each build, runs its harness on each model, writes one record per build per model to `results/`, then compares and rebuilds the page. |
| `compare.js` | The comparison: against the previous record for the same build and model, names every case that changed state, every cost that moved by more than the set share, every version move, and the smallest passing model per build. |
| `import.js` | The import: each build's own past blind harness runs brought into `results/`, marked imported, so the version record starts with the history the builds already hold. Manual chat runs, mock runs and one-case runs stay out. |
| `page.js` | The page: `SCORECARD.md` and `scorecard.html` rebuilt from `results/`. One table of builds down and models across; the changes since the last run; the version record. |
| `lib/adapters.js` | Reads and validates the adapters. The required fields are listed at the top. |
| `lib/stage.js` | The staging copy: a build copied file by file into a fresh folder, `node_modules` linked, its key file, git history, results and old runs left behind. Also the planted changes the tests make in a copy. |
| `lib/gates.js` | The answer key scan, before and after the run. |
| `lib/lock.js` | The lock: reads `builds.lock`, names the commit a build folder is at, and refuses a build that is not at its pinned commit. |
| `lib/record.js` | The record: derived from the build's own `result.json`, cost recomputed from the tokens and the build's prices, and checked equal to it. |
| `adapters/` | The four adapters as committed into the four builds. |
| `builds.lock` | The commit of each build that CI runs (below). |
| `ci/checkout.js` | CI: clones each build at its pinned commit beside this folder and installs it. |
| `ci/report.js` | CI: the job summary, and the rule that turns a run red. |
| `ci/last-green.json` | The date of the last green CI run, read by the badge. Written only by the workflow. |
| `.github/workflows/sweep.yml` | The workflow. |
| `settings.json` | The models in a sweep, how many jobs run at once, the cost move share, the prices age. |
| `test/run_cases.js` | The scorecard's own case set (below). `test/RESULTS.md` is its latest record. |
| `results/` | One record per build per model per sweep. The page is built from here and nowhere else. |
| `runs/` | One folder per sweep with the staging copies, the harness logs and the builds' own run folders. Ignored by git. |

## The adapter

```json
{
  "build": "meeting-tracker-server",
  "title": "Meeting tracker",
  "harness": "eval/run_eval.js",
  "server": { "file": "server.js", "data_env": "TRACKER_DATA" },
  "skill": "skill/SKILL.md",
  "data": "data",
  "expected": "eval/expected",
  "answers": "eval/answers.txt",
  "prices": "eval/prices.json",
  "checker": "eval/check.js",
  "runs": "eval/runs",
  "runs_mock": "eval/runs-mock",
  "record": "result.json",
  "gates": { "held": "decline_held", "of": 1 },
  "bar": "four of the five matched and the decline held",
  "max_minutes": 40
}
```

The scorecard reads three numbers the same way for every build. **Matched** is the count of entries in the record's `cases` with `match: true`, over all entries. **Gates held** comes from the two verdict keys named in `gates` (a boolean counts as 1 of 1). **Passed** is the record's own `verdict.passed`. The version is the skill version and the server version from the record. The cost is every token at the price in the build's prices file, caching counted, and must equal the build's own figure.

A build is added by dropping a `harness.json` into its folder. The next sweep picks it up; nothing here changes.

## Run it

Needs Node 20 or later and the four builds installed (`npm install` in each) beside this folder. This folder has no dependencies of its own.

```
node test/run_cases.js        # the scorecard's own case set on the builds' scripted stand-ins; no key, seconds
node run.js --mock            # every build's stand-in through the whole pipeline; records go to results-test/, never the page
node run.js                   # the sweep: every build, every model in settings.json
node run.js --builds sourced-brief --models haiku-5-5
node run.js --locked --smallest   # what CI runs: the builds at their builds.lock commits, the smallest model only
node import.js                # bring the builds' own past runs into results/, marked imported (run once; rerunning rewrites the same files)
node compare.js               # the latest sweep against what came before it
node page.js                  # rebuild the page from results/
```

The sweep needs an Anthropic API key in a file called `.env` in this folder (see `.env.example`). It is passed to each build's harness in the environment and never written into a run folder. Use a dedicated key with a low spend limit and delete it when you are done.

- `--models` takes model tags from `settings.json` (`haiku-5-5`, `opus-5-5-high`).
- `--builds` limits the sweep to the builds named.
- `--parallel` sets how many jobs run at once (default 2).
- `--root` points at another folder of builds.
- `--no-page` leaves the page alone.
- `--locked` runs only the builds in `builds.lock`, and refuses any build whose checkout is not at its pinned commit.
- `--smallest` runs the model ranked first in `settings.json` and no other.

Every record names the commit its build ran at (`commit`), and whether a tracked file in the build differed from it (`dirty`).

A sweep writes `runs/<sweep>/<build>-<model>/` with the staging copy, `harness.log`, and the build's own run folder inside the copy; `results/<sweep>-<build>-<model>.json`; then `SCORECARD.md` and `scorecard.html`.

## In CI

`.github/workflows/sweep.yml` runs the sweep on every push to `main`, every Sunday at 9:17 AM Kuala Lumpur time, and by hand from the Actions tab.

1. **Refuses to start without the key.** The key is the repository secret `ANTHROPIC_API_KEY`, from a Console workspace of its own (`scorecard-ci`) with its own monthly spend limit. No model is called without it.
2. **Checks out the four builds at the commits in `builds.lock`**, beside this folder, and installs each from its own lockfile. A build that is not at its pin is refused on the record, so every run can be repeated exactly.
3. **Runs the scorecard's own case set** (no key, no model), so a broken harness fails before anything is spent.
4. **Sweeps on the smallest model only.** The largest stays a manual run, for cost.
5. **Turns the run red when any case that matched on its build's last record misses now**, or when any job is refused. The job summary names the build, the model and the case, with every build's cases, gates, bar and cost. A build that has not met its bar on the smallest model is shown as such, but does not turn the run red on its own.
6. **On a green run on `main`, commits the records** to `results/` with the page and the badge date, as `[ci] sweep S...`, so the records read the same as a local sweep's. A red run commits nothing, so the next run still compares against the last green one. The run folders are kept as a download on the run for 30 days.

A sweep on the smallest model costs about US$0.15. To move a build to a new commit, change its pin in `builds.lock` and push; that push is the run that tests it.

## The case set (the harness is itself tested)

`node test/run_cases.js` runs every case on the builds' own `--mock` mode (a scripted stand-in: no model, no key) or on fixture records copied from the builds' own results folders, so the set is free and deterministic. Every planted change goes into a staging copy under `runs/test/` and never into a build.

| # | Case | What is planted | Passes when |
|---|---|---|---|
| 1 | Clean sweep | nothing: every build, both models, mock | every record written; matched, gates, passed, calls, tokens and cost in each equal the build's own `result.json` |
| 2a | Planted regression, record | a real tracker record with one case flipped to miss | the comparison names that case, match to miss, and nothing else |
| 2b | Planted regression, live (`--live`, a key, about US$0.05) | a copy of the tracker skill with the owner rule removed, run on the smallest model | at least one of the five cases turns red and is named. The stand-in never reads the skill, so this one needs a model |
| 3 | Planted cost shift | a real tracker record scored under a prices copy with one price doubled | the cost move is named with its share; cases, version and bar unchanged |
| 4 | Answer key in the run folder | a key file copied into the copy's data folder before the run; a second dropped into a finished run folder | refused with no model call; the refusal on the record; the second found by the same scan |
| 5 | Broken adapter | `harness.json` with `checker` removed | refused before any process; the record names `checker` |
| 6 | Identical rerun | one build and model, mock, twice; two real records of one build and model for the cost half | identical case states; cost inside the 30% share |
| A | New version | the copy's skill version line bumped | the build shows the new version and the comparison names the move against the previous one |
| B | New build by adapter alone | a fifth adapter in a scratch root pointing at a copy of a build | five builds on the next sweep; `run.js` unchanged |

## Version log

| Version | Date | What changed | Why |
|---|---|---|---|
| v1.0 | 30 Oct 2026 | First build: adapters, runner, comparison, page, the case set. | The four builds each had a harness; nothing ran them together or compared the runs. |
| v1.0 sweeps 1 and 2 | 30 Oct 2026 | First sweep on claude-haiku-5-5 (S202610301543) and claude-opus-5-5 at high effort (S202610301552), four builds each. Smallest passing model claude-haiku-5-5 on the tracker, the normaliser and data answers; none on the sourced brief, whose v1.2 opus run missed State A on a page identical to its earlier passing run. | The miss traced to the brief's state check comparing claim tables; fixed in sourced brief v1.3. |
| v1.1 | 30 Oct 2026 | `import.js` brings each build's own past blind runs into `results/`, marked imported; the page counts sweeps from the scorecard's own runs only. A run the build's own harness did not count is refused with that reason. | With the history on the record, a change at the same version and model is named against the build's own earlier run. |
| v1.2 | 31 Oct 2026 | Evals in CI: `builds.lock`, `--locked` and `--smallest`, the commit on every record, the workflow, the job summary and the badge. | A change to a build is tested on the push that makes it, and weekly, without a sweep from the Mac. |
