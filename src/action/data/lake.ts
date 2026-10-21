// Stage 1 course — Raven Lake (rules v3.0-realtime). An OPEN haunted lake, not a corridor. Spec: docs/V3_STAGE1_CONTRACT.md
// "Course data"; map, routes, clearances and pacing: docs/STAGE1_LAKE.md. Hand-placed and deterministic (no randomness).
//
// Frame: XZ plane, +X east, +Z south (toward the start); heading 0 faces −Z (north). Units ≈ metres.
// Start (0, 0) in Nevermore Cove → Nevermore Gate (40 u throat, z −148…−190; disturbance + Hyde emergence, every boat
// crosses both) → Bell Pool, where three routes split around Hollow Isle (west) and Gallows Isle (east):
//   Western Bay      ~690 u  safe   wide open water, few hazards, one islet
//   Reef Run         ~527 u  risky  Thorn Reef + Wreck Reef lanes (13–18 u), cross-current, fog, mid-course surge
//   Gallows Narrows  ~655 u  risky  two 18 u squeezes, a north-flowing current you can ride, drifting logs, fog
// Cross-overs: Drowned Cut (bay ↔ reef, z ≈ −290) and Gallows Gap (reef ↔ narrows, z ≈ −320). All routes rejoin in
// the North Reach and enter Raven Harbour through one 52 u mouth (harbour surge), then the safe harbour near the dock.
import type {
  CourseDef, CurrentZone, EncounterTrigger, FogZone, LandMass, Landmark, Obstacle, ObstacleKind, RouteHint, Vec2,
} from '../types.ts';

const HALF_PI = Math.PI / 2;

/** Base damage per kind — the Phase 1 table (src/action/course.ts). */
const DAMAGE: Record<ObstacleKind, number> = { rock: 14, log: 10, dock: 12, branch: 8, buoy: 3, debris: 6 };

type Drift = NonNullable<Obstacle['drift']>;
type XZ = readonly [number, number];

// ------------------------------------------------------------------------------------------------- helpers

/**
 * Shoelace signed area ½ Σ (x_i·z_{i+1} − x_{i+1}·z_i). Lake convention: every LandMass is stored with a POSITIVE
 * value (= "counter-clockwise" with x as the first axis and z as the second). Drawn north-up (−Z up the page) the same
 * loop looks clockwise. Collision (point-in-polygon, closest edge) does not depend on it.
 */
export function polygonSignedArea(points: readonly Vec2[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    twice += p.x * q.z - q.x * p.z;
  }
  return twice / 2;
}

const vec = (list: readonly XZ[]): Vec2[] => list.map(([x, z]) => ({ x, z }));

/** Outlines are hand-listed (simple, not closed); the winding is normalised to a positive signed area here. */
function landMass(id: string, kind: LandMass['kind'], height: number, trees: number, outline: readonly XZ[]): LandMass {
  const points = vec(outline);
  return { id, kind, points: polygonSignedArea(points) >= 0 ? points : points.reverse(), height, trees };
}

/** Obstacle factory per zone: ids are `<zone>-<kind>-<n>` (unique, stable per build). */
function zone(prefix: string) {
  let n = 0;
  return (kind: ObstacleKind, x: number, z: number, radius: number, halfLength = 0, angle = 0, drift?: Drift): Obstacle => ({
    id: `${prefix}-${kind}-${++n}`, kind, x, z, radius, halfLength, angle, damage: DAMAGE[kind], ...(drift ? { drift } : {}),
  });
}

// ------------------------------------------------------------------------------------------------- land

