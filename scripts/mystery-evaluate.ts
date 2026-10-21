// npm run mystery:evaluate [-- --data data/mystery]
//
// Evaluates the trained artifact on the session-grouped HOLDOUT (sessions listed in data/mystery/split.json) and
//   • writes the measured metrics into src/mystery/analytics/model/mystery-model.json (`metrics`),
//   • writes data/mystery/evaluation.json (full detail incl. slices),
//   • regenerates docs/MYSTERY_MODEL_REPORT.md from these numbers (nothing is hand-typed).
// Reports: sample counts, base rate, Brier vs base-rate Brier, 10-bin calibration, log loss, AUC, the rule-based
// fallback on the same rows, extraction metrics, ETA MAE vs naive baseline, and per-character / per-Pokémon /
// per-profile / per-factor sanity slices. Simulated bots are not people — the report says so.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { featureInputFromRow, parseCsv, type Row } from '../src/mystery/analytics/dataset.ts';
import { featureVector } from '../src/mystery/analytics/features.ts';
import { brierScore, classifierMetrics, meanAbsoluteError } from '../src/mystery/analytics/metrics.ts';
import { linear, logistic, validateArtifact, type ClassifierMetrics, type ModelArtifact, type RegressionMetrics } from '../src/mystery/analytics/model.ts';
import { ruleDetection } from '../src/mystery/analytics/predictive.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const dataDir = resolve(arg('data', 'data/mystery'));
const MODEL_PATH = resolve('src/mystery/analytics/model/mystery-model.json');
const REPORT_PATH = resolve('docs/MYSTERY_MODEL_REPORT.md');

interface Slice { key: string; rows: number; sessions: number; baseRate: number; meanP: number; brier: number; baselineBrier: number }

const r4 = (x: number) => Math.round(x * 10000) / 10000;

