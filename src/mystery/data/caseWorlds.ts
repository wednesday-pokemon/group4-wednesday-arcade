// Per-case worlds (overhaul 2026-10-23) — game-designer owned. Pure data (shared with Deno Edge Functions): no
// Math.random, no Date, no DOM. Rationale, ASCII sketches, prior tables and pacing math: docs/MYSTERY_DESIGN.md §10.
//
// Each case dresses the shared Raven Island (island.ts) with its own interactive layout (extraWalls / extraCover /
// extraHiding), candidate clue + egg sites (one of each group is drawn per session with the priors below), Hyde
// emergence points, risk-map zones, examinable objects, one lever passage and its hazards.
//
// Invariants (checked by hand against island.ts; see design doc §10.6):
// - Priors of every clue group, the egg sites and the spawn weights each sum to 1.
// - Every candidate site lies in the RoomId it declares (first match in island.ts ROOMS order), ≥ 1.5 m from every wall
//   surface (so it can never be reached through a wall) and ≥ 0.3 m from every cover surface; sites of one case are
//   ≥ 3 m apart.
// - Every new doorway / gap is ≥ 3.0 m clear after wall thickness; extra walls keep ≥ 0.6 m + wall radius from all 21
//   patrol segments (most sit inside rooms the patrol never enters); the pier, the tower door (8, −46), sites, spawns,
//   examines and levers are never blocked; every site is reachable from the pier WITHOUT the passage lever.
// - Spawns are ≥ 25 m from the pier start (0, 54), on or within 3 m of the patrol loop, ≥ 1.5 m from walls / cover.
// - Zones are the same 7 rectangles in every case (they tile −45..45 × −60..60); only the names change.
// - Joseph Crackstone (enemy contract 2026-10-24, design doc §11): every haunt waypoint and every loop segment (incl.
//   last → first) keeps his 0.5 m body's CENTRE ≥ 1.2 m from every wall surface (segment distance − thickness/2) and
//   cover edge (distance − radius); waypoints are ≥ 3 m from clue / egg sites and > revealM + 1 m from hiding spots;
//   haunts are ≥ 25 m from the pier start and ≥ 10 m from the Iago Tower rooms. Polygon = loop bounding box + ~2 m.
//
// Id conventions for the renderer: prefix pa_ = Case 01, cw_ = Case 02, ms_ = Case 03. Wall ids containing `shelf`,
// `stack`, `rec`, `bookcase` = bookshelves; `vine` = vine hedges; `rubble` / `tunnel` = collapsed rock; `fence` / `gate`
// = security fence; `hut` = guard-hut walls.
import type {
  CaseId, CaseWorldDef, CoverDef, ExamineDef, HazardDef, HidingSpotDef, HydeSpawnDef, Vec2, WallDef, ZoneDef,
} from '../types.ts';

/** Axis-aligned rectangle, counter-clockwise seen from above (NW → SW → SE → NE) — same convention as island.ts. */
const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [
  { x: minX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: maxZ }, { x: maxX, z: minZ },
];

/** Yaw that faces from a toward b (repo convention: yaw 0 faces −Z, forward = (−sin, −cos)). */
const faceToward = (ax: number, az: number, bx: number, bz: number): number => Math.atan2(-(bx - ax), -(bz - az));

function wall(id: string, ax: number, az: number, bx: number, bz: number, thickness: number, height: number, kind: WallDef['kind']): WallDef {
  return { id, a: { x: ax, z: az }, b: { x: bx, z: bz }, thickness, height, kind };
}

function cover(id: string, x: number, z: number, radius: number, height: CoverDef['height'], kind: CoverDef['kind']): CoverDef {
  return { id, x, z, radius, height, kind };
}

function hide(id: string, x: number, z: number, radius: number, revealM: number, kind: HidingSpotDef['kind']): HidingSpotDef {
  return { id, x, z, radius, revealM, kind };
}

/**
 * The 7 risk-map zones (identical rectangles in every case; they tile the island bounds with no gap):
 * lawn z 26..60 · crypt x −45..−18 z −8..26 · chamber x −45..−18 z −34..−8 · mid x −18..20 z −10..26 ·
 * east x 20..45 z −34..26 · terrace x −18..20 z −34..−10 · court z −60..−34.
 */
type ZoneKey = 'z_lawn' | 'z_crypt' | 'z_chamber' | 'z_mid' | 'z_east' | 'z_terrace' | 'z_court';
const ZONE_RECTS: Record<ZoneKey, Vec2[]> = {
  z_lawn: rect(-45, 26, 45, 60),
  z_crypt: rect(-45, -8, -18, 26),
  z_chamber: rect(-45, -34, -18, -8),
  z_mid: rect(-18, -10, 20, 26),
  z_east: rect(20, -34, 45, 26),
  z_terrace: rect(-18, -34, 20, -10),
  z_court: rect(-45, -60, 45, -34),
};
const ZONE_ORDER: readonly ZoneKey[] = ['z_lawn', 'z_crypt', 'z_chamber', 'z_mid', 'z_east', 'z_terrace', 'z_court'];

