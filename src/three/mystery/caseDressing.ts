// Per-case set dressing. Purely decorative (no collision change): it keys off which clue ids the map carries, so the scene
// constructor needs no case parameter. Every piece is placed by a free-spot search that keeps clear of clue spots, the egg,
// hiding spots, the patrol loop, walls and cover, so nothing hides a clue or sits on a path.
import type { ClueId, MapDef, RoomDef, Vec2 } from '../../mystery/types.ts';
import { Bld } from './builders.ts';
import { BOX, CONE4, CONE6, CYL6, CYL8, ICO0, ICO1, PAL, distPointSeg } from './common.ts';

const NG = { gradient: 0, jitter: 0 } as const;

export type CaseTheme = 'archive' | 'crypt' | 'signal' | null;

/** Which case a map belongs to, derived from its clue ids (the id union is disjoint per case). */
export function caseThemeOf(map: MapDef): CaseTheme {
  const has = (id: ClueId): boolean => map.clues.some((c) => c.clueId === id);
  if (has('falsified_transfer') || has('botanical_residue') || has('access_ledger')) return 'archive';
  if (has('sabotaged_gate') || has('tunnel_access_record') || has('equipment_match')) return 'crypt';
  if (has('falsified_patrol_log') || has('alarm_override') || has('watchtower_signal')) return 'signal';
  return null;
}

class Placer {
  private readonly placed: Vec2[] = [];
  constructor(private readonly map: MapDef) {}

  /** true when a footprint of radius r at (x, z) overlaps nothing it should not */
  ok(x: number, z: number, r: number, clueR = 2.0): boolean {
    const m = this.map;
    if (x < m.bounds.minX + 1 || x > m.bounds.maxX - 1 || z < m.bounds.minZ + 1 || z > m.bounds.maxZ - 1) return false;
    for (const c of m.clues) if (Math.hypot(c.x - x, c.z - z) < clueR + r) return false;
    if (Math.hypot(m.eggSpawn.x - x, m.eggSpawn.z - z) < 2.0 + r) return false;
    if (Math.hypot(m.playerStart.x - x, m.playerStart.z - z) < 2.5 + r) return false;
    if (Math.hypot(m.tower.x - x, m.tower.z - z) < m.tower.radius + r) return false;
    for (const h of m.hidingSpots) if (Math.hypot(h.x - x, h.z - z) < h.radius + 1.0 + r) return false;
    for (const cv of m.cover) if (Math.hypot(cv.x - x, cv.z - z) < cv.radius + 0.3 + r) return false;
    for (const w of m.walls) if (distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) < w.thickness / 2 + 0.2 + r) return false;
    const p = m.patrol;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (distPointSeg(x, z, a.x, a.z, b.x, b.z) < 1.1 + r) return false;
    }
    for (const q of this.placed) if (Math.hypot(q.x - x, q.z - z) < 0.6 + r) return false;
    return true;
  }

  /** nearest free point to (x, z) within `reach` metres (spiral search), or null */
  find(x: number, z: number, r: number, reach = 3.5, clueR = 2.0): Vec2 | null {
    for (let d = 0; d <= reach; d += 0.5) {
      const n = d === 0 ? 1 : Math.ceil(d * 5);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (this.ok(px, pz, r, clueR)) { this.placed.push({ x: px, z: pz }); return { x: px, z: pz }; }
      }
    }
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ props
function stackedLedgers(b: Bld, x: number, z: number, yaw: number): void {
  const cols = ['#6b1e2a', '#2e4a6b', '#4a6b3a', '#6b5a2a'];
  for (let i = 0; i < 5; i++) b.lit.add(BOX, cols[i % 4], [x, 0.06 + i * 0.12, z], [0, yaw + (i % 2) * 0.25, 0], [0.5 - i * 0.03, 0.11, 0.36], { gradient: 0.1, jitter: 0.06 });
  b.lit.add(BOX, PAL.woodDark, [x, 0.02, z], [0, yaw, 0], [0.62, 0.04, 0.46], NG);
}

function archiveLamp(b: Bld, x: number, z: number): void {
  // banker's lamp on a small filing cabinet
  b.lit.add(BOX, '#33221a', [x, 0.45, z], [0, 0, 0], [0.7, 0.9, 0.5], { gradient: 0.3 });
  b.lit.add(BOX, '#5a3d2a', [x, 0.7, z - 0.255], [0, 0, 0], [0.62, 0.3, 0.02], NG);
  b.lit.add(CYL6, '#1b1d2c', [x, 0.97, z], [0, 0, 0], [0.04, 0.14, 0.04], NG);
  b.em.add(CYL8, '#7bffb0', [x, 1.12, z], [0, 0, 0], [0.14, 0.1, 0.14], NG);
  b.glows.push({ x, y: 1.15, z, size: 2.0, color: '#9affc8', alpha: 0.7, flicker: 0.1, fogFloor: 0.2 });
}