function slices(rows: Row[], p: number[], y: number[], keyOf: (r: Row) => string, trainBase: number): Slice[] {
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), i]));
  return [...groups.entries()].map(([key, idx]) => {
    const ps = idx.map((i) => p[i]);
    const ys = idx.map((i) => y[i]);
    return {
      key, rows: idx.length, sessions: new Set(idx.map((i) => rows[i].session)).size,
      baseRate: r4(ys.reduce((a, b) => a + b, 0) / ys.length), meanP: r4(ps.reduce((a, b) => a + b, 0) / ps.length),
      brier: r4(brierScore(ps, ys)), baselineBrier: r4(brierScore(ps.map(() => trainBase), ys)),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function tercile(rows: Row[], col: keyof Row): (r: Row) => string {
  const vals = [...new Set(rows.map((r) => Number(r[col])))].sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length / 3)];
  const hi = vals[Math.floor((2 * vals.length) / 3)];
  return (r) => {
    const v = Number(r[col]);
    return v < lo ? `low (< ${lo})` : v < hi ? `mid (${lo}–${hi})` : `high (≥ ${hi})`;
  };
}

function table(head: string[], body: (string | number)[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function main(): void {
  const raw = JSON.parse(readFileSync(MODEL_PATH, 'utf8')) as unknown;
  const v = validateArtifact(raw);
  if (!v.ok) throw new Error(`model artifact invalid: ${v.reason} — run npm run mystery:train first`);
  const model: ModelArtifact = v.model;
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as Record<string, unknown> & { profiles: Record<string, number> };
  const split = JSON.parse(readFileSync(join(dataDir, 'split.json'), 'utf8')) as { key: string; testFrac: number; testSessions: string[] };
  const testSet = new Set(split.testSessions);
  const rows = parseCsv(readFileSync(join(dataDir, 'rows.csv'), 'utf8'));
  const train = rows.filter((r) => !testSet.has(r.session));
  const test = rows.filter((r) => testSet.has(r.session));
  const episodes = parseCsv(readFileSync(join(dataDir, 'episodes.csv'), 'utf8')) as unknown as Record<string, string>[];

  // ---- detection
  const detTest = test.filter((r) => r.det15 !== '');
  const detTrain = train.filter((r) => r.det15 !== '');
  const trainBase = detTrain.filter((r) => r.det15 === '1').length / detTrain.length;
  const inputs = detTest.map(featureInputFromRow);
  const p = inputs.map((x) => logistic(model.detection, featureVector(model.detection.features, x)));
  const y = detTest.map((r) => Number(r.det15));
  const detSessions = new Set(detTest.map((r) => r.session)).size;
  const detection = classifierMetrics(p, y, detSessions, trainBase);
  const pRule = inputs.map((x) => ruleDetection(x).p);
  const rule = classifierMetrics(pRule, y, detSessions, trainBase);
  const pTrain = detTrain.map((r) => logistic(model.detection, featureVector(model.detection.features, featureInputFromRow(r))));
  const trainMetrics = classifierMetrics(pTrain, detTrain.map((r) => Number(r.det15)), new Set(detTrain.map((r) => r.session)).size, trainBase);

  // ---- extraction
  let extraction: ClassifierMetrics | null = null;
  if (model.extraction) {
    const exTest = test.filter((r) => r.extraction !== '');
    const exTrain = train.filter((r) => r.extraction !== '');
    const exBase = exTrain.filter((r) => r.extraction === '1').length / exTrain.length;
    const pe = exTest.map((r) => logistic(model.extraction!, featureVector(model.extraction!.features, featureInputFromRow(r))));
    extraction = classifierMetrics(pe, exTest.map((r) => Number(r.extraction)), new Set(exTest.map((r) => r.session)).size, exBase);
  }

  // ---- eta
  let eta: RegressionMetrics | null = null;
  if (model.eta) {
    const etaTest = test.filter((r) => r.eta !== '');
    const pred = etaTest.map((r) => Math.max(0, linear(model.eta!, featureVector(model.eta!.features, featureInputFromRow(r)))));
    const actual = etaTest.map((r) => Number(r.eta));
    const naive = etaTest.map((r) => model.eta!.naive[r.objective] ?? 0);
    eta = {
      rows: etaTest.length, sessions: new Set(etaTest.map((r) => r.session)).size,
      mae: r4(meanAbsoluteError(pred, actual)), naiveMae: r4(meanAbsoluteError(naive, actual)),
      naiveDescription: 'mean seconds-to-next-progress per current objective (training set)',
    };
  }

  // ---- slices (sanity, not tuning targets)
  const byCharacter = slices(detTest, p, y, (r) => r.characterId, trainBase);
  const byPokemon = slices(detTest, p, y, (r) => r.pokemonId, trainBase);
  const byProfile = slices(detTest, p, y, (r) => r.profile, trainBase);
  const byNoise = slices(detTest, p, y, tercile(detTest, 'footstepNoiseMult'), trainBase);
  const byControl = slices(detTest, p, y, (r) => `hydeControl ${r.hydeControl}`, trainBase);
  const byMode = slices(detTest, p, y, (r) => r.hydeMode, trainBase);

  const evaluatedAt = new Date().toISOString();
  const metrics: NonNullable<ModelArtifact['metrics']> = { evaluatedAt, detection, extraction, eta };
  writeFileSync(MODEL_PATH, `${JSON.stringify({ ...model, metrics }, null, 1)}\n`);
  writeFileSync(join(dataDir, 'evaluation.json'), `${JSON.stringify({
    evaluatedAt, modelVersion: model.modelVersion, detection, detectionTrain: trainMetrics, ruleBasedOnHoldout: rule, extraction, eta,
    slices: { byCharacter, byPokemon, byProfile, byFootstepNoise: byNoise, byHydeControl: byControl, byHydeMode: byMode },
  }, null, 1)}\n`);

  // ---- top coefficients
  const coefs = model.detection.features.map((f, i) => ({ f, w: model.detection.coef[i + 1] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 12);

  // ---- episode outcomes
  const outcome = (o: string) => episodes.filter((e) => e.outcome === o).length;
  const testEps = episodes.filter((e) => testSet.has(e.session));
  const sliceTable = (s: Slice[]) => table(['slice', 'rows', 'sessions', 'base rate', 'mean p', 'Brier', 'baseline Brier'],
    s.map((x) => [x.key, x.rows, x.sessions, x.baseRate.toFixed(3), x.meanP.toFixed(3), x.brier.toFixed(4), x.baselineBrier.toFixed(4)]));
  const f4 = (x: number | null) => (x === null ? 'n/a' : x.toFixed(4));

  const md = `# Mystery predictive model — evaluation report

> **Generated by \`npm run mystery:evaluate\` on ${evaluatedAt}.** Do not edit by hand; every number below is computed
> from \`data/mystery/\` and \`src/mystery/analytics/model/mystery-model.json\` (model \`${model.modelVersion}\`).
> **All data are simulated episodes played by scripted bots on the real game simulation — not real players.**

## 1. What is predicted

| Target | Definition | Model |
|---|---|---|
| **Detection within 15 s** (required) | For a 1 Hz snapshot at time *t* in which the Hyde is **not** already chasing: 1 iff a \`hyde_mode\` transition into \`CHASE\` or a \`catch\` event occurs in (t, t + 15 s]. Snapshots during a chase are excluded (detection is already happening; the HUD shows it as "detected now", p = 1). Snapshots of timed-out bots within 15 s of their end are dropped (right-censored). | Logistic regression, L2 (λ = ${model.training.l2}), IRLS — \`src/analytics/regression.ts\` |
| Extraction success (second) | 1 iff the episode ends with the egg delivered at Iago Tower (outcome \`finished\`). Per-row label, constant within a session. | Logistic regression |
| ETA (optional regression) | Seconds from *t* to the next progress event (\`clue_found\`, \`egg_pickup\`, \`egg_delivered\`). | OLS vs a naive per-objective mean |

Features (${model.detection.features.length}) use only information available at *t*: the StateSnapshot (Hyde distance, mode, occlusion,
suspicion, own stance / speed / hidden / recent noise, HP, catches, egg state and security, clue count, objective, room,
F/Q readiness), the previous snapshot's Hyde distance (approach), perceivable context (Hyde facing, fog, nearest hiding
spot, whether the Hyde is stunned / lured / distracted) and the duo's **numbers** (PlayMods, derived card stats, whether
its own F/Q carry control or escape effect kinds). No character or Pokémon id is a feature. Definitions live in
\`src/mystery/analytics/labels.ts\` and \`features.ts\` and are shared by generation, training, evaluation and the live game.

## 2. Data

${table(['item', 'value'], [
    ['generator', String(manifest.generator)],
    ['episodes', String(manifest.episodes)],
    ['duos covered', `${manifest.duos} (all character × Pokémon pairs), ${manifest.perDuo} episodes each`],
    ['seed pattern', `\`${String(manifest.seedPattern)}\``],
    ['outcomes', `finished ${outcome('finished')} · DNF ${outcome('dnf')} · timed out ${outcome('timeout')}`],
    ['snapshot rows', String(manifest.rows)],
    ['detection rows (not chased, not censored)', String(manifest.detectionRows)],
    ['detection positives', String(manifest.detectionPositives)],
    ['profile mix', Object.entries(manifest.profiles).map(([k, n]) => `${k} ${n}`).join(' · ')],
  ])}

Profiles (\`src/mystery/analytics/profiles.ts\`): stealthy, stealthy + abilities, light sprinter (sprint p 0.15–0.4), heavy
sprinter (0.55–0.85), mixed visitor (random crouch / hide / ability habits) and semi-careful; start delay, clue order,
decision rate and accusation policy are seeded per episode.

## 3. Split

${model.training.split}. Train: ${model.training.sessionsTrain} sessions / ${detTrain.length} detection rows. Holdout:
${model.training.sessionsTest} sessions (${testEps.length} episodes) / ${detTest.length} detection rows. No session appears in both.

## 4. Held-out results — detection within 15 s

${table(['metric', 'model', 'base-rate baseline', 'rule-based fallback'], [
    ['rows / sessions', `${detection.rows} / ${detection.sessions}`, '', ''],
    ['positives (base rate)', `${detection.positives} (${detection.baseRate.toFixed(4)})`, `predicts ${detection.trainBaseRate.toFixed(4)} (train rate)`, ''],
    ['Brier score (lower is better)', detection.brier.toFixed(4), detection.baselineBrier.toFixed(4), rule.brier.toFixed(4)],
    ['Brier skill vs baseline', detection.brierSkill.toFixed(4), '0', rule.brierSkill.toFixed(4)],
    ['log loss', detection.logLoss.toFixed(4), detection.baselineLogLoss.toFixed(4), rule.logLoss.toFixed(4)],
    ['ROC AUC', f4(detection.auc), '0.5', f4(rule.auc)],
  ])}

Training-set fit for reference: Brier ${trainMetrics.brier.toFixed(4)} (baseline ${trainMetrics.baselineBrier.toFixed(4)}), AUC ${f4(trainMetrics.auc)}.

### Calibration (10 equal-width bins, holdout)

${table(['bin', 'rows', 'mean predicted', 'observed rate'], detection.calibration.map((c) => [
    `${c.lower.toFixed(1)}–${c.upper.toFixed(1)}`, c.count, c.count ? c.meanPredicted.toFixed(3) : '—', c.count ? c.observedRate.toFixed(3) : '—',
  ]))}

### Largest standardised coefficients (log-odds per 1 SD)

${table(['feature', 'coefficient'], coefs.map((c) => [`\`${c.f}\``, c.w.toFixed(3)]))}