function buildLand(): LandMass[] {
  return [
    // ---- the lake edge (shores overlap each other inland, so the outline is watertight)
    landMass('nevermore_shore', 'shore', 9, 5, [
      // west headland, north coast (facing the west passage), west → east
      [-320, -196], [-260, -196], [-200, -200], [-160, -194], [-120, -199], [-80, -193], [-50, -197], [-32, -192],
      // Nevermore Gate, west wall (north → south)
      [-21, -190], [-22, -176], [-20, -162], [-24, -148],
      // Nevermore Cove: west side → boathouse bay → east side
      [-32, -130], [-50, -112], [-72, -88], [-88, -58], [-95, -25], [-88, 10], [-66, 36], [-34, 50], [0, 54],
      [34, 50], [66, 36], [88, 10], [95, -25], [88, -58], [72, -88], [50, -112], [32, -130],
      // Nevermore Gate, east wall (south → north)
      [24, -148], [21, -160], [19, -174], [22, -190],
      // east headland, north coast (facing the east passage), west → east
      [34, -193], [55, -198], [80, -194], [110, -199], [140, -195], [180, -200], [240, -196], [320, -196],
      // academy grounds
      [320, 200], [-320, 200],
    ]),
    landMass('west_shore', 'shore', 7, 8, [
      [-170, -180], [-165, -215], [-172, -250], [-166, -290], [-174, -325], [-166, -360], [-158, -390], [-150, -420],
      [-320, -420], [-320, -180],
    ]),
    landMass('east_shore', 'shore', 7, 9, [
      [150, -180], [320, -180], [320, -420], [140, -420], [126, -392], [114, -376], [111, -360], [122, -345],
      [130, -328], [128, -310], [118, -290], [112, -272], [114, -255], [124, -236], [138, -215],
    ]),
    landMass('raven_island', 'shore', 14, 7, [
      [-320, -402], [-280, -402], [-210, -408], [-160, -401], [-120, -409], [-80, -404], [-50, -409], [-34, -406],
      [-26, -401], // harbour mouth, west tip
      [-32, -418], [-44, -434], [-47, -452], [-38, -470], [-25, -484], [-22, -500], [-25, -516], [-21, -534],
      [-10, -546], [0, -549], [10, -546], [21, -534], [25, -516], [22, -500], [25, -484], [38, -470], [47, -452],
      [44, -434], [32, -418],
      [26, -401], // harbour mouth, east tip
      [34, -406], [52, -409], [90, -404], [125, -409], [160, -401], [210, -408], [280, -402], [320, -402],
      [320, -730], [-320, -730],
    ]),
    // ---- islands that carve the three routes
    landMass('hollow_isle_south', 'islet', 5, 10, [
      [-24, -236], [-44, -231], [-70, -234], [-94, -240], [-104, -254], [-100, -268], [-86, -279], [-62, -283],
      [-40, -280], [-25, -272], [-20, -254],
    ]),
    landMass('hollow_isle_north', 'islet', 6, 11, [
      [-24, -306], [-42, -302], [-66, -304], [-92, -310], [-104, -326], [-100, -346], [-86, -361], [-62, -367],
      [-40, -364], [-25, -354], [-19, -330],
    ]),
    landMass('gallows_isle_south', 'islet', 5, 9, [
      [24, -238], [44, -231], [70, -234], [88, -242], [95, -260], [93, -284], [85, -304], [62, -312], [40, -309],
      [26, -297], [20, -268],
    ]),
    landMass('gallows_isle_north', 'islet', 6, 8, [
      [22, -334], [42, -330], [66, -331], [86, -338], [95, -352], [88, -366], [68, -372], [44, -370], [28, -362],
      [18, -348],
    ]),
    landMass('gibbet_rock', 'islet', 3.5, 2, [
      [-134, -298], [-137.05, -293.05], [-142, -289.5], [-147.3, -292.7], [-151, -298], [-146.95, -302.95],
      [-142, -306], [-136.7, -303.3],
    ]),
    // ---- reefs inside the Reef Run (light scrape on fast head-on hits only)
    landMass('thorn_reef', 'reef', 0.5, 0, [
      [-5, -246], [2, -244], [6, -250], [7, -258], [4, -266], [-2, -268], [-6, -262], [-7, -253],
    ]),
    landMass('wreck_reef', 'reef', 0.6, 0, [
      [-5, -316], [1, -312], [9, -313], [13, -319], [11, -328], [5, -332], [-3, -330], [-6, -323],
    ]),
  ];
}

// ------------------------------------------------------------------------------------------------- obstacles

