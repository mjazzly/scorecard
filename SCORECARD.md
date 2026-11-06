# Scorecard

Rebuilt from `results/` on 2026-11-06. **5 builds**, **63 counted runs** (25 imported from the builds' own records) and **10 sweeps**. A full sweep on the smallest passing models costs **US$2.208**.

## Builds by model

| Build | Version | haiku-5-5 | opus-5-5-high |
|---|---|---|---|
| Meeting tracker | v2.2 / 2.2.0 | no counted run | 8 of 8 cases, gates 1 of 1, US$0.471, bar met (smallest passing) |
| Spreadsheet normaliser | v1.0 / 1.0.0 | 8 of 8 cases, gates 1 of 1, US$0.029, bar met (smallest passing) | 8 of 8 cases, gates 1 of 1, US$0.891, bar met |
| Data answers | v1.1 / 1.1.0 | 28 of 28 cases, gates 6 of 6, US$0.041, bar met (smallest passing) | 28 of 28 cases, gates 6 of 6, US$1.512, bar met |
| Sourced brief | v1.3 / 1.3.0 | 5 of 8 cases, gates 4 of 4, US$0.063, bar not met | 8 of 8 cases, gates 4 of 4, US$1.667, bar met (smallest passing) |
| Contact pipeline | v1.1 / 1.1.0 | 43 of 43 cases, gates 3 of 3, US$0.001, bar met (smallest passing) | 43 of 43 cases, gates 3 of 3, US$0.036, bar met |

Cases: the build's own case set, matched by the build's own checker. Gates: the stop and decline cases in that set. Cost: every token at the price in the build's prices file, caching counted. The bar is each build's own pass rule.

## Changes since the last run (sweep S202611061703)

| Build | Model | Against | Version | Cases changed | Cost | Bar |
|---|---|---|---|---|---|---|
| Meeting tracker | opus-5-5-high | S202610301552 | v2.0 / 2.1.0 to v2.2 / 2.2.0 | none | US$0.507 to US$0.471 (-7%) | met |

A cost that moved by more than 30% against the previous record is marked moved.

## Version record

| Build | Version | First recorded | haiku-5-5 | opus-5-5-high |
|---|---|---|---|---|
| Meeting tracker | v2.0 / 2.0.0 | 2026-10-24 | 7 of 8, met | 8 of 8, met |
| Meeting tracker | v2.0 / 2.1.0 | 2026-10-30 | 7 of 8, met | 8 of 8, met |
| Meeting tracker | v2.2 / 2.2.0 | 2026-11-06 |  | 8 of 8, met |
| Spreadsheet normaliser | v1.0 / 1.0.0 | 2026-10-30 | 8 of 8, met | 8 of 8, met |
| Data answers | v1.0 / 1.0.0 | 2026-10-30 | 27 of 28, not met |  |
| Data answers | v1.1 / 1.1.0 | 2026-10-30 | 28 of 28, met | 28 of 28, met |
| Sourced brief | v1.0 / 1.0.0 | 2026-10-30 | 0 of 8, not met | 0 of 8, not met |
| Sourced brief | v1.1 / 1.1.0 | 2026-10-30 | 5 of 8, not met | 5 of 8, not met |
| Sourced brief | v1.2 / 1.2.0 | 2026-10-30 | 6 of 8, not met | 7 of 8, not met |
| Sourced brief | v1.3 / 1.3.0 | 2026-10-30 | 5 of 8, not met | 8 of 8, met |
| Contact pipeline | v1.0 / 1.0.0 | 2026-11-03 | 40 of 42, not met | 42 of 42, met |
| Contact pipeline | v1.1 / 1.1.0 | 2026-11-03 | 43 of 43, met | 43 of 43, met |
