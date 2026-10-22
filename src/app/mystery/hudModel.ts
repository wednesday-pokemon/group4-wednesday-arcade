// Pure view-model for the mystery HUD (UX_MYSTERY §4 "MysteryHudVM"): turns public run state + the frame's events into
// a throttled snapshot — threat state (held ≥ 0.5 s), effect chips, Hyde bearing, noise meter + hearing radius, hidden /
// too-close, objective, clues, egg, F/Q slots, interaction prompt, Thing line, directional sound captions, toasts.
import type { EggTier } from '../../game/types.ts';
import type {
  AbilityDef, ClueDef, ClueId, EggState, GameEvent, HydeMode, NoiseSource, Objective, RunStatus, Stance,
} from '../../mystery/types.ts';
import type { Interactable, MysteryRunLike } from './runTypes.ts';
import { CASES } from '../../mystery/data/cases.ts';
import type { SpokenLine } from './thingLines.ts';

// ------------------------------------------------------------------------------------------------- noise meter

const OWN_NOISE: ReadonlySet<NoiseSource> = new Set(['footstep', 'egg_drop', 'ability', 'interact', 'impact']);
export const NOISE_DECAY_PER_S = 0.9;

/** The player's own loudness (0..1): jumps to each own noise event, decays smoothly. Lures/decoys don't count. */
export class NoiseMeter {
  value = 0;
  update(events: readonly GameEvent[], dt: number): number {
    this.value = Math.max(0, this.value - NOISE_DECAY_PER_S * dt);
    for (const e of events) if (e.type === 'noise' && OWN_NOISE.has(e.source)) this.value = Math.max(this.value, e.loudness);
    return this.value;
  }
}

export type NoiseBand = 'silent' | 'quiet' | 'audible' | 'loud';
/** UX §4: Silent (0) / Quiet (≤ .15) / Audible (≤ .5) / LOUD. */
export function noiseBand(v: number): NoiseBand {
  if (v < 0.03) return 'silent';
  if (v <= 0.15) return 'quiet';
  if (v <= 0.5) return 'audible';
  return 'loud';
}

// ------------------------------------------------------------------------------------------------- captions

export type Direction = 'ahead' | 'left' | 'right' | 'behind';
export interface Caption { id: number; text: string; tone: 'info' | 'warn' | 'danger' | 'good'; dir: Direction | null; until: number }
const CAPTION_S = 3;
const MAX_CAPTIONS = 2;

/** Bearing (rad, 0 = ahead, + = left) → caption arrow. */
export function directionOf(angle: number): Direction {
  const a = Math.abs(angle);
  if (a <= Math.PI / 4) return 'ahead';
  if (a >= (3 * Math.PI) / 4) return 'behind';
  return angle > 0 ? 'left' : 'right';
}

const HYDE_MODE_CAPTION: Record<HydeMode, { text: string; tone: Caption['tone'] }> = {
  PATROL: { text: '[Heavy footsteps]', tone: 'info' },
  INVESTIGATE_SOUND: { text: '[Hyde sniffs the air]', tone: 'warn' },
  SEARCH: { text: '[Hyde prowls nearby]', tone: 'warn' },
  CHASE: { text: '[Hyde growls nearby]', tone: 'danger' },
  COOLDOWN: { text: '[Hyde grunts, turns away]', tone: 'info' },
};

/** The sound an ability makes, as a caption (UX §4 list); generic fallback names the move. */
export function abilitySound(abilityId: string, name: string): string {
  const id = abilityId.toLowerCase();
  if (id.includes('bee') || id.includes('swarm')) return '[Buzzing]';
  if (id.includes('siren')) return '[Siren song]';
  if (id.includes('spark') || id.includes('electric')) return '[Crackle of electricity]';
  if (id.includes('make_it_rain') || id.includes('coin')) return '[Coins clatter]';
  if (id.includes('water') || id.includes('aqua')) return '[Splash]';
  return `[${name}]`;
}

