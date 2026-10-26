// Laptop 1 spectator view-model (docs/overhaul/UX_OVERHAUL.md §10): one StationLiveCard per station + the header KPI
// ribbon. Pure; built from REAL data only — the local demo's LiveStatus (+ the analytics heartbeat numbers when the
// station writes them) or a live BoardStation (Supabase row + Realtime heartbeat). Never the culprit, the accused
// suspect or the true egg site: egg odds are the Bayesian estimate and disappear (→ "seen") once the egg was seen.
// Joseph Crackstone (UX_ENEMIES §8): a chip with his MODE (Patrol / Glimpse / HUNTING / CURSING / Search / Return) —
// never his position; "Chases H2 · C1"; a "HUNTED" card state while he chases; the "Curses dodged" KPI.
// A board that cannot hear a station (signal lost / offline board) never claims "Idle": it says it does not know.
// Final wave (UX_FINAL; FINAL_CONTRACT §4/§5): when the status / heartbeat carries all three monsters (feature-detected:
// `enemies {hyde, crackstone, slurp}` or `slurpMode` / `slurpPresent`), the card shows three compact monster chips
// (mode word only, never a position); older stations keep the Hyde + Crackstone chips.
import { bandFor } from '../../mystery/analytics/predictive.ts';
import { thingItemText } from '../../mystery/analytics/thingCodes.ts';
import type { DescriptiveAggregate } from '../../mystery/analytics/descriptive.ts';
import type { HeartbeatAnalytics } from '../../mystery/analytics/live.ts';
import { CASES } from '../../mystery/data/cases.ts';
import { caseWorld } from '../../mystery/data/caseWorlds.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import { CASE_IDS, ENEMY_IDS, type CaseId, type CrackstoneMode, type Duo, type EnemyId, type HydeMode, type Objective, type SlurpMode, type StampedEvent } from '../../mystery/types.ts';
import { CRACK_CHIP } from '../../app/mystery/hud/crackstone.ts';
import type { LivePhase, LiveStatus } from '../../app/mystery/records.ts';
import type { BoardStation } from '../../lib/supabase/mysteryDashboardFeed.ts';
import type { IconName } from '../Icon.tsx';

export const SIGNAL_LOST_MS = 15_000;
export const SMALL_SAMPLE_N = 10;
const ADVICE_MAX = 52;

export type EggStep = 'unknown' | 'resting' | 'seen' | 'carried' | 'dropped' | 'delivered';
export type Source = 'ml' | 'rule';

export interface StationCardView {
  label: string;
  phase: LivePhase;
  phaseText: string;
  phaseIcon: IconName;
  /** Signal lost (no update for 15 s while active). */
  lost: boolean;
  chasing: boolean;
  dnf: boolean;
  active: boolean;
  timeText: string | null;
  nickname: string | null;
  duo: Duo | null;
  duoText: string | null;
  caseId: CaseId | null;
  caseText: string | null;
  clues: number;
  cluesTotal: number;
  egg: EggStep;
  towerReached: boolean;
  objectiveText: string | null;
  hp: number | null;
  maxHp: number;
  catches: number | null;
  chases: number | null;
  /** "Chases H2 · C1" when the case has Crackstone, else "Chases 2" (null = unknown). */
  chasesText: string | null;
  hyde: { word: string; icon: IconName; chase: boolean } | null;
  /** Joseph Crackstone chip (his mode only), null without him / unknown. */
  crack: { word: string; icon: IconName; hunting: boolean } | null;
  /** He chases / curses: double green card border + "HUNTED" chip (never together with CHASING — R6). */
  hunted: boolean;
  /** All three monsters (when the station reports them); null = older station → the Hyde / Crackstone chips. */
  monsters: MonsterChip[] | null;
  risk: { band: 'Low' | 'Medium' | 'High'; source: Source } | null;
  tower: { pct: number; source: Source } | null;
  eggOdds: { name: string; pct: number } | null;
  thing: { head: string; text: string; followed: string | null } | null;
  ageText: string | null;
  notice: string | null;
}

