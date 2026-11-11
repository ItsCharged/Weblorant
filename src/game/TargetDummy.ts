import { mulberry32, vec3Clone } from '../core/math';
import type { Vec3 } from '../core/types';
import type { DummySpawnDef } from '../data/maps/types';

export const DUMMY_MAX_HP = 100;
export const DUMMY_ARMOR_SHIELD = 50;
export const DUMMY_RESPAWN_TIME_SEC = 2.5;
export const DUMMY_HIT_FLASH_DURATION_SEC = 0.12;
export const CHALLENGE_TOTAL_TARGETS = 30;
export const CHALLENGE_TARGET_LIFETIME_SEC = 3.0;
export const CHALLENGE_SPAWN_DELAY_SEC = 0.18;

export interface DummyEntity {
  id: string;
  spawnPos: Vec3;
  pos: Vec3;
  yaw: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  alive: boolean;
  respawnTimer: number;
  hitFlashTimer: number;
  lastDamage: number;
  lastHitZone: 'head' | 'body' | 'none';
  patrolAmplitude: number;
  patrolAxis: 'x' | 'z';
  patrolSpeed: number;
  patrolPhase: number;
}

export interface ChallengeState {
  active: boolean;
  totalTargets: number;
  spawnedCount: number;
  hits: number;
  remaining: number;
  elapsedSec: number;
  targetLifetimeTimer: number;
  nextSpawnDelayTimer: number;
  activeDummyId: string | null;
  completed: boolean;
  lastScoreHits: number;
  lastScoreTimeSec: number;
}

export interface DamageOutcome {
  applied: boolean;
  damage: number;
  killed: boolean;
  remainingHp: number;
  remainingArmor: number;
}

export class DummyManager {
  public dummies: DummyEntity[] = [];
  public strafeEnabled = false;
  public armorEnabled = false;
  public challenge: ChallengeState = {
    active: false,
    totalTargets: CHALLENGE_TOTAL_TARGETS,
    spawnedCount: 0,
    hits: 0,
    remaining: 0,
    elapsedSec: 0,
    targetLifetimeTimer: 0,
    nextSpawnDelayTimer: 0,
    activeDummyId: null,
    completed: false,
    lastScoreHits: 0,
    lastScoreTimeSec: 0,
  };

  private rng: () => number;
  private lastChallengeDummyId: string | null = null;

  constructor(spawns: ReadonlyArray<DummySpawnDef> = [], seed = 0x9e3779b9) {
    this.rng = mulberry32(seed);
    if (spawns.length > 0) {
      this.loadSpawns(spawns);
    }
  }

  public loadSpawns(spawns: ReadonlyArray<DummySpawnDef>): void {
    this.stopChallenge(false);
    this.dummies = spawns.map((def, idx) => {
      const maxArmor = this.armorEnabled ? DUMMY_ARMOR_SHIELD : 0;
      return {
        id: def.id,
        spawnPos: vec3Clone(def.pos),
        pos: vec3Clone(def.pos),
        yaw: def.yaw,
        hp: DUMMY_MAX_HP,
        maxHp: DUMMY_MAX_HP,
        armor: maxArmor,
        maxArmor,
        alive: true,
        respawnTimer: 0,
        hitFlashTimer: 0,
        lastDamage: 0,
        lastHitZone: 'none',
        patrolAmplitude: def.patrolAmplitude ?? 0,
        patrolAxis: def.patrolAxis ?? 'x',
        patrolSpeed: def.patrolSpeed ?? 1.6,
        patrolPhase: (idx * 1.15) % (Math.PI * 2),
      };
    });
  }

  public setArmorEnabled(enabled: boolean): void {
    this.armorEnabled = enabled;
    const maxArmor = enabled ? DUMMY_ARMOR_SHIELD : 0;
    for (const d of this.dummies) {
      d.maxArmor = maxArmor;
      if (d.alive) {
        d.armor = enabled ? DUMMY_ARMOR_SHIELD : 0;
        d.hp = d.maxHp;
      } else {
        d.armor = 0;
      }
    }
  }

  public setStrafeEnabled(enabled: boolean): void {
    this.strafeEnabled = enabled;
    if (!enabled) {
      for (const d of this.dummies) {
        d.pos.x = d.spawnPos.x;
        d.pos.y = d.spawnPos.y;
        d.pos.z = d.spawnPos.z;
      }
    }
  }

