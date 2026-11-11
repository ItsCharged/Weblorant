import RAPIER from '@dimforge/rapier3d-compat';
import {
  CROUCH_EYE_HEIGHT,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_RADIUS,
  RUN_SPEED,
  SIM_DT,
  STAND_EYE_HEIGHT,
  STAND_HEIGHT,
  WALK_SPEED,
} from '../core/Config';
import { lerp, planarBasisFromYaw, vec3Clone } from '../core/math';
import type { InputSnapshot, PlayerStance, Vec3 } from '../core/types';
import type { PhysicsWorld } from './PhysicsWorld';

const GROUND_MOVE_ACCEL = 62.0;
const GROUND_STOP_ACCEL = 78.0;
const AIR_MOVE_ACCEL = 14.0;
const AIR_COAST_DRAG = 0.4;
const MAX_FALL_SPEED = -45.0;
const STANCE_TRANSITION_RATE = 14.0;
const SNAP_TO_GROUND_DIST = 0.32;
const FOOTSTEP_SPEED_THRESHOLD = 3.4;
const FOOTSTEP_STRIDE_METERS = 2.05;

const CEILING_CHECK_OFFSETS: ReadonlyArray<{ dx: number; dz: number }> = [
  { dx: 0, dz: 0 },
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
  { dx: 0.7071, dz: 0.7071 },
  { dx: -0.7071, dz: 0.7071 },
  { dx: 0.7071, dz: -0.7071 },
  { dx: -0.7071, dz: -0.7071 },
];

function capsuleHalfHeightForTotal(totalHeight: number): number {
  return Math.max(0.05, totalHeight * 0.5 - PLAYER_RADIUS);
}

export interface MotorStepResult {
  footstepTriggered: boolean;
}

/**
 * Kinematic tactical FPS character controller backed by Rapier's `KinematicCharacterController`.
 * Handles crisp acceleration, snappy counter-strafing, slopes/stairs, crouch with ceiling
 * clearance checks, jump & gravity, ability speed multipliers & kinetic dash bursts,
 * eye-height smoothing, and sprint footstep cadence.
 */
export class CharacterMotor {
  public feetPos: Vec3;
  public velocity: Vec3 = { x: 0, y: 0, z: 0 };
  public horizontalSpeed = 0;
  public grounded = true;
  public stance: PlayerStance = 'stand';
  public eyeHeight: number = STAND_EYE_HEIGHT;
  public currentHeight: number = STAND_HEIGHT;
  public speedMultiplier = 1.0;
  public dashRemainingSec = 0;
  public dashVelocity: Vec3 = { x: 0, y: 0, z: 0 };

  private readonly physicsWorld: PhysicsWorld;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private footstepDistance = 1.05;
  private disposed = false;

  constructor(physicsWorld: PhysicsWorld, spawnFeetPos: Vec3) {
    this.physicsWorld = physicsWorld;
    this.feetPos = vec3Clone(spawnFeetPos);

    this.controller = physicsWorld.world.createCharacterController(0.01);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.38, 0.22, true);
    this.controller.enableSnapToGround(SNAP_TO_GROUND_DIST);
    this.controller.setSlideEnabled(true);
    const slopeRad = (50 * Math.PI) / 180;
    this.controller.setMaxSlopeClimbAngle(slopeRad);
    this.controller.setMinSlopeSlideAngle(slopeRad);

