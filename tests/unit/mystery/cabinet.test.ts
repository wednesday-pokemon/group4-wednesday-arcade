// Hiding cabinets (FINAL_CONTRACT §6) through MysteryRun inputs: E enter → open → E close → closed → E exit (door opens,
// step out), WASD exits an open cabinet, closed = invisible, open = crouch-spot rule, witness → pulled out = a hit,
// creaks after creakAfterS, the exit is always walkable, interaction priority.
import { describe, expect, it } from 'vitest';
import { cabinetExitPoint } from '../../../src/mystery/cabinet.ts';
import { withTuning } from '../../../src/mystery/config.ts';
import type { MysteryRun } from '../../../src/mystery/run.ts';
import type { StampedEvent } from '../../../src/mystery/types.ts';
import { hold, place } from './helpers.ts';
import { CABINET, FINAL_TUNING, finalRun } from './finalFixture.ts';

const ofType = <T extends StampedEvent['type']>(ev: StampedEvent[], type: T) => ev.filter((e): e is Extract<StampedEvent, { type: T }> => e.type === type);

/** A run with the director's spawns pushed far out (no enemy unless the test spawns one). */
function quietRun(): MysteryRun {
  const tuning = withTuning({ hyde: { emergeAfterS: 1e6 }, director: { firstSpawnS: { hyde: 1e6, slurp: 1e6 } } }, FINAL_TUNING);
  const run = finalRun({ tuning });
  place(run, -15.6, 5, Math.PI / 2); // next to the door, facing it (−X)
  return run;
}

function enter(run: MysteryRun): StampedEvent[] {
  return hold(run, 0.6, { interact: true });
}

describe('cabinet state machine', () => {
  it('Hide → open → Close Door → closed → Exit → steps out at a walkable exit point', () => {
    const run = quietRun();
    expect(run.interactable()).toMatchObject({ kind: 'cabinet', id: 'cab', label: 'Hide' });
    const ev = hold(run, 0.05, { interact: true });
    expect(ofType(ev, 'cabinet')).toEqual([expect.objectContaining({ spotId: 'cab', action: 'enter', loud: false })]);
    expect(run.player.cabinet).toMatchObject({ spotId: 'cab', phase: 'entering' });
    expect(run.player).toMatchObject({ x: CABINET.x, z: CABINET.z });
    hold(run, 0.5);
    expect(run.player.cabinet?.phase).toBe('open');
    expect(run.snapshot().inCabinet).toBe('open');
    expect(run.interactable()).toMatchObject({ kind: 'cabinet', label: 'Close Door' });
    const close = hold(run, 0.05, { interact: true });
    expect(ofType(close, 'cabinet')[0]).toMatchObject({ action: 'close' });
    expect(run.cabinetStatus()).toMatchObject({ closing: true });
    hold(run, 0.45);
    expect(run.player.cabinet?.phase).toBe('closed');
    expect(run.snapshot()).toMatchObject({ inCabinet: 'closed', hidden: true });
    expect(run.interactable()).toMatchObject({ kind: 'cabinet', label: 'Exit' });
    // movement is ignored while the door is closed
    hold(run, 0.5, { moveZ: 1, sprint: true });
    expect(run.player).toMatchObject({ x: CABINET.x, z: CABINET.z });
    const open = hold(run, 0.05, { interact: true });
    expect(ofType(open, 'cabinet')[0]).toMatchObject({ action: 'open' });
    const out = hold(run, 0.7);
    expect(ofType(out, 'cabinet')[0]).toMatchObject({ action: 'exit' });
    expect(run.player.cabinet).toBeNull();
    expect(run.player.hidden).toBe(false);
    expect(run.playerNav().walkable(run.player.x, run.player.z)).toBe(true);
    expect(run.player.x).toBeGreaterThan(CABINET.x + 1); // the door faces +X
  });

  it('WASD steps out of an OPEN cabinet; E does not enter while a higher-priority target is in reach', () => {
    const run = quietRun();
    enter(run);
    expect(run.player.cabinet?.phase).toBe('open');
    hold(run, 0.8, { moveZ: 1 });
    expect(run.player.cabinet).toBeNull();
    // a clue in reach beats the cabinet (clue > egg > lever > examine > cabinet > switch)
    const run2 = quietRun();
    run2.map.clues[0].x = -15.4;
    run2.map.clues[0].z = 5.5;
    expect(run2.interactable()?.kind).toBe('clue');
  });

  it('the exit point is always a walkable cell (front, else the sides / back)', () => {
    const run = quietRun();
    const nav = run.playerNav();
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const q = cabinetExitPoint(run, { ...CABINET, doorYaw: yaw });
      expect(nav.walkable(q.x, q.z), `doorYaw ${yaw}`).toBe(true);
    }
    // facing the west boundary (−X): the front is out of bounds, so a side / the back is used
    const blocked = cabinetExitPoint(run, { ...CABINET, x: -19.2, doorYaw: Math.PI / 2 });
    expect(nav.walkable(blocked.x, blocked.z)).toBe(true);
  });
});

