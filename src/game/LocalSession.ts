import { SIM_DT } from '../core/Config';
import { EventBus } from '../core/EventBus';
import { clamp, radToDeg, vec3Clone, vec3Lerp } from '../core/math';
import type {
  AbilitySlot,
  ActiveWorldEffect,
  CharacterId,
  InputSnapshot,
  MapId,
  PlayerAbilityState,
  PlayerStance,
  Vec3,
  WeaponId,
  WorldEffectKind,
} from '../core/types';
import { CHARACTERS, DEFAULT_CHARACTER_ID, isValidCharacterId } from '../data/characters';
import type { MapDefinition, RangeButtonId, SprayWallBounds } from '../data/maps/types';
import { DEFAULT_WEAPON_ID, WEAPONS, type WeaponStats } from '../data/weapons';
import { CharacterMotor } from '../physics/CharacterMotor';
import { type HitscanResult, performHitscan } from '../physics/Hitscan';
import { initRapier, PhysicsWorld } from '../physics/PhysicsWorld';
import {
  type AbilityActor,
  AbilitySystem,
  computeAbilityRecoilMultiplier,
  computeAbilityReloadMultiplier,
  computeAbilitySpeedMultiplier,
} from './AbilitySystem';
import {
  applySpreadAndRecoilToAngles,
  computeSpreadDeg,
  getRecoilAnglesRad,
  RecoilController,
} from './Recoil';
import { type ChallengeState, type DummyEntity, DummyManager } from './TargetDummy';
import {
  computeDamage,
  computeEffectiveWeaponSpreadDeg,
  computeEffectiveWeaponSpreadRad,
  WeaponController,
} from './WeaponLogic';

export const MAX_SPRAY_WALL_IMPACTS = 60;
const HITSCAN_MAX_DISTANCE_M = 250;

export interface ShotEventPayload {
  weaponId: WeaponId;
  origin: Vec3;
  dir: Vec3;
  hit: HitscanResult;
  pelletHits: HitscanResult[];
  spreadDeg: number;
  shotIndex: number;
}

export interface HitEventPayload {
  dummyId: string;
  hitZone: 'head' | 'body';
  damage: number;
  killed: boolean;
  point: Vec3;
  remainingHp: number;
  remainingArmor: number;
  weaponId: WeaponId;
}

export interface KillEventPayload {
  dummyId: string;
  hitZone: 'head' | 'body';
  damage: number;
  point: Vec3;
  weaponId: WeaponId;
  totalKills: number;
}

export interface ReloadStartEventPayload {
  weaponId: WeaponId;
  durationSec: number;
}

export interface ReloadEndEventPayload {
  weaponId: WeaponId;
  ammoInMag: number;
  reserveAmmo: number;
}

export interface FootstepEventPayload {
  pos: Vec3;
  speed: number;
}

export interface RangeButtonEventPayload {
  buttonId: RangeButtonId;
  active: boolean;
  point: Vec3;
}

export interface MapChangedEventPayload {
  mapId: MapId;
  mapDef: MapDefinition;
}

export interface OfflineAbilityCastEventPayload {
  character: CharacterId;
  slot: AbilitySlot;
  abilityName: string;
  origin: Vec3;
  targetPos?: Vec3;
}

export interface OfflineEffectEventPayload {
  effectId: string;
  kind: WorldEffectKind;
  action: 'triggered' | 'destroyed';
  pos: Vec3;
}

export interface CharacterChangedEventPayload {
  character: CharacterId;
}

export type SessionEvents = {
  shot: ShotEventPayload;
  hit: HitEventPayload;
  kill: KillEventPayload;
  reloadStart: ReloadStartEventPayload;
  reloadEnd: ReloadEndEventPayload;
  footstep: FootstepEventPayload;
  rangeButton: RangeButtonEventPayload;
  mapChanged: MapChangedEventPayload;
  abilityCast: OfflineAbilityCastEventPayload;
  effectEvent: OfflineEffectEventPayload;
  characterChanged: CharacterChangedEventPayload;
};

