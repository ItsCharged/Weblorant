import * as THREE from 'three';
import type { ActiveWorldEffect, TeamId, Vec3, WorldEffectKind } from '../core/types';

interface EffectVisualInstance {
  id: string;
  kind: WorldEffectKind;
  group: THREE.Group;
  innerRingRadius?: number;
  ownedMaterials: THREE.Material[];
  ownedGeometries: THREE.BufferGeometry[];
  primaryMesh?: THREE.Mesh;
  secondaryMesh?: THREE.Mesh;
  tertiaryMesh?: THREE.Mesh;
  hpBarFillMesh?: THREE.Mesh;
  pillarMeshes?: THREE.Mesh[];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Symmetric camera smoke-blindness check (`0..1`):
 * Returns `1` when `eyePos` is inside an active `smoke_dome` (*Nebelkuppel*) or
 * inside the wall thickness of a `dark_ring` (*Dunkelzone*), ramping smoothly near the boundary.
 */
export function isPointInsideSmoke(
  eyePos: Vec3,
  effects: ReadonlyArray<ActiveWorldEffect>
): number {
  let maxDensity = 0;

  for (const eff of effects) {
    if (eff.remainingSec <= 0) continue;

    if (eff.kind === 'smoke_dome') {
      const r = Math.max(0.5, eff.radius);
      const centerY = eff.pos.y + r * 0.34;
      const dx = eyePos.x - eff.pos.x;
      const dy = eyePos.y - centerY;
      const dz = eyePos.z - eff.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const outerEdge = r * 1.04;
      const fullInner = r * 0.86;
      if (dist <= outerEdge) {
        const d =
          dist <= fullInner
            ? 1
            : clamp01((outerEdge - dist) / Math.max(0.05, outerEdge - fullInner));
        if (d > maxDensity) maxDensity = d;
      }
    } else if (eff.kind === 'dark_ring') {
      const outerR = Math.max(1.5, eff.radius);
      const innerR = eff.innerRadius ?? outerR * 0.747;
      const height = eff.height ?? 4.2;

      if (eyePos.y >= eff.pos.y - 0.35 && eyePos.y <= eff.pos.y + height + 0.35) {
        const horizDist = Math.hypot(eyePos.x - eff.pos.x, eyePos.z - eff.pos.z);
        const halfThick = Math.max(0.4, (outerR - innerR) * 0.5);
        const midR = (outerR + innerR) * 0.5;
        const radialOffset = Math.abs(horizDist - midR);
        const fadeBand = halfThick + 0.32;

        if (radialOffset <= fadeBand) {
          const d =
            radialOffset <= halfThick * 0.72
              ? 1
              : clamp01(
                  (fadeBand - radialOffset) / Math.max(0.05, fadeBand - halfThick * 0.72)
                );
          if (d > maxDensity) maxDensity = d;
        }
      }
    }
  }

  return maxDensity;
}

export class AbilityEffectsRenderer {
  private readonly root: THREE.Group;
  private readonly instances = new Map<string, EffectVisualInstance>();
  private animClock = 0;

  // Shared unit geometries (low draw calls, zero runtime allocations for static primitives)
  private readonly unitSphereGeo = new THREE.SphereGeometry(1, 22, 16);
  private readonly unitIcosaGeo = new THREE.IcosahedronGeometry(1.025, 1);
  private readonly unitOpenCylGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
  private readonly unitDiscGeo = new THREE.CircleGeometry(1, 32);
  private readonly unitThinRingGeo = new THREE.RingGeometry(0.93, 1.0, 36);
  private readonly unitThickRingGeo = new THREE.RingGeometry(0.84, 1.0, 36);
  private readonly mineBodyGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.09, 12);
  private readonly mineCoreGeo = new THREE.SphereGeometry(0.1, 10, 8);
  private readonly sensorPuckGeo = new THREE.OctahedronGeometry(0.22, 0);
  private readonly barrierWallGeo = new THREE.BoxGeometry(3.2, 1.15, 0.45);
  private readonly barrierCapGeo = new THREE.BoxGeometry(3.24, 0.08, 0.49);
  private readonly barrierPillarGeo = new THREE.BoxGeometry(0.22, 1.19, 0.52);
  private readonly hpTrackGeo = new THREE.PlaneGeometry(1.8, 0.1);
  private readonly hpFillGeo = new THREE.PlaneGeometry(1.74, 0.065);
  private readonly bastionPillarGeo = new THREE.CylinderGeometry(0.09, 0.13, 1.9, 6);
  private readonly dashBladeGeo = new THREE.BoxGeometry(0.55, 0.16, 3.2);

