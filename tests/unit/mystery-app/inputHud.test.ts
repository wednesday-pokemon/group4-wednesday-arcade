import { describe, expect, it } from 'vitest';
import { KEY_PITCH_RAD_PER_S, KEY_TURN_RAD_PER_S, LOOK_RAD_PER_PX, MysteryInputController } from '../../../src/app/mystery/input.ts';
import { CaptionLog, captionFor, directionOf, hydeLevel, NoiseMeter, noiseBand, ThingDirector, ThreatHold } from '../../../src/app/mystery/hudModel.ts';
import { STAY_SILENT_LINE, thing, tutorialLines } from '../../../src/app/mystery/thingLines.ts';
import { THING } from '../../../src/mystery/data/thing.ts';
import { parseRoute } from '../../../src/app/routing.ts';

const prefs = { sensitivity: 5, invertY: false, crouchToggle: false };

describe('MysteryInputController', () => {
  it('maps WASD, sprint, hold-crouch (C) and edge keys; edges fire once; E held is reported', () => {
    const c = new MysteryInputController(prefs);
    c.keyDown('KeyW');
    c.keyDown('KeyD');
    c.keyDown('ShiftLeft');
    c.keyDown('KeyC');
    c.keyDown('KeyE');
    const a = c.consume(1 / 60);
    expect(a).toMatchObject({ moveX: 1, moveZ: 1, sprint: true, crouch: true, interact: true, power: false, interactHeld: true });
    const b = c.consume(1 / 60);
    expect(b.interact).toBe(false); // edge consumed
    expect(b.interactHeld).toBe(true); // still held (0.8 s egg set-down)
    c.keyUp('KeyC');
    c.keyUp('KeyE');
    const d = c.consume(1 / 60);
    expect(d.crouch).toBe(false);
    expect(d.interactHeld).toBe(false);
  });

  it('key repeat never re-fires an edge', () => {
    const c = new MysteryInputController(prefs);
    c.keyDown('KeyF');
    c.consume(0.016);
    c.keyDown('KeyF', true);
    expect(c.consume(0.016).power).toBe(false);
  });

  it('Ctrl is ignored (not a game key, no crouch) unless the kiosk keyboard lock is active (ruling 1)', () => {
    let lockedNow = false;
    const c = new MysteryInputController({ ...prefs, crouchToggle: true }, () => lockedNow);
    expect(c.keyDown('ControlLeft')).toBe(false);
    c.keyUp('ControlLeft');
    expect(c.consume(0.016).crouch).toBe(false);
    lockedNow = true;
    expect(c.keyDown('ControlLeft')).toBe(true);
    c.keyUp('ControlLeft');
    expect(c.consume(0.016).crouch).toBe(true);
    c.keyDown('KeyC'); // C always toggles
    expect(c.consume(0.016).crouch).toBe(false);
  });

  it('hold mode: Ctrl crouches only while locked', () => {
    let lockedNow = false;
    const c = new MysteryInputController(prefs, () => lockedNow);
    c.keyDown('ControlLeft');
    expect(c.consume(0.016).crouch).toBe(false);
    lockedNow = true;
    c.keyDown('ControlRight');
    expect(c.consume(0.016).crouch).toBe(true);
  });

  it('mouse right turns right (yaw decreases), mouse up looks up, invert flips pitch, sensitivity 1–10 scales (5 = 1×)', () => {
    const c = new MysteryInputController(prefs);
    c.mouseMove(100, -50);
    const a = c.consume(0.016);
    expect(a.lookYawDelta).toBeCloseTo(-100 * LOOK_RAD_PER_PX);
    expect(a.lookPitchDelta).toBeCloseTo(50 * LOOK_RAD_PER_PX);
    c.prefs = { sensitivity: 10, invertY: true, crouchToggle: false };
    c.mouseMove(10, -10);
    const b = c.consume(0.016);
    expect(b.lookYawDelta).toBeCloseTo(-20 * LOOK_RAD_PER_PX);
    expect(b.lookPitchDelta).toBeCloseTo(-20 * LOOK_RAD_PER_PX);
  });

  it('arrow keys look (ruling 5): ← → 120°/s yaw, ↑ ↓ pitch; they never move', () => {
    const c = new MysteryInputController(prefs);
    c.keyDown('ArrowLeft');
    c.keyDown('ArrowUp');
    const a = c.consume(0.5);
    expect(KEY_TURN_RAD_PER_S).toBeCloseTo((120 * Math.PI) / 180);
    expect(a.lookYawDelta).toBeCloseTo(KEY_TURN_RAD_PER_S * 0.5);
    expect(a.lookPitchDelta).toBeCloseTo(KEY_PITCH_RAD_PER_S * 0.5);
    expect(a.moveZ).toBe(0);
  });

  it('clear() drops held keys (window blur)', () => {
    const c = new MysteryInputController(prefs);
    c.keyDown('KeyW');
    c.clear();
    expect(c.consume(0.016).moveZ).toBe(0);
  });
});

