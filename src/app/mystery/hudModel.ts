// Pure view-model for the mystery HUD (UX_OVERHAUL §1–§7): turns public run state + the frame's events into a
// throttled snapshot — threat state (held ≥ 0.5 s) + DORMANT countdown, effect chips, Hyde bearing, noise meter +
// hearing radius, hidden / too-close, objective, clues, egg, Q/R ability slots, interaction prompt, ClueCard,
// ExamineToast, the Thing stack, directional sound captions, toasts and the Odds panel. Joseph Crackstone
// (UX_ENEMIES): his status plaque, the telegraph banner, the Vitals CURSED row and the ONE threat-edge chevron
// (Hyde CHASE > Crackstone ATTACK > Crackstone CHASE > Hyde SEARCH) — see ./hud/crackstone.ts.
import type { EggTier } from '../../game/types.ts';
import type {
  AbilityDef, CaseDef, ClueDef, ClueId, EggState, GameEvent, HydeMode, InvestigationState, NoiseSource, Objective, RunStatus, Stance,
} from '../../mystery/types.ts';
import type { Interactable, MysteryRunLike } from './runTypes.ts';
import { CASES } from '../../mystery/data/cases.ts';
import type { SpokenLine } from './thingLines.ts';
import type { StackKind } from './hud/thingStack.ts';
import type { BannerView, CrackHudView } from './hud/crackstone.ts';
import type { EnemyId } from '../../mystery/types.ts';
import type { ThreatChipView } from './hud/enemies.ts';
import { HIDDEN_ODDS_V3, type OddsV3View } from './hud/oddsV3.ts';
import type { CabinetView } from './hud/cabinet.ts';
import type { WeemsButtonView, WeemsCardView } from './hud/weems.ts';
import type { TallyView } from './hud/tally.ts';

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
  /** Ability SLOT id ('F' power / 'Q' move); the key cap shown is ABILITY_KEY_LABEL[key] (Q / R). */
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

export interface Toast { id: number; tone: 'danger' | 'lantern' | 'success' | 'info'; headline: string; sub: string | null; icon: 'claw' | 'shieldCheck' | 'lock' | ClueDef['icon'] }

/** TL;DR clue card (UX §5): CLUE FOUND · title · `short` (fallback: deduction) · Meaning (when the case has one). */
export interface ClueCardView {
  id: number; clueId: ClueId;
  /** Card title: ClueDef.shortTitle ?? title (fits the 400 px card). */
  title: string;
  /** The full ClueDef.title (screen reader + tooltip). */
  fullTitle: string;
  short: string; meaning: string | null; icon: ClueDef['icon'];
  /** Last 300 ms: flies into its objective pip. */
  leaving: boolean;
}

/** Replaces the E prompt in place for 3 s: examine result, empty site, passage / switch. Second line = cyan odds change. */
export interface ExamineToastView { id: number; kind: 'examine' | 'empty' | 'passage' | 'switch'; head: string | null; text: string; odds: string | null }

export interface StackView { id: string; kind: StackKind; head: string; text: string; why: string | null; basis: 'rule' | 'pattern' | null; priority: number }

export type HydeLevel = 0 | 1 | 2;

/** The one screen-edge chevron (§4 order). `icon` null = the plain chevron (the Hyde). */
export interface ThreatEdgeView { at: { x: number; y: number; rot: number }; enemy: 'hyde' | 'crack' | 'slurp'; icon: 'hat' | 'curse' | 'slurp' | null; strong: boolean }

/** Minimap danger view (UX_FINAL §1d): the ONE threat layer shown, and why. */
export interface LensView {
  enemy: EnemyId;
  auto: boolean;
  /** The lens enemy is not on the map: spawn pins ("may appear"). */
  inactive: boolean;
  label: string;
  /** Monsters of this case (toggle icons). */
  present: EnemyId[];
}

