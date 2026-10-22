// npm run mystery:generate [-- --per-duo 9 --prefix mys-v2 --out data/mystery --shards 12]
//
// Generates seeded SIMULATED stealth/mystery episodes (scripted bots — not real players) for ALL 126 duos and ALL THREE
// cases with varied behaviour profiles, and writes:
//   data/mystery/rows.csv       one row per 1 Hz snapshot (raw inputs + labels + case, see src/mystery/analytics/dataset.ts)
//   data/mystery/episodes.csv   one row per episode (duo, case, profile, outcome, accusation outcome, catches, chases, time)
//   data/mystery/manifest.json  counts (per case too), seeds, case assignment, profile mix, generator version
// Case assignment (deterministic, never from the seed's content): episode k of duo d plays
//   CASE_IDS[(d + floor(k / 3)) % 3]
// so every duo plays each case equally often (per-duo 9 → 3 each) AND, because the profile family rotates with
// (d + k) % 6, every (profile family × case) pair is equally frequent — case and behaviour are not confounded
// (the simpler (d + k) % 3 would tie each family to one case).
// Deterministic: (duo, seed, profile, case) → identical episode. Runs in parallel child processes (--shards, default 12).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from '../src/mystery/data/cases.ts';
import { allPairs } from '../src/mystery/draft.ts';
import { CASE_IDS, type CaseId } from '../src/mystery/types.ts';
import { accusationKind } from '../src/mystery/analytics/caseInfo.ts';
import { simulateEpisode } from '../src/mystery/analytics/episodes.ts';
import { duoNumbers } from '../src/mystery/analytics/features.ts';
import { episodeRows, ROW_COLUMNS } from '../src/mystery/analytics/dataset.ts';
import { profileFor, PROFILE_FAMILIES } from '../src/mystery/analytics/profiles.ts';

export const GENERATOR_VERSION = 'mystery-gen-2';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const perDuo = Number(arg('per-duo', '9'));
const prefix = arg('prefix', 'mys-v2');
const outDir = resolve(arg('out', 'data/mystery'));
const shards = Math.max(1, Number(arg('shards', '12')));
const shardArg = arg('shard', '');

const pairs = allPairs();
/** The case episode k of duo d plays (see the header: balanced per duo and per profile family). */
export function caseFor(duoIndex: number, k: number): CaseId {
  return CASE_IDS[(duoIndex + Math.floor(k / 3)) % CASE_IDS.length];
}

const jobs: { duoIndex: number; k: number; caseId: CaseId }[] = [];
for (let i = 0; i < pairs.length; i++) for (let k = 0; k < perDuo; k++) jobs.push({ duoIndex: i, k, caseId: caseFor(i, k) });

export const EPISODE_COLUMNS = [
  'session', 'duoIndex', 'characterId', 'pokemonId', 'profile', 'caseId', 'caseVersion', 'outcome', 'catches', 'chases', 'activeTimeS',
  'rows', 'detectionRows', 'positives', 'verdict', 'distanceM', 'cluesFound', 'clueTotal', 'correct', 'deductionCorrect', 'accusation',
] as const;

function seedOf(j: { duoIndex: number; k: number }): string {
  return `${prefix}-${j.duoIndex}-${j.k}`;
}

