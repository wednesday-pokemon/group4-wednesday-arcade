// Dev harness for the Stage 1 real-time renderer (ActionScene). Drives a REAL StageOneRun with scripted rowing input.
// Run:  npx vite --port 5201   then open /tools/three-action-preview.html
// Query flags: ?course=synthetic|default  ?manual=1 (no auto RAF; drive with __p.advance)  ?low=1  ?reduced=1  ?shot=1 (hide the bar)
//              ?character=wednesday  ?pokemon=aegislash  ?w=1280&h=720 (fixed stage size)
// Console / Playwright API: window.__p  (reset, advance, hyde, press, debug, info, dispose)
import { ActionScene } from '../src/three/action/ActionScene.ts';
import { StageOneRun } from '../src/action/run.ts';
import { defaultCourse, hasLakeCourse } from '../src/action/courseResolver.ts';
import type { ActionEvent, CourseDef, HydePhase, InputSnapshot, LandMass, Obstacle, Vec2 } from '../src/action/types.ts';
import type { CharacterId, PokemonId } from '../src/game/types.ts';

const q = new URLSearchParams(location.search);
if (q.get('manual') === '1') window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
if (q.get('shot') === '1') document.body.classList.add('shot');

const stage = document.getElementById('stage') as HTMLElement;
const bar = document.getElementById('bar') as HTMLElement;
if (q.get('w') && q.get('h')) {
  document.getElementById('wrap')!.style.cssText = `width:${q.get('w')}px;height:${q.get('h')}px`;
}

// ------------------------------------------------------------------------------------------------ synthetic course
function blob(cx: number, cz: number, rx: number, rz: number, n: number, seed: number, wobble = 0.22): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + wobble * Math.sin(a * 3 + seed) + wobble * 0.6 * Math.sin(a * 5 + seed * 2.3);
    pts.push({ x: cx + Math.cos(a) * rx * w, z: cz + Math.sin(a) * rz * w });
  }
  return pts;
}

function shoreStrip(side: -1 | 1, z0: number, z1: number, edgeX: (z: number) => number, outer: number): Vec2[] {
  const pts: Vec2[] = [];
  const n = Math.round(Math.abs(z1 - z0) / 24);
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    pts.push({ x: side * edgeX(z), z });
  }
  pts.push({ x: side * outer, z: z1 }, { x: side * outer, z: z0 });
  return pts;
}

