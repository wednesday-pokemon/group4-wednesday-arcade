// Dev harness for the Mystery renderer (MysteryScene). Renders the REAL island (buildIsland) with either a scripted FakeRun (exact
// staging for screenshots) or the real MysteryRun driven by the sim's own bot (?real=1).
// Run:  node node_modules/vite/bin/vite.js --port 5210   then open /tools/mystery-preview.html
// Query flags: ?manual=1 (no auto RAF; drive with __m.advance)  ?low=1  ?reduced=1  ?shot=1 (hide the bar)  ?real=1
//              ?case=poisoned_archive|crypt_last_witness|midnight_signal  ?character=wednesday  ?pokemon=gengar  ?w=1280&h=720  ?emblems=1 (Thing pose contact sheet)  ?scenedebug
//              ?mock=1|0 (staging world: rich candidate sites / examines / lever / hazards / extra walls; default = only while the real world is the one-site stub)  ?layout=second (session layout = each group's 2nd site)
// Console / Playwright API: window.__m
import * as THREE from 'three';
import { MysteryScene } from '../src/three/mystery/MysteryScene.ts';
import { NO_EFFECTS, type RenderableMysteryRun } from '../src/three/mystery/types.ts';
import { THING_POSES, renderThingPng } from '../src/three/mystery/thing.ts';
import { buildIsland } from '../src/mystery/data/island.ts';
import { caseById, isCaseId } from '../src/mystery/data/cases.ts';
import { MysteryRun } from '../src/mystery/run.ts';
import { Bot } from '../src/mystery/bot.ts';
import { createHydeRuntime } from '../src/mystery/hyde.ts';
import { applyLayout, applyMockWorld } from './mystery-preview-mock.ts';
import type {
  ActiveEffects, ClueId, CrackstoneRuntime, Duo, EggRuntime, GameEvent, HydeRuntime, InvestigationState, MapDef, NightshadeId, Objective, PlayerState, PokemonId, RunStatus, StampedEvent,
} from '../src/mystery/types.ts';

const q = new URLSearchParams(location.search);
if (q.get('manual') === '1') window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
if (q.get('shot') === '1') document.body.classList.add('shot');
if (q.get('w') && q.get('h')) document.getElementById('wrap')!.style.cssText = `width:${q.get('w')}px;height:${q.get('h')}px`;

const stage = document.getElementById('stage') as HTMLElement;
const bar = document.getElementById('bar') as HTMLElement;

// ------------------------------------------------------------------------------------------------ Thing contact sheet
if (q.get('emblems') === '1') {
  document.body.classList.add('emblems');
  const host = document.getElementById('emblems')!;
  for (const pose of THING_POSES) {
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = renderThingPng(pose, 256);
    const cap = document.createElement('figcaption');
    cap.textContent = pose;
    fig.append(img, cap);
    host.appendChild(fig);
  }
  (window as unknown as { __emblemsReady: boolean }).__emblemsReady = true;
}

