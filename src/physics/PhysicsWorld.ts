import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, SPAWN_BARRIER_Z } from '../core/Config';
import { vec3Add, vec3Clone, vec3Len, vec3Normalize, vec3Scale } from '../core/math';
import type { Vec3 } from '../core/types';
import type { MapBlock, MapDefinition, SpawnBarrierDef } from '../data/maps/types';

let rapierReady = false;
let rapierInitPromise: Promise<void> | null = null;

/**
 * Idempotently initializes the Rapier 3D WASM module.
 */
export async function initRapier(): Promise<void> {
  if (rapierReady) return;
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init().then(() => {
      rapierReady = true;
    });
  }
  await rapierInitPromise;
}

export function isRapierInitialized(): boolean {
  return rapierReady;
}

/**
 * Converts intrinsic XYZ Euler angles (radians) into a unit Quaternion `{ x, y, z, w }`.
 */
export function eulerXYZToQuaternion(
  rotX: number,
  rotY: number,
  rotZ: number,
): { x: number; y: number; z: number; w: number } {
  const c1 = Math.cos(rotX * 0.5);
  const c2 = Math.cos(rotY * 0.5);
  const c3 = Math.cos(rotZ * 0.5);
  const s1 = Math.sin(rotX * 0.5);
  const s2 = Math.sin(rotY * 0.5);
  const s3 = Math.sin(rotZ * 0.5);

  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

export interface WorldRayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  block?: MapBlock;
  dynamicEffectId?: string;
}

interface DynamicColliderEntry {
  body: RAPIER.RigidBody;
  colliderHandle: number;
}

/**
 * Rapier 3D physics world built from a `MapDefinition`.
 * Supports static map geometry, toggleable Buy-Phase Spawn Barriers, and dynamic destructible
 * ability colliders (e.g., Tessa Vahl's `Schildpfosten` waist-high barrier).
 */
export class PhysicsWorld {
  public readonly world: RAPIER.World;
  private readonly worldColliderBlocks = new Map<number, MapBlock>();
  private readonly dynamicColliderIds = new Map<number, string>();
  private readonly dynamicBodiesById = new Map<string, DynamicColliderEntry>();
  private readonly spawnBarrierHandles = new Set<number>();
  private readonly spawnBarrierColliders: RAPIER.Collider[] = [];
  private spawnBarriersActive = false;
  private disposed = false;

  public static async init(): Promise<void> {
    await initRapier();
  }

  public static async create(mapDef: MapDefinition): Promise<PhysicsWorld> {
    await initRapier();
    return new PhysicsWorld(mapDef);
  }

  constructor(mapDef?: MapDefinition) {
    if (!rapierReady) {
      throw new Error(
        'Rapier WASM is not initialized yet. Await `PhysicsWorld.init()` or `initRapier()` first.',
      );
    }

    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    if (mapDef) {
      this.buildMapColliders(mapDef);
    }
  }

  private buildMapColliders(mapDef: MapDefinition): void {
    for (const block of mapDef.blocks) {
      if (block.collider === false) continue;

      const rot = eulerXYZToQuaternion(block.rotX ?? 0, block.rotY ?? 0, block.rotZ ?? 0);
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(block.pos.x, block.pos.y, block.pos.z)
        .setRotation(rot);
      const body = this.world.createRigidBody(bodyDesc);

      const hx = Math.max(0.005, block.size.x * 0.5);
      const hy = Math.max(0.005, block.size.y * 0.5);
      const hz = Math.max(0.005, block.size.z * 0.5);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
      const collider = this.world.createCollider(colliderDesc, body);

      this.worldColliderBlocks.set(collider.handle, block);
    }

    const barrierDefs: SpawnBarrierDef[] =
      mapDef.spawnBarriers && mapDef.spawnBarriers.length > 0
        ? [...mapDef.spawnBarriers]
        : [
            {
              id: 'fallback_barrier_south_a',
              team: 'A',
              pos: { x: 0, y: 4.0, z: SPAWN_BARRIER_Z },
              size: { x: mapDef.bounds.width, y: 8.0, z: 0.6 },
            },
            {
              id: 'fallback_barrier_north_d',
              team: 'D',
              pos: { x: 0, y: 4.0, z: -SPAWN_BARRIER_Z },
              size: { x: mapDef.bounds.width, y: 8.0, z: 0.6 },
            },
          ];

    for (const b of barrierDefs) {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(b.pos.x, b.pos.y, b.pos.z);
      const body = this.world.createRigidBody(bodyDesc);
      const hx = Math.max(0.01, b.size.x * 0.5);
      const hy = Math.max(0.01, b.size.y * 0.5);
      const hz = Math.max(0.01, b.size.z * 0.5);
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
      collider.setEnabled(false);
      this.spawnBarrierHandles.add(collider.handle);
      this.spawnBarrierColliders.push(collider);
    }

    // Advance broadphase & scene query pipeline immediately so raycasts work on tick 0.
    this.world.step();
  }

