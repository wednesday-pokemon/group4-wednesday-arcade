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
// Overhaul: rows carry hydeEmerged / hydeVisible / emergedAt (public) and EVALUATION-ONLY columns computed here from the
// live posteriors (analytics/bayes.ts on run.investigation()) and the session's hidden truth (run.layout — read ONLY in
// this script, to score calibration): eggPost / eggTrue, cluePost / clueTrue; episodes.csv adds the emergence spawn
// (spawnId, spawnTrue) and the spawn distribution predicted from the last pre-emergence sample (spawnPost).
// Enemy contract (mystery-gen-4): every case has Joseph Crackstone. Rows carry the snapshot's Crackstone columns and the
// evaluation-only crackHere / crackFact (live rule-based forecast at t) + crackSeen10 (label); episodes.csv his counts;
// data/mystery/crackstone.jsonl one line per episode with the cell-level calibration accumulators of the rule-based
// risk vs his TRUE trajectory (scripts/mystery-crackstone.ts — truth read only here, never in the live game).
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
import { episodeRows, ROW_COLUMNS, type ExtraCells } from '../src/mystery/analytics/dataset.ts';
import { clueSitePosterior, eggPosterior } from '../src/mystery/analytics/bayes.ts';
import { spawnProbabilities } from '../src/mystery/analytics/hydeZones.ts';
import { hydeEmergedOf, investigationOf, minSpawnM, worldOf } from '../src/mystery/analytics/publicState.ts';
import type { MysteryRun } from '../src/mystery/run.ts';
import type { SessionLayout } from '../src/mystery/types.ts';
import { profileFor, PROFILE_FAMILIES } from '../src/mystery/analytics/profiles.ts';
import { crackstoneReport } from '../src/mystery/analytics/descriptive.ts';
import { CrackEvalRecorder } from './mystery-crackstone.ts';
import { encounterSpawnsFor } from '../src/mystery/director.ts';
import { EncounterLive } from '../src/mystery/analytics/encounterLive.ts';
import { zoneParamsFrom } from '../src/mystery/analytics/live.ts';
import { BUNDLED_MODEL } from '../src/mystery/analytics/model/index.ts';

const LIVE_ZONE_PARAMS = zoneParamsFrom(BUNDLED_MODEL);

export const GENERATOR_VERSION = 'mystery-gen-5'; // final: mystery-v4 sim (director, Slurp, cabinets, compact maps)

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const perDuo = Number(arg('per-duo', '9'));
const prefix = arg('prefix', 'mys-v3');
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
  'emergedAt', 'spawnId', 'spawnTrue', 'spawnPost',
  'crackEncounters', 'crackEscapes', 'crackScans', 'crackScanHits', 'cursesCast', 'cursesHit', 'cursesDodged', 'crackDeferrals',
] as const;

const r4 = (x: number) => String(Math.round(x * 10000) / 10000);

/**
 * EVALUATION-ONLY: the live posteriors at this sample next to the session's hidden truth (run.layout). These columns are
 * never features and never reach the live game; they only score the Bayesian estimates' calibration.
 */
function evaluationCells(run: MysteryRun): ExtraCells {
  const world = worldOf(run);
  const layout = (run as unknown as { layout?: SessionLayout }).layout; // hidden truth: evaluation only
  if (!world || !layout) return {};
  const inv = investigationOf(run);
  const carried = run.egg.state === 'carried' || run.egg.state === 'delivered';
  const cells: ExtraCells = {};
  if (!carried) {
    cells.eggPost = eggPosterior(world, inv).map((x) => r4(x.p)).join(';');
    cells.eggTrue = String(world.eggSites.findIndex((e) => e.id === layout.eggSiteId));
  }
  const open = world.clueSites.map((g) => !run.cluesFound.includes(g.clueId));
  cells.cluePost = world.clueSites.map((g, i) => (open[i] ? clueSitePosterior(g, inv).map((x) => r4(x.p)).join(';') : '')).join('|');
  cells.clueTrue = world.clueSites.map((g, i) => (open[i] ? String(g.sites.findIndex((x) => x.id === layout.clueSites[g.clueId])) : '')).join('|');
  return cells;
}

function seedOf(j: { duoIndex: number; k: number }): string {
  return `${prefix}-${j.duoIndex}-${j.k}`;
}