function zones(names: Record<ZoneKey, string>): ZoneDef[] {
  return ZONE_ORDER.map((id) => ({ id, name: names[id], polygon: ZONE_RECTS[id].map((p) => ({ ...p })) }));
}

// ===================================================================================================== Case 01
// The Poisoned Archive — archive bookshelf rows, lab benches, a vine-walled greenhouse, a records crypt with a
// serpentine of record shelves, and a bookcase that swings open from the crypt into the Restricted Vault.

const PA_WALLS: WallDef[] = [
  // Research Archive: two new bookshelf rows (the shared res_shelf at z −2 makes the third)
  wall('pa_shelf_1', 33, 3, 39.5, 3, 0.6, 2.6, 'stone'), // aisle 4.4 m to res_shelf, 3.2 m to the cliff
  wall('pa_shelf_2', 24, -3.5, 24, 1.5, 0.6, 2.6, 'stone'), // 3.3 m from the west wall, shields the wardrobe
  // Rare Book Stacks (the alley): two staggered stacks, each leaves a ≥ 4.9 m gap
  wall('pa_stack_1', 26.5, -18, 30, -18, 0.6, 2.6, 'stone'),
  wall('pa_stack_2', 32, -29, 35.5, -29, 0.6, 2.6, 'stone'),
  // Greenhouse Annex: vine hedges turn the shared back wall into a glasshouse open to the east (mouth 3.1 / 3.4 m
  // clear of planter 1); 5.4 m / 3.5 m from the nearest patrol segments
  wall('pa_vine_n', -2, -30, 3.5, -30, 1.2, 2.4, 'hedge'),
  wall('pa_vine_s', -2, -22, 3, -22, 1.2, 2.4, 'hedge'),
  // Records Crypt burial vault: a serpentine of record shelves (aisles 3.4 m, ends 5.7 / 6.2 m)
  wall('pa_rec_1', -43, 15, -36.5, 15, 0.6, 2.6, 'stone'),
  wall('pa_rec_2', -36.5, 11, -30.5, 11, 0.6, 2.6, 'stone'),
  // PASSAGE: the bookcase that closes the crypt → vault door (x −38.5..−33.5, z −8). Lever on the crypt side.
  wall('pa_bookcase', -38.5, -8, -33.5, -8, 1, 3, 'stone'),
];

const PA_COVER: CoverDef[] = [
  cover('pa_lab_bench', 28, 9, 0.8, 'low', 'crate'), // lab bench inside the south door
  cover('pa_lab_centrifuge', 34.5, 9.5, 0.7, 'low', 'barrel'), // broken centrifuge
  cover('pa_lab_still', 8, -30, 0.7, 'high', 'pillar'), // smashed distillation column by the east gate (3.3 m off the patrol)
];

const PA_HIDING: HidingSpotDef[] = [
  hide('pa_hs_cabinet', 40.5, 11, 1, 1.5, 'wardrobe'), // locked research cabinet, archive SE corner
  hide('pa_hs_vines', -6, -24, 1.1, 2, 'hedge'), // vine thicket west of the greenhouse (5.9 m off the patrol)
  hide('pa_hs_stacks', 33.5, -22.5, 1, 1.5, 'wardrobe'), // between the rare-book stacks
];

