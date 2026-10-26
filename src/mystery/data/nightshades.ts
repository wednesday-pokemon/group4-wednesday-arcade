// The seven selectable Nightshades and their F powers (plan §5). Game-designer owned.
//
// Every power is expressed ONLY with the contract's AbilityEffectKinds; the sim interprets `effects` by kind.
// Advantages / disadvantages are literal readings of the numbers below (base values from MYSTERY_TUNING:
// walk 3.2 m/s, sprint 5.5 m/s, grab 35 HP, clue search 2.5 s). Loudness → radius uses hearingRadiusM():
// 0.1 → 2 m, 0.3 → 6 m, 0.8 → 11.5 m.
//
// Effect-parameter conventions used here (please mirror them in the interpreter / contract comments):
// - reveal_clues.magnitude = max number of uncollected clues highlighted, nearest first (0 = all in range).
// - premonition.magnitude = seconds of predicted Hyde path; rangeM = max Hyde distance for the vision to work.
// - lure.magnitude = decoy loudness 0..1 at the aimed point (0 → MYSTERY_TUNING.abilities.defaultLureLoudness).
// - power_switch: if within rangeM of map.powerSwitch → power it; otherwise the NEXT effect (stun) is applied.
// - Wolf Shift = speed_boost + reveal_clues in the same ability: the renderer should draw that reveal as
//   ActiveEffects.scentTrail (path to the nearest uncollected objective) — see report: a dedicated
//   'scent_trail' kind would be cleaner.
import type { NightshadeDef, NightshadeId } from '../types.ts';

