// The three alternate case scenarios of Professor Orloff's last night (game-designer owned). PUBLIC data: it ships to
// the browser, so it carries NO answer — who a clue implicates or clears, and the culprit, live in solutions.ts.
//
// All jobs, events and crimes are invented for THIS GAME'S alternate-universe story; they are not claims about series
// canon. Rowan Laslow and Joseph Crackstone are reserved as future lore references, not suspects.
//
// Deduction design, identical for every case (truth tables in docs/MYSTERY_DESIGN.md §4b):
// - Three clues, each proving one link against the SAME person: METHOD, OPPORTUNITY and a BROKEN ALIBI.
// - The culprit is named in all three clues. Each innocent is named in exactly one clue — the one that clears them —
//   so no single clue settles the case and only all three together give the full chain with both alternatives
//   explained.
// - Suspect statements are claims; the clues decide which claims hold. No clue says who did it.
// - Two case-file notes are held from the start; they are tempting but support nobody (the deduction step offers them).
import type { CaseDef, CaseId, RoomId } from '../types.ts';

const SUSPECT_ROLES = {
  thornhill: { id: 'thornhill', name: 'Marilyn Thornhill', role: 'Archivist and greenhouse curator (role in this story)' },
  isaac: { id: 'isaac', name: 'Isaac Night', role: 'Groundskeeper and crypt maintenance (role in this story)' },
  barry: { id: 'barry', name: 'Barry Dort', role: 'Night guard and security watch (role in this story)' },
} as const;

export const POISONED_ARCHIVE: CaseDef = {
  id: 'poisoned_archive',
  version: 1,
  number: '01',
  title: 'The Poisoned Archive',
  tagline: 'Orloff died at his archive desk with a cold cup of tea. The egg he guarded was signed away an hour earlier.',
  setting: 'Research archive and greenhouse annex',
  victim: 'Professor Orloff',
  suspects: [
    { ...SUSPECT_ROLES.thornhill, alibiOrContext: '“I catalogued in the reading room all evening. I never went near the greenhouse.”' },
    { ...SUSPECT_ROLES.isaac, alibiOrContext: '“I was clearing storm drains on the north lawn until midnight.”' },
    { ...SUSPECT_ROLES.barry, alibiOrContext: '“East-wall rounds, start to finish. Every gate check is on my card.”' },
  ],
  clues: [
    {
      id: 'falsified_transfer', title: 'Falsified Egg-Transfer Request', roomId: 'research_room', location: 'Research Archive',
      interactLabel: 'Search the archive desk', icon: 'fileText', mentions: ['thornhill'],
      text:
        'An egg-transfer request moving the egg "to the archive vault for study", authorised with M. Thornhill\'s archive ' +
        'credentials at 11:31 pm. Orloff\'s pencil in the margin: "I never asked for this." The form can only be filed ' +
        'from an archive terminal.',
      deduction: 'Someone with archive credentials signed the egg away. Orloff knew it was false.',
      thing: { found: 'A transfer request. Orloff never wrote it.', vision: 'A vision of a signed form on a desk.' },
    },
    {
      id: 'botanical_residue', title: 'Restricted Botanical Residue', roomId: 'path', location: 'Greenhouse Annex',
      interactLabel: 'Check the inventory shelf', icon: 'sprout', mentions: ['thornhill', 'isaac'],
      text:
        'The violet residue in Orloff\'s teacup matches the greenhouse\'s restricted nightshade tincture. Inventory: one vial ' +
        'signed out under M. Thornhill at 10:58 pm. The annex key ledger shows I. Night returned his key at 9:05 pm and ' +
        'never took it again.',
      deduction: 'The poison came from a vial signed out tonight; only one greenhouse key was out after nine.',
      thing: { found: 'Violet residue. Compare it with the teacup.', vision: 'A vision of glass vials on a shelf.' },
    },
    {
      id: 'access_ledger', title: 'Archive and Greenhouse Access Ledger', roomId: 'crypt', location: 'Records Crypt',
      interactLabel: 'Read the door ledger', icon: 'link', mentions: ['thornhill', 'barry'],
      text:
        'The door-access ledger stored in the old crypt: Thornhill\'s badge opened the greenhouse annex at 10:55 pm and ' +
        'Orloff\'s archive at 11:29 pm — the hour she says she spent in the reading room. B. Dort\'s card shows only ' +
        'east-wall gates, every ten minutes, all night.',
      deduction: 'The badge record puts one person at both doors. One patrol never left the east wall.',
      thing: { found: 'A door ledger. Times matter. Check the board.', vision: 'A vision of a ledger in the crypt.' },
    },
  ],
  notes: [
    { id: 'note_drain_mud', title: 'Muddy Boots in the Hall', text: 'Fresh drain mud on the archive hall floor, boot size of the groundskeeper.' },
    { id: 'note_keys_jangling', title: 'Keys Heard at Midnight', text: 'A student heard a heavy key ring near the archive around midnight.' },
  ],
  placements: [
    { clueId: 'falsified_transfer', roomId: 'research_room', x: 38, z: -6, searchS: 2.5 }, // archive desk behind the shelves
    { clueId: 'botanical_residue', roomId: 'path', x: 1, z: -26, searchS: 3 }, // greenhouse inventory shelf
    { clueId: 'access_ledger', roomId: 'crypt', x: -22, z: 21, searchS: 2.5 }, // ledger just inside the crypt entrance
  ],
  egg: { x: -28, z: -20, roomId: 'egg_chamber', objective: 'Find the egg in the Egg Chamber.' },
  roomNames: { research_room: 'Research Archive', crypt: 'Records Crypt' },
  thing: {
    welcome: 'Orloff is dead at his desk. His egg is gone. Sign the case file.',
    findEgg: 'The egg waits in the Egg Chamber.',
    whereHint: 'Clues: the archive, the greenhouse, the crypt.',
  },
  prologue: {
    scene: 'archive',
    death: { title: 'A Death in the Archive', narration: 'Professor Orloff was found at his archive desk, his tea gone cold. Someone made sure he would not wake.' },
    egg: { title: 'The Signed-Away Egg', narration: 'An hour earlier, the rare egg he guarded was signed out of his care. He never signed anything.' },
  },
};