const POISONED_ARCHIVE_WORLD: CaseWorldDef = {
  caseId: 'poisoned_archive',
  theme: 'archive',
  areas: [
    { id: 'a_archive', name: 'Research Archive', x: 32, z: 2, radiusM: 12 },
    { id: 'a_stacks', name: 'Rare Book Stacks', x: 31, z: -22, radiusM: 8 },
    { id: 'a_greenhouse', name: 'Greenhouse Annex', x: -1, z: -25, radiusM: 9 },
    { id: 'a_crypt', name: 'Records Crypt', x: -29, z: 12, radiusM: 12 },
    { id: 'a_vault', name: 'Restricted Vault', x: -30, z: -21, radiusM: 11 },
  ],
  clueSites: [
    {
      clueId: 'falsified_transfer', searchS: 2.5, sites: [
        { id: 's_pa_ft_desk', areaId: 'a_archive', roomId: 'research_room', x: 38, z: -6, prior: 0.6, label: 'Archive desk', prop: 'desk' },
        { id: 's_pa_ft_stacks', areaId: 'a_stacks', roomId: 'shortcut', x: 31, z: -24, prior: 0.4, label: 'Stacks terminal', prop: 'desk' },
      ],
    },
    {
      clueId: 'botanical_residue', searchS: 2.5, sites: [
        { id: 's_pa_br_greenhouse', areaId: 'a_greenhouse', roomId: 'path', x: 1, z: -26, prior: 0.6, label: 'Inventory shelf', prop: 'shelf' },
        { id: 's_pa_br_vault', areaId: 'a_vault', roomId: 'egg_chamber', x: -40, z: -20, prior: 0.4, label: 'Specimen cabinet', prop: 'cabinet' },
      ],
    },
    {
      clueId: 'access_ledger', searchS: 2.5, sites: [
        { id: 's_pa_al_ledger', areaId: 'a_crypt', roomId: 'crypt', x: -22, z: 21, prior: 1, label: 'Door ledger', prop: 'desk' },
      ],
    },
  ],
  eggSites: [
    { id: 'e_pa_greenhouse', areaId: 'a_greenhouse', roomId: 'path', x: -6, z: -28, prior: 0.5, label: 'Potting store', prop: 'planter', traceText: 'Nest straw leads toward the greenhouse storage.' },
    { id: 'e_pa_vault', areaId: 'a_vault', roomId: 'egg_chamber', x: -28, z: -20, prior: 0.3, label: 'Vault shrine', prop: 'nest', traceText: 'Cold shell dust trails toward the Restricted Vault.' },
    { id: 'e_pa_reliquary', areaId: 'a_crypt', roomId: 'crypt', x: -33.5, z: 18.5, prior: 0.2, label: 'Reliquary', prop: 'sarcophagus', traceText: 'Warm wax drips lead into the Records Crypt.' },
  ],
  traceAccuracy: 0.75,
  hydeSpawns: [
    { id: 'sp_pa_archive_hall', name: 'Archive Hallway', zoneId: 'z_mid', x: 14, z: 4, yaw: faceToward(14, 4, 2, -6), weight: 0.45 }, // P4
    { id: 'sp_pa_gh_entrance', name: 'Greenhouse Entrance', zoneId: 'z_terrace', x: 11, z: -18, yaw: faceToward(11, -18, 2, -16), weight: 0.35 }, // on P13→P14
    { id: 'sp_pa_vault_door', name: 'Restricted Vault Door', zoneId: 'z_terrace', x: -12, z: -24, yaw: faceToward(-12, -24, -10, -38), weight: 0.2 }, // P8
  ],
  zones: zones({
    z_lawn: 'Graveyard Lawn', z_crypt: 'Records Crypt', z_chamber: 'Locked Vault', z_mid: 'Middle Path',
    z_east: 'Archive Wing', z_terrace: 'Greenhouse', z_court: 'Tower Yard',
  }),
  extraWalls: PA_WALLS,
  extraCover: PA_COVER,
  extraHiding: PA_HIDING,
  passage: {
    id: 'pa_passage_bookcase', leverX: -32, leverZ: -4.5, label: 'Pull the reading-lamp lever', wallId: 'pa_bookcase',
    text: 'The bookcase swings open. A way into the Restricted Vault!',
  },
  examines: [
    { id: 'ex_pa_vial', x: 23, z: 7, label: 'Examine the cracked vial', text: 'A cracked vial of violet tincture. Straw is stuck in the spill.', givesTrace: true, prop: 'vial' },
    { id: 'ex_pa_books', x: -26, z: 2, label: 'Examine the toppled books', text: 'Toppled record books. A warm nest feather is pressed between pages.', givesTrace: true, prop: 'books' },
    { id: 'ex_pa_vines', x: -4.5, z: -21, label: 'Examine the cut vines', text: 'Nightshade vines, snipped clean tonight. Someone harvested in a hurry.', givesTrace: false, prop: 'vines' },
  ],
  hazards: [
    { kind: 'noisy_floor', id: 'hz_pa_glass', name: 'Broken glass', polygon: rect(-1.5, -29, 3.5, -23), loudnessAdd: 0.25, look: 'glass' },
    { kind: 'noisy_floor', id: 'hz_pa_boards', name: 'Creaky floorboards', polygon: rect(30, -9.5, 42.5, -3), loudnessAdd: 0.25, look: 'boards' },
  ],
  // Crackstone guards the archive's north half and peers into the Rare Book Stacks (the stacks are a dead end reached
  // only through the north door, so he guards both by circling res_shelf and dipping through that door). ~48 m lap,
  // ~41 s incl. pauses. Overlaps the archive desk site (38, −6) (loop passes 2.2 m from it, never stops on it); the
  // stacks terminal (31, −24) is 9.5 m beyond his deepest point. Tightest clearances: C3→C4 1.30 m (res_shelf west
  // cap), C0/C1/C2 door crossings 1.38 m (res_n_w / res_n_e caps), C6→C7 1.50 m, C5→C6 1.52 m (res_shelf east cap).
  crackstone: {
    areaName: 'Archive Stacks',
    polygon: rect(24, -16.5, 41, 2.8), // centroid (32.5, −6.85)
    patrol: [
      { x: 31.2, z: -7 }, // C0 north aisle, in front of the stacks door
      { x: 31, z: -14.5 }, // C1 inside the Rare Book Stacks (looks down the aisles)
      { x: 30.8, z: -7 }, // C2 back through the door (crossing x ≈ 30.9, door centre 31)
      { x: 26.8, z: -3.9 }, // C3 gap between the pillar (26, −6) and res_shelf's west end
      { x: 26, z: -0.5 }, // C4 west lane, between pa_shelf_2 and res_shelf
      { x: 33, z: 0.8 }, // C5 middle aisle (res_shelf ↔ pa_shelf_1)
      { x: 39, z: -1 }, // C6 round res_shelf's east end
      { x: 34.5, z: -7 }, // C7 north aisle east (3.6 m from the archive desk)
    ],
    start: { x: 34.5, z: -7, yaw: faceToward(34.5, -7, 31.2, -7) }, // C7 facing west; 70 m from the pier
    leashM: 16, // gives up ~2 m inside the west door, at the lab benches, or by the stacks terminal
  },
};

