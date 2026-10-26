// The three alternate case scenarios of Professor Orloff's last night (game-designer owned). PUBLIC data: it ships to
// the browser, so it carries NO answer — who a clue implicates or clears, and the culprit, live in solutions.ts.
//
// All jobs, events and crimes are invented for THIS GAME'S alternate-universe story; they are not claims about series
// canon. Françoise Galpin's role (visiting historian) is invented for this story. Isaac Night is NOT a suspect: he
// roams the grounds as the monster Slurp (FINAL_CONTRACT §2). Rowan Laslow is reserved as a future lore reference.
//
// Deduction design, identical for every case (truth tables in docs/MYSTERY_DESIGN.md §4b and §12):
// - Three clues, each proving one link against the SAME person: METHOD, OPPORTUNITY and a BROKEN ALIBI.
// - The culprit is named in all three clues. Each innocent is named in exactly one clue — the one that clears them —
//   so no single clue settles the case and only all three together give the full chain with both alternatives
//   explained.
// - Suspect statements are claims; the clues decide which claims hold. No clue says who did it.
// - Two case-file notes are held from the start; they are tempting but support nobody (the deduction step offers them).
//
// Content version 3 (final 2026-10-24): suspects Thornhill / Galpin / Barry in every case; Case 02 rewritten against
// Françoise Galpin; compact maps moved some candidate sites, so `location` strings follow caseWorlds.ts (every
// candidate site of a clue reads true) and `roomId` is the first site's room. TL;DR per clue: `short` ≤ 90 chars,
// `meaning` ≤ 60 chars, `shortTitle` ≤ 26 chars.
import type { CaseDef, CaseId, RoomId } from '../types.ts';

const SUSPECT_ROLES = {
  thornhill: { id: 'thornhill', name: 'Marilyn Thornhill', role: 'Archivist and greenhouse curator (role in this story)' },
  galpin: { id: 'galpin', name: 'Françoise Galpin', role: 'Visiting historian restoring the crypt (role in this story)' },
  barry: { id: 'barry', name: 'Barry Dort', role: 'Night guard and security watch (role in this story)' },
} as const;

