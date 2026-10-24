// Per-run controller for the final HUD (docs/final/UX_FINAL.md): Threats strip, Odds v3 (≤ 1 Hz), danger-view lens,
// Tally, cabinet block, Principal Weems (button / note / hint card / Tab list) and the death sequence. useMysteryLoop
// owns one instance per run and feeds it events + public state; everything sim- or renderer-side is feature-detected
// (director, Slurp, cabinets, weemsStatus, scene.playDeath). HIDDEN TRUTH: positions only per R4 (visible / chasing /
// revealed), never run.layout / map.clues / map.eggSpawn.
import type { LiveAnalytics, LiveForecasts, LiveMessage } from '../../../mystery/analytics/types.ts';
import type { ActiveEffects, CaseDef, EnemyId, HydeMode, InvestigationState, StampedEvent, Vec2 } from '../../../mystery/types.ts';
import { ENEMY_IDS, ENEMY_NAMES } from '../../../mystery/types.ts';
import type { DeathView, LensView } from '../hudModel.ts';
import { cabinetStatusOf, CabinetTracker, cabinetView, CABINET_COPY, CABINET_NONE, hasCabinetStatus, playerCabinetPhase, type CabinetIn, type CabinetView } from './cabinet.ts';
import type { CrackHandle, CrackHudView, CrackMarkerKind } from './crackstone.ts';
import { crackMarkerKind } from './crackstone.ts';
import {
  crackChip, directorChip, ENEMY_SHORT, enemyLife, hydeChip, huntedBy, KeyHold, LensPicker, lensLabel, orderChips, slurpChaseAt, slurpChip, slurpChipKey,
  slurpEffect, slurpMarkerKind, slurpOf, type EnemyLife, type SlurpChipKey, type SlurpMarkerKind, type ThreatChipView,
} from './enemies.ts';
import { buildOddsV3, HIDDEN_ODDS_V3, OddsBandHold, oddsV3Phase, slurpForecastOf, spawnOddsOf, type OddsV3View } from './oddsV3.ts';
import type { DeltaState } from './oddsModel.ts';
import { TallyTracker, type TallyView } from './tally.ts';
import {
  hintCard, noteCard, WEEMS_CARD_S, WEEMS_FALLBACK_L3, WEEMS_MARK_S, WEEMS_NOTE_S, WEEMS_WAIT_MAX_S, WeemsController, weemsSimOf, type WeemsButtonView,
  type WeemsCardView, type WeemsContext, type WeemsLevel,
} from './weems.ts';
import { DEATH_CAPTION, DEATH_FLAVOUR, deathKicker, deathTally, deathWhy, defeatedBy, defeatedLine, DeathSequence } from './death.ts';

export const ODDS_V3_EVERY_S = 1;
const OUTSIDE_M = 4.5;
const NEAR_M = 8;

/** The structural run surface this controller reads (MysteryRunLike + feature-detected final members). */
export interface FinalRunLike {
  t: number;
  status: string;
  caseDef: CaseDef;
  readonly player: { x: number; z: number; yaw: number; cabinet?: { spotId: string; phase: string; t: number } | null };
  readonly hyde: { mode: HydeMode; suspicion: number; canSeePlayer: boolean; x: number; z: number };
  readonly cluesFound: readonly string[];
  readonly map: { hidingSpots: readonly { id: string; x: number; z: number; kind: string; doorYaw?: number }[] };
  readonly log: readonly StampedEvent[];
  objective(): string;
  effects(): ActiveEffects;
  interactable(): { kind: string; id: string; label: string } | null;
  activeTimeS?(): number;
  dnfReason?: 'second_catch' | 'hp_depleted' | null;
  tuning?: unknown;
}

export interface SceneDeathApi {
  playDeath?: (enemy: EnemyId, o: { reducedMotion: boolean; onCue?: (cue: string, enemy: EnemyId) => void }) => Promise<void> | void;
  skipDeath?: () => void;
  /** Leaves the held black end frame (the card closed / a new run). */
  stopDeath?: () => void;
  getSlurpScreen?: () => { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean } | null;
}

