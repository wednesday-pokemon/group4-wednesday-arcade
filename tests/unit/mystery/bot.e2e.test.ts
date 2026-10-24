// End-to-end: the scripted bot plays full visits on buildIsland() (3 clues → egg → Iago Tower → accusation).
// (All 126 duos × all 3 cases: botDuos.<case>.test.ts.)
import { describe, expect, it } from 'vitest';
import { playEpisode, type BotEpisode } from '../../../src/mystery/episode.ts';
import { NIGHTSHADE_IDS } from '../../../src/mystery/types.ts';
import { POKEMON_IDS } from '../../../src/mystery/draft.ts';

function summary(eps: BotEpisode[]) {
  const fin = eps.filter((e) => e.result?.outcome === 'finished');
  const times = fin.map((e) => e.result!.activeTimeS).sort((a, b) => a - b);
  return {
    n: eps.length,
    finished: fin.length,
    dnf: eps.filter((e) => e.result?.outcome === 'dnf').length,
    timedOut: eps.filter((e) => e.timedOut).length,
    runsCaught: eps.filter((e) => (e.result?.catches ?? 0) > 0).length,
    medianTimeS: times[Math.floor(times.length / 2)],
    maxTimeS: times[times.length - 1],
  };
}

describe('bot end-to-end on buildIsland()', () => {
  it('stealthy, no powers: every one of the 7 characters finds all 3 clues, delivers and solves the case in a sane time', () => {
    const eps = NIGHTSHADE_IDS.map((c, i) => playEpisode({ characterId: c, pokemonId: POKEMON_IDS[(i * 5) % 18] }, `e2e-stealth-${c}`, { profile: 'stealthy', useAbilities: false }));
    for (const ep of eps) {
      expect(ep.timedOut, `${ep.duo.characterId} timed out`).toBe(false);
      expect(ep.result?.outcome, `${ep.duo.characterId}`).toBe('finished');
      expect(ep.result!.cluesFound).toHaveLength(3);
      expect(ep.result!.verdict).toBe('case_solved');
      expect(ep.result!.activeTimeS).toBeGreaterThan(60);
      expect(ep.result!.activeTimeS).toBeLessThan(400);
      expect(ep.events.filter((e) => e.type === 'ability_used')).toHaveLength(0);
    }
    console.log('stealthy x7', JSON.stringify(summary(eps)));
  }, 120_000);

  it('careless (walk/sprint, no crouch, no hiding) gets caught sometimes; stealthy far less', () => {
    const careless: BotEpisode[] = [];
    const stealthy: BotEpisode[] = [];
    for (let i = 0; i < 21; i++) {
      const duo = { characterId: NIGHTSHADE_IDS[i % 7], pokemonId: POKEMON_IDS[(i * 7) % 18] };
      careless.push(playEpisode(duo, `e2e-cmp-${i}`, { profile: 'careless' }));
      stealthy.push(playEpisode(duo, `e2e-cmp-${i}`, { profile: 'stealthy' }));
    }
    const c = summary(careless);
    const s = summary(stealthy);
    console.log('careless', JSON.stringify(c), 'stealthy', JSON.stringify(s));
    expect(c.runsCaught).toBeGreaterThan(0);
    expect(c.runsCaught).toBeGreaterThan(s.runsCaught);
    expect(c.timedOut + s.timedOut).toBe(0);
    // three hunters with a director: a fair DNF can happen (botDuos.* tolerate ≤ 6 of 126); never a softlock
    expect(s.finished).toBeGreaterThanOrEqual(20);
  }, 180_000);
});