function vialRack(b: Bld, x: number, z: number): void {
  b.lit.add(BOX, PAL.wood, [x, 0.4, z], [0, 0, 0], [1.0, 0.07, 0.4], { gradient: 0.2 });
  for (const sx of [-1, 1]) b.lit.add(BOX, PAL.woodDark, [x + sx * 0.42, 0.2, z], [0, 0, 0], [0.07, 0.4, 0.34], { gradient: 0.1 });
  for (let i = 0; i < 5; i++) {
    const vx = x - 0.36 + i * 0.18;
    b.lit.add(CYL6, '#cfe0e8', [vx, 0.5, z], [0, 0, 0], [0.05, 0.14, 0.05], NG);
    b.em.add(CYL6, i % 2 ? '#c08bff' : '#8b5cf6', [vx, 0.49, z], [0, 0, 0], [0.04, 0.1, 0.04], NG);
  }
  b.glows.push({ x, y: 0.55, z, size: 2.4, color: '#a07cff', alpha: 0.75, flicker: 0.4, fogFloor: 0.2 });
}

function monitorDesk(b: Bld, x: number, z: number, yaw: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [bx, bz] = L(0, 0);
  b.lit.add(BOX, '#232842', [bx, 0.4, bz], [0, yaw, 0], [1.5, 0.8, 0.7], { gradient: 0.25 });
  for (let i = 0; i < 3; i++) {
    const [mx, mz] = L(-0.5 + i * 0.5, -0.1);
    b.lit.add(BOX, '#10152e', [mx, 1.05, mz], [0, yaw, 0], [0.42, 0.3, 0.05], NG);
    const [ex, ez] = L(-0.5 + i * 0.5, -0.13);
    b.em.add(BOX, i === 1 ? '#ff6a4a' : '#4fe6f2', [ex, 1.05, ez], [0, yaw, 0], [0.36, 0.24, 0.01], NG);
  }
  b.lit.add(BOX, '#10152e', [bx, 0.84, bz], [0, yaw, 0], [1.3, 0.04, 0.5], NG);
  b.glows.push({ x: bx, y: 1.1, z: bz, size: 3.2, color: '#4fe6f2', alpha: 0.7, flicker: 0.25, fogFloor: 0.15 });
}

function signalLampPost(b: Bld, x: number, z: number, h: number): void {
  b.lit.add(CYL8, PAL.iron, [x, 0.2, z], [0, 0, 0], [0.34, 0.4, 0.34], NG);
  b.lit.add(CYL6, PAL.iron, [x, h / 2, z], [0, 0, 0], [0.09, h, 0.09], { gradient: 0.1 });
  b.lit.add(CYL8, '#6a5a2a', [x, h + 0.25, z], [0, 0, 0], [0.34, 0.5, 0.34], { gradient: 0.2 });
  b.em.add(CYL8, '#ffd24a', [x, h + 0.25, z], [0, 0, 0], [0.3, 0.4, 0.3], NG);
  b.lit.add(CONE6, PAL.iron, [x, h + 0.7, z], [0, 0, 0], [0.4, 0.3, 0.4], NG);
  b.glows.push({ x, y: h + 0.25, z, size: 5, color: '#ffd24a', alpha: 0.95, flicker: 0.1, fogFloor: 0.45 });
}

function alarmLamp(b: Bld, x: number, z: number): void {
  b.lit.add(CYL6, PAL.iron, [x, 0.9, z], [0, 0, 0], [0.07, 1.8, 0.07], NG);
  b.lit.add(CYL8, '#2a2d44', [x, 0.1, z], [0, 0, 0], [0.3, 0.2, 0.3], NG);
  b.em.add(ICO1, '#ff4a4a', [x, 1.9, z], [0, 0, 0], [0.16, 0.2, 0.16], NG);
  b.glows.push({ x, y: 1.9, z, size: 3.0, color: '#ff4a4a', alpha: 0.75, flicker: 0.7, fogFloor: 0.2 });
}

function rubblePile(b: Bld, x: number, z: number, yaw: number): void {
  b.lit.add(ICO1, '#2c3260', [x, 0.2, z], [0, yaw, 0], [0.8, 0.35, 0.6], { gradient: 0.3, jitter: 0.08 });
  b.lit.add(ICO0, '#333a6c', [x + 0.5, 0.15, z + 0.2], [0.4, yaw, 0], [0.35, 0.25, 0.3], { gradient: 0.3, jitter: 0.06 });
  b.lit.add(ICO0, '#272c58', [x - 0.5, 0.12, z - 0.25], [0, yaw + 1, 0.3], [0.3, 0.22, 0.28], { gradient: 0.3, jitter: 0.06 });
  b.lit.add(BOX, '#3a3f58', [x + 0.1, 0.5, z - 0.15], [0.5, yaw, 0.7], [0.07, 0.9, 0.07], NG); // bent bar
  b.lit.add(BOX, '#3a3f58', [x - 0.15, 0.4, z + 0.15], [-0.3, yaw + 0.5, -0.9], [0.06, 0.7, 0.06], NG);
}

