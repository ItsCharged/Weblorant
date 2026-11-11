import { clamp, degToRad, lerp } from '../core/math';
import type { LoadoutSlot, PlayerStance, WeaponId } from '../core/types';
import { DEFAULT_WEAPON_ID, WEAPONS, type WeaponStats } from '../data/weapons';
import { isSecondaryWeapon } from './Economy';
import { computeSpreadDeg } from './Recoil';

export const KNIFE_DAMAGE = 50;
export const KNIFE_RANGE_M = 2.2;
export const KNIFE_FIRE_RATE = 1.5;
export const FALKE_HIPFIRE_PENALTY_DEG = 2.8;

export interface WeaponStepResult {
  fired: boolean;
  reloadStarted: boolean;
  reloadFinished: boolean;
}

export interface LoadoutStepResult {
  firedGun: boolean;
  slashedKnife: boolean;
  reloadStarted: boolean;
  reloadFinished: boolean;
  firedWeaponId?: WeaponId;
}

/**
 * Computes integer damage for a single hit (or single shotgun pellet) at `distanceM`,
 * applying linear distance falloff between `falloffStartM` and `falloffEndM`.
 */
export function computeDamage(
  weapon: WeaponStats,
  hitZone: 'head' | 'body',
  distanceM: number,
): number {
  const baseDamage = hitZone === 'head' ? weapon.headDamage : weapon.bodyDamage;
  const dist = Math.max(0, distanceM);

  if (
    weapon.falloffMinMultiplier >= 1 ||
    weapon.falloffEndM <= weapon.falloffStartM ||
    dist <= weapon.falloffStartM
  ) {
    return Math.round(baseDamage);
  }

  if (dist >= weapon.falloffEndM) {
    return Math.round(baseDamage * weapon.falloffMinMultiplier);
  }

  const t = clamp(
    (dist - weapon.falloffStartM) / (weapon.falloffEndM - weapon.falloffStartM),
    0,
    1,
  );
  const multiplier = lerp(1, weapon.falloffMinMultiplier, t);
  return Math.round(baseDamage * multiplier);
}

/**
 * Computes effective spread in degrees including `Falke` sniper ADS accuracy (`0°` standing 1st shot)
 * vs hipfire penalty (`+2.8°` when `!isAds`).
 */
export function computeEffectiveWeaponSpreadDeg(
  weapon: WeaponStats,
  stance: PlayerStance,
  horizontalSpeed: number,
  shotIndex: number,
  isAds: boolean,
): number {
  const baseDeg = computeSpreadDeg(weapon, stance, horizontalSpeed, shotIndex);
  const scope = weapon.scope;
  if (!weapon.hasScopeZoom || !scope || scope.type === 'none') {
    return baseDeg;
  }

  // Reflex-/Holo-Visiere: einfache Streuungsreduktion beim Zielen, keine Hüftfeuer-Strafe.
  if (scope.type !== 'sniper') {
    return isAds ? baseDeg * scope.adsSpreadMult : baseDeg;
  }

  if (isAds) {
    if (
      (stance === 'stand' || stance === 'crouch') &&
      horizontalSpeed < 0.2 &&
      Math.floor(shotIndex) === 0
    ) {
      return 0;
    }
    return baseDeg * 0.25;
  }

  return baseDeg + FALKE_HIPFIRE_PENALTY_DEG;
}

export function computeEffectiveWeaponSpreadRad(
  weapon: WeaponStats,
  stance: PlayerStance,
  horizontalSpeed: number,
  shotIndex: number,
  isAds: boolean,
): number {
  const deg = computeEffectiveWeaponSpreadDeg(
    weapon,
    stance,
    horizontalSpeed,
    shotIndex,
    isAds,
  );
  return deg <= 0 ? 0 : degToRad(deg);
}

/**
 * Pure deterministic weapon state machine managing magazine ammo, reserve ammo,
 * fire rate cooldown, semi-auto vs full-auto trigger gating, and reload timers.
 */
