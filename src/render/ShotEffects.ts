import * as THREE from 'three';
import type { HitZone, Vec3 } from '../core/types';

interface ActiveTracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  lifetime: number;
}

interface ActiveSpark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  lifetime: number;
}

const MAX_WORLD_DECALS = 80;
const MAX_SPRAY_MARKERS = 60;

export class ShotEffects {
  private readonly root: THREE.Group;
  private readonly tracers: ActiveTracer[] = [];
  private readonly sparks: ActiveSpark[] = [];

  // Pre-allocated ring buffer of 80 world bullet decals
  private readonly decalMeshes: THREE.Mesh[] = [];
  private decalCursor = 0;

  // Spray wall persistent high-contrast marker pool
  private readonly sprayMeshes: THREE.Mesh[] = [];

  private readonly tracerGeo: THREE.CylinderGeometry;
  private readonly sparkGeo: THREE.OctahedronGeometry;
  private readonly decalGeo: THREE.CircleGeometry;
  private readonly sprayDotGeo: THREE.CircleGeometry;

  private readonly decalMat: THREE.MeshBasicMaterial;
  private readonly sprayDotMat: THREE.MeshBasicMaterial;
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = 'shardline-shot-effects';
    scene.add(this.root);

    // Unit-height cylinder aligned on +Y so scaling Y stretches exact distance
    this.tracerGeo = new THREE.CylinderGeometry(0.0075, 0.012, 1, 6, 1, true);
    this.sparkGeo = new THREE.OctahedronGeometry(0.065, 0);
    this.decalGeo = new THREE.CircleGeometry(0.036, 10);
    this.sprayDotGeo = new THREE.CircleGeometry(0.052, 12);

    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x11161d,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });

    // High-contrast bright amber-cyan target marker for Spray Wall recoil inspection
    this.sprayDotMat = new THREE.MeshBasicMaterial({
      color: 0xff7a2f,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < MAX_WORLD_DECALS; i++) {
      const mesh = new THREE.Mesh(this.decalGeo, this.decalMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.decalMeshes.push(mesh);
    }

    for (let i = 0; i < MAX_SPRAY_MARKERS; i++) {
      const mesh = new THREE.Mesh(this.sprayDotGeo, this.sprayDotMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.sprayMeshes.push(mesh);
    }
  }

  public spawnShotEffect(
    muzzleWorld: Vec3,
    impactPoint: Vec3,
    impactNormal: Vec3,
    hitZone: HitZone
  ): void {
    const start = new THREE.Vector3(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z);
    const end = new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z);
    const delta = new THREE.Vector3().subVectors(end, start);
    const dist = delta.length();

    // 1. Bright tracer beam
    if (dist > 0.25) {
      const dir = delta.clone().divideScalar(dist);
      const mid = start.clone().addScaledVector(dir, dist * 0.5);

      const tracerMat = new THREE.MeshBasicMaterial({
        color: hitZone === 'head' ? 0xffb84d : 0xffe49e,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      });
      const tracerMesh = new THREE.Mesh(this.tracerGeo, tracerMat);
      tracerMesh.position.copy(mid);
      tracerMesh.quaternion.setFromUnitVectors(this.upAxis, dir);
      tracerMesh.scale.set(1, dist, 1);
      this.root.add(tracerMesh);

      this.tracers.push({
        mesh: tracerMesh,
        mat: tracerMat,
        age: 0,
        lifetime: 0.075,
      });
    }

    if (hitZone === 'none') return;

    // 2. Impact spark flash
    const sparkColor =
      hitZone === 'head'
        ? 0xff7b29
        : hitZone === 'body'
          ? 0xffffff
          : hitZone === 'button'
            ? 0x18d4c9
            : 0xffcf70;

    const sparkMat = new THREE.MeshBasicMaterial({
      color: sparkColor,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const sparkMesh = new THREE.Mesh(this.sparkGeo, sparkMat);
    sparkMesh.position.set(
      impactPoint.x + impactNormal.x * 0.02,
      impactPoint.y + impactNormal.y * 0.02,
      impactPoint.z + impactNormal.z * 0.02
    );
    this.root.add(sparkMesh);
    this.sparks.push({
      mesh: sparkMesh,
      mat: sparkMat,
      age: 0,
      lifetime: 0.09,
    });

    // 3. Bullet decal dot on solid world geometry (ring buffer of 80)
    if (hitZone === 'world') {
      const decal = this.decalMeshes[this.decalCursor];
      this.decalCursor = (this.decalCursor + 1) % MAX_WORLD_DECALS;

      const norm = new THREE.Vector3(impactNormal.x, impactNormal.y, impactNormal.z);
      if (norm.lengthSq() < 0.001) {
        norm.set(0, 1, 0);
      } else {
        norm.normalize();
      }

      decal.position.set(
        impactPoint.x + norm.x * 0.008,
        impactPoint.y + norm.y * 0.008,
        impactPoint.z + norm.z * 0.008
      );
      decal.quaternion.setFromUnitVectors(this.zAxis, norm);
      decal.visible = true;
    }
  }

  public syncSprayWallPoints(points: ReadonlyArray<Vec3>, wallNormal?: Vec3): void {
    const norm = wallNormal
      ? new THREE.Vector3(wallNormal.x, wallNormal.y, wallNormal.z).normalize()
      : new THREE.Vector3(0, 0, 1);
    if (norm.lengthSq() < 0.001) norm.set(0, 0, 1);

    const count = Math.min(points.length, MAX_SPRAY_MARKERS);
    const startIdx = Math.max(0, points.length - count);

    for (let i = 0; i < MAX_SPRAY_MARKERS; i++) {
      const mesh = this.sprayMeshes[i];
      if (i < count) {
        const pt = points[startIdx + i];
        mesh.position.set(
          pt.x + norm.x * 0.015,
          pt.y + norm.y * 0.015,
          pt.z + norm.z * 0.015
        );
        mesh.quaternion.setFromUnitVectors(this.zAxis, norm);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
  }

  public clearAll(): void {
    for (const t of this.tracers) {
      this.root.remove(t.mesh);
      t.mat.dispose();
    }
    this.tracers.length = 0;

    for (const s of this.sparks) {
      this.root.remove(s.mesh);
      s.mat.dispose();
    }
    this.sparks.length = 0;

    for (const d of this.decalMeshes) {
      d.visible = false;
    }
    this.decalCursor = 0;

    for (const sp of this.sprayMeshes) {
      sp.visible = false;
    }
  }

  public update(frameDt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.age += frameDt;
      if (t.age >= t.lifetime) {
        this.root.remove(t.mesh);
        t.mat.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      const frac = 1 - t.age / t.lifetime;
      t.mat.opacity = frac * 0.88;
      t.mesh.scale.x = frac;
      t.mesh.scale.z = frac;
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += frameDt;
      if (s.age >= s.lifetime) {
        this.root.remove(s.mesh);
        s.mat.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      const grow = 1 + (s.age / s.lifetime) * 1.9;
      s.mesh.scale.set(grow, grow, grow);
      s.mat.opacity = 1 - s.age / s.lifetime;
    }
  }

  public dispose(): void {
    this.clearAll();
    this.tracerGeo.dispose();
    this.sparkGeo.dispose();
    this.decalGeo.dispose();
    this.sprayDotGeo.dispose();
    this.decalMat.dispose();
    this.sprayDotMat.dispose();
  }
}