## 5. Extraction success and ETA

${extraction ? table(['metric', 'value'], [
    ['rows / sessions', `${extraction.rows} / ${extraction.sessions}`],
    ['base rate (holdout)', extraction.baseRate.toFixed(4)],
    ['Brier (model / base-rate baseline)', `${extraction.brier.toFixed(4)} / ${extraction.baselineBrier.toFixed(4)}`],
    ['AUC', f4(extraction.auc)],
  ]) : 'Not trained.'}

Extraction outcomes are per session, so its effective sample size is the number of holdout sessions, not rows; with few
DNFs among bots the estimate is weak and is shown only on Laptop 1 as a secondary figure.

${eta ? table(['metric', 'value'], [
    ['rows / sessions', `${eta.rows} / ${eta.sessions}`],
    ['MAE model (s)', eta.mae.toFixed(2)],
    [`MAE naive (${eta.naiveDescription})`, eta.naiveMae.toFixed(2)],
  ]) : 'Not trained.'}

## 6. Sanity slices (holdout, detection)

Slices check that the model behaves sensibly for every character and Pokémon factor; they are not targets and the
model does not use ids. Small slices are noisy.

### By character
${sliceTable(byCharacter)}

### By Pokémon partner
${sliceTable(byPokemon)}

### By behaviour profile
${sliceTable(byProfile)}