// ===================================================================================================== Case 02
// The Crypt's Last Witness — rubble narrows the burial vault and the cage, two rock falls turn the Maintenance Tunnel
// into a zig-zag, coffins give low cover, and a winch inside the catacombs clears the collapsed east door.

const CW_WALLS: WallDef[] = [
  wall('cw_rubble_vault', -43.5, 8, -34.5, 8, 1.2, 2.2, 'rock'), // vault mouth narrowed to a 3.4 m passage at x −33.9..−30.5
  wall('cw_rubble_cage', -43.5, -26, -39, -26, 1.2, 2.2, 'rock'), // cage pocket entered through a 3.4 m gap
  wall('cw_tunnel_1', 26.5, -16, 31.5, -16, 1.2, 3, 'rock'), // tunnel squeeze 3.15 m (east side)
  wall('cw_tunnel_2', 30.6, -25, 35.5, -25, 1.2, 3, 'rock'), // tunnel squeeze 3.5 m (west side)
  // PASSAGE: rubble filling the catacombs' east door (x −18, z −26.5..−21.5). Winch on the inside.
  wall('cw_rubble_door', -18, -21.5, -18, -26.5, 1.2, 3.5, 'rock'),
];

const CW_COVER: CoverDef[] = [
  cover('cw_coffin_1', -40.5, 12, 0.9, 'low', 'tomb'),
  cover('cw_coffin_2', -33, 22.5, 0.9, 'low', 'tomb'),
  cover('cw_coffin_3', -36.5, -12.5, 0.9, 'low', 'tomb'), // just inside the catacomb door
  cover('cw_gate_fallen', -21, 20, 0.9, 'low', 'crate'), // the fallen crypt gate
  cover('cw_boiler', 35, 9.5, 1, 'high', 'pillar'), // broken lamp-room boiler
];

const CW_HIDING: HidingSpotDef[] = [
  hide('cw_hs_tunnel', 27.8, -29, 1, 1.5, 'alcove'), // tunnel dead end
  hide('cw_hs_catacomb', -41.8, -21.5, 1, 1.5, 'sarcophagus'), // open coffin in the catacombs
];