/** Content API of the analytics layer (fullstack): Weems' hint text + target, feature-detected. */
type WeemsApi = {
  weemsHint?: (level: WeemsLevel, o?: { requested?: boolean }) => { text: string; level?: WeemsLevel; target?: { x: number; z: number; label: string } | null } | null;
  hint?: (level: 1 | 2 | 3, o?: { requested?: boolean }) => LiveMessage | null;
};

export interface FinalSnapshotIn {
  realT: number;
  /** The Hyde's displayed mode (ThreatHold) and its effect chip. */
  hydeMode: HydeMode;
  hydeEffect: ThreatChipView['effect'];
  emerged: boolean;
  hydeVisible: boolean;
  inv: InvestigationState;
  crack: CrackHandle | null;
  crackView: CrackHudView | null;
  forecasts: LiveForecasts | null;
  deltas: ReadonlyMap<string, DeltaState>;
  risk: { p: number; band: 'low' | 'medium' | 'high'; label: string; detectedNow: boolean } | null;
  /** The Hyde was heard within 8 m (directional caption still on). */
  hydeHeardNear: boolean;
  reducedMotion: boolean;
  lastWhy: string | null;
  hasLive: boolean;
  /** A ClueCard holds the shared left slot (ClueCard wins; Weems waits ≤ 4 s). */
  hasClueCard: boolean;
  /** Screen-edge helper (hudModel.threatEdgePoint). */
  edgePoint: (scr: { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean } | null, b: { angle: number; distanceM: number } | null) => { x: number; y: number; rot: number } | null;
}

export interface FinalSnapshot {
  threats: ThreatChipView[];
  lens: LensView | null;
  tally: TallyView;
  cabinet: CabinetView;
  weems: { button: WeemsButtonView; card: WeemsCardView | null } | null;
  death: DeathView | null;
  odds: OddsV3View;
  slurpEdge: { x: number; y: number; rot: number } | null;
  slurpHunting: boolean;
  catchTint: EnemyId | null;
  /** The Weems card waited ≥ 4 s behind a ClueCard: it takes the slot now. */
  suppressClueCard: boolean;
}

export interface FinalHooks {
  caption: (text: string, tone: 'info' | 'warn' | 'danger' | 'good') => void;
  announce: (text: string, mode?: 'alert') => void;
  sound: (name: string) => void;
  /** WHY fallback (analytics without the live feed). */
  why: (id: string, head: string, text: string) => void;
  catchFlash: (enemy: EnemyId) => void;
  flashAreas: (target: { x: number; z: number } | null) => void;
  /** The death card's "See results" / countdown (the loop reports the run). */
  deathContinue: () => void;
}

export class FinalHud {
  readonly tally: TallyTracker;
  readonly weems = new WeemsController();
  readonly cabinet = new CabinetTracker();
  readonly death = new DeathSequence();
  readonly lens = new LensPicker();
  private readonly slurpHold = new KeyHold<SlurpChipKey>('WANDER', 0.5, ['CHASE', 'ATTACK']);
  private readonly bandHold = new OddsBandHold();
  private odds: OddsV3View = HIDDEN_ODDS_V3;
  private nextOddsAt = 0;
  private lives: EnemyLife[] = [];
  private chips: ThreatChipView[] = [];
  private lensNow: LensView | null = null;
  private cab: CabinetView = cabinetView(CABINET_NONE);
  private cabIn: CabinetIn = CABINET_NONE;
  private weemsCard: { v: WeemsCardView; queuedAt: number; shownAt: number | null } | null = null;
  private weemsSeq = 0;
  /** Weems L2 / L1 target on the map (lantern + ghost glyph) until `until` (real s). */
  weemsMark: { x: number; z: number; label: string; level: WeemsLevel; until: number } | null = null;
  private pendingHint = false;
  private lastHitBy: EnemyId | null = null;
  private catchTint: EnemyId | null = null;
  private outsideSaid: EnemyId | null = null;
  private lastObjective: string;
  private ended = false;
  private nowT = 0;
  private hasCabinets: boolean;
  /** Last snapshot inputs (debug / map extras). */
  private lastIn: FinalSnapshotIn | null = null;

