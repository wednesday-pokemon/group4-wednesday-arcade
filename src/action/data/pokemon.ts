// Real-time Pokémon abilities (rules v3.0-realtime). Pure data: no logic, type-only imports.
// Every number is a TUNING DEFAULT. Magnitude semantics per specialty and balance model: docs/GDD_V3_REALTIME.md §9.
// Q on foot (Stage 2) is the universal "Seek"; its specialty-based variant is described in GDD §7.4.
// Cooldowns reset and charges refill at the start of each boat stage. A rescue consumes a use like a Q press.
import type { PokemonAbilityDef } from '../types.ts';

export const POKEMON_ABILITY_DEFS: PokemonAbilityDef[] = [
  {
    id: 'gengar',
    abilityName: 'Shadow Double',
    specialty: 'hyde_distraction',
    description: 'Q: a shadow double lures the Hyde; he slows to 25% for 3.5 s.',
    cooldownS: 26,
    charges: null,
    durationS: 3.5,
    magnitude: 0.25, // Hyde speed multiplier while lured; cancels an active surge
    rescue: { negateDamage: true, protectEgg: false, pushHydeBackM: 10, text: 'The Hyde grabs your shadow, not you.' },
    passive: { kind: 'phase_sunken_branches', value: 1, text: 'Your shadowy hull slips through sunken branches.' },
  },
  {
    id: 'alolan_marowak',
    abilityName: 'Bone Shield',
    specialty: 'shield',
    description: 'Q: a bone ring absorbs the next 2 obstacle hits for 8 s.',
    cooldownS: 16,
    charges: null,
    durationS: 8,
    magnitude: 2, // obstacle hits absorbed
    rescue: { negateDamage: true, protectEgg: false, pushHydeBackM: 10, text: 'Bone club! The Hyde reels back.' },
  },
  {
    id: 'misdreavus',
    abilityName: 'Spite Echo',
    specialty: 'hyde_distraction',
    description: 'Q: a wail lures the Hyde away; he moves at 50% for 5 s.',
    cooldownS: 20,
    charges: null,
    durationS: 5,
    magnitude: 0.5, // Hyde speed multiplier while lured; cancels an active surge
    rescue: { negateDamage: false, protectEgg: false, pushHydeBackM: 14, text: 'A shriek in his ear. He lets go.' },
    passive: { kind: 'surge_closing_mult', value: 0.75, text: 'Hyde surges close 25% less distance.' },
  },
  {
    id: 'galarian_corsola',
    abilityName: 'Cursed Body',
    specialty: 'stamina_restore',
    description: 'Q: restore 45 stamina; strokes cost nothing for 4 s.',
    cooldownS: 22,
    charges: null,
    durationS: 4,
    magnitude: 45, // stamina points restored instantly
    rescue: { negateDamage: true, protectEgg: false, pushHydeBackM: 8, text: 'Cursed coral! The Hyde recoils.' },
    passive: { kind: 'curse_on_catch_hyde_speed_mult', value: 0.75, text: 'After any catch, the Hyde moves at 75% for 8 s.' },
  },
  {
    id: 'sableye',
    abilityName: 'Gem Sense',
    specialty: 'egg_sense',
    description: 'Q: gems reveal the egg within 70 u on the island, hazards on water.',
    cooldownS: 16,
    charges: null,
    durationS: 6,
    magnitude: 70, // on-foot egg reveal radius (u); on water hazard glints at magnitude x 0.5
    rescue: { negateDamage: false, protectEgg: true, pushHydeBackM: 6, text: 'Sableye hugs the egg and flashes its gems.' },
    passive: { kind: 'egg_glow_radius_mult', value: 1.6, text: 'Egg glow is visible from 60% farther away.' },
  },
  {
    id: 'dusknoir',
    abilityName: 'Pressure Grip',
    specialty: 'pursuit_slow',
    description: 'Q: a shadow grip slows the Hyde to 65% for 7 s.',
    cooldownS: 24,
    charges: null,
    durationS: 7,
    magnitude: 0.65, // Hyde speed multiplier, also during surges
    rescue: { negateDamage: false, protectEgg: false, pushHydeBackM: 18, text: 'Dusknoir hauls the Hyde back into the dark.' },
    passive: { kind: 'hyde_catch_radius_mult', value: 0.8, text: 'Pressure: the Hyde must get 20% closer to grab you.' },
  },
  {
    id: 'drifblim',
    abilityName: 'Tailwind',
    specialty: 'speed_boost',
    description: 'Q: tailwind +2.5 u/s for 6 s; strokes cost half stamina.',
    cooldownS: 24,
    charges: null,
    durationS: 6,
    magnitude: 2.5, // instant +u/s and speed-cap raise
    rescue: { negateDamage: false, protectEgg: true, pushHydeBackM: 10, text: 'Drifblim lifts the egg clear of his claws.' },
    passive: { kind: 'boost_stroke_cost_mult', value: 0.5, text: 'Strokes cost half stamina while Tailwind blows.' },
  },
  {
    id: 'froslass',
    abilityName: 'Freezing Mist',
    specialty: 'pursuit_slow',
    description: 'Q: freezing mist slows the Hyde to 45% for 4.5 s.',
    cooldownS: 20,
    charges: null,
    durationS: 4.5,
    magnitude: 0.45, // Hyde speed multiplier, also during surges
    rescue: { negateDamage: true, protectEgg: false, pushHydeBackM: 10, text: 'His hand freezes to the hull and snaps off.' },
    passive: { kind: 'fog_hyde_speed_mult', value: 0.85, text: 'Snow Cloak: in fog the Hyde moves 15% slower.' },
  },
  {
    id: 'jellicent',
    abilityName: 'Water Barrier',
    specialty: 'shield',
    description: 'Q: a water barrier absorbs 3 hits for 5 s. Currents barely push you.',
    cooldownS: 28,
    charges: null,
    durationS: 5,
    magnitude: 3, // obstacle hits absorbed
    rescue: { negateDamage: true, protectEgg: true, pushHydeBackM: 4, text: 'A bubble of lake water swallows his grab.' },
    passive: { kind: 'current_push_mult', value: 0.25, text: 'Water Absorb: currents push you 75% less.' },
  },
  {
    id: 'chandelure',
    abilityName: 'Flash Fire Flare',
    specialty: 'fog_clear',
    description: 'Q: a flare clears fog within 40 u for 8 s; dazzles a close Hyde.',
    cooldownS: 16,
    charges: null,
    durationS: 8,
    magnitude: 40, // fog-clear radius (u)
    rescue: { negateDamage: false, protectEgg: true, pushHydeBackM: 12, text: 'A blinding flare. He shields his eyes.' },
    passive: { kind: 'flare_stuns_hyde_s', value: 1.5, text: 'The flare stuns a Hyde within 20 u for 1.5 s.' },
  },
  {
    id: 'aegislash',
    abilityName: "King's Shield",
    specialty: 'shield',
    description: "Q: a 2.5 s shield blocks rocks and even the Hyde's grab.",
    cooldownS: 20,
    charges: null,
    durationS: 2.5,
    magnitude: 3, // hits absorbed
    rescue: { negateDamage: true, protectEgg: true, pushHydeBackM: 6, text: "King's Shield! Nothing gets through." },
    passive: { kind: 'shield_blocks_hyde_knockback_u', value: 10, text: 'An active shield repels the Hyde: no catch.' },
  },
  {
    id: 'trevenant',
    abilityName: 'Forest Anchor',
    specialty: 'shield',
    description: 'Q: roots absorb 4 hits for 6 s. Your crashes snag the Hyde.',
    cooldownS: 26,
    charges: null,
    durationS: 6,
    magnitude: 4, // obstacle hits absorbed
    rescue: { negateDamage: false, protectEgg: true, pushHydeBackM: 8, text: 'Roots bind the egg to the hull.' },
    passive: { kind: 'collision_roots_hyde_s', value: 1.5, text: 'Each collision roots the Hyde (50% speed) for 1.5 s.' },
  },
  {
    id: 'dhelmise',
    abilityName: 'Ghost Anchor',
    specialty: 'egg_protection',
    description: 'Q: an anchor chain locks the egg for 12 s; hull damage halved.',
    cooldownS: 22,
    charges: null,
    durationS: 12,
    magnitude: 1.0, // fraction of egg security loss prevented; hull x (1 - magnitude / 2)
    rescue: { negateDamage: true, protectEgg: true, pushHydeBackM: 4, text: 'The anchor slams down. Boat and egg hold.' },
    passive: { kind: 'egg_tether_scoop_radius_mult', value: 2, text: 'A fallen egg never sinks; scoop it from 2x as far.' },
  },
  {
    id: 'decidueye',
    abilityName: 'Spirit Sight',
    specialty: 'obstacle_detection',
    description: 'Q: reveals every hazard within 45 u for 8 s, even sunken ones.',
    cooldownS: 15,
    charges: null,
    durationS: 8,
    magnitude: 45, // reveal radius (u)
    rescue: { negateDamage: false, protectEgg: true, pushHydeBackM: 10, text: 'Spirit Shackle pins his sleeve. Egg safe.' },
    passive: { kind: 'hazard_outline_range_u', value: 20, text: 'Sunken hazards within 20 u are always outlined.' },
  },
  {
    id: 'dragapult',
    abilityName: 'Dragon Darts',
    specialty: 'speed_boost',
    description: 'Q: dart forward +5 u/s. 4 charges per boat stage.',
    cooldownS: 8,
    charges: 4,
    durationS: 2.5,
    magnitude: 5, // instant +u/s and speed-cap raise
    rescue: { negateDamage: false, protectEgg: false, pushHydeBackM: 20, text: 'Dreepy darts! You rocket out of his grip.' },
  },
  {
    id: 'basculegion',
    abilityName: 'Wave Rider',
    specialty: 'current_ride',
    description: 'Q: ride currents in your direction for 8 s; +1.5 u/s elsewhere.',
    cooldownS: 22,
    charges: null,
    durationS: 8,
    magnitude: 1.5, // current push re-aimed along heading x magnitude; open water +magnitude u/s push
    rescue: { negateDamage: false, protectEgg: false, pushHydeBackM: 16, text: 'Basculegion rams the gondola away.' },
    passive: { kind: 'lead_top_speed_bonus', value: 0.6, text: 'With the Hyde 25 u+ behind, top speed +0.6 u/s.' },
  },
  {
    id: 'ceruledge',
    abilityName: 'Bitter Blade',
    specialty: 'speed_boost',
    description: 'Q: a blade dash +3.5 u/s, slicing logs and branches in your way.',
    cooldownS: 20,
    charges: null,
    durationS: 2.5,
    magnitude: 3.5, // instant +u/s and speed-cap raise
    rescue: { negateDamage: true, protectEgg: false, pushHydeBackM: 10, text: 'A blazing parry knocks his hand away.' },
    passive: { kind: 'boost_cuts_debris', value: 1, text: 'While dashing, logs, branches and buoys are cut.' },
  },
  {
    id: 'gholdengo',
    abilityName: 'Golden Body',
    specialty: 'egg_protection',
    description: 'Q: gold plating cuts egg loss 75% for 6 s. Passive: egg security floor 40.',
    cooldownS: 20,
    charges: null,
    durationS: 6,
    magnitude: 0.75, // fraction of egg security loss prevented; hull x (1 - magnitude / 2)
    rescue: { negateDamage: false, protectEgg: true, pushHydeBackM: 10, text: 'Coins everywhere. The Hyde grabs gold, not egg.' },
    passive: { kind: 'egg_security_floor', value: 40, text: 'Good as Gold: carried egg security never drops below 40.' }, // D-27: replaces +0.5 pt
  },
];