/** Nevermore Cove + Gate (z 54 → −190): warm-up. Boathouse pier stubs, two rock clusters off the line, gate buoys. */
function cove(): Obstacle[] {
  const o = zone('cove');
  return [
    o('dock', -30, 22, 0.7, 3, 0.4),
    o('dock', 26, 30, 0.7, 2.5, -0.3),
    o('debris', 14, -40, 1.0),
    o('debris', 17, -44, 0.8),
    o('rock', -38, -52, 2.6),
    o('rock', -43, -57, 1.8),
    o('rock', -33, -58, 1.5),
    o('rock', 70, -30, 2.2),
    o('rock', 34, -96, 2.8),
    o('rock', 39, -91, 1.7),
    o('rock', 30, -102, 1.6),
    o('log', -24, -110, 0.6, 3.5, HALF_PI + 0.2),
    o('buoy', -15, -144, 0.7), // gate markers (one per side, not a lane)
    o('buoy', 15, -144, 0.7),
    o('branch', -16.5, -176, 0.45, 4, HALF_PI + 0.25), // snag rooted in the west gate wall
    o('debris', 12, -184, 1.1),
  ];
}

/** Bell Pool + the west/east passages (z −190 → −236): the fork. Clusters hug the island coasts. */
function pool(): Obstacle[] {
  const o = zone('pool');
  return [
    o('buoy', -3, -212, 1.0), // the bell buoy (landmark) — the fork marker
    o('rock', -62, -226, 2.0),
    o('rock', -57, -229, 1.5),
    o('debris', -96, -203, 1.2),
    o('debris', -100, -206, 0.9),
    o('rock', 62, -226, 2.2),
    o('rock', 67, -229, 1.4),
  ];
}

/** Reef Run (z −232 → −368): two reef lanes, the Thornwater rocks, the wreck's debris, a drifting log in the murk. */
function reefRun(): Obstacle[] {
  const o = zone('reef');
  return [
    o('rock', -14, -234, 2.0), // splits the Thorn Reef west-lane entrance (8 / 13 u)
    o('debris', -19, -266, 0.9),
    o('branch', 17, -276, 0.45, 4, HALF_PI + 0.5), // sunken, rooted in Gallows Isle
    o('rock', 14, -292, 2.4), // the Thornwater current pushes boats toward these
    o('rock', 18, -288, 1.6),
    o('debris', -26, -292, 1.0), // Drowned Cut mouth
    o('debris', -30, -289, 0.8),
    o('log', 8, -300, 0.6, 3, 0.15, { amplitude: 4, periodS: 6.5, phase: 1.1 }), // sways along X (4 … 12)
    o('debris', 20, -318, 1.0), // wreck debris east of Wreck Reef
    o('debris', 24, -323, 0.8),
    o('dock', 2, -340, 0.7, 2.5, 0.9), // broken deck plank off the wreck
    o('rock', 12, -356, 2.2),
    o('branch', -16, -352, 0.45, 3, 0.3),
  ];
}

/** Gallows Narrows + Gallows Gap: logs ride the east bank and the gap; the lantern line stays clear at every phase. */
function narrows(): Obstacle[] {
  const o = zone('narrows');
  return [
    o('log', 116, -222, 0.6, 4, 0.9),
    o('rock', 110, -246, 1.6),
    o('branch', 97, -268, 0.45, 3.5, 0.1),
    o('log', 114, -297, 0.6, 3.5, 0.35, { amplitude: 3, periodS: 6, phase: 0, axisAngle: 0.3 }), // along the bank
    o('log', 58, -321, 0.6, 3, HALF_PI, { amplitude: 9, periodS: 7, phase: 2.4 }), // shuttles across Gallows Gap
    o('log', 116, -333, 0.6, 3, 0.2, { amplitude: 4, periodS: 5, phase: 4.0 }), // sways along X (112 … 120)
    o('rock', 95.5, -361, 1.2),
    o('debris', 110, -374, 1.0),
  ];
}

/** Western Bay: sparse, readable hazards near the shore; one slow drifting log by Gibbet Rock. */
function westBay(): Obstacle[] {
  const o = zone('westbay');
  return [
    o('rock', -160, -262, 2.4),
    o('rock', -156, -268, 1.6),
    o('debris', -100, -291, 1.2), // Drowned Cut west mouth
    o('log', -150, -318, 0.6, 3, 0.3, { amplitude: 3, periodS: 7.5, phase: 0.6 }),
    o('log', -146, -340, 0.6, 4, 0.6),
    o('debris', -158, -352, 1.0),
    o('rock', -140, -390, 2.0),
    o('rock', -134, -394, 1.4),
  ];
}