describe('HUD helpers', () => {
  it('noise meter follows own noise only and decays', () => {
    const m = new NoiseMeter();
    m.update([{ type: 'noise', source: 'decoy', x: 0, z: 0, loudness: 1, radiusM: 10 }], 0);
    expect(m.value).toBe(0);
    m.update([{ type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.95, radiusM: 13 }], 0);
    expect(noiseBand(m.value)).toBe('loud');
    m.update([], 1);
    expect(m.value).toBeLessThan(0.1);
  });

  it('noise words: Silent / Quiet ≤ .15 / Audible ≤ .5 / LOUD', () => {
    expect(noiseBand(0)).toBe('silent');
    expect(noiseBand(0.1)).toBe('quiet');
    expect(noiseBand(0.35)).toBe('audible');
    expect(noiseBand(0.95)).toBe('loud');
  });

  it('Hyde danger levels', () => {
    expect(hydeLevel('PATROL', 0.1, false)).toBe(0);
    expect(hydeLevel('PATROL', 0.5, false)).toBe(1);
    expect(hydeLevel('INVESTIGATE_SOUND', 0, false)).toBe(1);
    expect(hydeLevel('CHASE', 0, false)).toBe(2);
    expect(hydeLevel('COOLDOWN', 0, true)).toBe(2);
  });

  it('threat state is held ≥ 0.5 s except CHASE, which shows at once', () => {
    const h = new ThreatHold();
    expect(h.update('INVESTIGATE_SOUND', 0)).toBe('INVESTIGATE_SOUND');
    expect(h.update('PATROL', 0.2)).toBe('INVESTIGATE_SOUND');
    expect(h.update('PATROL', 0.6)).toBe('PATROL');
    expect(h.update('CHASE', 0.65)).toBe('CHASE');
  });

  it('captions: Hyde states with direction, abilities by sound, own footsteps never; de-duplicated; at most two', () => {
    const name = (k: 'F' | 'Q') => (k === 'F' ? 'Siren Call' : 'Make It Rain');
    expect(captionFor({ type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }, name, 'left', 6))
      .toEqual({ text: '[Hyde growls nearby]', tone: 'danger', dir: 'left' });
    expect(captionFor({ type: 'hyde_mode', from: 'SEARCH', to: 'PATROL', reason: 'search_timeout' }, name, 'ahead', 30)).toBeNull(); // > 15 m
    expect(captionFor({ type: 'ability_used', key: 'Q', abilityId: 'make_it_rain', kinds: ['lure'], success: true, detail: '' }, name, null, 9)?.text).toBe('[Coins clatter]');
    expect(captionFor({ type: 'ability_used', key: 'F', abilityId: 'siren_call', kinds: ['lure'], success: true, detail: '' }, name, null, 9)?.text).toBe('[Siren song]');
    expect(captionFor({ type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.95, radiusM: 13 }, name, null, 9)).toBeNull();
    const log = new CaptionLog();
    log.push({ text: 'a', tone: 'info', dir: null }, 0);
    log.push({ text: 'a', tone: 'info', dir: 'left' }, 1);
    log.push({ text: 'b', tone: 'info', dir: null }, 1);
    log.push({ text: 'c', tone: 'info', dir: null }, 1);
    expect(log.items.map((c) => c.text)).toEqual(['b', 'c']);
    expect(log.prune(10)).toHaveLength(0);
  });

  it('bearing → caption arrow (0 ahead, + left)', () => {
    expect(directionOf(0)).toBe('ahead');
    expect(directionOf(Math.PI / 2)).toBe('left');
    expect(directionOf(-Math.PI / 2)).toBe('right');
    expect(directionOf(Math.PI)).toBe('behind');
  });

  it('Thing director: one line at a time, priority interrupts, once-only lines', () => {
    const t = new ThingDirector();
    const vars = { character: 'Enid', pokemon: 'Gengar', power: 'Wolf Shift', move: 'Shadow Ball' };
    const tut = tutorialLines(vars);
    expect(t.say(tut[0]!, 0)).toBe(true);
    expect(t.say(tut[1]!, 0.5)).toBe(false); // same priority waits
    expect(t.say(thing.threat('CHASE', 0), 0.6, { priority: 3 })).toBe(true);
    expect(t.current?.key).toBe('threat_chase_1');
    t.update(100);
    expect(t.say(thing.eggPickup(), 200, { once: true })).toBe(true);
    t.update(300);
    expect(t.say(thing.eggPickup(), 400, { once: true })).toBe(false);
    expect(t.say(null, 500)).toBe(false);
  });

  it('tutorial uses the exact Stay Silent sentence; placeholders are filled; no line names a suspect', () => {
    expect(STAY_SILENT_LINE).toBe('Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.');
    const vars = { character: 'Ajax', pokemon: 'Gholdengo', power: 'Gorgon Gaze', move: 'Make It Rain' };
    const tut = tutorialLines(vars);
    expect(tut.find((l) => l.step === 'stay_silent')?.text).toBe(STAY_SILENT_LINE);
    for (const l of tut) expect(l.text).not.toMatch(/\{\w+\}/);
    expect(thing.duoIntro(vars).text).toContain('Ajax and Gholdengo');
    const all = JSON.stringify(THING) + JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((k) => thing.hint('find_clues', k)));
    expect(all).not.toMatch(/thornhill|marilyn|isaac|barry|dort/i);
  });

  it('V hints rotate: objective first, then generic hints', () => {
    expect(thing.hint('deliver_egg', 0).id).toBe('obj_deliver');
    expect(thing.hint('deliver_egg', 1).id).not.toBe('obj_deliver');
    expect(thing.hint('done', 0).id).toBe(THING.hints[0]!.id);
  });
});

