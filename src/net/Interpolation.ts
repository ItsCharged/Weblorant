import { clamp, lerp, vec3Add, vec3Clone, vec3Dist, vec3Lerp, vec3Scale } from '../core/math';
import type { NetPlayerState, WorldSnapshot } from '../core/types';

export const INTERP_DELAY_MS = 100;
export const MAX_EXTRAPOLATION_MS = 100;
export const MAX_SNAPSHOT_BUFFER_SIZE = 32;
const TELEPORT_SNAP_DISTANCE_M = 8.0;

export type InterpolatedPlayer = NetPlayerState;

/**
 * Wraps an angle in radians into `[-π, +π]`.
 */
export function normalizeAngleRad(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * Shortest-path angular interpolation across `-π..+π` wraparound.
 */
export function lerpAngleRad(fromRad: number, toRad: number, t: number): number {
  const delta = normalizeAngleRad(toRad - fromRad);
  return normalizeAngleRad(fromRad + delta * t);
}

function clonePlayerState(p: NetPlayerState): NetPlayerState {
  return {
    ...p,
    pos: vec3Clone(p.pos),
    vel: vec3Clone(p.vel),
  };
}

/**
 * Pure deterministic remote-entity snapshot buffer (`100 ms` render delay) with
 * bracketing lerp, shortest-angle yaw wraparound, and capped `100 ms` dead-reckoning extrapolation.
 */
export class SnapshotInterpolator {
  private readonly snapshots: WorldSnapshot[] = [];
  private clockOffsetMs = 0;
  private hasExplicitClockOffset = false;

  public get bufferedCount(): number {
    return this.snapshots.length;
  }

  public reset(): void {
    this.snapshots.length = 0;
    this.clockOffsetMs = 0;
    this.hasExplicitClockOffset = false;
  }

  /**
   * Inserts a `WorldSnapshot` chronologically by `serverTimeMs` / `tick`.
   * Pass `receivedAtLocalMs` (`Date.now()`) in live networking to track clock skew automatically;
   * omit it in deterministic unit tests when passing synthetic server timestamps directly to `sampleRemotePlayers`.
   */
  public pushSnapshot(snapshot: WorldSnapshot, receivedAtLocalMs?: number): void {
    if (this.snapshots.some((s) => s.tick === snapshot.tick)) {
      return;
    }

    if (receivedAtLocalMs !== undefined && Number.isFinite(receivedAtLocalMs)) {
      const sampleOffset = snapshot.serverTimeMs - receivedAtLocalMs;
      if (!this.hasExplicitClockOffset || Math.abs(sampleOffset - this.clockOffsetMs) > 1500) {
        this.clockOffsetMs = sampleOffset;
        this.hasExplicitClockOffset = true;
      } else {
        this.clockOffsetMs = lerp(this.clockOffsetMs, sampleOffset, 0.15);
      }
    }

    const cloned: WorldSnapshot = {
      tick: snapshot.tick,
      serverTimeMs: snapshot.serverTimeMs,
      players: snapshot.players.map(clonePlayerState),
    };

    this.snapshots.push(cloned);
    this.snapshots.sort((a, b) =>
      a.serverTimeMs !== b.serverTimeMs ? a.serverTimeMs - b.serverTimeMs : a.tick - b.tick,
    );

    while (this.snapshots.length > MAX_SNAPSHOT_BUFFER_SIZE) {
      this.snapshots.shift();
    }
  }

  public estimatedServerNow(nowMs: number): number {
    return this.hasExplicitClockOffset ? nowMs + this.clockOffsetMs : nowMs;
  }

  /**
   * Samples smooth interpolated states for all players except `localUid` at `estimatedServerNow(nowMs) - 100ms`.
   */
  public sampleRemotePlayers(localUid: string, nowMs: number): InterpolatedPlayer[] {
    if (this.snapshots.length === 0) {
      return [];
    }

    const renderTime = this.estimatedServerNow(nowMs) - INTERP_DELAY_MS;
    const oldest = this.snapshots[0];
    const latest = this.snapshots[this.snapshots.length - 1];

    // Before oldest buffered snapshot: return oldest snapshot states directly
    if (renderTime <= oldest.serverTimeMs || this.snapshots.length === 1) {
      if (renderTime > latest.serverTimeMs) {
        return this.extrapolateFromLatest(latest, localUid, renderTime - latest.serverTimeMs);
      }
      return oldest.players.filter((p) => p.uid !== localUid).map(clonePlayerState);
    }

    // Past latest buffered snapshot (jitter / dropped packet): dead-reckon up to max 100 ms
    if (renderTime >= latest.serverTimeMs) {
      return this.extrapolateFromLatest(latest, localUid, renderTime - latest.serverTimeMs);
    }

    // Find bracketing pair snapA <= renderTime <= snapB
    let snapA = oldest;
    let snapB = latest;
    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      const a = this.snapshots[i];
      const b = this.snapshots[i + 1];
      if (renderTime >= a.serverTimeMs && renderTime <= b.serverTimeMs) {
        snapA = a;
        snapB = b;
        break;
      }
    }

    const spanMs = snapB.serverTimeMs - snapA.serverTimeMs;
    const t = spanMs > 1e-5 ? clamp((renderTime - snapA.serverTimeMs) / spanMs, 0, 1) : 1;

    const mapA = new Map<string, NetPlayerState>();
    for (const p of snapA.players) {
      mapA.set(p.uid, p);
    }

    const output: InterpolatedPlayer[] = [];
    for (const pB of snapB.players) {
      if (pB.uid === localUid) continue;

      const pA = mapA.get(pB.uid);
      if (
        !pA ||
        !pA.alive ||
        !pB.alive ||
        vec3Dist(pA.pos, pB.pos) > TELEPORT_SNAP_DISTANCE_M
      ) {
        output.push(clonePlayerState(pB));
        continue;
      }

      output.push({
        ...pB,
        pos: vec3Lerp(pA.pos, pB.pos, t),
        vel: vec3Lerp(pA.vel, pB.vel, t),
        yaw: lerpAngleRad(pA.yaw, pB.yaw, t),
        pitch: lerp(pA.pitch, pB.pitch, t),
      });
    }

    return output;
  }

  private extrapolateFromLatest(
    latest: WorldSnapshot,
    localUid: string,
    aheadMs: number,
  ): InterpolatedPlayer[] {
    const dtSec = clamp(aheadMs, 0, MAX_EXTRAPOLATION_MS) / 1000;
    const output: InterpolatedPlayer[] = [];

    for (const p of latest.players) {
      if (p.uid === localUid) continue;
      if (!p.alive || dtSec <= 0) {
        output.push(clonePlayerState(p));
        continue;
      }

      output.push({
        ...p,
        pos: vec3Add(p.pos, vec3Scale(p.vel, dtSec)),
        vel: vec3Clone(p.vel),
      });
    }

    return output;
  }
}
