// DescriptiveService — "What happened?". Exact counts from the immutable event log (+ 1 Hz samples for the initial
// stance and the per-frame distance when tracked). One session → SessionReport; many sessions → the Laptop 1 aggregate,
// per case and combined. Clue statistics are always computed WITHIN a case (each case has its own clue set), so mixing
// records of different cases never mixes their clues.
// Joseph Crackstone (enemy contract): SessionReport.crackstone (encounters by via, detections by via, escapes by reason,
// scans warned / passed / hit, curses cast / hit / blocked / dodged) and the aggregate's Crackstone block + the board KPI
// fields cursesCast / cursesHit / cursesDodgedPct ("Curses dodged %" = misses / casts; null at n = 0; small sample < 10).
import { caseWorld } from '../data/caseWorlds.ts';
import type { CaseId, Duo, HydeMode, NoiseSource, RunResult, Stance, StampedEvent, Verdict } from '../types.ts';
import { CASE_IDS } from '../types.ts';
import { accusationKind, caseInfo, clueCountFor, isCaseId, lastAccusation, LEGACY_CLUE_COUNT, recordCaseId } from './caseInfo.ts';
import type { TelemetryCollector } from './telemetry.ts';
import type { AbilityUse, AccusationKind, CrackstoneReport, DuoFactors, SessionRecord, SessionReport, StanceTimes } from './types.ts';

export const NOISE_SOURCES: readonly NoiseSource[] = ['footstep', 'egg_drop', 'ability', 'interact', 'impact', 'decoy', 'hazard'];
export const HYDE_MODES: readonly HydeMode[] = ['PATROL', 'INVESTIGATE_SOUND', 'SEARCH', 'CHASE', 'COOLDOWN'];
export const ALERT_MODES: readonly HydeMode[] = ['INVESTIGATE_SOUND', 'SEARCH', 'CHASE'];
const STANCES: readonly Stance[] = ['idle', 'walk', 'crouch', 'sprint'];

export interface DescribeInput {
  duo: Duo;
  events: readonly StampedEvent[];
  initialStance?: Stance;
  /** Active seconds at the end of the observed run (defaults to result / last event). */
  endT?: number;
  distanceM?: number | null;
  result?: RunResult | null;
  factors?: DuoFactors | null;
  /** The case played (clue count, titles of the missing clues). Null / absent = legacy (3 clues, no titles). */
  caseId?: CaseId | null;
  caseVersion?: number | null;
}

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  const o = {} as Record<K, number>;
  for (const k of keys) o[k] = 0;
  return o;
}

/** Seconds spent in each stance between 0 and endT, from `stance` change events. */
export function stanceSeconds(events: readonly StampedEvent[], endT: number, initial: Stance = 'idle'): StanceTimes {
  const out = zeroRecord(STANCES) as StanceTimes;
  let cur: Stance = initial;
  let since = 0;
  for (const e of events) {
    if (e.type !== 'stance') continue;
    const t = Math.min(e.t, endT);
    out[cur] += Math.max(0, t - since);
    cur = e.stance;
    since = t;
  }
  out[cur] += Math.max(0, endT - since);
  for (const s of STANCES) out[s] = Math.round(out[s] * 1000) / 1000;
  return out;
}

export function shares(times: StanceTimes): StanceTimes {
  const total = STANCES.reduce((s, k) => s + times[k], 0);
  const out = zeroRecord(STANCES) as StanceTimes;
  if (total <= 0) return out;
  for (const k of STANCES) out[k] = times[k] / total;
  return out;
}

/** Stance at time t (the last stance event at or before t). */
export function stanceAt(events: readonly StampedEvent[], t: number, initial: Stance = 'idle'): { stance: Stance; seq: number | null } {
  let cur: Stance = initial;
  let seq: number | null = null;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'stance') {
      cur = e.stance;
      seq = e.seq;
    }
  }
  return { stance: cur, seq };
}

/** The case world of a case id has a Crackstone (public design data). */
function caseHasCrackstone(caseId: CaseId | null): boolean {
  if (!caseId) return false;
  try {
    return Boolean(caseWorld(caseId)?.crackstone);
  } catch {
    return false;
  }
}