  constructor(
    private readonly run: FinalRunLike,
    private readonly scene: SceneDeathApi,
    private readonly analytics: object,
    private readonly hooks: FinalHooks,
  ) {
    const r = run as unknown as { director?: unknown; enemyStatus?: unknown };
    this.tally = new TallyTracker(!!r.director || typeof r.enemyStatus === 'function');
    this.lastObjective = run.objective();
    this.hasCabinets = 'cabinet' in run.player && run.map.hidingSpots.some((h) => h.kind === 'cabinet');
  }

  // ---------------------------------------------------------------------------------------------- input

  /** V or the button. Returns what happened (the sim only sees hint: true on 'hint'). */
  askWeems(realT: number): 'note' | 'hint' | null {
    const r = this.weems.press(realT, this.weemsCtx());
    if (r === 'note') {
      this.showWeems(noteCard(++this.weemsSeq), realT, WEEMS_NOTE_S);
      this.hooks.announce('Principal Weems: my hints cost 50 points each. Press V again to ask. Thing’s tips stay free.');
    } else if (r === 'hint') this.pendingHint = true;
    else this.hooks.sound('denied');
    return r;
  }

  /** The sim may receive hint: true this frame (one accepted press). */
  takeHint(): boolean {
    const h = this.pendingHint;
    this.pendingHint = false;
    return h;
  }

  cycleLens(n: number): void {
    const present = this.lives.filter((l) => l.present).map((l) => l.enemy);
    for (let i = 0; i < n; i++) this.lens.cycle(present);
  }

  /** Death skip from a keydown (keyboard clock) or a click. */
  skipDeath(realT: number, input: { startedAt: number; repeat?: boolean; click?: boolean }): boolean {
    const ok = this.death.skip(realT * 1000, input);
    if (ok) this.scene.skipDeath?.();
    return ok;
  }

  deathContinue(): void {
    if (this.death.continue()) this.finishDeath();
  }

  get dying(): boolean {
    return this.death.state !== null;
  }

  // ---------------------------------------------------------------------------------------------- events

  /**
   * `frameWeems` = the analytics frame's CHARGED Weems content for this frame's hint_requested (FrameOutput.weems) —
   * the text the analytics logged; without it the controller asks analytics.weemsHint(level) / the fallbacks.
   */
  onEvents(events: readonly StampedEvent[], realT: number, live: LiveAnalytics | null, frameWeems: { text: string; level?: number; target?: { x: number; z: number; label: string } | null } | null = null): void {
    this.nowT = realT;
    this.tally.update(events);
    const cst = cabinetStatusOf(this.run);
    const phase = cst?.phase !== undefined ? cst.phase : playerCabinetPhase(this.run.player.cabinet);
    const simCreakAt = hasCabinetStatus(this.run) ? cst?.lastCreakAt ?? null : undefined;
    const cr = this.cabinet.update(events, phase, this.run.t, realT, simCreakAt);
    if (cr.creak) {
      this.hooks.caption(CABINET_COPY.creakCaption, 'warn');
      this.hooks.sound('thud');
    }
    if (cr.pulledOut) {
      this.catchTint = cr.pulledOut;
      this.hooks.catchFlash(cr.pulledOut);
      if (!live) this.hooks.why(`pulled_${realT}`, ENEMY_SHORT[cr.pulledOut].toUpperCase(), `${ENEMY_SHORT[cr.pulledOut]} saw you hide and pulled you out.`);
    }
    for (const e of events) {
      switch (e.type) {
        case 'enemy_hit':
          this.lastHitBy = e.enemy;
          break;
        case 'catch':
          this.lastHitBy ??= 'hyde';
          break;
        case 'hint_requested':
          this.onHint(e, realT, frameWeems);
          break;
        case 'clue_found':
        case 'egg_pickup':
          this.weems.progress();
          break;
        case 'slurp_mode':
          this.slurpMode(e);
          break;
        case 'dnf':
          this.startDeath(e.by ?? null, realT);
          break;
        default:
          break;
      }
    }
    const ob = this.run.objective();
    if (ob !== this.lastObjective) {
      this.lastObjective = ob;
      this.weems.progress();
    }
  }