const CRYPT_LAST_WITNESS_WORLD: CaseWorldDef = {
  caseId: 'crypt_last_witness',
  theme: 'crypt',
  areas: [
    { id: 'a_gate', name: 'Collapsed Crypt', x: -24, z: 15, radiusM: 10 },
    { id: 'a_vault', name: 'Burial Vault', x: -36, z: 16, radiusM: 7 },
    { id: 'a_catacombs', name: 'Catacombs', x: -33, z: -24, radiusM: 10 },
    { id: 'a_tunnel', name: 'Maintenance Tunnel', x: 31, z: -22, radiusM: 9 },
    { id: 'a_lamp', name: 'Lamp Room', x: 32, z: 2, radiusM: 12 },
  ],
  clueSites: [
    {
      clueId: 'sabotaged_gate', searchS: 2.5, sites: [
        { id: 's_cw_sg_gate', areaId: 'a_gate', roomId: 'crypt', x: -26, z: 21.5, prior: 1, label: 'Gate mechanism', prop: 'workbench' },
      ],
    },
    {
      clueId: 'tunnel_access_record', searchS: 2.5, sites: [
        { id: 's_cw_ta_tunnel', areaId: 'a_tunnel', roomId: 'shortcut', x: 29.5, z: -20.5, prior: 0.55, label: 'Tunnel sign-in desk', prop: 'desk' },
        { id: 's_cw_ta_lamp', areaId: 'a_lamp', roomId: 'research_room', x: 38, z: -6, prior: 0.45, label: 'Lamp-room locker', prop: 'locker' },
      ],
    },
    {
      clueId: 'equipment_match', searchS: 2.5, sites: [
        { id: 's_cw_em_cage', areaId: 'a_catacombs', roomId: 'egg_chamber', x: -40, z: -31, prior: 0.6, label: 'By the cage', prop: 'crate' },
        { id: 's_cw_em_vault', areaId: 'a_vault', roomId: 'crypt', x: -32.5, z: 17.5, prior: 0.4, label: 'Coffin niche', prop: 'sarcophagus' },
      ],
    },
  ],
  eggSites: [
    { id: 'e_cw_vault', areaId: 'a_vault', roomId: 'crypt', x: -36.5, z: 15, prior: 0.5, label: 'Vault altar', prop: 'altar', traceText: 'Scraped dust leads toward the burial vault.' },
    { id: 'e_cw_catacomb', areaId: 'a_catacombs', roomId: 'egg_chamber', x: -28, z: -20, prior: 0.3, label: 'Catacomb nest', prop: 'nest', traceText: 'Damp straw trails down into the catacombs.' },
    { id: 'e_cw_gatehouse', areaId: 'a_gate', roomId: 'crypt', x: -22, z: 10, prior: 0.2, label: 'Gatehouse', prop: 'crate', traceText: 'Shell grit glitters by the collapsed gatehouse.' },
  ],
  traceAccuracy: 0.75,
  hydeSpawns: [
    { id: 'sp_cw_side_door', name: 'Crypt Side Door', zoneId: 'z_mid', x: -11, z: 4, yaw: faceToward(-11, 4, -13, 18), weight: 0.4 }, // P16
    { id: 'sp_cw_ravine', name: 'Ravine Pass', zoneId: 'z_terrace', x: -12, z: -16, yaw: faceToward(-12, -16, -12, -24), weight: 0.35 }, // P7
    { id: 'sp_cw_drain', name: 'Terrace Drain', zoneId: 'z_terrace', x: 19, z: -19.8, yaw: faceToward(19, -19.8, 2, -16), weight: 0.25 }, // on P13→P14
  ],
  zones: zones({
    z_lawn: 'Graveyard Lawn', z_crypt: 'Crypt Ruins', z_chamber: 'Catacombs', z_mid: 'Middle Path',
    z_east: 'Tunnel Wing', z_terrace: 'Greenhouse', z_court: 'Tower Yard',
  }),
  extraWalls: CW_WALLS,
  extraCover: CW_COVER,
  extraHiding: CW_HIDING,
  passage: {
    id: 'cw_passage_winch', leverX: -22, leverZ: -27, label: 'Crank the rubble winch', wallId: 'cw_rubble_door',
    text: 'The winch drags the rubble aside. The east door is open!',
  },
  examines: [
    { id: 'ex_cw_lantern', x: -20.5, z: 14, label: 'Examine the flickering lantern', text: 'A dropped lantern, still warm. Shell dust glitters on the glass.', givesTrace: true, prop: 'lantern' },
    { id: 'ex_cw_winch', x: 33.5, z: -20, label: 'Examine the cobwebbed machine', text: 'Cobwebs torn off an old tunnel winch. Nest straw is caught in the gears.', givesTrace: true, prop: 'machine' },
    { id: 'ex_cw_cobweb', x: -38, z: -3, label: 'Examine the torn cobwebs', text: 'Cobwebs ripped across the catacomb door. Someone hurried through tonight.', givesTrace: false, prop: 'cobweb' },
  ],
  hazards: [
    { kind: 'noisy_floor', id: 'hz_cw_rubble', name: 'Loose rubble', polygon: rect(-27, 0, -19, 8), loudnessAdd: 0.25, look: 'rubble' },
    { kind: 'noisy_floor', id: 'hz_cw_puddles', name: 'Tunnel puddles', polygon: rect(26.5, -24, 35, -17), loudnessAdd: 0.25, look: 'puddle' },
  ],
  // STRONGER presence underground: a long loop round pillar 2 in the crypt's lower hall, through the north door and
  // right round the catacombs' pillar ring (the nest egg site sits inside the ring, ~7 m from his path; the cage
  // pocket opens 4.6 m from C_SW). ~107 m lap, ~86 s incl. pauses. Stronger through data, still escapable: scans
  // every 20 s (± jitter) instead of 25, sight × 1.15 (fog 10.4 m, clear 16.1 m — still < the player's 20 m), leash 25.
  // Tightest clearances: C_NW2→D_out 1.31 m (crypt_egg_e cap), C_SW→C_W 1.43 m / C_SE→C_SW 1.44 m (catacomb
  // pillars), D_in→C_NW 1.46 m (cw_coffin_3) / 1.49 m (door cap). C_SE passes the winch lever (−22, −27) at 1.2 m.
  crackstone: {
    areaName: 'Crypt Catacombs',
    polygon: rect(-38.5, -30.5, -18.5, 6.5), // centroid (−28.5, −12)
    patrol: [
      { x: -26, z: 4.5 }, // H0 lower hall, east (on the loose rubble — he is deaf, so it never matters to him)
      { x: -33, z: 3 }, // H1 lower hall, west of pillar 2
      { x: -33, z: -3 }, // H2 between pillar 2 and sarcophagus 1
      { x: -36.5, z: -5.5 }, // D_in in front of the north door (x −36)
      { x: -34, z: -12.5 }, // C_NW catacombs, east of the coffin by the door
      { x: -21, z: -12.5 }, // C_NE north lane of the pillar ring
      { x: -20.7, z: -25.5 }, // C_SE east lane, by the rubble-filled east door
      { x: -33, z: -28.5 }, // C_SW south lane, 4.6 m from the cage-pocket gap
      { x: -35.5, z: -20 }, // C_W west lane of the pillar ring
      { x: -34, z: -12 }, // C_NW2 back by the door
      { x: -36.5, z: -5 }, // D_out through the north door again
      { x: -27.5, z: -5.5 }, // H3 lower hall, south of pillar 2
    ],
    start: { x: -26, z: 4.5, yaw: faceToward(-26, 4.5, -33, 3) }, // H0 facing west; 56 m from the pier
    leashM: 25, // reaches the burial-vault mouth and ~6 m out of the east door; never the south gate clue (33.6 m)
    scanEveryS: 20,
    sightRangeMult: 1.15,
  },
};

