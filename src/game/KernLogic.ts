import {
  KERN_DEFUSE_CHECKPOINT,
  KERN_DEFUSE_SEC,
  KERN_FUSE_SEC,
  KERN_PLANT_SEC,
} from '../core/Config';
import { clamp, vec3Clone, vec3Dist } from '../core/math';
import type {
  KernSnapshot,
  KernStatus,
  MatchPhase,
  NetGameEvent,
  TeamId,
  Vec3,
} from '../core/types';
import type { MapZone } from '../data/maps/types';

export const KERN_PICKUP_RADIUS_M = 1.8;
export const KERN_DEFUSE_RADIUS_M = 2.2;
export const KERN_BLAST_RADIUS_M = 22.0;
export const KERN_PLANT_MAX_SPEED_MPS = 1.5;

export interface KernActorState {
  uid: string;
  team: TeamId;
  alive: boolean;
  pos: Vec3;
  grounded: boolean;
  horizontalSpeed: number;
  holdKern: boolean;
}

export interface KernActionStepOutcome {
  events: NetGameEvent[];
  justPlantedByUid?: string;
  plantedZone?: 'A' | 'B';
}

export interface KernPlantedStepOutcome {
  events: NetGameEvent[];
  defusedByUid?: string;
  detonated: boolean;
}

/**
 * Checks whether `pos` lies inside `kern_site_a` or `kern_site_b` AABB.
 */
export function getContainingPlantZone(
  pos: Vec3,
  zones: ReadonlyArray<MapZone> | undefined,
): 'A' | 'B' | null {
  if (!zones) return null;
  for (const zone of zones) {
    if (zone.type !== 'kern_site_a' && zone.type !== 'kern_site_b') continue;
    const halfX = zone.size.x * 0.5;
    const halfZ = zone.size.z * 0.5;
    if (
      Math.abs(pos.x - zone.center.x) <= halfX &&
      Math.abs(pos.z - zone.center.z) <= halfZ &&
      Math.abs(pos.y - zone.center.y) <= 2.6
    ) {
      return zone.type === 'kern_site_a' ? 'A' : 'B';
    }
  }
  return null;
}

export function canPlayerPlantAt(
  pos: Vec3,
  team: TeamId,
  alive: boolean,
  hasKern: boolean,
  grounded: boolean,
  horizontalSpeed: number,
  phase: MatchPhase,
  zones: ReadonlyArray<MapZone> | undefined,
): 'A' | 'B' | null {
  if (phase !== 'action' || !alive || team !== 'A' || !hasKern) return null;
  if (!grounded || horizontalSpeed >= KERN_PLANT_MAX_SPEED_MPS) return null;
  return getContainingPlantZone(pos, zones);
}

export function canPlayerDefuseAt(
  pos: Vec3,
  team: TeamId,
  alive: boolean,
  phase: MatchPhase,
  kernPos: Vec3,
  kernStatus: KernStatus,
): boolean {
  if (phase !== 'planted' || !alive || team !== 'D') return false;
  if (kernStatus !== 'planted' && kernStatus !== 'defusing') return false;
  return vec3Dist(pos, kernPos) <= KERN_DEFUSE_RADIUS_M;
}

/**
 * Pure deterministic Kern device state machine (carry, drop, auto-pickup,
 * 4.0 s plant, 40.0 s fuse, and 7.0 s defuse with 50 % checkpoint persistence).
 * Pure TypeScript — zero 3D engine or DOM imports.
 */
export class KernController {
  public status: KernStatus = 'carried';
  public pos: Vec3 = { x: 0, y: 0.05, z: 52 };
  public carrierUid: string | undefined = undefined;
  public plantedZone: 'A' | 'B' | undefined = undefined;
  public actorUid: string | undefined = undefined;
  public plantTimerSec = 0;
  public defuseTimerSec = 0;
  public halfDefused = false;
  public fuseRemainingSec = KERN_FUSE_SEC;
  public wasPlantedThisRound = false;

  /**
   * Resets the Kern at round start and assigns it to the first alive Attacker (`team === 'A'`).
   */
  public resetForRound(
    players: ReadonlyArray<{ uid: string; team: TeamId; alive: boolean; pos: Vec3 }>,
    fallbackDropPos: Vec3 = { x: 0, y: 0.05, z: 50 },
  ): void {
    const firstAttacker = players.find((p) => p.alive && p.team === 'A');
    if (firstAttacker) {
      this.status = 'carried';
      this.carrierUid = firstAttacker.uid;
      this.pos = vec3Clone(firstAttacker.pos);
    } else {
      this.status = 'dropped';
      this.carrierUid = undefined;
      this.pos = vec3Clone(fallbackDropPos);
    }

    this.plantedZone = undefined;
    this.actorUid = undefined;
    this.plantTimerSec = 0;
    this.defuseTimerSec = 0;
    this.halfDefused = false;
    this.fuseRemainingSec = KERN_FUSE_SEC;
    this.wasPlantedThisRound = false;
  }

