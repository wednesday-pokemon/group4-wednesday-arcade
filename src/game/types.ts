// Canonical shared domain contract (rules v2.5). Used by browser, Edge Functions, trainer and tests.
// Units: all simulated time is stored as INTEGER CENTISECONDS (suffix `Cs`) so local/server/test math is exact.
// Percentages for time discounts are INTEGER percentage points (e.g. 12 = 12%). Probabilities are fractions [0,1].

export type RulesVersion = 'v2.5';
export type LegIndex = 1 | 2 | 3;
export type RouteId = 'safe' | 'shortcut';
export type PushLevel = 1 | 2 | 3;
export type EggDecision = 'collect' | 'skip';
export type WeatherId = 'clear' | 'strong_currents' | 'heavy_fog';
export type EggTier = 'none' | 'common' | 'rare' | 'legendary';
export type SessionStatus = 'in_progress' | 'completed' | 'dnf' | 'abandoned';
export type SessionPhase = 'awaiting_route' | 'awaiting_egg' | 'complete';
export type DnfReason = 'second_catch' | 'hp_depleted';
export type StationId = 'station_a' | 'station_b' | 'station_c';

export type CharacterId =
  | 'wednesday' | 'enid' | 'bianca' | 'xavier' | 'ajax' | 'yoko'
  | 'kent' | 'divina' | 'rowan' | 'eugene' | 'morticia' | 'gomez';

export type PokemonId =
  | 'gengar' | 'alolan_marowak' | 'misdreavus' | 'galarian_corsola' | 'sableye' | 'dusknoir'
  | 'drifblim' | 'froslass' | 'jellicent' | 'chandelure' | 'aegislash' | 'trevenant'
  | 'dhelmise' | 'decidueye' | 'dragapult' | 'basculegion' | 'ceruledge' | 'gholdengo';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  abilityName: string;
  shortAbility: string; // <= ~60 chars, shown on selection cards
  palette: [string, string, string];
}

export interface PokemonDef {
  id: PokemonId;
  name: string;
  traitName: string;
  shortTrait: string;
  palette: [string, string];
}

export interface LegDef {
  index: LegIndex;
  name: string;
  safeBaseS: number;
  shortcutBaseS: number;
  shortcutCrashP: number;
  shortcutHydeBaseP: number;
}

export interface WeatherDef {
  id: WeatherId;
  name: string;
  probability: number;
  safeDelayS: number;
  shortcutDelayS: number;
}

/** One-use ability consumption flags. Live in authoritative state only. */
export interface AbilityFlags {
  gengarWeatherUsed: boolean;
  xavierCrashUsed: boolean;
  rowanCrashUsed: boolean;
  firstCatchResolved: boolean; // Aegislash / Morticia / Dhelmise consume on first catch
}

/** Trusted, seed-derived context of one leg. Weather is public at leg start; offers are confidential. */
export interface LegContext {
  legIndex: LegIndex;
  weather: WeatherId;
  offers: Record<RouteId, EggTier>;
}

/** The uniform [0,1) draws consumed by one leg resolution; fixed keys so skipped rolls never shift the stream. */
export interface LegDraws {
  crash: number;
  eggFailure: number;
  hyde: number;
}

export interface LegChoice {
  route: RouteId;
  pushLevel: PushLevel;
}

export interface PushOption {
  pushLevel: PushLevel;
  staminaCost: number;
  pushDiscountPct: number;
  isLegal: boolean;
  disabledReason: string | null;
}

export interface PreparedLeg extends LegChoice {
  legIndex: LegIndex;
  staminaCost: number;
  weather: WeatherId;
  selectedOffer: EggTier;
  preparedRevision: number;
}

export interface GapDelta {
  source: string; // e.g. 'route', 'push3', 'kent', 'misdreavus', 'crash', 'fog'
  meters: number;
  negatedBy?: string; // e.g. 'decidueye', 'trevenant', 'rowan'
}

export interface AbilityEvent {
  owner: 'character' | 'pokemon';
  abilityId: CharacterId | PokemonId;
  message: string;
}

/** Additive time waterfall; every field is integer centiseconds and they reconstruct totalCs exactly. */
export interface TimeBreakdown {
  baseCs: number;
  discountPct: number; // capped combined discount actually applied
  speedSavingsCs: number; // positive number subtracted from base
  weatherDelayCs: number;
  crashDelayCs: number;
  eggDelayCs: number;
  hydeDelayCs: number;
  floorAdjustmentCs: number; // >= 0, only when the 10 s minimum applies
  totalCs: number; // = base - savings + weather + crash + egg + hyde + floor
  discountSources: { source: string; pct: number }[];
}

