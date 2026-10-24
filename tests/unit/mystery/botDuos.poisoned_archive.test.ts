// All 126 duos play poisoned_archive with the stealthy bot (abilities on): no softlock, few DNFs, median pacing reported.
import { describe, it } from 'vitest';
import { expectAllDuosOk } from './botDuos.ts';

describe('all 126 duos finish poisoned_archive without softlock', () => {
  it('stealthy bot, abilities on', () => {
    expectAllDuosOk('poisoned_archive');
  }, 300_000);
});
