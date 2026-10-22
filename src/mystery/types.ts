// Shared contract for "The Silent Evidence" (rules mystery-v3.1). Source of truth: docs/v3.1/GAME_PLAN_v3_1.md and
// docs/MYSTERY_CONTRACT.md. Owned by the orchestrator: agents read it, never edit it (ask for changes).
//
// World: metres, XZ ground plane, +Y up. Yaw convention matches the rest of the repo: yaw 0 faces −Z,
// forward = (−sin yaw, −cos yaw); positive yaw turns left (counter-clockwise seen from above).
import type { EggTier, PokemonId, StationId } from '../game/types.ts';

export type MysteryRulesVersion = 'mystery-v3.1';
export const MYSTERY_RULES_VERSION: MysteryRulesVersion = 'mystery-v3.1';

export interface Vec2 { x: number; z: number }

// ----------------------------------------------------------------------------------------------------- roster

/** The seven selectable Nightshades (a subset of the legacy CharacterId union, so old rows stay valid). */
export type NightshadeId = 'wednesday' | 'morticia' | 'enid' | 'bianca' | 'eugene' | 'gomez' | 'ajax';
export const NIGHTSHADE_IDS: readonly NightshadeId[] = ['wednesday', 'morticia', 'enid', 'bianca', 'eugene', 'gomez', 'ajax'];
export type { PokemonId };

export type RoleTag = 'investigation' | 'stealth' | 'mobility' | 'control' | 'defense' | 'support';

/** The six card stats, each 1–5, DERIVED by `duoStats()` from the real tuning modifiers below (never hand-typed). */
export interface DuoStats { investigation: number; stealth: number; mobility: number; defense: number; hydeControl: number; eggProtection: number }

/**
 * Passive gameplay modifiers. Every number here is read by the sim; the card stats are computed from them.
 * Multipliers are 1 = neutral.
 */
export interface PlayMods {
  walkSpeedMult: number; // walk/crouch/sprint speeds × this
  sprintSpeedMult: number; // sprint only (on top of walkSpeedMult)
  footstepNoiseMult: number; // noise emitted by own footsteps
  interactTimeMult: number; // seconds to search a clue / pick up the egg × this
  catchDamageMult: number; // HP lost on a Hyde grab × this
  eggSecurityLossMult: number; // egg security lost on impacts/grabs × this
  hydeEffectDurationMult: number; // durations of stun/slow/distract/pin applied BY this player × this
}

/** Every F power and Q move is one of these effect kinds; the interpreter switches on `kind`, never on ids. */
export type AbilityEffectKind =
  | 'reveal_clues' // highlight uncollected evidence within rangeM for durationS; magnitude = max clues shown (nearest first) (Wednesday, Eugene, Chandelure)
  | 'premonition' // show the Hyde's predicted path for the next `magnitude` s, for durationS; rangeM = max Hyde distance (Morticia)
  | 'speed_boost' // movement × (1 + magnitude) for durationS; footstep noise × noiseMult (Enid, Drifblim)
  | 'lure' // decoy at an aimed point up to rangeM ahead, magnitude = decoy loudness 0..1: Hyde investigates it for durationS (Bianca, Gengar, Jellicent, Gholdengo)
  | 'distract' // Hyde ignores the player (no hearing, sight range × 0.3) for durationS (Eugene, Misdreavus)
  | 'stun' // Hyde frozen for durationS if within rangeM (and in line of sight when needsLineOfSight) (Gomez, Ajax, Sableye, Dusknoir, Decidueye, Dragapult, Ceruledge)
  | 'slow' // Hyde speed × (1 − magnitude) for durationS within rangeM / cone (Froslass, Galarian Corsola, Trevenant)
  | 'block_grab' // the next grab within durationS deals no HP / egg damage; catch STILL counts (Aegislash)
  | 'egg_shield' // egg security loss × (1 − magnitude) for durationS (Gholdengo, Dhelmise)
  | 'dash' // instant burst of `magnitude` metres along facing, collision-checked (Basculegion)
  | 'reveal_hazards' // outline walls/cover/hiding spots within rangeM for durationS and light the area (Alolan Marowak, Chandelure)
  | 'power_switch'; // Gomez: powers the shortcut gate switch when within rangeM; if out of range this effect is skipped and the NEXT effect in the list applies (e.g. stun)