export function syntheticCourse(): CourseDef {
  const west = shoreStrip(-1, 80, -540, (z) => 120 + 38 * Math.sin(z / 62) + 18 * Math.sin(z / 21 + 1.3), 280);
  const east = shoreStrip(1, 80, -540, (z) => 118 + 30 * Math.sin(z / 55 + 2) + 20 * Math.sin(z / 19), 280);
  const land: LandMass[] = [
    { id: 'west', kind: 'shore', points: west, height: 7, trees: 6 },
    { id: 'east', kind: 'shore', points: east, height: 6, trees: 5 },
    { id: 'south', kind: 'shore', points: [{ x: -280, z: 44 }, { x: -140, z: 36 }, { x: -50, z: 44 }, { x: 50, z: 42 }, { x: 140, z: 36 }, { x: 280, z: 44 }, { x: 280, z: 140 }, { x: -280, z: 140 }], height: 6, trees: 4 },
    { id: 'islet', kind: 'islet', points: blob(40, -170, 30, 22, 12, 1.1), height: 4, trees: 5 },
    { id: 'islet2', kind: 'islet', points: blob(-45, -330, 22, 30, 11, 2.4), height: 3.5, trees: 4 },
    { id: 'reef', kind: 'reef', points: blob(-18, -255, 16, 11, 9, 0.4, 0.3), height: 1.2 },
    { id: 'raven', kind: 'islet', points: [{ x: -150, z: -588 }, { x: -90, z: -548 }, { x: -34, z: -548 }, { x: 30, z: -548 }, { x: 90, z: -552 }, { x: 150, z: -590 }, { x: 120, z: -640 }, { x: -120, z: -640 }], height: 9, trees: 5 },
  ];
  const ob = (id: string, kind: Obstacle['kind'], x: number, z: number, radius: number, halfLength = 0, angle = 0, drift?: Obstacle['drift']): Obstacle =>
    ({ id, kind, x, z, radius, halfLength, angle, damage: 10, drift });
  const obstacles: Obstacle[] = [
    ob('r1', 'rock', -22, -90, 3.6), ob('r2', 'rock', 26, -210, 4.2), ob('r3', 'rock', -62, -170, 3), ob('r4', 'rock', 70, -300, 3.8), ob('r5', 'rock', 10, -380, 4.6),
    ob('l1', 'log', 14, -60, 0.8, 4, 0.5), ob('l2', 'log', -34, -250, 0.8, 5, -0.4), ob('l3', 'log', -20, -140, 0.8, 4, 1.2, { amplitude: 9, periodS: 14, phase: 0.5 }),
    ob('l4', 'log', 30, -420, 0.8, 4.5, 0.2, { amplitude: 10, periodS: 16, phase: 2, axisAngle: Math.PI / 2 }),
    ob('d1', 'debris', 36, -110, 4), ob('d2', 'debris', -40, -300, 4.5), ob('d3', 'debris', 10, -450, 4),
    ob('b1', 'buoy', 6, -30, 0.9), ob('b2', 'buoy', -8, -200, 0.9), ob('b3', 'buoy', 24, -340, 0.9), ob('b4', 'buoy', -4, -470, 0.9),
    ob('br1', 'branch', 52, -150, 0.5, 4, 0.9), ob('dk1', 'dock', -80, -420, 1.2, 6, 0.3),
  ];
  return {
    id: 'synthetic', name: 'Synthetic preview lake',
    start: { x: 0, z: 0, heading: 0 }, finish: { x: 0, z: -508, radius: 24 },
    bounds: { minX: -270, maxX: 270, minZ: -620, maxZ: 120 },
    obstacles,
    currents: [{ x: 70, z: -140, radius: 42, pushX: 0.0, pushZ: -2.2 }, { x: -70, z: -380, radius: 36, pushX: 1.6, pushZ: -1 }],
    fog: [{ x: 10, z: -300, radius: 70, density: 0.7 }, { x: -30, z: -440, radius: 55, density: 0.5 }],
    land,
    landmarks: [
      { id: 'academy', kind: 'nevermore_academy', x: 0, z: 72, rotation: 0, scale: 0.85 },
      { id: 'sdock', kind: 'start_dock', x: 0, z: 14, rotation: 0, scale: 1 },
      { id: 'light', kind: 'lighthouse', x: -128, z: -250, rotation: 0, scale: 1 },
      { id: 'wreck', kind: 'wreck', x: 78, z: -388, rotation: 0.6, scale: 1 },
      { id: 'bell', kind: 'bell_buoy', x: -58, z: -200, rotation: 0, scale: 1 },
      { id: 'raven', kind: 'raven_island', x: 0, z: -586, rotation: 0, scale: 1 },
      { id: 'rdock', kind: 'raven_dock', x: 0, z: -538, rotation: 0, scale: 1 },
      { id: 'crypt', kind: 'crypt', x: 70, z: -585, rotation: 0.2, scale: 1 },
    ],
    routes: [
      { id: 'west', name: 'Western bay', risk: 'safe', points: [{ x: 0, z: -14 }, { x: -50, z: -110 }, { x: -90, z: -220 }, { x: -78, z: -360 }, { x: -30, z: -470 }, { x: 0, z: -508 }] },
      { id: 'centre', name: 'Reef channel', risk: 'risky', points: [{ x: 0, z: -14 }, { x: 14, z: -100 }, { x: -8, z: -210 }, { x: 18, z: -330 }, { x: 8, z: -430 }, { x: 0, z: -508 }] },
    ],
    hydeSpawn: { x: 0, z: 40, heading: 0 },
  };
}

// ------------------------------------------------------------------------------------------------ driver
type Mutable = Record<string, unknown> & { s: number; trail: { headS: number; tailS: number }; place(): void; setPhase(p: HydePhase, t: number, ev: ActionEvent[], force?: boolean): void; holdGap: number; stunUntil: number };

const IDLE: InputSnapshot = { forward: false, left: false, right: false, brake: false, interact: false, ability: false, strokes: 0, holdRow: false };

export interface AdvanceOpts {
  /** taps per second (default 3) */
  strokesPerS?: number;
  /** 'auto' follows route waypoints, number = constant steer (-1 right .. 1 left), 0 = straight */
  steer?: 'auto' | number;
  /** frames per sim second that are actually rendered (default 15); the rest are sim-only */
  renderHz?: number;
  /** press Q on the first frame */
  ability?: boolean;
  /** keep the Hyde from waking on his own (default true while calm shots are taken) */
  suppressHyde?: boolean;
}

class Preview {
  run!: StageOneRun;
  scene!: ActionScene;
  course!: CourseDef;
  waypoints: Vec2[] = [];
  wp = 0;
  strokeAcc = 0;
  opts = { low: false, reduced: false };
  lastEvents: ActionEvent[] = [];
  allEvents: ActionEvent[] = [];

