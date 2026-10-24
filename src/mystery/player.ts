// Player locomotion. WASD relative to yaw; crouch / walk / sprint speeds from tuning × PlayMods (× carry, × speed boost);
// linear acceleration; swept collision with wall sliding (never stuck, never through); one footstep noise per stance
// interval while moving (loudness = (stance + carry add) × footstepNoiseMult × wet × boost noise, clamped 0..1);
// impacts (sprinting into a wall while carrying); hidden state (crouched inside a hiding spot); room tracking.
// Noisy floors (case hazards, hazards.ts): walking / sprinting on one adds its loudnessAdd to each footstep's final
// loudness (crouching is unaffected); the first loud step after entering a floor emits `hazard_triggered`.
// Interaction (E) lives in interact.ts.
import type { SimTuning } from './config.ts';
import type { SimContext } from './context.ts';
import { eggImpact } from './egg.ts';
import { forward } from './geometry.ts';
import { noisyFloorAt } from './hazards.ts';
import { hearingRadius } from './noise.ts';
import type { HidingSpotDef, MapDef, PlayerState, RoomId, Stance } from './types.ts';

export interface PlayerMemory {
  vx: number;
  vz: number;
  stepTimer: number;
  lastImpactT: number;
  noises: { t: number; loudness: number }[]; // own emissions (recentNoise)
  floorId: string | null; // noisy floor already announced (hazard_triggered) since the player stepped onto it
}

export function createPlayer(map: MapDef, tuning: SimTuning): PlayerState {
  return {
    x: map.playerStart.x, z: map.playerStart.z, yaw: map.playerStart.yaw, pitch: 0,
    speed: 0, stance: 'idle', crouched: false,
    hp: tuning.player.maxHp, maxHp: tuning.player.maxHp, catches: 0,
    invulnerableUntil: -Infinity, hidden: false, roomId: null, interacting: null, cabinet: null,
  };
}

export function createPlayerMemory(): PlayerMemory {
  return { vx: 0, vz: 0, stepTimer: 0.25, lastImpactT: -Infinity, noises: [], floorId: null };
}

/** The crouch-in hiding spot containing (x, z) (cabinets are entered with E instead — cabinet.ts). */
export function hidingSpotAt(map: MapDef, x: number, z: number): HidingSpotDef | null {
  for (const s of map.hidingSpots) if (s.kind !== 'cabinet' && Math.hypot(s.x - x, s.z - z) <= s.radius) return s;
  return null;
}

/** Top speed for a stance with all active multipliers. */
export function stanceSpeed(ctx: SimContext, stance: Stance): number {
  const P = ctx.tuning.player;
  const m = ctx.mods;
  let v = stance === 'crouch' ? P.crouchSpeed : stance === 'sprint' ? P.sprintSpeed * m.sprintSpeedMult : stance === 'walk' ? P.walkSpeed : 0;
  v *= m.walkSpeedMult;
  if (ctx.egg.state === 'carried') v *= ctx.tuning.carry.speedMult;
  if (ctx.t < ctx.fx.speedBoostUntil) v *= ctx.fx.speedBoostMult;
  if (ctx.t < ctx.fx.cursedUntil) v *= ctx.fx.curseSlowMult; // a landed Crackstone curse (ENEMY_CONTRACT R7)
  return v;
}

/** Footstep loudness for a stance at the player's position right now (0..1). */
export function footstepLoudness(ctx: SimContext, stance: Stance): number {
  const N = ctx.tuning.noise;
  let l = stance === 'crouch' ? N.crouch : stance === 'sprint' ? N.sprint : stance === 'walk' ? N.walk : 0;
  if (l <= 0) return 0;
  if (ctx.egg.state === 'carried') l += ctx.tuning.carry.footstepLoudnessAdd;
  l *= ctx.mods.footstepNoiseMult;
  if (ctx.roomAt(ctx.player.x, ctx.player.z)?.wet) l *= ctx.tuning.player.wetNoiseMult;
  if (ctx.t < ctx.fx.speedBoostUntil) l *= ctx.fx.speedBoostNoiseMult;
  if (stance === 'walk' || stance === 'sprint') {
    const floor = noisyFloorAt(ctx.map.world?.hazards, ctx.player.x, ctx.player.z);
    if (floor) l += floor.loudnessAdd;
  }
  return Math.max(0, Math.min(1, l));
}

/** Hearing radius (m, un-occluded) of the player's footsteps in the current stance (0 when standing still). */
export function stanceNoiseRadius(ctx: SimContext, stance: Stance = ctx.player.stance): number {
  return hearingRadius(footstepLoudness(ctx, stance), ctx.tuning.noise.knots);
}

