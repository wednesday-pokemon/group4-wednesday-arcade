// Training-row schema for data/mystery/rows.csv: one row per 1 Hz snapshot of a simulated episode, holding every raw
// input the FeatureInput needs (snapshot, previous distance, live context, duo numbers) plus the labels. The scripts
// rebuild FeatureInputs from these rows with the same feature code the live service uses.
// Overhaul columns: hydeEmerged / hydeVisible (snapshot, public), emergedAt (investigation().hydeEmergedAt, public) and
// EVALUATION-ONLY columns filled by scripts/mystery-generate.ts (never features, never read by the live service):
// eggPost / cluePost = the live Bayesian posteriors at t, eggTrue / clueTrue = the session's hidden true site indices,
// used only to score the posteriors' calibration offline.
// Enemy contract (mystery-gen-4): the snapshot's Crackstone columns (crackstonePresent / Mode / DistanceM / Occluded /
// Visible / Suspicion — raw data; NOT features of the Hyde models) and EVALUATION-ONLY columns crackHere (the live
// rule-based forecasts.crackstone.here.p at t) / crackFact and crackSeen10 (label: a crackstone_sighted event — sight,
// proximity or scan — in (t, t + 10 s]). Rows of older files have no Crackstone columns: absent (CRACKSTONE_ABSENT_SNAPSHOT).
import {
  CRACKSTONE_ABSENT_SNAPSHOT, type CaseId, type CrackstoneMode, type EggState, type HydeMode, type Objective, type RoomId, type Stance, type StateSnapshot, type StampedEvent,
} from '../types.ts';
import { clueCountFor, isCaseId } from './caseInfo.ts';
import { DUO_NUMBER_KEYS, type DuoNumbers, type FeatureInput } from './features.ts';
import { anyWithin, DETECTION_HORIZON_S, detectionTimes, isProgressEvent } from './labels.ts';
import type { SimEpisode } from './episodes.ts';
import type { LiveContext } from './types.ts';

// `session` must stay the first column (the generator groups shard output by it). `caseId` / `caseVersion` /
// `clueTotal` identify the case of the episode (empty in pre-case files → legacy, 3 clues).
export const ROW_COLUMNS = [
  'session', 'duoIndex', 'characterId', 'pokemonId', 'profile', 'caseId', 'caseVersion', 'clueTotal',
  't', 'roomId', 'stance', 'speed', 'hp', 'catches', 'hidden', 'eggState', 'eggSecurity', 'cluesFound', 'hydeMode',
  'hydeDistanceM', 'hydeOccluded', 'hydeSuspicion', 'recentNoise', 'powerReady', 'moveReady', 'objective',
  'prevHydeDistanceM', 'hydeEmerged', 'hydeVisible', 'emergedAt',
  'cx', 'cz', 'hydeX', 'hydeZ', 'hydeFacingCos', 'inFog', 'hidingSpotDistM', 'objectiveDistM', 'noiseRadiusM', 'hydeNeutralized',
  'crackstonePresent', 'crackstoneMode', 'crackstoneDistanceM', 'crackstoneOccluded', 'crackstoneVisible', 'crackstoneSuspicion',
  ...DUO_NUMBER_KEYS,
  'det15', 'extraction', 'eta',
  'eggPost', 'eggTrue', 'cluePost', 'clueTrue',
  'crackHere', 'crackFact', 'crackSeen10',
] as const;

/** Horizon of the Crackstone evaluation label (the rule-based forecast's horizon). */
export const CRACK_LABEL_HORIZON_S = 10;

/** Ascending times of Crackstone detections of the player (crackstone_sighted: sight, proximity or scan). */
export function crackSightingTimes(events: readonly StampedEvent[]): number[] {
  return events.filter((e) => e.type === 'crackstone_sighted').map((e) => e.t);
}

export type Row = Record<(typeof ROW_COLUMNS)[number], string>;

const b = (v: boolean) => (v ? '1' : '0');
const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : String(Math.round(v * 10000) / 10000));

export interface EpisodeRows {
  rows: string[][]; // in ROW_COLUMNS order
  detectionRows: number;
  positives: number;
}