export const POISONED_ARCHIVE: CaseDef = {
  id: 'poisoned_archive',
  version: 3,
  number: '01',
  title: 'The Poisoned Archive',
  tagline: 'Orloff died at his archive desk with a cold cup of tea. The egg he guarded was signed away an hour earlier.',
  setting: 'Research archive, book stacks and greenhouse annex',
  victim: 'Professor Orloff',
  suspects: [
    { ...SUSPECT_ROLES.thornhill, alibiOrContext: '“I catalogued in the reading room all evening. I never went near the greenhouse.”' },
    { ...SUSPECT_ROLES.galpin, alibiOrContext: '“I was copying old plans in the chapel ruins until midnight.”' },
    { ...SUSPECT_ROLES.barry, alibiOrContext: '“East-wall rounds, start to finish. Every gate check is on my card.”' },
  ],
  clues: [
    {
      id: 'falsified_transfer', shortTitle: 'Fake Transfer Form', title: 'Falsified Egg-Transfer Request', roomId: 'research_room', location: 'Archive desk or Rare Book Stacks',
      interactLabel: 'Search the archive papers', icon: 'fileText', mentions: ['thornhill'],
      short: 'A fake egg-transfer form was filed with Thornhill’s archive login.',
      meaning: 'Thornhill’s archive login moved the egg.',
      text:
        'An egg-transfer request moving the egg "to the archive vault for study", authorised with M. Thornhill\'s archive ' +
        'credentials at 11:31 pm. Orloff\'s pencil in the margin: "I never asked for this." The form can only be filed ' +
        'from an archive terminal.',
      deduction: 'Someone with archive credentials signed the egg away. Orloff knew it was false.',
      thing: { found: 'A transfer request. Orloff never wrote it.', vision: 'A vision of a signed form on a desk.' },
    },
    {
      id: 'botanical_residue', shortTitle: 'Poison Residue', title: 'Restricted Botanical Residue', roomId: 'path', location: 'Greenhouse Annex or Poison Garden',
      interactLabel: 'Check the poison inventory', icon: 'sprout', mentions: ['thornhill', 'galpin'],
      short: 'The tea poison matches a vial signed out under Thornhill tonight.',
      meaning: 'Galpin’s key was back; only Thornhill’s vial was out.',
      text:
        'The violet residue in Orloff\'s teacup matches the greenhouse\'s restricted nightshade tincture. Inventory: one vial ' +
        'signed out under M. Thornhill at 10:58 pm. The annex key ledger shows F. Galpin returned her borrowed key at ' +
        '9:05 pm and never took it again.',
      deduction: 'The poison came from a vial signed out tonight; only one greenhouse key was out after nine.',
      thing: { found: 'Violet residue. Compare it with the teacup.', vision: 'A vision of glass vials on a shelf.' },
    },
    {
      id: 'access_ledger', shortTitle: 'Door Access Ledger', title: 'Archive and Greenhouse Access Ledger', roomId: 'path', location: 'Porter’s Lodge',
      interactLabel: 'Read the door ledger', icon: 'link', mentions: ['thornhill', 'barry'],
      short: 'Thornhill’s badge opened the greenhouse and archive when she says she was reading.',
      meaning: 'Thornhill’s alibi breaks; Barry stayed on the east wall.',
      text:
        'The door-access ledger kept at the porter\'s lodge: Thornhill\'s badge opened the greenhouse annex at 10:55 pm and ' +
        'Orloff\'s archive at 11:29 pm — the hour she says she spent in the reading room. B. Dort\'s card shows only ' +
        'east-wall gates, every ten minutes, all night.',
      deduction: 'The badge record puts one person at both doors. One patrol never left the east wall.',
      thing: { found: 'A door ledger. Times matter. Check the board.', vision: 'A vision of a ledger in a lodge.' },
    },
  ],
  notes: [
    { id: 'note_drain_mud', title: 'Chalk Dust in the Hall', text: 'Fresh chalk dust on the archive hall floor, the kind used for stone rubbings.' },
    { id: 'note_keys_jangling', title: 'Keys Heard at Midnight', text: 'A student heard a heavy key ring near the archive around midnight.' },
  ],
  egg: { objective: 'Find the egg.' },
  roomNames: { research_room: 'Research Archive', shortcut: 'Rare Book Stacks', courtyard: 'Tower Yard', path: 'Archive Grounds' },
  thing: {
    welcome: 'Orloff is dead at his desk. His egg is gone. Sign the case file.',
    findEgg: 'Find the egg. Traces will show where it went.',
    whereHint: 'Clues: archive or stacks, greenhouse or garden, porter’s lodge.',
  },
  prologue: {
    scene: 'archive',
    death: { title: 'A Death in the Archive', narration: 'Professor Orloff was found at his archive desk, his tea gone cold. Someone made sure he would not wake.' },
    egg: { title: 'The Signed-Away Egg', narration: 'An hour earlier, the rare egg he guarded was signed out of his care. He never signed anything.' },
  },
};

