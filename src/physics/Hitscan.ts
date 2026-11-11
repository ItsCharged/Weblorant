import { vec3Add, vec3Dot, vec3Len, vec3Normalize, vec3Scale, vec3Sub } from '../core/math';
import type { HitZone, Vec3 } from '../core/types';
import type { BlockMaterial, RangeButtonId, RangeControlButton } from '../data/maps/types';
import type { DummyEntity } from '../game/TargetDummy';
import type { PhysicsWorld } from './PhysicsWorld';

export const DUMMY_HEAD_CENTER_OFFSET_Y = 1.56;
export const DUMMY_HEAD_RADIUS = 0.21;
export const DUMMY_BODY_MIN_OFFSET_Y = 0.05;
export const DUMMY_BODY_MAX_OFFSET_Y = 1.38;
export const DUMMY_BODY_RADIUS = 0.34;

export interface HitscanResult {
  hitZone: HitZone;
  distance: number;
  point: Vec3;
  normal: Vec3;
  dummyId?: string;
  buttonId?: RangeButtonId;
  worldMaterial?: BlockMaterial;
}

interface RayPrimHit {
  t: number;
  normal: Vec3;
}

function intersectRaySphere(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
): RayPrimHit | null {
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

function intersectRayVerticalCylinder(
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cz: number,
  yMin: number,
  yMax: number,
  radius: number,
): RayPrimHit | null {
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
            const nx = ox + t * dir.x;
            const nz = oz + t * dir.z;
            bestNormal = vec3Normalize({ x: nx, y: 0, z: nz });
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

function intersectRayAABB(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  size: Vec3,
): RayPrimHit | null {
  const minX = center.x - size.x * 0.5;
  const maxX = center.x + size.x * 0.5;
  const minY = center.y - size.y * 0.5;
  const maxY = center.y + size.y * 0.5;
  const minZ = center.z - size.z * 0.5;
  const maxZ = center.z + size.z * 0.5;

  let tMin = -Infinity;
  let tMax = Infinity;
  let hitNormal: Vec3 = { x: 0, y: 0, z: 1 };

  const axes: ReadonlyArray<{
    o: number;
    d: number;
    mn: number;
    mx: number;
    nNeg: Vec3;
    nPos: Vec3;
  }> = [
    {
      o: origin.x,
      d: dir.x,
      mn: minX,
      mx: maxX,
      nNeg: { x: -1, y: 0, z: 0 },
      nPos: { x: 1, y: 0, z: 0 },
    },
    {
      o: origin.y,
      d: dir.y,
      mn: minY,
      mx: maxY,
      nNeg: { x: 0, y: -1, z: 0 },
      nPos: { x: 0, y: 1, z: 0 },
    },
    {
      o: origin.z,
      d: dir.z,
      mn: minZ,
      mx: maxZ,
      nNeg: { x: 0, y: 0, z: -1 },
      nPos: { x: 0, y: 0, z: 1 },
    },
  ];

  for (const axis of axes) {
    if (Math.abs(axis.d) < 1e-9) {
      if (axis.o < axis.mn || axis.o > axis.mx) {
        return null;
      }
    } else {
      const invD = 1 / axis.d;
      let t1 = (axis.mn - axis.o) * invD;
      let t2 = (axis.mx - axis.o) * invD;
      let n1 = axis.nNeg;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n1 = axis.nPos;
      }
      if (t1 > tMin) {
        tMin = t1;
        hitNormal = n1;
      }
      if (t2 < tMax) {
        tMax = t2;
      }
      if (tMin > tMax) {
        return null;
      }
    }
  }

  if (tMax <= 1e-6) return null;
  const t = tMin > 1e-6 ? tMin : tMax;
  return { t, normal: hitNormal };
}

/**
 * Performs an authoritative hitscan raycast combining:
 * (a) Rapier fixed world colliders (walls/crates/floors strictly block line-of-sight),
 * (b) Analytical head-sphere & body-cylinder hitboxes on all `alive` dummies,
 * (c) Analytical AABBs on shootable Range control buttons.
 * Returns the closest intersection (`t > 0`) up to `maxDist`.
 */
export function performHitscan(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  physicsWorld: PhysicsWorld,
  dummies: ReadonlyArray<DummyEntity>,
  rangeButtons?: ReadonlyArray<RangeControlButton>,
): HitscanResult {
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
  let bestResult: HitscanResult | null = null;

  // (a) World geometry raycast
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
      };
    }
  }

  // (b) Alive dummy hitboxes (head sphere + torso/legs cylinder)
  for (const dummy of dummies) {
    if (!dummy.alive) continue;

    const headCenter: Vec3 = {
      x: dummy.pos.x,
      y: dummy.pos.y + DUMMY_HEAD_CENTER_OFFSET_Y,
      z: dummy.pos.z,
    };
    const headHit = intersectRaySphere(origin, normDir, headCenter, DUMMY_HEAD_RADIUS);
    if (headHit !== null && headHit.t > 0 && headHit.t < bestT) {
      bestT = headHit.t;
      bestResult = {
        hitZone: 'head',
        distance: headHit.t,
        point: vec3Add(origin, vec3Scale(normDir, headHit.t)),
        normal: headHit.normal,
        dummyId: dummy.id,
      };
    }

    const bodyHit = intersectRayVerticalCylinder(
      origin,
      normDir,
      dummy.pos.x,
      dummy.pos.z,
      dummy.pos.y + DUMMY_BODY_MIN_OFFSET_Y,
      dummy.pos.y + DUMMY_BODY_MAX_OFFSET_Y,
      DUMMY_BODY_RADIUS,
    );
    if (bodyHit !== null && bodyHit.t > 0 && bodyHit.t < bestT) {
      bestT = bodyHit.t;
      bestResult = {
        hitZone: 'body',
        distance: bodyHit.t,
        point: vec3Add(origin, vec3Scale(normDir, bodyHit.t)),
        normal: bodyHit.normal,
        dummyId: dummy.id,
      };
    }
  }

  // (c) Shootable Range control buttons (allow 5mm flush tolerance against mounting pillar face only)
  if (rangeButtons && rangeButtons.length > 0) {
    for (const btn of rangeButtons) {
      const btnHit = intersectRayAABB(origin, normDir, btn.pos, btn.size);
      if (btnHit === null || btnHit.t <= 0 || btnHit.t > maxDist) continue;

      const flushMountTolerance = bestResult?.hitZone === 'world' ? 0.008 : 0;
      if (btnHit.t < bestT + flushMountTolerance) {
        bestT = btnHit.t;
        bestResult = {
          hitZone: 'button',
          distance: btnHit.t,
          point: vec3Add(origin, vec3Scale(normDir, btnHit.t)),
          normal: btnHit.normal,
          buttonId: btn.id,
        };
      }
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
