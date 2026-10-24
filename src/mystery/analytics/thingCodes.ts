// Fixed spectator copy for the newest Thing item a station reports in its heartbeat ({ kind, code, ref, followed }).
// The broadcast is spoofable, so it never carries free text: Laptop 1 renders these fixed lines from the code, and a
// `ref` only when it is a known ability id of the registries. Unknown codes fall back to a neutral label.
import { REGISTRIES } from '../draft.ts';
import { TITLES } from './liveMessages.ts';

const DIAG: Record<string, string> = {
  noise_sprint: 'Sprinting made too much noise.',
  noise_walk: 'Footsteps were heard.',
  noise_carry: 'Walking with the egg was heard.',
  noise_crouch: 'Even crouched steps were heard.',
  noise_floor: 'A noisy floor gave them away.',
  noise_egg_drop: 'The dropped egg was heard.',
  noise_ability: 'An ability made noise.',
  noise_search: 'Searching made noise.',
  noise_impact: 'A collision was heard.',
  noise_alarm: 'The searchlight alarm drew it in.',
  searchlight: 'The searchlight caught them.',
  seen: 'The Hyde spotted them.',
  caught_1: 'Caught 1 of 2.',
  caught_2: 'Caught 2 of 2.',
  hidden_escape: 'Hiding broke its line of sight.',
  power_stun: 'An ability stunned the Hyde.',
  power_lure: 'An ability lured the Hyde away.',
  power_escape: 'An ability helped them escape.',
  egg_impact: 'The egg was damaged in a collision.',
  egg_grab: 'A grab damaged the egg.',
  egg_drop_impact: 'A collision knocked the egg loose.',
  egg_drop_grab: 'A grab knocked the egg loose.',
  clue_statement: 'A clue names a suspect.',
  pattern_sprint: 'Alerts came while sprinting. Not proof.',
  pattern_carry: 'Alerts came with the egg. Not proof.',
  // ---- Joseph Crackstone (headword CRACKSTONE; POWER STATUS for the crack_power_* codes)
  crack_seen: 'Crackstone saw them in the open.',
  crack_sensed: 'They came too close to Crackstone.',
  crack_scan_hit: 'His scan found them.',
  crack_curse_hit: 'The curse hit them.',
  crack_curse_blocked: 'A block stopped the curse.',
  crack_curse_dodged: 'They dodged the curse.',
  crack_curse_hidden: 'Hiding blocked the curse.',
  crack_curse_wall: 'A wall blocked the curse.',
  crack_escape_wall: 'A wall broke his line of sight.',
  crack_escape_hid: 'Hiding broke his line of sight.',
  crack_escape_range: 'They got out of his sight range.',
  crack_escape_leash: 'They left his cursed area.',
  crack_scan_covered: 'Walls and hiding spots block scans.',
  crack_power_stun: 'An ability stopped Crackstone.',
  crack_power_lure: 'An ability lured Crackstone away.',
  // ---- final: director / Slurp / cabinets (headword by prefix; UX_FINAL §8 copy where it exists)
  det_hyde_steps: 'Hyde detected their footsteps.',
  det_hyde_near: 'They came too close to the Hyde.',
  noise_cabinet: 'The Hyde heard the cabinet door.',
  cabinet_creak: 'The cabinet door creaked.',
  witnessed_hyde: 'The Hyde saw them hide.',
  witnessed_crackstone: 'Crackstone saw them hide.',
  witnessed_slurp: 'Slurp saw them hide.',
  pulled_out: 'They were pulled out of a cabinet.',
  slurp_seen: 'Slurp saw them and gave chase.',
  slurp_sensed: 'They came too close to Slurp.',
  slurp_cabinet: 'Slurp heard the cabinet door.',
  slurp_creak: 'The cabinet door creaked.',
  slurp_egg: 'Slurp heard the egg hit the ground.',
  slurp_sprint: 'Slurp heard them sprinting.',
  slurp_ability: 'Slurp heard an ability.',
  slurp_alarm: 'The alarm drew Slurp in.',
  slurp_impact: 'Slurp heard a crash.',
  slurp_hit: "Slurp's lunge hit them.",
  hit_blocked: 'Their Pokémon blocked the attack.',
  slurp_escape_cabinet: 'Lost Slurp: the cabinet door was shut.',
  slurp_escape_hid: 'Hiding broke his line of sight.',
  slurp_escape_leash: 'They left his haunt.',
  slurp_power_stun: 'An ability stopped Slurp.',
  slurp_power_lure: 'An ability lured Slurp away.',
};