export const CRYPT_LAST_WITNESS: CaseDef = {
  id: 'crypt_last_witness',
  version: 3,
  number: '02',
  title: 'The Crypt’s Last Witness',
  tagline: 'The crypt gate fell on the only man who saw who went down to the egg. It did not fall on its own.',
  setting: 'Crypt hall, catacombs and maintenance tunnel',
  victim: 'Professor Orloff',
  suspects: [
    { ...SUSPECT_ROLES.thornhill, alibiOrContext: '“I returned archive boxes to the tunnel early, then worked upstairs.”' },
    { ...SUSPECT_ROLES.galpin, alibiOrContext: '“My restoration kit was locked in the library all night. I never went below.”' },
    { ...SUSPECT_ROLES.barry, alibiOrContext: '“I was at the pier gate when the crypt bell rang.”' },
  ],
  clues: [
    {
      id: 'sabotaged_gate', shortTitle: 'Sabotaged Gate', title: 'Sabotaged Crypt Gate', roomId: 'crypt', location: 'Crypt Gate',
      interactLabel: 'Inspect the gate mechanism', icon: 'lock', mentions: ['galpin'],
      short: 'The gate’s chain was sawn and its lock opened with Galpin’s restoration key.',
      meaning: 'The gate fell on purpose; one key opens its lock.',
      text:
        'The crypt gate\'s counterweight pin was drawn out and its chain sawn half through with a fine wire saw — no ' +
        'storm did this. The gate\'s lock was opened with the crypt restoration key, issued only to F. Galpin. The brass ' +
        'pin is missing.',
      deduction: 'The gate was made to fall. Its lock opens with exactly one issued key.',
      thing: { found: 'A sawn chain. This gate was made to fall.', vision: 'A vision of a heavy gate and a chain.' },
    },
    {
      id: 'tunnel_access_record', shortTitle: 'Tunnel Sign-In', title: 'Restricted Tunnel Sign-In', roomId: 'courtyard', location: 'Tunnel office or side path',
      interactLabel: 'Read the tunnel sign-in', icon: 'signpost', mentions: ['galpin', 'thornhill'],
      short: 'Galpin signed into the tunnel just before the gate fell. Thornhill left hours earlier.',
      meaning: 'Galpin was below at 11:12; Thornhill was long gone.',
      text:
        'The sign-in sheet for the restricted tunnel under the crypt: "F. Galpin — 11:12 pm", minutes before the gate ' +
        'fell. The only other entry tonight: M. Thornhill, in at 8:40 pm with archive boxes, signed out at 8:55 pm.',
      deduction: 'One name entered the tunnel just before the collapse; the other left hours earlier.',
      thing: { found: 'A sign-in sheet. Mind the times.', vision: 'A vision of a lamp and a pen.' },
    },
    {
      id: 'equipment_match', shortTitle: 'Tool Satchel', title: 'Restorer’s Tool Satchel', roomId: 'egg_chamber', location: 'By the cage or tunnel bend',
      interactLabel: 'Open the tool satchel', icon: 'key', mentions: ['galpin', 'barry'],
      short: 'Galpin’s satchel holds a wire saw, the gate’s pin and fresh tunnel clay.',
      meaning: 'Galpin’s kit went below; Barry was at the pier.',
      text:
        'A satchel stashed underground, stamped "F. Galpin — Restoration": a wire saw with chain filings and the gate\'s ' +
        'brass pin, caked in fresh tunnel clay. The harbour master logged B. Dort\'s lantern at the pier gate at 11:15 pm.',
      deduction: 'The kit said to be locked upstairs was below, with the gate pin. The pier log fixes one lantern far away.',
      thing: { found: 'Tools. Clay. Compare them with the gate.', vision: 'A vision of a satchel in the dark.' },
    },
  ],
  notes: [
    { id: 'note_archive_boxes', title: 'Archive Boxes in the Tunnel', text: 'Archive boxes were found stacked in the maintenance tunnel.' },
    { id: 'note_bell_rope', title: 'The Crypt Bell', text: 'Someone rang the crypt bell twice at 11:20 pm. Nobody admits to it.' },
  ],
  egg: { objective: 'Find the egg.' },
  roomNames: { crypt: 'Crypt Hall', egg_chamber: 'Catacombs', courtyard: 'Tunnel Yard', path: 'Crypt Grounds' },
  thing: {
    welcome: 'Orloff is dead under the crypt gate. His egg is gone. Sign the case file.',
    findEgg: 'Find the egg. Traces will show where it went.',
    whereHint: 'Clues: crypt gate, tunnel office or side path, cage or tunnel bend.',
  },
  prologue: {
    scene: 'crypt',
    death: { title: 'The Fallen Gate', narration: 'Professor Orloff died beneath the crypt gate. He was the last to see who went down to the egg.' },
    egg: { title: 'Gone Below', narration: 'The rare egg vanished into the tunnels under the crypt — Slurp’s haunt. Whoever took it was not afraid of the dark.' },
  },
};