export interface AbilityEffect {
  kind: AbilityEffectKind;
  durationS: number; // 0 = instant
  magnitude: number; // kind-specific (documented per kind above)
  rangeM: number;
  coneDeg?: number; // for cone targeting (Icy Wind, Gorgon Gaze)
  needsLineOfSight?: boolean;
  healHp?: number; // optional secondary heal (Strength Sap, Leech Seed, Bitter Blade)
  noiseMult?: number; // for speed_boost: footstep noise × this while active
  /** Render-only hint: stun shown as stone (petrify) or bound (pin); reveal_clues drawn as a scent trail on the ground. */
  visual?: 'petrify' | 'pin' | 'scent_trail';
}

export interface AbilityDef {
  id: string; // 'psychic_vision', 'shadow_ball', ...
  name: string; // shown on cards/HUD
  key: 'F' | 'Q';
  cooldownS: number;
  noise: number; // 0..1 loudness of activation (0 = silent) — feeds the Hyde's hearing like any other noise
  effects: AbilityEffect[]; // usually one; a second entry = secondary effect (e.g. stun + heal)
  text: string; // ≤ 90 chars, the honest player-facing description
  adaptationNote?: string; // "Game adaptation: ..." label for Q moves / requested non-canon powers
}

export interface NightshadeDef {
  id: NightshadeId;
  name: string; // "Wednesday Addams"
  shortName: string; // "Wednesday"
  identity: string; // "Psychic", "Werewolf", ...
  roleTags: RoleTag[];
  mods: PlayMods;
  power: AbilityDef; // key 'F'
  advantages: string[]; // plain English, each true in the sim
  disadvantages: string[];
}

export type MoveLegalityStatus = 'verified' | 'replaced' | 'unverified';
export interface MoveLegality { status: MoveLegalityStatus; generation: string; game: string; method: string; sourceUrl: string; note?: string }

export interface PokemonPartnerDef {
  id: PokemonId;
  name: string; // "Alolan Marowak"
  types: string[]; // ["Fire", "Ghost"]
  roleTags: RoleTag[];
  mods: Partial<PlayMods>; // multiplied onto the Nightshade's mods
  move: AbilityDef; // key 'Q', `name` = the real move name
  legality: MoveLegality;
  advantages: string[];
  disadvantages: string[];
}

export interface Duo { characterId: NightshadeId; pokemonId: PokemonId }
export interface DuoCard extends Duo {
  duoName: string; // e.g. "The Silent Shadow"
  role: RoleTag; // dominant role label for the card
  rarity: 'common' | 'rare' | 'epic'; // cosmetic frame only, never a strength promise
  stats: DuoStats;
  mods: PlayMods; // the combined real modifiers the stats were derived from
  advantages: string[]; // 2
  disadvantages: string[]; // 1–2
}

export interface DuoOffer { seed: string; cards: [DuoCard, DuoCard, DuoCard] }

// ----------------------------------------------------------------------------------------------------- map

export type RoomId = 'pier' | 'path' | 'research_room' | 'crypt' | 'egg_chamber' | 'shortcut' | 'courtyard' | 'tower';

/** Solid, sight-blocking wall: a thick segment (capsule). Collision and line of sight both use it. */
export interface WallDef { id: string; a: Vec2; b: Vec2; thickness: number; height: number; kind: 'stone' | 'ruin' | 'hedge' | 'fence' | 'rock' | 'cliff' }
/** Round obstacle. `low` cover blocks sight only for a crouching player; `high` blocks sight and movement like a wall. */
export interface CoverDef { id: string; x: number; z: number; radius: number; height: 'low' | 'high'; kind: 'crate' | 'tomb' | 'statue' | 'tree' | 'barrel' | 'pillar' | 'bush' }
/** Crouch inside → unseen unless the Hyde is within `revealM` (it still hears noise). */
export interface HidingSpotDef { id: string; x: number; z: number; radius: number; revealM: number; kind: 'alcove' | 'wardrobe' | 'hedge' | 'sarcophagus' }
export interface RoomDef { id: RoomId; name: string; polygon: Vec2[]; fog?: boolean; wet?: boolean }
/** The clues of all three cases (each case uses exactly three of them). */
export type ClueId =
  | 'falsified_transfer' | 'botanical_residue' | 'access_ledger' // Case 01 — The Poisoned Archive
  | 'sabotaged_gate' | 'tunnel_access_record' | 'equipment_match' // Case 02 — The Crypt's Last Witness
  | 'falsified_patrol_log' | 'alarm_override' | 'watchtower_signal'; // Case 03 — The Midnight Signal
