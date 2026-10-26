// Proximity heartbeat: silent far away, strictly faster as the nearest active monster closes in.
import { describe, expect, it } from 'vitest';
import { heartbeatIntervalS } from '../../../src/app/audio.ts';
import { nearestMonsterM } from '../../../src/app/mystery/useMysteryLoop.ts';

describe('proximity heartbeat', () => {
  it('silent beyond 25 m or with no monster out; faster every step closer; capped at 3 m', () => {
    expect(heartbeatIntervalS(null)).toBeNull();
    expect(heartbeatIntervalS(30)).toBeNull();
    const steps = [25, 20, 15, 10, 6, 3].map((d) => heartbeatIntervalS(d)!);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
    expect(steps[0]).toBeCloseTo(1.1);
    expect(heartbeatIntervalS(1)).toBeCloseTo(0.33);
  });

  it('nearest ACTIVE monster only', () => {
    const run = {
      player: { x: 0, z: 0 },
      enemyStatus: () => ({ hyde: { active: false }, crackstone: { active: true }, slurp: { active: true } }),
      hyde: { x: 1, z: 0 }, crackstone: { x: 0, z: 12 }, slurp: { x: 5, z: 0 },
    };
    expect(nearestMonsterM(run)).toBe(5); // the inactive Hyde at 1 m does not count
    expect(nearestMonsterM({ ...run, enemyStatus: () => ({}) })).toBeNull();
  });
});