function isImpactOnSprayWall(hit: HitscanResult, bounds?: SprayWallBounds): boolean {
  if (hit.hitZone !== 'world') return false;
  if (hit.worldMaterial === 'spray_board') return true;
  if (!bounds) return false;

  const dx = Math.abs(hit.point.x - bounds.center.x);
  const dy = Math.abs(hit.point.y - bounds.center.y);
  const dz = Math.abs(hit.point.z - bounds.center.z);
  return dx <= bounds.width * 0.5 + 0.05 && dy <= bounds.height * 0.5 + 0.05 && dz <= 0.35;
}

/**
 * Pure deterministic local gameplay session orchestrating Rapier physics,
 * kinematic character movement, weapons, recoil, target dummies, Range challenge/buttons,
 * and camera eye-position interpolation.
 */
export class LocalSession {
  public readonly events = new EventBus<SessionEvents>();

  public mapDef!: MapDefinition;
  public physicsWorld!: PhysicsWorld;
  public motor!: CharacterMotor;
  public readonly weapon: WeaponController;
  public readonly recoil: RecoilController;
  public readonly dummies: DummyManager;
  public readonly abilitySystem = new AbilitySystem(null);

  public characterId: CharacterId = DEFAULT_CHARACTER_ID;
  public infiniteAbilities = true;
  public chargesQ = 2;
  public chargesE = 1;
  public ultPoints = 6;

  public prevEyePos: Vec3 = { x: 0, y: 1.62, z: 0 };
  public currEyePos: Vec3 = { x: 0, y: 1.62, z: 0 };
  public currentYaw = 0;
  public currentPitch = 0;
  public currentSpreadDeg = 0;
  public isAdsActive = false;

  public playerHp = 100;
  public playerMaxHp = 100;
  public playerShield = 0;
  public credits = 800;

  public sprayImpacts: Vec3[] = [];
  public totalShots = 0;
  public totalHits = 0;
  public totalKills = 0;

  private disposed = false;

  public static async create(mapDef: MapDefinition, seed = 0x51a7d11e): Promise<LocalSession> {
    await initRapier();
    return new LocalSession(mapDef, seed);
  }

  constructor(mapDef: MapDefinition, seed = 0x51a7d11e) {
    this.weapon = new WeaponController(DEFAULT_WEAPON_ID);
    this.recoil = new RecoilController(seed, this.weapon.weapon);
    this.dummies = new DummyManager([], seed ^ 0x9e3779b9);
    this.refillFullAbilities();
    this.loadMap(mapDef);
  }

  public get localCharacter(): CharacterId {
    return this.characterId;
  }

  /**
   * Switches active Specialist in Offline Training (`'ryo' | 'mira' | 'brann' | 'tessa'`),
   * clearing temporary world effects and refilling Q/E/Ult charges immediately.
   */
  public setCharacter(id: CharacterId): void {
    if (!isValidCharacterId(id)) return;
    this.characterId = id;
    this.abilitySystem.resetForNewRound([this.buildLocalAbilityActor()], true);
    this.refillFullAbilities();
    this.events.emit('characterChanged', { character: id });
  }

  public refillFullAbilities(): void {
    const def = CHARACTERS[this.characterId];
    this.chargesQ = def.abilities.q.maxCharges ?? 1;
    this.chargesE = def.abilities.e.maxCharges ?? 1;
    this.ultPoints = def.abilities.ult.ultPoints ?? 7;
  }

  public getAbilityState(): PlayerAbilityState {
    if (this.infiniteAbilities) {
      this.refillFullAbilities();
    }
    return this.abilitySystem.getPlayerAbilityState({
      uid: 'local',
      character: this.characterId,
      chargesQ: this.chargesQ,
      chargesE: this.chargesE,
      ultPoints: this.ultPoints,
    });
  }

  public getActiveEffects(): ReadonlyArray<ActiveWorldEffect> {
    return this.abilitySystem.getEffects();
  }

  public isDummyRevealed(dummyId: string): boolean {
    const state = this.abilitySystem.getPlayerAbilityState({
      uid: `dummy_${dummyId}`,
      character: 'ryo',
      chargesQ: 0,
      chargesE: 0,
      ultPoints: 0,
    });
    return state.revealedSec > 0 && state.revealedToTeam === 'A';
  }