function runShard(index: number, count: number): void {
  const mine = jobs.filter((_, n) => n % count === index);
  const rowLines: string[] = [];
  const epLines: string[] = [];
  const t0 = Date.now();
  mine.forEach((j, n) => {
    const seed = seedOf(j);
    const duo = pairs[j.duoIndex];
    const { family, options } = profileFor(seed, j.k + j.duoIndex); // families rotate across duos and episodes
    const ep = simulateEpisode(duo, seed, options, {}, { caseDef: CASES[j.caseId] });
    if (ep.run.caseDef.id !== j.caseId) throw new Error(`episode ${seed} played ${ep.run.caseDef.id}, expected ${j.caseId}`);
    const r = episodeRows(ep, { duoIndex: j.duoIndex, profile: family }, duoNumbers(ep.collector.meta.factors));
    for (const row of r.rows) rowLines.push(row.join(','));
    const ev = ep.collector.events;
    const res = ep.result;
    epLines.push([
      seed, j.duoIndex, duo.characterId, duo.pokemonId, family, j.caseId, ep.run.caseDef.version, res?.outcome ?? 'timeout', res?.catches ?? '',
      ev.filter((e) => e.type === 'hyde_mode' && e.to === 'CHASE').length, ep.collector.latestT(), r.rows.length, r.detectionRows, r.positives,
      res?.verdict ?? '', ep.collector.distanceM ?? '', res ? res.cluesFound.length : '', ep.run.caseDef.clues.length,
      res ? (res.correct ? 1 : 0) : '', res ? (res.deductionCorrect ? 1 : 0) : '', accusationKind({ events: ev, result: res }),
    ].join(','));
    if (index === 0 && n % 25 === 0) process.stdout.write(`  shard 0: ${n}/${mine.length} episodes (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  });
  writeFileSync(join(outDir, `.shard-${index}.rows`), rowLines.join('\n'));
  writeFileSync(join(outDir, `.shard-${index}.eps`), epLines.join('\n'));
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(outDir, '.gitignore'))) writeFileSync(join(outDir, '.gitignore'), '# generated, regenerable: npm run mystery:generate\n*\n!.gitignore\n');
  if (shardArg) {
    const [i, n] = shardArg.split('/').map(Number);
    runShard(i, n);
    return;
  }
  const t0 = Date.now();
  console.log(`mystery:generate — ${jobs.length} episodes (${pairs.length} duos × ${perDuo}), prefix "${prefix}", ${shards} shard(s)`);
  if (shards === 1) runShard(0, 1);
  else {
    const self = fileURLToPath(import.meta.url);
    await Promise.all(Array.from({ length: shards }, (_, i) => new Promise<void>((res, rej) => {
      const child = spawn(process.execPath, [...process.execArgv, self, ...process.argv.slice(2), '--shard', `${i}/${shards}`], { stdio: 'inherit' });
      child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`shard ${i} exited ${code}`))));
    })));
  }
  // merge in job order (deterministic file content regardless of sharding)
  const rowsByShard: string[][] = [];
  const epsByShard: string[][] = [];
  for (let i = 0; i < (shards === 1 ? 1 : shards); i++) {
    const rp = join(outDir, `.shard-${i}.rows`);
    const ep = join(outDir, `.shard-${i}.eps`);
    rowsByShard.push(readFileSync(rp, 'utf8').split('\n').filter(Boolean));
    epsByShard.push(readFileSync(ep, 'utf8').split('\n').filter(Boolean));
    rmSync(rp);
    rmSync(ep);
  }
  // group by session (rows of one episode are already in time order), then emit in job order
  const bySeed = new Map<string, { rows: string[]; ep: string | null }>();
  const key = (line: string) => line.slice(0, line.indexOf(','));
  for (const line of rowsByShard.flat()) {
    const k = key(line);
    const g = bySeed.get(k) ?? { rows: [], ep: null };
    g.rows.push(line);
    bySeed.set(k, g);
  }
  for (const line of epsByShard.flat()) {
    const k = key(line);
    const g = bySeed.get(k) ?? { rows: [], ep: null };
    g.ep = line;
    bySeed.set(k, g);
  }
  const allRows: string[] = [];
  const allEps: string[] = [];
  for (const j of jobs) {
    const g = bySeed.get(seedOf(j));
    if (!g || g.ep === null) throw new Error(`missing episode ${seedOf(j)}`);
    allRows.push(...g.rows);
    allEps.push(g.ep);
  }
  writeFileSync(join(outDir, 'rows.csv'), `${ROW_COLUMNS.join(',')}\n${allRows.join('\n')}\n`);
  writeFileSync(join(outDir, 'episodes.csv'), `${EPISODE_COLUMNS.join(',')}\n${allEps.join('\n')}\n`);
  const eps = allEps.map((l) => l.split(','));
  const col = (name: (typeof EPISODE_COLUMNS)[number]) => EPISODE_COLUMNS.indexOf(name);
  const profiles: Record<string, number> = {};
  for (const f of PROFILE_FAMILIES) profiles[f] = eps.filter((e) => e[col('profile')] === f).length;
  const cases: Record<string, { episodes: number; finished: number; dnf: number; timedOut: number; solved: number; allClues: number; rows: number; profiles: Record<string, number> }> = {};
  for (const id of CASE_IDS) {
    const mine = eps.filter((e) => e[col('caseId')] === id);
    const prof: Record<string, number> = {};
    for (const f of PROFILE_FAMILIES) prof[f] = mine.filter((e) => e[col('profile')] === f).length;
    cases[id] = {
      episodes: mine.length,
      finished: mine.filter((e) => e[col('outcome')] === 'finished').length,
      dnf: mine.filter((e) => e[col('outcome')] === 'dnf').length,
      timedOut: mine.filter((e) => e[col('outcome')] === 'timeout').length,
      solved: mine.filter((e) => e[col('verdict')] === 'case_solved').length,
      allClues: mine.filter((e) => e[col('cluesFound')] !== '' && Number(e[col('cluesFound')]) >= Number(e[col('clueTotal')])).length,
      rows: mine.reduce((s, e) => s + Number(e[col('rows')]), 0),
      profiles: prof,
    };
  }
  const manifest = {
    generator: GENERATOR_VERSION,
    createdAt: new Date().toISOString(),
    note: 'Simulated episodes from scripted bots on the real sim (src/mystery/bot.ts). NOT real players.',
    seedPrefix: prefix,
    seedPattern: `${prefix}-<duoIndex 0..${pairs.length - 1}>-<k 0..${perDuo - 1}>`,
    caseAssignment: 'CASE_IDS[(duoIndex + floor(k / 3)) % 3]',
    duos: pairs.length,
    perDuo,
    episodes: eps.length,
    finished: eps.filter((e) => e[col('outcome')] === 'finished').length,
    dnf: eps.filter((e) => e[col('outcome')] === 'dnf').length,
    timedOut: eps.filter((e) => e[col('outcome')] === 'timeout').length,
    rows: allRows.length,
    detectionRows: eps.reduce((s, e) => s + Number(e[col('detectionRows')]), 0),
    detectionPositives: eps.reduce((s, e) => s + Number(e[col('positives')]), 0),
    profiles,
    cases,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
