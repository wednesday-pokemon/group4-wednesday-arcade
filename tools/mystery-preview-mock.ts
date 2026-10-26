// Staging data for the Mystery preview harness: a rich CaseWorldDef per case (sites, examines, lever + passage wall, hazards, extra walls /
// cover) so the renderer can be developed and screenshot before / independently of the designer's src/mystery/data/caseWorlds.ts.
// The harness only applies this when the real world is still the one-site stub (or with ?mock=1); ?mock=0 always uses the real data.
import type { CaseId, CaseWorldDef, ClueId, CoverDef, MapDef, SiteDef, Vec2, WallDef } from '../src/mystery/types.ts';

const v = (x: number, z: number): Vec2 => ({ x, z });
const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [v(minX, minZ), v(minX, maxZ), v(maxX, maxZ), v(maxX, minZ)];
const w = (id: string, ax: number, az: number, bx: number, bz: number, t: number, h: number, kind: WallDef['kind']): WallDef => ({ id, a: v(ax, az), b: v(bx, bz), thickness: t, height: h, kind });
const cov = (id: string, x: number, z: number, r: number, height: CoverDef['height'], kind: CoverDef['kind']): CoverDef => ({ id, x, z, radius: r, height, kind });
const site = (id: string, areaId: string, roomId: SiteDef['roomId'], x: number, z: number, prior: number, label: string, prop: SiteDef['prop']): SiteDef => ({ id, areaId, roomId, x, z, prior, label, prop });
const egg = (id: string, areaId: string, roomId: SiteDef['roomId'], x: number, z: number, prior: number, label: string, prop: SiteDef['prop']): SiteDef & { traceText: string } => ({ ...site(id, areaId, roomId, x, z, prior, label, prop), traceText: `Marks lead toward the ${label.toLowerCase()}.` });

const ZONES = [
  { id: 'z_south', name: 'Lawn and Pier', polygon: rect(-45, 26, 45, 60) },
  { id: 'z_crypt', name: 'Crypt', polygon: rect(-45, -8, -18, 26) },
  { id: 'z_egg', name: 'Egg Chamber', polygon: rect(-45, -34, -18, -8) },
  { id: 'z_mid', name: 'Middle Path', polygon: rect(-18, -10, 20, 26) },
  { id: 'z_east', name: 'East Halls', polygon: rect(20, -34, 45, 26) },
  { id: 'z_terrace', name: 'Greenhouse Terrace', polygon: rect(-18, -34, 20, -10) },
  { id: 'z_court', name: 'Tower Courtyard', polygon: rect(-45, -60, 45, -34) },
];
const SPAWNS = [{ id: 'sp_court', name: 'Tower Courtyard', zoneId: 'z_court', x: -2, z: -42, yaw: -Math.PI / 2, weight: 1 }];
const base = { traceAccuracy: 0.75, zones: ZONES, hydeSpawns: SPAWNS, extraHiding: [] };