  public castAbility(slot: AbilitySlot, targetPos?: Vec3): boolean {
    if (this.disposed) return false;
    if (slot !== 'q' && slot !== 'e' && slot !== 'x') return false;

    const localActor = this.buildLocalAbilityActor();
    const allActors = [localActor, ...this.buildDummyAbilityActors()];
    const res = this.abilitySystem.castAbility(
      localActor,
      slot,
      this.currentYaw,
      this.currentPitch,
      targetPos,
      allActors,
      { infiniteCharges: this.infiniteAbilities },
    );

    if (!res.ok) {
      return false;
    }

    this.chargesQ = localActor.chargesQ;
    this.chargesE = localActor.chargesE;
    this.ultPoints = localActor.ultPoints;
    if (this.infiniteAbilities) {
      this.refillFullAbilities();
    }

    for (const ev of res.events) {
      if (ev.type === 'ability_cast') {
        this.events.emit('abilityCast', {
          character: ev.character,
          slot: ev.slot,
          abilityName: ev.abilityName,
          origin: vec3Clone(ev.origin),
          ...(ev.targetPos ? { targetPos: vec3Clone(ev.targetPos) } : {}),
        });
      } else if (ev.type === 'effect_event') {
        this.events.emit('effectEvent', {
          effectId: ev.effectId,
          kind: ev.kind,
          action: ev.action,
          pos: vec3Clone(ev.pos),
        });
      }
    }

    return true;
  }

  private buildLocalAbilityActor(): AbilityActor {
    const feet = this.motor ? this.motor.feetPos : { x: 0, y: 0, z: 0 };
    const eye = this.motor ? this.motor.getEyePos() : { x: 0, y: 1.62, z: 0 };
    const vel = this.motor ? this.motor.velocity : { x: 0, y: 0, z: 0 };
    return {
      uid: 'local',
      team: 'A',
      character: this.characterId,
      alive: true,
      pos: feet,
      eyePos: eye,
      vel,
      chargesQ: this.chargesQ,
      chargesE: this.chargesE,
      ultPoints: this.ultPoints,
      startDash: (dirX, dirZ, speedMps, durationSec) => {
        this.motor?.startDash(dirX, dirZ, speedMps, durationSec);
      },
    };
  }

  private buildDummyAbilityActors(): AbilityActor[] {
    const out: AbilityActor[] = [];
    for (const d of this.dummies.dummies) {
      if (!d.alive) continue;
      out.push({
        uid: `dummy_${d.id}`,
        team: 'D',
        character: 'ryo',
        alive: true,
        pos: d.pos,
        eyePos: { x: d.pos.x, y: d.pos.y + 1.56, z: d.pos.z },
        vel: { x: 0, y: 0, z: 0 },
        chargesQ: 0,
        chargesE: 0,
        ultPoints: 0,
      });
    }
    return out;
  }

  public get activeMapId(): MapId {
    return this.mapDef.id;
  }

  public get strafeEnabled(): boolean {
    return this.dummies.strafeEnabled;
  }

  public get armorEnabled(): boolean {
    return this.dummies.armorEnabled;
  }

  public get infiniteAmmo(): boolean {
    return this.weapon.infiniteAmmo;
  }

  public get challengeState(): Readonly<ChallengeState> {
    return this.dummies.challenge;
  }

  public get stance(): PlayerStance {
    return this.motor.stance;
  }

  public getWeaponStats(): WeaponStats {
    return WEAPONS[this.weapon.weaponId];
  }

  public getDummies(): ReadonlyArray<DummyEntity> {
    return this.dummies.dummies;
  }

  public getAliveDummyCount(): number {
    return this.dummies.getAliveCount();
  }

  public getVisualRecoil(): { pitchRad: number; yawRad: number } {
    return {
      pitchRad: this.recoil.currentPitchRad,
      yawRad: this.recoil.currentYawRad,
    };
  }

  /**
   * Smoothly interpolates camera eye position between the previous and current 30 Hz ticks.
   */
  public getInterpolatedEyePos(alpha: number): Vec3 {
    return vec3Lerp(this.prevEyePos, this.currEyePos, clamp(alpha, 0, 1));
  }

  public isRangeButtonActive(buttonId: RangeButtonId): boolean {
    switch (buttonId) {
      case 'start_challenge':
        return this.dummies.challenge.active;
      case 'toggle_strafe':
        return this.dummies.strafeEnabled;
      case 'toggle_armor':
        return this.dummies.armorEnabled;
      case 'toggle_inf_ammo':
        return this.weapon.infiniteAmmo;
      case 'clear_spray':
        return false;
    }
  }

