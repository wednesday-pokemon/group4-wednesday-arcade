// Final rule seams through MysteryRun: result() v4 fields + scoreBreakdown from rule events, Weems hint ladder
// (FINAL_CONTRACT §1 / §8, UX_FINAL §4), rules version.
import { describe, expect, it } from 'vitest';
import { withTuning } from '../../../src/mystery/config.ts';
import { CASE_SOLUTIONS } from '../../../src/mystery/data/solutions.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import type { MysteryRun } from '../../../src/mystery/run.ts';
import { scoreV4 } from '../../../src/mystery/scoring.ts';
import { MYSTERY_RULES_VERSION, type StampedEvent } from '../../../src/mystery/types.ts';
import { hold, place } from './helpers.ts';
import { FINAL_TUNING, finalMap, finalRun } from './finalFixture.ts';
import { FIRST_LAYOUT } from './worldFixture.ts';

const ofType = <T extends StampedEvent['type']>(ev: StampedEvent[], type: T) => ev.filter((e): e is Extract<StampedEvent, { type: T }> => e.type === type);

function quiet(): MysteryRun {
  const tuning = withTuning({ hyde: { emergeAfterS: 1e6 }, director: { firstSpawnS: { hyde: 1e6, slurp: 1e6 } }, player: { hintCooldownS: 8 } }, FINAL_TUNING);
  return finalRun({ tuning });
}

describe('Weems hints (hint_requested {level})', () => {
  it('levels 1 → 2 → 3 per objective step (cooldown between), then exhausted: no event, no charge', () => {
    const run = quiet();
    const levels: number[] = [];
    for (let i = 0; i < 5; i++) {
      const ev = hold(run, 0.05, { hint: true });
      levels.push(...ofType(ev, 'hint_requested').map((e) => e.level!));
      hold(run, 8.1);
    }
    expect(levels).toEqual([1, 2, 3]);
    expect(run.weemsStatus()).toMatchObject({ used: 3, reason: 'exhausted', available: false, nextLevel: null });
  });

  it('cooldown: a second press within hintCooldownS is a no-op', () => {
    const run = quiet();
    hold(run, 0.05, { hint: true });
    expect(run.weemsStatus()).toMatchObject({ reason: 'cooldown', available: false });
    const ev = hold(run, 0.05, { hint: true });
    expect(ofType(ev, 'hint_requested')).toHaveLength(0);
  });

  it('the ladder resets when the objective step changes (a clue found → level 1 again)', () => {
    const run = quiet();
    hold(run, 0.05, { hint: true });
    hold(run, 8.1);
    hold(run, 0.05, { hint: true });
    hold(run, 8.1);
    run.cluesFound.push('falsified_transfer');
    const ev = hold(run, 0.05, { hint: true });
    expect(ofType(ev, 'hint_requested')).toEqual([expect.objectContaining({ level: 1 })]);
    expect(run.weemsStatus().used).toBe(3);
  });

  it('while any enemy is engaged a press is a no-op ("hunted")', () => {
    const tuning = withTuning({ director: { firstSpawnS: { hyde: 1e6, slurp: 0 } }, hyde: { emergeAfterS: 1e6 } }, FINAL_TUNING);
    const run = finalRun({ tuning });
    hold(run, 0.05);
    run.slurp!.mode = 'CHASE';
    run.slurp!.stunnedUntil = 1e9;
    expect(run.weemsStatus().reason).toBe('hunted');
    expect(ofType(hold(run, 0.05, { hint: true }), 'hint_requested')).toHaveLength(0);
  });

  it('the accusation panel can still ask (requestHint while accusing applies at once)', () => {
    const run = quiet();
    run.status = 'accusing';
    const ev = run.requestHint();
    expect(ev).toEqual([expect.objectContaining({ type: 'hint_requested', level: 1 })]);
  });
});

describe('result() — mystery-v4', () => {
  it('a bot finisher: counts from rule events, score = breakdown.total = scoreV4(parts)', () => {
    const ep = playEpisode({ characterId: 'wednesday', pokemonId: 'gengar' }, 'v4-res', { profile: 'stealthy', startDelayMaxS: 0 }, {
      map: finalMap(), layout: FIRST_LAYOUT, tuning: FINAL_TUNING,
    });
    const r = ep.result!;
    expect(r.rulesVersion).toBe('mystery-v4');
    expect(MYSTERY_RULES_VERSION).toBe('mystery-v4');
    if (r.outcome !== 'finished') return; // a fair DNF is possible; the DNF path is covered elsewhere
    const count = (t: string) => ep.events.filter((e) => e.type === t).length;
    expect(r.hintsUsed).toBe(count('hint_requested'));
    expect(r.detections).toBe(count('enemy_detected'));
    expect(r.hits).toBe(count('enemy_hit'));
    expect(r.defeatedBy).toBeNull();
    const expected = scoreV4({
      delivered: true, correct: r.correct, cluesFound: r.cluesFound.length, detections: r.detections!, hintsUsed: r.hintsUsed!, hits: r.hits!, activeTimeS: r.activeTimeS,
    });
    expect(r.scoreBreakdown).toEqual(expected);
    expect(r.score).toBe(expected.total);
    expect(ofType(ep.events, 'finish')[0].score).toBe(expected.total);
  });

  it('hints, detections and hits change the breakdown exactly', () => {
    const run = quiet();
    hold(run, 0.05, { hint: true });
    run.emit({ type: 'enemy_detected', enemy: 'hyde', via: 'sight' });
    run.emit({ type: 'enemy_hit', enemy: 'slurp', hpLost: 30, blocked: false });
    run.status = 'accusing';
    run.deliveredAt = 99.6;
    run.egg.state = 'delivered';
    const sol = CASE_SOLUTIONS.poisoned_archive;
    run.accuse({ suspectId: sol.culprit, evidence: [] }, sol);
    expect(run.result()!.scoreBreakdown).toEqual({
      delivery: 1000, accusation: 300, clues: 0, noDetection: 0, noHints: 0, timeBonus: 201, hintPenalty: -50, hitPenalty: -75, total: 1376,
    });
    place(run, 0, 0);
  });
});

describe('fairness: no endless Hyde chase', () => {
  it('a chase that has not grabbed after hyde.maxChaseS gives up (SEARCH gave_up) and cannot restart for 5 s', () => {
    const tuning = withTuning({ director: { firstSpawnS: { hyde: 1e6, slurp: 1e6 } }, hyde: { emergeAfterS: 1e6 } }, FINAL_TUNING);
    const run = finalRun({ tuning });
    run.emergeHyde();
    place(run, 0, 12, Math.PI);
    run.hyde.x = 0;
    run.hyde.z = 6;
    run.hyde.yaw = Math.PI; // facing +Z, the player
    run.hyde.mode = 'CHASE';
    const ev: StampedEvent[] = [];
    for (let i = 0; i < 40 * 60 && run.status === 'playing'; i++) {
      // keep the player in sight but out of grab reach
      run.hyde.z = Math.min(run.hyde.z, run.player.z - 5);
      ev.push(...hold(run, 1 / 60));
      if (ev.some((e) => e.type === 'hyde_mode' && e.from === 'CHASE')) break;
    }
    const end = ofType(ev, 'hyde_mode').find((e) => e.from === 'CHASE');
    expect(end).toMatchObject({ to: 'SEARCH', reason: 'gave_up' });
    expect(end!.t).toBeGreaterThanOrEqual(run.tuning.hyde.maxChaseS - 0.1);
    const after = hold(run, 4);
    expect(ofType(after, 'hyde_mode').some((e) => e.to === 'CHASE')).toBe(false);
  });
});