export interface LegResolution {
  rulesVersion: RulesVersion;
  legIndex: LegIndex;
  legName: string;
  weather: WeatherId;
  route: RouteId;
  pushLevel: PushLevel;
  staminaCost: number;
  eggOffer: EggTier;
  eggDecision: EggDecision;
  draws: LegDraws | null; // null while a LIVE session is in progress (server redaction, SECURITY.md T-06b)

  crashProbability: number;
  crashOccurred: boolean;
  crashNegatedBy: CharacterId | null;
  crashHpLoss: number;

  eggAttempted: boolean;
  eggFailed: boolean;
  eggPointsProvisional: number;
  eggPointsLostToCatch: number;
  eggPointsBanked: number;

  gapStartM: number;
  gapDeltas: GapDelta[];
  gapBeforeCatchM: number;
  hydeProbability: number | null; // null when no random roll (safe route or proximity catch)
  hydeCatch: boolean;
  catchType: 'proximity' | 'roll' | null;
  catchNumber: 0 | 1 | 2;
  catchHpLoss: number;
  gapEndM: number;

  hpStart: number;
  hpEnd: number;
  staminaStart: number;
  staminaEnd: number;
  bankedBefore: number;
  bankedAfter: number;

  time: TimeBreakdown;
  abilityEvents: AbilityEvent[];
  outcome: 'survived' | 'finished' | 'dnf';
  dnfReason: DnfReason | null;
}

export interface GameState {
  rulesVersion: RulesVersion;
  sessionId: string;
  nickname: string;
  characterId: CharacterId;
  pokemonId: PokemonId;
  status: SessionStatus;
  phase: SessionPhase;
  legIndex: LegIndex;
  revision: number;
  hp: number;
  stamina: number;
  pursuitGapM: number;
  hydeCatchCount: 0 | 1 | 2;
  bankedEggPoints: number;
  unbankedEggPoints: number;
  totalSimulatedTimeCs: number;
  flags: AbilityFlags;
  prepared: PreparedLeg | null;
  legResults: LegResolution[];
  finalEggPoints: number | null;
  finalScore: number | null; // 2-decimal number; 0 for DNF; null while in progress
  dnfReason: DnfReason | null;
}

/** What a terminal may see for the current leg. Offers absent unless allowed (Eugene, or selected route after prepare). */
export interface LegView {
  legIndex: LegIndex;
  legName: string;
  weather: WeatherId;
  visibleOffers: Partial<Record<RouteId, EggTier>>;
}

export interface SessionView {
  state: GameState;
  leg: LegView | null;
  verified: boolean; // true only for server-verified live sessions
  seedCommitment: string | null;
  revealedSeed: string | null; // only after the session ends
}

export interface ScoreRecord {
  sessionId: string;
  nickname: string;
  stationId: StationId | 'local';
  characterId: CharacterId;
  pokemonId: PokemonId;
  status: SessionStatus;
  finalEggPoints: number;
  totalSimulatedTimeCs: number;
  finalScore: number;
  completedAt: string; // ISO timestamp (verified completion time when live)
  verified: boolean;
  rulesVersion: RulesVersion;
}

export interface TelemetryEvent {
  sessionId: string;
  stationId: StationId | 'local';
  legIndex: LegIndex;
  createdAt: string;
  predictedLegTimeS: number | null;
  predictedCatchP: number | null;
  advice: Advice | null;
  resolution: LegResolution;
}

export interface RuleConfig {
  rulesVersion: RulesVersion;
  startHp: number;
  startStamina: number;
  startGapM: number;
  maxDiscountPct: number;
  minLegTimeS: number;
}

export interface StationScope {
  mode: 'terminal' | 'dashboard';
  stationId: StationId | null;
}

export interface AdviceCandidate extends LegChoice {
  isLegal: boolean;
  expectedScore: number;
  pDnf: number;
  meetsRiskCap: boolean;
  bestFuturePolicy: string;
}

export interface Advice {
  kind: 'route' | 'egg';
  recommended: (LegChoice & { eggDecision?: EggDecision }) | null;
  candidates: AdviceCandidate[];
  riskCap: number;
  constraintMet: boolean;
  warning: string | null;
  headline: string;
  reasons: string[];
  method: 'monte_carlo' | 'rule_based';
  rolloutsPerCandidate: number;
  elapsedMs: number;
}

export interface ActionRejection {
  code:
    | 'WRONG_PHASE'
    | 'STALE_REVISION'
    | 'ILLEGAL_STAMINA'
    | 'NO_EGG_TO_COLLECT'
    | 'SESSION_CLOSED'
    | 'INVALID_INPUT';
  message: string;
}