/** North Reach + Raven Harbour: reach clusters, the ruined breakwater at the mouth, inlet snags, mooring buoys. */
function harbour(): Obstacle[] {
  const o = zone('harbour');
  return [
    o('rock', -46, -378, 2.2),
    o('rock', -40, -380, 1.4),
    o('debris', -20, -372, 0.9),
    o('debris', 24, -374, 0.9),
    o('rock', 56, -380, 2.0),
    o('rock', 62, -377, 1.4),
    o('dock', -20, -404, 0.7, 3, HALF_PI - 0.5), // breakwater ruins at the mouth tips
    o('dock', 20, -404, 0.7, 3, HALF_PI + 0.5),
    o('log', -28, -450, 0.6, 3.5, 0.2, { amplitude: 5, periodS: 6, phase: 3.3 }),
    o('rock', 30, -462, 2.0),
    o('branch', -14, -488, 0.45, 4, HALF_PI - 0.3),
    o('branch', 13, -500, 0.45, 3.5, HALF_PI + 0.3),
    o('buoy', -12, -512, 0.6), // mooring buoys framing the dock
    o('buoy', 12, -512, 0.6),
  ];
}

// ------------------------------------------------------------------------------------------------- zones

const CURRENTS: readonly CurrentZone[] = [
  { x: -2, z: -292, radius: 20, pushX: 2.2, pushZ: -0.3 }, // Thornwater: shoves reef boats east toward the rocks
  { x: 60, z: -320, radius: 22, pushX: 2.0, pushZ: 0 }, // Gallows Race: through the gap, reef → narrows
  { x: 104, z: -270, radius: 32, pushX: 0.2, pushZ: -2.8 }, // Narrows Flow (south): helps northbound boats
  { x: 106, z: -318, radius: 26, pushX: 0, pushZ: -2.6 }, // Narrows Flow (gap mouth)
  { x: 102, z: -354, radius: 26, pushX: -0.8, pushZ: -2.5 }, // Narrows Flow (north): bends toward the reach
];

/** Renderer units (same scale as Phase 1's 0.03). */
const FOG: readonly FogZone[] = [
  { x: -2, z: -312, radius: 42, density: 0.035 }, // Drowned Mist over the wreck
  { x: 104, z: -352, radius: 28, density: 0.03 }, // Gallows Fog at the second squeeze
  { x: -130, z: -330, radius: 30, density: 0.02 }, // Hollow Haze, light, on the bay
];

const ENCOUNTERS: readonly EncounterTrigger[] = [
  { id: 'calm_start', kind: 'calm', x: 0, z: 0, radius: 20 },
  // the gate throat is ≤ 46 u wide at z −152: every boat passes within 24 u of the centre
  { id: 'gate_disturbance', kind: 'disturbance', x: 0, z: -152, radius: 24, params: { fogDensity: 0.035, durationS: 16 } },
  // the gate exit (z −190) is ≤ 43 u wide: every boat passes within 24 u
  { id: 'gate_hyde_emerge', kind: 'hyde_emerge', x: 0, z: -196, radius: 24 },
  // covers the full Reef Run width at z −248; bay and narrows boats get it from the director's progress fallback
  { id: 'surge_thorn_reef', kind: 'surge', x: 0, z: -248, radius: 23, params: { boost: 3.0, durationS: 4.0 } },
  // covers the whole 52 u harbour mouth: every route
  { id: 'surge_harbour_mouth', kind: 'surge', x: 0, z: -408, radius: 30, params: { boost: 3.0, durationS: 4.0 } },
  // the inlet is ≤ 46 u wide at z −494: every boat passes within 23 u, ~40 u before the dock
  { id: 'raven_safe_harbour', kind: 'safe_harbour', x: 0, z: -494, radius: 23 },
];