  reset(o: { course?: string; character?: CharacterId; pokemon?: PokemonId; low?: boolean; reduced?: boolean } = {}): void {
    this.scene?.dispose();
    this.opts = { low: o.low ?? q.get('low') === '1', reduced: o.reduced ?? q.get('reduced') === '1' };
    const which = o.course ?? q.get('course') ?? 'synthetic';
    this.course = which === 'default' ? defaultCourse() : syntheticCourse();
    this.run = new StageOneRun({ characterId: o.character ?? (q.get('character') as CharacterId) ?? 'wednesday', pokemonId: o.pokemon ?? (q.get('pokemon') as PokemonId) ?? 'aegislash', course: this.course });
    this.scene = new ActionScene(stage, this.run.course, { characterId: (o.character ?? q.get('character') ?? 'wednesday') as CharacterId, pokemonId: (o.pokemon ?? q.get('pokemon') ?? 'aegislash') as PokemonId }, { reducedMotion: this.opts.reduced, lowGraphics: this.opts.low });
    const r = this.run.course.routes?.[0]?.points;
    this.waypoints = r && r.length ? [...r] : [{ x: this.run.course.finish.x, z: this.run.course.finish.z }];
    this.wp = 0;
    this.strokeAcc = 0;
    this.suppress(true);
    this.allEvents = [];
    this.scene.render(this.run, [], 0);
  }

  private ai(): Mutable {
    return this.run.hydeAI as unknown as Mutable;
  }

  /** Stops the run's own time fallbacks from waking the Hyde (so calm shots stay calm). */
  suppress(on: boolean): void {
    const ai = this.run.hydeAI as unknown as Record<string, unknown>;
    if (on) {
      ai.wake = () => undefined;
      ai.emerge = () => undefined;
    } else {
      delete ai.wake;
      delete ai.emerge;
    }
  }

  private steerInput(mode: 'auto' | number): Pick<InputSnapshot, 'left' | 'right'> {
    if (typeof mode === 'number') return { left: mode > 0.1, right: mode < -0.1 };
    const b = this.run.boat;
    while (this.wp < this.waypoints.length - 1 && Math.hypot(this.waypoints[this.wp].x - b.x, this.waypoints[this.wp].z - b.z) < 22) this.wp++;
    const t = this.waypoints[this.wp];
    const want = Math.atan2(-(t.x - b.x), -(t.z - b.z));
    let err = want - b.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    return { left: err > 0.06, right: err < -0.06 };
  }

  advance(seconds: number, o: AdvanceOpts = {}): void {
    const dt = 1 / 30;
    const frames = Math.round(seconds / dt);
    const hz = o.renderHz ?? 15;
    const renderEvery = hz <= 0 ? 1e9 : Math.max(1, Math.round(30 / hz));
    const cps = o.strokesPerS ?? 3;
    const steer = o.steer ?? 'auto';
    if (o.suppressHyde !== undefined) this.suppress(o.suppressHyde);
    for (let i = 0; i < frames; i++) {
      this.strokeAcc += cps * dt;
      const strokes = Math.floor(this.strokeAcc);
      this.strokeAcc -= strokes;
      const input: InputSnapshot = { ...IDLE, ...this.steerInput(steer), strokes, ability: !!o.ability && i === 0 };
      const ev = this.run.update(dt, input);
      this.lastEvents.push(...ev);
      this.allEvents.push(...ev);
      const last = i === frames - 1;
      if (i % renderEvery === 0 || last) {
        this.scene.render(this.run, this.lastEvents, dt * renderEvery);
        this.lastEvents = [];
      }
    }
  }

  /** Follow a polyline (e.g. a course route) with the autopilot; `route` indexes course.routes, or pass explicit points. */
  follow(routeOrPoints: number | Vec2[]): void {
    const pts = typeof routeOrPoints === 'number' ? this.run.course.routes?.[routeOrPoints]?.points : routeOrPoints;
    this.waypoints = pts && pts.length ? [...pts] : this.waypoints;
    this.wp = 0;
  }

  /** Row (sim only, rendering the last second) until the boat is within `radius` of (x, z) or `maxS` sim seconds pass. */
  driveTo(x: number, z: number, radius = 20, maxS = 200): { t: number; x: number; z: number } {
    const dt = 1 / 30;
    let n = 0;
    while (n * dt < maxS && Math.hypot(this.run.boat.x - x, this.run.boat.z - z) > radius) {
      this.advance(1, { renderHz: 0 });
      n += 30;
    }
    this.advance(1, { renderHz: 8 });
    return { t: this.run.t, x: this.run.boat.x, z: this.run.boat.z };
  }

  /** Pin an aerial camera for inspection shots (null = chase camera). */
  aerial(c: { pos: [number, number, number]; look: [number, number, number]; fov?: number } | null): void {
    this.scene.setDebugCamera(c);
    this.scene.render(this.run, [], 0);
  }