  // Shared opaque smoke materials (`transparent: false` guarantees 100% silhouette occlusion!)
  private readonly matSmokeCore = new THREE.MeshStandardMaterial({
    color: 0x1d2733,
    roughness: 0.94,
    metalness: 0.04,
    transparent: false,
    side: THREE.DoubleSide,
  });

  private readonly matSmokeOuterShell = new THREE.MeshStandardMaterial({
    color: 0x263342,
    emissive: 0x101821,
    emissiveIntensity: 0.35,
    roughness: 0.88,
    metalness: 0.08,
    flatShading: true,
    transparent: false,
    side: THREE.DoubleSide,
  });

  private readonly matDarkRingWall = new THREE.MeshStandardMaterial({
    color: 0x161f2a,
    emissive: 0x0c131b,
    emissiveIntensity: 0.4,
    roughness: 0.92,
    metalness: 0.08,
    transparent: false,
    side: THREE.DoubleSide,
  });

  private readonly matSmokeAmberRim = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  private readonly matDarkSteel = new THREE.MeshStandardMaterial({
    color: 0x19232f,
    roughness: 0.44,
    metalness: 0.74,
  });

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = 'shardline-ability-effects';
    scene.add(this.root);
  }

  public isPointInsideSmoke(
    eyePos: Vec3,
    effects: ReadonlyArray<ActiveWorldEffect>
  ): number {
    return isPointInsideSmoke(eyePos, effects);
  }

  public clear(): void {
    for (const inst of this.instances.values()) {
      this.disposeInstance(inst);
    }
    this.instances.clear();
  }

  public sync(
    effects: ReadonlyArray<ActiveWorldEffect>,
    localTeam: TeamId,
    frameDt: number
  ): void {
    const dt = Math.min(0.1, Math.max(0.0001, frameDt));
    this.animClock += dt;

    const seenIds = new Set<string>();

    for (const eff of effects) {
      if (eff.remainingSec <= 0) continue;
      seenIds.add(eff.id);

      let inst = this.instances.get(eff.id);
      if (!inst || inst.kind !== eff.kind) {
        if (inst) {
          this.disposeInstance(inst);
          this.instances.delete(eff.id);
        }
        inst = this.createInstance(eff);
        this.instances.set(eff.id, inst);
        this.root.add(inst.group);
      }

      this.updateInstance(inst, eff, localTeam);
    }

    for (const [id, inst] of this.instances.entries()) {
      if (!seenIds.has(id)) {
        this.disposeInstance(inst);
        this.instances.delete(id);
      }
    }
  }

  private createInstance(eff: ActiveWorldEffect): EffectVisualInstance {
    const group = new THREE.Group();
    group.name = `effect-${eff.kind}-${eff.id}`;
    const ownedMaterials: THREE.Material[] = [];
    const ownedGeometries: THREE.BufferGeometry[] = [];

    switch (eff.kind) {
      case 'smoke_dome': {
        // 100% opaque inner & faceted outer sphere so zero player silhouettes bleed through
        const core = new THREE.Mesh(this.unitSphereGeo, this.matSmokeCore);
        const shell = new THREE.Mesh(this.unitIcosaGeo, this.matSmokeOuterShell);
        const rim = new THREE.Mesh(this.unitThinRingGeo, this.matSmokeAmberRim);
        rim.rotation.x = -Math.PI / 2;
        group.add(core, shell, rim);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: core,
          secondaryMesh: shell,
          tertiaryMesh: rim,
        };
      }

      case 'dark_ring': {
        // 100% opaque hollow cylindrical wall (outer wall + inner wall + top annular cap)
        const outerWall = new THREE.Mesh(this.unitOpenCylGeo, this.matDarkRingWall);
        const innerWall = new THREE.Mesh(this.unitOpenCylGeo, this.matDarkRingWall);

        const outerR = Math.max(1.5, eff.radius);
        const innerR = eff.innerRadius ?? outerR * 0.747;
        const ratio = clamp01(innerR / outerR);
        const capGeo = new THREE.RingGeometry(ratio, 1.0, 32);
        ownedGeometries.push(capGeo);
        const topCap = new THREE.Mesh(capGeo, this.matDarkRingWall);
        topCap.rotation.x = -Math.PI / 2;

        const baseRim = new THREE.Mesh(this.unitThinRingGeo, this.matSmokeAmberRim);
        baseRim.rotation.x = -Math.PI / 2;

        group.add(outerWall, innerWall, topCap, baseRim);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          innerRingRadius: innerR,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: outerWall,
          secondaryMesh: innerWall,
          tertiaryMesh: topCap,
          pillarMeshes: [baseRim],
        };
      }

      case 'ember_field': {
        const discMat = new THREE.MeshBasicMaterial({
          color: 0xff471a,
          transparent: true,
          opacity: 0.52,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xffb02e,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        ownedMaterials.push(discMat, ringMat);

        const disc = new THREE.Mesh(this.unitDiscGeo, discMat);
        disc.rotation.x = -Math.PI / 2;

        const heatRing = new THREE.Mesh(this.unitThickRingGeo, ringMat);
        heatRing.rotation.x = -Math.PI / 2;

        group.add(disc, heatRing);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: disc,
          secondaryMesh: heatRing,
        };
      }

      case 'echo_sensor': {
        const puckMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0ea5e9,
          emissiveIntensity: 1.2,
          roughness: 0.25,
          metalness: 0.5,
        });
        const sonarMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        ownedMaterials.push(puckMat, sonarMat);

        const puck = new THREE.Mesh(this.sensorPuckGeo, puckMat);
        const sonarRing = new THREE.Mesh(this.unitThinRingGeo, sonarMat);
        sonarRing.rotation.x = -Math.PI / 2;

        group.add(puck, sonarRing);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: puck,
          secondaryMesh: sonarRing,
        };
      }

      case 'jammer_field': {
        const fieldMat = new THREE.MeshBasicMaterial({
          color: 0x4f46e5,
          transparent: true,
          opacity: 0.36,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const pulseMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        ownedMaterials.push(fieldMat, pulseMat);

        const disc = new THREE.Mesh(this.unitDiscGeo, fieldMat);
        disc.rotation.x = -Math.PI / 2;
        const ring = new THREE.Mesh(this.unitThinRingGeo, pulseMat);
        ring.rotation.x = -Math.PI / 2;

        group.add(disc, ring);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: disc,
          secondaryMesh: ring,
        };
      }

      case 'global_reveal': {
        const sweepMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        ownedMaterials.push(sweepMat);

        const sweepRing = new THREE.Mesh(this.unitThinRingGeo, sweepMat);
        sweepRing.rotation.x = -Math.PI / 2;
        group.add(sweepRing);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: sweepRing,
        };
      }

      case 'magnet_mine': {
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0x18d4c9,
        });
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x18d4c9,
          transparent: true,
          opacity: 0.32,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const burstMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        ownedMaterials.push(coreMat, ringMat, burstMat);

        const base = new THREE.Mesh(this.mineBodyGeo, this.matDarkSteel);
        base.position.y = 0.045;
        const core = new THREE.Mesh(this.mineCoreGeo, coreMat);
        core.position.y = 0.1;

        const rangeRing = new THREE.Mesh(this.unitThinRingGeo, ringMat);
        rangeRing.rotation.x = -Math.PI / 2;
        rangeRing.position.y = 0.03;

        const burstSphere = new THREE.Mesh(this.unitSphereGeo, burstMat);
        burstSphere.visible = false;

        group.add(base, core, rangeRing, burstSphere);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: core,
          secondaryMesh: rangeRing,
          tertiaryMesh: burstSphere,
        };
      }

      case 'shield_post': {
        const wallMat = new THREE.MeshStandardMaterial({
          color: 0x154b52,
          emissive: 0x18d4c9,
          emissiveIntensity: 0.55,
          roughness: 0.28,
          metalness: 0.45,
          transparent: true,
          opacity: 0.88,
        });
        const hpTrackMat = new THREE.MeshBasicMaterial({
          color: 0x0a1018,
          side: THREE.DoubleSide,
        });
        const hpFillMat = new THREE.MeshBasicMaterial({
          color: 0x18d4c9,
          side: THREE.DoubleSide,
        });
        ownedMaterials.push(wallMat, hpTrackMat, hpFillMat);

        const panel = new THREE.Mesh(this.barrierWallGeo, wallMat);
        panel.position.y = 0.575;

        const topCap = new THREE.Mesh(this.barrierCapGeo, this.matDarkSteel);
        topCap.position.y = 1.13;

        const leftPost = new THREE.Mesh(this.barrierPillarGeo, this.matDarkSteel);
        leftPost.position.set(-1.52, 0.595, 0);
        const rightPost = new THREE.Mesh(this.barrierPillarGeo, this.matDarkSteel);
        rightPost.position.set(1.52, 0.595, 0);

        const hpTrack = new THREE.Mesh(this.hpTrackGeo, hpTrackMat);
        hpTrack.position.set(0, 1.32, 0);
        const hpFill = new THREE.Mesh(this.hpFillGeo, hpFillMat);
        hpFill.position.set(0, 1.32, 0.008);

        group.add(panel, topCap, leftPost, rightPost, hpTrack, hpFill);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: panel,
          hpBarFillMesh: hpFill,
        };
      }

      case 'bastion_zone': {
        const padMat = new THREE.MeshBasicMaterial({
          color: 0x18d4c9,
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const rimMat = new THREE.MeshBasicMaterial({
          color: 0x2ee59d,
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const pillarMat = new THREE.MeshBasicMaterial({
          color: 0x18d4c9,
          transparent: true,
          opacity: 0.65,
        });
        ownedMaterials.push(padMat, rimMat, pillarMat);

        const pad = new THREE.Mesh(this.unitDiscGeo, padMat);
        pad.rotation.x = -Math.PI / 2;
        const rim = new THREE.Mesh(this.unitThinRingGeo, rimMat);
        rim.rotation.x = -Math.PI / 2;

        const pillars: THREE.Mesh[] = [];
        for (let i = 0; i < 6; i += 1) {
          const p = new THREE.Mesh(this.bastionPillarGeo, pillarMat);
          pillars.push(p);
          group.add(p);
        }

        group.add(pad, rim);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: pad,
          secondaryMesh: rim,
          pillarMeshes: pillars,
        };
      }

      case 'dash_trail':
      default: {
        const streakMat = new THREE.MeshBasicMaterial({
          color: 0xff6b2b,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
        });
        ownedMaterials.push(streakMat);

        const blade = new THREE.Mesh(this.dashBladeGeo, streakMat);
        blade.position.y = 0.9;
        group.add(blade);
        return {
          id: eff.id,
          kind: eff.kind,
          group,
          ownedMaterials,
          ownedGeometries,
          primaryMesh: blade,
        };
      }
    }
  }

  private updateInstance(
    inst: EffectVisualInstance,
    eff: ActiveWorldEffect,
    localTeam: TeamId
  ): void {
    const total = Math.max(0.05, eff.totalSec);
    const elapsed = Math.max(0, total - eff.remainingSec);
    const lifeRatio = clamp01(eff.remainingSec / total);

    inst.group.position.set(eff.pos.x, eff.pos.y, eff.pos.z);

    switch (eff.kind) {
      case 'smoke_dome': {
        const r = Math.max(0.5, eff.radius);
        // Quick pop-in over first 0.22s, quick collapse in last 0.3s
        const deployScale =
          elapsed < 0.22
            ? 0.35 + 0.65 * (elapsed / 0.22)
            : eff.remainingSec < 0.3
              ? Math.max(0.2, eff.remainingSec / 0.3)
              : 1.0;
        const effR = r * deployScale;
        const centerOffsetY = effR * 0.34;

        if (inst.primaryMesh) {
          inst.primaryMesh.position.y = centerOffsetY;
          inst.primaryMesh.scale.setScalar(effR * 0.985);
        }
        if (inst.secondaryMesh) {
          inst.secondaryMesh.position.y = centerOffsetY;
          inst.secondaryMesh.scale.setScalar(effR);
          inst.secondaryMesh.rotation.y = this.animClock * 0.14;
        }
        if (inst.tertiaryMesh) {
          inst.tertiaryMesh.position.y = 0.04;
          inst.tertiaryMesh.scale.set(effR, effR, 1);
        }
        break;
      }

      case 'dark_ring': {
        const outerR = Math.max(1.5, eff.radius);
        const innerR = eff.innerRadius ?? inst.innerRingRadius ?? outerR * 0.747;
        const baseH = eff.height ?? 4.2;
        const rise =
          elapsed < 0.3
            ? 0.2 + 0.8 * (elapsed / 0.3)
            : eff.remainingSec < 0.35
              ? Math.max(0.15, eff.remainingSec / 0.35)
              : 1.0;
        const h = baseH * rise;

        if (inst.primaryMesh) {
          inst.primaryMesh.position.y = h * 0.5;
          inst.primaryMesh.scale.set(outerR, h, outerR);
        }
        if (inst.secondaryMesh) {
          inst.secondaryMesh.position.y = h * 0.5;
          inst.secondaryMesh.scale.set(innerR, h, innerR);
        }
        if (inst.tertiaryMesh) {
          inst.tertiaryMesh.position.y = h;
          inst.tertiaryMesh.scale.set(outerR, outerR, 1);
        }
        if (inst.pillarMeshes?.[0]) {
          inst.pillarMeshes[0].position.y = 0.04;
          inst.pillarMeshes[0].scale.set(outerR, outerR, 1);
        }
        break;
      }

      case 'ember_field': {
        const r = Math.max(0.5, eff.radius);
        const pulse = (this.animClock * 1.8) % 1;
        if (inst.primaryMesh) {
          inst.primaryMesh.position.y = 0.035;
          inst.primaryMesh.scale.set(r, r, 1);
          const m = inst.primaryMesh.material as THREE.MeshBasicMaterial;
          m.opacity = (0.42 + 0.14 * Math.sin(this.animClock * 9)) * Math.min(1, lifeRatio * 3);
        }
        if (inst.secondaryMesh) {
          const ringScale = r * (0.35 + 0.65 * pulse);
          inst.secondaryMesh.position.y = 0.06 + pulse * 0.38;
          inst.secondaryMesh.scale.set(ringScale, ringScale, 1);
          const m = inst.secondaryMesh.material as THREE.MeshBasicMaterial;
          m.opacity = (1 - pulse) * 0.85;
        }
        break;
      }

      case 'echo_sensor': {
        const maxR = Math.max(1, eff.radius);
        const wave = (elapsed * 1.35) % 1;
        if (inst.primaryMesh) {
          inst.primaryMesh.position.y = 0.25 + Math.sin(this.animClock * 6) * 0.05;
          inst.primaryMesh.rotation.y = this.animClock * 3.2;
        }
        if (inst.secondaryMesh) {
          const curR = Math.max(0.4, maxR * wave);
          inst.secondaryMesh.position.y = 0.08;
          inst.secondaryMesh.scale.set(curR, curR, 1);
          const m = inst.secondaryMesh.material as THREE.MeshBasicMaterial;
          m.opacity = (1 - wave) * 0.85;
        }
        break;
      }

      case 'jammer_field': {
        const r = Math.max(0.5, eff.radius);
        const pulse = 0.88 + 0.12 * Math.sin(this.animClock * 10);
        if (inst.primaryMesh) {
          inst.primaryMesh.position.y = 0.035;
          inst.primaryMesh.scale.set(r, r, 1);
        }
        if (inst.secondaryMesh) {
          inst.secondaryMesh.position.y = 0.06;
          inst.secondaryMesh.scale.set(r * pulse, r * pulse, 1);
        }
        break;
      }

      case 'global_reveal': {
        const sweepProgress = clamp01(elapsed / total);
        const sweepR = 2 + sweepProgress * 68;
        if (inst.primaryMesh) {
          inst.primaryMesh.position.y = 6.5;
          inst.primaryMesh.scale.set(sweepR, sweepR, 1);
          const m = inst.primaryMesh.material as THREE.MeshBasicMaterial;
          m.opacity = (1 - sweepProgress) * 0.72;
        }
        break;
      }

      case 'magnet_mine': {
        const r = Math.max(0.8, eff.radius);
        const isAlly = eff.team === localTeam;
        const armed = eff.armed !== false;
        const triggered = eff.triggered === true;

        if (inst.primaryMesh) {
          const m = inst.primaryMesh.material as THREE.MeshBasicMaterial;
          m.color.setHex(
            triggered ? 0xff6b2b : isAlly ? (armed ? 0x18d4c9 : 0xffd166) : 0xff5a36
          );
        }
        if (inst.secondaryMesh) {
          inst.secondaryMesh.visible = isAlly || triggered;
          inst.secondaryMesh.scale.set(r, r, 1);
          const m = inst.secondaryMesh.material as THREE.MeshBasicMaterial;
          m.opacity = triggered ? 0.78 : 0.28;
        }
        if (inst.tertiaryMesh) {
          inst.tertiaryMesh.visible = triggered;
          if (triggered) {
            const burstScale = Math.max(0.6, r * (1 - clamp01(eff.remainingSec / 0.4)));
            inst.tertiaryMesh.position.y = 0.25;
            inst.tertiaryMesh.scale.setScalar(burstScale);
            const m = inst.tertiaryMesh.material as THREE.MeshBasicMaterial;
            m.opacity = clamp01(eff.remainingSec / 0.4) * 0.55;
          }
        }
        break;
      }

      case 'shield_post': {
        inst.group.rotation.y = eff.yaw;
        const maxHp = Math.max(1, eff.maxHp ?? 400);
        const hp = clamp01((eff.hp ?? maxHp) / maxHp);

        if (inst.primaryMesh) {
          const m = inst.primaryMesh.material as THREE.MeshStandardMaterial;
          if (hp > 0.55) {
            m.color.setHex(0x154b52);
            m.emissive.setHex(0x18d4c9);
          } else if (hp > 0.25) {
            m.color.setHex(0x523c14);
            m.emissive.setHex(0xf59e0b);
          } else {
            m.color.setHex(0x561d16);
            m.emissive.setHex(0xff471a);
          }
          m.emissiveIntensity = 0.45 + 0.3 * hp;
        }

        if (inst.hpBarFillMesh) {
          inst.hpBarFillMesh.scale.x = Math.max(0.02, hp);
          inst.hpBarFillMesh.position.x = -(1 - hp) * 0.87;
          const fm = inst.hpBarFillMesh.material as THREE.MeshBasicMaterial;
          fm.color.setHex(hp > 0.55 ? 0x18d4c9 : hp > 0.25 ? 0xffb02e : 0xff471a);
        }
        break;
      }

      case 'bastion_zone': {
        const r = Math.max(1, eff.radius);
        if (inst.primaryMesh) {
          inst.primaryMesh.position.y = 0.03;
          inst.primaryMesh.scale.set(r, r, 1);
        }
        if (inst.secondaryMesh) {
          inst.secondaryMesh.position.y = 0.05;
          inst.secondaryMesh.scale.set(r, r, 1);
        }
        if (inst.pillarMeshes) {
          const count = inst.pillarMeshes.length;
          for (let i = 0; i < count; i += 1) {
            const angle = (i / count) * Math.PI * 2 + this.animClock * 0.35;
            const pillar = inst.pillarMeshes[i];
            pillar.position.set(
              Math.cos(angle) * r,
              0.95 + Math.sin(this.animClock * 4 + i) * 0.08,
              Math.sin(angle) * r
            );
          }
        }
        break;
      }

      case 'dash_trail':
      default: {
        inst.group.rotation.y = eff.yaw;
        if (inst.primaryMesh) {
          const m = inst.primaryMesh.material as THREE.MeshBasicMaterial;
          m.opacity = lifeRatio * 0.72;
          inst.primaryMesh.scale.set(1, 1, 0.5 + 0.5 * lifeRatio);
        }
        break;
      }
    }
  }

  private disposeInstance(inst: EffectVisualInstance): void {
    this.root.remove(inst.group);
    for (const g of inst.ownedGeometries) {
      g.dispose();
    }
    for (const m of inst.ownedMaterials) {
      m.dispose();
    }
  }

  public dispose(): void {
    this.clear();
    this.root.removeFromParent();
    this.unitSphereGeo.dispose();
    this.unitIcosaGeo.dispose();
    this.unitOpenCylGeo.dispose();
    this.unitDiscGeo.dispose();
    this.unitThinRingGeo.dispose();
    this.unitThickRingGeo.dispose();
    this.mineBodyGeo.dispose();
    this.mineCoreGeo.dispose();
    this.sensorPuckGeo.dispose();
    this.barrierWallGeo.dispose();
    this.barrierCapGeo.dispose();
    this.barrierPillarGeo.dispose();
    this.hpTrackGeo.dispose();
    this.hpFillGeo.dispose();
    this.bastionPillarGeo.dispose();
    this.dashBladeGeo.dispose();
    this.matSmokeCore.dispose();
    this.matSmokeOuterShell.dispose();
    this.matDarkRingWall.dispose();
    this.matSmokeAmberRim.dispose();
    this.matDarkSteel.dispose();
  }
}