  /**
   * Synchronizes carrier position during Buy Phase (or assigns to a newly joined Attacker if dropped in spawn).
   */
  public syncBuyPhase(players: ReadonlyArray<KernActorState>): NetGameEvent[] {
    const events: NetGameEvent[] = [];

    if (this.status === 'carried' && this.carrierUid) {
      const carrier = players.find((p) => p.uid === this.carrierUid);
      if (carrier && carrier.alive && carrier.team === 'A') {
        this.pos = vec3Clone(carrier.pos);
        return events;
      }
      const dropEvt = this.dropFromCarrier(carrier?.pos);
      if (dropEvt) events.push(dropEvt);
    }

    if (this.status === 'dropped') {
      const firstAttacker = players.find((p) => p.alive && p.team === 'A');
      if (firstAttacker) {
        this.status = 'carried';
        this.carrierUid = firstAttacker.uid;
        this.pos = vec3Clone(firstAttacker.pos);
        events.push({
          type: 'kern_event',
          action: 'picked_up',
          uid: firstAttacker.uid,
          pos: vec3Clone(this.pos),
        });
      }
    }

    return events;
  }

  /**
   * Drops the Kern onto the ground at `dropPos` when its carrier dies or disconnects.
   */
  public dropFromCarrier(dropPos?: Vec3): NetGameEvent | null {
    if (this.status !== 'carried' && this.status !== 'planting') {
      return null;
    }

    const prevCarrier = this.carrierUid;
    if (dropPos) {
      this.pos = { x: dropPos.x, y: Math.max(0, dropPos.y), z: dropPos.z };
    }
    this.status = 'dropped';
    this.carrierUid = undefined;
    this.actorUid = undefined;
    this.plantedZone = undefined;
    this.plantTimerSec = 0;

    return {
      type: 'kern_event',
      action: 'dropped',
      uid: prevCarrier,
      pos: vec3Clone(this.pos),
    };
  }

  /**
   * Steps Kern carry/drop/pickup & `4.0 s` planting channel during `'action'` phase.
   */
  public stepActionPhase(
    dt: number,
    players: ReadonlyArray<KernActorState>,
    zones: ReadonlyArray<MapZone> | undefined,
  ): KernActionStepOutcome {
    const events: NetGameEvent[] = [];

    if (this.status === 'carried' || this.status === 'planting') {
      const carrier = this.carrierUid
        ? players.find((p) => p.uid === this.carrierUid)
        : undefined;

      if (!carrier || !carrier.alive || carrier.team !== 'A') {
        const dropEv = this.dropFromCarrier(carrier?.pos);
        if (dropEv) events.push(dropEv);
      } else {
        this.pos = vec3Clone(carrier.pos);
        const zone = getContainingPlantZone(carrier.pos, zones);
        const canChannelPlant =
          zone !== null &&
          carrier.holdKern &&
          carrier.grounded &&
          carrier.horizontalSpeed < KERN_PLANT_MAX_SPEED_MPS;

        if (canChannelPlant && zone !== null) {
          if (this.status !== 'planting' || this.plantedZone !== zone) {
            this.status = 'planting';
            this.actorUid = carrier.uid;
            this.plantedZone = zone;
            this.plantTimerSec = 0;
            events.push({
              type: 'kern_event',
              action: 'plant_start',
              uid: carrier.uid,
              zone,
              pos: vec3Clone(this.pos),
            });
          }

          this.plantTimerSec += dt;
          if (this.plantTimerSec >= KERN_PLANT_SEC - 1e-6) {
            const planterUid = carrier.uid;
            this.plantTimerSec = KERN_PLANT_SEC;
            this.status = 'planted';
            this.wasPlantedThisRound = true;
            this.carrierUid = undefined;
            this.actorUid = undefined;
            this.fuseRemainingSec = KERN_FUSE_SEC;
            this.defuseTimerSec = 0;
            this.halfDefused = false;

            events.push({
              type: 'kern_event',
              action: 'planted',
              uid: planterUid,
              zone,
              pos: vec3Clone(this.pos),
            });

            return {
              events,
              justPlantedByUid: planterUid,
              plantedZone: zone,
            };
          }
        } else if (this.status === 'planting') {
          this.status = 'carried';
          this.actorUid = undefined;
          this.plantedZone = undefined;
          this.plantTimerSec = 0;
        }
      }
    }

    if (this.status === 'dropped') {
      let closestAttacker: KernActorState | null = null;
      let closestDist = KERN_PICKUP_RADIUS_M;

      for (const p of players) {
        if (!p.alive || p.team !== 'A') continue;
        const d = vec3Dist(p.pos, this.pos);
        if (d <= closestDist) {
          closestDist = d;
          closestAttacker = p;
        }
      }

      if (closestAttacker) {
        this.status = 'carried';
        this.carrierUid = closestAttacker.uid;
        this.pos = vec3Clone(closestAttacker.pos);
        this.plantTimerSec = 0;
        events.push({
          type: 'kern_event',
          action: 'picked_up',
          uid: closestAttacker.uid,
          pos: vec3Clone(this.pos),
        });
      }
    }

    return { events };
  }