/** rotation uses the heading convention: 0 faces −Z (north). */
const LANDMARKS: readonly Landmark[] = [
  { id: 'nevermore_academy', kind: 'nevermore_academy', x: 0, z: 100, rotation: 0, scale: 1.2 },
  { id: 'nevermore_boathouse_dock', kind: 'start_dock', x: 0, z: 7, rotation: 0, scale: 1 },
  { id: 'fork_bell_buoy', kind: 'bell_buoy', x: -3, z: -212, rotation: 0, scale: 1 },
  { id: 'drowned_wreck', kind: 'wreck', x: 3, z: -322, rotation: 0.7, scale: 1 },
  { id: 'hollow_shrine', kind: 'shrine', x: -62, z: -334, rotation: HALF_PI, scale: 1 },
  { id: 'harbour_lighthouse', kind: 'lighthouse', x: -44, z: -421, rotation: 0, scale: 1.2 },
  { id: 'raven_crypt', kind: 'crypt', x: 90, z: -470, rotation: Math.PI, scale: 1 },
  { id: 'raven_dock', kind: 'raven_dock', x: 0, z: -534, rotation: Math.PI, scale: 1 },
  { id: 'raven_island', kind: 'raven_island', x: 0, z: -620, rotation: Math.PI, scale: 1.5 },
];

// ------------------------------------------------------------------------------------------------- routes

// Lantern lines (visual guidance only). Every point and segment keeps ≥ 4 u from land and from every obstacle at every
// drift phase; z decreases monotonically along each line.
const SHARED_START: readonly XZ[] = [[0, -6], [-6, -75], [0, -140], [0, -170], [0, -190]];
const SHARED_FINISH: readonly XZ[] = [[0, -420], [0, -460], [0, -500], [0, -514]];

const WESTERN_BAY: readonly XZ[] = [
  [-14, -204], [-45, -212], [-82, -214], [-118, -236], [-124, -270], [-120, -300], [-128, -335], [-124, -362],
  [-100, -384], [-60, -388], [-14, -396],
];
const REEF_RUN: readonly XZ[] = [
  [8, -222], [14, -240], [14, -262], [0, -284], [-12, -300], [-13, -320], [-8, -340], [0, -362], [0, -385],
];
const GALLOWS_NARROWS: readonly XZ[] = [
  [14, -204], [45, -212], [78, -216], [100, -236], [104, -262], [104, -290], [108, -318], [104, -340], [103, -360],
  [90, -382], [50, -390], [14, -396],
];

const line = (middle: readonly XZ[]): Vec2[] => vec([...SHARED_START, ...middle, ...SHARED_FINISH]);

function buildRoutes(): RouteHint[] {
  return [
    { id: 'western_bay', name: 'Western Bay', risk: 'safe', points: line(WESTERN_BAY) },
    { id: 'reef_run', name: 'Reef Run', risk: 'risky', points: line(REEF_RUN) },
    { id: 'gallows_narrows', name: 'Gallows Narrows', risk: 'risky', points: line(GALLOWS_NARROWS) },
  ];
}

/** Start plus the safe (Western Bay) lantern line: an autopilot-friendly centreline, z monotonic. */
export const LAKE_CHECKPOINTS: Vec2[] = vec([[0, 0], ...SHARED_START, ...WESTERN_BAY, ...SHARED_FINISH]);

// ------------------------------------------------------------------------------------------------- course

export function buildLakeCourse(): CourseDef {
  return {
    id: 'raven_lake',
    name: 'The Crossing — Raven Lake',
    start: { x: 0, z: 0, heading: 0 },
    finish: { x: 0, z: -520, radius: 7 },
    bounds: { minX: -330, maxX: 330, minZ: -740, maxZ: 210 },
    obstacles: [...cove(), ...pool(), ...reefRun(), ...narrows(), ...westBay(), ...harbour()],
    currents: CURRENTS.map((c) => ({ ...c })),
    fog: FOG.map((f) => ({ ...f })),
    land: buildLand(),
    landmarks: LANDMARKS.map((l) => ({ ...l })),
    routes: buildRoutes(),
    encounters: ENCOUNTERS.map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) })),
    // dormant (hidden) in the cove, 56 u south of the disturbance trigger: already behind the boat when it fires.
    // wake() then places him on the wake 45 u behind the boat.
    hydeSpawn: { x: -4, z: -96, heading: 0 },
  };
}