/** Captions for audio cues (own footsteps are never captioned, UX §4). `hydeDir` is the Hyde's direction now. */
export function captionFor(
  e: GameEvent, abilityName: (key: 'F' | 'Q') => string, hydeDir: Direction | null, hydeDistanceM: number,
): Pick<Caption, 'text' | 'tone' | 'dir'> | null {
  switch (e.type) {
    case 'noise':
      if (e.source === 'impact') return { text: '[Thud]', tone: 'warn', dir: null };
      return null;
    case 'hyde_mode':
      if (e.to === 'PATROL' && hydeDistanceM > 15) return null; // heavy footsteps only when within 15 m
      return { ...HYDE_MODE_CAPTION[e.to], dir: hydeDir };
    case 'catch':
      return { text: e.blocked ? '[Clang — the grab is blocked]' : '[The Hyde grabs you]', tone: 'danger', dir: null };
    case 'egg_drop':
      return { text: '[Thud — egg dropped]', tone: 'warn', dir: null };
    case 'egg_damage':
      return { text: '[Egg cracks]', tone: 'warn', dir: null };
    case 'egg_delivered':
      return { text: '[The tower bell rings]', tone: 'good', dir: null };
    case 'ability_used':
      return { text: abilitySound(e.abilityId, abilityName(e.key)), tone: e.success ? 'good' : 'info', dir: null };
    default:
      return null;
  }
}

export class CaptionLog {
  private seq = 0;
  items: Caption[] = [];
  push(c: Pick<Caption, 'text' | 'tone' | 'dir'>, now: number): void {
    const same = this.items.find((x) => x.text === c.text); // de-duplicated
    if (same) {
      same.until = now + CAPTION_S;
      same.dir = c.dir;
      return;
    }
    this.items = [...this.items, { ...c, id: ++this.seq, until: now + CAPTION_S }].slice(-MAX_CAPTIONS);
  }
  prune(now: number): Caption[] {
    this.items = this.items.filter((c) => c.until > now);
    return this.items;
  }
}

// ------------------------------------------------------------------------------------------------- Thing director

export interface ThingLineState { key: string; text: string; pose: SpokenLine['pose']; why: string | null; until: number; priority: number }
const LINE_S = 4;
const MIN_GAP_S = 1.5;

/** At most one short Thing subtitle at a time. Higher priority interrupts; equal/lower waits for a gap. */
export class ThingDirector {
  current: ThingLineState | null = null;
  private lastEndedAt = -Infinity;
  private said = new Set<string>();
  say(line: SpokenLine | null, now: number, opts: { priority?: number; once?: boolean; key?: string; why?: string | null } = {}): boolean {
    if (!line) return false;
    const key = opts.key ?? line.id;
    if (opts.once && this.said.has(key)) return false;
    const priority = opts.priority ?? 1;
    if (this.current && this.current.until > now && this.current.priority >= priority) return false;
    if (!this.current && now - this.lastEndedAt < MIN_GAP_S && priority < 2) return false;
    this.said.add(key);
    const len = line.text.length + (opts.why?.length ?? 0);
    this.current = { key, text: line.text, pose: line.pose, why: opts.why ?? null, until: now + Math.max(LINE_S, len / 14), priority };
    return true;
  }
  update(now: number): ThingLineState | null {
    if (this.current && this.current.until <= now) {
      this.current = null;
      this.lastEndedAt = now;
    }
    return this.current;
  }
  hasSaid(key: string): boolean {
    return this.said.has(key);
  }
}

// ------------------------------------------------------------------------------------------------- risk chip

export interface RiskView {
  p: number;
  band: 'low' | 'medium' | 'high';
  source: 'ml' | 'rule';
  /** Exactly "ML estimate" or "Rule-based risk estimate" (from the predictive service). */
  label: string;
  detectedNow: boolean;
}