  private slurpMode(e: Extract<StampedEvent, { type: 'slurp_mode' }>): void {
    if (e.reason === 'deferred') return;
    if (e.to === 'CHASE') {
      this.hooks.announce('Slurp is chasing you!', 'alert');
      this.hooks.caption('[Slurp groans and lurches]', 'danger');
      this.hooks.sound('growl');
    } else if (e.to === 'ATTACK') this.hooks.caption('[Slurp lunges]', 'danger');
    else if (e.to === 'INVESTIGATE') this.hooks.caption('[Slurp shuffles toward a sound]', 'warn');
    else if (e.to === 'LEAVE' && (e.from === 'CHASE' || e.from === 'SEARCH')) this.hooks.announce('Slurp lost you.');
  }

  private onHint(e: Extract<StampedEvent, { type: 'hint_requested' }>, realT: number, frameWeems: { text: string; target?: { x: number; z: number; label: string } | null } | null): void {
    const sim = weemsSimOf(this.run);
    const level = this.weems.onHintEvent(e, sim);
    const c = frameWeems?.text ? { text: frameWeems.text, target: frameWeems.target ?? null } : this.weemsContent(level);
    this.weems.record(level, c.text, this.run.t);
    const marked = !!c.target;
    this.showWeems(hintCard(++this.weemsSeq, level, c.text, sim?.used ?? this.weems.used, marked), realT, WEEMS_CARD_S);
    if (c.target) this.weemsMark = { ...c.target, level, until: realT + WEEMS_MARK_S };
    if (level === 1) this.hooks.flashAreas(c.target);
    this.hooks.sound('glass');
    this.hooks.announce(`Principal Weems: ${c.text}`);
  }

  /** Weems' hint text: analytics.weemsHint(level) → analytics.hint(level) → public fallbacks (never a culprit). */
  weemsContent(level: WeemsLevel): { text: string; target: { x: number; z: number; label: string } | null } {
    const a = this.analytics as WeemsApi;
    try {
      const h = typeof a.weemsHint === 'function' ? a.weemsHint(level, { requested: true }) : null;
      if (h && h.text) return { text: h.text, target: h.target ?? null };
    } catch (err) {
      console.warn('[mystery] analytics.weemsHint failed', err);
    }
    try {
      const m = typeof a.hint === 'function' ? a.hint(level, { requested: true }) : null;
      if (m && m.text) return { text: m.text, target: m.target ?? null };
    } catch (err) {
      console.warn('[mystery] analytics.hint failed', err);
    }
    if (level === 1) return { text: this.run.caseDef.thing.whereHint, target: null };
    if (level === 3) return { text: WEEMS_FALLBACK_L3, target: null };
    return { text: 'Search the places you have not checked yet.', target: null };
  }

  private showWeems(v: WeemsCardView, realT: number, holdS: number): void {
    this.weemsCard = { v, queuedAt: realT, shownAt: null };
    this.weemsHold = holdS;
  }
  private weemsHold = WEEMS_CARD_S;

  private startDeath(by: EnemyId | null, realT: number): void {
    const enemy = defeatedBy(by, this.lastHitBy);
    const reduced = !!this.lastIn?.reducedMotion;
    const rendered = typeof this.scene.playDeath === 'function';
    const keyT0 = typeof performance !== 'undefined' ? performance.now() : realT * 1000;
    if (!this.death.start(enemy, realT * 1000, { reduced, rendered, keyT0 })) return;
    this.hooks.announce(defeatedLine(enemy), 'alert');
    this.weemsCard = null;
    if (rendered) {
      try {
        // the renderer's cue points carry the cutscene's sound (strike / impact); the dnf toll already played
        const onCue = (cue: string, e: EnemyId) => {
          if (cue === 'strike') this.hooks.sound(e === 'crackstone' ? 'curseCast' : 'growl');
          else if (cue === 'impact') this.hooks.sound(e === 'crackstone' ? 'curseHit' : 'thud');
        };
        const p = this.scene.playDeath!(enemy, { reducedMotion: reduced, onCue });
        if (p && typeof (p as Promise<void>).then === 'function') {
          (p as Promise<void>).then(() => this.death.cutsceneDone(this.nowT * 1000), () => this.death.cutsceneDone(this.nowT * 1000));
        }
      } catch (err) {
        console.warn('[mystery] scene.playDeath failed', err);
      }
    }
  }