  public equipWeapon(id: WeaponId): void {
    this.weapon.equipWeapon(id);
    this.recoil.setWeapon(this.weapon.weapon);
    this.isAdsActive = false;
    this.currentSpreadDeg = computeSpreadDeg(
      this.weapon.weapon,
      this.motor.stance,
      this.motor.horizontalSpeed,
      0,
    );
  }

  public clearSprayImpacts(): void {
    this.sprayImpacts.length = 0;
  }

  public triggerRangeButton(buttonId: RangeButtonId, hitPoint?: Vec3): boolean {
    let active = false;
    switch (buttonId) {
      case 'start_challenge': {
        if (this.dummies.challenge.active) {
          this.dummies.stopChallenge(true);
          active = false;
        } else {
          this.weapon.refillAmmo();
          this.recoil.reset();
          this.dummies.startChallenge();
          active = true;
        }
        break;
      }
      case 'toggle_strafe': {
        const next = !this.dummies.strafeEnabled;
        this.dummies.setStrafeEnabled(next);
        active = next;
        break;
      }
      case 'toggle_armor': {
        const next = !this.dummies.armorEnabled;
        this.dummies.setArmorEnabled(next);
        active = next;
        break;
      }
      case 'toggle_inf_ammo': {
        const next = !this.weapon.infiniteAmmo;
        this.weapon.infiniteAmmo = next;
        if (next) {
          this.weapon.refillAmmo();
        }
        active = next;
        break;
      }
      case 'clear_spray': {
        this.clearSprayImpacts();
        active = false;
        break;
      }
    }

    const point = hitPoint ?? vec3Clone(this.currEyePos);
    this.events.emit('rangeButton', { buttonId, active, point });
    return active;
  }

  /**
   * Hot-switches the active map cleanly, freeing the previous Rapier world and rebuilding
   * colliders, player spawn, and target dummies.
   */
  public loadMap(mapDef: MapDefinition): void {
    if (this.disposed) return;

    if (this.motor) {
      this.motor.dispose();
    }
    if (this.physicsWorld) {
      this.physicsWorld.dispose();
    }

    this.mapDef = mapDef;
    this.physicsWorld = new PhysicsWorld(mapDef);
    this.motor = new CharacterMotor(this.physicsWorld, mapDef.playerSpawn.pos);
    this.abilitySystem.setPhysicsWorld(this.physicsWorld);
    this.abilitySystem.resetForNewRound([this.buildLocalAbilityActor()], true);
    this.refillFullAbilities();

    this.currentYaw = mapDef.playerSpawn.yaw;
    this.currentPitch = 0;
    this.currEyePos = this.motor.getEyePos();
    this.prevEyePos = vec3Clone(this.currEyePos);

    const hasRangeControls = Boolean(mapDef.rangeButtons && mapDef.rangeButtons.length > 0);
    this.dummies.armorEnabled = false;
    this.dummies.strafeEnabled = !hasRangeControls;
    this.dummies.loadSpawns(mapDef.dummySpawns);

    this.weapon.infiniteAmmo = false;
    this.weapon.refillAmmo();
    this.recoil.reset();
    this.isAdsActive = false;
    this.clearSprayImpacts();

    this.currentSpreadDeg = computeSpreadDeg(
      this.weapon.weapon,
      this.motor.stance,
      this.motor.horizontalSpeed,
      0,
    );

    this.events.emit('mapChanged', { mapId: mapDef.id, mapDef });
  }