/** Crackstone counts from the event log (see CrackstoneReport for the definitions). */
export function crackstoneReport(events: readonly StampedEvent[], present = false): CrackstoneReport {
  const r: CrackstoneReport = {
    present, encounters: 0, encountersByVia: { sight: 0, proximity: 0, scan: 0 }, detections: { sight: 0, proximity: 0, scan: 0 },
    escapes: 0, escapesByReason: { lost_sight: 0, leash: 0, other: 0 }, deferrals: 0,
    scans: { warned: 0, passed: 0, hit: 0 }, curses: { cast: 0, hit: 0, blocked: 0, dodged: 0, hpLost: 0 }, firstEncounterT: null,
  };
  const engaged = (m: string) => m === 'CHASE' || m === 'ATTACK';
  for (const e of events) {
    switch (e.type) {
      case 'crackstone_mode':
        r.present = true;
        if (e.to === 'CHASE' && e.from !== 'ATTACK' && (e.reason === 'saw_player' || e.reason === 'sensed_player' || e.reason === 'scan_hit')) {
          r.encounters++;
          r.encountersByVia[e.reason === 'saw_player' ? 'sight' : e.reason === 'sensed_player' ? 'proximity' : 'scan']++;
          if (r.firstEncounterT === null) r.firstEncounterT = e.t;
        } else if (engaged(e.from) && !engaged(e.to)) {
          if (e.reason === 'deferred') r.deferrals++;
          else if (e.reason !== 'curse_done') {
            r.escapes++;
            r.escapesByReason[e.reason === 'lost_sight' ? 'lost_sight' : e.reason === 'leash' ? 'leash' : 'other']++;
          }
        } else if (e.reason === 'deferred') r.deferrals++;
        break;
      case 'crackstone_sighted':
        r.present = true;
        r.detections[e.via]++;
        break;
      case 'crackstone_scan':
        r.present = true;
        if (e.phase === 'warning') r.scans.warned++;
        else if (e.hit) r.scans.hit++;
        else r.scans.passed++;
        break;
      case 'curse':
        r.present = true;
        if (e.phase === 'cast') r.curses.cast++;
        else if (e.phase === 'hit') {
          r.curses.hit++;
          if (e.blocked) r.curses.blocked++;
          r.curses.hpLost += e.hpLost;
        } else r.curses.dodged++;
        break;
      default:
        break;
    }
  }
  return r;
}