const PHASE: Record<LivePhase, { text: string; icon: IconName }> = {
  idle: { text: 'Idle', icon: 'hourglass' },
  name: { text: 'Name entry', icon: 'hand' },
  duo: { text: 'Choosing duo', icon: 'gem' },
  tutorial: { text: 'Tutorial', icon: 'signpost' },
  investigating: { text: 'Investigating', icon: 'search' },
  carrying: { text: 'Carrying egg', icon: 'egg' },
  accusing: { text: 'Accusing', icon: 'fileText' },
  results: { text: 'Results', icon: 'trophy' },
  dnf: { text: 'DNF', icon: 'claw' },
};

const HYDE: Record<HydeMode, { word: string; icon: IconName }> = {
  PATROL: { word: 'Patrolling', icon: 'footprints' },
  INVESTIGATE_SOUND: { word: 'Heard something', icon: 'ear' },
  SEARCH: { word: 'Searching', icon: 'search' },
  CHASE: { word: 'Chasing', icon: 'claw' },
  COOLDOWN: { word: 'Calming', icon: 'hourglass' },
};

const OBJECTIVE: Record<Objective, string> = {
  find_clues: 'Finding clues', find_egg: 'Finding the egg', retrieve_egg: 'Picking up the egg', deliver_egg: 'Carrying to the tower',
  accuse: 'Accusing', done: 'Done',
};

const isCase = (v: unknown): v is CaseId => typeof v === 'string' && (CASE_IDS as readonly string[]).includes(v);
const isObjective = (v: unknown): v is Objective => typeof v === 'string' && v in OBJECTIVE;
const pct5 = (p: number) => Math.min(95, Math.max(5, Math.round((p * 100) / 5) * 5));