const ADVICE: Record<string, string> = {
  evade: 'Break its line of sight',
  hide: 'Hide',
  crouch: 'Crouch and move slowly',
  stop_sprinting: 'Stop sprinting',
  stay_quiet: 'Stay quiet',
  alt_route: 'Take a safer route',
  use_power: 'Use the character power',
  use_move: 'Use the Pokémon move',
  inspect_clue: 'Check a likely clue spot',
  search_room: 'Search a likely clue area',
  get_egg: 'Go for the egg',
  retrieve_egg: 'Pick the egg back up',
  go_to_tower: 'Carry the egg to the tower',
  deposit: 'Deposit the egg',
  review_evidence: 'Review the evidence',
  take_cover: 'Get behind cover before the scan',
  leave_curse: 'Step out of the curse ring',
  break_sight: 'Break his line of sight',
  avoid_area: "Stay out of Crackstone's sight",
  crackstone_area: "Crackstone's haunt announced",
  hide_cabinet: 'Hide in a cabinet',
  close_cabinet: 'Close the cabinet',
  exit_cabinet: 'Step out of the cabinet',
};

const POWER_CODES = new Set(['power_stun', 'power_lure', 'power_escape', 'noise_ability', 'crack_power_stun', 'crack_power_lure', 'slurp_power_stun', 'slurp_power_lure']);

function abilityName(id: string | null): string | null {
  if (!id) return null;
  for (const n of Object.values(REGISTRIES.nightshades)) if (n.power.id === id) return n.power.name;
  for (const p of Object.values(REGISTRIES.partners)) if (p.move.id === id) return p.move.name;
  return null;
}

/** Headword + one line for a reported Thing item (fixed copy; never free text from the wire). */
export function thingItemText(item: { kind: 'log' | 'diagnostic' | 'advice'; code: string; ref: string | null }): { head: string; text: string } {
  if (item.kind === 'advice') {
    const ab = abilityName(item.ref);
    const base = ADVICE[item.code] ?? 'Advice given';
    const crackHead = item.code === 'crackstone_area' || item.code === 'take_cover' || item.code === 'leave_curse' || item.code === 'break_sight' || item.code === 'avoid_area';
    return { head: crackHead ? TITLES.crackstone : TITLES.advice, text: (item.code === 'use_power' || item.code === 'use_move') && ab ? `Use ${ab}` : base };
  }
  if (item.kind === 'diagnostic') {
    const head = item.code.startsWith('power_') || item.code.startsWith('crack_power_') || item.code.startsWith('slurp_power_') ? TITLES.power
      : item.code.startsWith('egg_') ? TITLES.egg
      : item.code === 'clue_statement' ? TITLES.investigation : item.code.startsWith('pattern_') ? TITLES.pattern
      : item.code.startsWith('crack_') || item.code === 'witnessed_crackstone' ? TITLES.crackstone
      : item.code.startsWith('slurp_') || item.code === 'hit_blocked' || item.code === 'witnessed_slurp' ? TITLES.slurp : TITLES.hyde;
    const ab = POWER_CODES.has(item.code) ? abilityName(item.ref) : null;
    const text = ab
      ? item.code === 'power_stun' ? `${ab} stunned the Hyde.` : item.code === 'power_lure' ? `${ab} lured the Hyde away.`
        : item.code === 'power_escape' ? `${ab} helped them escape.` : item.code === 'crack_power_stun' ? `${ab} stopped Crackstone.`
        : item.code === 'crack_power_lure' ? `${ab} lured Crackstone away.` : item.code === 'slurp_power_stun' ? `${ab} stopped Slurp.`
        : item.code === 'slurp_power_lure' ? `${ab} lured Slurp away.` : `${ab} made noise.`
      : DIAG[item.code] ?? 'Thing explained an event.';
    return { head, text };
  }
  return { head: TITLES.log, text: 'Progress logged.' };
}