export const CLUE_IDS: readonly ClueId[] = [
  'falsified_transfer', 'botanical_residue', 'access_ledger',
  'sabotaged_gate', 'tunnel_access_record', 'equipment_match',
  'falsified_patrol_log', 'alarm_override', 'watchtower_signal',
];
export interface CluePlacement { clueId: ClueId; roomId: RoomId; x: number; z: number; searchS: number }
/** Gomez's powered switch: opens `gateWallId` (removes it from collision/LOS) while powered, for `openS` seconds (0 = permanently). */
export interface PowerSwitchDef { id: string; x: number; z: number; gateWallId: string; openS: number }

export interface MapDef {
  id: string;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  playerStart: { x: number; z: number; yaw: number };
  hydeStart: { x: number; z: number; yaw: number };
  patrol: Vec2[]; // closed loop of waypoints, learnable
  walls: WallDef[];
  cover: CoverDef[];
  hidingSpots: HidingSpotDef[];
  rooms: RoomDef[];
  clues: CluePlacement[]; // exactly the three clues
  eggSpawn: Vec2; // in the egg chamber
  tower: { x: number; z: number; radius: number }; // Iago Tower deposit zone
  safeReleasePoints: Vec2[]; // where a grabbed player is released (far from the Hyde)
  powerSwitch?: PowerSwitchDef;
  landmarks: { id: string; kind: 'pier' | 'research_hall' | 'crypt' | 'egg_shrine' | 'iago_tower' | 'greenhouse' | 'lamp' | 'gate'; x: number; z: number; yaw: number; scale: number }[];
}

// ----------------------------------------------------------------------------------------------------- case

export type SuspectId = 'thornhill' | 'isaac' | 'barry';
export const SUSPECT_IDS: readonly SuspectId[] = ['thornhill', 'isaac', 'barry'];
/** `alibiOrContext` = the suspect's own statement in THIS case (a claim, never a verdict). */
export interface SuspectDef { id: SuspectId; name: string; role: string; alibiOrContext: string }

/** Three alternate scenarios of the same night (not three murders). Assigned once per session, never chosen. */
export type CaseId = 'poisoned_archive' | 'crypt_last_witness' | 'midnight_signal';
export const CASE_IDS: readonly CaseId[] = ['poisoned_archive', 'crypt_last_witness', 'midnight_signal'];

/**
 * PUBLIC clue data (ships to the browser). Deliberately carries no guilt links: who a clue implicates or clears
 * lives only in the case solution (data/solutions.ts), which the client loads after the accusation is committed.
 */
export interface ClueDef {
  id: ClueId;
  title: string;
  roomId: RoomId;
  /** Where it lies, as the locked card shows it ("Greenhouse Annex"). */
  location: string;
  /** E prompt ("Search the desk"). */
  interactLabel: string;
  /** Evidence-board glyph. */
  icon: 'fileText' | 'key' | 'sprout' | 'lock' | 'flame' | 'link' | 'signpost' | 'hourglass' | 'eye';
  text: string; // what the player reads (≤ 300 chars)
  /** Suspects NAMED in the text (neutral: a named suspect may be implicated or cleared). */
  mentions: SuspectId[];
  deduction: string; // one neutral board takeaway (≤ 120 chars), never "X did it"
  /** Thing's line when the clue is found / when a reveal power shows it. */
  thing: { found: string; vision: string };
}

/** A case-file note the visitor holds from the start (offered at the deduction; it does NOT support the culprit). */
export interface CaseNoteDef { id: string; title: string; text: string }

export interface CaseDef {
  id: CaseId;
  /** Bumped whenever the case's content or answer changes; stored with the session. */
  version: number;
  number: '01' | '02' | '03';
  title: string;
  /** Short mystery description for the case-file reveal (never names a culprit). */
  tagline: string;
  setting: string;
  victim: string;
  suspects: SuspectDef[];
  clues: ClueDef[];
  notes: CaseNoteDef[];
  /** Where this case's three clues lie on the shared island (searchS = seconds of searching). */
  placements: CluePlacement[];
  egg: { x: number; z: number; roomId: RoomId; objective: string };
  /** Case-specific display names for rooms of the shared island ("Research Archive"). */
  roomNames: Partial<Record<RoomId, string>>;
  /** Thing's case-specific lines (prologue panels 2–3 + in-run objective/hint copy). */
  thing: { welcome: string; findEgg: string; whereHint: string };
  prologue: {
    scene: 'archive' | 'crypt' | 'signal';
    death: { title: string; narration: string };
    egg: { title: string; narration: string };
  };
}