export const MIDNIGHT_SIGNAL: CaseDef = {
  id: 'midnight_signal',
  version: 3,
  number: '03',
  title: 'The Midnight Signal',
  tagline: 'At midnight the island went into lockdown and every alarm fell silent. When the lights returned, Orloff was gone.',
  setting: 'Watchtower yard, guard post and security control room',
  victim: 'Professor Orloff',
  suspects: [
    { ...SUSPECT_ROLES.thornhill, alibiOrContext: '“The lockdown trapped me in the archive. I heard the alarms stop.”' },
    { ...SUSPECT_ROLES.galpin, alibiOrContext: '“I logged star readings at the observatory all night. Check the log.”' },
    { ...SUSPECT_ROLES.barry, alibiOrContext: '“I walked the north wall from eleven to midnight, exactly as my log says.”' },
  ],
  clues: [
    {
      id: 'falsified_patrol_log', shortTitle: 'Rewritten Patrol Log', title: 'Rewritten Patrol Log', roomId: 'path', location: 'Guard post or checkpoint booth',
      interactLabel: 'Read the patrol log', icon: 'fileText', mentions: ['barry'],
      short: 'Barry’s “north wall, all clear” entry was rewritten. Those lamps were never lit.',
      meaning: 'Barry’s patrol alibi was written after the fact.',
      text:
        'The patrol log for 11:00–11:45 pm reads "North wall — all clear" in Barry Dort\'s hand, written over an erased ' +
        'line in fresh ink. The north-wall lamps, lit on every real round, were never lit tonight.',
      deduction: 'The entry covering the silent alarms was rewritten after the fact.',
      thing: { found: 'An erased line, rewritten. Look closer.', vision: 'A vision of a guard’s logbook.' },
    },
    {
      id: 'alarm_override', shortTitle: 'Alarm Override', title: 'Alarm Override Console', roomId: 'path', location: 'Security Control Room',
      interactLabel: 'Check the override console', icon: 'lock', mentions: ['barry', 'thornhill'],
      short: 'The alarms were shut off with Barry’s security card. Archive cards can’t reach it.',
      meaning: 'Barry’s card silenced the alarms; Thornhill’s can’t.',
      text:
        'The control-room console: island alarms disabled at 11:10 pm and the "lockdown" broadcast sent, both with security ' +
        'card #3 — issued to Barry Dort. No other card touched the console. M. Thornhill\'s archive card has no clearance here.',
      deduction: 'The alarms were switched off with one security card; archive cards cannot reach this console.',
      thing: { found: 'The override log. One card did this.', vision: 'A vision of a glowing console.' },
    },
    {
      id: 'watchtower_signal', shortTitle: 'Watchtower Signal', title: 'Recorded Watchtower Signal', roomId: 'courtyard', location: 'Watchtower Yard',
      interactLabel: 'Read the signal recorder', icon: 'eye', mentions: ['barry', 'galpin'],
      // Barry is referred to only by role here (see design §4b content note); `short` / `meaning` keep that rule.
      short: 'The guard’s all-clear was flashed beside the egg path. Galpin’s log never paused.',
      meaning: 'The guard was by the egg path; Galpin was stargazing.',
      text:
        'The watchtower recorder caught the guard\'s "all clear" lamp code at 11:22 pm, flashed from beside the egg ' +
        'path — not from the north wall. The observatory log shows F. Galpin\'s star readings every five minutes, ' +
        '11:00 to 11:45.',
      deduction: 'The guard signal came from beside the egg path at 11:22. The star log never paused.',
      thing: { found: 'A lamp code, recorded. Where was it sent from?', vision: 'A vision of a signal lamp blinking.' },
    },
  ],
  notes: [
    { id: 'note_greenhouse_light', title: 'Light in the Greenhouse', text: 'A lantern was seen moving in the greenhouse during the lockdown.' },
    { id: 'note_archive_door', title: 'Archive Door Ajar', text: 'The archive door was found ajar after the lockdown lifted.' },
  ],
  egg: { objective: 'Find the egg.' },
  roomNames: { courtyard: 'Watchtower Yard', path: 'Security Grounds' },
  thing: {
    welcome: 'Orloff is dead after the lockdown. His egg is gone. Sign the case file.',
    findEgg: 'Find the egg. Traces will show where it went.',
    whereHint: 'Clues: guard post or booth, control room, watchtower yard.',
  },
  prologue: {
    scene: 'signal',
    death: { title: 'Lockdown at Midnight', narration: 'At midnight the island locked down and every alarm went quiet. When the lights came back, Orloff was dead.' },
    egg: { title: 'Taken in the Dark', narration: 'During the silence, the rare egg was carried away — past a watchtower that was supposed to see everything.' },
  },
};

export const CASES: Record<CaseId, CaseDef> = {
  poisoned_archive: POISONED_ARCHIVE,
  crypt_last_witness: CRYPT_LAST_WITNESS,
  midnight_signal: MIDNIGHT_SIGNAL,
};

export function isCaseId(v: unknown): v is CaseId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CASES, v);
}

export function caseById(id: CaseId): CaseDef {
  return CASES[id];
}

/** Human-readable default room names for UI (a case may rename rooms via `roomNames`). */
export const ROOM_LABELS: Record<RoomId, string> = {
  pier: 'Pier',
  path: 'Island Path',
  research_room: 'Research Room',
  crypt: 'Ruined Crypt',
  egg_chamber: 'Egg Chamber',
  shortcut: 'Shortcut Alley',
  courtyard: 'Iago Tower Courtyard',
  tower: 'Iago Tower',
};

export const CASE_DISCLAIMER = "Jobs and events are invented for this game's story.";
