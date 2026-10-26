// ANSWER KEYS + culprit-specific clue content for the 9 case × culprit variants (game-designer owned). SECRET:
// - Edge Functions import it (via the generated registry) to validate accusations and to return a found clue's
//   variant content with the append ack (LIVE);
// - the browser loads it ONLY with a dynamic import (src/app/mystery/integration.ts), never in the pre-accusation
//   bundle. tests/unit/mystery/caseSecrecy.test.ts fails if any browser module imports this file statically.
//
// Version 4 (2026-10-26): RANDOM CULPRIT. Every session draws the culprit from Thornhill / Galpin / Barry in any case.
// The public clues in cases.ts are sealed; CASE_VARIANTS[case][culprit] holds the answer key (`solution`) and what each
// of the case's three clues really shows in that scenario (`clues`). The physical clue objects and their places are the
// same in every variant; what they record changes. Each culprit's chain uses their own access and skills:
//   Thornhill = archive credentials, greenhouse sign-outs, archive key safe / lamp / fire-panel override;
//   Galpin    = visitor pass + researcher login, borrowed greenhouse key, crypt restoration key + kit, old plans;
//   Barry     = security card, master key ring, night-watch override code, pier lantern, patrol log.
// Rules for every variant (tests/unit/mystery/cases.test.ts): METHOD, OPPORTUNITY and a BROKEN ALIBI against the
// culprit, one link per clue; the culprit is named in all three clues; each innocent in exactly one — the clue whose
// link clears them, by CONFIRMING their fixed public statement (cases.ts); `mentions` = the suspects named (or referred
// to by role, see ROLE_PATTERNS) in `text`. Budgets: text ≤ 300, short ≤ 90, meaning ≤ 60, deduction ≤ 120, found ≤ 50.
// Times are consistent inside a variant (Case 02: the gate fell just before the 11:20 pm bell; Case 03: alarms died at
// 11:10 pm, the egg path signal at 11:22 pm).
import type { CaseId, CaseSolution, CaseVariant, SuspectId } from '../types.ts';

