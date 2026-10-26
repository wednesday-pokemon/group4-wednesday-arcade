// Dev harness for the 3D race scene. Run: npx vite --port 5199  then open /tools/three-preview.html
// Query flags: ?manual=1 (no auto RAF; drive with advanceTime), ?reduced=1, ?low=1
import { RaceScene, isWebGLAvailable, type RaceBeat } from '../src/three/index.ts';
import type { LegIndex, LegResolution, WeatherId } from '../src/game/types.ts';

const q = new URLSearchParams(location.search);
if (q.get('manual') === '1') {
  // deterministic screenshots: the scene is stepped only through advanceTime()
  window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
}

const stage = document.getElementById('stage') as HTMLElement;
const bar = document.getElementById('bar') as HTMLElement;

function base(over: Partial<LegResolution> = {}): LegResolution {
  const legNames = ['', 'Misty Shallows', 'Raven Island Crypts', 'Final Sprint Dock'];
  const leg = (over.legIndex ?? 1) as LegIndex;
  return {
    rulesVersion: 'v2.5', legIndex: leg, legName: legNames[leg], weather: 'clear', route: 'safe', pushLevel: 2, staminaCost: 2,
    eggOffer: 'common', eggDecision: 'skip', draws: { crash: 0.4, eggFailure: 0.5, hyde: 0.5 },
    crashProbability: 0.2, crashOccurred: false, crashNegatedBy: null, crashHpLoss: 0,
    eggAttempted: false, eggFailed: false, eggPointsProvisional: 0, eggPointsLostToCatch: 0, eggPointsBanked: 0,
    gapStartM: 100, gapDeltas: [], gapBeforeCatchM: 110, hydeProbability: null, hydeCatch: false, catchType: null, catchNumber: 0, catchHpLoss: 0, gapEndM: 110,
    hpStart: 100, hpEnd: 100, staminaStart: 6, staminaEnd: 4, bankedBefore: 0, bankedAfter: 0,
    time: { baseCs: 4800, discountPct: 12, speedSavingsCs: 576, weatherDelayCs: 0, crashDelayCs: 0, eggDelayCs: 0, hydeDelayCs: 0, floorAdjustmentCs: 0, totalCs: 4224, discountSources: [] },
    abilityEvents: [], outcome: 'survived', dnfReason: null,
    ...over,
  };
}

export const MOCKS: Record<string, LegResolution> = {
  safe: base({ legIndex: 1, route: 'safe', pushLevel: 1, gapStartM: 100, gapBeforeCatchM: 110, gapEndM: 110 }),
  shortcut_egg: base({ legIndex: 1, route: 'shortcut', pushLevel: 3, eggOffer: 'rare', eggDecision: 'collect', eggAttempted: true, gapStartM: 90, gapBeforeCatchM: 75, gapEndM: 75 }),
  crash_catch: base({
    legIndex: 2, route: 'shortcut', weather: 'strong_currents', pushLevel: 3, eggOffer: 'legendary', eggDecision: 'collect', eggAttempted: true, eggFailed: true,
    crashOccurred: true, crashHpLoss: 10, gapStartM: 70, gapDeltas: [{ source: 'crash', meters: -25 }], gapBeforeCatchM: 25,
    hydeCatch: true, catchType: 'roll', catchNumber: 1, catchHpLoss: 35, eggPointsLostToCatch: 3, gapEndM: 30, hpStart: 100, hpEnd: 55,
  }),
  shield_crash: base({
    legIndex: 2, route: 'shortcut', pushLevel: 2, eggOffer: 'common', eggDecision: 'collect', eggAttempted: true,
    crashOccurred: true, crashNegatedBy: 'rowan', gapStartM: 80, gapBeforeCatchM: 70, gapEndM: 70,
  }),
  dock_finish: base({ legIndex: 3, route: 'safe', weather: 'clear', pushLevel: 3, outcome: 'finished', eggOffer: 'common', eggDecision: 'collect', eggAttempted: true, gapStartM: 60, gapBeforeCatchM: 55, gapEndM: 55 }),
  fog_catch_survive: base({ legIndex: 3, route: 'shortcut', weather: 'heavy_fog', pushLevel: 2, gapStartM: 30, gapBeforeCatchM: 10, hydeCatch: true, catchType: 'proximity', catchNumber: 1, gapEndM: 30 }),
  dnf: base({
    legIndex: 3, route: 'shortcut', pushLevel: 3, crashOccurred: true, gapStartM: 30, gapDeltas: [{ source: 'crash', meters: -25 }], gapBeforeCatchM: 5,
    hydeCatch: true, catchType: 'proximity', catchNumber: 2, outcome: 'dnf', dnfReason: 'second_catch', gapEndM: 30,
  }),
};

if (!isWebGLAvailable()) {
  stage.textContent = 'WebGL not available';
} else {
  const scene = new RaceScene(stage, { reducedMotion: q.get('reduced') === '1', lowGraphics: q.get('low') === '1' });
  const w = window as unknown as Record<string, unknown>;
  w.__scene = scene;
  w.__mocks = MOCKS;
  let leg: LegIndex = 1;
  let weather: WeatherId = 'clear';
  let gap = 100;
  const log = document.createElement('span');
  log.id = 'log';
  const setLog = (s: string) => {
    log.textContent = s;
  };
  const btn = (label: string, fn: () => void, id?: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (id) b.id = id;
    b.onclick = fn;
    bar.appendChild(b);
  };
  const sep = () => {
    const s = document.createElement('span');
    s.className = 'sep';
    bar.appendChild(s);
  };
  const apply = () => {
    scene.setLeg(leg, weather, gap);
    setLog(`leg ${leg} / ${weather} / gap ${gap}`);
  };
  btn('Leg 1', () => { leg = 1; apply(); }, 'leg1');
  btn('Leg 2', () => { leg = 2; apply(); }, 'leg2');
  btn('Leg 3', () => { leg = 3; apply(); }, 'leg3');
  sep();
  btn('Clear', () => { weather = 'clear'; apply(); }, 'w-clear');
  btn('Currents', () => { weather = 'strong_currents'; apply(); }, 'w-currents');
  btn('Fog', () => { weather = 'heavy_fog'; apply(); }, 'w-fog');
  sep();
  btn('Gap 20', () => { gap = 20; apply(); });
  btn('Gap 100', () => { gap = 100; apply(); });
  sep();
  btn('Preview safe', () => scene.setRoutePreview('safe'), 'pv-safe');
  btn('Preview shortcut', () => scene.setRoutePreview('shortcut'), 'pv-short');
  btn('Preview off', () => scene.setRoutePreview(null));
  sep();
  for (const [k, m] of Object.entries(MOCKS)) {
    btn(`Play: ${k}`, () => {
      const beats: string[] = [];
      setLog(`playing ${k}`);
      void scene
        .playLeg(m, (b: RaceBeat) => {
          beats.push(b);
          setLog(`${k}: ${beats.join(' > ')}`);
        })
        .then(() => setLog(`${k}: done (${beats.join(' > ')})`));
    }, `play-${k}`);
  }
  sep();
  btn('Skip', () => scene.skip(), 'skip');
  btn('+1s', () => scene.advanceTime(1000));
  let reduced = q.get('reduced') === '1';
  let low = q.get('low') === '1';
  btn('Toggle reduced', () => { reduced = !reduced; scene.setOptions({ reducedMotion: reduced }); setLog(`reduced=${reduced}`); });
  btn('Toggle low', () => { low = !low; scene.setOptions({ lowGraphics: low }); setLog(`low=${low}`); });
  btn('Dispose', () => scene.dispose());
  bar.appendChild(log);
  apply();
}