  public startChallenge(seed?: number): void {
    if (this.dummies.length === 0) return;
    if (seed !== undefined) {
      this.rng = mulberry32(seed);
    }
    this.lastChallengeDummyId = null;

    for (const d of this.dummies) {
      d.alive = false;
      d.respawnTimer = 0;
      d.hitFlashTimer = 0;
      d.pos.x = d.spawnPos.x;
      d.pos.y = d.spawnPos.y;
      d.pos.z = d.spawnPos.z;
    }

    this.challenge = {
      active: true,
      totalTargets: CHALLENGE_TOTAL_TARGETS,
      spawnedCount: 0,
      hits: 0,
      remaining: CHALLENGE_TOTAL_TARGETS,
      elapsedSec: 0,
      targetLifetimeTimer: 0,
      nextSpawnDelayTimer: CHALLENGE_SPAWN_DELAY_SEC,
      activeDummyId: null,
      completed: false,
      lastScoreHits: this.challenge.lastScoreHits,
      lastScoreTimeSec: this.challenge.lastScoreTimeSec,
    };
  }

  public stopChallenge(restoreDummies = true): void {
    const prevHits = this.challenge.lastScoreHits;
    const prevTime = this.challenge.lastScoreTimeSec;
    this.challenge = {
      active: false,
      totalTargets: CHALLENGE_TOTAL_TARGETS,
      spawnedCount: 0,
      hits: 0,
      remaining: 0,
      elapsedSec: 0,
      targetLifetimeTimer: 0,
      nextSpawnDelayTimer: 0,
      activeDummyId: null,
      completed: false,
      lastScoreHits: prevHits,
      lastScoreTimeSec: prevTime,
    };

    if (restoreDummies) {
      this.restoreAllStandardDummies();
    }
  }

  private finishChallenge(): void {
    this.challenge.active = false;
    this.challenge.completed = true;
    this.challenge.activeDummyId = null;
    this.challenge.remaining = 0;
    this.challenge.lastScoreHits = this.challenge.hits;
    this.challenge.lastScoreTimeSec = this.challenge.elapsedSec;
    this.restoreAllStandardDummies();
  }

  private restoreAllStandardDummies(): void {
    const maxArmor = this.armorEnabled ? DUMMY_ARMOR_SHIELD : 0;
    for (const d of this.dummies) {
      d.alive = true;
      d.hp = d.maxHp;
      d.armor = maxArmor;
      d.maxArmor = maxArmor;
      d.respawnTimer = 0;
      d.hitFlashTimer = 0;
      d.pos.x = d.spawnPos.x;
      d.pos.y = d.spawnPos.y;
      d.pos.z = d.spawnPos.z;
    }
  }

  private spawnNextChallengeTarget(): void {
    if (this.dummies.length === 0) return;

    const candidates =
      this.dummies.length > 1
        ? this.dummies.filter((d) => d.id !== this.lastChallengeDummyId)
        : this.dummies;
    const idx = Math.floor(this.rng() * candidates.length) % candidates.length;
    const chosen = candidates[idx];
    this.lastChallengeDummyId = chosen.id;

    const maxArmor = this.armorEnabled ? DUMMY_ARMOR_SHIELD : 0;
    chosen.alive = true;
    chosen.hp = chosen.maxHp;
    chosen.armor = maxArmor;
    chosen.maxArmor = maxArmor;
    chosen.respawnTimer = 0;
    chosen.hitFlashTimer = 0;

    // Slight lateral jitter around slot spawn so flick angles feel varied.
    const jitter = (this.rng() - 0.5) * 1.1;
    chosen.pos.x = chosen.spawnPos.x + (chosen.patrolAxis === 'x' ? jitter : 0);
    chosen.pos.y = chosen.spawnPos.y;
    chosen.pos.z = chosen.spawnPos.z + (chosen.patrolAxis === 'z' ? jitter : 0);

    this.challenge.spawnedCount += 1;
    this.challenge.activeDummyId = chosen.id;
    this.challenge.targetLifetimeTimer = CHALLENGE_TARGET_LIFETIME_SEC;
    this.challenge.remaining = this.challenge.totalTargets - this.challenge.spawnedCount + 1;
  }

