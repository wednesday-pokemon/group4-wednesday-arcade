// All 126 duos play midnight_signal with the stealthy bot (abilities on): no softlock, few DNFs, median pacing reported.
import { describe, it } from 'vitest';
import { expectAllDuosOk } from './botDuos.ts';

describe('all 126 duos finish midnight_signal without softlock', () => {
  it('stealthy bot, abilities on', () => {
    expectAllDuosOk('midnight_signal');
  }, 300_000);
});