export class WeaponController {
  public weaponId: WeaponId;
  public ammoInMag: number;
  public reserveAmmo: number;
  public infiniteAmmo = false;
  public fireCooldown = 0;
  public reloadTimer = 0;
  public isReloading = false;
  public triggerHeldLastTick = false;

  constructor(initialWeaponId: WeaponId = DEFAULT_WEAPON_ID) {
    this.weaponId = initialWeaponId;
    const stats = WEAPONS[initialWeaponId];
    this.ammoInMag = stats.magSize;
    this.reserveAmmo = stats.reserveAmmo;
  }

  public get weapon(): WeaponStats {
    return WEAPONS[this.weaponId];
  }

  public get reloadProgress(): number {
    if (!this.isReloading) return 0;
    const total = this.weapon.reloadTimeSec;
    if (total <= 0) return 1;
    return clamp(1 - this.reloadTimer / total, 0, 1);
  }

  public equipWeapon(id: WeaponId): void {
    this.weaponId = id;
    const stats = WEAPONS[id];
    this.ammoInMag = stats.magSize;
    this.reserveAmmo = stats.reserveAmmo;
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.isReloading = false;
    this.triggerHeldLastTick = false;
  }

  public cancelReload(): void {
    this.isReloading = false;
    this.reloadTimer = 0;
  }

  public refillAmmo(): void {
    const stats = this.weapon;
    this.ammoInMag = stats.magSize;
    this.reserveAmmo = stats.reserveAmmo;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
  }

  public canReload(): boolean {
    if (this.isReloading) return false;
    if (this.ammoInMag >= this.weapon.magSize) return false;
    if (!this.infiniteAmmo && this.reserveAmmo <= 0) return false;
    return true;
  }

  public startReload(): boolean {
    if (!this.canReload()) return false;
    this.isReloading = true;
    this.reloadTimer = this.weapon.reloadTimeSec;
    return true;
  }

  public step(dt: number, fireInput: boolean, reloadInput: boolean): WeaponStepResult {
    let fired = false;
    let reloadStarted = false;
    let reloadFinished = false;

    if (dt > 0) {
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    }

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 1e-7) {
        const stats = this.weapon;
        if (this.infiniteAmmo) {
          this.ammoInMag = stats.magSize;
          this.reserveAmmo = stats.reserveAmmo;
        } else {
          const needed = stats.magSize - this.ammoInMag;
          const transfer = Math.min(needed, this.reserveAmmo);
          this.ammoInMag += transfer;
          this.reserveAmmo -= transfer;
        }
        this.isReloading = false;
        this.reloadTimer = 0;
        reloadFinished = true;
      }
    }

    if (reloadInput && !this.isReloading) {
      if (this.startReload()) {
        reloadStarted = true;
      }
    }

    if (!this.isReloading) {
      const stats = this.weapon;
      const canPullTrigger = stats.automatic
        ? fireInput
        : fireInput && !this.triggerHeldLastTick;

      if (canPullTrigger && this.fireCooldown <= 1e-7 && this.ammoInMag > 0) {
        this.ammoInMag -= 1;
        this.fireCooldown = 1 / stats.fireRate;
        fired = true;
      }
    }

    this.triggerHeldLastTick = fireInput;
    return { fired, reloadStarted, reloadFinished };
  }
}

/**
 * Multi-slot tactical weapon inventory (`Slot 1` Primary, `Slot 2` Pistol, `Slot 3` Knife).
 * Preserves independent magazine & reserve ammo across Slot 1 and Slot 2 switches.
 * Pure TypeScript — zero 3D engine or DOM imports.
 */
export class LoadoutInventory {
  public primary: WeaponController | null = null;
  public secondary: WeaponController;
  public activeSlot: LoadoutSlot = 2;
  public knifeCooldown = 0;

  constructor(
    primaryWeapon: WeaponId | null = null,
    secondaryWeapon: WeaponId = 'funke',
  ) {
    this.secondary = new WeaponController(secondaryWeapon);
    if (primaryWeapon) {
      this.primary = new WeaponController(primaryWeapon);
      this.activeSlot = 1;
    } else {
      this.activeSlot = 2;
    }
  }