/** The displayed risk band changes at most every `holdS` seconds (UX §4: 2 s band hold); the value tracks freely. */
export class RiskHold {
  private shown: RiskView | null = null;
  private since = -Infinity;
  constructor(private readonly holdS = 2) {}
  update(r: RiskView | null, now: number): RiskView | null {
    if (!r) return this.shown;
    if (!this.shown || r.band === this.shown.band || now - this.since >= this.holdS) {
      if (!this.shown || r.band !== this.shown.band) this.since = now;
      this.shown = { ...r };
    } else {
      this.shown = { ...r, band: this.shown.band }; // keep the band, follow the label/source
    }
    return this.shown;
  }
}

// ------------------------------------------------------------------------------------------------- threat hold

/** Holds a displayed Hyde mode for at least `holdS` so the meter never flickers (UX §4). */
export class ThreatHold {
  shown: HydeMode = 'PATROL';
  private since = -Infinity;
  constructor(private readonly holdS = 0.5) {}
  update(mode: HydeMode, now: number): HydeMode {
    if (mode !== this.shown && (now - this.since >= this.holdS || mode === 'CHASE')) {
      this.shown = mode;
      this.since = now;
    }
    return this.shown;
  }
}

// ------------------------------------------------------------------------------------------------- HUD model

export interface AbilityHud {
  key: 'F' | 'Q';
  name: string;
  art: string;
  ready: boolean;
  cooldownLeftS: number;
  cooldownS: number;
  activeLeftS: number;
  loud: boolean;
  /** Last denial (shake + reason) within the last 1.5 s. */
  denied: { seq: number; text: string } | null;
  aimed: boolean;
}

export interface Toast { id: number; tone: 'danger' | 'lantern' | 'success' | 'info'; headline: string; sub: string | null; icon: 'claw' | 'shieldCheck' | ClueDef['icon'] }

export type HydeLevel = 0 | 1 | 2;
export interface MysteryHudModel {
  t: number;
  status: RunStatus;
  hp: number;
  maxHp: number;
  catches: number;
  stance: Stance;
  hidden: boolean;
  tooClose: boolean;
  noise: { level: number; band: NoiseBand; radiusM: number };
  hyde: {
    mode: HydeMode; suspicion: number; level: HydeLevel; canSee: boolean;
    effect: { word: string; leftS: number | null } | null;
    bearing: { angle: number; distanceM: number } | null;
    edge: boolean;
    /** Screen-edge point (0..1 of width/height) for the chevron, and its rotation (rad, 0 = pointing up). */
    edgeAt: { x: number; y: number; rot: number } | null;
  };
  objective: Objective;
  /** The objective sentence for this case (HUD top-left). */
  objectiveText: string;
  clues: { found: readonly ClueId[]; total: number; order: ClueId[] };
  egg: { state: EggState; tier: Exclude<EggTier, 'none'> | null; points: number; security: number };
  power: AbilityHud;
  move: AbilityHud;
  prompt: (Interactable & { warning: string | null }) | null;
  thing: { key: string; text: string; pose: SpokenLine['pose']; why: string | null } | null;
  captions: Caption[];
  toast: Toast | null;
  evidenceToast: Toast | null;
  catchFlashSeq: number;
  hintCooldownS: number;
  /** Phase 4 predictive service (≤ 1 Hz, band held ≥ 2 s); null before the first sample / in the tutorial. */
  risk: RiskView | null;
}

export const OBJECTIVE_TEXT: Record<Objective, string> = {
  find_clues: 'Search the ruins for evidence',
  find_egg: 'Find the hidden egg',
  retrieve_egg: 'Your egg was dropped — pick it up (E)',
  deliver_egg: 'Carry the egg to Iago Tower',
  accuse: 'Name the culprit',
  done: 'Case closed',
};