// ===================================================================================================== Case 03
// The Midnight Signal — a guard hut on the east lawn, server racks in the control room, a fence chicane in the guard
// post, and a fenced restricted yard east of the tower (checkpoint gate + lever, guard hut, equipment crates,
// searchlight). A second searchlight sweeps the west courtyard approach to the tower: take the east gate to avoid it.

const MS_WALLS: WallDef[] = [
  // East-lawn guard hut (security checkpoint): door on the west side, 3.4 m clear; 6.3 m+ from the patrol
  wall('ms_hut_n', 37, 20, 42.6, 20, 0.6, 3, 'stone'),
  wall('ms_hut_w', 37, 20, 37, 23.5, 0.6, 3, 'stone'),
  wall('ms_hut_s', 37, 27.5, 42.6, 27.5, 0.6, 3, 'stone'),
  // Guard Post Passage: patrol fence chicane (gap 4.1 m on the east side)
  wall('ms_post_fence', 26.5, -22, 31, -22, 0.3, 2.4, 'fence'),
  // Restricted yard fence along x 17 (corridor to the tower wall 3.35 m; north end 3.65 m from the cliff)
  wall('ms_fence_1', 17, -34, 17, -39.5, 0.3, 2.6, 'fence'),
  // PASSAGE: the checkpoint gate (3.7 m clear when open). Lever on the courtyard side, by the tower.
  wall('ms_gate', 17, -39.5, 17, -43.5, 0.3, 2.6, 'fence'),
  wall('ms_fence_2', 17, -43.5, 17, -54.5, 0.3, 2.6, 'fence'),
  // Yard guard hut (L): shade from the searchlight
  wall('ms_yhut_a', 35, -39, 39.5, -39, 0.6, 3, 'stone'),
  wall('ms_yhut_b', 35, -39, 35, -43, 0.6, 3, 'stone'),
];

const MS_COVER: CoverDef[] = [
  cover('ms_rack_1', 24, 0, 0.7, 'high', 'pillar'), // server rack
  cover('ms_rack_2', 36, 11, 0.7, 'high', 'pillar'), // server rack
  cover('ms_crate_a', 28.5, -17, 0.8, 'low', 'crate'),
  cover('ms_crate_b', 33.5, -30, 0.8, 'low', 'crate'),
  cover('ms_ycrate_1', 27, -47, 0.9, 'low', 'crate'), // equipment crates in the yard (searchlight shade)
  cover('ms_ycrate_2', 33, -53, 0.9, 'low', 'crate'),
  cover('ms_ycrate_3', 29, -42, 0.9, 'low', 'crate'),
  cover('ms_ccrate_1', -8, -46, 0.9, 'low', 'crate'), // west courtyard, under the tower searchlight (6.3 m off the patrol)
  cover('ms_ccrate_2', 0, -50, 0.9, 'low', 'crate'),
];