export const CASE_VARIANTS: Record<CaseId, Record<SuspectId, CaseVariant>> = {
  // =================================================================================================== Case 01
  poisoned_archive: {
    thornhill: {
      solution: {
        caseId: 'poisoned_archive',
        version: 4,
        culprit: 'thornhill',
        supportingEvidence: ['falsified_transfer', 'botanical_residue', 'access_ledger'],
        links: {
          botanical_residue: { proves: 'method', clears: ['galpin'] },
          falsified_transfer: { proves: 'opportunity', clears: [] },
          access_ledger: { proves: 'alibi', clears: ['barry'] },
        },
        innocents: {
          galpin: 'Galpin returned her borrowed greenhouse key at 9:05 pm, as she said, and never took it again, so she never had the poison.',
          barry: 'Barry’s card checked the east-wall gates every ten minutes all night, exactly as he said, far from the archive.',
        },
        resolution:
          'Marilyn Thornhill signed out the restricted nightshade tincture at 10:58 pm, used her archive badge to reach Orloff ' +
          'and filed a false transfer for the egg with her own credentials. When Orloff saw through it, she poisoned his tea, ' +
          'then used the stolen egg to draw the Hyde across the grounds and bury her trail in the chaos.',
      },
      clues: {
        falsified_transfer: {
          text:
            'An egg-transfer request moving the egg "to the archive vault for study", authorised with M. Thornhill\'s archive ' +
            'credentials at 11:31 pm. Orloff\'s pencil in the margin: "I never asked for this." The form can only be filed ' +
            'from an archive terminal.',
          short: 'A fake egg-transfer form was filed with Thornhill’s archive login.',
          meaning: 'Thornhill’s archive login moved the egg.',
          mentions: ['thornhill'],
          deduction: 'Someone with archive credentials signed the egg away. Orloff knew it was false.',
          found: 'A transfer request. Orloff never wrote it.',
        },
        botanical_residue: {
          text:
            'The violet residue in Orloff\'s teacup matches the greenhouse\'s restricted nightshade tincture. Inventory: one vial ' +
            'signed out under M. Thornhill at 10:58 pm. The annex key ledger shows F. Galpin returned her borrowed key at ' +
            '9:05 pm and never took it again.',
          short: 'The tea poison matches a vial signed out under Thornhill tonight.',
          meaning: 'Galpin’s key was back; only Thornhill’s vial was out.',
          mentions: ['thornhill', 'galpin'],
          deduction: 'The poison came from a vial signed out tonight; only one greenhouse key was out after nine.',
          found: 'Violet residue. Compare it with the teacup.',
        },
        access_ledger: {
          text:
            'The door-access ledger kept at the porter\'s lodge: Thornhill\'s badge opened the greenhouse annex at 10:55 pm and ' +
            'Orloff\'s archive at 11:29 pm — the hour she says she spent in the reading room. B. Dort\'s card shows only ' +
            'east-wall gates, every ten minutes, all night.',
          short: 'Thornhill’s badge opened the greenhouse and archive when she says she was reading.',
          meaning: 'Thornhill’s alibi breaks; Barry stayed on the east wall.',
          mentions: ['thornhill', 'barry'],
          deduction: 'The badge record puts one person at both doors. One patrol never left the east wall.',
          found: 'A door ledger. Times matter. Check the board.',
        },
      },
    },
    galpin: {
      solution: {
        caseId: 'poisoned_archive',
        version: 4,
        culprit: 'galpin',
        supportingEvidence: ['falsified_transfer', 'botanical_residue', 'access_ledger'],
        links: {
          botanical_residue: { proves: 'method', clears: [] },
          falsified_transfer: { proves: 'opportunity', clears: ['thornhill'] },
          access_ledger: { proves: 'alibi', clears: ['barry'] },
        },
        innocents: {
          thornhill: 'The archive log shows Thornhill’s catalogue entries from the reading room every few minutes, 7 pm to midnight, just as she said.',
          barry: 'Barry’s card checked the east-wall gates every ten minutes all night, exactly as he said, far from the greenhouse and the archive.',
        },
        resolution:
          'Françoise Galpin slipped out of the chapel ruins at 10:45 pm, signed the greenhouse key out again and took a vial of ' +
          'nightshade tincture. At 11:29 pm her visitor pass let her into Orloff’s archive, where she filed a false transfer for ' +
          'the egg with her researcher login. When Orloff saw through it, she poisoned his tea and let the stolen egg draw the ' +
          'Hyde across the grounds, then hurried back to the chapel ruins.',
      },
      clues: {
        falsified_transfer: {
          text:
            'An egg-transfer request for Orloff\'s egg, filed at 11:31 pm with the visiting-researcher login issued to F. Galpin. ' +
            'Orloff\'s pencil in the margin: "I never asked for this." The log also shows M. Thornhill\'s catalogue entries ' +
            'from the reading room every few minutes, 7 pm to midnight.',
          short: 'The fake transfer used Galpin’s researcher login. Thornhill was cataloguing.',
          meaning: 'Galpin’s login moved the egg; Thornhill stayed put.',
          mentions: ['galpin', 'thornhill'],
          deduction: 'A visitor’s login signed the egg away. The reading-room log never paused.',
          found: 'A transfer request. Orloff never wrote it.',
        },
        botanical_residue: {
          text:
            'The violet residue in Orloff\'s teacup matches the greenhouse\'s restricted nightshade tincture. One vial is missing, ' +
            'never signed out. The annex key ledger: F. Galpin returned her borrowed key at 9:05 pm, then signed it out again ' +
            'at 10:50 pm and brought it back at 11:05.',
          short: 'The poison vial went missing while Galpin had the greenhouse key again.',
          meaning: 'Galpin took the greenhouse key again at 10:50.',
          mentions: ['galpin'],
          deduction: 'The poison came from the greenhouse. One key went back out after nine, and a vial went with it.',
          found: 'Violet residue. Compare it with the teacup.',
        },
        access_ledger: {
          text:
            'The porter\'s door ledger: F. Galpin\'s visitor pass left the chapel ruins gate at 10:45 pm and came back at 11:50 — ' +
            'the hour she says she spent copying plans there. At 11:29 it opened Orloff\'s archive. B. Dort\'s card shows only ' +
            'east-wall gates, every ten minutes, all night.',
          short: 'Galpin’s pass left the chapel and opened the archive. Barry stayed on the east wall.',
          meaning: 'Galpin’s chapel alibi breaks; Barry stayed on rounds.',
          mentions: ['galpin', 'barry'],
          deduction: 'One pass left its claimed place and reached the archive at 11:29. One patrol never left the east wall.',
          found: 'A door ledger. Times matter. Check the board.',
        },
      },
    },
    barry: {
      solution: {
        caseId: 'poisoned_archive',
        version: 4,
        culprit: 'barry',
        supportingEvidence: ['falsified_transfer', 'botanical_residue', 'access_ledger'],
        links: {
          botanical_residue: { proves: 'method', clears: ['galpin'] },
          falsified_transfer: { proves: 'opportunity', clears: [] },
          access_ledger: { proves: 'alibi', clears: ['thornhill'] },
        },
        innocents: {
          thornhill: 'Thornhill’s badge entered the reading room at 6:55 pm and never left before midnight, just as she said.',
          galpin: 'Galpin returned her borrowed greenhouse key at 9:05 pm, as she said, and never took it again; the poison cabinet was opened with a master key.',
        },
        resolution:
          'Barry Dort left his east-wall rounds at 10:40 pm and used the master key on his ring to take a vial of nightshade ' +
          'tincture from the greenhouse. At 11:28 pm his card let him into Orloff’s archive, where he filed a false transfer for ' +
          'the egg with the night-watch override code. When Orloff saw through it, Barry poisoned his tea and used the egg to ' +
          'draw the Hyde across the grounds.',
      },
      clues: {
        falsified_transfer: {
          text:
            'An egg-transfer request for Orloff\'s egg, filed at 11:31 pm from an archive terminal with the night-watch override ' +
            'code. That code unlocks any terminal after hours, and it is stored on one card only: B. Dort\'s. Orloff\'s pencil in ' +
            'the margin: "I never asked for this."',
          short: 'The fake transfer was filed with the night-watch override code on Barry’s card.',
          meaning: 'Barry’s override code moved the egg.',
          mentions: ['barry'],
          deduction: 'An override code signed the egg away from an archive terminal. Orloff knew it was false.',
          found: 'A transfer request. Orloff never wrote it.',
        },
        botanical_residue: {
          text:
            'The violet residue in Orloff\'s teacup matches the greenhouse\'s restricted nightshade tincture. One vial is gone, ' +
            'never signed out: the cabinet was opened at 10:52 pm with the master key on B. Dort\'s ring. F. Galpin returned her ' +
            'borrowed annex key at 9:05 pm and never took it again.',
          short: 'The poison vial was taken with the master key on Barry’s ring. Galpin’s key was back.',
          meaning: 'Barry’s master key opened the poison; Galpin’s was back.',
          mentions: ['barry', 'galpin'],
          deduction: 'The poison left its cabinet by a master key at 10:52. The only borrowed key was back by nine.',
          found: 'Violet residue. Compare it with the teacup.',
        },
        access_ledger: {
          text:
            'The porter\'s door ledger: B. Dort\'s card checked the east-wall gates every ten minutes — except 10:40 to 11:40 pm. ' +
            'In that gap it opened the greenhouse annex at 10:50 and Orloff\'s archive at 11:28. M. Thornhill\'s badge entered ' +
            'the reading room at 6:55 pm and never left before midnight.',
          short: 'Barry’s card skipped an hour of rounds and opened the greenhouse and archive.',
          meaning: 'Barry’s rounds alibi breaks; Thornhill never left.',
          mentions: ['barry', 'thornhill'],
          deduction: 'One card left the east wall for an hour and reached two other doors. One badge never left its room.',
          found: 'A door ledger. Times matter. Check the board.',
        },
      },
    },
  },

  // =================================================================================================== Case 02
  crypt_last_witness: {
    thornhill: {
      solution: {
        caseId: 'crypt_last_witness',
        version: 4,
        culprit: 'thornhill',
        supportingEvidence: ['sabotaged_gate', 'tunnel_access_record', 'equipment_match'],
        links: {
          equipment_match: { proves: 'method', clears: ['barry'] },
          sabotaged_gate: { proves: 'opportunity', clears: ['galpin'] },
          tunnel_access_record: { proves: 'alibi', clears: [] },
        },
        innocents: {
          galpin: 'Galpin’s restoration key and kit stayed locked in the library all night, as she said; the gate was opened with another key.',
          barry: 'The harbour master logged Barry’s lantern at the pier gate from 11:10 to 11:30 pm, across the island, when the bell rang.',
        },
        resolution:
          'Marilyn Thornhill signed the archive’s spare crypt key out at 10:50 pm and went back down the tunnel at 11:05 pm to ' +
          'carry the egg below. When Orloff followed her, she drew the gate’s counterweight pin and cut the chain with a ' +
          'greenhouse saw, and the gate fell on the only witness. Her second line on the sign-in sheet broke her claim that ' +
          'she worked upstairs after her early visit.',
      },
      clues: {
        sabotaged_gate: {
          text:
            'The crypt gate\'s counterweight pin was drawn out and its chain cut half through — no storm did this. The lock was ' +
            'opened with the spare crypt key from the archive key safe, signed out by M. Thornhill at 10:50 pm. F. Galpin\'s ' +
            'restoration key and kit stayed locked in the library all night.',
          short: 'Thornhill signed out the spare gate key. Galpin’s key and kit stayed locked away.',
          meaning: 'Thornhill had the key; Galpin’s stayed in the library.',
          mentions: ['thornhill', 'galpin'],
          deduction: 'The gate was made to fall, through a lock opened with a key signed out tonight. The restoration key never moved.',
          found: 'A cut chain. This gate was made to fall.',
        },
        tunnel_access_record: {
          text:
            'The sign-in sheet for the restricted tunnel under the crypt: M. Thornhill, in at 8:40 pm with archive boxes, signed ' +
            'out at 8:55 pm. Then a second line in the same hand: "M. Thornhill — 11:05 pm", minutes before the gate fell. No ' +
            'sign-out follows. No other name tonight.',
          short: 'Thornhill signed back into the tunnel at 11:05, minutes before the gate fell.',
          meaning: 'Thornhill went back below; she did not stay upstairs.',
          mentions: ['thornhill'],
          deduction: 'An early visit was not the only one. The same name came back just before the collapse.',
          found: 'A sign-in sheet. Mind the times.',
        },
        equipment_match: {
          text:
            'A tool bag stashed underground, tagged "Greenhouse — M. Thornhill": a pruning saw with chain filings and the gate\'s ' +
            'brass pin, caked in fresh tunnel clay. The harbour master logged B. Dort\'s lantern at the pier gate from 11:10 to ' +
            '11:30 pm.',
          short: 'Thornhill’s greenhouse tool bag holds a saw and the gate’s pin. Barry was at the pier.',
          meaning: 'Thornhill’s tools cut the chain; Barry was at the pier.',
          mentions: ['thornhill', 'barry'],
          deduction: 'The saw that cut the chain was hidden below with the gate pin. The pier log fixes one lantern far away.',
          found: 'Tools. Clay. Compare them with the gate.',
        },
      },
    },
    galpin: {
      solution: {
        caseId: 'crypt_last_witness',
        version: 4,
        culprit: 'galpin',
        supportingEvidence: ['sabotaged_gate', 'tunnel_access_record', 'equipment_match'],
        links: {
          sabotaged_gate: { proves: 'method', clears: [] },
          tunnel_access_record: { proves: 'opportunity', clears: ['thornhill'] },
          equipment_match: { proves: 'alibi', clears: ['barry'] },
        },
        innocents: {
          thornhill: 'Thornhill left the tunnel at 8:55 pm, more than two hours before the gate fell; the archive boxes are hers from that visit.',
          barry: 'The harbour master logged Barry’s lantern at the pier gate from 11:10 to 11:30 pm, across the island, when the bell rang.',
        },
        resolution:
          'Françoise Galpin used her crypt restoration key to slip into the restricted tunnel at 11:12 pm and carry the egg ' +
          'below. When Orloff followed her down, she drew the gate’s counterweight pin and sawed the chain, and the gate fell ' +
          'on the only witness. Her own satchel — the wire saw, the brass pin and fresh tunnel clay — broke her claim that her ' +
          'kit never left the library.',
      },
      clues: {
        sabotaged_gate: {
          text:
            'The crypt gate\'s counterweight pin was drawn out and its chain sawn half through with a fine wire saw — no ' +
            'storm did this. The gate\'s lock was opened with the crypt restoration key, issued only to F. Galpin. The brass ' +
            'pin is missing.',
          short: 'The gate’s chain was sawn and its lock opened with Galpin’s restoration key.',
          meaning: 'The gate fell on purpose; one key opens its lock.',
          mentions: ['galpin'],
          deduction: 'The gate was made to fall. Its lock opens with exactly one issued key.',
          found: 'A sawn chain. This gate was made to fall.',
        },
        tunnel_access_record: {
          text:
            'The sign-in sheet for the restricted tunnel under the crypt: "F. Galpin — 11:12 pm", minutes before the gate ' +
            'fell. The only other entry tonight: M. Thornhill, in at 8:40 pm with archive boxes, signed out at 8:55 pm.',
          short: 'Galpin signed into the tunnel just before the gate fell. Thornhill left hours earlier.',
          meaning: 'Galpin was below at 11:12; Thornhill was long gone.',
          mentions: ['galpin', 'thornhill'],
          deduction: 'One name entered the tunnel just before the collapse; the other left hours earlier.',
          found: 'A sign-in sheet. Mind the times.',
        },
        equipment_match: {
          text:
            'A satchel stashed underground, stamped "F. Galpin — Restoration": a wire saw with chain filings and the gate\'s ' +
            'brass pin, caked in fresh tunnel clay. The harbour master logged B. Dort\'s lantern at the pier gate from 11:10 ' +
            'to 11:30 pm.',
          short: 'Galpin’s satchel holds a wire saw, the gate’s pin and fresh tunnel clay.',
          meaning: 'Galpin’s kit went below; Barry was at the pier.',
          mentions: ['galpin', 'barry'],
          deduction: 'The kit said to be locked upstairs was below, with the gate pin. The pier log fixes one lantern far away.',
          found: 'Tools. Clay. Compare them with the gate.',
        },
      },
    },
    barry: {
      solution: {
        caseId: 'crypt_last_witness',
        version: 4,
        culprit: 'barry',
        supportingEvidence: ['sabotaged_gate', 'tunnel_access_record', 'equipment_match'],
        links: {
          sabotaged_gate: { proves: 'method', clears: [] },
          tunnel_access_record: { proves: 'opportunity', clears: ['thornhill'] },
          equipment_match: { proves: 'alibi', clears: ['galpin'] },
        },
        innocents: {
          thornhill: 'Thornhill left the tunnel at 8:55 pm, more than two hours before the gate fell; the archive boxes are hers from that visit.',
          galpin: 'Galpin’s restoration kit sat sealed in the library all night, as she said; the gate was opened with a master key, not hers.',
        },
        resolution:
          'Barry Dort left the pier gate before 11 pm and signed into the restricted tunnel at 11:06 pm, carrying the egg below. ' +
          'When Orloff followed him down, he opened the gate’s lock with his master key, drew the counterweight pin and cut the ' +
          'chain, and the gate fell on the only witness. His pier lantern, hidden below with the bolt cutters, broke his claim ' +
          'that he was at the pier gate when the bell rang.',
      },
      clues: {
        sabotaged_gate: {
          text:
            'The crypt gate\'s counterweight pin was drawn out and its chain cut half through with heavy bolt cutters — no storm ' +
            'did this. The gate\'s lock was opened with the master key from B. Dort\'s ring. The brass pin is missing.',
          short: 'The gate’s chain was cut with bolt cutters and its lock opened with Barry’s master key.',
          meaning: 'The gate fell on purpose; Barry’s master key opened it.',
          mentions: ['barry'],
          deduction: 'The gate was made to fall. Its lock was opened with one master key.',
          found: 'A cut chain. This gate was made to fall.',
        },
        tunnel_access_record: {
          text:
            'The sign-in sheet for the restricted tunnel under the crypt: "B. Dort — patrol, 11:06 pm", minutes before the gate ' +
            'fell, with no sign-out. The only other entry tonight: M. Thornhill, in at 8:40 pm with archive boxes, signed out ' +
            'at 8:55 pm.',
          short: 'Barry signed into the tunnel just before the gate fell. Thornhill left hours earlier.',
          meaning: 'Barry was below at 11:06; Thornhill was long gone.',
          mentions: ['barry', 'thornhill'],
          deduction: 'One name entered the tunnel just before the collapse; the other left hours earlier.',
          found: 'A sign-in sheet. Mind the times.',
        },
        equipment_match: {
          text:
            'A kit bag stashed underground: bolt cutters with chain filings, the gate\'s brass pin and B. Dort\'s pier lantern, ' +
            'caked in fresh tunnel clay. The harbour master logged no lantern at the pier gate after 10:50 pm. F. Galpin\'s ' +
            'restoration kit sat sealed in the library all night.',
          short: 'Barry’s pier lantern was hidden below with the bolt cutters. Galpin’s kit stayed sealed.',
          meaning: 'Barry’s lantern left the pier; Galpin’s kit stayed put.',
          mentions: ['barry', 'galpin'],
          deduction: 'The lantern said to be at the pier was below, with the gate pin. One kit never left the library.',
          found: 'Tools. Clay. Compare them with the gate.',
        },
      },
    },
  },

  // =================================================================================================== Case 03
  midnight_signal: {
    thornhill: {
      solution: {
        caseId: 'midnight_signal',
        version: 4,
        culprit: 'thornhill',
        supportingEvidence: ['falsified_patrol_log', 'alarm_override', 'watchtower_signal'],
        links: {
          alarm_override: { proves: 'method', clears: [] },
          watchtower_signal: { proves: 'opportunity', clears: ['galpin'] },
          falsified_patrol_log: { proves: 'alibi', clears: ['barry'] },
        },
        innocents: {
          galpin: 'The observatory lamp blinked Galpin’s star readings every five minutes from 11:00 to 11:45 pm, just as her log says.',
          barry: 'Barry’s north-wall entries are real: the north-wall lamps were lit on every round from 11:00 to 11:40 pm.',
        },
        resolution:
          'Marilyn Thornhill silenced the island alarms at 11:10 pm through the archive’s fire panel, using the vault override ' +
          'code only she holds, and the lockdown emptied the grounds. Her card, still working, took her past the checkpoint at ' +
          '11:18 pm, and at 11:22 pm her archive lamp was lit beside the egg path as she carried the egg away. The Hyde, loosed ' +
          'in the confusion, found Orloff.',
      },
      clues: {
        falsified_patrol_log: {
          text:
            'The night logbook: "North wall — all clear" in B. Dort\'s hand at 11:00, 11:20 and 11:40 pm, and the north-wall ' +
            'lamps were lit on each round. The checkpoint stamp beside it: M. Thornhill\'s archive card, going out toward the ' +
            'egg path at 11:18 pm, during the lockdown.',
          short: 'Thornhill’s card passed the checkpoint at 11:18. Barry’s north-wall rounds were real.',
          meaning: 'Thornhill was not trapped; Barry walked the north wall.',
          mentions: ['thornhill', 'barry'],
          deduction: 'One card went out during the lockdown, toward the egg path. The north-wall rounds were real: their lamps were lit.',
          found: 'A logbook and a stamp. Mind the times.',
        },
        alarm_override: {
          text:
            'The control-room console: island alarms disabled at 11:10 pm and the "lockdown" broadcast sent — not with a ' +
            'security card, but through the archive\'s fire-panel link, using the vault override code held only by M. ' +
            'Thornhill. It left her card free to open doors in the lockdown.',
          short: 'The alarms were shut off through the archive’s fire panel, with Thornhill’s vault code.',
          meaning: 'Thornhill’s code silenced the alarms and freed her card.',
          mentions: ['thornhill'],
          deduction: 'The alarms were silenced with one override code, which also kept one card working in the lockdown.',
          found: 'The override log. One code did this.',
        },
        watchtower_signal: {
          text:
            'Every lamp on the island blinks its own code when lit, and the watchtower recorder logs them all. At 11:22 pm it ' +
            'caught the archive lamp, kept by M. Thornhill, beside the egg path. The observatory lamp blinked F. Galpin\'s star ' +
            'readings every five minutes, 11:00 to 11:45.',
          short: 'Thornhill’s archive lamp was lit by the egg path at 11:22. Galpin’s log never paused.',
          meaning: 'Thornhill’s lamp was by the egg path; Galpin stargazed.',
          mentions: ['thornhill', 'galpin'],
          deduction: 'A lamp was lit beside the egg path at 11:22. The star readings never paused.',
          found: 'A lamp code, recorded. Where was it lit?',
        },
      },
    },
    galpin: {
      solution: {
        caseId: 'midnight_signal',
        version: 4,
        culprit: 'galpin',
        supportingEvidence: ['falsified_patrol_log', 'alarm_override', 'watchtower_signal'],
        links: {
          alarm_override: { proves: 'method', clears: ['thornhill'] },
          falsified_patrol_log: { proves: 'opportunity', clears: ['barry'] },
          watchtower_signal: { proves: 'alibi', clears: [] },
        },
        innocents: {
          thornhill: 'The lockdown sealed the archive; Thornhill’s card tried its door at 11:14 pm and was refused, so she really was trapped upstairs.',
          barry: 'Barry’s north-wall entries are real: the north-wall lamps were lit on every round from 11:00 to 11:40 pm.',
        },
        resolution:
          'Françoise Galpin left her observatory lamp dark and slipped out toward the egg path at 11:08 pm. At 11:10 pm she cut ' +
          'the old alarm cable she had found on her 1890s plans; the alarms died and the lockdown emptied the grounds while she ' +
          'carried the egg away. The Hyde, loosed in the confusion, found Orloff, and her star log was filled in later to hide ' +
          'the gap.',
      },
      clues: {
        falsified_patrol_log: {
          text:
            'The night logbook: "North wall — all clear" in B. Dort\'s hand at 11:00, 11:20 and 11:40 pm, and the north-wall ' +
            'lamps were lit on each round. The checkpoint stamp beside it: F. Galpin\'s visitor pass, going out toward the egg ' +
            'path at 11:08 pm, two minutes before the alarms died.',
          short: 'Galpin’s pass went out toward the egg path at 11:08. Barry’s rounds were real.',
          meaning: 'Galpin headed for the egg path; Barry walked the wall.',
          mentions: ['galpin', 'barry'],
          deduction: 'One pass went toward the egg path just before the alarms died. The north-wall rounds were real: their lamps were lit.',
          found: 'A logbook and a stamp. Mind the times.',
        },
        alarm_override: {
          text:
            'The console shows no card: the alarms died at 11:10 pm when the old alarm cable by the egg path was cut, and the ' +
            'lockdown began on its own. Only the 1890s plans F. Galpin is copying show that cable. M. Thornhill\'s card tried ' +
            'the sealed archive door at 11:14 pm and was refused.',
          short: 'The alarms died when a hidden cable was cut. Only Galpin’s old plans show it.',
          meaning: 'Galpin’s plans found the cable; Thornhill was locked in.',
          mentions: ['galpin', 'thornhill'],
          deduction: 'The alarms were cut at a cable only old plans show. One card tried to leave a sealed room and could not.',
          found: 'No card used. Something else was cut.',
        },
        watchtower_signal: {
          text:
            'Every lamp on the island blinks its own code when lit, and the watchtower recorder logs them all. F. Galpin\'s ' +
            'observatory lamp blinks with each star reading. Tonight it went dark at 11:05 pm and stayed dark until after ' +
            'midnight, yet her log shows a reading every five minutes.',
          short: 'Galpin’s star lamp went dark at 11:05, yet her log shows readings all night.',
          meaning: 'Galpin’s star log was filled in, not observed.',
          mentions: ['galpin'],
          deduction: 'A lamp that blinks with every reading went dark at 11:05. The log says it never did.',
          found: 'A dark lamp, recorded. Check the times.',
        },
      },
    },
    barry: {
      solution: {
        caseId: 'midnight_signal',
        version: 4,
        culprit: 'barry',
        supportingEvidence: ['falsified_patrol_log', 'alarm_override', 'watchtower_signal'],
        links: {
          alarm_override: { proves: 'method', clears: ['thornhill'] },
          watchtower_signal: { proves: 'opportunity', clears: ['galpin'] },
          falsified_patrol_log: { proves: 'alibi', clears: [] },
        },
        innocents: {
          thornhill: 'The lockdown sealed the archive; Thornhill’s card tried its door at 11:14 pm and was refused, so she really was trapped upstairs.',
          galpin: 'The observatory log shows Galpin’s star readings every five minutes from 11:00 to 11:45 pm.',
        },
        resolution:
          'Barry Dort disabled the alarms with his own security card at 11:10 pm and broadcast a false lockdown to empty the ' +
          'grounds. At 11:22 pm he flashed the guard’s all-clear from beside the egg path and carried the egg away; the Hyde, ' +
          'loosed in the confusion, found Orloff. Barry rewrote his patrol log to put himself on the north wall.',
      },
      clues: {
        falsified_patrol_log: {
          text:
            'The patrol log for 11:00–11:45 pm reads "North wall — all clear" in Barry Dort\'s hand, written over an erased ' +
            'line in fresh ink. The north-wall lamps, lit on every real round, were never lit tonight.',
          short: 'Barry’s “north wall, all clear” entry was rewritten. Those lamps were never lit.',
          meaning: 'Barry’s patrol alibi was written after the fact.',
          mentions: ['barry'],
          deduction: 'The entry covering the silent alarms was rewritten after the fact.',
          found: 'An erased line, rewritten. Look closer.',
        },
        alarm_override: {
          text:
            'The control-room console: island alarms disabled at 11:10 pm and the "lockdown" broadcast sent, both with security ' +
            'card #3 — issued to Barry Dort. No other card touched the console. The lockdown sealed the archive; M. Thornhill\'s ' +
            'card tried its door at 11:14 pm and was refused.',
          short: 'The alarms were shut off with Barry’s security card. Thornhill was locked in.',
          meaning: 'Barry’s card silenced the alarms; Thornhill was locked in.',
          mentions: ['barry', 'thornhill'],
          deduction: 'The alarms were switched off with one security card. One card tried to leave a sealed room and could not.',
          found: 'The override log. One card did this.',
        },
        watchtower_signal: {
          // Barry is referred to only by role here (see design §4b content note); `short` / `meaning` keep that rule.
          text:
            'The watchtower recorder caught the guard\'s "all clear" lamp code at 11:22 pm, flashed from beside the egg ' +
            'path — not from the north wall. The observatory log shows F. Galpin\'s star readings every five minutes, ' +
            '11:00 to 11:45.',
          short: 'The guard’s all-clear was flashed beside the egg path. Galpin’s log never paused.',
          meaning: 'The guard was by the egg path; Galpin was stargazing.',
          mentions: ['barry', 'galpin'],
          deduction: 'The guard signal came from beside the egg path at 11:22. The star log never paused.',
          found: 'A lamp code, recorded. Where was it sent from?',
        },
      },
    },
  },
};

export function caseVariant(caseId: CaseId, culprit: SuspectId): CaseVariant {
  return CASE_VARIANTS[caseId][culprit];
}

export function caseSolution(caseId: CaseId, culprit: SuspectId): CaseSolution {
  return CASE_VARIANTS[caseId][culprit].solution;
}