/**
 * ANSWER KEY (server + post-accusation only). Never imported statically by browser code: the app loads it with a
 * dynamic import after the visitor commits the accusation; LIVE the server recomputes everything from its own copy.
 */
export interface CaseSolution {
  caseId: CaseId;
  version: number;
  culprit: SuspectId;
  /** The evidence that must be cited for a solved case (all three clues: method, opportunity, broken alibi). */
  supportingEvidence: ClueId[];
  /** Per clue: which link of the chain it proves and whom it clears. */
  links: Record<string, { proves: 'method' | 'opportunity' | 'alibi'; clears: SuspectId[] }>;
  /** Why each innocent is excluded (results screen). */
  innocents: Partial<Record<SuspectId, string>>;
  resolution: string;
}

/** The visitor's one-shot accusation: a suspect (or null = leave unsolved) and the evidence ids they cite. */
export interface Accusation { suspectId: SuspectId | null; evidence: string[] }

export type Verdict = 'case_solved' | 'egg_secured_mystery_unsolved' | 'not_accused';

// ----------------------------------------------------------------------------------------------------- run state

export type Stance = 'idle' | 'walk' | 'crouch' | 'sprint';
export interface PlayerState {
  x: number; z: number; yaw: number; pitch: number; // pitch is camera-only
  speed: number; stance: Stance; crouched: boolean;
  hp: number; maxHp: number; catches: 0 | 1 | 2;
  invulnerableUntil: number;
  hidden: boolean; // inside a hiding spot while crouched
  roomId: RoomId | null;
  interacting: { target: 'clue' | 'egg'; id: string; progress: number } | null;
}

export type EggState = 'resting' | 'carried' | 'dropped' | 'delivered';
export interface EggRuntime { tier: Exclude<EggTier, 'none'>; points: number; security: number; state: EggState; x: number; z: number }

export type HydeMode = 'PATROL' | 'INVESTIGATE_SOUND' | 'SEARCH' | 'CHASE' | 'COOLDOWN';
export interface HydeRuntime {
  mode: HydeMode;
  modeT: number;
  x: number; z: number; yaw: number; speed: number;
  suspicion: number; // 0..1 (HUD meter): rises with heard/seen evidence of the player
  canSeePlayer: boolean;
  lastKnown: Vec2 | null;
  target: Vec2 | null; // current nav goal
  path: Vec2[]; // remaining nav path (renderer/premonition may draw it)
  stunnedUntil: number; slowedUntil: number; slowMult: number; distractedUntil: number;
  grabbing: boolean; // short grab animation window
}

export type RunStatus = 'tutorial' | 'playing' | 'accusing' | 'finished' | 'dnf';
export type DnfReason = 'second_catch' | 'hp_depleted';

export interface AbilityStatus { ready: boolean; cooldownLeftS: number; activeLeftS: number }

/** What is currently in effect, for the renderer and HUD (derived from active F/Q effects). */
export interface ActiveEffects {
  revealedClues: ClueId[]; // uncollected clues currently highlighted
  revealEgg: boolean; // egg highlighted (reveal effects also show a resting/dropped egg)
  revealHazards: boolean; // walls/cover/hiding spots outlined near the player
  premonitionPath: Vec2[] | null; // the Hyde's predicted path (Morticia)
  scentTrail: Vec2[] | null; // path toward the nearest uncollected objective (Enid's Wolf Shift)
  speedBoost: boolean;
  lurePoint: Vec2 | null; // a decoy the Hyde is investigating
  hydeDistracted: boolean;
  hydeStunned: boolean;
  hydePetrified: boolean; // stun applied by a gaze/pin effect (renderer shows stone/pinned look)
  hydeSlowed: boolean;
  blockGrab: boolean; // next grab blocked (catch still counts)
  eggShield: boolean;
  switchPowered: boolean;
  last: { key: 'F' | 'Q'; abilityId: string; kinds: AbilityEffectKind[]; t: number } | null;
}

