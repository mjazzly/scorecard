# Scorecard

Rebuilt from `results/` on 2026-10-31. **4 builds**, **36 counted runs** (17 imported from the builds' own records) and **5 sweeps**. A full sweep on the smallest passing models costs **US$1.756**.

## Builds by model

| Build | Version | haiku-5-5 | opus-5-5-high |
|---|---|---|---|
| Meeting tracker | v2.0 / 2.1.0 | 8 of 8 cases, gates 1 of 1, US$0.021, bar met (smallest passing) | 8 of 8 cases, gates 1 of 1, US$0.507, bar met |
| Spreadsheet normaliser | v1.0 / 1.0.0 | 8 of 8 cases, gates 1 of 1, US$0.029, bar met (smallest passing) | 8 of 8 cases, gates 1 of 1, US$0.891, bar met |
| Data answers | v1.1 / 1.1.0 | 28 of 28 cases, gates 6 of 6, US$0.040, bar met (smallest passing) | 28 of 28 cases, gates 6 of 6, US$1.512, bar met |
| Sourced brief | v1.3 / 1.3.0 | 7 of 8 cases, gates 4 of 4, US$0.066, bar not met | 8 of 8 cases, gates 4 of 4, US$1.667, bar met (smallest passing) |

Cases: the build's own case set, matched by the build's own checker. Gates: the stop and decline cases in that set. Cost: every token at the price in the build's prices file, caching counted. The bar is each build's own pass rule.

## Changes since the last run (sweep S202610312155)

| Build | Model | Against | Version | Cases changed | Cost | Bar |
|---|---|---|---|---|---|---|
| Data answers | haiku-5-5 | S202610312124 | v1.1 / 1.1.0 | none | US$0.041 to US$0.040 (-3%) | met |
| Meeting tracker | haiku-5-5 | S202610312124 | v2.0 / 2.1.0 | 03_northgate_claims.txt miss to match | US$0.018 to US$0.021 (+14%) | met |
| Sourced brief | haiku-5-5 | S202610312124r | v1.3 / 1.3.0 | 03_change match to miss; state_b miss to match | US$0.063 to US$0.066 (+4%) | not met |
| Spreadsheet normaliser | haiku-5-5 | S202610312124 | v1.0 / 1.0.0 | none | US$0.032 to US$0.029 (-10%) | met |

A cost that moved by more than 30% against the previous record is marked moved.

## Version record

| Build | Version | First recorded | haiku-5-5 | opus-5-5-high |
|---|---|---|---|---|
| Meeting tracker | v2.0 / 2.0.0 | 2026-10-24 | 7 of 8, met | 8 of 8, met |
| Meeting tracker | v2.0 / 2.1.0 | 2026-10-30 | 8 of 8, met | 8 of 8, met |
| Spreadsheet normaliser | v1.0 / 1.0.0 | 2026-10-30 | 8 of 8, met | 8 of 8, met |
| Data answers | v1.0 / 1.0.0 | 2026-10-30 | 27 of 28, not met |  |
| Data answers | v1.1 / 1.1.0 | 2026-10-30 | 28 of 28, met | 28 of 28, met |
| Sourced brief | v1.0 / 1.0.0 | 2026-10-30 | 0 of 8, not met | 0 of 8, not met |
| Sourced brief | v1.1 / 1.1.0 | 2026-10-30 | 5 of 8, not met | 5 of 8, not met |
| Sourced brief | v1.2 / 1.2.0 | 2026-10-30 | 6 of 8, not met | 7 of 8, not met |
| Sourced brief | v1.3 / 1.3.0 | 2026-10-30 | 7 of 8, not met | 8 of 8, met |