describe('routing', () => {
  it('/ is the mystery journey; rowing kept at mode=rowing with mode=play alias; legacy=1 unchanged', () => {
    expect(parseRoute('').kind).toBe('mystery');
    expect(parseRoute('?mode=rowing').kind).toBe('play');
    expect(parseRoute('?mode=play&character=enid&pokemon=gengar')).toMatchObject({ kind: 'play', characterId: 'enid', pokemonId: 'gengar' });
    expect(parseRoute('?legacy=1')).toMatchObject({ kind: 'terminal', forceLocal: true });
    expect(parseRoute('?mode=dashboard').kind).toBe('mystery_live_dashboard');
    expect(parseRoute('?mode=terminal&station=station_a')).toEqual({ kind: 'mystery_station', stationId: 'station_a' });
    expect(parseRoute('?mode=terminal&station=station_b&legacy=1')).toEqual({ kind: 'terminal', stationId: 'station_b', forceLocal: false });
    expect(parseRoute('?mode=terminal')).toEqual({ kind: 'terminal', stationId: null, forceLocal: true });
    expect(parseRoute('?mode=dashboard&demo=1').kind).toBe('mystery_dashboard');
    expect(parseRoute('?mode=dashboard&legacy=1&demo=1')).toEqual({ kind: 'dashboard', forceLocal: true });
    expect(parseRoute('?mode=dashboard&legacy=1')).toEqual({ kind: 'dashboard', forceLocal: false });
  });

  it('mystery dev shortcut: only a valid Nightshade + Pokémon pair, seed sanitised', () => {
    expect(parseRoute('?mode=mystery&character=ajax&pokemon=gholdengo&seed=abc123&tutorial=0'))
      .toEqual({ kind: 'mystery', characterId: 'ajax', pokemonId: 'gholdengo', seed: 'abc123', skipTutorial: true });
    // xavier is a legacy character, not a selectable Nightshade
    expect(parseRoute('?mode=mystery&character=xavier&pokemon=gengar')).toMatchObject({ characterId: null, pokemonId: null });
    expect(parseRoute('?mode=mystery&seed=<script>')).toMatchObject({ seed: null });
  });
});