export const THREAT: Record<HydeMode, { word: string; icon: 'eyeClosed' | 'ear' | 'search' | 'claw' | 'hourglass' }> = {
  PATROL: { word: 'Patrolling', icon: 'eyeClosed' },
  INVESTIGATE_SOUND: { word: 'Heard a noise', icon: 'ear' },
  SEARCH: { word: 'Searching', icon: 'search' },
  CHASE: { word: 'CHASING YOU', icon: 'claw' },
  COOLDOWN: { word: 'Losing interest', icon: 'hourglass' },
};

export function hydeLevel(mode: HydeMode, suspicion: number, grabbing: boolean): HydeLevel {
  if (mode === 'CHASE' || grabbing) return 2;
  if (mode === 'INVESTIGATE_SOUND' || mode === 'SEARCH' || suspicion >= 0.35) return 1;
  return 0;
}

export interface AbilityMeta { def: AbilityDef | null; name: string; art: string; cooldownS: number; denied: { seq: number; text: string; at: number } | null }

const AIMED_KINDS = new Set(['lure', 'dash']);

function abilityHud(key: 'F' | 'Q', st: { ready: boolean; cooldownLeftS: number; activeLeftS: number }, meta: AbilityMeta, now: number): AbilityHud {
  return {
    key, name: meta.name, art: meta.art, ready: st.ready, cooldownLeftS: st.cooldownLeftS, cooldownS: meta.cooldownS, activeLeftS: st.activeLeftS,
    loud: (meta.def?.noise ?? 0) >= 0.5,
    denied: meta.denied && now - meta.denied.at < 1.5 ? { seq: meta.denied.seq, text: meta.denied.text } : null,
    aimed: !!meta.def?.effects.some((e) => AIMED_KINDS.has(e.kind)),
  };
}

/** True when the player is inside a hiding spot but the Hyde is within that spot's reveal distance. */
export function tooCloseWhileHidden(run: MysteryRunLike): boolean {
  const p = run.player;
  if (!p.hidden) return false;
  const spot = run.map.hidingSpots.find((s) => Math.hypot(s.x - p.x, s.z - p.z) <= s.radius);
  if (!spot) return false;
  return Math.hypot(run.hyde.x - p.x, run.hyde.z - p.z) <= spot.revealM;
}

function effectChip(run: MysteryRunLike): { word: string; leftS: number | null } | null {
  const fx = run.effects();
  const h = run.hyde;
  const left = (until: number) => (until > run.t ? Math.round((until - run.t) * 10) / 10 : null);
  if (fx.hydePetrified) return { word: 'PETRIFIED', leftS: left(h.stunnedUntil) };
  if (fx.hydeStunned) return { word: 'STUNNED', leftS: left(h.stunnedUntil) };
  if (fx.hydeSlowed) return { word: 'SLOWED', leftS: left(h.slowedUntil) };
  if (fx.hydeDistracted) return { word: 'DISTRACTED', leftS: left(h.distractedUntil) };
  if (fx.lurePoint) return { word: 'LURED', leftS: null };
  return null;
}

export interface HudExtras {
  now: number;
  noise: number;
  shownMode: HydeMode;
  power: AbilityMeta;
  move: AbilityMeta;
  thing: ThingLineState | null;
  captions: Caption[];
  toast: Toast | null;
  evidenceToast: Toast | null;
  catchFlashSeq: number;
  hintCooldownS: number;
  noiseRadiusM: number;
  bearing: { angle: number; distanceM: number } | null;
  risk: RiskView | null;
  /** Renderer projection of the Hyde (preferred over the bearing when available). */
  hydeScreen: { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean } | null;
}

/**
 * Where to put the off-screen ThreatEdge chevron: the renderer's projection when available (flipped when behind the
 * camera), otherwise the bearing (0 ahead, + left; behind → bottom). Returns null while the Hyde is on screen.
 */
