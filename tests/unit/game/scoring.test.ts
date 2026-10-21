import { describe, expect, it } from 'vitest';
import {
  compareScoreRecords, computeFinalEggPoints, computeFinalScore, computeScoreCenti, formatSeconds, isoToEpochMs,
  rankLeaderboard,
} from '../../../src/game/index.ts';
import type { ScoreRecord } from '../../../src/game/index.ts';

function rec(o: Partial<ScoreRecord> & { sessionId: string }): ScoreRecord {
  return {
    nickname: 'N', stationId: 'local', characterId: 'enid', pokemonId: 'gengar', status: 'completed', finalEggPoints: 0,
    totalSimulatedTimeCs: 0, finalScore: 0, completedAt: '2026-10-27T10:00:00.000Z', verified: true, rulesVersion: 'v2.5', ...o,
  };
}

describe('scoring', () => {
  it('Gholdengo floor(banked x 1.25); others raw', () => {
    expect(computeFinalEggPoints(7, 'gholdengo')).toBe(8);
    expect(computeFinalEggPoints(4, 'gholdengo')).toBe(5);
    expect(computeFinalEggPoints(3, 'gholdengo')).toBe(3);
    expect(computeFinalEggPoints(1, 'gholdengo')).toBe(1);
    expect(computeFinalEggPoints(0, 'gholdengo')).toBe(0);
    expect(computeFinalEggPoints(7, 'sableye')).toBe(7);
  });
  it('score = eggs x 100 - seconds, exact to 2 dp, may be negative', () => {
    expect(computeScoreCenti(5, 13000)).toBe(37000);
    expect(computeFinalScore(5, 13000)).toBe(370);
    expect(computeFinalScore(0, 12345)).toBe(-123.45);
    expect(computeFinalScore(1, 12345)).toBe(-23.45);
    expect(computeFinalScore(2, 14567)).toBe(54.33);
  });
  it('formatSeconds', () => {
    expect(formatSeconds(4560)).toBe('45.60');
    expect(formatSeconds(4224)).toBe('42.24');
    expect(formatSeconds(5)).toBe('0.05');
    expect(formatSeconds(0)).toBe('0.00');
    expect(formatSeconds(-12345)).toBe('-123.45');
    expect(formatSeconds(150)).toBe('1.50');
  });
});

describe('leaderboard', () => {
  it('tiebreak: score desc, eggs desc, time asc, completion asc, session id asc', () => {
    const records = [
      rec({ sessionId: 'f', finalScore: 100, finalEggPoints: 3, totalSimulatedTimeCs: 20000, completedAt: '2026-10-27T10:00:00Z' }),
      rec({ sessionId: 'e', finalScore: 100, finalEggPoints: 3, totalSimulatedTimeCs: 20000, completedAt: '2026-10-27T10:00:00Z' }),
      rec({ sessionId: 'd', finalScore: 100, finalEggPoints: 3, totalSimulatedTimeCs: 20000, completedAt: '2026-10-27T09:00:00Z' }),
      rec({ sessionId: 'c', finalScore: 100, finalEggPoints: 3, totalSimulatedTimeCs: 19000, completedAt: '2026-10-27T11:00:00Z' }),
      rec({ sessionId: 'b', finalScore: 100, finalEggPoints: 4, totalSimulatedTimeCs: 30000, completedAt: '2026-10-27T12:00:00Z' }),
      rec({ sessionId: 'a', finalScore: 200, finalEggPoints: 1, totalSimulatedTimeCs: 40000 }),
    ];
    expect(rankLeaderboard(records).map((r) => r.sessionId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
  it('completion time compares chronologically across ISO formats', () => {
    const x = rec({ sessionId: 'x', completedAt: '2026-10-27T10:00:00.500Z' });
    const y = rec({ sessionId: 'y', completedAt: '2026-10-27T10:00:00Z' });
    expect(compareScoreRecords(x, y)).toBeGreaterThan(0);
    const z = rec({ sessionId: 'z', completedAt: '2026-10-27T11:30:00+02:00' }); // 09:30Z, earlier than y
    expect(compareScoreRecords(z, y)).toBeLessThan(0);
  });
  it('isoToEpochMs matches the platform parser on assorted ISO strings', () => {
    for (const iso of ['1970-01-01T00:00:00Z', '2026-10-27T10:00:00.123Z', '2000-02-29T23:59:59.999+05:30', '1999-12-31T00:00:00-08:00', '2026-03-01']) {
      expect(isoToEpochMs(iso)).toBe(Date.parse(iso));
    }
    expect(Number.isNaN(isoToEpochMs('not a date'))).toBe(true);
  });
  it('excludes dnf/abandoned/in_progress, keeps negative completed scores, does not mutate input', () => {
    const records = [
      rec({ sessionId: 'dnf', status: 'dnf', finalScore: 0 }),
      rec({ sessionId: 'ab', status: 'abandoned', finalScore: 0 }),
      rec({ sessionId: 'ip', status: 'in_progress', finalScore: 0 }),
      rec({ sessionId: 'neg', finalScore: -120.5, totalSimulatedTimeCs: 12050 }),
      rec({ sessionId: 'pos', finalScore: 50, finalEggPoints: 2, totalSimulatedTimeCs: 15000 }),
    ];
    const copy = JSON.stringify(records);
    expect(rankLeaderboard(records).map((r) => r.sessionId)).toEqual(['pos', 'neg']);
    expect(JSON.stringify(records)).toBe(copy);
  });
});
