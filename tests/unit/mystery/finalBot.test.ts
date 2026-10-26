// The bot on the final fixture (director + Slurp + a cabinet): every duo finishes or ends in a fair DNF, never a softlock;
// it plays from public information and keeps working with despawning / respawning hunters.
import { describe, expect, it } from 'vitest';
import { allPairs } from '../../../src/mystery/draft.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { FINAL_TUNING, finalMap } from './finalFixture.ts';
import { FIRST_LAYOUT } from './worldFixture.ts';

describe('bot on the final fixture', () => {
  it('stealthy + careless, 42 duos: no timeouts; Slurp / director exercised', () => {
    const pairs = allPairs().filter((_, i) => i % 3 === 0);
    let finished = 0;
    let dnf = 0;
    let cabinets = 0;
    let slurpModes = 0;
    let despawns = 0;
    const times: number[] = [];
    for (const [i, duo] of pairs.entries()) {
      for (const profile of ['stealthy', 'careless'] as const) {
        const ep = playEpisode(duo, `fb-${i}-${profile}`, { profile, useAbilities: true, startDelayMaxS: 0, maxTimeS: 600 }, {
          map: finalMap(), layout: FIRST_LAYOUT, tuning: FINAL_TUNING,
        });
        expect(ep.timedOut, `${duo.characterId}+${duo.pokemonId} ${profile}`).toBe(false);
        if (ep.result?.outcome === 'finished') {
          finished++;
          times.push(ep.result.activeTimeS);
          expect(ep.result.cluesFound).toHaveLength(3);
        } else dnf++;
        cabinets += ep.events.filter((e) => e.type === 'cabinet' && e.action === 'enter').length;
        slurpModes += ep.events.filter((e) => e.type === 'slurp_mode').length;
        despawns += ep.events.filter((e) => e.type === 'enemy_despawned').length;
      }
    }
    times.sort((a, b) => a - b);
    console.log('final fixture bot', JSON.stringify({ n: pairs.length * 2, finished, dnf, median: times[Math.floor(times.length / 2)], cabinets, slurpModes, despawns }));
    // a 40 × 40 m fixture with respawning hunters is much harsher than the real compact maps (botDuos.* report those);
    // this is a softlock / coverage check
    expect(finished).toBeGreaterThanOrEqual(Math.ceil(pairs.length * 2 * 0.35));
    expect(despawns).toBeGreaterThan(0);
    expect(slurpModes).toBeGreaterThan(0);
  }, 300_000);
});