  /** Re-render the current state without advancing the sim (settles camera dampers). */
  settle(seconds: number): void {
    const n = Math.max(1, Math.round(seconds * 15));
    for (let i = 0; i < n; i++) this.scene.render(this.run, [], 1 / 15);
  }

  /** Force the Hyde into a phase `gap` units behind the boat (along the real wake). */
  hyde(phase: HydePhase | 'telegraph', gap = 26): void {
    this.suppress(false);
    const ai = this.ai();
    const t = this.run.t;
    const ev: ActionEvent[] = [];
    const real = this.run.hydeAI;
    if (real.state.phase === 'dormant') real.wake(gap, t, ev);
    ai.s = Math.max(ai.trail.tailS, ai.trail.headS - gap);
    ai.holdGap = gap;
    ai.place();
    const set = (p: HydePhase) => ai.setPhase(p, t, ev, true);
    switch (phase) {
      case 'stalking': set('stalking'); break;
      case 'emerging': set('emerging'); break;
      case 'chasing': set('chasing'); break;
      case 'telegraph':
        set('chasing');
        real.requestSurge(t);
        break;
      case 'surging': set('surging'); break;
      case 'lunging': set('lunging'); break;
      case 'stunned': ai.stunUntil = t + 6; set('stunned'); break;
      default: set(phase);
    }
    this.lastEvents.push(...ev);
  }

  /** The run's own emerge path (starts the <=3 s Hyde-reveal cinematic). Needs a stalking Hyde: call hyde('stalking', 45) first. */
  emerge(): void {
    this.suppress(false);
    const ev: ActionEvent[] = [];
    (this.run as unknown as { emerge(e: ActionEvent[]): void }).emerge(ev);
    this.lastEvents.push(...ev);
  }

  /** Close the gap so the next update catches the boat (opens the rescue window). */
  forceCatch(): void {
    this.hyde('chasing', 2.2);
  }

  debug(): object {
    return this.scene.getDebugState(this.run);
  }

  info(): object {
    const r = this.run;
    return {
      t: Math.round(r.t * 10) / 10, status: r.status, catches: r.catches, boat: { x: Math.round(r.boat.x), z: Math.round(r.boat.z), heading: Math.round(r.boat.heading * 100) / 100, speed: Math.round(r.boat.speed * 10) / 10 },
      hyde: { phase: r.hyde.phase, gap: Math.round(r.hyde.distance * 10) / 10, vis: Math.round(r.hyde.visibility * 100) / 100, threat: Math.round(r.hyde.threat * 100) / 100 },
      effects: r.effects(), cinematic: r.cinematic(), rescue: r.rescue.active, telegraph: r.surgeTelegraphLeftS(),
      lakeCourse: hasLakeCourse(), course: r.course.id,
    };
  }

  setOptions(p: { low?: boolean; reduced?: boolean }): void {
    if (p.low !== undefined) this.opts.low = p.low;
    if (p.reduced !== undefined) this.opts.reduced = p.reduced;
    this.scene.setOptions({ lowGraphics: this.opts.low, reducedMotion: this.opts.reduced });
  }

  dispose(): void {
    this.scene.dispose();
  }
}

const p = new Preview();
(window as unknown as Record<string, unknown>).__p = p;
p.reset();

// ------------------------------------------------------------------------------------------------ interactive bar
if (q.get('manual') !== '1') {
  const log = document.createElement('span');
  log.id = 'log';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    bar.appendChild(b);
  };
  const sep = () => { const s = document.createElement('span'); s.className = 'sep'; bar.appendChild(s); };
  let auto = true;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (auto) p.advance(dt, { renderHz: 30, suppressHyde: false });
    log.textContent = JSON.stringify(p.info()).slice(0, 220);
    requestAnimationFrame(loop);
  };
  btn('Pause/Run', () => { auto = !auto; });
  sep();
  for (const ph of ['stalking', 'emerging', 'chasing', 'telegraph', 'lunging', 'stunned'] as const) btn(ph, () => p.hyde(ph, ph === 'lunging' ? 5 : 26));
  btn('catch', () => p.forceCatch());
  sep();
  btn('Q (ability)', () => p.advance(0.05, { ability: true, renderHz: 30 }));
  btn('low', () => p.setOptions({ low: !p.opts.low }));
  btn('reduced', () => p.setOptions({ reduced: !p.opts.reduced }));
  btn('restart synthetic', () => p.reset({ course: 'synthetic' }));
  btn('restart default', () => p.reset({ course: 'default' }));
  bar.appendChild(log);
  requestAnimationFrame(loop);
}