  /**
   * Steps `40.0 s` fuse countdown and `7.0 s` Defender defuse channel (with `50 %` / `3.5 s` checkpoint).
   */
  public stepPlantedPhase(
    dt: number,
    players: ReadonlyArray<KernActorState>,
  ): KernPlantedStepOutcome {
    const events: NetGameEvent[] = [];
    const checkpointSec = KERN_DEFUSE_SEC * KERN_DEFUSE_CHECKPOINT;

    this.fuseRemainingSec = Math.max(0, this.fuseRemainingSec - dt);

    // Preserve active defuser if still holding within 2.2m; otherwise find closest eligible Defender
    let activeDefuser: KernActorState | undefined;
    if (this.status === 'defusing' && this.actorUid) {
      const existing = players.find((p) => p.uid === this.actorUid);
      if (
        existing &&
        existing.alive &&
        existing.team === 'D' &&
        existing.holdKern &&
        vec3Dist(existing.pos, this.pos) <= KERN_DEFUSE_RADIUS_M
      ) {
        activeDefuser = existing;
      }
    }

    if (!activeDefuser) {
      let bestDist = KERN_DEFUSE_RADIUS_M;
      for (const p of players) {
        if (!p.alive || p.team !== 'D' || !p.holdKern) continue;
        const d = vec3Dist(p.pos, this.pos);
        if (d <= bestDist) {
          bestDist = d;
          activeDefuser = p;
        }
      }
    }

    if (activeDefuser) {
      if (this.status !== 'defusing' || this.actorUid !== activeDefuser.uid) {
        this.status = 'defusing';
        this.actorUid = activeDefuser.uid;
        this.defuseTimerSec = this.halfDefused ? checkpointSec : 0;
        events.push({
          type: 'kern_event',
          action: 'defuse_start',
          uid: activeDefuser.uid,
          zone: this.plantedZone,
          pos: vec3Clone(this.pos),
        });
      }

      this.defuseTimerSec += dt;

      if (!this.halfDefused && this.defuseTimerSec >= checkpointSec - 1e-6) {
        this.halfDefused = true;
        events.push({
          type: 'kern_event',
          action: 'half_defused',
          uid: activeDefuser.uid,
          zone: this.plantedZone,
          pos: vec3Clone(this.pos),
        });
      }

      if (this.defuseTimerSec >= KERN_DEFUSE_SEC - 1e-6) {
        const defuserUid = activeDefuser.uid;
        this.defuseTimerSec = KERN_DEFUSE_SEC;
        this.status = 'defused';
        this.actorUid = undefined;
        events.push({
          type: 'kern_event',
          action: 'defused',
          uid: defuserUid,
          zone: this.plantedZone,
          pos: vec3Clone(this.pos),
        });
        return {
          events,
          defusedByUid: defuserUid,
          detonated: false,
        };
      }
    } else if (this.status === 'defusing') {
      // Defender released before full completion: reset to 3.5 s if 50% checkpoint latched, else 0!
      this.status = 'planted';
      this.actorUid = undefined;
      this.defuseTimerSec = this.halfDefused ? checkpointSec : 0;
    }

    if (this.fuseRemainingSec <= 1e-6) {
      this.fuseRemainingSec = 0;
      this.status = 'detonated';
      this.actorUid = undefined;
      events.push({
        type: 'kern_event',
        action: 'detonated',
        zone: this.plantedZone,
        pos: vec3Clone(this.pos),
      });
      return {
        events,
        detonated: true,
      };
    }

    return {
      events,
      detonated: false,
    };
  }

  public getProgress01(): number {
    if (this.status === 'planting') {
      return clamp(this.plantTimerSec / KERN_PLANT_SEC, 0, 1);
    }
    if (this.status === 'defusing') {
      return clamp(this.defuseTimerSec / KERN_DEFUSE_SEC, 0, 1);
    }
    if (this.status === 'planted') {
      return this.halfDefused ? KERN_DEFUSE_CHECKPOINT : 0;
    }
    if (this.status === 'defused') {
      return 1;
    }
    return 0;
  }

  public toSnapshot(): KernSnapshot {
    return {
      status: this.status,
      pos: vec3Clone(this.pos),
      ...(this.carrierUid ? { carrierUid: this.carrierUid } : {}),
      ...(this.plantedZone ? { plantedZone: this.plantedZone } : {}),
      ...(this.actorUid ? { actorUid: this.actorUid } : {}),
      progress01: this.getProgress01(),
      halfDefused: this.halfDefused,
      fuseRemainingSec: Math.max(0, this.fuseRemainingSec),
    };
  }
}