/** Death sequence overlay (UX_FINAL §3). */
export interface DeathView {
  phase: 'cutscene' | 'card';
  enemy: EnemyId;
  reduced: boolean;
  /** Skip button visible (t0 + 0.5 s, cutscene only). */
  skip: boolean;
  /** Bottom-left letterbox caption. */
  caption: string;
  card: { kicker: string; name: string; flavour: string; why: string[]; tally: string; countdownS: number } | null;
}
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
    /** The Hyde is in play (before emergence: DORMANT pill with the countdown). */
    emerged: boolean;
    emergesInS: number | null;
  };
  objective: Objective;
  /** The short objective sentence (UX §1): "Find 3 clues." … */
  objectiveText: string;
  clues: { found: readonly ClueId[]; total: number; order: ClueId[] };
  egg: { state: EggState; tier: Exclude<EggTier, 'none'> | null; points: number; security: number; seenLabel: string | null };
  power: AbilityHud;
  move: AbilityHud;
  prompt: (Interactable & { warning: string | null; standStill: boolean }) | null;
  examineToast: ExamineToastView | null;
  clueCard: ClueCardView | null;
  stack: { log: StackView | null; card: StackView | null };
  captions: Caption[];
  toast: Toast | null;
  catchFlashSeq: number;
  hintCooldownS: number;
  hintLevel: 0 | 1 | 2 | 3;
  /** Detection risk (pill right segment; ≤ 1 Hz, band held ≥ 2 s); null before emergence / in the tutorial. */
  risk: RiskView | null;
  /** Odds panel v3 (UX_FINAL §1c): one line per monster + the objective row. */
  odds: OddsV3View;
  /** Current area / room name (minimap chip). */
  areaName: string | null;
  /** Joseph Crackstone's plaque (null = no Crackstone in this case: the Hyde pill keeps its centred box). */
  crack: CrackHudView | null;
  /** Scan / curse telegraph banner (curse > scan), null when none. */
  banner: BannerView | null;
  /** Vitals CURSED row: seconds of slow left, null when not cursed. */
  cursedLeftS: number | null;
  /** The single threat-edge chevron, null when none applies. */
  threatEdge: ThreatEdgeView | null;
  // ---- final (UX_FINAL) — optional so older fixtures still render (the strip is then derived from hyde / crack)
  /** Threats strip: Hyde · Crackstone · Slurp chips (absent monsters omitted). */
  threats?: ThreatChipView[];
  lens?: LensView | null;
  tally?: TallyView;
  cabinet?: CabinetView;
  weems?: { button: WeemsButtonView; card: WeemsCardView | null } | null;
  death?: DeathView | null;
  /** Slurp chases / grabs (orchid mist). */
  slurpHunting?: boolean;
  /** Pulled out of a cabinet: catch flash tinted in that enemy's colour. */
  catchTint?: EnemyId | null;
}