### By footstep-noise multiplier (duo factor, terciles)
${sliceTable(byNoise)}

### By Hyde-control card stat (duo factor)
${sliceTable(byControl)}

### By Hyde mode at t
${sliceTable(byMode)}

## 7. Limitations

- **Simulated bots ≠ people.** Episodes come from scripted autopilots (\`src/mystery/bot.ts\`) that read the Hyde's
  position and mode perfectly, react instantly and follow fixed rules. Real visitors hesitate, explore, misread the HUD
  and learn; their detection rates and the relationship between features and detection can differ substantially.
  The metrics above validate the model **on simulated data only**. Live forecasts are stored separately
  (\`mystery_forecasts\`) and compared with live outcomes on Laptop 1 as an observational check.
- The label depends on the current sim tuning (\`mystery-v3.1\`); any tuning change requires
  \`npm run mystery:generate && npm run mystery:train && npm run mystery:evaluate\`.
- Rows within an episode are correlated (1 Hz samples of the same run); the session-grouped split prevents leakage
  between train and test, but row counts overstate the effective sample size.
- Logistic regression is linear in its (engineered) features; interactions beyond those engineered are not modelled.
- The extraction label is constant within a session and bots rarely fail, so its estimate is weak.
- The HUD shows the probability with a band and the label "ML estimate"; if the artifact is missing or invalid it shows
  "Rule-based risk estimate" (formula in \`src/mystery/analytics/predictive.ts\`) and never claims to be trained.

## 8. Reproduce

\`\`\`
npm run mystery:generate   # data/mystery/rows.csv, episodes.csv, manifest.json (gitignored, deterministic)
npm run mystery:train      # src/mystery/analytics/model/mystery-model.json + data/mystery/split.json
npm run mystery:evaluate   # metrics into the artifact, data/mystery/evaluation.json, this report
\`\`\`
`;
  writeFileSync(REPORT_PATH, md);
  console.log(`mystery:evaluate — holdout ${detection.rows} rows / ${detection.sessions} sessions`);
  console.log(`  detection: base rate ${detection.baseRate}, Brier ${detection.brier} vs baseline ${detection.baselineBrier} (rule ${rule.brier}), log loss ${detection.logLoss}, AUC ${detection.auc}`);
  if (extraction) console.log(`  extraction: base rate ${extraction.baseRate}, Brier ${extraction.brier} vs ${extraction.baselineBrier}, AUC ${extraction.auc}`);
  if (eta) console.log(`  eta: MAE ${eta.mae} s vs naive ${eta.naiveMae} s`);
  console.log(`  wrote ${MODEL_PATH} (metrics), ${join(dataDir, 'evaluation.json')}, ${REPORT_PATH}`);
}

main();