  public applyDamage(
    dummyId: string,
    rawDamage: number,
    hitZone: 'head' | 'body',
  ): DamageOutcome {
    const dummy = this.dummies.find((d) => d.id === dummyId);
    if (!dummy || !dummy.alive || rawDamage <= 0) {
      return {
        applied: false,
        damage: 0,
        killed: false,
        remainingHp: dummy ? dummy.hp : 0,
        remainingArmor: dummy ? dummy.armor : 0,
      };
    }

    const damage = Math.round(rawDamage);
    const absorbedByArmor = Math.min(dummy.armor, damage);
    dummy.armor -= absorbedByArmor;
    const hpDamage = damage - absorbedByArmor;
    dummy.hp = Math.max(0, dummy.hp - hpDamage);

    dummy.hitFlashTimer = DUMMY_HIT_FLASH_DURATION_SEC;
    dummy.lastDamage = damage;
    dummy.lastHitZone = hitZone;

    let killed = false;
    if (dummy.hp <= 0) {
      killed = true;
      dummy.hp = 0;
      dummy.armor = 0;
      dummy.alive = false;

      if (this.challenge.active) {
        if (this.challenge.activeDummyId === dummy.id) {
          this.challenge.hits += 1;
          this.challenge.activeDummyId = null;
          this.challenge.remaining = this.challenge.totalTargets - this.challenge.spawnedCount;
          if (this.challenge.spawnedCount >= this.challenge.totalTargets) {
            this.finishChallenge();
          } else {
            this.challenge.nextSpawnDelayTimer = CHALLENGE_SPAWN_DELAY_SEC;
          }
        }
      } else {
        dummy.respawnTimer = DUMMY_RESPAWN_TIME_SEC;
      }
    }

    return {
      applied: true,
      damage,
      killed,
      remainingHp: dummy.hp,
      remainingArmor: dummy.armor,
    };
  }

  public update(dt: number): void {
    if (dt <= 0) return;

    for (const d of this.dummies) {
      if (d.hitFlashTimer > 0) {
        d.hitFlashTimer = Math.max(0, d.hitFlashTimer - dt);
      }
    }

    if (this.challenge.active) {
      this.challenge.elapsedSec += dt;

      if (this.challenge.activeDummyId !== null) {
        const activeDummy = this.dummies.find((d) => d.id === this.challenge.activeDummyId);
        if (activeDummy && activeDummy.alive) {
          if (this.strafeEnabled) {
            const amp = activeDummy.patrolAmplitude > 0 ? activeDummy.patrolAmplitude : 1.8;
            activeDummy.patrolPhase += activeDummy.patrolSpeed * dt;
            const offset = Math.sin(activeDummy.patrolPhase) * amp;
            if (activeDummy.patrolAxis === 'x') {
              activeDummy.pos.x = activeDummy.spawnPos.x + offset;
            } else {
              activeDummy.pos.z = activeDummy.spawnPos.z + offset;
            }
          }

          this.challenge.targetLifetimeTimer -= dt;
          if (this.challenge.targetLifetimeTimer <= 0) {
            activeDummy.alive = false;
            this.challenge.activeDummyId = null;
            this.challenge.remaining =
              this.challenge.totalTargets - this.challenge.spawnedCount;

            if (this.challenge.spawnedCount >= this.challenge.totalTargets) {
              this.finishChallenge();
            } else {
              this.challenge.nextSpawnDelayTimer = CHALLENGE_SPAWN_DELAY_SEC;
            }
          }
        } else {
          this.challenge.activeDummyId = null;
          this.challenge.nextSpawnDelayTimer = CHALLENGE_SPAWN_DELAY_SEC;
        }
      } else {
        this.challenge.nextSpawnDelayTimer -= dt;
        if (this.challenge.nextSpawnDelayTimer <= 0) {
          if (this.challenge.spawnedCount >= this.challenge.totalTargets) {
            this.finishChallenge();
          } else {
            this.spawnNextChallengeTarget();
          }
        }
      }

      return;
    }

    // Standard / Free Practice mode
    const maxArmor = this.armorEnabled ? DUMMY_ARMOR_SHIELD : 0;
    for (const d of this.dummies) {
      if (!d.alive) {
        d.respawnTimer -= dt;
        if (d.respawnTimer <= 1e-7) {
          d.alive = true;
          d.hp = d.maxHp;
          d.armor = maxArmor;
          d.maxArmor = maxArmor;
          d.respawnTimer = 0;
          d.pos.x = d.spawnPos.x;
          d.pos.y = d.spawnPos.y;
          d.pos.z = d.spawnPos.z;
        }
      } else if (this.strafeEnabled && d.patrolAmplitude > 0) {
        d.patrolPhase += d.patrolSpeed * dt;
        const offset = Math.sin(d.patrolPhase) * d.patrolAmplitude;
        if (d.patrolAxis === 'x') {
          d.pos.x = d.spawnPos.x + offset;
          d.pos.z = d.spawnPos.z;
        } else {
          d.pos.x = d.spawnPos.x;
          d.pos.z = d.spawnPos.z + offset;
        }
      }
    }
  }

  public getAliveCount(): number {
    let count = 0;
    for (const d of this.dummies) {
      if (d.alive) count += 1;
    }
    return count;
  }
}