export interface MoveInput { moveX: number; moveZ: number; sprint: boolean; crouch: boolean }

/** `announceHazards` false (tutorial): noisy floors still add loudness but emit no `hazard_triggered`. */
export function stepPlayer(ctx: SimContext, mem: PlayerMemory, input: MoveInput, dt: number, announceHazards = true): void {
  const p = ctx.player;
  const P = ctx.tuning.player;
  let mx = clamp(input.moveX, -1, 1);
  let mz = clamp(input.moveZ, -1, 1);
  const mag = Math.hypot(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }
  const moving = mag > 0.05;
  p.crouched = input.crouch;
  const stance: Stance = p.crouched ? 'crouch' : !moving ? 'idle' : input.sprint ? 'sprint' : 'walk';
  if (stance !== p.stance) {
    p.stance = stance;
    ctx.emit({ type: 'stance', stance });
  }
  // desired velocity (forward = (−sin yaw, −cos yaw), right = (cos yaw, −sin yaw))
  const f = forward(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const top = moving ? stanceSpeed(ctx, stance === 'crouch' ? 'crouch' : stance) : 0;
  const tx = (f.x * mz + rx * mx) * top;
  const tz = (f.z * mz + rz * mx) * top;
  const ex = tx - mem.vx;
  const ez = tz - mem.vz;
  const e = Math.hypot(ex, ez);
  const maxDv = P.accelMps2 * dt;
  if (e <= maxDv) {
    mem.vx = tx;
    mem.vz = tz;
  } else {
    mem.vx += (ex / e) * maxDv;
    mem.vz += (ez / e) * maxDv;
  }
  const res = ctx.world.move(p.x, p.z, mem.vx * dt, mem.vz * dt, P.radius);
  const travelled = Math.hypot(res.x - p.x, res.z - p.z);
  // impacts + sliding: remove the into-wall velocity component for each contact normal
  let impact = 0;
  for (const c of res.contacts) {
    const vn = mem.vx * c.nx + mem.vz * c.nz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      mem.vx -= vn * c.nx;
      mem.vz -= vn * c.nz;
    }
  }
  p.x = res.x;
  p.z = res.z;
  p.speed = travelled / dt;
  if (impact >= ctx.tuning.egg.impactSpeed && ctx.t - mem.lastImpactT > ctx.tuning.egg.impactCooldownS) {
    mem.lastImpactT = ctx.t;
    eggImpact(ctx);
  }
  // footsteps: one per stance interval while actually moving (first step lands half an interval after starting)
  if (stance !== 'idle' && p.speed > 0.25) {
    const F = ctx.tuning.noise.footstepIntervalS;
    const interval = stance === 'crouch' ? F.crouch : stance === 'sprint' ? F.sprint : F.walk;
    mem.stepTimer += dt;
    if (mem.stepTimer >= interval) {
      mem.stepTimer -= interval;
      if (mem.stepTimer > interval) mem.stepTimer = 0;
      const loud = footstepLoudness(ctx, stance);
      if (stance === 'walk' || stance === 'sprint') {
        const floor = noisyFloorAt(ctx.map.world?.hazards, p.x, p.z);
        if (floor && announceHazards && mem.floorId !== floor.id) {
          mem.floorId = floor.id;
          ctx.emit({ type: 'hazard_triggered', hazardId: floor.id });
        }
      }
      if (loud > 0) ctx.noise('footstep', p.x, p.z, loud);
    }
  } else {
    mem.stepTimer = 0.25; // the first step after standing still lands a quarter second early
  }
  if (mem.floorId !== null && noisyFloorAt(ctx.map.world?.hazards, p.x, p.z)?.id !== mem.floorId) mem.floorId = null;
  // hidden + room
  p.hidden = p.crouched && hidingSpotAt(ctx.map, p.x, p.z) !== null;
  const room = ctx.roomAt(p.x, p.z);
  const roomId: RoomId | null = room ? room.id : null;
  if (roomId !== p.roomId) {
    p.roomId = roomId;
    if (roomId) ctx.emit({ type: 'room_enter', roomId });
  }
  if (ctx.egg.state === 'carried') {
    ctx.egg.x = p.x;
    ctx.egg.z = p.z;
  }
}

export function recordOwnNoise(mem: PlayerMemory, t: number, loudness: number, windowS: number): void {
  mem.noises.push({ t, loudness });
  while (mem.noises.length && mem.noises[0].t < t - windowS) mem.noises.shift();
}

export function recentNoise(mem: PlayerMemory, t: number, windowS: number): number {
  let m = 0;
  for (const n of mem.noises) if (n.t >= t - windowS && n.loudness > m) m = n.loudness;
  return m;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
