# Scorecard case set, run 2026-10-30 09:03 UTC

9 of 9 passed. Builds under the root: data-answers, meeting-tracker-server, sourced-brief, spreadsheet-normaliser. Case 2b ran live.

| Case | Result | Detail | Seconds |
|---|---|---|---|
| 1. Clean sweep | pass | 8 of 8 records written; every number equals the build's own record | 2 |
| 2a. Planted regression (record) | pass | named: 03_northgate_claims.txt match to miss; cost moved false; version changed false | 0 |
| 2b. Planted regression (live, owner rule removed) | pass | 6 of 8; turned red: 04_halden_finance.txt; cost 0.017 | 74.4 |
| 3. Planted cost shift | pass | cost US$0.480 to US$0.704 (+46%, moved true); cases changed 0; version changed false; bar changed false | 0 |
| 4. Answer key in the run folder | pass | before the run: refused (data/01_halden_kickoff.json is a copy of a file in the answer key; no model call was made), harness started: false, on the record: true; after the run: data/01_halden_kickoff.json is a copy of a file in the answer key | 0.2 |
| 5. Broken adapter | pass | refused (adapter field missing: checker); process started: false | 0 |
| 6. Identical rerun | pass | mock rerun: 8 of 8 both times, cases changed 0; real pair: US$0.037 and US$0.039 (5%, tolerance 30%) | 0.3 |
| A. New version | pass | version v2.0 / 2.1.0 to v2.1 / 2.1.0, named against S6b; cases changed 0 | 0.2 |
| B. New build by adapter alone | pass | 5 builds found (4 before); fifth-build 8 of 8, bar met; run.js untouched | 0.5 |
