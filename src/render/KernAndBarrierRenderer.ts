import * as THREE from 'three';
import type { KernSnapshot, KernStatus, RoundStateSnapshot } from '../core/types';
import type { MapDefinition, SpawnBarrierDef } from '../data/maps/types';

interface BarrierVisual {
  group: THREE.Group;
  wallMesh: THREE.Mesh;
  wallMat: THREE.MeshBasicMaterial;
  railMat: THREE.MeshBasicMaterial;
  baseCenterY: number;
  height: number;
}

export class KernAndBarrierRenderer {
  private readonly root: THREE.Group;
  private readonly barrierGroup: THREE.Group;
  private readonly barriers: BarrierVisual[] = [];
  private barrierBlend = 0;
  private scanScrollOffset = 0;

  // Procedural scanline grid texture shared across barriers
  private readonly barrierGridTex: THREE.CanvasTexture;

  // 3D Kern assembly
  private readonly kernRoot: THREE.Group;
  private readonly kernBodyGroup: THREE.Group;
  private readonly kernCrystal: THREE.Mesh;
  private readonly kernCrystalMat: THREE.MeshStandardMaterial;
  private readonly kernCollarMat: THREE.MeshStandardMaterial;
  private readonly kernLight: THREE.PointLight;
  private readonly dropBeaconMesh: THREE.Mesh;
  private readonly dropBeaconMat: THREE.MeshBasicMaterial;
  private readonly radiusRingMesh: THREE.Mesh;
  private readonly radiusRingMat: THREE.MeshBasicMaterial;
  private readonly defuseBeamMesh: THREE.Mesh;
  private readonly defuseBeamMat: THREE.MeshBasicMaterial;
  private readonly shockwaveMesh: THREE.Mesh;
  private readonly shockwaveMat: THREE.MeshBasicMaterial;

  private pulsePhase = 0;
  private prevStatus: KernStatus | null = null;
  private detonationTimer = 0;

  private readonly matDarkTitanium = new THREE.MeshStandardMaterial({
    color: 0x18222e,
    roughness: 0.42,
    metalness: 0.72,
  });
  private readonly matSteelStrut = new THREE.MeshStandardMaterial({
    color: 0x46586b,
    roughness: 0.3,
    metalness: 0.85,
  });

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = 'shardline-kern-and-barriers';
    scene.add(this.root);

    this.barrierGroup = new THREE.Group();
    this.barrierGroup.name = 'spawn-barriers';
    this.root.add(this.barrierGroup);

    this.barrierGridTex = this.createBarrierGridTexture();

    // Build procedural 3D "Kern" industrial energy core (~0.45m tall)
    this.kernRoot = new THREE.Group();
    this.kernRoot.name = 'world-kern-device';
    this.kernRoot.visible = false;
    this.root.add(this.kernRoot);

    this.kernBodyGroup = new THREE.Group();
    this.kernRoot.add(this.kernBodyGroup);