/** Per-frame input, built by the app from keyboard + pointer-lock mouse. */
export interface MysteryInput {
  moveX: number; // −1 left … 1 right (A/D)
  moveZ: number; // −1 back … 1 forward (S/W)
  lookYawDelta: number; // radians this frame (mouse X)
  lookPitchDelta: number; // radians (mouse Y)
  sprint: boolean; // Shift held
  crouch: boolean; // crouch state requested this frame (the app resolves hold vs toggle)
  interact: boolean; // E (edge)
  interactHeld?: boolean; // E currently held (hold 0.8 s with the egg and nothing else in reach = set it down)
  power: boolean; // F (edge)
  move: boolean; // Q (edge)
  hint: boolean; // V (edge)
}

// ----------------------------------------------------------------------------------------------------- events

export type NoiseSource = 'footstep' | 'egg_drop' | 'ability' | 'interact' | 'impact' | 'decoy';
export type GameEvent =
  | { type: 'noise'; source: NoiseSource; x: number; z: number; loudness: number; radiusM: number }
  | { type: 'stance'; stance: Stance }
  | { type: 'room_enter'; roomId: RoomId }
  | { type: 'hyde_mode'; from: HydeMode; to: HydeMode; reason: 'heard_noise' | 'saw_player' | 'lost_sight' | 'search_timeout' | 'cooldown_done' | 'reached_target' | 'stunned' | 'lured' | 'grabbed' | 'gave_up' }
  | { type: 'hyde_heard'; source: NoiseSource; loudness: number; distanceM: number; occluded: boolean }
  | { type: 'hyde_sighted'; distanceM: number }
  | { type: 'hyde_lost' }
  | { type: 'catch'; catchNumber: 1 | 2; hpLost: number; eggSecurityLost: number; blocked: boolean }
  | { type: 'clue_search_start'; clueId: ClueId }
  | { type: 'clue_found'; clueId: ClueId; cluesFound: number }
  | { type: 'egg_pickup' }
  | { type: 'egg_drop'; reason: 'manual' | 'impact' | 'grab'; security: number }
  | { type: 'egg_damage'; amount: number; cause: 'grab' | 'impact' | 'drop'; security: number }
  | { type: 'egg_delivered'; tier: EggTier; points: number; security: number }
  | { type: 'ability_used'; key: 'F' | 'Q'; abilityId: string; kinds: AbilityEffectKind[]; success: boolean; detail: string }
  | { type: 'ability_denied'; key: 'F' | 'Q'; reason: 'cooldown' | 'no_target' }
  | { type: 'hint_requested' }
  | { type: 'accusation'; suspectId: SuspectId | null; correct: boolean; cluesFound: number; evidence: string[]; deductionCorrect: boolean }
  | { type: 'finish'; verdict: Verdict; score: number }
  | { type: 'dnf'; reason: DnfReason };

/** Every event carries the active sim time and a per-run monotonic sequence number (Supabase uses (session, seq)). */
export type StampedEvent = GameEvent & { t: number; seq: number };

/** Sparse 1 Hz snapshot used by analytics (never sent per frame). Only information available at time t. */
export interface StateSnapshot {
  t: number;
  roomId: RoomId | null;
  stance: Stance;
  speed: number;
  hp: number;
  catches: number;
  hidden: boolean;
  eggState: EggState;
  eggSecurity: number;
  cluesFound: number;
  hydeMode: HydeMode;
  hydeDistanceM: number;
  hydeOccluded: boolean; // a wall blocks the straight line between player and Hyde
  hydeSuspicion: number;
  recentNoise: number; // max own loudness in the last 3 s
  powerReady: boolean;
  moveReady: boolean;
  objective: Objective;
}

export type Objective = 'find_clues' | 'find_egg' | 'retrieve_egg' | 'deliver_egg' | 'accuse' | 'done';

export interface RunResult {
  rulesVersion: MysteryRulesVersion;
  caseId: CaseId;
  caseVersion: number;
  outcome: 'finished' | 'dnf';
  dnfReason: DnfReason | null;
  verdict: Verdict;
  accused: SuspectId | null;
  correct: boolean;
  /** Evidence ids cited with the accusation (clues and/or case-file notes). */
  evidence: string[];
  /** The cited evidence is exactly the case's supporting evidence. */
  deductionCorrect: boolean;
  cluesFound: ClueId[];
  eggTier: Exclude<EggTier, 'none'>;
  eggPoints: number; // delivered whole points (0 when not delivered)
  eggSecurity: number;
  activeTimeS: number; // 1 dp
  score: number | null; // (points × 100) − activeTimeS, 1 dp; null for DNF
  catches: number;
  hp: number;
  duo: Duo;
}

export interface StationContext { stationId: StationId | null; sessionId: string; offer: DuoOffer }