export const CRYPT_LAST_WITNESS: CaseDef = {
  id: 'crypt_last_witness',
  version: 1,
  number: '02',
  title: 'The Crypt’s Last Witness',
  tagline: 'The crypt gate fell on the only man who saw who went down to the egg. It did not fall on its own.',
  setting: 'Underground crypt and maintenance tunnels',
  victim: 'Professor Orloff',
  suspects: [
    { ...SUSPECT_ROLES.thornhill, alibiOrContext: '“I returned archive boxes to the tunnels early, then worked upstairs.”' },
    { ...SUSPECT_ROLES.isaac, alibiOrContext: '“I never went into the tunnels tonight. I was fixing the greenhouse vents.”' },
    { ...SUSPECT_ROLES.barry, alibiOrContext: '“I was at the pier gate when the crypt bell rang.”' },
  ],
  clues: [
    {
      id: 'sabotaged_gate', title: 'Sabotaged Crypt Gate', roomId: 'crypt', location: 'Collapsed Crypt',
      interactLabel: 'Inspect the gate mechanism', icon: 'lock', mentions: ['isaac'],
      text:
        'The crypt gate\'s counterweight pin was drawn out and its chain filed half through — no storm did this. The ' +
        'maintenance roster assigns this mechanism to Isaac Night alone. The brass pin is missing.',
      deduction: 'The gate was made to fall. The mechanism had exactly one assigned keeper.',
      thing: { found: 'Filed chain. This gate was made to fall.', vision: 'A vision of a heavy gate and a chain.' },
    },
    {
      id: 'tunnel_access_record', title: 'Restricted Tunnel Sign-In', roomId: 'shortcut', location: 'Maintenance Tunnel',
      interactLabel: 'Read the tunnel sign-in', icon: 'signpost', mentions: ['isaac', 'thornhill'],
      text:
        'The lamp-room sign-in for the restricted tunnel under the crypt: "I. Night — 11:12 pm", minutes before the gate ' +
        'fell. The only other entry tonight: M. Thornhill, in at 8:40 pm with archive boxes, signed out at 8:55 pm.',
      deduction: 'One name entered the tunnel just before the collapse; the other left hours earlier.',
      thing: { found: 'A sign-in sheet. Mind the times.', vision: 'A vision of a lamp room and a pen.' },
    },
    {
      id: 'equipment_match', title: 'Groundskeeper’s Tool Roll', roomId: 'egg_chamber', location: 'Egg Chamber',
      interactLabel: 'Unroll the tool roll', icon: 'key', mentions: ['isaac', 'barry'],
      text:
        'A tool roll stashed by the Hyde\'s cage, stitched "I.N.": a file with chain filings and the gate\'s brass pin, ' +
        'caked in fresh tunnel clay. The harbour master logged B. Dort\'s lantern at the pier gate at 11:15 pm.',
      deduction: 'Tunnel clay on tools that match the gate. The pier log fixes one lantern far away.',
      thing: { found: 'Tools. Clay. Compare them with the gate.', vision: 'A vision of a rolled bundle by the cage.' },
    },
  ],
  notes: [
    { id: 'note_archive_boxes', title: 'Archive Boxes in the Tunnel', text: 'Archive boxes were found stacked in the maintenance tunnel.' },
    { id: 'note_bell_rope', title: 'The Crypt Bell', text: 'Someone rang the crypt bell twice at 11:20 pm. Nobody admits to it.' },
  ],
  placements: [
    { clueId: 'sabotaged_gate', roomId: 'crypt', x: -22, z: 21, searchS: 2.5 }, // the fallen gate at the crypt entrance
    { clueId: 'tunnel_access_record', roomId: 'shortcut', x: 31, z: -22, searchS: 2.5 }, // lamp room in the tunnel
    { clueId: 'equipment_match', roomId: 'egg_chamber', x: -40, z: -31, searchS: 3 }, // tool roll by the cage
  ],
  egg: { x: -38, z: 18, roomId: 'crypt', objective: 'Find the egg in the burial vault of the crypt.' },
  roomNames: { crypt: 'Collapsed Crypt', shortcut: 'Maintenance Tunnel' },
  thing: {
    welcome: 'Orloff is dead under the crypt gate. His egg is gone. Sign the case file.',
    findEgg: 'The egg is hidden in the crypt’s burial vault.',
    whereHint: 'Clues: the crypt gate, the tunnel, the cage.',
  },
  prologue: {
    scene: 'crypt',
    death: { title: 'The Fallen Gate', narration: 'Professor Orloff died beneath the crypt gate. He was the last to see who went down to the egg.' },
    egg: { title: 'Gone Below', narration: 'The rare egg vanished into the crypt. Whoever took it knew the tunnels well.' },
  },
};