// ------------------------------------------------------------------------------------------------ scripted run
class FakeRun implements RenderableMysteryRun {
  map: MapDef;
  player: PlayerState;
  hyde: HydeRuntime;
  egg: EggRuntime;
  cluesFound: ClueId[] = [];
  status: RunStatus = 'playing';
  t = 10;
  fx: ActiveEffects = { ...NO_EFFECTS };
  interact: { kind: 'clue' | 'egg' | 'tower' | 'switch' | 'practice' | 'examine' | 'lever'; id: string; label: string; progress: number } | null = null;
  hydeEmerged = true;
  inv: InvestigationState = { checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false, hydeEmerged: true, hydeEmergedAt: 0, hydeEmergesInS: null, lastHydeSighting: null };
  open = new Set<string>();
  obj: Objective = 'find_clues';
  walk = false;
  hydeWalk = false;
  /** scripted Joseph Crackstone (null = none in this case) */
  crackstone: CrackstoneRuntime | null = null;
  crackVisual: 'petrify' | 'pin' | null = null;
  crackWalk = false;
  /** 'loop': he walks a rectangular loop with look-around pauses and scans every ~14 s */
  crackScript: 'off' | 'loop' = 'off';
  crackLoopIdx = 0;
  crackPause = 0;
  crackNextScan = 8;
  curseHit = true;
  crackstoneVisual() { return this.crackVisual; }
  constructor(map: MapDef) {
    this.map = map;
    const s = map.playerStart;
    this.player = { x: s.x, z: s.z, yaw: s.yaw, pitch: 0.14, speed: 0, stance: 'idle', crouched: false, hp: 100, maxHp: 100, catches: 0, invulnerableUntil: 0, hidden: false, roomId: 'pier', interacting: null };
    this.hyde = createHydeRuntime(map);
    this.hyde.x = -2; this.hyde.z = -42;
    this.egg = { tier: 'rare', points: 3, security: 100, state: 'resting', x: map.eggSpawn.x, z: map.eggSpawn.z };
  }
  effects(): ActiveEffects { return { ...this.fx, last: this.fx.last }; }
  interactable() { return this.interact; }
  isWallOpen(id: string): boolean { return this.open.has(id); }
  objective(): Objective { return this.obj; }
  investigation(): InvestigationState { return { ...this.inv, hydeEmerged: this.hydeEmerged, passageOpen: [...this.open].some((id) => id === this.map.world?.passage?.wallId) }; }
}

const characterId = (q.get('character') ?? 'wednesday') as NightshadeId;
const pokemonId = (q.get('pokemon') ?? 'gengar') as PokemonId;
const duo: Duo = { characterId, pokemonId };
const caseParam = q.get('case');
const caseDef = caseById(isCaseId(caseParam) ? caseParam : 'poisoned_archive');
const map = buildIsland(caseDef);
const mockQ = q.get('mock');
if (q.get('real') !== '1' && (mockQ === '1' || (mockQ !== '0' && (map.world?.examines.length ?? 0) === 0))) applyMockWorld(map, caseDef.id, q.get('layout') === 'second' ? 'second' : 'first');
else if (q.get('layout') === 'second') applyLayout(map, 'second');
const fake = new FakeRun(map);
fake.egg.x = map.eggSpawn.x; fake.egg.z = map.eggSpawn.z;
let real: MysteryRun | null = null;
let bot: Bot | null = null;
let current: RenderableMysteryRun = fake;
let pending: StampedEvent[] = [];
let seq = 0;

const options = { reducedMotion: q.get('reduced') === '1', lowGraphics: q.get('low') === '1' };
const scene = new MysteryScene(stage, map, duo, options);
scene.setAdaptiveResolution(q.get('adaptive') === '1');
if (q.get('real') === '1') startReal(q.get('seed') ?? 'preview-1', false);

function startReal(seed: string, tutorial: boolean, profile: 'stealthy' | 'careless' = 'stealthy'): void {
  real = new MysteryRun({ duo, seed, tutorial, caseDef });
  bot = new Bot(real, { profile, startDelayMaxS: 0 }, seed);
  current = real;
}

function stamp(e: GameEvent): StampedEvent { return { ...e, t: current.t, seq: ++seq } as StampedEvent; }

function renderFrames(n: number, dt: number): void {
  for (let i = 0; i < n; i++) {
    const ev = pending;
    pending = [];
    scene.render(current, ev, dt);
  }
}

function createCrack(x: number, z: number, yaw = 0): CrackstoneRuntime {
  return { mode: 'PATROL', modeT: 0, x, z, yaw, speed: 0, suspicion: 0, canSeePlayer: false, lastKnown: null, target: null, path: [], stunnedUntil: 0, slowedUntil: 0, slowMult: 1, distractedUntil: 0, scan: null, curse: null };
}