export function describeSession(input: DescribeInput): SessionReport {
  const ev = input.events;
  const result = input.result ?? null;
  const last = ev[ev.length - 1];
  const terminal = ev.find((e) => e.type === 'finish' || e.type === 'dnf');
  const status: SessionReport['status'] = result ? result.outcome : terminal ? (terminal.type === 'finish' ? 'finished' : 'dnf') : 'in_progress';
  const deliveredEv = ev.find((e) => e.type === 'egg_delivered');
  const endT = input.endT ?? result?.activeTimeS ?? (deliveredEv ? deliveredEv.t : (last?.t ?? 0));

  const noiseBy = zeroRecord(NOISE_SOURCES);
  const heardBy = zeroRecord(NOISE_SOURCES);
  const alerts = zeroRecord(HYDE_MODES);
  let maxLoud = 0;
  let noiseTotal = 0;
  let heard = 0;
  let sightings = 0;
  let catches = 0;
  let blocked = 0;
  let hpLost = 0;
  let firstAlertT: number | null = null;
  const found: { clueId: string; t: number }[] = [];
  let pickupT: number | null = null;
  const drops: SessionReport['egg']['drops'] = [];
  let securityLost = 0;
  let security: number | null = null;
  let delivered = false;
  let deliveredT: number | null = null;
  let points = 0;
  const F: AbilityUse = { uses: 0, successes: 0, denied: 0, name: input.factors?.power.name ?? null };
  const Q: AbilityUse = { uses: 0, successes: 0, denied: 0, name: input.factors?.move.name ?? null };
  let hints = 0;
  let verdict: Verdict | null = null;
  let score: number | null = null;

  for (const e of ev) {
    switch (e.type) {
      case 'noise':
        noiseTotal++;
        noiseBy[e.source]++;
        if (e.loudness > maxLoud) maxLoud = e.loudness;
        break;
      case 'hyde_heard':
        heard++;
        heardBy[e.source]++;
        break;
      case 'hyde_mode':
        alerts[e.to]++;
        if (firstAlertT === null && ALERT_MODES.includes(e.to)) firstAlertT = e.t;
        break;
      case 'hyde_sighted':
        sightings++;
        break;
      case 'catch':
        catches++;
        if (e.blocked) blocked++;
        hpLost += e.hpLost;
        break;
      case 'clue_found':
        found.push({ clueId: e.clueId, t: e.t });
        break;
      case 'egg_pickup':
        if (pickupT === null) pickupT = e.t;
        break;
      case 'egg_drop':
        drops.push({ t: e.t, reason: e.reason });
        security = e.security;
        break;
      case 'egg_damage':
        securityLost += e.amount;
        security = e.security;
        break;
      case 'egg_delivered':
        delivered = true;
        deliveredT = e.t;
        points = e.points;
        security = e.security;
        break;
      case 'ability_used': {
        const u = e.key === 'F' ? F : Q;
        u.uses++;
        if (e.success) u.successes++;
        break;
      }
      case 'ability_denied':
        (e.key === 'F' ? F : Q).denied++;
        break;
      case 'hint_requested':
        hints++;
        break;
      case 'finish':
        verdict = e.verdict;
        score = e.score;
        break;
      default:
        break;
    }
  }
  const stance = stanceSeconds(ev, endT, input.initialStance ?? 'idle');
  const caseId = input.caseId && isCaseId(input.caseId) ? input.caseId : (result?.caseId && isCaseId(result.caseId) ? result.caseId : null);
  const info = caseId ? caseInfo(caseId) : null;
  const foundIds = new Set<string>(result ? result.cluesFound : found.map((f) => f.clueId));
  const missing = info ? info.clues.filter((c) => !foundIds.has(c.id)).map((c) => ({ clueId: c.id as string, title: c.title })) : [];
  let acc: Extract<StampedEvent, { type: 'accusation' }> | null = null;
  for (const e of ev) if (e.type === 'accusation') acc = e;
  return {
    caseId,
    caseVersion: info ? (input.caseVersion ?? result?.caseVersion ?? info.version) : null,
    duo: { ...input.duo },
    status,
    activeTimeS: Math.round(endT * 10) / 10,
    distanceM: input.distanceM ?? null,
    stanceSeconds: stance,
    stanceShare: shares(stance),
    noise: { total: noiseTotal, bySource: noiseBy, maxLoudness: maxLoud, heardBySource: heardBy },
    hyde: { alertsByMode: alerts, heard, sightings, chases: alerts.CHASE, catches, blockedCatches: blocked, hpLost, firstAlertT },
    clues: { found, count: found.length, total: clueCountFor(caseId), missing },
    egg: {
      pickupT, drops, securityLost: Math.round(securityLost * 10) / 10, security: result ? result.eggSecurity : security,
      delivered, deliveredT, points,
    },
    abilities: { F, Q },
    crackstone: crackstoneReport(ev, caseHasCrackstone(caseId)),
    hints,
    verdict: status === 'finished' ? (result?.verdict ?? verdict) : null,
    accusation: {
      kind: accusationKind({ events: ev, result: result ?? undefined }),
      evidenceCount: acc && Array.isArray(acc.evidence) ? acc.evidence.length : null,
    },
    extraction: delivered,
    score: status === 'finished' ? (result?.score ?? score) : null,
    hp: result ? result.hp : null,
    catches,
  };
}

