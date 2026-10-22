// ANSWER KEYS for the three cases (game-designer owned). Server + post-accusation only:
// - Edge Functions import it (via the generated registry) to validate accusations;
// - the browser loads it ONLY with a dynamic import after the visitor has committed the accusation
//   (src/app/mystery/integration.ts loadCaseSolution), so it never ships in the pre-accusation bundle.
//   tests/unit/mystery/caseSecrecy.test.ts fails if any browser module imports this file statically.
import type { CaseId, CaseSolution } from '../types.ts';

export const CASE_SOLUTIONS: Record<CaseId, CaseSolution> = {
  poisoned_archive: {
    caseId: 'poisoned_archive',
    version: 1,
    culprit: 'thornhill',
    supportingEvidence: ['falsified_transfer', 'botanical_residue', 'access_ledger'],
    links: {
      botanical_residue: { proves: 'method', clears: ['isaac'] },
      falsified_transfer: { proves: 'opportunity', clears: [] },
      access_ledger: { proves: 'alibi', clears: ['barry'] },
    },
    innocents: {
      isaac: 'Isaac returned the only other greenhouse key at 9:05 pm and never took it again; the drain mud is from his logged work.',
      barry: 'Barry’s card checked east-wall gates every ten minutes all night; the key ring was his rounds, far from the archive.',
    },
    resolution:
      'Marilyn Thornhill signed out the restricted nightshade tincture at 10:58 pm, used her archive badge to reach Orloff ' +
      'and filed a false transfer for the egg with her own credentials. When Orloff saw through it, she poisoned his tea, ' +
      'then used the stolen egg to draw the Hyde across the grounds and bury her trail in the chaos.',
  },
  crypt_last_witness: {
    caseId: 'crypt_last_witness',
    version: 1,
    culprit: 'isaac',
    supportingEvidence: ['sabotaged_gate', 'tunnel_access_record', 'equipment_match'],
    links: {
      sabotaged_gate: { proves: 'method', clears: [] },
      tunnel_access_record: { proves: 'opportunity', clears: ['thornhill'] },
      equipment_match: { proves: 'alibi', clears: ['barry'] },
    },
    innocents: {
      thornhill: 'Thornhill left the tunnel at 8:55 pm, more than two hours before the gate fell; the archive boxes are hers from that visit.',
      barry: 'The harbour master logged Barry’s lantern at the pier gate at 11:15 pm, across the island from the crypt.',
    },
    resolution:
      'Isaac Night slipped into the restricted tunnel at 11:12 pm to take the egg without permission. When Orloff came down ' +
      'after him, Isaac drew the counterweight pin he alone maintained, and the gate fell on the only witness. His own tool ' +
      'roll — filings, the brass pin and fresh tunnel clay — broke his claim that he never went below.',
  },
  midnight_signal: {
    caseId: 'midnight_signal',
    version: 1,
    culprit: 'barry',
    supportingEvidence: ['falsified_patrol_log', 'alarm_override', 'watchtower_signal'],
    links: {
      alarm_override: { proves: 'method', clears: ['thornhill'] },
      watchtower_signal: { proves: 'opportunity', clears: ['isaac'] },
      falsified_patrol_log: { proves: 'alibi', clears: [] },
    },
    innocents: {
      thornhill: 'Thornhill’s archive card has no clearance for the override console; the lockdown simply trapped her upstairs.',
      isaac: 'The greenhouse vent log shows Isaac’s crank turning every five minutes from 11:00 to 11:45 pm.',
    },
    resolution:
      'Barry Dort disabled the alarms with his own security card at 11:10 pm and broadcast a false lockdown to empty the ' +
      'grounds. At 11:22 pm he flashed the guard’s all-clear from beside the egg path and carried the egg away; the Hyde, ' +
      'loosed in the confusion, found Orloff. Barry rewrote his patrol log to put himself on the north wall.',
  },
};

export function caseSolution(id: CaseId): CaseSolution {
  return CASE_SOLUTIONS[id];
}
