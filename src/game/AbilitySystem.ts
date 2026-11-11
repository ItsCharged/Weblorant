import {
  aimDirectionFromAngles,
  clamp,
  vec3Add,
  vec3Clone,
  vec3Dist,
  vec3Len,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from '../core/math';
import type {
  AbilitySlot,
  ActiveWorldEffect,
  CharacterId,
  MatchPhase,
  NetGameEvent,
  PlayerAbilityState,
  TeamId,
  Vec3,
} from '../core/types';
import { CHARACTERS } from '../data/characters';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { getFreeAbilityECharges } from './Economy';
import type { DestructibleGadgetTarget } from './PlayerHitscan';

export const RYO_DASH_DISTANCE_M = 8.5;
export const RYO_DASH_DURATION_SEC = 0.22;
export const RYO_DASH_SPEED_MPS = RYO_DASH_DISTANCE_M / RYO_DASH_DURATION_SEC;
export const RYO_DASH_LOCKOUT_SEC = 0.3;
export const RYO_DASH_TRAIL_SEC = 0.45;
export const RYO_ADRENALIN_DURATION_SEC = 4.0;
export const RYO_ADRENALIN_RELOAD_MULT = 1.65;
export const RYO_UEBERLAST_DURATION_SEC = 8.0;
export const RYO_UEBERLAST_SPEED_MULT = 1.25;
export const RYO_UEBERLAST_RECOIL_MULT = 0.7;

export const MIRA_ECHO_MAX_RANGE_M = 28.0;
export const MIRA_ECHO_RADIUS_M = 12.0;
export const MIRA_ECHO_EFFECT_SEC = 2.5;
export const MIRA_ECHO_REVEAL_SEC = 2.0;
export const MIRA_JAMMER_MAX_RANGE_M = 26.0;
export const MIRA_JAMMER_RADIUS_M = 5.5;
export const MIRA_JAMMER_DURATION_SEC = 3.0;
export const MIRA_WEITBLICK_DURATION_SEC = 3.0;
export const ABILITY_SLOW_MULTIPLIER = 0.6;

export const BRANN_SMOKE_MAX_RANGE_M = 30.0;
export const BRANN_SMOKE_RADIUS_M = 4.2;
export const BRANN_SMOKE_DURATION_SEC = 12.0;
export const BRANN_EMBER_MAX_RANGE_M = 26.0;
export const BRANN_EMBER_RADIUS_M = 4.0;
export const BRANN_EMBER_DURATION_SEC = 4.0;
export const BRANN_EMBER_DPS = 25.0;
export const BRANN_DARK_RING_MAX_RANGE_M = 30.0;
export const BRANN_DARK_RING_OUTER_RADIUS_M = 9.5;
export const BRANN_DARK_RING_INNER_RADIUS_M = 7.1;
export const BRANN_DARK_RING_HEIGHT_M = 4.2;
export const BRANN_DARK_RING_DURATION_SEC = 15.0;

export const TESSA_MINE_MAX_RANGE_M = 14.0;
export const TESSA_MINE_RADIUS_M = 3.8;
export const TESSA_MINE_HITBOX_RADIUS_M = 0.32;
export const TESSA_MINE_HP = 40;
export const TESSA_MINE_ARM_SEC = 0.6;
export const TESSA_MINE_TRIGGER_BURST_SEC = 0.4;
export const TESSA_MINE_DEBUFF_SEC = 2.5;
export const TESSA_MINE_ROUND_DURATION_SEC = 180.0;

export const TESSA_SHIELD_OFFSET_M = 2.4;
export const TESSA_SHIELD_WIDTH_M = 3.2;
export const TESSA_SHIELD_HEIGHT_M = 1.15;
export const TESSA_SHIELD_DEPTH_M = 0.45;
export const TESSA_SHIELD_HP = 400;
export const TESSA_SHIELD_DURATION_SEC = 20.0;

export const TESSA_BASTION_RADIUS_M = 7.5;
export const TESSA_BASTION_DURATION_SEC = 6.0;
export const TESSA_BASTION_DAMAGE_MULT = 0.5;

export type CastRejectReason =
  | 'invalid_phase'
  | 'dead'
  | 'channeling_kern'
  | 'no_charges'
  | 'insufficient_ult';

export interface AbilityActor {
  uid: string;
  team: TeamId;
  character: CharacterId;
  alive: boolean;
  pos: Vec3;
  eyePos: Vec3;
  vel: Vec3;
  chargesQ: number;
  chargesE: number;
  ultPoints: number;
  isChannelingKern?: boolean;
  startDash?: (dirX: number, dirZ: number, speedMps: number, durationSec: number) => void;
}

export interface AbilityCastOptions {
  phase?: MatchPhase;
  infiniteCharges?: boolean;
}

export interface AbilityCastResult {
  ok: boolean;
  reason?: CastRejectReason;
  effect?: ActiveWorldEffect;
  events: NetGameEvent[];
}

export interface EmberBurnHit {
  attackerUid: string;
  attackerTeam: TeamId;
  victimUid: string;
  damage: number;
}

export interface AbilityStepResult {
  events: NetGameEvent[];
  burns: EmberBurnHit[];
}

interface PlayerRuntimeAbilityData {
  activeBuff: 'adrenalin' | 'ueberlast' | null;
  buffRemainingSec: number;
  weaponLockoutSec: number;
  slowedSec: number;
  revealedSec: number;
  revealedToTeam: TeamId | null;
  bastionProtected: boolean;
  emberBurnRemainder: number;
}

interface InternalWorldEffect extends ActiveWorldEffect {
  armTimerSec: number;
}

export function createDefaultAbilityState(
  character: CharacterId,
  qCharges = 0,
  eCharges = getFreeAbilityECharges(character),
  ultPoints = 0,
): PlayerAbilityState {
  const def = CHARACTERS[character];
  const qMax = def.abilities.q.maxCharges ?? 1;
  const eMax = def.abilities.e.maxCharges ?? 1;
  const ultMax = def.abilities.ult.ultPoints ?? 7;

  return {
    qCharges: clamp(qCharges, 0, qMax),
    qMax,
    eCharges: clamp(eCharges, 0, eMax),
    eMax,
    ultPoints: clamp(ultPoints, 0, ultMax),
    ultMax,
    activeBuff: null,
    buffRemainingSec: 0,
    weaponLockoutSec: 0,
    slowedSec: 0,
    revealedSec: 0,
    revealedToTeam: null,
    bastionProtected: false,
  };
}

/**
 * Computes combined movement speed multiplier from active buffs (`Überlast` `+25%`),
 * slows (`Störsender` / `Magnetanker` `-40%`), and optional knife sprint (`+12%`).
 */
export function computeAbilitySpeedMultiplier(
  state: Pick<PlayerAbilityState, 'activeBuff' | 'buffRemainingSec' | 'slowedSec'>,
  knifeSprintMult = 1.0,
): number {
  let mult = knifeSprintMult;
  if (state.activeBuff === 'ueberlast' && state.buffRemainingSec > 0) {
    mult *= RYO_UEBERLAST_SPEED_MULT;
  }
  if (state.slowedSec > 0) {
    mult *= ABILITY_SLOW_MULTIPLIER;
  }
  return mult;
}

/**
 * Computes recoil & spread bloom multiplier (`0.70` during Ryo's `Überlast`, else `1.0`).
 */
export function computeAbilityRecoilMultiplier(
  state: Pick<PlayerAbilityState, 'activeBuff' | 'buffRemainingSec'>,
): number {
  if (state.activeBuff === 'ueberlast' && state.buffRemainingSec > 0) {
    return RYO_UEBERLAST_RECOIL_MULT;
  }
  return 1.0;
}

/**
 * Computes reload speed multiplier (`1.65` during Ryo's `Adrenalin`, else `1.0`).
 */
export function computeAbilityReloadMultiplier(
  state: Pick<PlayerAbilityState, 'activeBuff' | 'buffRemainingSec'>,
): number {
  if (state.activeBuff === 'adrenalin' && state.buffRemainingSec > 0) {
    return RYO_ADRENALIN_RELOAD_MULT;
  }
  return 1.0;
}

/**
 * Applies Tessa's `Bollwerk` `-50%` incoming damage reduction (`Math.round(rawDamage * 0.5)`).
 */
export function applyBastionDamageReduction(
  rawDamage: number,
  bastionProtected: boolean,
): number {
  if (rawDamage <= 0) return 0;
  if (!bastionProtected) return rawDamage;
  return Math.round(rawDamage * TESSA_BASTION_DAMAGE_MULT);
}

/**
 * Checks whether the line segment `a -> b` intersects any active opaque `smoke_dome`.
 */
export function isSegmentBlockedBySmoke(
  a: Vec3,
  b: Vec3,
  effects: ReadonlyArray<ActiveWorldEffect>,
): boolean {
  const ab = vec3Sub(b, a);
  const lenSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  if (lenSq <= 1e-8) return false;

  for (const eff of effects) {
    if (eff.kind !== 'smoke_dome' || eff.remainingSec <= 0) continue;
    const center = { x: eff.pos.x, y: eff.pos.y + eff.radius * 0.35, z: eff.pos.z };
    const ac = vec3Sub(center, a);
    const t = clamp((ac.x * ab.x + ac.y * ab.y + ac.z * ab.z) / lenSq, 0, 1);
    const closest = {
      x: a.x + ab.x * t,
      y: a.y + ab.y * t,
      z: a.z + ab.z * t,
    };
    if (vec3Dist(closest, center) <= eff.radius) {
      return true;
    }
  }
  return false;
}

function cloneEffectForSnapshot(eff: ActiveWorldEffect): ActiveWorldEffect {
  return {
    id: eff.id,
    kind: eff.kind,
    ownerUid: eff.ownerUid,
    team: eff.team,
    pos: vec3Clone(eff.pos),
    yaw: eff.yaw,
    radius: eff.radius,
    ...(eff.innerRadius !== undefined ? { innerRadius: eff.innerRadius } : {}),
    ...(eff.height !== undefined ? { height: eff.height } : {}),
    remainingSec: Math.max(0, eff.remainingSec),
    totalSec: eff.totalSec,
    ...(eff.hp !== undefined ? { hp: eff.hp } : {}),
    ...(eff.maxHp !== undefined ? { maxHp: eff.maxHp } : {}),
    ...(eff.armed !== undefined ? { armed: eff.armed } : {}),
    ...(eff.triggered !== undefined ? { triggered: eff.triggered } : {}),
  };
}

/**
 * Authoritative Host-validated Specialist Ability & World Effect Simulation for all 4 Specialists
 * and all 12 tactical abilities.
 * Pure TypeScript — zero 3D rendering or browser DOM imports.
 */
export class AbilitySystem {
  private physicsWorld: PhysicsWorld | null;
  private readonly runtimeByUid = new Map<string, PlayerRuntimeAbilityData>();
  private readonly effects: InternalWorldEffect[] = [];
  private nextEffectCounter = 1;

  constructor(physicsWorld: PhysicsWorld | null = null) {
    this.physicsWorld = physicsWorld;
  }

  public setPhysicsWorld(physicsWorld: PhysicsWorld | null): void {
    this.physicsWorld = physicsWorld;
  }

  public removePlayer(uid: string): void {
    this.runtimeByUid.delete(uid);
  }

  public clearPlayerStatus(uid: string): void {
    this.runtimeByUid.set(uid, this.createFreshRuntime());
  }

  /**
   * Resets active world effects, dynamic barrier colliders, and temporary status timers for a new round.
   */
  public resetForNewRound(players: Iterable<AbilityActor>, fullReset = false): void {
    for (const eff of this.effects) {
      if (eff.kind === 'shield_post') {
        this.physicsWorld?.removeDynamicBlockCollider(eff.id);
      }
    }
    this.effects.length = 0;

    for (const p of players) {
      this.runtimeByUid.set(p.uid, this.createFreshRuntime());
      const freeE = getFreeAbilityECharges(p.character);
      if (fullReset) {
        p.chargesQ = 0;
        p.chargesE = freeE;
        p.ultPoints = 0;
      } else if (freeE > 0) {
        p.chargesE = Math.max(p.chargesE, freeE);
      }
    }
  }

  public getPlayerAbilityState(actor: Pick<AbilityActor, 'uid' | 'character' | 'chargesQ' | 'chargesE' | 'ultPoints'>): PlayerAbilityState {
    const rt = this.getOrCreateRuntime(actor.uid);
    const def = CHARACTERS[actor.character];
    const qMax = def.abilities.q.maxCharges ?? 1;
    const eMax = def.abilities.e.maxCharges ?? 1;
    const ultMax = def.abilities.ult.ultPoints ?? 7;

    return {
      qCharges: clamp(actor.chargesQ, 0, qMax),
      qMax,
      eCharges: clamp(actor.chargesE, 0, eMax),
      eMax,
      ultPoints: clamp(actor.ultPoints, 0, ultMax),
      ultMax,
      activeBuff: rt.buffRemainingSec > 0 ? rt.activeBuff : null,
      buffRemainingSec: Math.max(0, rt.buffRemainingSec),
      weaponLockoutSec: Math.max(0, rt.weaponLockoutSec),
      slowedSec: Math.max(0, rt.slowedSec),
      revealedSec: Math.max(0, rt.revealedSec),
      revealedToTeam: rt.revealedSec > 0 ? rt.revealedToTeam : null,
      bastionProtected: rt.bastionProtected,
    };
  }

  public isWeaponLockedOut(uid: string): boolean {
    const rt = this.runtimeByUid.get(uid);
    return (rt?.weaponLockoutSec ?? 0) > 1e-6;
  }

  public isPlayerBastionProtected(uid: string): boolean {
    const rt = this.runtimeByUid.get(uid);
    return rt?.bastionProtected === true;
  }

  public getEffects(): ReadonlyArray<ActiveWorldEffect> {
    return this.effects;
  }

  public getEffectsSnapshot(): ActiveWorldEffect[] {
    return this.effects.map(cloneEffectForSnapshot);
  }

  /**
   * Returns shootable world gadgets (`magnet_mine`) for analytical ray-sphere hitscan checks.
   * (`shield_post` is already registered as a solid dynamic cuboid in `PhysicsWorld`.)
   */
  public getDestructibleGadgetTargets(): DestructibleGadgetTarget[] {
    const out: DestructibleGadgetTarget[] = [];
    for (const eff of this.effects) {
      if (
        eff.kind === 'magnet_mine' &&
        !eff.triggered &&
        eff.remainingSec > 0 &&
        (eff.hp ?? 0) > 0
      ) {
        out.push({
          id: eff.id,
          team: eff.team,
          center: {
            x: eff.pos.x,
            y: eff.pos.y + TESSA_MINE_HITBOX_RADIUS_M * 0.5,
            z: eff.pos.z,
          },
          radius: TESSA_MINE_HITBOX_RADIUS_M,
        });
      }
    }
    return out;
  }

  /**
   * Applies weapon damage to a destructible world effect (`shield_post` or `magnet_mine`).
   * Returns a `'destroyed'` `NetGameEvent` if the gadget's HP drops to `<= 0`.
   */
  public damageWorldEffect(
    effectId: string,
    rawDamage: number,
    attackerTeam?: TeamId,
    allowFriendlyDamage = false,
  ): NetGameEvent | null {
    if (rawDamage <= 0) return null;
    const idx = this.effects.findIndex((e) => e.id === effectId);
    if (idx < 0) return null;

    const eff = this.effects[idx];
    if (eff.hp === undefined || eff.hp <= 0) return null;

    if (
      eff.kind === 'magnet_mine' &&
      !allowFriendlyDamage &&
      attackerTeam !== undefined &&
      attackerTeam === eff.team
    ) {
      return null;
    }

    eff.hp = Math.max(0, eff.hp - Math.round(rawDamage));
    if (eff.hp <= 0) {
      if (eff.kind === 'shield_post') {
        this.physicsWorld?.removeDynamicBlockCollider(eff.id);
      }
      const destroyedPos = vec3Clone(eff.pos);
      const destroyedKind = eff.kind;
      const destroyedId = eff.id;
      this.effects.splice(idx, 1);
      return {
        type: 'effect_event',
        effectId: destroyedId,
        kind: destroyedKind,
        action: 'destroyed',
        pos: destroyedPos,
      };
    }

    return null;
  }

  /**
   * Validates and executes an ability cast (`'q' | 'e' | 'x'`) for `caster`.
   */
  public castAbility(
    caster: AbilityActor,
    slot: AbilitySlot,
    yaw: number,
    pitch: number,
    targetPos: Vec3 | undefined,
    allPlayers: ReadonlyArray<AbilityActor>,
    options: AbilityCastOptions = {},
  ): AbilityCastResult {
    if (options.phase !== undefined && options.phase !== 'action' && options.phase !== 'planted') {
      return { ok: false, reason: 'invalid_phase', events: [] };
    }

    if (!caster.alive) {
      return { ok: false, reason: 'dead', events: [] };
    }

    if (caster.isChannelingKern) {
      return { ok: false, reason: 'channeling_kern', events: [] };
    }

    const charDef = CHARACTERS[caster.character];
    const infinite = options.infiniteCharges === true;
    const ultRequired = charDef.abilities.ult.ultPoints ?? 7;

    if (!infinite) {
      if (slot === 'q' && caster.chargesQ <= 0) {
        return { ok: false, reason: 'no_charges', events: [] };
      }
      if (slot === 'e' && caster.chargesE <= 0) {
        return { ok: false, reason: 'no_charges', events: [] };
      }
      if (slot === 'x' && caster.ultPoints < ultRequired) {
        return { ok: false, reason: 'insufficient_ult', events: [] };
      }
    }

    if (!infinite) {
      if (slot === 'q') {
        caster.chargesQ = Math.max(0, caster.chargesQ - 1);
      } else if (slot === 'e') {
        caster.chargesE = Math.max(0, caster.chargesE - 1);
      } else {
        caster.ultPoints = 0;
      }
    }

    const abilityName =
      slot === 'q'
        ? charDef.abilities.q.name
        : slot === 'e'
          ? charDef.abilities.e.name
          : charDef.abilities.ult.name;

    const events: NetGameEvent[] = [];
    const casterRt = this.getOrCreateRuntime(caster.uid);
    let spawnedEffect: InternalWorldEffect | undefined;
    let resolvedTargetPos: Vec3 | undefined;

    if (caster.character === 'ryo') {
      if (slot === 'q') {
        // Gleitschritt: rapid ~8.5m horizontal dash over 0.22s + 0.30s weapon lockout
        const horizLen = Math.hypot(caster.vel.x, caster.vel.z);
        let dirX: number;
        let dirZ: number;
        if (horizLen > 0.25) {
          dirX = caster.vel.x / horizLen;
          dirZ = caster.vel.z / horizLen;
        } else {
          dirX = -Math.sin(yaw);
          dirZ = -Math.cos(yaw);
        }

        casterRt.weaponLockoutSec = Math.max(casterRt.weaponLockoutSec, RYO_DASH_LOCKOUT_SEC);
        if (caster.startDash) {
          caster.startDash(dirX, dirZ, RYO_DASH_SPEED_MPS, RYO_DASH_DURATION_SEC);
        }

        resolvedTargetPos = {
          x: caster.pos.x + dirX * RYO_DASH_DISTANCE_M,
          y: caster.pos.y,
          z: caster.pos.z + dirZ * RYO_DASH_DISTANCE_M,
        };
        spawnedEffect = this.pushEffect({
          kind: 'dash_trail',
          ownerUid: caster.uid,
          team: caster.team,
          pos: vec3Clone(caster.pos),
          yaw: Math.atan2(-dirX, -dirZ),
          radius: 0.6,
          remainingSec: RYO_DASH_TRAIL_SEC,
          totalSec: RYO_DASH_TRAIL_SEC,
        });
      } else if (slot === 'e') {
        // Adrenalin: 4.0s reload & equip boost
        casterRt.activeBuff = 'adrenalin';
        casterRt.buffRemainingSec = RYO_ADRENALIN_DURATION_SEC;
      } else {
        // Überlast: 8.0s +25% speed & -30% recoil
        casterRt.activeBuff = 'ueberlast';
        casterRt.buffRemainingSec = RYO_UEBERLAST_DURATION_SEC;
      }
    } else if (caster.character === 'mira') {
      if (slot === 'q') {
        // Echo-Puls: thrown sensor up to 28m -> marks alive enemies within 12m for 2.0s
        const landPos = this.resolveSurfaceTarget(
          caster,
          yaw,
          pitch,
          targetPos,
          MIRA_ECHO_MAX_RANGE_M,
        );
        resolvedTargetPos = landPos;
        spawnedEffect = this.pushEffect({
          kind: 'echo_sensor',
          ownerUid: caster.uid,
          team: caster.team,
          pos: landPos,
          yaw,
          radius: MIRA_ECHO_RADIUS_M,
          remainingSec: MIRA_ECHO_EFFECT_SEC,
          totalSec: MIRA_ECHO_EFFECT_SEC,
        });

        for (const p of allPlayers) {
          if (!p.alive || p.team === caster.team) continue;
          if (vec3Dist(p.pos, landPos) <= MIRA_ECHO_RADIUS_M) {
            const sensorEye = { x: landPos.x, y: landPos.y + 0.35, z: landPos.z };
            if (!isSegmentBlockedBySmoke(sensorEye, p.eyePos, this.effects)) {
              this.applyReveal(p.uid, caster.team, MIRA_ECHO_REVEAL_SEC);
            }
          }
        }
      } else if (slot === 'e') {
        // Störsender: thrown grenade up to 26m -> slows enemies in 5.5m radius by 40% for 3.0s
        const landPos = this.resolveSurfaceTarget(
          caster,
          yaw,
          pitch,
          targetPos,
          MIRA_JAMMER_MAX_RANGE_M,
        );
        resolvedTargetPos = landPos;
        spawnedEffect = this.pushEffect({
          kind: 'jammer_field',
          ownerUid: caster.uid,
          team: caster.team,
          pos: landPos,
          yaw,
          radius: MIRA_JAMMER_RADIUS_M,
          remainingSec: MIRA_JAMMER_DURATION_SEC,
          totalSec: MIRA_JAMMER_DURATION_SEC,
        });

        for (const p of allPlayers) {
          if (!p.alive || p.team === caster.team) continue;
          if (this.isWithinGroundZone(p.pos, landPos, MIRA_JAMMER_RADIUS_M, 2.8)) {
            this.applySlow(p.uid, MIRA_JAMMER_DURATION_SEC);
          }
        }
      } else {
        // Weitblick: reveals ALL alive enemies on the map for 3.0s
        spawnedEffect = this.pushEffect({
          kind: 'global_reveal',
          ownerUid: caster.uid,
          team: caster.team,
          pos: vec3Clone(caster.pos),
          yaw,
          radius: 80.0,
          remainingSec: MIRA_WEITBLICK_DURATION_SEC,
          totalSec: MIRA_WEITBLICK_DURATION_SEC,
        });

        for (const p of allPlayers) {
          if (!p.alive || p.team === caster.team) continue;
          this.applyReveal(p.uid, caster.team, MIRA_WEITBLICK_DURATION_SEC);
        }
      }
    } else if (caster.character === 'brann') {
      if (slot === 'q') {
        // Nebelkuppel: opaque smoke sphere (r = 4.2m, 12.0s) clamped <= 30.0m
        const smokePos = this.resolveSurfaceTarget(
          caster,
          yaw,
          pitch,
          targetPos,
          BRANN_SMOKE_MAX_RANGE_M,
        );
        resolvedTargetPos = smokePos;
        spawnedEffect = this.pushEffect({
          kind: 'smoke_dome',
          ownerUid: caster.uid,
          team: caster.team,
          pos: smokePos,
          yaw,
          radius: BRANN_SMOKE_RADIUS_M,
          remainingSec: BRANN_SMOKE_DURATION_SEC,
          totalSec: BRANN_SMOKE_DURATION_SEC,
        });
      } else if (slot === 'e') {
        // Glutfeld: incendiary zone (r = 4.0m, 4.0s, 25 dmg/s) up to 26.0m
        const emberPos = this.resolveSurfaceTarget(
          caster,
          yaw,
          pitch,
          targetPos,
          BRANN_EMBER_MAX_RANGE_M,
        );
        resolvedTargetPos = emberPos;
        spawnedEffect = this.pushEffect({
          kind: 'ember_field',
          ownerUid: caster.uid,
          team: caster.team,
          pos: emberPos,
          yaw,
          radius: BRANN_EMBER_RADIUS_M,
          remainingSec: BRANN_EMBER_DURATION_SEC,
          totalSec: BRANN_EMBER_DURATION_SEC,
        });
      } else {
        // Dunkelzone: hollow smoke ring (outer = 9.5m, inner = 7.1m, h = 4.2m, 15.0s) up to 30.0m
        const ringPos = this.resolveSurfaceTarget(
          caster,
          yaw,
          pitch,
          targetPos,
          BRANN_DARK_RING_MAX_RANGE_M,
        );
        resolvedTargetPos = ringPos;
        spawnedEffect = this.pushEffect({
          kind: 'dark_ring',
          ownerUid: caster.uid,
          team: caster.team,
          pos: ringPos,
          yaw,
          radius: BRANN_DARK_RING_OUTER_RADIUS_M,
          innerRadius: BRANN_DARK_RING_INNER_RADIUS_M,
          height: BRANN_DARK_RING_HEIGHT_M,
          remainingSec: BRANN_DARK_RING_DURATION_SEC,
          totalSec: BRANN_DARK_RING_DURATION_SEC,
        });
      }
    } else if (caster.character === 'tessa') {
      if (slot === 'q') {
        // Magnetanker: proximity mine up to 14m, arms after 0.6s, 40 HP
        const minePos = this.resolveSurfaceTarget(
          caster,
          yaw,
          pitch,
          targetPos,
          TESSA_MINE_MAX_RANGE_M,
        );
        resolvedTargetPos = minePos;
        spawnedEffect = this.pushEffect({
          kind: 'magnet_mine',
          ownerUid: caster.uid,
          team: caster.team,
          pos: minePos,
          yaw,
          radius: TESSA_MINE_RADIUS_M,
          remainingSec: TESSA_MINE_ROUND_DURATION_SEC,
          totalSec: TESSA_MINE_ROUND_DURATION_SEC,
          hp: TESSA_MINE_HP,
          maxHp: TESSA_MINE_HP,
          armed: false,
          triggered: false,
        });
      } else if (slot === 'e') {
        // Schildpfosten: waist-high 400 HP physical barrier 2.4m ahead perpendicular to yaw for 20.0s
        const barrierPos = this.resolveBarrierPlacement(caster, yaw);
        resolvedTargetPos = barrierPos;
        spawnedEffect = this.pushEffect({
          kind: 'shield_post',
          ownerUid: caster.uid,
          team: caster.team,
          pos: barrierPos,
          yaw,
          radius: TESSA_SHIELD_WIDTH_M * 0.5,
          height: TESSA_SHIELD_HEIGHT_M,
          remainingSec: TESSA_SHIELD_DURATION_SEC,
          totalSec: TESSA_SHIELD_DURATION_SEC,
          hp: TESSA_SHIELD_HP,
          maxHp: TESSA_SHIELD_HP,
        });

        this.physicsWorld?.addDynamicBlockCollider(
          spawnedEffect.id,
          {
            x: barrierPos.x,
            y: barrierPos.y + TESSA_SHIELD_HEIGHT_M * 0.5,
            z: barrierPos.z,
          },
          {
            x: TESSA_SHIELD_WIDTH_M,
            y: TESSA_SHIELD_HEIGHT_M,
            z: TESSA_SHIELD_DEPTH_M,
          },
          yaw,
        );
      } else {
        // Bollwerk: 7.5m protective zone at Tessa's position granting allies 50% damage reduction for 6.0s
        const bastionPos = this.snapToFloorBelow(caster.pos);
        resolvedTargetPos = bastionPos;
        spawnedEffect = this.pushEffect({
          kind: 'bastion_zone',
          ownerUid: caster.uid,
          team: caster.team,
          pos: bastionPos,
          yaw,
          radius: TESSA_BASTION_RADIUS_M,
          remainingSec: TESSA_BASTION_DURATION_SEC,
          totalSec: TESSA_BASTION_DURATION_SEC,
        });
        this.refreshBastionProtection(allPlayers);
      }
    }

    events.push({
      type: 'ability_cast',
      uid: caster.uid,
      team: caster.team,
      character: caster.character,
      slot,
      abilityName,
      origin: vec3Clone(caster.pos),
      ...(resolvedTargetPos ? { targetPos: vec3Clone(resolvedTargetPos) } : {}),
    });

    return {
      ok: true,
      ...(spawnedEffect ? { effect: cloneEffectForSnapshot(spawnedEffect) } : {}),
      events,
    };
  }

  /**
   * Advances all player buff/debuff timers, active world effects, proximity triggers,
   * protective zones, and incendiary damage over `dt` seconds.
   */
  public step(dt: number, players: ReadonlyArray<AbilityActor>): AbilityStepResult {
    const events: NetGameEvent[] = [];
    const burns: EmberBurnHit[] = [];

    if (dt <= 0) {
      this.refreshBastionProtection(players);
      return { events, burns };
    }

    // 1. Tick per-player status timers
    for (const p of players) {
      const rt = this.getOrCreateRuntime(p.uid);
      if (!p.alive) {
        rt.activeBuff = null;
        rt.buffRemainingSec = 0;
        rt.weaponLockoutSec = 0;
        rt.slowedSec = 0;
        rt.revealedSec = 0;
        rt.revealedToTeam = null;
        rt.bastionProtected = false;
        rt.emberBurnRemainder = 0;
        continue;
      }

      if (rt.buffRemainingSec > 0) {
        rt.buffRemainingSec = Math.max(0, rt.buffRemainingSec - dt);
        if (rt.buffRemainingSec <= 1e-6) {
          rt.buffRemainingSec = 0;
          rt.activeBuff = null;
        }
      }

      if (rt.weaponLockoutSec > 0) {
        rt.weaponLockoutSec = Math.max(0, rt.weaponLockoutSec - dt);
      }

      if (rt.slowedSec > 0) {
        rt.slowedSec = Math.max(0, rt.slowedSec - dt);
      }

      if (rt.revealedSec > 0) {
        rt.revealedSec = Math.max(0, rt.revealedSec - dt);
        if (rt.revealedSec <= 1e-6) {
          rt.revealedSec = 0;
          rt.revealedToTeam = null;
        }
      }
    }

    // 2. Refresh Bollwerk protection BEFORE evaluating Glutfeld burn ticks
    this.refreshBastionProtection(players);

    // 3. Evaluate active world effects & tick their lifetimes
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const eff = this.effects[i];
      const activeWindowSec = Math.min(dt, Math.max(0, eff.remainingSec));

      if (eff.kind === 'jammer_field' && activeWindowSec > 0) {
        const remainingAfter = Math.max(0, eff.remainingSec - dt);
        for (const p of players) {
          if (!p.alive || p.team === eff.team) continue;
          if (this.isWithinGroundZone(p.pos, eff.pos, eff.radius, 2.8)) {
            this.applySlow(p.uid, Math.max(remainingAfter, Math.min(MIRA_JAMMER_DURATION_SEC, eff.remainingSec)));
          }
        }
      } else if (eff.kind === 'magnet_mine' && !eff.triggered) {
        eff.armTimerSec += dt;
        if (!eff.armed && eff.armTimerSec >= TESSA_MINE_ARM_SEC - 1e-6) {
          eff.armed = true;
        }

        if (eff.armed) {
          let enemyEntered = false;
          for (const p of players) {
            if (!p.alive || p.team === eff.team) continue;
            if (vec3Dist(p.pos, eff.pos) <= eff.radius) {
              enemyEntered = true;
              break;
            }
          }

          if (enemyEntered) {
            eff.triggered = true;
            eff.remainingSec = TESSA_MINE_TRIGGER_BURST_SEC;
            eff.totalSec = TESSA_MINE_TRIGGER_BURST_SEC;

            for (const p of players) {
              if (!p.alive || p.team === eff.team) continue;
              if (vec3Dist(p.pos, eff.pos) <= eff.radius) {
                this.applyReveal(p.uid, eff.team, TESSA_MINE_DEBUFF_SEC);
                this.applySlow(p.uid, TESSA_MINE_DEBUFF_SEC);
              }
            }

            events.push({
              type: 'effect_event',
              effectId: eff.id,
              kind: 'magnet_mine',
              action: 'triggered',
              pos: vec3Clone(eff.pos),
            });
            continue;
          }
        }
      } else if (eff.kind === 'ember_field' && activeWindowSec > 0) {
        for (const p of players) {
          if (!p.alive || p.team === eff.team) continue;
          if (this.isWithinGroundZone(p.pos, eff.pos, eff.radius, 2.4)) {
            const rt = this.getOrCreateRuntime(p.uid);
            const dps = rt.bastionProtected
              ? BRANN_EMBER_DPS * TESSA_BASTION_DAMAGE_MULT
              : BRANN_EMBER_DPS;
            rt.emberBurnRemainder += dps * activeWindowSec;
            const intDamage = Math.floor(rt.emberBurnRemainder + 1e-6);
            if (intDamage >= 1) {
              rt.emberBurnRemainder = Math.max(0, rt.emberBurnRemainder - intDamage);
              burns.push({
                attackerUid: eff.ownerUid,
                attackerTeam: eff.team,
                victimUid: p.uid,
                damage: intDamage,
              });
            }
          }
        }
      }

      eff.remainingSec -= dt;
      if (eff.remainingSec <= 1e-6) {
        if (eff.kind === 'shield_post') {
          this.physicsWorld?.removeDynamicBlockCollider(eff.id);
          events.push({
            type: 'effect_event',
            effectId: eff.id,
            kind: 'shield_post',
            action: 'destroyed',
            pos: vec3Clone(eff.pos),
          });
        }
        this.effects.splice(i, 1);
      }
    }

    // 4. Re-sync Bollwerk flags in case a bastion_zone expired on this tick
    this.refreshBastionProtection(players);

    return { events, burns };
  }

  private refreshBastionProtection(players: ReadonlyArray<AbilityActor>): void {
    for (const p of players) {
      const rt = this.getOrCreateRuntime(p.uid);
      if (!p.alive) {
        rt.bastionProtected = false;
        continue;
      }

      let insideFriendlyBastion = false;
      for (const eff of this.effects) {
        if (eff.kind !== 'bastion_zone' || eff.remainingSec <= 1e-6 || eff.team !== p.team) {
          continue;
        }
        if (this.isWithinGroundZone(p.pos, eff.pos, eff.radius, 3.0)) {
          insideFriendlyBastion = true;
          break;
        }
      }
      rt.bastionProtected = insideFriendlyBastion;
    }
  }

  private applySlow(uid: string, durationSec: number): void {
    const rt = this.getOrCreateRuntime(uid);
    rt.slowedSec = Math.max(rt.slowedSec, durationSec);
  }

  private applyReveal(uid: string, toTeam: TeamId, durationSec: number): void {
    const rt = this.getOrCreateRuntime(uid);
    if (durationSec >= rt.revealedSec) {
      rt.revealedSec = durationSec;
      rt.revealedToTeam = toTeam;
    }
  }

  private isWithinGroundZone(
    targetPos: Vec3,
    zonePos: Vec3,
    radius: number,
    maxVerticalDelta: number,
  ): boolean {
    const dx = targetPos.x - zonePos.x;
    const dz = targetPos.z - zonePos.z;
    if (dx * dx + dz * dz > radius * radius) {
      return false;
    }
    return Math.abs(targetPos.y - zonePos.y) <= maxVerticalDelta;
  }

  private resolveSurfaceTarget(
    caster: AbilityActor,
    yaw: number,
    pitch: number,
    explicitTargetPos: Vec3 | undefined,
    maxRangeM: number,
  ): Vec3 {
    let candidate: Vec3;

    if (explicitTargetPos) {
      const delta = vec3Sub(explicitTargetPos, caster.pos);
      const dist = vec3Len(delta);
      if (dist > maxRangeM && dist > 1e-6) {
        candidate = vec3Add(caster.pos, vec3Scale(delta, maxRangeM / dist));
      } else {
        candidate = vec3Clone(explicitTargetPos);
      }
    } else {
      const aimDir = aimDirectionFromAngles(yaw, pitch);
      const hit = this.physicsWorld?.castWorldRay(caster.eyePos, aimDir, maxRangeM) ?? null;
      if (hit) {
        candidate = vec3Add(hit.point, vec3Scale(hit.normal, 0.12));
      } else {
        candidate = vec3Add(caster.eyePos, vec3Scale(aimDir, maxRangeM));
      }
    }

    const snapped = this.snapToFloorBelow(candidate);
    const offsetFromCaster = vec3Sub(snapped, caster.pos);
    const distFromCaster = vec3Len(offsetFromCaster);
    if (distFromCaster > maxRangeM && distFromCaster > 1e-6) {
      const clamped = vec3Add(caster.pos, vec3Scale(offsetFromCaster, maxRangeM / distFromCaster));
      return this.snapToFloorBelow(clamped, caster.pos, maxRangeM);
    }
    return snapped;
  }

  private resolveBarrierPlacement(caster: AbilityActor, yaw: number): Vec3 {
    const fwd = vec3Normalize({
      x: -Math.sin(yaw),
      y: 0,
      z: -Math.cos(yaw),
    });
    const rayOrigin = {
      x: caster.pos.x,
      y: caster.pos.y + 0.6,
      z: caster.pos.z,
    };
    const wallHit = this.physicsWorld?.castWorldRay(rayOrigin, fwd, TESSA_SHIELD_OFFSET_M + 0.35) ?? null;
    const dist = wallHit
      ? Math.max(0.85, wallHit.distance - 0.35)
      : TESSA_SHIELD_OFFSET_M;

    const candidate = {
      x: caster.pos.x + fwd.x * dist,
      y: caster.pos.y + 0.4,
      z: caster.pos.z + fwd.z * dist,
    };
    return this.snapToFloorBelow(candidate);
  }

  private snapToFloorBelow(pos: Vec3, clampOrigin?: Vec3, maxRangeM?: number): Vec3 {
    let snapped: Vec3;
    if (this.physicsWorld) {
      const start = { x: pos.x, y: Math.max(pos.y + 0.35, 0.35), z: pos.z };
      const downHit = this.physicsWorld.castWorldRay(start, { x: 0, y: -1, z: 0 }, 24.0);
      if (downHit) {
        snapped = {
          x: pos.x,
          y: downHit.point.y,
          z: pos.z,
        };
      } else {
        snapped = { x: pos.x, y: Math.max(0, pos.y), z: pos.z };
      }
    } else {
      snapped = { x: pos.x, y: Math.max(0, pos.y), z: pos.z };
    }

    if (clampOrigin !== undefined && maxRangeM !== undefined) {
      const diff = vec3Sub(snapped, clampOrigin);
      const d = vec3Len(diff);
      if (d > maxRangeM && d > 1e-6) {
        const scale = (maxRangeM - 1e-4) / d;
        return {
          x: clampOrigin.x + diff.x * scale,
          y: snapped.y,
          z: clampOrigin.z + diff.z * scale,
        };
      }
    }
    return snapped;
  }

  private pushEffect(
    params: Omit<InternalWorldEffect, 'id' | 'armTimerSec'>,
  ): InternalWorldEffect {
    const id = `eff_${this.nextEffectCounter++}`;
    const entry: InternalWorldEffect = {
      id,
      ...params,
      armTimerSec: 0,
    };
    this.effects.push(entry);
    return entry;
  }

  private getOrCreateRuntime(uid: string): PlayerRuntimeAbilityData {
    let rt = this.runtimeByUid.get(uid);
    if (!rt) {
      rt = this.createFreshRuntime();
      this.runtimeByUid.set(uid, rt);
    }
    return rt;
  }

  private createFreshRuntime(): PlayerRuntimeAbilityData {
    return {
      activeBuff: null,
      buffRemainingSec: 0,
      weaponLockoutSec: 0,
      slowedSec: 0,
      revealedSec: 0,
      revealedToTeam: null,
      bastionProtected: false,
      emberBurnRemainder: 0,
    };
  }
}