/** m:ss */
export function mmss(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function followedText(kind: string, f: boolean | null | undefined): string | null {
  if (kind !== 'advice') return null;
  return f === true ? 'followed ✓' : f === false ? 'not followed' : 'not yet';
}

/** Public egg-site / zone names of the station's case world (unknown ids → null). */
function eggSiteName(caseId: CaseId | null, id: string | undefined): string | null {
  if (!caseId || !id) return null;
  return caseWorld(caseId).eggSites.find((s) => s.id === id)?.label ?? null;
}

/**
 * Egg odds for a spectator: the top Bayesian site while the egg rests unseen. A posterior of ~1 means the egg was SEEN
 * there — the card then says "seen" and never names the (true) site.
 */
function eggOddsOf(caseId: CaseId | null, egg: EggStep, site: { id: string; p: number } | null | undefined): { odds: StationCardView['eggOdds']; seen: boolean } {
  if (!site || egg !== 'resting') return { odds: null, seen: false };
  if (site.p >= 0.995) return { odds: null, seen: true };
  const name = eggSiteName(caseId, site.id);
  return { odds: name ? { name, pct: pct5(site.p) } : null, seen: false };
}

function eggStep(state: string | null | undefined): EggStep {
  return state === 'resting' || state === 'carried' || state === 'dropped' || state === 'delivered' ? state : 'unknown';
}

function objectiveFallback(egg: EggStep, clues: number, total: number, phase: LivePhase): Objective | null {
  if (phase === 'accusing') return 'accuse';
  if (phase === 'results' || phase === 'dnf') return 'done';
  if (phase !== 'investigating' && phase !== 'carrying') return null;
  if (egg === 'carried') return 'deliver_egg';
  if (egg === 'dropped') return 'retrieve_egg';
  return clues < total ? 'find_clues' : 'find_egg';
}

const ACTIVE = (p: LivePhase) => !['idle', 'results', 'dnf'].includes(p);

/** Overhaul numbers a station MAY add to its local LiveStatus (feature-detected). */
export type LiveStatusWithInsights = LiveStatus & { insights?: Partial<HeartbeatAnalytics> | null };

/** LOCAL DEMO: this browser's station (raven.mystery.live). */
export function stationViewFromLocal(live: LiveStatusWithInsights | null, now: number, label = 'This station'): StationCardView {
  if (!live) return idleView(label, null);
  const a = live.insights ?? null;
  const caseId = isCase(live.caseId) ? live.caseId : null;
  const total = a?.cluesTotal ?? (caseId ? CASES[caseId].clues.length : 3);
  const active = ACTIVE(live.phase);
  const lost = active && now - live.updatedAt > SIGNAL_LOST_MS;
  let egg = eggStep(live.egg?.state);
  const { odds, seen } = eggOddsOf(caseId, egg, a?.eggSite ?? null);
  if (seen) egg = 'seen';
  const objective = isObjective(a?.objective) ? a!.objective as Objective : objectiveFallback(egg, live.clues, total, live.phase);
  const emerged = a?.hydeEmerged ?? null;
  const mode = live.hydeMode;
  const thing = a?.lastThing
    ? { head: thingItemText(a.lastThing).head, text: clip(a.lastThing.text, ADVICE_MAX), followed: followedText(a.lastThing.kind, a.lastThing.followed) }
    : live.advice ? { head: "THING'S ADVICE", text: clip(live.advice.text, ADVICE_MAX), followed: followedText('advice', live.advice.followed) } : null;
  const riskSource: Source = live.risk?.label === 'ML estimate' ? 'ml' : 'rule';
  const hydeChases = typeof a?.chases === 'number' ? a.chases : typeof live.chasesHyde === 'number' ? live.chasesHyde : null;
  // the analytics heartbeat's Crackstone numbers when present, else the station's own status fields
  const ax = (a ?? {}) as { crackstonePresent?: boolean; crackstoneMode?: CrackstoneMode | null; crackstoneChases?: number };
  const crackPresent = ax.crackstonePresent ?? live.crackstonePresent ?? null;
  const crackChases = typeof ax.crackstoneChases === 'number' ? ax.crackstoneChases : live.chasesCrack ?? null;
  const cr = crackOf(crackPresent, live.crackstoneMode ?? ax.crackstoneMode ?? null, active && !lost);
  return {
    ...common(label, live.phase, lost, mode === 'CHASE' && active),
    active,
    timeText: live.activeTimeS !== null ? mmss(live.activeTimeS) : null,
    nickname: live.nickname || null,
    duo: live.duo,
    duoText: live.duo ? duoText(live.duo) : null,
    caseId,
    caseText: caseId ? `Case ${CASES[caseId].number} · ${CASES[caseId].title}` : null,
    clues: live.clues,
    cluesTotal: total,
    egg,
    towerReached: egg === 'delivered',
    objectiveText: objective ? OBJECTIVE[objective] : null,
    hp: live.hp,
    maxHp: 100,
    catches: live.catches,
    chases: hydeChases,
    chasesText: chasesText(hydeChases, crackPresent === true, crackChases),
    hyde: hydeChip(mode, emerged, active),
    crack: cr,
    hunted: !!cr?.hunting && mode !== 'CHASE',
    monsters: monsterChipsOf(live, active && !lost),
    risk: live.risk && mode !== null ? { band: bandWord(live.risk.p), source: riskSource } : null,
    tower: a?.extraction ? { pct: pct5(a.extraction.p), source: a.extraction.source === 'ml' ? 'ml' : 'rule' } : null,
    eggOdds: odds,
    thing,
    ageText: `updated ${Math.max(0, Math.round((now - live.updatedAt) / 1000))} s ago`,
    notice: null,
  };
}

/** LIVE board: a station's verified row + Realtime heartbeat (names / duo / case from the row, numbers from the beat). */
export function stationViewFromBoard(station: BoardStation, now: number): StationCardView {
  const row = station.row;
  const beat = station.heartbeat;
  const active = row !== null && row.status !== 'idle';
  // No heartbeat for 15 s (station off, or THIS board offline): the board cannot know the station is idle.
  if (!active && station.signalLost) return { ...unknownView(station.label), ageText: ageOf(station, now) };
  if (!active) return { ...idleView(station.label, row?.notice === 'operator_reset' ? 'Reset by the operator.' : null), ageText: ageOf(station, now) };
  const statusPhase: Record<string, LivePhase> = { idle: 'idle', offered: 'duo', playing: 'investigating', finished: 'results', dnf: 'dnf' };
  const phase: LivePhase = beat?.phase ?? statusPhase[row.status] ?? 'idle';
  const caseId = isCase(row.case_id) ? row.case_id : null;
  const total = beat?.cluesTotal ?? (caseId ? CASES[caseId].clues.length : 3);
  const clues = row.clues_found ?? beat?.clues ?? 0;
  let egg = eggStep(beat?.eggState ?? row.egg_state);
  const { odds, seen } = eggOddsOf(caseId, egg, beat?.eggSite ?? null);
  if (seen) egg = 'seen';
  const objective = beat?.objective ?? objectiveFallback(egg, clues, total, phase);
  const duo = row.character_id && row.pokemon_id ? ({ characterId: row.character_id, pokemonId: row.pokemon_id } as Duo) : null;
  const time = beat?.activeTimeS ?? (row.active_time_s === null ? null : Number(row.active_time_s));
  const mode = beat?.hydeMode ?? null;
  const thing = beat?.thing ? { ...thingItemText(beat.thing), followed: followedText(beat.thing.kind, beat.thing.followed) } : null;
  // Crackstone heartbeat fields (fullstack: optional on the wire — older stations omit them)
  const cb = (beat ?? {}) as { crackstonePresent?: boolean | null; crackstoneMode?: string | null; crackstoneChases?: number | null; crackChases?: number | null };
  const crackChases = typeof cb.crackstoneChases === 'number' ? cb.crackstoneChases : typeof cb.crackChases === 'number' ? cb.crackChases : null;
  const crackMode = isCrackMode(cb.crackstoneMode) ? cb.crackstoneMode : null;
  const cr = crackOf(cb.crackstonePresent ?? null, crackMode, ACTIVE(phase) && !station.signalLost);
  return {
    ...common(station.label, phase, station.signalLost, mode === 'CHASE' && ACTIVE(phase)),
    active: true,
    timeText: time !== null && Number.isFinite(time) ? mmss(time) : null,
    nickname: row.nickname || null,
    duo,
    duoText: duo ? duoText(duo) : null,
    caseId,
    caseText: caseId ? `Case ${CASES[caseId].number} · ${CASES[caseId].title}` : null,
    clues,
    cluesTotal: total,
    egg,
    towerReached: egg === 'delivered',
    objectiveText: objective ? OBJECTIVE[objective] : null,
    hp: beat?.hp ?? null,
    maxHp: 100,
    catches: row.catches ?? beat?.catches ?? null,
    chases: beat?.chases ?? null,
    chasesText: chasesText(beat?.chases ?? null, cb.crackstonePresent === true, crackChases),
    hyde: hydeChip(mode, beat?.hydeEmerged ?? null, ACTIVE(phase)),
    crack: cr,
    hunted: !!cr?.hunting && mode !== 'CHASE',
    monsters: monsterChipsOf(beat, ACTIVE(phase) && !station.signalLost),
    risk: beat?.risk !== null && beat?.risk !== undefined && mode !== null ? { band: bandWord(beat.risk), source: beat.riskSource === 'ml' ? 'ml' : 'rule' } : null,
    tower: typeof beat?.extraction === 'number' ? { pct: pct5(beat.extraction), source: beat.extractionSource === 'ml' ? 'ml' : 'rule' } : null,
    eggOdds: odds,
    thing,
    ageText: ageOf(station, now),
    notice: beat?.sync === 'offline' ? 'Terminal offline · saving locally' : beat?.sync === 'unverified' ? 'Unverified run — not on the board' : null,
  };
}

function ageOf(station: BoardStation, now: number): string {
  return station.lastSeenAt === null ? 'no heartbeat yet' : `heartbeat ${Math.max(0, Math.round((now - station.lastSeenAt) / 1000))} s ago`;
}

function common(label: string, phase: LivePhase, lost: boolean, chasing: boolean) {
  const ph = PHASE[phase];
  return {
    label, phase, lost, chasing, dnf: phase === 'dnf',
    phaseText: lost ? 'Signal lost' : ph.text,
    phaseIcon: (lost ? 'wifiOff' : ph.icon) as IconName,
  };
}

function idleView(label: string, notice: string | null): StationCardView {
  return {
    ...common(label, 'idle', false, false), active: false, timeText: null, nickname: null, duo: null, duoText: null, caseId: null, caseText: null,
    clues: 0, cluesTotal: 3, egg: 'unknown', towerReached: false, objectiveText: null, hp: null, maxHp: 100, catches: null, chases: null,
    chasesText: null, hyde: null, crack: null, hunted: false, monsters: null, risk: null, tower: null, eggOdds: null, thing: null, ageText: null, notice: notice ?? 'No visitor yet.',
  };
}

/** No signal and no active row: the station may be idle OR playing — the board cannot know (P5). */
function unknownView(label: string): StationCardView {
  return { ...idleView(label, 'No signal — this board cannot see the station right now.'), lost: true, phaseText: 'No signal', phaseIcon: 'wifiOff' };
}

const CRACK_MODES: readonly CrackstoneMode[] = ['PATROL', 'INVESTIGATE', 'CHASE', 'ATTACK', 'SEARCH', 'RETURN'];
const isCrackMode = (v: unknown): v is CrackstoneMode => typeof v === 'string' && (CRACK_MODES as readonly string[]).includes(v);

/** The Crackstone chip (mode only, never a position); null when he is not in the case / unknown / not playing. */
export function crackOf(present: boolean | null, mode: CrackstoneMode | null, active: boolean): StationCardView['crack'] {
  if (!active || present !== true || !mode) return null;
  const c = CRACK_CHIP[mode];
  return { word: c.word, icon: c.icon, hunting: mode === 'CHASE' || mode === 'ATTACK' };
}

/** "Chases H2 · C1" with Crackstone, "Chases 2" without; null when the Hyde count is unknown. */
export function chasesText(hyde: number | null, crackPresent: boolean, crack: number | null): string | null {
  if (hyde === null) return null;
  return crackPresent ? `Chases H${hyde} · C${crack ?? '—'}` : `Chases ${hyde}`;
}

// ----------------------------------------------------------------------------------------------------- monsters

export interface MonsterChip {
  enemy: EnemyId;
  word: string;
  /** Away / not spawned yet (dotted, muted). */
  away: boolean;
  /** Chasing / attacking the visitor (bold, enemy colour). */
  hot: boolean;
}

const SLURP_WORD: Record<SlurpMode, string> = {
  WANDER: 'Wandering', INVESTIGATE: 'Heard something', SEARCH: 'Searching', CHASE: 'CHASING', ATTACK: 'GRABBING', LEAVE: 'Wandering off',
};
const SLURP_MODES = Object.keys(SLURP_WORD) as SlurpMode[];
const HYDE_MODES = Object.keys(HYDE) as HydeMode[];

function modeWord(enemy: EnemyId, mode: unknown): { word: string; hot: boolean } | null {
  if (enemy === 'hyde' && typeof mode === 'string' && (HYDE_MODES as string[]).includes(mode)) {
    const m = mode as HydeMode;
    return { word: m === 'CHASE' ? 'CHASING' : HYDE[m].word, hot: m === 'CHASE' };
  }
  if (enemy === 'crackstone' && isCrackMode(mode)) return { word: CRACK_CHIP[mode].word, hot: mode === 'CHASE' || mode === 'ATTACK' };
  if (enemy === 'slurp' && typeof mode === 'string' && (SLURP_MODES as string[]).includes(mode)) {
    const m = mode as SlurpMode;
    return { word: SLURP_WORD[m], hot: m === 'CHASE' || m === 'ATTACK' };
  }
  return null;
}

type EnemyWire = { present?: unknown; active?: unknown; mode?: unknown; spawned?: unknown };

/**
 * The three monsters' public states from a station status / heartbeat, feature-detected (null = the station does not
 * report Slurp yet → keep the older chips). Accepts `enemies: { hyde | crackstone | slurp: { present?, active?, mode? } }`
 * or flat fields `hydeMode` / `crackstoneMode` / `slurpMode` (+ `crackstonePresent` / `slurpPresent` / `…Active`).
 * Only monsters present in the case are listed; an inactive one reads "Away". Never a position.
 */
export function monsterChipsOf(src: unknown, active: boolean): MonsterChip[] | null {
  if (!active || src === null || typeof src !== 'object') return null;
  const o = src as Record<string, unknown>;
  const nested = o.enemies !== null && typeof o.enemies === 'object' ? (o.enemies as Partial<Record<EnemyId, EnemyWire>>) : null;
  const flat = 'slurpMode' in o || 'slurpPresent' in o || 'slurpActive' in o;
  if (!nested && !flat) return null;
  const out: MonsterChip[] = [];
  for (const enemy of ENEMY_IDS) {
    const w: EnemyWire | undefined = nested ? nested[enemy] : {
      present: enemy === 'hyde' ? true : o[`${enemy}Present`],
      active: o[`${enemy}Active`],
      mode: o[`${enemy}Mode`],
    };
    if (!w || w.present === false) continue;
    if (enemy !== 'hyde' && w.present !== true && w.mode == null && w.active == null) continue; // not in this case
    const mw = modeWord(enemy, w.mode);
    if (w.active === false || w.spawned === false || !mw) out.push({ enemy, word: 'Away', away: true, hot: false });
    else out.push({ enemy, word: mw.word, away: false, hot: mw.hot });
  }
  return out.length > 0 ? out : null;
}

function hydeChip(mode: HydeMode | null, emerged: boolean | null, active: boolean): StationCardView['hyde'] {
  if (!active) return null;
  if (emerged === false) return { word: 'Not out yet', icon: 'hourglass', chase: false };
  if (!mode) return null;
  return { ...HYDE[mode], chase: mode === 'CHASE' };
}

function bandWord(p: number): 'Low' | 'Medium' | 'High' {
  const b = bandFor(p);
  return b === 'high' ? 'High' : b === 'medium' ? 'Medium' : 'Low';
}

function duoText(d: Duo): string {
  const who = NIGHTSHADES[d.characterId as keyof typeof NIGHTSHADES]?.shortName ?? d.characterId;
  const mon = PARTNERS[d.pokemonId as keyof typeof PARTNERS]?.name ?? d.pokemonId;
  return `${who} & ${mon}`;
}

// ----------------------------------------------------------------------------------------------------- KPI ribbon

export interface KpiView {
  key: 'runs' | 'solved' | 'extraction' | 'median' | 'chases' | 'curses';
  label: string;
  /** The tile's visible label at 1366 (six tiles + the live badges share one header row); `label` stays in the tooltip. */
  short: string;
  value: string;
  /** Sample size behind the value. */
  n: number;
  small: boolean;
  title: string;
}

const KPI_SHORT: Record<KpiView['key'], string> = {
  runs: 'Runs', solved: 'Solved', extraction: 'Extraction', median: 'Median time', chases: 'Hyde chases', curses: 'Curses dodged',
};

/** Curse casts / hits / misses over ENDED runs (finished or DNF) of the given sessions. */
export interface CurseCounts { cast: number; hit: number; miss: number }

/** Count Crackstone curses in ended sessions' events (the local board's own records). */
export function curseCounts(sessions: readonly { events: readonly StampedEvent[]; result?: { outcome: string } | null }[]): CurseCounts {
  const c: CurseCounts = { cast: 0, hit: 0, miss: 0 };
  for (const r of sessions) {
    if (r.result?.outcome !== 'finished' && r.result?.outcome !== 'dnf') continue;
    for (const e of r.events) {
      if (e.type !== 'curse') continue;
      if (e.phase === 'cast') c.cast++;
      else if (e.phase === 'hit') c.hit++;
      else c.miss++;
    }
  }
  return c;
}

/** The analytics aggregate's curse counts when it has them (fullstack: `cursesCast` / `cursesHit`), else null. */
export function curseCountsOf(d: object): CurseCounts | null {
  const x = d as { cursesCast?: unknown; cursesHit?: unknown };
  if (typeof x.cursesCast !== 'number' || typeof x.cursesHit !== 'number') return null;
  return { cast: x.cursesCast, hit: x.cursesHit, miss: Math.max(0, x.cursesCast - x.cursesHit) };
}

/**
 * Header KPI ribbon for the selected case scope: "—" when n = 0, "small sample" when n < 10 (pure). `curses` (casts /
 * misses over ended runs) adds "Curses dodged" — below 50 % would mean a warning is too short.
 */
export function kpiRibbon(d: Pick<DescriptiveAggregate, 'runs' | 'finished' | 'dnf' | 'caseSolvedPctOfFinished' | 'extractionPct' | 'medianTimeS' | 'detectionsPerRun'>, curses: CurseCounts | null = null): KpiView[] {
  const ended = d.finished + d.dnf;
  const pct = (x: number | null, n: number) => (n === 0 || x === null ? '—' : `${Math.round(x)}%`);
  const k = (key: KpiView['key'], label: string, value: string, n: number, title: string): KpiView =>
    ({ key, label, short: KPI_SHORT[key], value, n, small: n > 0 && n < SMALL_SAMPLE_N, title: `${label}: ${title} · n = ${n}` });
  // the analytics aggregate's own "Curses dodged %" (cursesDodgedPct, n = cursesCast) wins; else counted from records
  const ag = d as { cursesDodgedPct?: number | null; cursesCast?: number; cursesSmallSample?: boolean };
  const fromAgg = typeof ag.cursesCast === 'number' && ag.cursesDodgedPct !== undefined;
  const c = fromAgg ? { cast: ag.cursesCast!, hit: 0, miss: 0 } : curses ?? curseCountsOf(d) ?? { cast: 0, hit: 0, miss: 0 };
  const dodged = fromAgg ? ag.cursesDodgedPct ?? null : c.cast > 0 ? (100 * Math.min(c.cast, c.miss)) / c.cast : null;
  return [
    k('runs', 'Runs', String(d.runs), d.runs, 'Sessions in this scope'),
    k('solved', 'Case solved', pct(d.caseSolvedPctOfFinished, d.finished), d.finished, 'Case solved ÷ finished runs'),
    k('extraction', 'Extraction success', pct(d.extractionPct, ended), ended, 'Egg delivered to Iago Tower ÷ ended runs'),
    k('median', 'Median time', d.finished === 0 || d.medianTimeS === null ? '—' : mmss(d.medianTimeS), d.finished, 'Median active time of finishers'),
    k('chases', 'Hyde chases / run', ended === 0 || d.detectionsPerRun === null ? '—' : d.detectionsPerRun.toFixed(1), ended, 'Chase onsets per ended run'),
    k('curses', 'Curses dodged', pct(dodged, c.cast), c.cast, 'Crackstone curse misses ÷ casts over ended runs (below 50 % a warning is too short) · casts'),
  ];
}
