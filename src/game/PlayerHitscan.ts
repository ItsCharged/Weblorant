import { vec3Add, vec3Dot, vec3Len, vec3Normalize, vec3Scale, vec3Sub } from '../core/math';
import type { HitZone, PlayerStance, TeamId, Vec3 } from '../core/types';
import type { BlockMaterial } from '../data/maps/types';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export const PVP_STAND_HEAD_OFFSET_Y = 1.56;
export const PVP_CROUCH_HEAD_OFFSET_Y = 1.04;
export const PVP_HEAD_RADIUS = 0.21;

export const PVP_BODY_MIN_OFFSET_Y = 0.05;
export const PVP_STAND_BODY_MAX_OFFSET_Y = 1.38;
export const PVP_CROUCH_BODY_MAX_OFFSET_Y = 0.88;
export const PVP_BODY_RADIUS = 0.34;

export interface PvpHitscanTarget {
  uid: string;
  team: TeamId;
  alive: boolean;
  pos: Vec3;
  stance: PlayerStance;
}

export interface DestructibleGadgetTarget {
  id: string;
  team: TeamId;
  center: Vec3;
  radius: number;
}

export interface PvpHitscanResult {
  hitZone: HitZone;
  distance: number;
  point: Vec3;
  normal: Vec3;
  targetUid?: string;
  hitEffectId?: string;
  worldMaterial?: BlockMaterial;
}

interface PrimHit {
  t: number;
  normal: Vec3;
}

function intersectSphere(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
): PrimHit | null {
  const oc = vec3Sub(origin, center);
  const b = vec3Dot(oc, dir);
  const c = vec3Dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = -b - sqrtDisc;
  const t2 = -b + sqrtDisc;
  const t = t1 > 1e-6 ? t1 : t2 > 1e-6 ? t2 : -1;
  if (t <= 0) return null;

  const hitPoint = vec3Add(origin, vec3Scale(dir, t));
  const normal = vec3Normalize(vec3Sub(hitPoint, center));
  return { t, normal };
}

function intersectVerticalCylinder(
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cz: number,
  yMin: number,
  yMax: number,
  radius: number,
): PrimHit | null {
  let bestT = Infinity;
  let bestNormal: Vec3 = { x: 0, y: 1, z: 0 };

  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;

  if (a > 1e-10) {
    const halfB = ox * dir.x + oz * dir.z;
    const c = ox * ox + oz * oz - radius * radius;
    const disc = halfB * halfB - a * c;
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const candidates = [(-halfB - sqrtDisc) / a, (-halfB + sqrtDisc) / a];
      for (const t of candidates) {
        if (t > 1e-6 && t < bestT) {
          const y = origin.y + t * dir.y;
          if (y >= yMin && y <= yMax) {
            bestT = t;
            bestNormal = vec3Normalize({ x: ox + t * dir.x, y: 0, z: oz + t * dir.z });
          }
        }
      }
    }
  }

  if (Math.abs(dir.y) > 1e-8) {
    const caps: ReadonlyArray<{ yCap: number; ny: number }> = [
      { yCap: yMax, ny: 1 },
      { yCap: yMin, ny: -1 },
    ];
    for (const cap of caps) {
      const t = (cap.yCap - origin.y) / dir.y;
      if (t > 1e-6 && t < bestT) {
        const px = origin.x + t * dir.x - cx;
        const pz = origin.z + t * dir.z - cz;
        if (px * px + pz * pz <= radius * radius) {
          bestT = t;
          bestNormal = { x: 0, y: cap.ny, z: 0 };
        }
      }
    }
  }

  if (!Number.isFinite(bestT)) return null;
  return { t: bestT, normal: bestNormal };
}

/**
 * Authoritative PvP hitscan raycast testing fixed world & dynamic barrier colliders first
 * (strict wall/barrier occlusion), then enemy destructible gadgets (e.g. `Magnetanker` mines),
 * and enemy player head spheres (`stand 1.56` / `crouch 1.04`, `r = 0.21`) + body cylinders.
 */