const MS_HIDING: HidingSpotDef[] = [
  hide('ms_hs_hut', 41.5, 21.5, 1, 1.5, 'wardrobe'), // guard-hut locker (wait here while the Hyde passes P2)
  hide('ms_hs_yhut', 37.2, -41.2, 1, 1.5, 'alcove'), // inside the yard hut's L
  hide('ms_hs_post', 34, -14.5, 1, 1.5, 'alcove'), // guard post, by the switch
];

const MIDNIGHT_SIGNAL_WORLD: CaseWorldDef = {
  caseId: 'midnight_signal',
  theme: 'signal',
  areas: [
    { id: 'a_control', name: 'Control Room', x: 32, z: 2, radiusM: 12 },
    { id: 'a_post', name: 'Guard Post Passage', x: 31, z: -22, radiusM: 9 },
    { id: 'a_yard', name: 'Restricted Yard', x: 28, z: -46, radiusM: 13 },
    { id: 'a_signal', name: 'West Signal Post', x: -22, z: -46, radiusM: 6 },
    { id: 'a_shed', name: 'Potting Shed', x: 3, z: -26, radiusM: 7 },
    { id: 'a_kennel', name: 'Old Kennel', x: -30, z: -21, radiusM: 10 },
  ],
  clueSites: [
    {
      clueId: 'falsified_patrol_log', searchS: 2.5, sites: [
        { id: 's_ms_pl_post', areaId: 'a_post', roomId: 'shortcut', x: 30, z: -27, prior: 0.55, label: 'Guard post desk', prop: 'desk' },
        { id: 's_ms_pl_booth', areaId: 'a_yard', roomId: 'courtyard', x: 20.5, z: -38, prior: 0.45, label: 'Checkpoint booth', prop: 'locker' },
      ],
    },
    {
      clueId: 'alarm_override', searchS: 2.5, sites: [
        { id: 's_ms_ao_console', areaId: 'a_control', roomId: 'research_room', x: 40, z: 8, prior: 1, label: 'Override console', prop: 'console' },
      ],
    },
    {
      clueId: 'watchtower_signal', searchS: 2.5, sites: [
        { id: 's_ms_ws_yard', areaId: 'a_yard', roomId: 'courtyard', x: 25, z: -51, prior: 0.6, label: 'Signal recorder', prop: 'console' },
        { id: 's_ms_ws_west', areaId: 'a_signal', roomId: 'courtyard', x: -22, z: -46, prior: 0.4, label: 'Relay recorder', prop: 'console' },
      ],
    },
  ],
  eggSites: [
    { id: 'e_ms_shed', areaId: 'a_shed', roomId: 'path', x: 3.5, z: -28, prior: 0.5, label: 'Potting shed', prop: 'planter', traceText: 'Soil tracks lead toward the potting shed.' },
    { id: 'e_ms_checkpoint', areaId: 'a_yard', roomId: 'courtyard', x: 37, z: -52, prior: 0.3, label: 'Yard crates', prop: 'crate', traceText: 'Crate marks lead into the restricted yard.' },
    { id: 'e_ms_kennel', areaId: 'a_kennel', roomId: 'egg_chamber', x: -28, z: -20, prior: 0.2, label: 'Kennel straw', prop: 'nest', traceText: 'Straw drifts toward the old kennel.' },
  ],
  traceAccuracy: 0.75,
  hydeSpawns: [
    { id: 'sp_ms_west_gate', name: 'West Courtyard Gate', zoneId: 'z_court', x: -10, z: -38, yaw: faceToward(-10, -38, -2, -42), weight: 0.45 }, // P9
    { id: 'sp_ms_greenhouse', name: 'Greenhouse Path', zoneId: 'z_terrace', x: 2, z: -16, yaw: faceToward(2, -16, -12, -14), weight: 0.35 }, // P14
    { id: 'sp_ms_control_lawn', name: 'Control Room Lawn', zoneId: 'z_east', x: 30, z: 22, yaw: faceToward(30, 22, 15, 14), weight: 0.2 }, // P2
  ],
  zones: zones({
    z_lawn: 'Pier Lawn', z_crypt: 'Old Crypt', z_chamber: 'Old Kennel', z_mid: 'Middle Path',
    z_east: 'Security Wing', z_terrace: 'Greenhouse', z_court: 'Watchtower',
  }),
  extraWalls: MS_WALLS,
  extraCover: MS_COVER,
  extraHiding: MS_HIDING,
  passage: {
    id: 'ms_passage_checkpoint', leverX: 15, leverZ: -43, label: 'Pull the checkpoint lever', wallId: 'ms_gate',
    text: 'The checkpoint gate rattles open. The yard is a step away.',
  },
  examines: [
    { id: 'ex_ms_radio', x: 25, z: 9, label: 'Examine the crackling radio', text: 'The radio crackles: "...egg moved... path clear..." Then only static.', givesTrace: true, prop: 'radio' },
    { id: 'ex_ms_prints', x: 21, z: -44, label: 'Examine the boot prints', text: 'Muddy boot prints cross the yard, with a scrape of nest straw.', givesTrace: true, prop: 'footprints' },
    { id: 'ex_ms_alarm', x: 35, z: 25.5, label: 'Examine the silenced alarm', text: 'The alarm bell is stuffed with a rag. Somebody wanted silence tonight.', givesTrace: false, prop: 'alarm' },
  ],
  hazards: [
    { kind: 'searchlight', id: 'hz_ms_yard_light', name: 'Yard searchlight', x: 30, z: -48, rangeM: 14, coneDeg: 24, periodS: 10, phase: 0, loudness: 0.75, cooldownS: 4 },
    { kind: 'searchlight', id: 'hz_ms_tower_light', name: 'Tower searchlight', x: -3, z: -49, rangeM: 13, coneDeg: 24, periodS: 12, phase: Math.PI, loudness: 0.75, cooldownS: 4 },
  ],
  // The fenced Restricted Yard behind the security fence: the Hyde owns the courtyard west of the fence, Crackstone
  // the yard east of it (the Hyde's loop never crosses x 17, so the two rarely overlap — rule R6 stays a fallback).
  // Loop round the L-shaped yard hut and the egg crates: ~59 m lap, ~46 s incl. pauses. Egg crates (37, −52) inside
  // the loop (≥ 3.7 m from his path); signal recorder (25, −51) 5.7 m off his north-west leg; checkpoint booth 11.6 m.
  // Lighter than Case 02: the open yard already has a searchlight, so sight × 0.9 and scans every 28 s.
  // Tightest clearances: Y1→Y2 1.55 m (ms_yhut_a east cap) / 1.65 m (cliff_e), Y3→Y4 1.64 m (ms_ycrate_2), 1.72 m
  // from the searchlight post (30, −48). ≥ 16.5 m from the tower rooms.
  crackstone: {
    areaName: 'Restricted Yard',
    polygon: rect(27, -58, 43, -34.8), // centroid (35, −46.4)
    patrol: [
      { x: 32, z: -36.8 }, // Y0 inside the Gomez gate (31, −34), south lane
      { x: 41.4, z: -36.8 }, // Y1 south-east pocket (between the yard hut and the south wall)
      { x: 41, z: -55.5 }, // Y2 north-east corner (east lane between hut and cliff, past the egg crates)
      { x: 29.5, z: -56 }, // Y3 north lane behind crate 2
      { x: 32.8, z: -44.5 }, // Y4 centre, east of the searchlight, west of the hut
    ],
    start: { x: 32, z: -36.8, yaw: faceToward(32, -36.8, 41.4, -36.8) }, // Y0 facing east (back to the yard's entrances)
    leashM: 17, // gives up 1.7 m before the checkpoint gate (18.7 m) / 3.4 m before the fence's north end (20.4 m)
    scanEveryS: 28,
    sightRangeMult: 0.9,
  },
};

// ===================================================================================================== registry

export const CASE_WORLDS: Record<CaseId, CaseWorldDef> = {
  poisoned_archive: POISONED_ARCHIVE_WORLD,
  crypt_last_witness: CRYPT_LAST_WITNESS_WORLD,
  midnight_signal: MIDNIGHT_SIGNAL_WORLD,
};

export function caseWorld(id: CaseId): CaseWorldDef {
  return CASE_WORLDS[id];
}

/** Every Hyde spawn of every case (tests / analytics convenience). */
export const ALL_HYDE_SPAWNS: readonly HydeSpawnDef[] = Object.values(CASE_WORLDS).flatMap((w) => w.hydeSpawns);
/** Every examinable / hazard of every case (tests convenience). */
export const ALL_EXAMINES: readonly ExamineDef[] = Object.values(CASE_WORLDS).flatMap((w) => w.examines);
export const ALL_HAZARDS: readonly HazardDef[] = Object.values(CASE_WORLDS).flatMap((w) => w.hazards);