/** Report for a live / finished collector (case from the collector's meta). */
export function describeCollector(c: TelemetryCollector): SessionReport {
  return describeSession({
    duo: c.meta.duo, events: c.events, initialStance: c.initialStance(), distanceM: c.distanceM, result: c.result,
    factors: c.meta.factors, caseId: c.meta.caseId ?? null, caseVersion: c.meta.caseVersion ?? null,
    endT: c.result ? c.result.activeTimeS : undefined,
  });
}

// ----------------------------------------------------------------------------------------------------- aggregate

export interface PickRate { id: string; offered: number; selected: number; rate: number | null; smallSample: boolean }

/** Which records an aggregate covers: one case or all cases; legacy (case-less) records are excluded by default. */
export interface AggregateOptions {
  caseId?: CaseId | 'all';
  /**
   * 'exclude' (default): records without a case id are left out of every view and only counted in `legacyExcluded`.
   * 'include': they join the COMBINED view (their clues are grouped as "legacy", 3 clues each) — used by boards whose
   * feed does not carry case ids yet (degraded "combined only" mode). They never join a per-case view.
   */
  legacy?: 'exclude' | 'include';
}

export interface ClueRate {
  clueId: string;
  title: string;
  location: string | null;
  caseId: CaseId | null; // null = a legacy clue id
  found: number; // ended runs of THAT case that found it
  of: number; // ended runs of that case
  rate: number | null;
}

export interface AccusationBreakdown {
  solved: number;
  rightSuspectWrongEvidence: number;
  wrongSuspect: number;
  notAccused: number;
  unsolved: number; // accused, unsolved, detail unknown (legacy rows)
  dnf: number;
  /** Runs that made an accusation (solved + right suspect + wrong suspect + unsolved). */
  accused: number;
  /**
   * Of the accusations whose evidence flag is known: share whose cited evidence was exactly the case's supporting
   * evidence (`deductionCorrect`, independent of the suspect named), 0–100.
   */
  deductionCorrectPctOfAccused: number | null;
  /** Of the accusations whose detail is known: share naming the culprit, 0–100. */
  rightSuspectPctOfAccused: number | null;
}

export interface UsageCount { id: string; runs: number }

/** One row of the per-case summary table (or the combined row, caseId 'all'). */
export interface CaseSummary {
  caseId: CaseId | 'all';
  number: string | null; // '01' … (null for 'all')
  title: string;
  runs: number;
  ended: number;
  finished: number;
  dnf: number;
  inProgress: number;
  finishRatePct: number | null; // finished ÷ ended
  /** Egg delivered at Iago Tower ÷ ended runs (a finished run always delivered the egg). */
  extractionPct: number | null;
  /** Mystery-solving accuracy: case_solved ÷ finished. */
  solvedPctOfFinished: number | null;
  meanTimeS: number | null; // finishers
  medianTimeS: number | null; // finishers
  clueCount: number | null; // the case's clue count (null for 'all')
  clues: ClueRate[];
  /** Ended runs that found every clue of THEIR case. */
  allCluesPct: number | null;
  detectionsPerRun: number | null; // chase onsets per ended run with events
  catchesPerRun: number | null;
  accusation: AccusationBreakdown;
  characters: UsageCount[];
  pokemon: UsageCount[];
  duos: { characterId: string; pokemonId: string; runs: number }[]; // top 5
  smallSample: boolean;
}