function runShard(index: number, count: number): void {
  const mine = jobs.filter((_, n) => n % count === index);
  const rowLines: string[] = [];
  const epLines: string[] = [];
  const crackLines: string[] = [];
  const t0 = Date.now();
  mine.forEach((j, n) => {
    const seed = seedOf(j);
    const duo = pairs[j.duoIndex];
    const { family, options } = profileFor(seed, j.k + j.duoIndex); // families rotate across duos and episodes
    const extra: ExtraCells[] = [];
    const emergedAt: (number | null)[] = [];
    let spawnPost: string[] = [];
    const crack = new CrackEvalRecorder();
    // final: the live rule-based Slurp risk (EncounterLive, exactly the live code) recorded per sample for §11
    let enc: EncounterLive | null = null;
    let seenSeq = 0;
    const ep = simulateEpisode(duo, seed, options, {
      onStep(run) {
        crack.onStep(run);
        // final (director worlds): the EXACT spawn distribution of the Hyde's first appearance, kept at every 60 Hz step
        // until it appears (= what the live odds show; the director draws from the same function one step later)
        if (!run.hydeEmerged && typeof run.encounterDistribution === 'function' && run.director?.dynamic) {
          const d = run.encounterDistribution('hyde');
          if (d.length > 0) spawnPost = d.map((x) => r4(x.p));
        }
      },
      onSample(run) {
        const inv = investigationOf(run);
        emergedAt.push(inv.hydeEmergedAt);
        const cells = evaluationCells(run);
        const ch = crack.onSample(run);
        if (ch) {
          cells.crackHere = r4(ch.here);
          cells.crackFact = ch.fact;
        }
        enc ??= new EncounterLive(run, LIVE_ZONE_PARAMS, null); // the bundled artifact's fitted params = what the live game uses
        for (const e of run.log) if (e.seq > seenSeq) enc.onEvent(e);
        seenSeq = run.log.length ? run.log[run.log.length - 1].seq : seenSeq;
        enc.sample(run);
        const hz = enc.hydeZones(run);
        if (hz) cells.hydeZoneP = hz.map((x) => r4(x)).join(';');
        const sf = enc.slurpForecast(run);
        if (sf) {
          cells.slurpHere = r4(sf.ruleP ?? sf.here.p); // the RULE value (the model's input), never the model's own output
          cells.slurpFact = sf.here.fact ?? '';
        }
        extra.push(cells);
        const world = worldOf(run);
        if (world && !hydeEmergedOf(run, inv) && !run.director?.dynamic) spawnPost = spawnProbabilities(world, run.player, minSpawnM(run)).map((x) => r4(x.p));
      },
    }, { caseDef: CASES[j.caseId] });
    if (ep.run.caseDef.id !== j.caseId) throw new Error(`episode ${seed} played ${ep.run.caseDef.id}, expected ${j.caseId}`);
    const r = episodeRows(ep, { duoIndex: j.duoIndex, profile: family }, duoNumbers(ep.collector.meta.factors), extra, emergedAt);
    const emerged = ep.collector.events.find((e) => e.type === 'hyde_emerged');
    const spawnId = emerged && emerged.type === 'hyde_emerged' ? emerged.spawnId : '';
    const w0 = worldOf(ep.run);
    const spawnList = w0 && ep.run.director?.dynamic ? encounterSpawnsFor(w0, 'hyde') : w0?.hydeSpawns ?? [];
    const spawnTrue = spawnId ? String(spawnList.findIndex((x) => x.id === spawnId)) : '';
    for (const row of r.rows) rowLines.push(row.join(','));
    const ev = ep.collector.events;
    const res = ep.result;
    const ce = crack.finish(seed, j.caseId);
    if (ce) crackLines.push(JSON.stringify(ce));
    const cr = crackstoneReport(ev);
    epLines.push([
      seed, j.duoIndex, duo.characterId, duo.pokemonId, family, j.caseId, ep.run.caseDef.version, res?.outcome ?? 'timeout', res?.catches ?? '',
      ev.filter((e) => e.type === 'hyde_mode' && e.to === 'CHASE').length, ep.collector.latestT(), r.rows.length, r.detectionRows, r.positives,
      res?.verdict ?? '', ep.collector.distanceM ?? '', res ? res.cluesFound.length : '', ep.run.caseDef.clues.length,
      res ? (res.correct ? 1 : 0) : '', res ? (res.deductionCorrect ? 1 : 0) : '', accusationKind({ events: ev, result: res }),
      emerged ? emerged.t : '', spawnId, spawnTrue, spawnId ? spawnPost.join(';') : '',
      cr.encounters, cr.escapes, cr.scans.warned, cr.scans.hit, cr.curses.cast, cr.curses.hit, cr.curses.dodged, cr.deferrals,
    ].join(','));
    if (index === 0 && n % 25 === 0) process.stdout.write(`  shard 0: ${n}/${mine.length} episodes (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  });
  writeFileSync(join(outDir, `.shard-${index}.rows`), rowLines.join('\n'));
  writeFileSync(join(outDir, `.shard-${index}.eps`), epLines.join('\n'));
  writeFileSync(join(outDir, `.shard-${index}.crack`), crackLines.join('\n'));
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
  const crackBySeed = new Map<string, string>();
  for (let i = 0; i < (shards === 1 ? 1 : shards); i++) {
    const rp = join(outDir, `.shard-${i}.rows`);
    const ep = join(outDir, `.shard-${i}.eps`);
    rowsByShard.push(readFileSync(rp, 'utf8').split('\n').filter(Boolean));
    epsByShard.push(readFileSync(ep, 'utf8').split('\n').filter(Boolean));
    rmSync(rp);
    rmSync(ep);
    const cp = join(outDir, `.shard-${i}.crack`);
    if (existsSync(cp)) {
      for (const line of readFileSync(cp, 'utf8').split('\n').filter(Boolean)) crackBySeed.set((JSON.parse(line) as { session: string }).session, line);
      rmSync(cp);
    }
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
  const crackAll = jobs.map((j) => crackBySeed.get(seedOf(j))).filter((x): x is string => typeof x === 'string');
  writeFileSync(join(outDir, 'crackstone.jsonl'), `${crackAll.join('\n')}\n`);
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
    crackstone: {
      episodes: crackAll.length,
      encounters: eps.reduce((a, e) => a + Number(e[col('crackEncounters')] || 0), 0),
      escapes: eps.reduce((a, e) => a + Number(e[col('crackEscapes')] || 0), 0),
      scans: eps.reduce((a, e) => a + Number(e[col('crackScans')] || 0), 0),
      scanHits: eps.reduce((a, e) => a + Number(e[col('crackScanHits')] || 0), 0),
      cursesCast: eps.reduce((a, e) => a + Number(e[col('cursesCast')] || 0), 0),
      cursesHit: eps.reduce((a, e) => a + Number(e[col('cursesHit')] || 0), 0),
      cursesDodged: eps.reduce((a, e) => a + Number(e[col('cursesDodged')] || 0), 0),
      deferrals: eps.reduce((a, e) => a + Number(e[col('crackDeferrals')] || 0), 0),
    },
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