export const MOCK_WORLDS: Record<CaseId, CaseWorldDef> = {
  poisoned_archive: {
    ...base, caseId: 'poisoned_archive', theme: 'archive',
    areas: [
      { id: 'a_archive', name: 'Research Archive', x: 32, z: 2, radiusM: 10 },
      { id: 'a_greenhouse', name: 'Greenhouse Annex', x: 2, z: -24, radiusM: 9 },
      { id: 'a_crypt', name: 'Records Crypt', x: -26, z: 14, radiusM: 9 },
      { id: 'a_egg', name: 'Egg Chamber', x: -30, z: -20, radiusM: 9 },
    ],
    clueSites: [
      { clueId: 'falsified_transfer', searchS: 2.5, sites: [site('s_ft_desk', 'a_archive', 'research_room', 38, -6, 0.6, 'Archive desk', 'desk'), site('s_ft_cab', 'a_archive', 'research_room', 41.5, 10, 0.4, 'Research cabinet', 'cabinet')] },
      { clueId: 'botanical_residue', searchS: 3, sites: [site('s_br_shelf', 'a_greenhouse', 'path', -5, -26, 0.5, 'Inventory shelf', 'shelf'), site('s_br_plant', 'a_greenhouse', 'path', 9, -17, 0.5, 'Potting bench', 'planter')] },
      { clueId: 'access_ledger', searchS: 2.5, sites: [site('s_al_desk', 'a_crypt', 'crypt', -22, 21, 0.5, 'Door ledger', 'desk'), site('s_al_cab', 'a_crypt', 'crypt', -38, 12, 0.5, 'Records cabinet', 'cabinet')] },
    ],
    eggSites: [egg('e_chamber', 'a_egg', 'egg_chamber', -28, -20, 0.5, 'Egg shrine', 'nest'), egg('e_shed', 'a_greenhouse', 'path', -11, -28, 0.3, 'Potting shed', 'planter'), egg('e_vault', 'a_crypt', 'crypt', -40, 5, 0.2, 'Burial vault', 'sarcophagus')],
    extraWalls: [
      w('ex_shelf_a', 36, -8.2, 43, -8.2, 0.7, 2.4, 'stone'), w('ex_shelf_b', 40, 12, 43, 12, 0.7, 2.4, 'stone'), w('ex_shelf_c', 22.4, -4, 22.4, 1.5, 0.7, 2.4, 'stone'),
      w('ex_bench_a', -10, -16, -5, -16, 0.7, 0.9, 'stone'), w('ex_bench_b', 13, -14, 17, -14, 0.7, 0.9, 'stone'),
      w('ex_shelf_pass', 23, -26, 23, -19, 0.7, 2.4, 'stone'),
    ],
    extraCover: [cov('ex_crate_1', 28, 12, 0.8, 'low', 'crate'), cov('ex_barrel_1', -6, -20.5, 0.6, 'low', 'barrel'), cov('ex_barrel_2', 41, -2, 0.6, 'low', 'barrel')],
    passage: { id: 'p_archive', leverX: 18.5, leverZ: -22, label: 'Pull the lever', wallId: 'ex_shelf_pass', text: 'A shelf swings aside.' },
    examines: [
      { id: 'x_vial', x: 25, z: -4, label: 'Examine the cracked vial', text: 'Violet residue. Someone handled it in a hurry.', givesTrace: true, prop: 'vial' },
      { id: 'x_lab', x: -6, z: -13.5, label: 'Examine the broken glass', text: 'Smashed equipment. The poison was mixed here.', givesTrace: true, prop: 'lab' },
      { id: 'x_vines', x: -16, z: 19, label: 'Examine the vines', text: 'These vines were cut recently.', givesTrace: false, prop: 'vines' },
    ],
    hazards: [
      { kind: 'noisy_floor', id: 'h_glass', name: 'Broken glass', polygon: rect(23, 9, 28, 13), loudnessAdd: 0.3, look: 'glass' },
      { kind: 'noisy_floor', id: 'h_boards', name: 'Loose boards', polygon: rect(10, 4, 14, 9), loudnessAdd: 0.25, look: 'boards' },
    ],
  },
  crypt_last_witness: {
    ...base, caseId: 'crypt_last_witness', theme: 'crypt',
    areas: [
      { id: 'a_gate', name: 'Collapsed Crypt', x: -26, z: 14, radiusM: 9 },
      { id: 'a_tunnel', name: 'Maintenance Tunnel', x: 31, z: -22, radiusM: 7 },
      { id: 'a_cage', name: 'Egg Chamber', x: -34, z: -24, radiusM: 8 },
      { id: 'a_vault', name: 'Burial Vault', x: -38, z: 12, radiusM: 7 },
    ],
    clueSites: [
      { clueId: 'sabotaged_gate', searchS: 2.5, sites: [site('s_sg_gate', 'a_gate', 'crypt', -22, 21, 0.6, 'Gate mechanism', 'workbench'), site('s_sg_crate', 'a_gate', 'crypt', -26, 9, 0.4, 'Tool crate', 'crate')] },
      { clueId: 'tunnel_access_record', searchS: 2.5, sites: [site('s_ta_desk', 'a_tunnel', 'shortcut', 31, -22, 0.5, 'Lamp-room desk', 'desk'), site('s_ta_lock', 'a_tunnel', 'shortcut', 28.5, -15, 0.5, 'Maintenance locker', 'locker')] },
      { clueId: 'equipment_match', searchS: 3, sites: [site('s_em_crate', 'a_cage', 'egg_chamber', -40, -30, 0.5, 'Tool roll', 'crate'), site('s_em_bench', 'a_cage', 'egg_chamber', -40, -19, 0.5, 'Workbench', 'workbench')] },
    ],
    eggSites: [egg('e_vault', 'a_vault', 'crypt', -38, 18, 0.5, 'Burial vault', 'sarcophagus'), egg('e_altar', 'a_cage', 'egg_chamber', -28, -28, 0.3, 'Old altar', 'altar'), egg('e_tunnel', 'a_tunnel', 'shortcut', 31.5, -29, 0.2, 'Tunnel nest', 'nest')],
    extraWalls: [
      w('ex_rubble_a', -42, 12.5, -35, 12.5, 1.4, 2.2, 'ruin'), w('ex_rubble_b', -22, -4, -19, -4, 1.4, 2, 'rock'), w('ex_tunnel_a', 27.5, -17, 27.5, -12, 0.9, 2.8, 'stone'),
      w('ex_tunnel_b', 34.5, -26, 34.5, -19, 0.9, 2.8, 'stone'), w('ex_rubble_pass', 27, -27, 31, -27, 1.4, 2.2, 'ruin'),
    ],
    extraCover: [cov('ex_pillar_1', -34, 7, 0.7, 'high', 'pillar'), cov('ex_crate_1', -20, 18, 0.8, 'low', 'crate')],
    passage: { id: 'p_crypt', leverX: 33, leverZ: -31, label: 'Pull the rusted lever', wallId: 'ex_rubble_pass', text: 'Rubble grinds aside.' },
    examines: [
      { id: 'x_machine', x: -27, z: 4, label: 'Examine the broken machine', text: 'Sheared bolts. This was sabotaged.', givesTrace: true, prop: 'machine' },
      { id: 'x_cobweb', x: -40, z: 24, label: 'Examine the cobweb', text: 'Untouched for years. Nobody came this way.', givesTrace: false, prop: 'cobweb' },
      { id: 'x_lantern', x: 31, z: -12.5, label: 'Examine the lantern', text: 'Still warm. Someone was here today.', givesTrace: true, prop: 'lantern' },
    ],
    hazards: [
      { kind: 'noisy_floor', id: 'h_rubble', name: 'Rubble', polygon: rect(-28, 17, -24, 22), loudnessAdd: 0.3, look: 'rubble' },
      { kind: 'noisy_floor', id: 'h_puddle', name: 'Puddles', polygon: rect(-34, -20, -29, -15), loudnessAdd: 0.25, look: 'puddle' },
    ],
  },
  midnight_signal: {
    ...base, caseId: 'midnight_signal', theme: 'signal',
    areas: [
      { id: 'a_post', name: 'Guard Post Passage', x: 31, z: -24, radiusM: 7 },
      { id: 'a_control', name: 'Security Control Room', x: 34, z: 2, radiusM: 10 },
      { id: 'a_yard', name: 'Watchtower Yard', x: 20, z: -46, radiusM: 9 },
      { id: 'a_shed', name: 'Potting Shed', x: 4, z: -25, radiusM: 7 },
    ],
    clueSites: [
      { clueId: 'falsified_patrol_log', searchS: 2.5, sites: [site('s_pl_post', 'a_post', 'shortcut', 30, -28, 0.5, 'Guard post', 'desk'), site('s_pl_lock', 'a_post', 'shortcut', 28.5, -15, 0.5, 'Guard locker', 'locker')] },
      { clueId: 'alarm_override', searchS: 2.5, sites: [site('s_ao_console', 'a_control', 'research_room', 41, 9, 0.5, 'Override console', 'console'), site('s_ao_cab', 'a_control', 'research_room', 40, -6.5, 0.5, 'Panel cabinet', 'cabinet')] },
      { clueId: 'watchtower_signal', searchS: 3, sites: [site('s_ws_rec', 'a_yard', 'courtyard', 22, -41, 0.5, 'Signal recorder', 'console'), site('s_ws_crate', 'a_yard', 'courtyard', 14, -56, 0.5, 'Equipment crate', 'crate')] },
    ],
    eggSites: [egg('e_shed', 'a_shed', 'path', 5, -27, 0.5, 'Potting shed', 'planter'), egg('e_nest', 'a_post', 'shortcut', 31, -30, 0.3, 'Guard-post nest', 'nest'), egg('e_yard', 'a_yard', 'courtyard', -4, -56, 0.2, 'Yard crate', 'crate')],
    extraWalls: [
      w('ex_fence_a', 24, -44, 34, -44, 0.35, 2.2, 'fence'), w('ex_fence_b', 24, -52, 34, -52, 0.35, 2.2, 'fence'), w('ex_barrier_a', 16, -38, 22, -38, 0.7, 1.1, 'stone'),
      w('ex_hut_a', 36, -50, 41, -50, 0.8, 2.6, 'stone'), w('ex_fence_pass', 14, -46, 14, -41, 0.35, 2.2, 'fence'),
    ],
    extraCover: [cov('ex_crate_1', 40, -42, 0.8, 'low', 'crate'), cov('ex_barrel_1', 6, -40, 0.6, 'low', 'barrel'), cov('ex_crate_2', 28, 12, 0.8, 'high', 'crate')],
    passage: { id: 'p_signal', leverX: 12, leverZ: -44, label: 'Throw the gate switch', wallId: 'ex_fence_pass', text: 'The patrol gate unlocks.' },
    examines: [
      { id: 'x_radio', x: 36, z: 11, label: 'Examine the radio', text: 'Tuned to the tower frequency.', givesTrace: true, prop: 'radio' },
      { id: 'x_alarm', x: 20, z: -39, label: 'Examine the alarm', text: 'The alarm was disabled by hand.', givesTrace: false, prop: 'alarm' },
      { id: 'x_map', x: 28, z: -32, label: 'Examine the patrol map', text: 'A route marked in red. One stretch is missing.', givesTrace: true, prop: 'map' },
    ],
    hazards: [
      { kind: 'searchlight', id: 'h_sl_1', name: 'Searchlight', x: 29, z: -48, rangeM: 13, coneDeg: 38, periodS: 9, phase: 0.6, loudness: 0.8, cooldownS: 4 },
      { kind: 'searchlight', id: 'h_sl_2', name: 'Searchlight', x: 6, z: -38.5, rangeM: 11, coneDeg: 34, periodS: 12, phase: 3.1, loudness: 0.8, cooldownS: 4 },
    ],
  },
};