export interface DescriptiveAggregate {
  /** What this aggregate covers. */
  scope: CaseId | 'all';
  /** Case-less (legacy) records left out of this aggregate. */
  legacyExcluded: number;
  runs: number;
  finished: number;
  dnf: number;
  inProgress: number;
  finishRatePct: number | null;
  extractionPct: number | null;
  caseSolvedPctOfFinished: number | null;
  meanTimeS: number | null;
  medianTimeS: number | null; // finishers
  /** clue id → find rate within its own case (over that case's ended runs). */
  clueFindRate: Record<string, number>;
  clueRates: ClueRate[];
  /** Ended runs that found all clues of their own case. */
  allCluesPct: number | null;
  accusation: AccusationBreakdown;
  detectionsPerRun: number | null; // chase onsets per ended run
  detectionsLast20: number[];
  heardAlerts: number; // investigations started by a heard noise
  seenAlerts: number; // investigations / chases started by sight
  medianFirstAlertS: number | null;
  stanceMix: StanceTimes; // shares over all ended runs
  topAbilities: { key: 'F' | 'Q'; abilityId: string; uses: number; successes: number }[];
  pickRate: { characters: PickRate[]; pokemon: PickRate[] };
  /** Joseph Crackstone over the ended runs of the scope that had him (case world or his events). */
  crackstone: CrackstoneAggregate;
  /** UX §8 KPI "Curses dodged %": curses cast / landed (blocked or not) / missed over ended runs; pct null at n = 0. */
  cursesCast: number;
  cursesHit: number;
  cursesDodged: number;
  cursesDodgedPct: number | null;
  /** Fewer than 10 curses cast: the board says "small sample". */
  cursesSmallSample: boolean;
  /** Per-case table: always the three cases (over ALL case records, independent of `scope`) + the combined row. */
  cases: CaseSummary[];
  combined: CaseSummary;
  smallSample: boolean;
}