function standLantern(b: Bld, x: number, z: number, h: number, color: string = PAL.lantern, size = 2.6): void {
  b.lit.add(CYL6, PAL.iron, [x, h / 2, z], [0, 0, 0], [0.05, h, 0.05], NG);
  b.lit.add(CYL8, PAL.iron, [x, 0.04, z], [0, 0, 0], [0.18, 0.08, 0.18], NG);
  b.lit.add(CONE4, PAL.iron, [x, h + 0.26, z], [0, Math.PI / 4, 0], [0.24, 0.14, 0.24], NG);
  b.em.add(BOX, color, [x, h + 0.1, z], [0, 0, 0], [0.16, 0.22, 0.16], NG);
  b.glows.push({ x, y: h + 0.1, z, size, color, alpha: 0.9, flicker: 0.6, fogFloor: 0.3 });
}

function pottingBench(b: Bld, x: number, z: number, yaw: number): void {
  b.lit.add(BOX, PAL.wood, [x, 0.55, z], [0, yaw, 0], [1.2, 0.07, 0.5], { gradient: 0.2 });
  for (const sx of [-1, 1]) b.lit.add(BOX, PAL.woodDark, [x + sx * 0.5 * Math.cos(yaw), 0.27, z - sx * 0.5 * Math.sin(yaw)], [0, yaw, 0], [0.07, 0.54, 0.4], { gradient: 0.1 });
  for (let i = 0; i < 3; i++) {
    const lx = -0.35 + i * 0.35;
    b.lit.add(CYL6, '#8a4a2a', [x + lx * Math.cos(yaw), 0.67, z - lx * Math.sin(yaw)], [0, 0, 0], [0.1, 0.16, 0.1], NG);
    b.lit.add(CONE6, '#2f6b4a', [x + lx * Math.cos(yaw), 0.86, z - lx * Math.sin(yaw)], [0, i, 0], [0.12, 0.26, 0.12], NG);
  }
}

function toolRack(b: Bld, x: number, z: number, yaw: number): void {
  b.lit.add(BOX, PAL.woodDark, [x, 0.9, z], [0, yaw, 0], [1.2, 0.08, 0.08], NG);
  for (const sx of [-1, 1]) b.lit.add(BOX, PAL.woodDark, [x + sx * 0.55 * Math.cos(yaw), 0.45, z - sx * 0.55 * Math.sin(yaw)], [0, yaw, 0], [0.07, 0.9, 0.07], NG);
  for (let i = 0; i < 4; i++) {
    const lx = -0.4 + i * 0.27;
    b.lit.add(BOX, i % 2 ? '#8b8fa6' : '#7a5233', [x + lx * Math.cos(yaw), 0.5, z - lx * Math.sin(yaw)], [0, yaw, 0.04 * (i - 1.5)], [0.04, 0.8, 0.03], NG);
  }
}

/** open "door" of fallen gate plates and a counterweight stone, lying near the crypt entrance */
function fallenGate(b: Bld, x: number, z: number, yaw: number): void {
  for (let i = 0; i < 5; i++) b.lit.add(BOX, PAL.iron, [x + (i - 2) * 0.17 * Math.cos(yaw), 0.1 + (i % 2) * 0.04, z - (i - 2) * 0.17 * Math.sin(yaw)], [0.08, yaw, 1.45], [0.05, 1.4, 0.05], NG);
  b.lit.add(BOX, PAL.iron, [x, 0.16, z], [0.1, yaw, 0], [0.9, 0.05, 0.05], NG);
}

// ------------------------------------------------------------------------------------------------ per case
function roomOf(map: MapDef, id: string): RoomDef | undefined { return map.rooms.find((r) => r.id === id); }
function rect(room: RoomDef): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
function clueAt(map: MapDef, id: ClueId): Vec2 | undefined { return map.clues.find((c) => c.clueId === id); }