/** Applies the mock world to a freshly built island map (walls / cover / sites / session layout = each group's most likely site). */
export function applyMockWorld(map: MapDef, caseId: CaseId, pick: 'first' | 'second' = 'first'): void {
  const world = MOCK_WORLDS[caseId];
  map.world = world;
  map.walls.push(...world.extraWalls.map((x) => ({ ...x, a: { ...x.a }, b: { ...x.b } })));
  map.cover.push(...world.extraCover.map((c) => ({ ...c })));
  const idx = pick === 'first' ? 0 : 1;
  map.clues = world.clueSites.map((g) => {
    const s = g.sites[Math.min(idx, g.sites.length - 1)];
    return { clueId: g.clueId as ClueId, roomId: s.roomId, x: s.x, z: s.z, searchS: g.searchS };
  });
  const e = world.eggSites[Math.min(idx, world.eggSites.length - 1)];
  map.eggSpawn = { x: e.x, z: e.z };
}

/** Moves the map's hidden truth (clues + egg) to each group's `pick` site of the map's CURRENT world (real or mock). */
export function applyLayout(map: MapDef, pick: 'first' | 'second'): void {
  const world = map.world;
  if (!world) return;
  const idx = pick === 'first' ? 0 : 1;
  map.clues = world.clueSites.map((g) => {
    const s = g.sites[Math.min(idx, g.sites.length - 1)];
    return { clueId: g.clueId as ClueId, roomId: s.roomId, x: s.x, z: s.z, searchS: g.searchS };
  });
  const e = world.eggSites[Math.min(idx, world.eggSites.length - 1)];
  map.eggSpawn = { x: e.x, z: e.z };
}