export interface CrackstoneAggregate {
  /** Ended runs with a Crackstone. */
  runs: number;
  encounters: number;
  encountersPerRun: number | null;
  encountersByVia: { sight: number; proximity: number; scan: number };
  detections: { sight: number; proximity: number; scan: number };
  escapes: number;
  escapesByReason: { lost_sight: number; leash: number; other: number };
  /** Escapes / encounters (0-100), null without encounters. */
  escapePct: number | null;
  scansWarned: number;
  scansHit: number;
  curses: { cast: number; hit: number; blocked: number; dodged: number; hpLost: number };
  smallSample: boolean;
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Records in scope: legacy handling + case filter (see AggregateOptions). */
export function scopeRecords(records: readonly SessionRecord[], o: AggregateOptions = {}): { records: SessionRecord[]; legacyExcluded: number } {
  const includeLegacy = o.legacy === 'include';
  const scope = o.caseId ?? 'all';
  let legacyExcluded = 0;
  const out: SessionRecord[] = [];
  for (const r of records) {
    const c = recordCaseId(r);
    if (c === null) {
      if (includeLegacy && scope === 'all') out.push(r);
      else legacyExcluded++;
      continue;
    }
    if (scope === 'all' || c === scope) out.push(r);
  }
  return { records: out, legacyExcluded };
}

interface Derived {
  r: SessionRecord;
  caseId: CaseId | null;
  rep: SessionReport;
  ended: boolean;
  outcome: 'finished' | 'dnf' | null;
  clues: string[];
  accusation: AccusationKind;
  deductionCorrect: boolean | null;
  hasEvents: boolean;
}

function derive(r: SessionRecord): Derived {
  const caseId = recordCaseId(r);
  const rep = describeSession({
    duo: r.duo ?? ({ characterId: 'unknown', pokemonId: 'unknown' } as unknown as Duo),
    events: r.events,
    endT: r.result?.activeTimeS,
    caseId,
  });
  const ended = Boolean(r.result) || rep.status !== 'in_progress';
  const outcome = r.result?.outcome ?? (rep.status === 'in_progress' ? null : rep.status);
  const clues: string[] = r.result?.cluesFound ? [...r.result.cluesFound] : rep.clues.found.map((f) => f.clueId);
  const acc = lastAccusation(r.events);
  const deductionCorrect = typeof r.result?.deductionCorrect === 'boolean' ? r.result.deductionCorrect
    : acc && typeof acc.deductionCorrect === 'boolean' ? acc.deductionCorrect : null;
  return {
    r, caseId, rep, ended, outcome, clues, accusation: accusationKind({ events: r.events, result: r.result }), deductionCorrect,
    hasEvents: r.events.length > 0,
  };
}

function accusationBreakdown(xs: readonly Derived[]): AccusationBreakdown {
  const n = (k: AccusationKind) => xs.filter((x) => x.accusation === k).length;
  const solved = n('solved');
  const right = n('right_suspect_wrong_evidence');
  const wrong = n('wrong_suspect');
  const unsolved = n('unsolved');
  const known = solved + right + wrong;
  const accused = xs.filter((x) => x.accusation === 'solved' || x.accusation === 'right_suspect_wrong_evidence' || x.accusation === 'wrong_suspect' || x.accusation === 'unsolved');
  const flagged = accused.filter((x) => x.deductionCorrect !== null);
  return {
    solved, rightSuspectWrongEvidence: right, wrongSuspect: wrong, notAccused: n('not_accused'), unsolved, dnf: n('dnf'),
    accused: known + unsolved,
    deductionCorrectPctOfAccused: flagged.length ? (100 * flagged.filter((x) => x.deductionCorrect).length) / flagged.length : null,
    rightSuspectPctOfAccused: known ? (100 * (solved + right)) / known : null,
  };
}

/** Within-case clue rates: each case's clues over that case's ended runs; legacy ids over the legacy runs. */
function clueRatesOf(ended: readonly Derived[]): ClueRate[] {
  const out: ClueRate[] = [];
  for (const id of CASE_IDS) {
    const runs = ended.filter((x) => x.caseId === id);
    if (runs.length === 0) continue;
    for (const c of caseInfo(id).clues) {
      const found = runs.filter((x) => x.clues.includes(c.id)).length;
      out.push({ clueId: c.id, title: c.title, location: c.location, caseId: id, found, of: runs.length, rate: found / runs.length });
    }
  }
  const legacy = ended.filter((x) => x.caseId === null);
  if (legacy.length > 0) {
    const ids = [...new Set(legacy.flatMap((x) => x.clues))].sort();
    for (const id of ids) {
      const found = legacy.filter((x) => x.clues.includes(id)).length;
      out.push({ clueId: id, title: id, location: null, caseId: null, found, of: legacy.length, rate: found / legacy.length });
    }
  }
  return out;
}

/** Found every clue of the record's own case (a legacy record: any 3 clues). */
function allClues(x: Derived): boolean {
  if (x.caseId === null) return x.clues.length >= LEGACY_CLUE_COUNT;
  const ids = new Set<string>(caseInfo(x.caseId).clues.map((c) => c.id));
  return x.clues.filter((c) => ids.has(c)).length >= clueCountFor(x.caseId);
}

function usage(xs: readonly Derived[]): Pick<CaseSummary, 'characters' | 'pokemon' | 'duos'> {
  const ch = new Map<string, number>();
  const pk = new Map<string, number>();
  const du = new Map<string, { characterId: string; pokemonId: string; runs: number }>();
  for (const x of xs) {
    const d = x.r.duo;
    if (!d) continue;
    ch.set(d.characterId, (ch.get(d.characterId) ?? 0) + 1);
    pk.set(d.pokemonId, (pk.get(d.pokemonId) ?? 0) + 1);
    const k = `${d.characterId}+${d.pokemonId}`;
    const v = du.get(k) ?? { characterId: d.characterId, pokemonId: d.pokemonId, runs: 0 };
    v.runs++;
    du.set(k, v);
  }
  const list = (m: Map<string, number>) => [...m.entries()].map(([id, runs]) => ({ id, runs })).sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id));
  return {
    characters: list(ch),
    pokemon: list(pk),
    duos: [...du.values()].sort((a, b) => b.runs - a.runs || `${a.characterId}+${a.pokemonId}`.localeCompare(`${b.characterId}+${b.pokemonId}`)).slice(0, 5),
  };
}