    // Base hexagonal anchor plate (y = 0.0 .. 0.06)
    const basePlate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.06, 6),
      this.matDarkTitanium
    );
    basePlate.position.y = 0.03;
    this.kernBodyGroup.add(basePlate);

    // Upper containment crown (y = 0.40 .. 0.45)
    const topCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.21, 0.05, 6),
      this.matDarkTitanium
    );
    topCap.position.y = 0.425;
    this.kernBodyGroup.add(topCap);

    this.kernCollarMat = new THREE.MeshStandardMaterial({
      color: 0xff6b2b,
      emissive: 0xff5512,
      emissiveIntensity: 0.9,
      roughness: 0.25,
      metalness: 0.2,
    });
    const collarRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.215, 0.215, 0.022, 6),
      this.kernCollarMat
    );
    collarRing.position.y = 0.39;
    this.kernBodyGroup.add(collarRing);

    // 4 protective titanium cage ribs
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, 0.36, 0.042),
        this.matSteelStrut
      );
      rib.position.set(Math.cos(ang) * 0.19, 0.22, Math.sin(ang) * 0.19);
      this.kernBodyGroup.add(rib);
    }

    // Glowing central plasma shard crystal
    this.kernCrystalMat = new THREE.MeshStandardMaterial({
      color: 0xff9d42,
      emissive: 0xff6b2b,
      emissiveIntensity: 1.4,
      roughness: 0.15,
      metalness: 0.1,
    });
    this.kernCrystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.125, 0),
      this.kernCrystalMat
    );
    this.kernCrystal.scale.set(1, 1.42, 1);
    this.kernCrystal.position.y = 0.23;
    this.kernBodyGroup.add(this.kernCrystal);

    this.kernLight = new THREE.PointLight(0xff7b29, 0, 9.5, 2);
    this.kernLight.position.set(0, 0.55, 0);
    this.kernRoot.add(this.kernLight);

    // Golden vertical light beacon when Kern is dropped on the ground
    this.dropBeaconMat = new THREE.MeshBasicMaterial({
      color: 0xffa838,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.dropBeaconMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.24, 6.2, 12, 1, true),
      this.dropBeaconMat
    );
    this.dropBeaconMesh.position.y = 3.15;
    this.dropBeaconMesh.visible = false;
    this.kernRoot.add(this.dropBeaconMesh);

    // 2.2m ground radius ring (shows defuse / interaction perimeter)
    this.radiusRingMat = new THREE.MeshBasicMaterial({
      color: 0xff6b2b,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.radiusRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(2.12, 2.22, 40),
      this.radiusRingMat
    );
    this.radiusRingMesh.rotation.x = -Math.PI * 0.5;
    this.radiusRingMesh.position.y = 0.025;
    this.radiusRingMesh.visible = false;
    this.kernRoot.add(this.radiusRingMesh);

    // Cyan defuse-beam shimmer cylinder during active `'defusing'`
    this.defuseBeamMat = new THREE.MeshBasicMaterial({
      color: 0x18d4c9,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.defuseBeamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.28, 2.1, 16, 1, true),
      this.defuseBeamMat
    );
    this.defuseBeamMesh.position.y = 1.05;
    this.defuseBeamMesh.visible = false;
    this.kernRoot.add(this.defuseBeamMesh);

    // Expanding detonation shockwave sphere
    this.shockwaveMat = new THREE.MeshBasicMaterial({
      color: 0xff6b2b,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.shockwaveMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      this.shockwaveMat
    );
    this.shockwaveMesh.visible = false;
    this.root.add(this.shockwaveMesh);
  }

  private createBarrierGridTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 256, 256);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(0, 0, 256, 256);

      // Horizontal tactical scanlines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
      for (let y = 0; y < 256; y += 16) {
        ctx.fillRect(0, y, 256, 3);
      }

      // Diagonal geometric security lattice
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 2;
      for (let i = -256; i < 512; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 256, 256);
        ctx.stroke();
      }

      // Bright top & bottom emitter edge bands
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(0, 0, 256, 10);
      ctx.fillRect(0, 246, 256, 10);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  public buildBarriers(mapDef: MapDefinition): void {
    this.clearBarriers();
    const defs: ReadonlyArray<SpawnBarrierDef> = mapDef.spawnBarriers ?? [];

    for (const b of defs) {
      const group = new THREE.Group();
      const teamHex = b.team === 'A' ? 0xff6b2b : 0x18d4c9;

      const wallMat = new THREE.MeshBasicMaterial({
        color: teamHex,
        map: this.barrierGridTex,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const wallGeo = new THREE.PlaneGeometry(b.size.x, b.size.y);
      const wallMesh = new THREE.Mesh(wallGeo, wallMat);
      wallMesh.position.set(b.pos.x, b.pos.y, b.pos.z);

      // Bottom & top emitter strips
      const railMat = new THREE.MeshBasicMaterial({
        color: teamHex,
        transparent: true,
        opacity: 0.9,
      });
      const bottomRail = new THREE.Mesh(
        new THREE.BoxGeometry(b.size.x, 0.08, Math.max(0.14, b.size.z * 0.5)),
        railMat
      );
      bottomRail.position.set(b.pos.x, Math.max(0.04, b.pos.y - b.size.y * 0.5 + 0.04), b.pos.z);

      group.add(wallMesh, bottomRail);
      group.visible = false;
      this.barrierGroup.add(group);

      this.barriers.push({
        group,
        wallMesh,
        wallMat,
        railMat,
        baseCenterY: b.pos.y,
        height: b.size.y,
      });
    }
  }

  private clearBarriers(): void {
    for (const b of this.barriers) {
      this.barrierGroup.remove(b.group);
      b.group.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          (node as THREE.Mesh).geometry.dispose();
        }
      });
      b.wallMat.dispose();
      b.railMat.dispose();
    }
    this.barriers.length = 0;
    this.barrierBlend = 0;
  }

  public reset(): void {
    this.barrierBlend = 0;
    for (const b of this.barriers) {
      b.group.visible = false;
    }
    this.kernRoot.visible = false;
    this.shockwaveMesh.visible = false;
    this.prevStatus = null;
    this.detonationTimer = 0;
  }

  public sync(round: RoundStateSnapshot | null | undefined, frameDt: number): void {
    const dt = Math.min(0.1, Math.max(0.0001, frameDt));
    this.pulsePhase += dt;

    if (!round) {
      this.reset();
      return;
    }

    // 1. Update Buy-Phase Spawn Barriers
    const targetBarrier = round.barriersActive ? 1 : 0;
    const speed = round.barriersActive ? 10 : 5.5;
    this.barrierBlend += (targetBarrier - this.barrierBlend) * Math.min(1, dt * speed);

    this.scanScrollOffset = (this.scanScrollOffset + dt * 0.35) % 1;
    this.barrierGridTex.offset.y = this.scanScrollOffset;

    const showBarriers = this.barrierBlend > 0.015;
    for (const b of this.barriers) {
      b.group.visible = showBarriers;
      if (showBarriers) {
        b.wallMesh.scale.y = Math.max(0.02, this.barrierBlend);
        b.wallMesh.position.y =
          b.baseCenterY - b.height * 0.5 * (1 - this.barrierBlend);
        b.wallMat.opacity = 0.42 * this.barrierBlend;
        b.railMat.opacity = 0.88 * this.barrierBlend;
      }
    }

    // 2. Update 3D "Kern" Device
    const kern: KernSnapshot = round.kern;
    if (kern.status === 'detonated' && this.prevStatus !== 'detonated') {
      this.detonationTimer = 0.85;
      this.shockwaveMesh.position.set(kern.pos.x, kern.pos.y + 0.3, kern.pos.z);
      this.shockwaveMesh.scale.set(0.5, 0.5, 0.5);
      this.shockwaveMesh.visible = true;
    }
    this.prevStatus = kern.status;

    if (this.detonationTimer > 0) {
      this.detonationTimer = Math.max(0, this.detonationTimer - dt);
      const t = 1 - this.detonationTimer / 0.85;
      const radius = 0.8 + t * 21.5;
      this.shockwaveMesh.scale.set(radius, radius, radius);
      this.shockwaveMat.opacity = (1 - t) * 0.55;
      if (this.detonationTimer <= 0) {
        this.shockwaveMesh.visible = false;
      }
    }

    if (kern.status === 'carried' || kern.status === 'detonated') {
      this.kernRoot.visible = false;
      return;
    }

    this.kernRoot.visible = true;
    this.kernRoot.position.set(kern.pos.x, kern.pos.y, kern.pos.z);

    if (kern.status === 'dropped') {
      const hover = Math.sin(this.pulsePhase * 3.2) * 0.045;
      this.kernBodyGroup.position.y = 0.05 + hover;
      this.kernBodyGroup.rotation.y = this.pulsePhase * 1.1;
      this.kernCrystal.rotation.y = this.pulsePhase * 2.4;

      this.kernCollarMat.color.setHex(0xffa838);
      this.kernCollarMat.emissive.setHex(0xff8818);
      this.kernCrystalMat.color.setHex(0xffbe55);
      this.kernCrystalMat.emissive.setHex(0xff8818);
      this.kernCrystalMat.emissiveIntensity = 1.25;

      this.dropBeaconMesh.visible = true;
      this.dropBeaconMat.opacity = 0.26 + Math.sin(this.pulsePhase * 4.0) * 0.08;

      this.radiusRingMesh.visible = true;
      this.radiusRingMesh.scale.setScalar(1.8 / 2.2); // 1.8m auto-pickup ring
      this.radiusRingMat.color.setHex(0xffb03a);
      this.radiusRingMat.opacity = 0.55;

      this.defuseBeamMesh.visible = false;
      this.kernLight.color.setHex(0xffa838);
      this.kernLight.intensity = 2.4;
      return;
    }

    // Planted / Planting / Defusing / Defused on Zone floor
    this.kernBodyGroup.position.y = 0;
    this.kernBodyGroup.rotation.y = 0;
    this.dropBeaconMesh.visible = false;
    this.radiusRingMesh.visible = true;
    this.radiusRingMesh.scale.setScalar(1.0); // 2.2m defuse ring

    if (kern.status === 'defused') {
      this.kernCollarMat.color.setHex(0x18d4c9);
      this.kernCollarMat.emissive.setHex(0x18d4c9);
      this.kernCrystalMat.color.setHex(0x5bf2b5);
      this.kernCrystalMat.emissive.setHex(0x18d4c9);
      this.kernCrystalMat.emissiveIntensity = 1.1;
      this.radiusRingMat.color.setHex(0x18d4c9);
      this.radiusRingMat.opacity = 0.65;
      this.defuseBeamMesh.visible = false;
      this.kernLight.color.setHex(0x18d4c9);
      this.kernLight.intensity = 2.2;
      return;
    }

    // Urgency scales spin & pulse frequency from 40s -> 0s
    const urgency01 =
      kern.status === 'planting'
        ? kern.progress01 * 0.5
        : Math.max(0, Math.min(1, 1 - kern.fuseRemainingSec / 40));
    const pulseHz = 1.5 + urgency01 * 11.0;
    const pulseWave = 0.5 + 0.5 * Math.sin(this.pulsePhase * pulseHz * Math.PI * 2);

    this.kernCrystal.rotation.y += dt * (2.2 + urgency01 * 12.0);

    if (kern.status === 'defusing') {
      this.kernCollarMat.color.setHex(0x18d4c9);
      this.kernCollarMat.emissive.setHex(0x18d4c9);
      this.kernCrystalMat.color.setHex(0x7af8ef);
      this.kernCrystalMat.emissive.setHex(0x18d4c9);
      this.kernCrystalMat.emissiveIntensity = 1.3 + pulseWave * 0.9;

      this.radiusRingMat.color.setHex(0x18d4c9);
      this.radiusRingMat.opacity = 0.82;

      this.defuseBeamMesh.visible = true;
      this.defuseBeamMesh.rotation.y += dt * 3.2;
      this.defuseBeamMat.opacity = 0.25 + kern.progress01 * 0.35;

      this.kernLight.color.setHex(0x18d4c9);
      this.kernLight.intensity = 3.2 + pulseWave * 1.5;
    } else {
      this.kernCollarMat.color.setHex(0xff6b2b);
      this.kernCollarMat.emissive.setHex(0xff4512);
      this.kernCrystalMat.color.setHex(0xff9442);
      this.kernCrystalMat.emissive.setHex(0xff4512);
      this.kernCrystalMat.emissiveIntensity = 1.0 + pulseWave * (1.2 + urgency01 * 1.5);

      this.radiusRingMat.color.setHex(kern.halfDefused ? 0x18d4c9 : 0xff6b2b);
      this.radiusRingMat.opacity = 0.45 + pulseWave * 0.35;

      this.defuseBeamMesh.visible = false;
      this.kernLight.color.setHex(0xff5e1f);
      this.kernLight.intensity = 2.0 + pulseWave * (2.2 + urgency01 * 2.8);
    }
  }

  public dispose(): void {
    this.clearBarriers();
    this.barrierGridTex.dispose();
    this.matDarkTitanium.dispose();
    this.matSteelStrut.dispose();
    this.kernCrystalMat.dispose();
    this.kernCollarMat.dispose();
    this.dropBeaconMat.dispose();
    this.radiusRingMat.dispose();
    this.defuseBeamMat.dispose();
    this.shockwaveMat.dispose();
    this.root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        (node as THREE.Mesh).geometry.dispose();
      }
    });
    this.root.removeFromParent();
  }
}