/** Scripted Crackstone: optional patrol loop, scan warning -> pulse and curse resolution, all in sim time (fake.t). */
function stepCrack(dt: number): void {
  const c = fake.crackstone;
  if (!c) return;
  c.modeT += dt;
  if (fake.crackScript === 'loop' && !c.scan && !c.curse) {
    const loop = [[-8, 38], [8, 38], [8, 50], [-8, 50]];
    if (fake.crackPause > 0) { fake.crackPause -= dt; c.speed = 0; }
    else {
      const w = loop[fake.crackLoopIdx % loop.length];
      const dx = w[0] - c.x, dz = w[1] - c.z, d = Math.hypot(dx, dz);
      if (d < 0.3) { fake.crackLoopIdx++; fake.crackPause = 2.5; c.speed = 0; }
      else {
        const want = Math.atan2(-dx, -dz);
        let dy = want - c.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        c.yaw += dy * Math.min(1, dt * 4);
        c.speed = 1.5;
        c.x += (dx / d) * c.speed * dt; c.z += (dz / d) * c.speed * dt;
      }
    }
    if (fake.t > fake.crackNextScan) { api.crackScan(9, 2.2); fake.crackNextScan = fake.t + 14; }
  } else if (fake.crackWalk && !c.scan && !c.curse) {
    c.x += -Math.sin(c.yaw) * c.speed * dt; c.z += -Math.cos(c.yaw) * c.speed * dt;
  }
  if (c.scan) {
    c.speed = 0;
    if (c.scan.phase === 'warning' && fake.t >= c.scan.pulseAt) { c.scan.phase = 'pulse'; pending.push(stamp({ type: 'crackstone_scan', phase: 'pulse', radiusM: c.scan.radiusM, hit: false })); }
    else if (c.scan.phase === 'pulse' && fake.t >= c.scan.pulseAt + 0.7) c.scan = null;
  }
  if (c.curse && fake.t >= c.curse.landsAt) {
    pending.push(stamp({ type: 'curse', phase: fake.curseHit ? 'hit' : 'miss', hpLost: fake.curseHit ? 25 : 0, blocked: false }));
    c.curse = null;
    if (c.mode === 'ATTACK') c.mode = fake.curseHit ? 'RETURN' : 'CHASE';
  }
}

function stepFake(dt: number): void {
  fake.t += dt;
  const p = fake.player;
  if (fake.walk) {
    p.x += -Math.sin(p.yaw) * p.speed * dt;
    p.z += -Math.cos(p.yaw) * p.speed * dt;
  }
  stepCrack(dt);
  if (fake.hydeWalk) {
    fake.hyde.x += -Math.sin(fake.hyde.yaw) * fake.hyde.speed * dt;
    fake.hyde.z += -Math.cos(fake.hyde.yaw) * fake.hyde.speed * dt;
  }
}