function summarise(xs: readonly Derived[], caseId: CaseId | 'all'): CaseSummary {
  const ended = xs.filter((x) => x.ended);
  const fin = ended.filter((x) => x.outcome === 'finished');
  const dnf = ended.filter((x) => x.outcome === 'dnf');
  const withEvents = ended.filter((x) => x.hasEvents);
  const delivered = ended.filter((x) => x.outcome === 'finished' || x.rep.extraction);
  const times = fin.map((x) => x.r.result?.activeTimeS ?? x.rep.activeTimeS);
  const info = caseId === 'all' ? null : caseInfo(caseId);
  return {
    caseId,
    number: info?.number ?? null,
    title: info ? info.title : 'All cases',
    runs: xs.length,
    ended: ended.length,
    finished: fin.length,
    dnf: dnf.length,
    inProgress: xs.length - ended.length,
    finishRatePct: ended.length ? (100 * fin.length) / ended.length : null,
    extractionPct: ended.length ? (100 * delivered.length) / ended.length : null,
    solvedPctOfFinished: fin.length ? (100 * fin.filter((x) => x.accusation === 'solved').length) / fin.length : null,
    meanTimeS: mean(times),
    medianTimeS: median(times),
    clueCount: info ? info.clues.length : null,
    clues: clueRatesOf(ended),
    allCluesPct: ended.length ? (100 * ended.filter(allClues).length) / ended.length : null,
    detectionsPerRun: withEvents.length ? withEvents.reduce((s, x) => s + x.rep.hyde.chases, 0) / withEvents.length : null,
    catchesPerRun: ended.length ? ended.reduce((s, x) => s + (x.r.result?.catches ?? x.rep.catches), 0) / ended.length : null,
    accusation: accusationBreakdown(ended),
    ...usage(xs),
    smallSample: ended.length < 10,
  };
}

/**
 * Laptop 1 aggregate over many sessions (local collectors or rows rebuilt from Supabase), for one case or all cases.
 * The second argument may also be a clue-id list (pre-case API): that means `{ legacy: 'include' }`.
 */