describe('cabinets vs enemies', () => {
  function withHyde(run: MysteryRun, x: number, z: number, faceX: number, faceZ: number): void {
    run.emergeHyde();
    run.hyde.x = x;
    run.hyde.z = z;
    run.hyde.yaw = Math.atan2(-(faceX - x), -(faceZ - z));
    run.hyde.path = [];
  }

  it('closed = invisible even point-blank in its cone; open = seen within revealM', () => {
    const run = quietRun();
    enter(run);
    hold(run, 0.05, { interact: true });
    hold(run, 0.5);
    expect(run.player.cabinet?.phase).toBe('closed');
    withHyde(run, -15.9, 5, CABINET.x, CABINET.z); // 1.1 m from the cabinet, staring at it
    run.hyde.stunnedUntil = -Infinity;
    run.hydeBrain.calmUntil = 1e9;
    const ev = hold(run, 2);
    expect(ofType(ev, 'hyde_sighted')).toHaveLength(0);
    expect(ofType(ev, 'enemy_detected')).toHaveLength(0);
    expect(run.player.cabinet?.phase).toBe('closed');
  });

  it('an OPEN cabinet with the Hyde inside revealM: it sees the player and drags them out (pulled_out = a catch + enemy_hit)', () => {
    const run = quietRun();
    enter(run);
    expect(run.player.cabinet?.phase).toBe('open');
    withHyde(run, -15.8, 5.6, CABINET.x, CABINET.z);
    const ev = hold(run, 1.5);
    expect(ofType(ev, 'cabinet').map((e) => e.action)).toContain('pulled_out');
    expect(ofType(ev, 'catch')).toHaveLength(1);
    expect(ofType(ev, 'enemy_hit')[0]).toMatchObject({ enemy: 'hyde' });
    expect(run.player.cabinet).toBeNull();
    expect(run.player.catches).toBe(1);
  });

  it('witnessed entry: enemy_detected {witnessed_hide}; the Hyde walks over and pulls the player out of the CLOSED cabinet', () => {
    const run = quietRun();
    withHyde(run, -9, 5, -15.6, 5); // 6.6 m away, looking at the player
    const ev = hold(run, 0.05, { interact: true });
    expect(ofType(ev, 'enemy_detected')).toEqual([expect.objectContaining({ enemy: 'hyde', via: 'witnessed_hide' })]);
    expect(run.cabinetStatus()).toMatchObject({ witnessedBy: 'hyde' });
    hold(run, 0.6);
    hold(run, 0.05, { interact: true }); // close the door anyway
    const later = hold(run, 8);
    expect(ofType(later, 'cabinet').map((e) => e.action)).toContain('pulled_out');
    expect(ofType(later, 'enemy_hit')[0]).toMatchObject({ enemy: 'hyde' });
    expect(run.result()).toBeNull();
    expect(run.player.cabinet).toBeNull();
  });

  it('an unwitnessed hide: a loud slam is heard (loud: true) and investigated, but the Hyde never finds the closed cabinet', () => {
    const run = quietRun();
    withHyde(run, -8, 10, 10, 10); // ~10 m away, looking away (east)
    run.hydeBrain.calmUntil = -Infinity;
    run.player.stance = 'sprint';
    const ev = hold(run, 0.05, { interact: true });
    expect(ofType(ev, 'cabinet')[0]).toMatchObject({ action: 'enter', loud: true });
    expect(ofType(ev, 'enemy_detected')).toHaveLength(0);
    hold(run, 0.6);
    hold(run, 0.05, { interact: true });
    const later = hold(run, 15);
    expect(ofType(later, 'cabinet').map((e) => e.action)).not.toContain('pulled_out');
    expect(run.player.cabinet?.phase).toBe('closed');
  });

  it('no permanent invulnerability: after creakAfterS the door creaks; a Hyde that hears it comes and pulls the player out', () => {
    const run = quietRun();
    enter(run);
    hold(run, 0.05, { interact: true });
    hold(run, 0.5);
    const tIn = run.t;
    withHyde(run, -11, 5, 10, 5); // 6 m away, facing away, calm
    run.hyde.stunnedUntil = run.t + 19; // frozen until the creaks start
    const ev = hold(run, 30);
    const creaks = ofType(ev, 'noise').filter((e) => Math.abs(e.x - CABINET.x) < 0.01 && e.t - tIn >= 18);
    expect(creaks.length).toBeGreaterThanOrEqual(1);
    expect(ofType(ev, 'enemy_detected')).toEqual(expect.arrayContaining([expect.objectContaining({ enemy: 'hyde', via: 'sound' })]));
    expect(ofType(ev, 'cabinet').map((e) => e.action)).toContain('pulled_out');
  });
});