// ------------------------------------------------------------------------------------------------ compact play area (final)
// Staging of the FINAL compact maps before / independently of the designer's playArea data: a ~60 x 66 m rectangle around Iago Tower with boundary
// walls styled per case, four cabinets, a Slurp haunt, and the old island's things beyond the fence removed. Only applied when the real world has
// no playArea (or with ?mock=1).
const PLAY_RECT: Record<CaseId, { minX: number; maxX: number; minZ: number; maxZ: number }> = {
  poisoned_archive: { minX: -6, maxX: 54, minZ: -62, maxZ: 6 },
  crypt_last_witness: { minX: -46, maxX: 16, minZ: -62, maxZ: 10 },
  midnight_signal: { minX: -4, maxX: 58, minZ: -62, maxZ: 4 },
};

export function applyMockPlayArea(map: MapDef, caseId: CaseId): void {
  const r = PLAY_RECT[caseId];
  const world = map.world!;
  const inside = (x: number, z: number, pad = 0): boolean => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
  const theme = world.theme;
  map.bounds = { ...r };
  const cx = (r.minX + r.maxX) / 2;
  const st = ({ poisoned_archive: [6, -2], crypt_last_witness: [-12, 4], midnight_signal: [24, -2] } as Record<CaseId, [number, number]>)[caseId];
  map.playerStart = { x: st[0], z: st[1], yaw: 0 };
  // boundary walls
  const kind: WallDef['kind'] = theme === 'archive' ? 'hedge' : theme === 'crypt' ? 'ruin' : 'fence';
  const word = theme === 'archive' ? 'hedge' : theme === 'crypt' ? 'rubble' : 'fence';
  const t = theme === 'archive' ? 1.4 : theme === 'crypt' ? 1.6 : 0.35;
  const h = theme === 'signal' ? 2.4 : 2.6;
  const bw: WallDef[] = [
    w(`pa_bound_${word}_n`, r.minX, r.minZ, r.maxX, r.minZ, t, h, kind), w(`pa_bound_${word}_s`, r.minX, r.maxZ, r.maxX, r.maxZ, t, h, kind),
    w(`pa_bound_${word}_w`, r.minX, r.minZ, r.minX, r.maxZ, t, h, kind), w(`pa_bound_${word}_e`, r.maxX, r.minZ, r.maxX, r.maxZ, t, h, kind),
  ];
  map.walls = map.walls.filter((q) => inside(q.a.x, q.a.z, 1) && inside(q.b.x, q.b.z, 1)).concat(bw);
  map.cover = map.cover.filter((c) => inside(c.x, c.z));
  map.hidingSpots = map.hidingSpots.filter((q) => inside(q.x, q.z) && q.kind !== 'cabinet');
  map.landmarks = map.landmarks.filter((l) => inside(l.x, l.z, 4) || l.kind === 'iago_tower');
  // four cabinets, doors facing the middle of the area
  const spots: [string, number, number][] = [
    ['cab_a', r.minX + 5, r.maxZ - 16], ['cab_b', r.maxX - 5, r.maxZ - 22], ['cab_c', r.minX + 6, r.minZ + 22], ['cab_d', r.maxX - 6, r.minZ + 16],
  ];
  for (const [id, x, z] of spots) {
    const toward = Math.atan2(-(cx - x), -(((r.minZ + r.maxZ) / 2) - z));
    map.hidingSpots.push({ id, x, z, radius: 0.7, revealM: 2, kind: 'cabinet', doorYaw: toward });
  }
  // sites: two per clue, one egg trio, all inside
  const pos = [[cx - 14, r.maxZ - 26], [cx + 14, r.maxZ - 30], [cx - 12, r.minZ + 28], [cx + 12, r.minZ + 24], [cx - 4, (r.minZ + r.maxZ) / 2], [cx + 6, (r.minZ + r.maxZ) / 2 + 6]];
  const props: SiteDef['prop'][] = theme === 'archive' ? ['desk', 'cabinet', 'shelf', 'planter', 'desk', 'cabinet'] : theme === 'crypt' ? ['workbench', 'crate', 'locker', 'sarcophagus', 'crate', 'workbench'] : ['desk', 'locker', 'console', 'crate', 'console', 'desk'];
  const roomOf = (x: number, z: number): SiteDef['roomId'] => (map.rooms.find((q) => q.id !== 'path' && q.polygon.length && pointIn(q.polygon, x, z))?.id ?? 'path');
  world.clueSites.forEach((g, gi) => {
    g.sites = [0, 1].map((k) => {
      const [x, z] = pos[gi * 2 + k];
      return site(`s_${g.clueId}_${k}`, world.areas[0].id, roomOf(x, z), x, z, 0.5, `Site ${gi * 2 + k}`, props[gi * 2 + k]);
    });
  });
  world.eggSites = [0, 1, 2].map((k) => {
    const [x, z] = pos[(k + 2) % 6];
    return egg(`e_${k}`, world.areas[0].id, roomOf(x + 1.5, z + 1.5), x + 1.5, z + 1.5, k === 0 ? 0.5 : k === 1 ? 0.3 : 0.2, `Nest ${k}`, 'nest');
  });
  world.examines = world.examines.filter((q) => inside(q.x, q.z));
  world.hazards = world.hazards.filter((q) => (q.kind === 'noisy_floor' ? q.polygon.every((p) => inside(p.x, p.z)) : inside(q.x, q.z)));
  world.extraWalls = world.extraWalls.filter((q) => inside(q.a.x, q.a.z) && inside(q.b.x, q.b.z)).concat(bw);
  world.extraCover = world.extraCover.filter((c) => inside(c.x, c.z));
  if (world.passage && !map.walls.some((q) => q.id === world.passage!.wallId)) world.passage = null;
  world.playArea = { bounds: { ...r }, playerStart: map.playerStart, hydePatrol: [], safeReleasePoints: [], practicePoint: { x: st[0], z: st[1] - 4 } };
  world.slurp = { areaName: 'The grounds', wander: [{ x: cx - 10, z: (r.minZ + r.maxZ) / 2 }, { x: cx + 10, z: (r.minZ + r.maxZ) / 2 + 8 }], leashM: 30 };
  map.clues = world.clueSites.map((g) => ({ clueId: g.clueId as ClueId, roomId: g.sites[0].roomId, x: g.sites[0].x, z: g.sites[0].z, searchS: g.searchS }));
  map.eggSpawn = { x: world.eggSites[0].x, z: world.eggSites[0].z };
  map.tower = { x: 8, z: -51.5, radius: 3 };
  map.patrol = [v(cx - 15, r.maxZ - 12), v(cx + 15, r.maxZ - 12), v(cx + 15, r.minZ + 14), v(cx - 15, r.minZ + 14)];
}

function pointIn(poly: Vec2[], x: number, z: number): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins;
  }
  return ins;
}