export function aggregateSessions(records: readonly SessionRecord[], options: AggregateOptions | readonly string[] = {}): DescriptiveAggregate {
  const o: AggregateOptions = Array.isArray(options) ? { legacy: 'include' } : (options as AggregateOptions);
  const scope = o.caseId ?? 'all';
  const { records: inScope, legacyExcluded } = scopeRecords(records, o);
  const xs = inScope.map(derive);
  const ended = xs.filter((x) => x.ended);
  const summary = summarise(xs, scope);
  // per-case table: always over every case-tagged record (+ the combined row, legacy as configured)
  const allTagged = scopeRecords(records, { caseId: 'all', legacy: o.legacy }).records.map(derive);
  const cases = CASE_IDS.map((id) => summarise(allTagged.filter((x) => x.caseId === id), id));
  const combined = summarise(allTagged, 'all');

  const clueFindRate: Record<string, number> = {};
  for (const c of summary.clues) if (c.rate !== null) clueFindRate[c.clueId] = c.rate;
  const stanceSum = zeroRecord(STANCES) as StanceTimes;
  for (const x of ended) for (const s of STANCES) stanceSum[s] += x.rep.stanceSeconds[s];
  const abil = new Map<string, { key: 'F' | 'Q'; abilityId: string; uses: number; successes: number }>();
  let heardAlerts = 0;
  let seenAlerts = 0;
  for (const x of ended) {
    for (const e of x.r.events) {
      if (e.type === 'ability_used') {
        const k = `${e.key}:${e.abilityId}`;
        const a = abil.get(k) ?? { key: e.key, abilityId: e.abilityId, uses: 0, successes: 0 };
        a.uses++;
        if (e.success) a.successes++;
        abil.set(k, a);
      } else if (e.type === 'hyde_mode' && ALERT_MODES.includes(e.to) && e.from !== 'CHASE') {
        if (e.reason === 'heard_noise') heardAlerts++;
        else if (e.reason === 'saw_player') seenAlerts++;
      }
    }
  }
  const crackRuns = ended.filter((x) => x.rep.crackstone.present);
  const crack: CrackstoneAggregate = {
    runs: crackRuns.length, encounters: 0, encountersPerRun: null, encountersByVia: { sight: 0, proximity: 0, scan: 0 },
    detections: { sight: 0, proximity: 0, scan: 0 }, escapes: 0, escapesByReason: { lost_sight: 0, leash: 0, other: 0 }, escapePct: null,
    scansWarned: 0, scansHit: 0, curses: { cast: 0, hit: 0, blocked: 0, dodged: 0, hpLost: 0 }, smallSample: crackRuns.length < 10,
  };
  for (const x of crackRuns) {
    const c = x.rep.crackstone;
    crack.encounters += c.encounters;
    for (const k of ['sight', 'proximity', 'scan'] as const) {
      crack.encountersByVia[k] += c.encountersByVia[k];
      crack.detections[k] += c.detections[k];
    }
    crack.escapes += c.escapes;
    for (const k of ['lost_sight', 'leash', 'other'] as const) crack.escapesByReason[k] += c.escapesByReason[k];
    crack.scansWarned += c.scans.warned;
    crack.scansHit += c.scans.hit;
    for (const k of ['cast', 'hit', 'blocked', 'dodged', 'hpLost'] as const) crack.curses[k] += c.curses[k];
  }
  crack.encountersPerRun = crackRuns.length ? crack.encounters / crackRuns.length : null;
  crack.escapePct = crack.encounters ? (100 * crack.escapes) / crack.encounters : null;
  const firstAlerts = ended.map((x) => x.rep.hyde.firstAlertT).filter((v): v is number => v !== null);
  const withEvents = ended.filter((x) => x.hasEvents);
  return {
    scope,
    legacyExcluded,
    runs: summary.runs,
    finished: summary.finished,
    dnf: summary.dnf,
    inProgress: summary.inProgress,
    finishRatePct: summary.finishRatePct,
    extractionPct: summary.extractionPct,
    caseSolvedPctOfFinished: summary.solvedPctOfFinished,
    meanTimeS: summary.meanTimeS,
    medianTimeS: summary.medianTimeS,
    clueFindRate,
    clueRates: summary.clues,
    allCluesPct: summary.allCluesPct,
    accusation: summary.accusation,
    detectionsPerRun: summary.detectionsPerRun,
    detectionsLast20: withEvents.slice(-20).map((x) => x.rep.hyde.chases),
    heardAlerts,
    seenAlerts,
    medianFirstAlertS: median(firstAlerts),
    stanceMix: shares(stanceSum),
    topAbilities: [...abil.values()].sort((a, b) => b.uses - a.uses || a.abilityId.localeCompare(b.abilityId)).slice(0, 5),
    pickRate: pickRates(inScope),
    crackstone: crack,
    cursesCast: crack.curses.cast,
    cursesHit: crack.curses.hit,
    cursesDodged: crack.curses.dodged,
    cursesDodgedPct: crack.curses.cast ? (100 * crack.curses.dodged) / crack.curses.cast : null,
    cursesSmallSample: crack.curses.cast < 10,
    cases,
    combined,
    smallSample: ended.length < 10,
  };
}

/** Pick rate when offered = selected ÷ offered, per character and per Pokémon (keys come from the data). */
export function pickRates(records: readonly SessionRecord[]): { characters: PickRate[]; pokemon: PickRate[] } {
  const ch = new Map<string, { offered: number; selected: number }>();
  const pk = new Map<string, { offered: number; selected: number }>();
  const bump = (m: Map<string, { offered: number; selected: number }>, id: string, field: 'offered' | 'selected') => {
    const v = m.get(id) ?? { offered: 0, selected: 0 };
    v[field]++;
    m.set(id, v);
  };
  for (const r of records) {
    if (!r.offered || r.offered.length === 0) continue;
    for (const d of r.offered) {
      bump(ch, d.characterId, 'offered');
      bump(pk, d.pokemonId, 'offered');
    }
    if (r.duo) {
      bump(ch, r.duo.characterId, 'selected');
      bump(pk, r.duo.pokemonId, 'selected');
    }
  }
  const list = (m: Map<string, { offered: number; selected: number }>): PickRate[] =>
    [...m.entries()]
      .map(([id, v]) => ({ id, offered: v.offered, selected: v.selected, rate: v.offered ? v.selected / v.offered : null, smallSample: v.offered < 10 }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.offered - a.offered || a.id.localeCompare(b.id));
  return { characters: list(ch), pokemon: list(pk) };
}