export function performPvpHitscan(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  physicsWorld: PhysicsWorld,
  targets: ReadonlyArray<PvpHitscanTarget>,
  shooterUid: string,
  shooterTeam: TeamId,
  destructibleGadgets?: ReadonlyArray<DestructibleGadgetTarget>,
): PvpHitscanResult {
  const normDir = vec3Normalize(dir);
  if (vec3Len(normDir) <= 1e-8 || maxDist <= 0) {
    return {
      hitZone: 'none',
      distance: 0,
      point: { x: origin.x, y: origin.y, z: origin.z },
      normal: { x: 0, y: 0, z: 1 },
    };
  }

  let bestT = maxDist;
  let bestResult: PvpHitscanResult | null = null;

  // 1. World geometry & dynamic physical barriers (e.g. Tessa's Schildpfosten)
  const worldHit = physicsWorld.castWorldRay(origin, normDir, maxDist);
  if (worldHit !== null) {
    const tWorld = worldHit.distance > 0 ? worldHit.distance : 1e-5;
    if (tWorld <= bestT) {
      bestT = tWorld;
      bestResult = {
        hitZone: 'world',
        distance: tWorld,
        point: worldHit.point,
        normal: worldHit.normal,
        worldMaterial: worldHit.block?.material,
        ...(worldHit.dynamicEffectId ? { hitEffectId: worldHit.dynamicEffectId } : {}),
      };
    }
  }

  // 2. Destructible enemy gadgets (e.g. Tessa's Magnetanker floor mine, r = 0.32, 40 HP)
  if (destructibleGadgets) {
    for (const g of destructibleGadgets) {
      if (g.team === shooterTeam) continue;
      const gHit = intersectSphere(origin, normDir, g.center, g.radius);
      if (gHit !== null && gHit.t > 0 && gHit.t < bestT) {
        bestT = gHit.t;
        bestResult = {
          hitZone: 'world',
          distance: gHit.t,
          point: vec3Add(origin, vec3Scale(normDir, gHit.t)),
          normal: gHit.normal,
          hitEffectId: g.id,
        };
      }
    }
  }

  // 3. Enemy player hitboxes
  for (const target of targets) {
    if (!target.alive) continue;
    if (target.uid === shooterUid) continue;
    if (target.team === shooterTeam) continue;

    const isCrouching = target.stance === 'crouch';
    const headOffsetY = isCrouching ? PVP_CROUCH_HEAD_OFFSET_Y : PVP_STAND_HEAD_OFFSET_Y;
    const bodyMaxY = isCrouching ? PVP_CROUCH_BODY_MAX_OFFSET_Y : PVP_STAND_BODY_MAX_OFFSET_Y;

    const headCenter: Vec3 = {
      x: target.pos.x,
      y: target.pos.y + headOffsetY,
      z: target.pos.z,
    };
    const headHit = intersectSphere(origin, normDir, headCenter, PVP_HEAD_RADIUS);
    if (headHit !== null && headHit.t > 0 && headHit.t < bestT) {
      bestT = headHit.t;
      bestResult = {
        hitZone: 'head',
        distance: headHit.t,
        point: vec3Add(origin, vec3Scale(normDir, headHit.t)),
        normal: headHit.normal,
        targetUid: target.uid,
      };
    }

    const bodyHit = intersectVerticalCylinder(
      origin,
      normDir,
      target.pos.x,
      target.pos.z,
      target.pos.y + PVP_BODY_MIN_OFFSET_Y,
      target.pos.y + bodyMaxY,
      PVP_BODY_RADIUS,
    );
    if (bodyHit !== null && bodyHit.t > 0 && bodyHit.t < bestT) {
      bestT = bodyHit.t;
      bestResult = {
        hitZone: 'body',
        distance: bodyHit.t,
        point: vec3Add(origin, vec3Scale(normDir, bodyHit.t)),
        normal: bodyHit.normal,
        targetUid: target.uid,
      };
    }
  }

  if (bestResult !== null) {
    return bestResult;
  }

  return {
    hitZone: 'none',
    distance: maxDist,
    point: vec3Add(origin, vec3Scale(normDir, maxDist)),
    normal: { x: -normDir.x, y: -normDir.y, z: -normDir.z },
  };
}
