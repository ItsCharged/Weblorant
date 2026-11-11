import {
  aimDirectionFromAngles,
  clamp,
  degToRad,
  lerp,
  mulberry32,
  radToDeg,
} from '../core/math';
import type { PlayerStance, Vec3 } from '../core/types';
import { WEAPONS, type WeaponStats } from '../data/weapons';

export const RECOIL_RECOVERY_DELAY_SEC = 0.12;
const STANDING_STILL_SPEED_THRESHOLD = 0.2;
const WALK_MAX_SPEED_THRESHOLD = 3.2;
const RUN_FULL_SPEED_THRESHOLD = 5.4;
const MAX_RECOIL_PITCH_CLAMP_RAD = 1.55;

function cleanZero(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * Deterministic recoil offset in radians for a given shot index in a spray.
 * `shotIndex === 0` always returns exact `{ pitchRad: 0, yawRad: 0 }` so the
 * first standing shot goes dead-center.
 * Fractional indices smoothly interpolate along `weapon.recoilPattern` during recovery.
 */
export function getRecoilAnglesRad(
  weapon: WeaponStats,
  shotIndex: number,
): { pitchRad: number; yawRad: number } {
  if (shotIndex <= 0 || weapon.recoilPattern.length === 0) {
    return { pitchRad: 0, yawRad: 0 };
  }

  const pattern = weapon.recoilPattern;
  const maxIdx = pattern.length - 1;
  const clamped = clamp(shotIndex, 0, maxIdx);
  const i0 = Math.floor(clamped);
  const i1 = Math.min(maxIdx, i0 + 1);
  const frac = clamped - i0;

  if (i0 === 0 && frac > 0) {
    const p1 = pattern[Math.min(maxIdx, 1)];
    return {
      pitchRad: cleanZero(degToRad(p1.pitchDeg * frac)),
      yawRad: cleanZero(degToRad(p1.yawDeg * frac)),
    };
  }

  const p0 = pattern[i0];
  const p1 = pattern[i1];
  const pitchDeg = lerp(p0.pitchDeg, p1.pitchDeg, frac);
  const yawDeg = lerp(p0.yawDeg, p1.yawDeg, frac);

  return {
    pitchRad: cleanZero(degToRad(pitchDeg)),
    yawRad: cleanZero(degToRad(yawDeg)),
  };
}

/**
 * Computes random angular spread half-cone in degrees for current stance, horizontal speed, and shot index.
 */
export function computeSpreadDeg(
  weapon: WeaponStats,
  stance: PlayerStance,
  horizontalSpeed: number,
  shotIndex: number,
): number {
  const sIdx = Math.max(0, shotIndex);
  const speed = Math.max(0, horizontalSpeed);

  // Exact 0 spread on first standing shot when stationary (for zero-first-shot weapons like Lanze).
  if (stance === 'stand' && speed < STANDING_STILL_SPEED_THRESHOLD && sIdx === 0) {
    return cleanZero(weapon.spreadStandFirstShotDeg);
  }

  let shotBloomDeg: number;
  if (sIdx === 0) {
    shotBloomDeg = weapon.spreadStandFirstShotDeg;
  } else if (sIdx < 1) {
    shotBloomDeg = lerp(
      weapon.spreadStandFirstShotDeg,
      weapon.spreadStandBaseDeg + weapon.spreadPerShotDeg,
      sIdx,
    );
  } else {
    shotBloomDeg = weapon.spreadStandBaseDeg + sIdx * weapon.spreadPerShotDeg;
  }

  if (stance === 'air') {
    return cleanZero(weapon.spreadAirDeg + shotBloomDeg);
  }

  if (stance === 'crouch') {
    const crouchMoveFactor =
      speed >= STANDING_STILL_SPEED_THRESHOLD
        ? clamp((speed - STANDING_STILL_SPEED_THRESHOLD) / 2.2, 0, 1)
        : 0;
    const crouchMoveDeg = weapon.spreadStandBaseDeg * 0.5 * crouchMoveFactor;
    return cleanZero((shotBloomDeg + crouchMoveDeg) * weapon.spreadCrouchMultiplier);
  }

  if (stance === 'walk') {
    return cleanZero(weapon.spreadWalkDeg + shotBloomDeg);
  }

  // stance === 'stand'
  if (speed < STANDING_STILL_SPEED_THRESHOLD) {
    return cleanZero(shotBloomDeg);
  }

  if (speed <= WALK_MAX_SPEED_THRESHOLD) {
    const t = clamp(
      (speed - STANDING_STILL_SPEED_THRESHOLD) /
        (WALK_MAX_SPEED_THRESHOLD - STANDING_STILL_SPEED_THRESHOLD),
      0,
      1,
    );
    return cleanZero(lerp(0, weapon.spreadWalkDeg, t) + shotBloomDeg);
  }

  const t = clamp(
    (speed - WALK_MAX_SPEED_THRESHOLD) / (RUN_FULL_SPEED_THRESHOLD - WALK_MAX_SPEED_THRESHOLD),
    0,
    1,
  );
  return cleanZero(lerp(weapon.spreadWalkDeg, weapon.spreadRunDeg, t) + shotBloomDeg);
}

/**
 * Computes random angular spread half-cone in radians.
 * Guarantees exact `0` when standing still (`horizontalSpeed < 0.2`) on `shotIndex === 0` for rifles/pistols.
 */
export function computeSpreadRad(
  weapon: WeaponStats,
  stance: PlayerStance,
  horizontalSpeed: number,
  shotIndex: number,
): number {
  const deg = computeSpreadDeg(weapon, stance, horizontalSpeed, shotIndex);
  if (deg <= 0) {
    return 0;
  }
  return cleanZero(degToRad(deg));
}

/**
 * Applies deterministic recoil angles and uniform-disk spread cone around the player's base aim angles.
 * Sign convention matching YXZ camera order & `aimDirectionFromAngles`:
 * - Positive `pitch` looks UP (`+Y`), so upward recoil kick ADDS `recoilPitchRad`.
 * - Decreasing `yaw` turns RIGHT (`+X` when facing `-Z`), so positive `recoilYawRad` (rightward drift) SUBTRACTS from `baseYaw`.
 */
export function applySpreadAndRecoilToAngles(
  baseYaw: number,
  basePitch: number,
  recoilPitchRad: number,
  recoilYawRad: number,
  spreadRad: number,
  rng: () => number,
): { yaw: number; pitch: number; dir: Vec3 } {
  const u1 = rng();
  const u2 = rng();

  let spreadYaw = 0;
  let spreadPitch = 0;
  if (spreadRad > 0) {
    const radius = spreadRad * Math.sqrt(clamp(u1, 0, 1));
    const theta = 2 * Math.PI * u2;
    spreadYaw = radius * Math.cos(theta);
    spreadPitch = radius * Math.sin(theta);
  }

  const yaw = cleanZero(baseYaw - recoilYawRad + spreadYaw);
  const pitch = cleanZero(
    clamp(
      basePitch + recoilPitchRad + spreadPitch,
      -MAX_RECOIL_PITCH_CLAMP_RAD,
      MAX_RECOIL_PITCH_CLAMP_RAD,
    ),
  );
  const rawDir = aimDirectionFromAngles(yaw, pitch);
  const dir: Vec3 = {
    x: cleanZero(rawDir.x),
    y: cleanZero(rawDir.y),
    z: cleanZero(rawDir.z),
  };

  return { yaw, pitch, dir };
}

/**
 * Stateful deterministic recoil & spread controller for a weapon session.
 */
export class RecoilState {
  public shotIndex = 0;
  public timeSinceLastShot = 0;
  public currentPitchRad = 0;
  public currentYawRad = 0;
  public rng: () => number;

  private activeWeapon: WeaponStats;

  constructor(seed = 0x51a7d11e, initialWeapon: WeaponStats = WEAPONS.lanze) {
    this.rng = mulberry32(seed);
    this.activeWeapon = initialWeapon;
  }

  public setWeapon(weapon: WeaponStats): void {
    this.activeWeapon = weapon;
    this.shotIndex = 0;
    this.timeSinceLastShot = 0;
    this.currentPitchRad = 0;
    this.currentYawRad = 0;
  }

  public reset(seed?: number): void {
    this.shotIndex = 0;
    this.timeSinceLastShot = 0;
    this.currentPitchRad = 0;
    this.currentYawRad = 0;
    if (seed !== undefined) {
      this.rng = mulberry32(seed);
    }
  }

  /**
   * Computes shot trajectory for the bullet being fired right now and advances recoil state.
   */
  public fireShot(
    weapon: WeaponStats,
    stance: PlayerStance,
    horizontalSpeed: number,
    baseYaw: number,
    basePitch: number,
  ): {
    yaw: number;
    pitch: number;
    dir: Vec3;
    recoilPitchRad: number;
    recoilYawRad: number;
    spreadRad: number;
    spreadDeg: number;
    firedShotIndex: number;
  } {
    this.activeWeapon = weapon;
    const firedShotIndex = Math.floor(this.shotIndex);
    const { pitchRad: recoilPitchRad, yawRad: recoilYawRad } = getRecoilAnglesRad(
      weapon,
      firedShotIndex,
    );
    const spreadRad = computeSpreadRad(weapon, stance, horizontalSpeed, firedShotIndex);
    const spreadDeg = cleanZero(radToDeg(spreadRad));
    const applied = applySpreadAndRecoilToAngles(
      baseYaw,
      basePitch,
      recoilPitchRad,
      recoilYawRad,
      spreadRad,
      this.rng,
    );

    this.onFire(weapon);

    return {
      ...applied,
      recoilPitchRad,
      recoilYawRad,
      spreadRad,
      spreadDeg,
      firedShotIndex,
    };
  }

  /**
   * Advances recoil index by one shot and updates visual camera kick angles.
   */
  public onFire(weapon: WeaponStats = this.activeWeapon): void {
    this.activeWeapon = weapon;
    this.shotIndex = Math.floor(this.shotIndex) + 1;
    this.timeSinceLastShot = 0;
    const kick = getRecoilAnglesRad(weapon, this.shotIndex);
    this.currentPitchRad = kick.pitchRad;
    this.currentYawRad = kick.yawRad;
  }

  /**
   * Updates recoil recovery. After 0.12s without firing, smoothly decays `shotIndex`
   * and visual recoil back to 0 at `weapon.recoilRecoveryRate`.
   */
  public update(dt: number, isFiring: boolean, weapon: WeaponStats = this.activeWeapon): void {
    this.activeWeapon = weapon;
    if (dt <= 0) return;

    if (isFiring) {
      this.timeSinceLastShot = 0;
      return;
    }

    this.timeSinceLastShot += dt;
    if (this.timeSinceLastShot < RECOIL_RECOVERY_DELAY_SEC || this.shotIndex <= 0) {
      return;
    }

    this.shotIndex = Math.max(0, this.shotIndex - weapon.recoilRecoveryRate * dt);
    if (this.shotIndex <= 1e-4) {
      this.shotIndex = 0;
      this.currentPitchRad = 0;
      this.currentYawRad = 0;
    } else {
      const angles = getRecoilAnglesRad(weapon, this.shotIndex);
      this.currentPitchRad = angles.pitchRad;
      this.currentYawRad = angles.yawRad;
    }
  }
}

export { RecoilState as RecoilController };