export function threatEdgePoint(
  hydeScreen: HudExtras['hydeScreen'], bearing: HudExtras['bearing'],
): { x: number; y: number; rot: number } | null {
  let dx: number;
  let dy: number; // screen space: +x right, +y down
  if (hydeScreen) {
    if (hydeScreen.onScreen && !hydeScreen.behind) return null;
    dx = hydeScreen.behind ? -hydeScreen.ndcX : hydeScreen.ndcX;
    dy = hydeScreen.behind ? Math.max(0.6, Math.abs(hydeScreen.ndcY)) : -hydeScreen.ndcY;
  } else if (bearing) {
    if (Math.abs(bearing.angle) <= (40 * Math.PI) / 180) return null;
    dx = -Math.sin(bearing.angle);
    dy = -Math.cos(bearing.angle);
  } else return null;
  const m = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const k = 0.46 / m;
  return { x: 0.5 + dx * k, y: 0.5 + dy * k, rot: Math.atan2(dx, -dy) };
}

export function buildHud(run: MysteryRunLike, x: HudExtras): MysteryHudModel {
  const p = run.player;
  const h = run.hyde;
  const eggKnown = run.egg.state !== 'resting';
  const prompt = run.interactable();
  const found = run.cluesFound.length;
  const edgeAt = x.shownMode === 'SEARCH' || x.shownMode === 'CHASE' ? threatEdgePoint(x.hydeScreen, x.bearing) : null;
  return {
    t: run.t,
    status: run.status,
    hp: p.hp,
    maxHp: p.maxHp,
    catches: p.catches,
    stance: p.stance,
    hidden: p.hidden,
    tooClose: tooCloseWhileHidden(run),
    noise: { level: x.noise, band: noiseBand(x.noise), radiusM: x.noiseRadiusM },
    hyde: {
      mode: x.shownMode, suspicion: h.suspicion, level: hydeLevel(x.shownMode, h.suspicion, h.grabbing), canSee: h.canSeePlayer,
      effect: effectChip(run), bearing: x.bearing,
      edge: edgeAt !== null, edgeAt,
    },
    objective: run.objective(),
    objectiveText: objectiveText(run),
    clues: { found: run.cluesFound, total: run.caseDef.clues.length, order: run.caseDef.clues.map((c) => c.id) },
    egg: { state: run.egg.state, tier: eggKnown ? run.egg.tier : null, points: run.egg.points, security: run.egg.security },
    power: abilityHud('F', run.powerStatus(), x.power, x.now),
    move: abilityHud('Q', run.moveStatus(), x.move, x.now),
    prompt: prompt && {
      ...prompt,
      warning: prompt.kind === 'tower' && found < run.caseDef.clues.length
        ? `You have ${found} of ${run.caseDef.clues.length} clues — the case may stay unsolved.`
        : null,
    },
    thing: x.thing ? { key: x.thing.key, text: x.thing.text, pose: x.thing.pose, why: x.thing.why } : null,
    captions: x.captions,
    toast: x.toast,
    evidenceToast: x.evidenceToast,
    catchFlashSeq: x.catchFlashSeq,
    hintCooldownS: x.hintCooldownS,
    risk: x.risk,
  };
}

/** Clue title for Thing/captions: the case text when available. */
export function clueTitle(run: MysteryRunLike, id: string): string {
  const c = run.caseDef.clues.find((x) => x.id === id);
  return c?.title ?? id;
}

/** The objective line for this run's case (the egg's hiding place differs per case). */
export function objectiveText(run: MysteryRunLike): string {
  const o = run.objective();
  return o === 'find_egg' ? run.caseDef.egg.objective.replace(/\.$/, '') : OBJECTIVE_TEXT[o];
}

/** Clue type icon (UX §4: the KIND of evidence, never who), for the clues of every case. */
export const CLUE_ICON = Object.fromEntries(
  Object.values(CASES).flatMap((c) => c.clues.map((cl) => [cl.id, cl.icon] as const)),
) as Record<ClueId, ClueDef['icon']>;