const api = {
  scene,
  get run() { return current; },
  fake,
  get real() { return real; },
  duo,
  map,
  /** Merge fields into the scripted player / hyde / egg / effects. */
  setPlayer(o: Partial<PlayerState>) { Object.assign(fake.player, o); },
  setHyde(o: Partial<HydeRuntime>) { Object.assign(fake.hyde, o); },
  /** Create / merge the scripted Crackstone (null removes him). */
  setCrack(o: Partial<CrackstoneRuntime> | null) {
    if (o === null) { fake.crackstone = null; return; }
    if (!fake.crackstone) fake.crackstone = createCrack(o.x ?? 0, o.z ?? 40, o.yaw ?? 0);
    Object.assign(fake.crackstone, o);
  },
  setCrackFlags(o: { walk?: boolean; script?: 'off' | 'loop'; visual?: 'petrify' | 'pin' | null; curseHit?: boolean }) {
    if (o.walk !== undefined) fake.crackWalk = o.walk;
    if (o.script !== undefined) { fake.crackScript = o.script; fake.crackNextScan = fake.t + 6; }
    if (o.visual !== undefined) fake.crackVisual = o.visual;
    if (o.curseHit !== undefined) fake.curseHit = o.curseHit;
  },
  /** Put Crackstone `dist` m from the player along (yaw + rel), facing the player. */
  crackAt(dist: number, rel: number, mode: CrackstoneRuntime['mode'], opts: { speed?: number; faceAway?: boolean; face?: number } = {}) {
    const p = fake.player;
    const a = p.yaw + rel;
    if (!fake.crackstone) fake.crackstone = createCrack(0, 0);
    const c = fake.crackstone;
    c.x = p.x - Math.sin(a) * dist; c.z = p.z - Math.cos(a) * dist;
    const toPlayer = Math.atan2(-(p.x - c.x), -(p.z - c.z));
    c.yaw = opts.face ?? (opts.faceAway ? toPlayer + Math.PI : toPlayer);
    c.mode = mode;
    c.speed = opts.speed ?? (mode === 'CHASE' ? 3.8 : mode === 'PATROL' ? 1.5 : mode === 'INVESTIGATE' ? 2.4 : mode === 'RETURN' ? 1.8 : mode === 'SEARCH' ? 1.2 : 0);
    c.suspicion = mode === 'PATROL' ? 0 : mode === 'CHASE' ? 1 : 0.6;
    c.canSeePlayer = mode === 'CHASE';
    c.lastKnown = mode === 'PATROL' ? null : { x: p.x, z: p.z };
    c.scan = null; c.curse = null;
  },
  /** Start a scan warning now (sim time): ring grows to `radius` over `warnS`, then pulses. */
  crackScan(radius = 9, warnS = 2.2) {
    const c = fake.crackstone;
    if (!c) return;
    c.scan = { phase: 'warning', startedAt: fake.t, pulseAt: fake.t + warnS, radiusM: radius };
    pending.push(stamp({ type: 'crackstone_scan', phase: 'warning', radiusM: radius, hit: false }));
  },
  /** Cast a curse circle at (x,z): fills over `windupS`, then lands (hit / miss per setCrackFlags). */
  castCurse(x: number, z: number, radius = 3, windupS = 1.6) {
    const c = fake.crackstone;
    if (!c) return;
    c.mode = 'ATTACK'; c.speed = 0;
    c.curse = { x, z, radiusM: radius, startedAt: fake.t, landsAt: fake.t + windupS };
    pending.push(stamp({ type: 'curse', phase: 'cast', hpLost: 0, blocked: false }));
  },
  setEgg(o: Partial<EggRuntime>) { Object.assign(fake.egg, o); },
  setEffects(o: Partial<ActiveEffects>) { fake.fx = { ...NO_EFFECTS, ...o }; },
  setOpen(id: string, v: boolean) { if (v) fake.open.add(id); else fake.open.delete(id); },
  setClues(ids: ClueId[]) { fake.cluesFound = ids; },
  /** Merge fields into the scripted InvestigationState (known / checked sites, examined ...). */
  setInv(o: Partial<InvestigationState>) { Object.assign(fake.inv, o); },
  setHydeEmerged(v: boolean) { fake.hydeEmerged = v; },
  setT(t: number) { fake.t = t; },
  setInteract(i: FakeRun['interact']) { fake.interact = i; },
  setObjective(o: Objective) { fake.obj = o; },
  setStatus(s: RunStatus) { fake.status = s; },
  setFlags(o: { walk?: boolean; hydeWalk?: boolean }) { if (o.walk !== undefined) fake.walk = o.walk; if (o.hydeWalk !== undefined) fake.hydeWalk = o.hydeWalk; },
  useFake() { current = fake; },
  emit(e: GameEvent) { pending.push(stamp(e)); },
  /** Place the player at (x,z) facing yaw with a stance preset. */
  place(x: number, z: number, yaw: number, stance: 'idle' | 'walk' | 'crouch' | 'sprint' = 'idle', pitch = 0.14) {
    const p = fake.player;
    p.x = x; p.z = z; p.yaw = yaw; p.pitch = pitch;
    p.stance = stance; p.crouched = stance === 'crouch';
    p.speed = stance === 'walk' ? 2.4 : stance === 'sprint' ? 4.6 : stance === 'crouch' ? 1.2 : 0;
    p.hidden = false;
    const r = map.rooms.find((rm) => rm.id !== 'path' && rm.polygon.some(() => true) && inside(rm.polygon, x, z));
    p.roomId = (r?.id ?? 'path') as PlayerState['roomId'];
    fake.player.speed = stance === 'crouch' ? 0 : p.speed;
  },
  /** Put the Hyde `dist` m from the player along (yaw + rel) with a mode, facing the player unless faceAway. */
  hydeAt(dist: number, rel: number, mode: HydeRuntime['mode'], opts: { speed?: number; faceAway?: boolean; face?: number } = {}) {
    const p = fake.player;
    const a = p.yaw + rel;
    const h = fake.hyde;
    h.x = p.x - Math.sin(a) * dist;
    h.z = p.z - Math.cos(a) * dist;
    const toPlayer = Math.atan2(-(p.x - h.x), -(p.z - h.z));
    h.yaw = opts.face ?? (opts.faceAway ? toPlayer + Math.PI : toPlayer);
    h.mode = mode;
    h.speed = opts.speed ?? (mode === 'CHASE' ? 5.2 : mode === 'PATROL' ? 2.4 : mode === 'INVESTIGATE_SOUND' ? 3.2 : mode === 'SEARCH' ? 1.2 : 0.8);
    h.suspicion = mode === 'PATROL' ? 0 : mode === 'CHASE' ? 1 : 0.6;
    h.grabbing = false;
    h.canSeePlayer = mode === 'CHASE';
    h.lastKnown = mode === 'PATROL' ? null : { x: p.x, z: p.z };
  },
  render(n = 1, dt = 1 / 30) { renderFrames(n, dt); },
  /** Advance scripted time and render at `hz`. */
  advance(seconds: number, hz = 15) {
    const dt = 1 / hz;
    const n = Math.max(1, Math.round(seconds * hz));
    for (let i = 0; i < n; i++) {
      if (current === fake) stepFake(dt);
      renderFrames(1, dt);
    }
  },
  settle(seconds: number) { scene.settleDebug(seconds); },
  cam(c: Parameters<MysteryScene['setDebugCamera']>[0]) { scene.setDebugCamera(c); },
  debug() { return scene.getDebugState(current); },
  hydeScreen() { return scene.getHydeScreen(); },
  crackScreen() { return scene.getCrackstoneScreen(); },
  setLow(v: boolean) { scene.setOptions({ lowGraphics: v }); },
  setReduced(v: boolean) { scene.setOptions({ reducedMotion: v }); },
  thingPose(p: Parameters<MysteryScene['setThingPose']>[0]) { scene.setThingPose(p); },
  showcase(v: boolean) { scene.setShowcase(v); },
  // ---- real sim
  startReal,
  /** Step the REAL run with the sim bot for `seconds` of sim time, rendering at `hz`. Returns the events seen. */
  realStep(seconds: number, hz = 10): { events: number; t: number; status: string } {
    if (!real || !bot) startReal('preview-1', false);
    const r = real!;
    const dt = 1 / hz;
    const n = Math.max(1, Math.round(seconds * hz));
    let count = 0;
    for (let i = 0; i < n; i++) {
      const input = bot!.decide();
      const ev = r.update(dt, input);
      count += ev.length;
      scene.render(r, ev, dt);
    }
    return { events: count, t: r.t, status: r.status };
  },
};
(window as unknown as { __m: typeof api }).__m = api;
(window as unknown as { __THREE: typeof THREE }).__THREE = THREE;

function inside(poly: { x: number; z: number }[], x: number, z: number): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins;
  }
  return ins;
}

// ------------------------------------------------------------------------------------------------ simple UI bar
const log = document.createElement('span');
log.id = 'log';
const btn = (label: string, fn: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  bar.appendChild(b);
};
btn('Real run (bot)', () => { startReal('preview-' + Math.floor(Math.random() * 1000), false); });
btn('Fake', () => { current = fake; });
btn('Low', () => scene.setOptions({ lowGraphics: !options.lowGraphics }));
bar.appendChild(log);

let last = performance.now();
if (q.get('manual') !== '1') {
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (current === real && real && bot) {
      const ev = real.update(dt, bot.decide());
      scene.render(real, ev, dt);
    } else {
      stepFake(dt);
      renderFrames(1, dt);
    }
    const d = scene.getDebugState(current) as { drawCalls: number; triangles: number };
    log.textContent = `calls ${d.drawCalls}  tris ${d.triangles}`;
  };
  requestAnimationFrame(loop);
} else {
  renderFrames(2, 1 / 30);
}
(window as unknown as { __mReady: boolean }).__mReady = true;