  public tick(input: InputSnapshot): void {
    if (this.disposed) return;

    const dt = input.dt > 0 ? input.dt : SIM_DT;
    this.prevEyePos = vec3Clone(this.currEyePos);
    this.currentYaw = input.yaw;
    this.currentPitch = input.pitch;

    const preAbilityState = this.getAbilityState();
    this.motor.speedMultiplier = computeAbilitySpeedMultiplier(preAbilityState, 1.0);

    const { footstepTriggered } = this.motor.step(input);
    this.physicsWorld.step();
    this.currEyePos = this.motor.getEyePos();

    if (footstepTriggered) {
      this.events.emit('footstep', {
        pos: vec3Clone(this.motor.feetPos),
        speed: this.motor.horizontalSpeed,
      });
    }

    this.dummies.update(dt);

    const allActors = [this.buildLocalAbilityActor(), ...this.buildDummyAbilityActors()];
    const abilityStep = this.abilitySystem.step(dt, allActors);
    for (const ev of abilityStep.events) {
      if (ev.type === 'effect_event') {
        this.events.emit('effectEvent', {
          effectId: ev.effectId,
          kind: ev.kind,
          action: ev.action,
          pos: vec3Clone(ev.pos),
        });
      }
    }
    for (const burn of abilityStep.burns) {
      if (burn.victimUid.startsWith('dummy_')) {
        const dummyId = burn.victimUid.slice('dummy_'.length);
        const dummy = this.dummies.dummies.find((d) => d.id === dummyId);
        const outcome = this.dummies.applyDamage(dummyId, burn.damage, 'body');
        if (outcome.applied) {
          const hitPt = dummy ? { x: dummy.pos.x, y: dummy.pos.y + 0.9, z: dummy.pos.z } : vec3Clone(this.currEyePos);
          this.events.emit('hit', {
            dummyId,
            hitZone: 'body',
            damage: outcome.damage,
            killed: outcome.killed,
            point: hitPt,
            remainingHp: outcome.remainingHp,
            remainingArmor: outcome.remainingArmor,
            weaponId: this.weapon.weaponId,
          });
          if (outcome.killed) {
            this.totalKills += 1;
            if (!this.infiniteAbilities) {
              const maxUlt = CHARACTERS[this.characterId].abilities.ult.ultPoints ?? 7;
              this.ultPoints = Math.min(maxUlt, this.ultPoints + 1);
            }
            this.events.emit('kill', {
              dummyId,
              hitZone: 'body',
              damage: outcome.damage,
              point: hitPt,
              weaponId: this.weapon.weaponId,
              totalKills: this.totalKills,
            });
          }
        }
      }
    }

    const postAbilityState = this.getAbilityState();
    const weaponStats = this.weapon.weapon;
    this.isAdsActive = input.ads && weaponStats.hasScopeZoom && !this.weapon.isReloading;

    const reloadMult = computeAbilityReloadMultiplier(postAbilityState);
    if (this.weapon.isReloading && reloadMult > 1.0 && dt > 0) {
      this.weapon.reloadTimer -= dt * (reloadMult - 1.0);
    }

    const weaponLockedOut = this.abilitySystem.isWeaponLockedOut('local');
    const canFireInput = !weaponLockedOut ? input.fire : false;

    const autoReloadOnEmpty =
      canFireInput &&
      this.weapon.ammoInMag === 0 &&
      !this.weapon.isReloading &&
      this.weapon.fireCooldown <= 1e-6 &&
      this.weapon.canReload();

    const stepRes = this.weapon.step(dt, canFireInput, input.reload || autoReloadOnEmpty);

    if (stepRes.reloadStarted) {
      this.recoil.reset();
      this.events.emit('reloadStart', {
        weaponId: this.weapon.weaponId,
        durationSec: weaponStats.reloadTimeSec,
      });
    }

    if (stepRes.reloadFinished) {
      this.events.emit('reloadEnd', {
        weaponId: this.weapon.weaponId,
        ammoInMag: this.weapon.ammoInMag,
        reserveAmmo: this.weapon.reserveAmmo,
      });
    }

    if (stepRes.fired) {
      this.executeWeaponShot(weaponStats, input.yaw, input.pitch);
    }

    const holdingContinuousFire =
      input.fire &&
      !this.weapon.isReloading &&
      this.weapon.ammoInMag > 0 &&
      (weaponStats.automatic || stepRes.fired);

    this.recoil.update(dt, holdingContinuousFire, weaponStats);
    this.currentSpreadDeg = computeEffectiveWeaponSpreadDeg(
      weaponStats,
      this.motor.stance,
      this.motor.horizontalSpeed,
      this.recoil.shotIndex,
      this.isAdsActive,
    );
  }