/** UX §1 objective copy (R5: the egg line never names a site). */
export const OBJECTIVE_TEXT: Record<Objective, string> = {
  find_clues: 'Find 3 clues.',
  find_egg: 'Find the egg.',
  retrieve_egg: 'Pick up the egg (E).',
  deliver_egg: 'Take the egg to Iago Tower.',
  accuse: 'Name the culprit.',
  done: 'Case closed.',
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

export function effectChip(run: MysteryRunLike): { word: string; leftS: number | null } | null {
  const fx = run.effects();
  const h = run.hyde;
  const left = (until: number) => (until > run.t ? Math.round((until - run.t) * 10) / 10 : null);
  // a held look is a stun OR a slow (Spirit Shackle pins with a slow): name the look, time whichever effect holds it
  if (fx.hydePetrified) return { word: run.hydeVisual?.() === 'pin' ? 'PINNED' : 'PETRIFIED', leftS: left(Math.max(h.stunnedUntil, h.slowedUntil)) };
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
  captions: Caption[];
  toast: Toast | null;
  catchFlashSeq: number;
  hintCooldownS: number;
  hintLevel?: 0 | 1 | 2 | 3;
  noiseRadiusM: number;
  bearing: { angle: number; distanceM: number } | null;
  risk: RiskView | null;
  /** Renderer projection of the Hyde (preferred over the bearing when available). */
  hydeScreen: { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean } | null;
  /** Public investigation state (run.investigation()), when the sim has it. */
  investigation?: InvestigationState | null;
  hydeEmerged?: boolean;
  clueCard?: ClueCardView | null;
  examineToast?: ExamineToastView | null;
  stack?: { log: StackView | null; card: StackView | null };
  odds?: OddsV3View;
  threats?: ThreatChipView[];
  lens?: LensView | null;
  tally?: TallyView;
  cabinet?: CabinetView;
  weems?: { button: WeemsButtonView; card: WeemsCardView | null } | null;
  death?: DeathView | null;
  /** Slurp's CHASE / ATTACK edge point (R4: his chase is public), null otherwise. */
  slurpEdge?: { x: number; y: number; rot: number } | null;
  slurpHunting?: boolean;
  catchTint?: EnemyId | null;
  /** E is held while moving (hold-to-search needs standing still). */
  standStill?: boolean;
  areaName?: string | null;
  crack?: CrackHudView | null;
  banner?: BannerView | null;
  cursedLeftS?: number | null;
  /** Crackstone edge candidates (R4-gated by the loop): his CHASE / ATTACK point and the curse circle cue. */
  crackEdge?: { chase: { x: number; y: number; rot: number } | null; attack: { x: number; y: number; rot: number } | null; curse: { x: number; y: number; rot: number } | null } | null;
}

/**
 * The ONE threat-edge chevron (UX_ENEMIES §4): Hyde CHASE > Crackstone ATTACK (curse circle cue first, else his
 * position) > Crackstone CHASE > Hyde SEARCH. Crackstone SEARCH never gets a chevron (his position is not public).
 */
export function pickThreatEdge(
  hydeMode: HydeMode, hydeAt: { x: number; y: number; rot: number } | null, crack: HudExtras['crackEdge'] | null | undefined, crackMode: 'CHASE' | 'ATTACK' | null,
  slurpAt: { x: number; y: number; rot: number } | null = null,
): ThreatEdgeView | null {
  if (hydeMode === 'CHASE') return hydeAt ? { at: hydeAt, enemy: 'hyde', icon: null, strong: true } : null;
  if (crackMode === 'ATTACK') {
    if (crack?.curse) return { at: crack.curse, enemy: 'crack', icon: 'curse', strong: true };
    if (crack?.attack) return { at: crack.attack, enemy: 'crack', icon: 'curse', strong: true };
  }
  if (crackMode === 'CHASE' && crack?.chase) return { at: crack.chase, enemy: 'crack', icon: 'hat', strong: true };
  // UX_FINAL §1a: the single ENGAGED enemy first (≤ 1 engaged at a time), then the Hyde's SEARCH
  if (slurpAt) return { at: slurpAt, enemy: 'slurp', icon: 'slurp', strong: true };
  if (hydeMode === 'SEARCH' && hydeAt) return { at: hydeAt, enemy: 'hyde', icon: null, strong: false };
  return null;
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
  const x = 0.5 + dx * k;
  const y = 0.5 + dy * k;
  const rot = Math.atan2(dx, -dy);
  // the bottom-centre column (captions + ThingStack, x 403–963) would hide a "behind you" chevron: move it to the free
  // gap beside the stack on the side of the shortest turn (still pointing the same way)
  if (y > 0.85 && x > 0.27 && x < 0.73) return { x: dx < 0 ? 0.25 : 0.75, y: 0.93, rot };
  return { x, y, rot };
}


/** Prompt copy (UX §5): tower warning before deposit, the egg set-down hold. */
export function promptView(prompt: Interactable | null, found: number, total: number, standStill: boolean): MysteryHudModel['prompt'] {
  if (!prompt) return null;
  const label = prompt.kind === 'egg' && /set the egg down/i.test(prompt.label) ? 'Hold E: set the egg down' : prompt.label;
  return {
    ...prompt,
    label,
    warning: prompt.kind === 'tower' && found < total ? `${found} of ${total} clues — the case will stay unsolved.` : null,
    standStill: standStill && (prompt.kind === 'clue' || prompt.kind === 'examine' || prompt.kind === 'lever' || prompt.kind === 'practice'),
  };
}

export function buildHud(run: MysteryRunLike, x: HudExtras): MysteryHudModel {
  const p = run.player;
  const h = run.hyde;
  const eggKnown = run.egg.state !== 'resting';
  const found = run.cluesFound.length;
  const total = run.caseDef.clues.length;
  const edgeAt = x.shownMode === 'SEARCH' || x.shownMode === 'CHASE' ? threatEdgePoint(x.hydeScreen, x.bearing) : null;
  const inv = x.investigation ?? null;
  const world = run.map.world ?? null;
  const seenLabel = inv?.eggSeenAt ? world?.eggSites.find((s) => s.id === inv.eggSeenAt)?.label ?? null : null;
  const emerged = x.hydeEmerged ?? true;
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
      emerged,
      emergesInS: emerged ? null : inv?.hydeEmergesInS ?? null,
    },
    objective: run.objective(),
    objectiveText: objectiveText(run),
    clues: { found: run.cluesFound, total, order: run.caseDef.clues.map((c) => c.id) },
    egg: { state: run.egg.state, tier: eggKnown ? run.egg.tier : null, points: run.egg.points, security: run.egg.security, seenLabel },
    power: abilityHud('F', run.powerStatus(), x.power, x.now),
    move: abilityHud('Q', run.moveStatus(), x.move, x.now),
    prompt: promptView(run.interactable(), found, total, !!x.standStill),
    examineToast: x.examineToast ?? null,
    clueCard: x.clueCard ?? null,
    stack: x.stack ?? { log: null, card: null },
    captions: x.captions,
    toast: x.toast,
    catchFlashSeq: x.catchFlashSeq,
    hintCooldownS: x.hintCooldownS,
    hintLevel: x.hintLevel ?? 0,
    risk: x.risk,
    odds: x.odds ?? HIDDEN_ODDS_V3,
    areaName: x.areaName ?? null,
    crack: x.crack ?? null,
    banner: x.banner ?? null,
    cursedLeftS: x.cursedLeftS ?? null,
    threatEdge: emerged || x.crack || x.slurpEdge
      ? pickThreatEdge(emerged ? x.shownMode : 'PATROL', emerged ? edgeAt : null, x.crackEdge, x.crack?.key === 'CHASE' || x.crack?.key === 'ATTACK' ? x.crack.key : null, x.slurpEdge ?? null)
      : null,
    ...(x.threats ? { threats: x.threats } : {}),
    ...(x.lens !== undefined ? { lens: x.lens } : {}),
    ...(x.tally ? { tally: x.tally } : {}),
    ...(x.cabinet ? { cabinet: x.cabinet } : {}),
    ...(x.weems !== undefined ? { weems: x.weems } : {}),
    ...(x.death !== undefined ? { death: x.death } : {}),
    slurpHunting: !!x.slurpHunting,
    catchTint: x.catchTint ?? null,
  };
}