/** Per-sample extra cells (aligned with the episode's samples), e.g. the evaluation-only posterior / truth columns. */
export type ExtraCells = Partial<Record<(typeof ROW_COLUMNS)[number], string>>;

/**
 * Labelled rows of one episode (see labels.ts for the exact definitions). Detection labels exist only once the Hyde
 * has emerged (before that nothing can detect the player and the live service shows no detection forecast).
 */
export function episodeRows(ep: SimEpisode, meta: { duoIndex: number; profile: string }, duo: DuoNumbers, extra: readonly ExtraCells[] = [], emergedAt: readonly (number | null)[] = []): EpisodeRows {
  const events = ep.collector.events;
  const det = detectionTimes(events);
  const progress = events.filter(isProgressEvent).map((e) => e.t);
  const samples = ep.collector.samples;
  const endT = ep.collector.latestT();
  const extraction = ep.timedOut || !ep.result ? '' : ep.result.outcome === 'finished' ? '1' : '0';
  const crackSeen = crackSightingTimes(events);
  const rows: string[][] = [];
  let detectionRows = 0;
  let positives = 0;
  for (let i = 0; i < samples.length; i++) {
    const { snapshot: s, context: c } = samples[i];
    const prev = i > 0 ? samples[i - 1].snapshot : null;
    let det15 = '';
    const censored = ep.timedOut && s.t + DETECTION_HORIZON_S > endT;
    const emerged = s.hydeEmerged !== false;
    if (s.hydeMode !== 'CHASE' && !censored && emerged) {
      const y = anyWithin(det, s.t);
      det15 = y ? '1' : '0';
      detectionRows++;
      if (y) positives++;
    }
    // Crackstone label (evaluation only): sighted within (t, t + 10 s]; right-censored near the end of the log
    let crackSeen10 = '';
    if (s.crackstonePresent && s.t + CRACK_LABEL_HORIZON_S <= endT) crackSeen10 = anyWithin(crackSeen, s.t, CRACK_LABEL_HORIZON_S) ? '1' : '0';
    let eta = '';
    if (s.objective !== 'accuse' && s.objective !== 'done') {
      const next = progress.find((x) => x > s.t);
      if (next !== undefined) eta = n(next - s.t);
    }
    const r: Record<string, string> = {
      session: ep.seed, duoIndex: String(meta.duoIndex), characterId: ep.duo.characterId, pokemonId: ep.duo.pokemonId, profile: meta.profile,
      caseId: ep.run.caseDef.id, caseVersion: String(ep.run.caseDef.version), clueTotal: String(ep.run.caseDef.clues.length),
      t: n(s.t), roomId: s.roomId ?? '', stance: s.stance, speed: n(s.speed), hp: n(s.hp), catches: String(s.catches), hidden: b(s.hidden),
      eggState: s.eggState, eggSecurity: n(s.eggSecurity), cluesFound: String(s.cluesFound), hydeMode: s.hydeMode,
      hydeDistanceM: n(s.hydeDistanceM), hydeOccluded: b(s.hydeOccluded), hydeSuspicion: n(s.hydeSuspicion), recentNoise: n(s.recentNoise),
      powerReady: b(s.powerReady), moveReady: b(s.moveReady), objective: s.objective, prevHydeDistanceM: prev ? n(prev.hydeDistanceM) : '',
      hydeEmerged: b(emerged), hydeVisible: b(s.hydeVisible === true), emergedAt: n(emergedAt[i] ?? null),
      cx: n(c?.x), cz: n(c?.z), hydeX: n(c?.hydeX), hydeZ: n(c?.hydeZ), hydeFacingCos: n(c?.hydeFacingCos), inFog: c ? b(c.inFog) : '',
      hidingSpotDistM: n(c?.hidingSpotDistM), objectiveDistM: n(c?.objectiveDistM ?? null), noiseRadiusM: n(c?.noiseRadiusM),
      hydeNeutralized: c ? b(c.hydeNeutralized) : '',
      crackstonePresent: b(s.crackstonePresent === true), crackstoneMode: s.crackstonePresent ? s.crackstoneMode : '',
      crackstoneDistanceM: s.crackstonePresent ? n(s.crackstoneDistanceM) : '', crackstoneOccluded: s.crackstonePresent ? b(s.crackstoneOccluded) : '',
      crackstoneVisible: s.crackstonePresent ? b(s.crackstoneVisible) : '', crackstoneSuspicion: s.crackstonePresent ? n(s.crackstoneSuspicion) : '',
      crackSeen10,
      det15, extraction, eta,
      ...(extra[i] ?? {}),
    };
    for (const k of DUO_NUMBER_KEYS) r[k] = n(duo[k]);
    rows.push(ROW_COLUMNS.map((col) => r[col] ?? ''));
  }
  return { rows, detectionRows, positives };
}