  private executeWeaponShot(weaponStats: WeaponStats, baseYaw: number, basePitch: number): void {
    this.totalShots += 1;
    const origin = vec3Clone(this.currEyePos);
    const pelletCount = Math.max(1, weaponStats.pellets);

    const firedShotIndex = Math.floor(this.recoil.shotIndex);
    const recoilMult = computeAbilityRecoilMultiplier(this.getAbilityState());
    const rawRecoil = getRecoilAnglesRad(weaponStats, firedShotIndex);
    const recoilPitchRad = rawRecoil.pitchRad * recoilMult;
    const recoilYawRad = rawRecoil.yawRad * recoilMult;

    const spreadRad =
      computeEffectiveWeaponSpreadRad(
        weaponStats,
        this.motor.stance,
        this.motor.horizontalSpeed,
        firedShotIndex,
        this.isAdsActive,
      ) * recoilMult;
    const spreadDeg = radToDeg(spreadRad);

    const pelletHits: HitscanResult[] = [];
    let primaryDir: Vec3 = { x: 0, y: 0, z: -1 };
    const triggeredButtons = new Set<RangeButtonId>();

    for (let p = 0; p < pelletCount; p += 1) {
      const applied = applySpreadAndRecoilToAngles(
        baseYaw,
        basePitch,
        recoilPitchRad,
        recoilYawRad,
        spreadRad,
        this.recoil.rng,
      );
      if (p === 0) {
        primaryDir = applied.dir;
      }

      const hit = performHitscan(
        origin,
        applied.dir,
        HITSCAN_MAX_DISTANCE_M,
        this.physicsWorld,
        this.dummies.dummies,
        this.mapDef.rangeButtons,
      );
      pelletHits.push(hit);

      if (hit.hitZone === 'world') {
        const worldCheck = this.physicsWorld.castWorldRay(
          origin,
          applied.dir,
          hit.distance + 0.05,
        );
        if (worldCheck?.dynamicEffectId) {
          const barrierDmg = computeDamage(weaponStats, 'body', hit.distance);
          const destroyEvt = this.abilitySystem.damageWorldEffect(
            worldCheck.dynamicEffectId,
            barrierDmg,
            'A',
            true,
          );
          if (destroyEvt && destroyEvt.type === 'effect_event') {
            this.events.emit('effectEvent', {
              effectId: destroyEvt.effectId,
              kind: destroyEvt.kind,
              action: destroyEvt.action,
              pos: vec3Clone(destroyEvt.pos),
            });
          }
        } else if (isImpactOnSprayWall(hit, this.mapDef.sprayWallBounds)) {
          this.sprayImpacts.push(vec3Clone(hit.point));
          if (this.sprayImpacts.length > MAX_SPRAY_WALL_IMPACTS) {
            this.sprayImpacts.shift();
          }
        }
      } else if (hit.hitZone === 'button' && hit.buttonId) {
        if (!triggeredButtons.has(hit.buttonId)) {
          triggeredButtons.add(hit.buttonId);
          this.triggerRangeButton(hit.buttonId, hit.point);
        }
      } else if ((hit.hitZone === 'head' || hit.hitZone === 'body') && hit.dummyId) {
        const dmg = computeDamage(weaponStats, hit.hitZone, hit.distance);
        const outcome = this.dummies.applyDamage(hit.dummyId, dmg, hit.hitZone);
        if (outcome.applied) {
          this.totalHits += 1;
          this.events.emit('hit', {
            dummyId: hit.dummyId,
            hitZone: hit.hitZone,
            damage: outcome.damage,
            killed: outcome.killed,
            point: vec3Clone(hit.point),
            remainingHp: outcome.remainingHp,
            remainingArmor: outcome.remainingArmor,
            weaponId: weaponStats.id,
          });

          if (outcome.killed) {
            this.totalKills += 1;
            this.events.emit('kill', {
              dummyId: hit.dummyId,
              hitZone: hit.hitZone,
              damage: outcome.damage,
              point: vec3Clone(hit.point),
              weaponId: weaponStats.id,
              totalKills: this.totalKills,
            });
          }
        }
      }
    }

    this.recoil.onFire(weaponStats);

    this.events.emit('shot', {
      weaponId: weaponStats.id,
      origin,
      dir: primaryDir,
      hit: pelletHits[0],
      pelletHits,
      spreadDeg,
      shotIndex: firedShotIndex,
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.clear();
    if (this.motor) {
      this.motor.dispose();
    }
    if (this.physicsWorld) {
      this.physicsWorld.dispose();
    }
  }
}