export const NIGHTSHADES: Record<NightshadeId, NightshadeDef> = {
  wednesday: {
    id: 'wednesday',
    name: 'Wednesday Addams',
    shortName: 'Wednesday',
    identity: 'Psychic',
    roleTags: ['investigation', 'stealth'],
    mods: {
      walkSpeedMult: 1,
      sprintSpeedMult: 0.95,
      footstepNoiseMult: 0.9,
      interactTimeMult: 0.85,
      catchDamageMult: 1,
      eggSecurityLossMult: 1,
      hydeEffectDurationMult: 1,
    },
    power: {
      id: 'psychic_vision',
      name: 'Psychic Vision',
      key: 'F',
      cooldownS: 40,
      noise: 0,
      effects: [{ kind: 'reveal_clues', durationS: 6, magnitude: 1, rangeM: 35 }],
      text: 'Marks the nearest uncollected clue within 35 m for 6 s. Silent.',
    },
    advantages: ['Searches clues and the egg 15% faster', 'Footsteps 10% quieter'],
    disadvantages: ['Sprints 5% slower (5.2 m/s, not 5.5)'],
  },

  morticia: {
    id: 'morticia',
    name: 'Morticia Addams',
    shortName: 'Morticia',
    identity: 'Psychic',
    roleTags: ['stealth', 'support'],
    mods: {
      walkSpeedMult: 0.95,
      sprintSpeedMult: 1,
      footstepNoiseMult: 0.8,
      interactTimeMult: 1.1,
      catchDamageMult: 1,
      eggSecurityLossMult: 1,
      hydeEffectDurationMult: 1,
    },
    power: {
      id: 'premonition',
      name: 'Premonition',
      key: 'F',
      cooldownS: 40,
      noise: 0,
      effects: [{ kind: 'premonition', durationS: 5, magnitude: 6, rangeM: 60 }],
      text: "Shows the Hyde's path for the next 6 s, visible for 5 s. Silent; you still dodge.",
    },
    advantages: ['Quietest footsteps: 20% quieter', "Premonition previews the Hyde's next path"],
    disadvantages: ['Walks and sprints 5% slower', 'Searches 10% slower'],
  },

  enid: {
    id: 'enid',
    name: 'Enid Sinclair',
    shortName: 'Enid',
    identity: 'Werewolf',
    roleTags: ['mobility', 'investigation'],
    mods: {
      walkSpeedMult: 1.05,
      sprintSpeedMult: 1.1,
      footstepNoiseMult: 1.15,
      interactTimeMult: 1.1,
      catchDamageMult: 1,
      eggSecurityLossMult: 1,
      hydeEffectDurationMult: 1,
    },
    power: {
      id: 'wolf_shift',
      name: 'Wolf Shift',
      key: 'F',
      cooldownS: 45,
      noise: 0.3,
      effects: [
        { kind: 'speed_boost', durationS: 7, magnitude: 0.25, rangeM: 0, noiseMult: 1.4 },
        { kind: 'reveal_clues', durationS: 7, magnitude: 1, rangeM: 25, visual: 'scent_trail' },
      ],
      text: '+25% speed and a scent trail to a clue within 25 m for 7 s; steps 40% louder.',
    },
    advantages: ['Walks 5% and sprints ~15% faster', 'Wolf Shift: +25% speed, scent trail, 7 s'],
    disadvantages: ['Footsteps 15% louder', 'Wolf Shift makes footsteps 40% louder still'],
  },

  bianca: {
    id: 'bianca',
    name: 'Bianca Barclay',
    shortName: 'Bianca',
    identity: 'Siren',
    roleTags: ['control', 'support'],
    mods: {
      walkSpeedMult: 1,
      sprintSpeedMult: 1,
      footstepNoiseMult: 0.95,
      interactTimeMult: 1,
      catchDamageMult: 1.2,
      eggSecurityLossMult: 1,
      hydeEffectDurationMult: 1.15,
    },
    power: {
      id: 'siren_call',
      name: 'Siren Call',
      key: 'F',
      cooldownS: 50,
      noise: 0.3,
      effects: [{ kind: 'lure', durationS: 4, magnitude: 0.8, rangeM: 18 }],
      text: 'Lure the Hyde to a spot up to 18 m ahead for 4 s. You can be heard ~6 m away.',
    },
    advantages: ['Siren Call lures the Hyde up to 18 m for 4 s', 'Her stuns/slows/distracts last 15% longer'],
    disadvantages: ['A Hyde grab costs her 42 HP instead of 35'],
  },

  eugene: {
    id: 'eugene',
    name: 'Eugene Ottinger',
    shortName: 'Eugene',
    identity: 'Insect control',
    roleTags: ['investigation', 'control'],
    mods: {
      walkSpeedMult: 0.95,
      sprintSpeedMult: 1,
      footstepNoiseMult: 1,
      interactTimeMult: 0.85,
      catchDamageMult: 1,
      eggSecurityLossMult: 1.1,
      hydeEffectDurationMult: 1,
    },
    power: {
      id: 'bee_swarm',
      name: 'Bee Swarm',
      key: 'F',
      cooldownS: 45,
      noise: 0.3,
      effects: [
        { kind: 'reveal_clues', durationS: 5, magnitude: 1, rangeM: 15 },
        { kind: 'distract', durationS: 5, magnitude: 0, rangeM: 12 },
      ],
      text: 'Bees mark the nearest clue within 15 m and distract a Hyde within 12 m for 5 s.',
    },
    advantages: ['Searches clues and the egg 15% faster', 'Bee Swarm marks a clue and distracts the Hyde'],
    disadvantages: ['Walks and sprints 5% slower', 'Carried egg loses 10% more security from hits'],
  },

  gomez: {
    id: 'gomez',
    name: 'Gomez Addams',
    shortName: 'Gomez',
    identity: 'Electricity (requested adaptation)',
    roleTags: ['control', 'mobility'],
    mods: {
      walkSpeedMult: 1.05,
      sprintSpeedMult: 1,
      footstepNoiseMult: 1.1,
      interactTimeMult: 1,
      catchDamageMult: 0.8,
      eggSecurityLossMult: 1,
      hydeEffectDurationMult: 1,
    },
    power: {
      id: 'electric_spark',
      name: 'Electric Spark',
      key: 'F',
      cooldownS: 50,
      noise: 0.8,
      effects: [
        { kind: 'power_switch', durationS: 0, magnitude: 0, rangeM: 4 },
        { kind: 'stun', durationS: 2, magnitude: 0, rangeM: 8, needsLineOfSight: true },
      ],
      text: 'Near the gate switch: opens the Shortcut. Else stuns a seen Hyde ≤8 m for 2 s. Loud.',
      adaptationNote:
        'Requested adaptation for this game: an electricity power for Gomez Addams is not a verified series-canon ability.',
    },
    advantages: ['A Hyde grab costs him 28 HP instead of 35', 'Only one who can open the Shortcut gate'],
    disadvantages: ['Footsteps 10% louder', 'Electric Spark is loud: heard ~11 m away'],
  },

  ajax: {
    id: 'ajax',
    name: 'Ajax Petropolus',
    shortName: 'Ajax',
    identity: 'Gorgon',
    roleTags: ['control', 'defense'],
    mods: {
      walkSpeedMult: 0.95,
      sprintSpeedMult: 1,
      footstepNoiseMult: 1,
      interactTimeMult: 1,
      catchDamageMult: 1,
      eggSecurityLossMult: 0.8,
      hydeEffectDurationMult: 1,
    },
    power: {
      id: 'gorgon_gaze',
      name: 'Gorgon Gaze',
      key: 'F',
      cooldownS: 60,
      noise: 0.1,
      effects: [{ kind: 'stun', durationS: 2.5, magnitude: 0, rangeM: 12, coneDeg: 40, needsLineOfSight: true, visual: 'petrify' }],
      text: 'Petrify a Hyde you face (12 m, 40° cone) for 2.5 s. Walls block the gaze.',
    },
    advantages: ['Gorgon Gaze petrifies the Hyde for 2.5 s', 'Carried egg loses 20% less security from hits'],
    disadvantages: ['Walks and sprints 5% slower', 'Longest cooldown of all powers: 60 s'],
  },
};

/**
 * Duo-name pieces: duoName = `The ${DUO_NAME_ADJECTIVE[character]} ${DUO_NAME_NOUN[pokemon]}` (nouns in partners.ts).
 * Adjectives ≤ 8 chars and nouns ≤ 8 chars, so every one of the 126 names is ≤ 21 chars (UX budget 22).
 */
export const DUO_NAME_ADJECTIVE: Record<NightshadeId, string> = {
  wednesday: 'Silent',
  morticia: 'Velvet',
  enid: 'Wild',
  bianca: 'Singing',
  eugene: 'Buzzing',
  gomez: 'Electric',
  ajax: 'Stone',
};
