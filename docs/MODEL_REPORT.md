# Raven Vision Model Report (TRAINED ON SIMULATED DATA)

> All metrics below were produced by `npm run models:train` on synthetic races from the v2.5 rules engine.
> They describe how well the model reproduces the **simulator**, not real-world player outcomes.

* Model version: `raven-vision-v2.5-1` · rules `v2.5` · generated 2026-10-20T19:24:37.446Z
* Dataset: 10000 attempted races (seed prefix `raven-synthetic-v2.5`), **29670 observed leg rows** (early DNF truncates rows; 1199 races ended in DNF)
* Split: race-level 80/20 → 8024 train races / 1976 test races

## Leg time — ordinary least squares
| Metric | Value |
|---|---|
| Test MAE (model) | **3.38 s** |
| Train MAE | 3.28 s |
| Baseline MAE (predict train mean) | 5.55 s |
| Rule-engine expectation MAE | 3.37 s |
| Aspirational target | < 2.50 s → NOT met |

Features: `intercept`, `no_event_time_s`, `crash_p_x_crash_extra_s`, `collect_p_x_5s`, `catch_p_x_catch_extra_s`, `shortcut`, `leg2`, `leg3`, `currents`, `fog`

## Hyde catch — logistic regression
| Metric | Value |
|---|---|
| Test Brier (model) | **0.1072** |
| Train Brier | 0.1025 |
| Baseline Brier (train base rate) | 0.1547 |
| Rule-engine probability Brier | 0.1074 |
| Test catch base rate | 0.1912 |
| Aspirational target | < 0.12 → met |

Features: `intercept`, `rule_expected_catch_p`, `catch_p_no_crash`, `catch_p_with_crash`, `crash_p`, `shortcut`, `gap_start_100m`, `fog`, `leg2`, `leg3`, `prior_catches`

### Calibration (test set)
| Predicted bin | Legs | Mean predicted | Observed rate |
|---|---|---|---|
| 0.00–0.10 | 2580 | 0.0058 | 0.0000 |
| 0.10–0.20 | 979 | 0.1542 | 0.1696 |
| 0.20–0.30 | 897 | 0.2558 | 0.2787 |
| 0.30–0.40 | 445 | 0.3435 | 0.3079 |
| 0.40–0.50 | 425 | 0.4504 | 0.4800 |
| 0.50–0.60 | 82 | 0.5252 | 0.5732 |
| 0.60–0.70 | 286 | 0.6465 | 0.6678 |
| 0.70–0.80 | 109 | 0.7427 | 0.6972 |
| 0.80–0.90 | 14 | 0.8016 | 0.7857 |
| 0.90–1.00 | 37 | 1.0000 | 1.0000 |

## Leakage controls
Features are computed before resolution from route, push, weather, pre-leg state and rule-engine probes with fixed draws; feature names screened for post-event terms; race-level split verified disjoint.

## Interpretation
Leg time is dominated by deterministic rules (route, push, weather, abilities) plus discrete random events (crash +8 s,
Hyde catch +10 s). Any model that only sees pre-decision information cannot know whether those events will happen, so a
residual error remains: the exact rule-engine *expectation* has a test MAE of 3.37 s, which is effectively
the floor for any mean-predicting model on pre-decision features, so the < 2.5 s aspiration is not reachable without
leaking future events (which we refuse to do). The rule-engine expectation is shown alongside so visitors see a transparent, calibrated number.
Models are frozen at build time; there is no live retraining during the exhibit.