  private finishDeath(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.scene.stopDeath?.();
    } catch (err) {
      console.warn('[mystery] scene.stopDeath failed', err);
    }
    this.hooks.deathContinue();
  }

  // ---------------------------------------------------------------------------------------------- state

  private weemsCtx(): WeemsContext {
    return {
      tutorial: this.run.status === 'tutorial',
      playing: this.run.status === 'playing',
      hunted: huntedBy(this.chips) !== null,
      sim: weemsSimOf(this.run),
    };
  }

  /** Whether this run's sim knows cabinets (PlayerState.cabinet exists and the map has enterable cabinets). */
  get cabinetsSupported(): boolean {
    return this.hasCabinets;
  }

  snapshot(i: FinalSnapshotIn): FinalSnapshot {
    this.lastIn = i;
    this.nowT = i.realT;
    const run = this.run;
    const t = run.t;
    const legacyHyde = { emerged: i.emerged, emergesInS: i.inv.hydeEmergesInS };
    this.lives = ENEMY_IDS.map((e) => enemyLife(run, e, legacyHyde));
    const life = (e: EnemyId) => this.lives.find((l) => l.enemy === e)!;
    const playing = run.status === 'playing';

    // ---- Threats strip
    const s = slurpOf(run);
    let slurpKey: SlurpChipKey | null = null;
    const chips: (ThreatChipView | null)[] = [];
    const hl = life('hyde');
    chips.push(hl.active ? hydeChip(i.hydeMode, run.hyde.suspicion, i.hydeEffect) : directorChip(hl));
    const cl = life('crackstone');
    if (cl.present) chips.push(cl.active && i.crackView ? crackChip(i.crackView.key, i.crackView.meter, i.crackView.effect) : directorChip(cl));
    const sl = life('slurp');
    if (sl.present && s) {
      if (sl.active) {
        slurpKey = this.slurpHold.update(slurpChipKey(s), i.realT);
        chips.push(slurpChip(slurpKey, s.suspicion / slurpChaseAt(run), slurpEffect(s, t)));
      } else chips.push(directorChip(sl));
    }
    this.chips = playing ? orderChips(chips) : [];
    const hunted = huntedBy(this.chips);
    const slurpHunting = slurpKey === 'CHASE' || slurpKey === 'ATTACK';

    // ---- cabinet
    const fx = run.effects();
    const me: Vec2 = { x: run.player.x, z: run.player.z };
    const st = cabinetStatusOf(run);
    const phase = st?.phase !== undefined ? st.phase : playerCabinetPhase(run.player.cabinet);
    const ia = run.interactable();
    const inRange = st?.inRange ?? (phase === null && ia !== null && ia.kind === 'cabinet');
    const vis = this.visibleEnemies(i, fx, me);
    const watchedBy: EnemyId | null = (i.emerged && hl.active && run.hyde.canSeePlayer) ? 'hyde'
      : i.crack && cl.active && i.crack.rt.canSeePlayer ? 'crackstone'
      : s && sl.active && s.canSeePlayer ? 'slurp' : null;
    const nearest = (maxM: number) => vis.filter((v) => v.d <= maxM).sort((a, b) => a.d - b.d)[0]?.enemy ?? null;
    const tuning = (run.tuning ?? {}) as { cabinet?: { creakAfterS?: number; creakEveryS?: number } };
    const outside = phase !== null ? (st?.outside !== undefined ? st.outside : nearest(OUTSIDE_M)) : null;
    this.cabIn = {
      phase,
      inRange: !!inRange,
      watchedBy: st?.watchedBy !== undefined ? st.watchedBy : watchedBy,
      witnessedBy: st?.witnessedBy !== undefined ? st.witnessedBy : this.cabinet.witnessedBy,
      creakInS: st?.creakInS !== undefined ? st.creakInS : this.cabinet.creakInS(t, tuning.cabinet?.creakAfterS ?? null, tuning.cabinet?.creakEveryS ?? null),
      creaking: this.cabinet.creaking(i.realT),
      outside,
      near: phase !== null ? nearest(NEAR_M) ?? (i.hydeHeardNear ? 'hyde' : null) : null,
    };
    this.cab = cabinetView(this.cabIn);
    if (outside && outside !== this.outsideSaid) this.hooks.caption('[Footsteps outside]', 'warn');
    this.outsideSaid = outside;

    // ---- Odds v3 (≤ 1 Hz; facts may refresh it sooner via forceOdds)
    if (i.realT >= this.nextOddsAt) {
      this.nextOddsAt = i.realT + ODDS_V3_EVERY_S;
      const doorClosed = phase === 'closed';
      const v = buildOddsV3({
        phase: oddsV3Phase(run.status, run.objective(), i.forecasts),
        forecasts: i.forecasts,
        investigation: i.inv,
        deltas: i.deltas,
        doorClosed,
        monsters: {
          hyde: { life: hl, risk: hl.active ? i.risk : null, hunting: hl.active && i.hydeMode === 'CHASE', seesYou: hl.active && run.hyde.canSeePlayer },
          ...(cl.present ? { crackstone: { life: cl, hunting: !!i.crackView?.hunting, seesYou: !!i.crack?.rt.canSeePlayer && cl.active } } : {}),
          ...(sl.present && s ? { slurp: { life: sl, hunting: slurpHunting, seesYou: sl.active && s.canSeePlayer } } : {}),
        },
      });
      this.odds = this.bandHold.apply(v, i.realT);
    }

    // ---- lens
    const present = this.lives.filter((l) => l.present).map((l) => l.enemy);
    const active = this.lives.filter((l) => l.active).map((l) => l.enemy);
    const engaged = this.chips
      .filter((c) => c.director === null && ['CHASE', 'ATTACK', 'SEARCH', 'INVESTIGATE', 'INVESTIGATE_SOUND', 'SEES', 'SCAN'].includes(c.state))
      .sort((a, b) => rank(b.state) - rank(a.state))
      .map((c) => c.enemy);
    const oddsP: Partial<Record<EnemyId, number | null>> = {};
    for (const r of this.odds.rows) if (r.id !== 'objective' && r.kind !== 'away' && r.kind !== 'next') oddsP[r.id] = r.cell?.p ?? null;
    const pick = this.lens.update({ present, active, engaged, oddsP }, i.realT, hunted);
    const lensInactive = !life(pick.enemy).active;
    this.lensNow = playing ? { enemy: pick.enemy, auto: pick.auto, inactive: lensInactive, label: lensLabel(pick.enemy, pick.auto, lensInactive), present } : null;

    // ---- Weems
    const ctx = this.weemsCtx();
    const sim = ctx.sim;
    const button = this.weems.button(ctx, sim?.used ?? null);
    let card: WeemsCardView | null = null;
    let suppressClueCard = false;
    const wc = this.weemsCard;
    if (wc) {
      if (wc.shownAt === null && (!i.hasClueCard || i.realT - wc.queuedAt >= WEEMS_WAIT_MAX_S)) wc.shownAt = i.realT;
      if (wc.shownAt !== null) {
        if (i.realT - wc.shownAt >= this.weemsHold) this.weemsCard = null;
        else {
          card = wc.v;
          suppressClueCard = i.hasClueCard;
        }
      }
    }
    if (this.weemsMark && i.realT >= this.weemsMark.until) this.weemsMark = null;

    // ---- death
    let death: DeathView | null = null;
    if (this.death.state) {
      const now = i.realT * 1000;
      if (this.death.tick(now) === 'continue') this.finishDeath();
      const ds = this.death.state;
      if (ds.phase !== 'done') {
        const tl = this.tally.view();
        death = {
          phase: ds.phase === 'card' ? 'card' : 'cutscene',
          enemy: ds.enemy,
          reduced: ds.reduced,
          skip: this.death.skipVisible(now),
          caption: DEATH_CAPTION[ds.enemy],
          card: ds.phase === 'card' ? {
            kicker: deathKicker(run.caseDef.number),
            name: ENEMY_NAMES[ds.enemy],
            flavour: DEATH_FLAVOUR[ds.enemy],
            why: deathWhy({ reason: run.dnfReason ?? null, enemy: ds.enemy, hits: tl.hits, lastWhy: i.lastWhy }),
            tally: deathTally(typeof run.activeTimeS === 'function' ? run.activeTimeS() : t, run.cluesFound.length, run.caseDef.clues.length, tl.hits),
            countdownS: this.death.countdownS(now) ?? 0,
          } : null,
        };
      }
    }

    // ---- Slurp edge (his chase is public)
    let slurpEdge: FinalSnapshot['slurpEdge'] = null;
    if (slurpHunting) {
      const scr = typeof this.scene.getSlurpScreen === 'function' ? this.scene.getSlurpScreen() : null;
      const b = slurpBearing(run);
      slurpEdge = i.edgePoint(scr, b);
    }
    const tint = this.catchTint;

    return {
      threats: this.chips,
      lens: this.lensNow,
      tally: this.tally.view(),
      cabinet: this.cab,
      weems: run.status === 'tutorial' ? null : { button, card },
      death,
      odds: this.odds,
      slurpEdge,
      slurpHunting,
      catchTint: tint,
      suppressClueCard,
    };
  }

  /** Rebuild the odds at the next snapshot (a fact changed: chase start / end, door closed). */
  forceOdds(): void {
    this.nextOddsAt = 0;
  }

  /** Enemies whose position is public now (R4) with their distance to the player. */
  private visibleEnemies(i: FinalSnapshotIn, fx: ActiveEffects, me: Vec2): { enemy: EnemyId; d: number; x: number; z: number; kind: string }[] {
    const out: { enemy: EnemyId; d: number; x: number; z: number; kind: string }[] = [];
    const h = this.run.hyde;
    if (i.emerged && (i.hydeVisible || i.hydeMode === 'CHASE')) out.push({ enemy: 'hyde', d: Math.hypot(h.x - me.x, h.z - me.z), x: h.x, z: h.z, kind: i.hydeMode === 'CHASE' ? 'chase' : 'visible' });
    if (i.crack) {
      const k: CrackMarkerKind | null = crackMarkerKind(i.crack, fx, me);
      if (k) out.push({ enemy: 'crackstone', d: Math.hypot(i.crack.rt.x - me.x, i.crack.rt.z - me.z), x: i.crack.rt.x, z: i.crack.rt.z, kind: k });
    }
    const s = slurpOf(this.run);
    const sk: SlurpMarkerKind | null = s ? slurpMarkerKind(this.run, fx, me) : null;
    if (s && sk) out.push({ enemy: 'slurp', d: Math.hypot(s.x - me.x, s.z - me.z), x: s.x, z: s.z, kind: sk });
    return out;
  }

  /** Map slice: Slurp's R4 marker, the lens, Weems' mark and which enemies are on the map (pins). */
  mapExtras(): { slurp: { marker: { x: number; z: number; yaw: number; kind: SlurpMarkerKind } | null; chase: boolean; present: boolean } | null; lens: { enemy: EnemyId; inactive: boolean } | null; weemsMark: { x: number; z: number; label: string } | null; active: Partial<Record<EnemyId, boolean>>; cabinets: boolean } {
    const s = slurpOf(this.run);
    let slurp = null;
    if (s) {
      const k = slurpMarkerKind(this.run, this.run.effects(), { x: this.run.player.x, z: this.run.player.z });
      slurp = { marker: k ? { x: s.x, z: s.z, yaw: s.yaw, kind: k } : null, chase: s.active && (s.mode === 'CHASE' || s.mode === 'ATTACK'), present: true };
    }
    const active: Partial<Record<EnemyId, boolean>> = {};
    for (const l of this.lives) if (l.present) active[l.enemy] = l.active;
    return {
      slurp,
      lens: this.lensNow ? { enemy: this.lensNow.enemy, inactive: this.lensNow.inactive } : null,
      weemsMark: this.weemsMark ? { x: this.weemsMark.x, z: this.weemsMark.z, label: this.weemsMark.label } : null,
      active,
      cabinets: this.hasCabinets,
    };
  }

  /** The Tab overlay's "Weems' hints (n)" list. */
  hintsGiven(): readonly { level: WeemsLevel; text: string }[] {
    return this.weems.hints;
  }

  /** Public state for render_game_to_text. */
  debug(): object {
    const d = this.death.state;
    return {
      threats: this.chips.map((c) => ({ enemy: c.enemy, state: c.state, word: c.word, director: c.director, meter: c.meter === null ? null : Math.round(c.meter * 100) / 100 })),
      lives: this.lives.map((l) => ({ enemy: l.enemy, present: l.present, active: l.active, phase: l.phase, arrivesInS: l.arrivesInS })),
      odds: { phase: this.odds.phase, rows: this.odds.rows.map((r) => ({ id: r.id, label: r.label, kind: r.kind, text: r.cell?.text ?? null, band: r.cell?.band ?? null, source: r.source })), footer: this.odds.footer },
      lens: this.lensNow && { enemy: this.lensNow.enemy, auto: this.lensNow.auto, inactive: this.lensNow.inactive, label: this.lensNow.label, choice: this.lens.choice },
      tally: (() => {
        const v = this.tally.view();
        return { seen: v.seen, hits: v.hits, hints: v.hints };
      })(),
      cabinet: { supported: this.hasCabinets, phase: this.cabIn.phase, inRange: this.cabIn.inRange, chip: this.cab.chip?.text ?? null, line2: this.cab.chip?.line2 ?? null, prompt: this.cab.prompt?.kind ?? null, witnessedBy: this.cabIn.witnessedBy, outside: this.cabIn.outside, creakInS: this.cabIn.creakInS === null ? null : Math.round(this.cabIn.creakInS * 10) / 10 },
      weems: (() => {
        const ctx = this.weemsCtx();
        const b = this.weems.button(ctx, ctx.sim?.used ?? null);
        return { state: b.state, sub: b.sub, used: b.used, noteShown: this.weems.noteAt !== null, stepLevel: this.weems.stepLevel, card: this.weemsCard?.v ? { kind: this.weemsCard.v.kind, kicker: this.weemsCard.v.kicker, lines: this.weemsCard.v.lines } : null, hints: this.weems.hints.length, mark: this.weemsMark ? this.weemsMark.label : null };
      })(),
      death: d ? { enemy: d.enemy, phase: d.phase, skipped: d.skipped, reduced: d.reduced, rendered: d.rendered, cardAfterMs: d.cardAfterMs } : null,
    };
  }
}

function rank(state: string): number {
  return state === 'ATTACK' ? 5 : state === 'CHASE' ? 4 : state === 'SEARCH' ? 3 : state === 'INVESTIGATE' || state === 'INVESTIGATE_SOUND' ? 2 : 1;
}

function slurpBearing(run: object): { angle: number; distanceM: number } | null {
  const fn = (run as { slurpBearing?: () => { angle: number; distanceM: number } }).slurpBearing;
  if (typeof fn !== 'function') return null;
  const b = fn.call(run);
  return b && b.distanceM < 999 ? b : null;
}

/** Re-exported for the loop: the spawn-odds source of an inactive enemy (lens pins). */
export { spawnOddsOf, slurpForecastOf };