export const MIDNIGHT_SIGNAL: CaseDef = {
  id: 'midnight_signal',
  version: 1,
  number: '03',
  title: 'The Midnight Signal',
  tagline: 'At midnight the island went into lockdown and every alarm fell silent. When the lights returned, Orloff was gone.',
  setting: 'Watchtower and security control room',
  victim: 'Professor Orloff',
  suspects: [
    { ...SUSPECT_ROLES.thornhill, alibiOrContext: '“The lockdown trapped me in the archive. I heard the alarms stop.”' },
    { ...SUSPECT_ROLES.isaac, alibiOrContext: '“I was cranking the greenhouse vents all night. Ask the vent log.”' },
    { ...SUSPECT_ROLES.barry, alibiOrContext: '“I walked the north wall from eleven to midnight, exactly as my log says.”' },
  ],
  clues: [
    {
      id: 'falsified_patrol_log', title: 'Rewritten Patrol Log', roomId: 'shortcut', location: 'Guard Post Passage',
      interactLabel: 'Read the patrol log', icon: 'fileText', mentions: ['barry'],
      text:
        'The patrol log for 11:00–11:45 pm reads "North wall — all clear" in Barry Dort\'s hand, written over an erased ' +
        'line in fresh ink. The north-wall lamps, lit on every real round, were never lit tonight.',
      deduction: 'The entry covering the silent alarms was rewritten after the fact.',
      thing: { found: 'An erased line, rewritten. Look closer.', vision: 'A vision of a guard’s logbook.' },
    },
    {
      id: 'alarm_override', title: 'Alarm Override Console', roomId: 'research_room', location: 'Security Control Room',
      interactLabel: 'Check the override console', icon: 'lock', mentions: ['barry', 'thornhill'],
      text:
        'The control-room console: island alarms disabled at 11:10 pm and the "lockdown" broadcast sent, both with security ' +
        'card #3 — issued to Barry Dort. No other card touched the console. M. Thornhill\'s archive card has no clearance here.',
      deduction: 'The alarms were switched off with one security card; archive cards cannot reach this console.',
      thing: { found: 'The override log. One card did this.', vision: 'A vision of a glowing console.' },
    },
    {
      id: 'watchtower_signal', title: 'Recorded Watchtower Signal', roomId: 'courtyard', location: 'Watchtower Yard',
      interactLabel: 'Read the signal recorder', icon: 'eye', mentions: ['barry', 'isaac'],
      text:
        'The watchtower recorder caught the guard\'s "all clear" lamp code at 11:22 pm, flashed from this yard toward the ' +
        'egg path — not from the north wall. The greenhouse vent log shows I. Night\'s crank turning every five minutes, ' +
        '11:00 to 11:45.',
      deduction: 'The guard signal came from beside the egg path at 11:22. The vents never stopped turning.',
      thing: { found: 'A lamp code, recorded. Where was it sent from?', vision: 'A vision of a signal lamp blinking.' },
    },
  ],
  notes: [
    { id: 'note_greenhouse_light', title: 'Light in the Greenhouse', text: 'A lantern was seen moving in the greenhouse during the lockdown.' },
    { id: 'note_archive_door', title: 'Archive Door Ajar', text: 'The archive door was found ajar after the lockdown lifted.' },
  ],
  placements: [
    { clueId: 'falsified_patrol_log', roomId: 'shortcut', x: 30, z: -28, searchS: 2.5 }, // guard post in the passage
    { clueId: 'alarm_override', roomId: 'research_room', x: 40, z: 8, searchS: 2.5 }, // console in the control room
    { clueId: 'watchtower_signal', roomId: 'courtyard', x: 18, z: -48, searchS: 3 }, // recorder at the watchtower's foot
  ],
  egg: { x: 5, z: -27, roomId: 'path', objective: 'Find the egg in the greenhouse potting shed.' },
  roomNames: { research_room: 'Security Control Room', shortcut: 'Guard Post Passage', courtyard: 'Watchtower Yard' },
  thing: {
    welcome: 'Orloff is dead after the lockdown. His egg is gone. Sign the case file.',
    findEgg: 'The egg is hidden in the greenhouse potting shed.',
    whereHint: 'Clues: the guard post, the control room, the watchtower.',
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
