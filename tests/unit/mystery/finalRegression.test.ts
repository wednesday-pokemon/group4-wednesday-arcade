// Final-wave regression pins: full event logs of real case episodes (compact play areas, encounter director, Crackstone,
// Slurp, cabinets, v4 rule events) hashed. Any sim / data change that alters a run shows up here — re-pin deliberately
// (print with `npx tsx` + caseHashes()) and say why in the commit. The pre-final fixture pins live in crackstone.test.ts.
import { describe, expect, it } from 'vitest';
import { caseHashes } from './regressionEpisodes.ts';

describe('final regression pins (case maps)', () => {
  it('12 case episodes hash to their pinned logs', () => {
    expect(caseHashes()).toEqual({
      'poisoned_archive:wednesday+gengar': 'ff6fd2be12435f1f',
      'poisoned_archive:gomez+dusknoir': 'd24b30c60a86bcc5',
      'poisoned_archive:bianca+froslass': 'd7527b91f75612cd',
      'poisoned_archive:ajax+aegislash': '4b291c4835bf0515',
      'crypt_last_witness:wednesday+gengar': '02df259714da3bd1',
      'crypt_last_witness:gomez+dusknoir': 'bcd783492a23170d',
      'crypt_last_witness:bianca+froslass': 'ab9ec7aadbe77688',
      'crypt_last_witness:ajax+aegislash': '8d477f2ca816304f',
      'midnight_signal:wednesday+gengar': '961b2bf720565e50',
      'midnight_signal:gomez+dusknoir': 'bf0b0a4f4bef1ff6',
      'midnight_signal:bianca+froslass': '0fa1bdcef5129732',
      'midnight_signal:ajax+aegislash': 'bc7faf3eee7aefbd',
    });
  }, 120_000);
});