/** Adds per-case set dressing to `b`. `glowLow` trims the extra billboard glows on low graphics. */
export function buildCaseDressing(map: MapDef, b: Bld, low: boolean): void {
  const theme = caseThemeOf(map);
  if (!theme) return;
  const pl = new Placer(map);
  const egg = map.eggSpawn;

  // the egg always gets a little light of its own so it reads in the fog / sheds (the shrine landmark stays as set dressing)
  const eggRoom = map.rooms.find((r) => r.id !== 'path' && insideRect(rect(r), egg.x, egg.z))?.id;

  if (theme === 'archive') {
    const desk = clueAt(map, 'falsified_transfer');
    if (desk) {
      for (const [dx, dz, k] of [[3.0, 1.5, 0], [-3.2, -1.4, 1], [2.6, -3.2, 2]] as const) {
        const p = pl.find(desk.x + dx, desk.z + dz, 0.5, 2.5);
        if (!p) continue;
        if (k === 0) archiveLamp(b, p.x, p.z); else stackedLedgers(b, p.x, p.z, k);
      }
    }
    const shelf = clueAt(map, 'botanical_residue');
    if (shelf) {
      const p = pl.find(shelf.x + 0.5, shelf.z + 2.6, 0.7, 3);
      if (p) vialRack(b, p.x, p.z);
    }
    const ledger = clueAt(map, 'access_ledger');
    if (ledger) {
      const p = pl.find(ledger.x - 2.6, ledger.z - 0.5, 0.5, 3);
      if (p) stackedLedgers(b, p.x, p.z, 0.4);
      const q = pl.find(ledger.x + 2.6, ledger.z + 1.2, 0.4, 3);
      if (q) standLantern(b, q.x, q.z, 1.1, '#f5b04c', 2.2);
    }
  }

  if (theme === 'crypt') {
    const gate = clueAt(map, 'sabotaged_gate');
    if (gate) {
      const p = pl.find(gate.x + 2.6, gate.z - 1.5, 0.8, 3.5);
      if (p) rubblePile(b, p.x, p.z, 0.5);
      const q = pl.find(gate.x - 2.4, gate.z + 1.6, 0.6, 3.5);
      if (q) fallenGate(b, q.x, q.z, 0.3);
    }
    const alley = roomOf(map, 'shortcut');
    if (alley) {
      const r = rect(alley);
      const alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
      const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
      const n = Math.min(low ? 3 : 5, Math.max(2, Math.floor(len / 5)));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const side = i % 2 ? 1 : -1;
        const wx = alongX ? r.minX + len * t : (side < 0 ? r.minX : r.maxX) + -side * 0.9;
        const wz = alongX ? (side < 0 ? r.minZ : r.maxZ) + -side * 0.9 : r.minZ + len * t;
        const p = pl.find(wx, wz, 0.4, 1.6);
        if (p) standLantern(b, p.x, p.z, 1.5, PAL.lantern, 3.0);
      }
    }
    const tools = clueAt(map, 'equipment_match');
    if (tools) {
      const p = pl.find(tools.x + 2.4, tools.z + 0.6, 0.8, 3);
      if (p) toolRack(b, p.x, p.z, 0.2);
    }
  }

  if (theme === 'signal') {
    const hall = roomOf(map, 'research_room');
    const cons = clueAt(map, 'alarm_override');
    if (hall && cons) {
      const hr = rect(hall);
      // monitor banks near the console, kept inside the hall
      let k = 0;
      for (const [dx, dz] of [[-3.4, 0.2], [-3.0, 4.4], [-3.2, -4.2]] as const) {
        const x = Math.min(hr.maxX - 1.2, Math.max(hr.minX + 1.2, cons.x + dx)), z = Math.min(hr.maxZ - 1.2, Math.max(hr.minZ + 1.2, cons.z + dz));
        const p = pl.find(x, z, 0.9, 3);
        if (p) { monitorDesk(b, p.x, p.z, Math.PI / 2 + (k++ ? 0.1 : 0)); }
      }
    }
    const tower = clueAt(map, 'watchtower_signal');
    if (tower) {
      const p = pl.find(tower.x - 2.8, tower.z + 1.2, 0.5, 3);
      if (p) signalLampPost(b, p.x, p.z, 3.0);
    }
    const post = clueAt(map, 'falsified_patrol_log');
    if (post) {
      const p = pl.find(post.x - 2.4, post.z + 1.4, 0.4, 3);
      if (p) alarmLamp(b, p.x, p.z);
    }
  }

  // ---- the egg itself: always legible, whichever room it was moved to
  if (theme === 'signal' && eggRoom !== 'egg_chamber') {
    // greenhouse potting shed: small lantern + a potting bench just off the nest
    standLantern(b, egg.x + 1.4, egg.z + 0.9, 0.9, '#ffcf70', 3.0);
    const p = pl.find(egg.x - 1.2, egg.z - 3.0, 0.7, 2);
    if (p) pottingBench(b, p.x, p.z, 0);
  } else if (theme === 'crypt' && eggRoom !== 'egg_chamber') {
    // crypt burial vault is foggy: two tiny pale candles flanking the nest
    standLantern(b, egg.x + 1.5, egg.z - 0.9, 0.55, '#bfe8ff', 3.2);
    standLantern(b, egg.x - 1.5, egg.z + 0.9, 0.55, '#bfe8ff', 3.2);
  }
}

function insideRect(r: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}
