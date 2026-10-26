// All 126 duos play crypt_last_witness with the stealthy bot (abilities on): no softlock, few DNFs, median pacing reported.
import { describe, it } from 'vitest';
import { expectAllDuosOk } from './botDuos.ts';

describe('all 126 duos finish crypt_last_witness without softlock', () => {
  it('stealthy bot, abilities on', () => {
    expectAllDuosOk('crypt_last_witness');
  }, 300_000);
});