/** The snapshot's Crackstone fields of a row; rows of older files (no Crackstone columns) are "absent". */
export function crackstoneFromRow(r: Row): typeof CRACKSTONE_ABSENT_SNAPSHOT {
  if (r.crackstonePresent === undefined || r.crackstonePresent !== '1') return { ...CRACKSTONE_ABSENT_SNAPSHOT };
  const nn = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));
  return {
    crackstonePresent: true,
    crackstoneMode: (r.crackstoneMode || 'PATROL') as CrackstoneMode,
    crackstoneDistanceM: nn(r.crackstoneDistanceM, CRACKSTONE_ABSENT_SNAPSHOT.crackstoneDistanceM),
    crackstoneOccluded: r.crackstoneOccluded === undefined || r.crackstoneOccluded === '' ? true : r.crackstoneOccluded === '1',
    crackstoneVisible: r.crackstoneVisible === '1',
    crackstoneSuspicion: nn(r.crackstoneSuspicion, 0),
  };
}

export function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const o = {} as Record<string, string>;
    header.forEach((h, i) => (o[h] = cells[i] ?? ''));
    return o as Row;
  });
}

const num = (s: string, d = 0) => (s === '' ? d : Number(s));
const bool = (s: string) => s === '1';

/** Rebuilds the FeatureInput of a row (identical to what the live service sees). */
export function featureInputFromRow(r: Row): FeatureInput {
  const snapshot: StateSnapshot = {
    // older files (no overhaul columns): the Hyde was present from t = 0 and visibility was not recorded
    hydeEmerged: r.hydeEmerged === undefined || r.hydeEmerged === '' ? true : bool(r.hydeEmerged),
    hydeVisible: r.hydeVisible === undefined || r.hydeVisible === '' ? false : bool(r.hydeVisible),
    t: num(r.t), roomId: (r.roomId || null) as RoomId | null, stance: r.stance as Stance, speed: num(r.speed), hp: num(r.hp),
    catches: num(r.catches), hidden: bool(r.hidden), eggState: r.eggState as EggState, eggSecurity: num(r.eggSecurity),
    cluesFound: num(r.cluesFound), hydeMode: r.hydeMode as HydeMode, hydeDistanceM: num(r.hydeDistanceM), hydeOccluded: bool(r.hydeOccluded),
    hydeSuspicion: num(r.hydeSuspicion), recentNoise: num(r.recentNoise), powerReady: bool(r.powerReady), moveReady: bool(r.moveReady),
    objective: r.objective as Objective,
    ...crackstoneFromRow(r),
  };
  const prev = r.prevHydeDistanceM === '' ? null : { ...snapshot, hydeDistanceM: num(r.prevHydeDistanceM) };
  const context: LiveContext | null = r.cx === '' ? null : {
    x: num(r.cx), z: num(r.cz), hydeX: num(r.hydeX), hydeZ: num(r.hydeZ), hydeFacingCos: num(r.hydeFacingCos), inFog: bool(r.inFog),
    hidingSpotDistM: num(r.hidingSpotDistM, 99), objectiveDistM: r.objectiveDistM === '' ? null : num(r.objectiveDistM),
    noiseRadiusM: num(r.noiseRadiusM), hydeNeutralized: bool(r.hydeNeutralized),
  };
  const duo = {} as DuoNumbers;
  for (const k of DUO_NUMBER_KEYS) duo[k] = num(r[k], 1);
  const caseId: CaseId | null = isCaseId(r.caseId) ? r.caseId : null;
  const clueTotal = r.clueTotal ? num(r.clueTotal) : clueCountFor(caseId);
  return { snapshot, prev, context, duo, caseId, clueTotal };
}
