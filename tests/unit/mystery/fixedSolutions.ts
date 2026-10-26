// Test fixture: ONE fixed murderer per case (the pre-randomization culprits) for tests where WHO did it does not matter.
// Tests about the randomized murderer use CASE_VARIANTS directly (cases.test.ts, caseVariant.test.ts, caseRuns.test.ts).
import { CASE_VARIANTS } from '../../../src/mystery/data/solutions.ts';
import type { CaseId, CaseSolution } from '../../../src/mystery/types.ts';

export const FIXED_SOLUTIONS: Record<CaseId, CaseSolution> = {
  poisoned_archive: CASE_VARIANTS.poisoned_archive.thornhill.solution,
  crypt_last_witness: CASE_VARIANTS.crypt_last_witness.galpin.solution,
  midnight_signal: CASE_VARIANTS.midnight_signal.barry.solution,
};
