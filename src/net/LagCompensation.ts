import { LAG_COMP_HISTORY_MS, LAG_COMP_MAX_REWIND_MS } from '../core/Config';
import { clamp, vec3Clone, vec3Dist, vec3Lerp } from '../core/math';
import type { PlayerStance, TeamId, Vec3 } from '../core/types';

export interface LagCompTargetSample {
  uid: string;
  team: TeamId;
  alive: boolean;
  pos: Vec3;
  stance: PlayerStance;
}

interface StoredHistoryFrame {
  serverTimeMs: number;
  players: Map<string, LagCompTargetSample>;
}

const TELEPORT_SNAP_DIST_M = 8.0;

/**
 * Authoritative server-side Hitbox History & Rewind buffer (`maxAgeMs = 1000`,
 * hard-clamped at `LAG_COMP_MAX_REWIND_MS = 200` ms).
 * Pure TypeScript — zero 3D engine or DOM imports.
 */
export class LagCompensation {
  public readonly maxAgeMs: number;
  public readonly maxRewindMs: number;

  private readonly frames: StoredHistoryFrame[] = [];

  constructor(
    maxAgeMs: number = LAG_COMP_HISTORY_MS,
    maxRewindMs: number = LAG_COMP_MAX_REWIND_MS,
  ) {
    this.maxAgeMs = Math.max(100, maxAgeMs);
    this.maxRewindMs = clamp(maxRewindMs, 0, LAG_COMP_MAX_REWIND_MS);
  }

  public get frameCount(): number {
    return this.frames.length;
  }

  /**
   * Computes the strictly bounded rewind duration in milliseconds (`0..200 ms`).
   */
  public getEffectiveRewindMs(requestedRewindMs: number): number {
    if (!Number.isFinite(requestedRewindMs)) return 0;
    return clamp(requestedRewindMs, 0, this.maxRewindMs);
  }

  /**
   * Records a world-space hitbox snapshot at `serverTimeMs` and prunes expired history.
   */
  public recordFrame(
    serverTimeMs: number,
    players: ReadonlyArray<LagCompTargetSample>,
  ): void {
    const map = new Map<string, LagCompTargetSample>();
    for (const p of players) {
      map.set(p.uid, {
        uid: p.uid,
        team: p.team,
        alive: p.alive,
        pos: vec3Clone(p.pos),
        stance: p.stance,
      });
    }

    if (this.frames.length > 0) {
      const last = this.frames[this.frames.length - 1];
      if (serverTimeMs <= last.serverTimeMs) {
        last.serverTimeMs = serverTimeMs;
        last.players = map;
        return;
      }
    }

    this.frames.push({
      serverTimeMs,
      players: map,
    });

    const cutoffMs = serverTimeMs - this.maxAgeMs;
    // Keep one frame immediately prior to `cutoffMs` so boundary interpolation always has a lower bracket.
    while (this.frames.length > 2 && this.frames[1].serverTimeMs < cutoffMs) {
      this.frames.shift();
    }
  }

  /**
   * Returns interpolated hitbox targets at `serverTimeMs - clamp(requestedRewindMs, 0, 200)`.
   */
  public getRewoundTargets(
    serverTimeMs: number,
    requestedRewindMs: number,
  ): LagCompTargetSample[] {
    if (this.frames.length === 0) {
      return [];
    }

    // HARD ANTI-CHEAT CLAMP: never rewind more than 200 ms (`LAG_COMP_MAX_REWIND_MS`)
    const rewindMs = clamp(
      Number.isFinite(requestedRewindMs) ? requestedRewindMs : 0,
      0,
      LAG_COMP_MAX_REWIND_MS,
    );
    const boundedRewindMs = Math.min(rewindMs, this.maxRewindMs);
    const targetTimeMs = serverTimeMs - boundedRewindMs;

    const oldest = this.frames[0];
    const newest = this.frames[this.frames.length - 1];

    if (targetTimeMs <= oldest.serverTimeMs) {
      return this.cloneFramePlayers(oldest);
    }

    if (targetTimeMs >= newest.serverTimeMs) {
      return this.cloneFramePlayers(newest);
    }

    let older = oldest;
    let newer = newest;
    for (let i = 0; i < this.frames.length - 1; i += 1) {
      const a = this.frames[i];
      const b = this.frames[i + 1];
      if (a.serverTimeMs <= targetTimeMs && targetTimeMs <= b.serverTimeMs) {
        older = a;
        newer = b;
        break;
      }
    }

    const span = newer.serverTimeMs - older.serverTimeMs;
    const alpha = span > 1e-6 ? clamp((targetTimeMs - older.serverTimeMs) / span, 0, 1) : 1;

    const out: LagCompTargetSample[] = [];
    for (const [uid, newerSample] of newer.players.entries()) {
      const olderSample = older.players.get(uid);
      if (!olderSample) {
        out.push(this.cloneSample(newerSample));
        continue;
      }

      const nearest = alpha < 0.5 ? olderSample : newerSample;
      if (!olderSample.alive || !newerSample.alive) {
        out.push(this.cloneSample(nearest));
        continue;
      }

      const dist = vec3Dist(olderSample.pos, newerSample.pos);
      const pos =
        dist > TELEPORT_SNAP_DIST_M
          ? vec3Clone(nearest.pos)
          : vec3Lerp(olderSample.pos, newerSample.pos, alpha);

      out.push({
        uid,
        team: newerSample.team,
        alive: nearest.alive,
        pos,
        stance: nearest.stance,
      });
    }

    return out;
  }

  public clear(): void {
    this.frames.length = 0;
  }

  private cloneFramePlayers(frame: StoredHistoryFrame): LagCompTargetSample[] {
    const out: LagCompTargetSample[] = [];
    for (const sample of frame.players.values()) {
      out.push(this.cloneSample(sample));
    }
    return out;
  }

  private cloneSample(s: LagCompTargetSample): LagCompTargetSample {
    return {
      uid: s.uid,
      team: s.team,
      alive: s.alive,
      pos: vec3Clone(s.pos),
      stance: s.stance,
    };
  }
}