  public get primaryWeaponId(): WeaponId | null {
    return this.primary ? this.primary.weaponId : null;
  }

  public get secondaryWeaponId(): WeaponId {
    return this.secondary.weaponId;
  }

  /**
   * Returns the active gun controller when Slot 1 or Slot 2 is drawn, or `null` when Knife (Slot 3) is drawn.
   */
  public get activeGun(): WeaponController | null {
    if (this.activeSlot === 1 && this.primary) return this.primary;
    if (this.activeSlot === 2) return this.secondary;
    return null;
  }

  /**
   * Returns a valid `WeaponController` for legacy callers/HUD even when Slot 3 (Knife) is drawn.
   */
  public get fallbackGun(): WeaponController {
    return this.activeGun ?? this.primary ?? this.secondary;
  }

  public syncOwnedWeapons(
    primaryWeapon: WeaponId | null,
    secondaryWeapon: WeaponId,
    preferredSlot?: LoadoutSlot,
  ): void {
    if (this.secondary.weaponId !== secondaryWeapon) {
      this.secondary.equipWeapon(secondaryWeapon);
    }

    if (primaryWeapon === null) {
      this.primary = null;
      if (this.activeSlot === 1) {
        this.activeSlot = 2;
      }
    } else if (!this.primary || this.primary.weaponId !== primaryWeapon) {
      this.primary = new WeaponController(primaryWeapon);
    }

    if (preferredSlot) {
      this.selectSlot(preferredSlot);
    } else if (this.activeSlot === 1 && !this.primary) {
      this.activeSlot = 2;
    }
  }

  public grantWeapon(weaponId: WeaponId, autoEquip = true): void {
    if (isSecondaryWeapon(weaponId)) {
      this.secondary.equipWeapon(weaponId);
      if (autoEquip && !this.primary) {
        this.selectSlot(2);
      }
    } else {
      this.primary = new WeaponController(weaponId);
      if (autoEquip) {
        this.selectSlot(1);
      }
    }
  }

  public selectSlot(slot: LoadoutSlot): boolean {
    if (slot === 1 && !this.primary) {
      return false;
    }
    if (this.activeSlot === slot) {
      return true;
    }

    this.primary?.cancelReload();
    this.secondary.cancelReload();
    if (this.primary) this.primary.triggerHeldLastTick = false;
    this.secondary.triggerHeldLastTick = false;

    this.activeSlot = slot;
    return true;
  }

  public refillAllAmmo(): void {
    this.primary?.refillAmmo();
    this.secondary.refillAmmo();
    this.knifeCooldown = 0;
  }

  public step(dt: number, fireInput: boolean, reloadInput: boolean): LoadoutStepResult {
    if (dt > 0) {
      this.knifeCooldown = Math.max(0, this.knifeCooldown - dt);
      // Tick background cooldown on holstered gun without consuming trigger/reload
      if (this.activeSlot !== 1 && this.primary) {
        this.primary.fireCooldown = Math.max(0, this.primary.fireCooldown - dt);
      }
      if (this.activeSlot !== 2) {
        this.secondary.fireCooldown = Math.max(0, this.secondary.fireCooldown - dt);
      }
    }

    if (this.activeSlot === 3) {
      if (fireInput && this.knifeCooldown <= 1e-7) {
        this.knifeCooldown = 1 / KNIFE_FIRE_RATE;
        return {
          firedGun: false,
          slashedKnife: true,
          reloadStarted: false,
          reloadFinished: false,
        };
      }
      return {
        firedGun: false,
        slashedKnife: false,
        reloadStarted: false,
        reloadFinished: false,
      };
    }

    const gun = this.activeGun ?? this.secondary;
    const res = gun.step(dt, fireInput, reloadInput);
    return {
      firedGun: res.fired,
      slashedKnife: false,
      reloadStarted: res.reloadStarted,
      reloadFinished: res.reloadFinished,
      ...(res.fired ? { firedWeaponId: gun.weaponId } : {}),
    };
  }
}