    const centerY = this.feetPos.y + this.currentHeight * 0.5;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      this.feetPos.x,
      centerY,
      this.feetPos.z,
    );
    this.body = physicsWorld.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(
      capsuleHalfHeightForTotal(STAND_HEIGHT),
      PLAYER_RADIUS,
    );
    this.collider = physicsWorld.world.createCollider(colliderDesc, this.body);
    this.physicsWorld.step();
  }

  public syncWorldQueries(): void {
    if (!this.disposed) {
      this.physicsWorld.step();
    }
  }

  public getEyePos(): Vec3 {
    return {
      x: this.feetPos.x,
      y: this.feetPos.y + this.eyeHeight,
      z: this.feetPos.z,
    };
  }

  /**
   * Starts a horizontal kinetic dash burst (e.g. Ryo Kade's `Gleitschritt` ~8.5m over 0.22s),
   * swept physically through `computeColliderMovement` so walls & spawn barriers block it cleanly.
   */
  public startDash(dirX: number, dirZ: number, speedMps: number, durationSec: number): void {
    if (this.disposed) return;
    const len = Math.hypot(dirX, dirZ);
    const nx = len > 1e-6 ? dirX / len : 0;
    const nz = len > 1e-6 ? dirZ / len : -1;
    this.dashVelocity = {
      x: nx * speedMps,
      y: 0,
      z: nz * speedMps,
    };
    this.dashRemainingSec = Math.max(0, durationSec);
  }

  public teleport(pos: Vec3): void {
    if (this.disposed) return;
    this.feetPos = vec3Clone(pos);
    this.velocity = { x: 0, y: 0, z: 0 };
    this.horizontalSpeed = 0;
    this.grounded = true;
    this.stance = 'stand';
    this.currentHeight = STAND_HEIGHT;
    this.eyeHeight = STAND_EYE_HEIGHT;
    this.footstepDistance = 1.05;
    this.dashRemainingSec = 0;
    this.dashVelocity = { x: 0, y: 0, z: 0 };

    this.collider.setHalfHeight(capsuleHalfHeightForTotal(STAND_HEIGHT));
    const center = {
      x: this.feetPos.x,
      y: this.feetPos.y + STAND_HEIGHT * 0.5,
      z: this.feetPos.z,
    };
    this.body.setTranslation(center, true);
    this.body.setNextKinematicTranslation(center);
    this.controller.enableSnapToGround(SNAP_TO_GROUND_DIST);
    this.physicsWorld.step();
  }

  /**
   * Synchronizes position, velocity, and stance directly from an authoritative snapshot
   * prior to replaying unacknowledged inputs during client-side reconciliation.
   */
  public syncAuthoritativeState(pos: Vec3, vel: Vec3, stance: PlayerStance): void {
    if (this.disposed) return;
    this.feetPos = vec3Clone(pos);
    this.velocity = vec3Clone(vel);
    this.horizontalSpeed = Math.hypot(vel.x, vel.z);
    this.stance = stance;
    this.grounded = stance !== 'air';

    const isCrouch = stance === 'crouch';
    this.currentHeight = isCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
    this.eyeHeight = isCrouch ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;

    this.collider.setHalfHeight(capsuleHalfHeightForTotal(this.currentHeight));
    const center = {
      x: this.feetPos.x,
      y: this.feetPos.y + this.currentHeight * 0.5,
      z: this.feetPos.z,
    };
    this.body.setTranslation(center, true);
    this.body.setNextKinematicTranslation(center);
    if (this.velocity.y > 0) {
      this.controller.disableSnapToGround();
    } else {
      this.controller.enableSnapToGround(SNAP_TO_GROUND_DIST);
    }
    this.physicsWorld.step();
  }

  private hasCeilingClearance(requiredHeight: number): boolean {
    const startOffset = 0.55;
    const rayLength = requiredHeight - startOffset + 0.03;
    if (rayLength <= 0) return true;

    const ringRadius = PLAYER_RADIUS * 0.88;
    const upDir: Vec3 = { x: 0, y: 1, z: 0 };

    for (const offset of CEILING_CHECK_OFFSETS) {
      const origin: Vec3 = {
        x: this.feetPos.x + offset.dx * ringRadius,
        y: this.feetPos.y + startOffset,
        z: this.feetPos.z + offset.dz * ringRadius,
      };
      const hit = this.physicsWorld.castWorldRay(origin, upDir, rayLength);
      if (hit !== null && hit.distance < rayLength) {
        return false;
      }
    }

    return true;
  }

  public step(input: InputSnapshot): MotorStepResult {
    if (this.disposed) {
      return { footstepTriggered: false };
    }

    const dt = input.dt > 0 ? input.dt : SIM_DT;

    // 1. Crouch & ceiling clearance check
    const mustStayCrouched =
      !input.crouch &&
      this.currentHeight < STAND_HEIGHT - 0.01 &&
      !this.hasCeilingClearance(STAND_HEIGHT);
    const isCrouching = input.crouch || mustStayCrouched;

    const targetHeight = isCrouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    const targetEyeHeight = isCrouching ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
    const smoothT = 1 - Math.exp(-STANCE_TRANSITION_RATE * dt);

    const prevHeight = this.currentHeight;
    this.currentHeight =
      Math.abs(targetHeight - this.currentHeight) < 0.002
        ? targetHeight
        : lerp(this.currentHeight, targetHeight, smoothT);
    this.eyeHeight =
      Math.abs(targetEyeHeight - this.eyeHeight) < 0.002
        ? targetEyeHeight
        : lerp(this.eyeHeight, targetEyeHeight, smoothT);

    if (Math.abs(this.currentHeight - prevHeight) > 1e-4) {
      this.collider.setHalfHeight(capsuleHalfHeightForTotal(this.currentHeight));
      const adjustedCenter = {
        x: this.feetPos.x,
        y: this.feetPos.y + this.currentHeight * 0.5,
        z: this.feetPos.z,
      };
      this.body.setTranslation(adjustedCenter, true);
    }

    // 2. Planar wish direction
    const { forward, right } = planarBasisFromYaw(input.yaw);
    let wishX = forward.x * input.forward + right.x * input.right;
    let wishZ = forward.z * input.forward + right.z * input.right;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    } else if (wishLen <= 1e-5) {
      wishX = 0;
      wishZ = 0;
    }

    const hasMoveInput = wishLen > 1e-5;
    const baseSpeed = isCrouching
      ? CROUCH_SPEED
      : input.walk
        ? WALK_SPEED
        : RUN_SPEED;
    const targetSpeed = baseSpeed * Math.max(0.1, this.speedMultiplier);
    const targetVx = wishX * targetSpeed;
    const targetVz = wishZ * targetSpeed;

    // 3. Tactical horizontal acceleration OR active kinetic dash burst
    if (this.dashRemainingSec > 1e-6) {
      const dashFraction = Math.min(1, this.dashRemainingSec / dt);
      this.dashRemainingSec = Math.max(0, this.dashRemainingSec - dt);
      this.velocity.x = this.dashVelocity.x * dashFraction + targetVx * (1 - dashFraction);
      this.velocity.z = this.dashVelocity.z * dashFraction + targetVz * (1 - dashFraction);
      if (this.dashRemainingSec <= 1e-6) {
        this.dashRemainingSec = 0;
      }
    } else if (this.grounded) {
      const dot = wishX * this.velocity.x + wishZ * this.velocity.z;
      const isStoppingOrCounterStrafing = !hasMoveInput || dot < -0.01;
      const accel = isStoppingOrCounterStrafing ? GROUND_STOP_ACCEL : GROUND_MOVE_ACCEL;

      const dvx = targetVx - this.velocity.x;
      const dvz = targetVz - this.velocity.z;
      const deltaLen = Math.hypot(dvx, dvz);
      const maxDelta = accel * dt;

      if (deltaLen <= maxDelta || deltaLen <= 1e-6) {
        this.velocity.x = targetVx;
        this.velocity.z = targetVz;
      } else {
        const scale = maxDelta / deltaLen;
        this.velocity.x += dvx * scale;
        this.velocity.z += dvz * scale;
      }
    } else if (hasMoveInput) {
      const dvx = targetVx - this.velocity.x;
      const dvz = targetVz - this.velocity.z;
      const deltaLen = Math.hypot(dvx, dvz);
      const maxDelta = AIR_MOVE_ACCEL * dt;

      if (deltaLen <= maxDelta || deltaLen <= 1e-6) {
        this.velocity.x = targetVx;
        this.velocity.z = targetVz;
      } else {
        const scale = maxDelta / deltaLen;
        this.velocity.x += dvx * scale;
        this.velocity.z += dvz * scale;
      }
    } else {
      const drag = Math.max(0, 1 - AIR_COAST_DRAG * dt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;
    }

    // 4. Jump & gravity
    let jumpedThisTick = false;
    if (this.grounded && input.jump && !mustStayCrouched && this.hasCeilingClearance(STAND_HEIGHT + 0.15)) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      jumpedThisTick = true;
      this.controller.disableSnapToGround();
    } else {
      this.velocity.y = Math.max(MAX_FALL_SPEED, this.velocity.y + GRAVITY * dt);
      if (this.velocity.y > 0) {
        this.controller.disableSnapToGround();
      } else {
        this.controller.enableSnapToGround(SNAP_TO_GROUND_DIST);
      }
    }

    // 5. Rapier character sweep & slide
    const desiredTranslation = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };

    this.controller.computeColliderMovement(
      this.collider,
      desiredTranslation,
      RAPIER.QueryFilterFlags.ONLY_FIXED,
      undefined,
      (col) => this.physicsWorld.isWorldCollider(col),
    );

    const moved = this.controller.computedMovement();
    this.feetPos.x += moved.x;
    this.feetPos.y += moved.y;
    this.feetPos.z += moved.z;

    const newCenter = {
      x: this.feetPos.x,
      y: this.feetPos.y + this.currentHeight * 0.5,
      z: this.feetPos.z,
    };
    this.body.setTranslation(newCenter, true);
    this.body.setNextKinematicTranslation(newCenter);

    // 6. Grounded resolution & wall velocity projection
    const wasAscending = this.velocity.y > 0;
    this.grounded = !jumpedThisTick && this.controller.computedGrounded();

    if (wasAscending && moved.y < desiredTranslation.y * 0.5) {
      this.velocity.y = 0;
    }
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }

    if (dt > 1e-6) {
      const actualVx = moved.x / dt;
      const actualVz = moved.z / dt;
      if (Math.abs(actualVx) < Math.abs(this.velocity.x)) {
        this.velocity.x = actualVx;
      }
      if (Math.abs(actualVz) < Math.abs(this.velocity.z)) {
        this.velocity.z = actualVz;
      }
    }

    this.horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.horizontalSpeed < 0.01) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.horizontalSpeed = 0;
    }

    // 7. Player stance classification
    if (!this.grounded) {
      this.stance = 'air';
    } else if (isCrouching) {
      this.stance = 'crouch';
    } else if (input.walk && this.horizontalSpeed >= 0.15) {
      this.stance = 'walk';
    } else {
      this.stance = 'stand';
    }

    // 8. Sprint footsteps
    let footstepTriggered = false;
    const shouldEmitSteps =
      this.grounded &&
      !input.walk &&
      !input.crouch &&
      !isCrouching &&
      this.horizontalSpeed > FOOTSTEP_SPEED_THRESHOLD;

    if (shouldEmitSteps) {
      this.footstepDistance += this.horizontalSpeed * dt;
      if (this.footstepDistance >= FOOTSTEP_STRIDE_METERS) {
        this.footstepDistance -= FOOTSTEP_STRIDE_METERS;
        footstepTriggered = true;
      }
    } else {
      this.footstepDistance = Math.min(this.footstepDistance, 1.05);
    }

    return { footstepTriggered };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.free();
    this.physicsWorld.world.removeRigidBody(this.body);
  }
}
