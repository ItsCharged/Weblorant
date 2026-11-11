import { vec3Add, vec3Clone, vec3Len, vec3Scale, vec3Sub } from '../core/math';
import type { InputSnapshot, NetPlayerState, Vec3 } from '../core/types';
import type { CharacterMotor } from '../physics/CharacterMotor';

export const MAX_PREDICTION_BUFFER_SIZE = 128;
export const HARD_SNAP_THRESHOLD_M = 1.5;
export const MIN_SMOOTH_THRESHOLD_M = 0.002;
export const PREDICTION_SMOOTH_DECAY_RATE = 18.0;

export interface PredictedTickRecord {
  seq: number;
  input: InputSnapshot;
  predictedPosAfter: Vec3;
}

export interface ReconcileResult {
  errorM: number;
  snapped: boolean;
  replayedCount: number;
}

/**
 * Pure deterministic Client-Side Prediction & Server-Reconciliation buffer.
 * Keeps local movement at 0 ms perceived input lag while reconciling authoritative
 * Host snapshots via input replay + exponential render-offset smoothing.
 */
export class ClientPrediction {
  public renderErrorOffset: Vec3 = { x: 0, y: 0, z: 0 };
  public lastReconcileErrorM = 0;

  private readonly history: PredictedTickRecord[] = [];

  public get bufferedInputCount(): number {
    return this.history.length;
  }

  public recordInput(input: InputSnapshot, predictedPosAfter: Vec3): void {
    this.history.push({
      seq: input.seq,
      input: { ...input },
      predictedPosAfter: vec3Clone(predictedPosAfter),
    });

    while (this.history.length > MAX_PREDICTION_BUFFER_SIZE) {
      this.history.shift();
    }
  }

  public reconcile(
    authoritativeState: NetPlayerState,
    motor: CharacterMotor,
  ): ReconcileResult {
    // 1. Discard all acknowledged inputs up to `lastAckSeq`
    while (this.history.length > 0 && this.history[0].seq <= authoritativeState.lastAckSeq) {
      this.history.shift();
    }

    // 2. Dead state: snap cleanly to authoritative position and clear pending inputs
    if (!authoritativeState.alive) {
      motor.teleport(authoritativeState.pos);
      this.history.length = 0;
      this.renderErrorOffset = { x: 0, y: 0, z: 0 };
      this.lastReconcileErrorM = 0;
      return { errorM: 0, snapped: true, replayedCount: 0 };
    }

    const oldPredictedPos = vec3Clone(motor.feetPos);

    // 3. Rewind motor to authoritative state and replay unacknowledged inputs (seq > lastAckSeq)
    motor.syncAuthoritativeState(
      authoritativeState.pos,
      authoritativeState.vel,
      authoritativeState.stance,
    );

    let replayedCount = 0;
    for (const record of this.history) {
      motor.step(record.input);
      motor.syncWorldQueries();
      record.predictedPosAfter = vec3Clone(motor.feetPos);
      replayedCount += 1;
    }

    const newReconciledPos = motor.feetPos;
    const errorVec = vec3Sub(oldPredictedPos, newReconciledPos);
    const errorM = vec3Len(errorVec);
    this.lastReconcileErrorM = errorM;

    // 4. Hard snap on large desync/teleport (>= 1.5 m), smooth exponential decay on micro-discrepancy
    if (errorM >= HARD_SNAP_THRESHOLD_M) {
      this.renderErrorOffset = { x: 0, y: 0, z: 0 };
      return { errorM, snapped: true, replayedCount };
    }

    if (errorM > MIN_SMOOTH_THRESHOLD_M) {
      const nextOffset = vec3Add(this.renderErrorOffset, errorVec);
      if (vec3Len(nextOffset) >= HARD_SNAP_THRESHOLD_M) {
        this.renderErrorOffset = { x: 0, y: 0, z: 0 };
        return { errorM, snapped: true, replayedCount };
      }
      this.renderErrorOffset = nextOffset;
    }

    return { errorM, snapped: false, replayedCount };
  }

  /**
   * Exponentially decays `renderErrorOffset` (`*= Math.exp(-18 * dt)`) every render frame.
   */
  public decayErrorOffset(frameDt: number): void {
    if (frameDt <= 0) return;
    const decay = Math.exp(-PREDICTION_SMOOTH_DECAY_RATE * frameDt);
    this.renderErrorOffset = vec3Scale(this.renderErrorOffset, decay);
    if (vec3Len(this.renderErrorOffset) < 1e-4) {
      this.renderErrorOffset = { x: 0, y: 0, z: 0 };
    }
  }

  public applySmoothing(pos: Vec3): Vec3 {
    return vec3Add(pos, this.renderErrorOffset);
  }

  public reset(): void {
    this.history.length = 0;
    this.renderErrorOffset = { x: 0, y: 0, z: 0 };
    this.lastReconcileErrorM = 0;
  }
}