  /**
   * Registers a temporary fixed cuboid collider in the world (e.g. Tessa's `Schildpfosten` barrier).
   * Blocks both `CharacterMotor` movement and weapon raycasts (`castWorldRay`), reporting `dynamicEffectId`.
   */
  public addDynamicBlockCollider(
    id: string,
    centerPos: Vec3,
    size: Vec3,
    yaw = 0,
  ): void {
    if (this.disposed) return;
    this.removeDynamicBlockCollider(id);

    const rot = eulerXYZToQuaternion(0, yaw, 0);
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(centerPos.x, centerPos.y, centerPos.z)
      .setRotation(rot);
    const body = this.world.createRigidBody(bodyDesc);

    const hx = Math.max(0.01, size.x * 0.5);
    const hy = Math.max(0.01, size.y * 0.5);
    const hz = Math.max(0.01, size.z * 0.5);
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);

    const syntheticBlock: MapBlock = {
      id,
      pos: vec3Clone(centerPos),
      size: vec3Clone(size),
      rotY: yaw,
      color: 0x18d4c9,
      material: 'metal',
    };

    this.worldColliderBlocks.set(collider.handle, syntheticBlock);
    this.dynamicColliderIds.set(collider.handle, id);
    this.dynamicBodiesById.set(id, {
      body,
      colliderHandle: collider.handle,
    });

    this.world.step();
  }

  public removeDynamicBlockCollider(id: string): void {
    if (this.disposed) return;
    const existing = this.dynamicBodiesById.get(id);
    if (!existing) return;

    this.worldColliderBlocks.delete(existing.colliderHandle);
    this.dynamicColliderIds.delete(existing.colliderHandle);
    this.world.removeRigidBody(existing.body);
    this.dynamicBodiesById.delete(id);
    this.world.step();
  }

  public clearDynamicBlockColliders(): void {
    if (this.disposed || this.dynamicBodiesById.size === 0) return;
    for (const entry of this.dynamicBodiesById.values()) {
      this.worldColliderBlocks.delete(entry.colliderHandle);
      this.dynamicColliderIds.delete(entry.colliderHandle);
      this.world.removeRigidBody(entry.body);
    }
    this.dynamicBodiesById.clear();
    this.world.step();
  }

  /**
   * Enables or disables Buy-Phase Spawn Barriers for `CharacterMotor` movement sweeps.
   */
  public setSpawnBarriersActive(active: boolean): void {
    if (this.disposed || this.spawnBarriersActive === active) return;
    this.spawnBarriersActive = active;
    for (const col of this.spawnBarrierColliders) {
      col.setEnabled(active);
    }
    this.world.step();
  }

  public areSpawnBarriersActive(): boolean {
    return this.spawnBarriersActive;
  }

  public isWorldCollider(collider: RAPIER.Collider): boolean {
    if (this.worldColliderBlocks.has(collider.handle)) {
      return true;
    }
    return this.spawnBarriersActive && this.spawnBarrierHandles.has(collider.handle);
  }

  public step(): void {
    if (this.disposed) return;
    this.world.step();
  }

  /**
   * Casts a ray against fixed map world colliders and active dynamic barriers
   * (strictly excluding character colliders and translucent spawn barriers).
   */
  public castWorldRay(origin: Vec3, dir: Vec3, maxDist: number): WorldRayHit | null {
    if (this.disposed || maxDist <= 0) return null;
    const normDir = vec3Normalize(dir);
    if (vec3Len(normDir) <= 1e-8) return null;

    const ray = new RAPIER.Ray(origin, normDir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.ONLY_FIXED,
      undefined,
      undefined,
      undefined,
      (collider) => this.worldColliderBlocks.has(collider.handle),
    );

    if (!hit) return null;

    const distance = Math.max(0, hit.timeOfImpact);
    const point = vec3Add(origin, vec3Scale(normDir, distance));
    const rawNormal = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
    const normalLen = vec3Len(rawNormal);
    const normal =
      normalLen > 1e-6
        ? vec3Normalize(rawNormal)
        : { x: -normDir.x, y: -normDir.y, z: -normDir.z };

    return {
      distance,
      point,
      normal,
      block: this.worldColliderBlocks.get(hit.collider.handle),
      dynamicEffectId: this.dynamicColliderIds.get(hit.collider.handle),
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worldColliderBlocks.clear();
    this.dynamicColliderIds.clear();
    this.dynamicBodiesById.clear();
    this.spawnBarrierHandles.clear();
    this.spawnBarrierColliders.length = 0;
    this.world.free();
  }
}