/**
 * Numbers at the precision the HUD actually shows them (by field name). Fields not listed keep 2 decimals; `t` (sim
 * time) is not drawn. Two models with the same key render the same DOM, so the loop skips the React update.
 */
const HUD_KEY_ROUND: Readonly<Record<string, ((v: number) => number) | null>> = {
  t: null,
  level: (v) => Math.round(v * 10), // noise meter: 10 segments (Hyde level is an int)
  suspicion: (v) => Math.round(v * 100), // pill underline %
  angle: (v) => Math.round(v * 20),
  distanceM: Math.round,
  x: (v) => Math.round(v * 400), // edge chevrons: 0.25 % of the screen
  y: (v) => Math.round(v * 400),
  rot: (v) => Math.round(v * 50),
  hp: Math.round,
  security: Math.round,
  cooldownLeftS: Math.ceil, // "12 s"
  activeLeftS: (v) => Math.round(v * 10), // "ACTIVE 3.2 s"
  leftS: (v) => Math.round(v * 10),
  emergesInS: Math.ceil, // "0:18"
  cursedLeftS: (v) => Math.round(v * 10),
  progress: (v) => Math.round(v * 60), // hold rings
  radiusM: Math.round,
  p: (v) => Math.round(v * 100),
};

/** Large subtrees that are replaced wholesale (the Odds view ≤ 1 Hz) are keyed by identity, not stringified. */
const OBJ_ID = new WeakMap<object, number>();
let objSeq = 0;
const idOf = (o: object): number => {
  let i = OBJ_ID.get(o);
  if (i === undefined) {
    i = ++objSeq;
    OBJ_ID.set(o, i);
  }
  return i;
};

export function hudRenderKey(m: MysteryHudModel): string {
  return JSON.stringify(m, function (this: unknown, k: string, v: unknown) {
    if (k === 'odds' && v && typeof v === 'object') return idOf(v);
    if (k === 'art') return undefined; // portrait URLs never change during a run
    if (typeof v !== 'number') return v;
    const r = HUD_KEY_ROUND[k];
    if (r === null) return undefined;
    return r ? r(v) : Math.round(v * 100) / 100;
  });
}

/** Clue title for Thing/captions: the case text when available. */
export function clueTitle(run: MysteryRunLike, id: string): string {
  const c = run.caseDef.clues.find((x) => x.id === id);
  return c?.title ?? id;
}

/** The objective line for this run (UX §1; the clue count comes from the case). */
export function objectiveText(run: MysteryRunLike): string {
  const o = run.objective();
  if (o === 'find_clues') return `Find ${run.caseDef.clues.length} clues.`;
  return OBJECTIVE_TEXT[o];
}

/** The TL;DR card for a found clue: `short` + `meaning` (overhaul copy), falling back to the board deduction. */
export function clueCardContent(caseDef: CaseDef, id: ClueId): { title: string; fullTitle: string; short: string; meaning: string | null; icon: ClueDef['icon'] } {
  const c = caseDef.clues.find((x) => x.id === id);
  if (!c) return { title: id, fullTitle: id, short: '', meaning: null, icon: 'fileText' };
  return { title: c.shortTitle ?? c.title, fullTitle: c.title, short: c.short ?? c.deduction, meaning: c.meaning ?? null, icon: c.icon };
}

/** Clue type icon (UX §4: the KIND of evidence, never who), for the clues of every case. */
export const CLUE_ICON = Object.fromEntries(
  Object.values(CASES).flatMap((c) => c.clues.map((cl) => [cl.id, cl.icon] as const)),
) as Record<ClueId, ClueDef['icon']>;
