import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import type { GameSettings, PlayerStance, Vec3, WeaponId } from '../core/types';
import { type ScopeType, WEAPONS } from '../data/weapons';

export type ViewmodelKind = 'weapon' | 'knife' | 'kern';

export interface CameraFrameInput {
  eyePos: Vec3;
  yaw: number;
  pitch: number;
  visualRecoilPitchRad: number;
  visualRecoilYawRad: number;
  weaponId: WeaponId;
  viewItem?: ViewmodelKind;
  kernChannelProgress?: number; // 0..1 while planting
  isAds: boolean;
  isReloading: boolean;
  reloadProgress: number; // 0..1
  horizontalSpeed: number;
  stance: PlayerStance;
  frameDt: number;
}

export class FirstPersonCamera {
  public readonly camera: THREE.PerspectiveCamera;
  private readonly viewmodelRoot: THREE.Group;
  private readonly weaponGroup: THREE.Group;
  private magazineMesh: THREE.Mesh | null = null;
  private kernCrystalMesh: THREE.Mesh | null = null;
  private magazineRestPos = new THREE.Vector3(0, -0.095, -0.05);
  /** Höhe der Visierlinie über der Waffenachse (für exaktes Zielen). */
  private sightHeight = 0.11;
  private readonly muzzleAnchor: THREE.Object3D;
  private readonly muzzleFlashGroup: THREE.Group;
  private readonly muzzleLight: THREE.PointLight;

  private currentViewKey = '';
  private currentViewKind: ViewmodelKind = 'weapon';
  private currentWeaponId: WeaponId | null = null;
  private baseFov = 95;
  private currentFov = 95;

  // Procedural animation state
  private recoilKickZ = 0;
  private recoilKickPitch = 0;
  private meleeSlashTimer = 0;
  private muzzleFlashTimer = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  private hasPrevAngles = false;
  private adsBlend = 0;
  private currentZoom = 1;
  private zoomLevelIndex = 0;
  private viewVisible = true;

  // Shared viewmodel materials
  private readonly matBodyDark: THREE.MeshStandardMaterial;
  private readonly matSteel: THREE.MeshStandardMaterial;
  private readonly matBladeTitanium: THREE.MeshStandardMaterial;
  private readonly matPolymer: THREE.MeshStandardMaterial;
  private readonly matAccentOrange: THREE.MeshStandardMaterial;
  private readonly matAccentCyan: THREE.MeshStandardMaterial;
  private readonly matKernCore: THREE.MeshStandardMaterial;
  private readonly matMuzzleFlash: THREE.MeshBasicMaterial;

  constructor(settings: GameSettings) {
    this.baseFov = settings.fov;
    this.currentFov = settings.fov;

    const aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.06, 320);
    this.camera.rotation.order = 'YXZ';

    this.matBodyDark = new THREE.MeshStandardMaterial({
      color: 0x1e2833,
      roughness: 0.42,
      metalness: 0.65,
    });
    this.matSteel = new THREE.MeshStandardMaterial({
      color: 0x475666,
      roughness: 0.32,
      metalness: 0.82,
    });
    this.matBladeTitanium = new THREE.MeshStandardMaterial({
      color: 0xcbd8e6,
      emissive: 0x10202c,
      emissiveIntensity: 0.18,
      roughness: 0.18,
      metalness: 0.9,
    });
    this.matPolymer = new THREE.MeshStandardMaterial({
      color: 0x121820,
      roughness: 0.72,
      metalness: 0.18,
    });
    this.matAccentOrange = new THREE.MeshStandardMaterial({
      color: 0xff6b2b,
      emissive: 0xff5510,
      emissiveIntensity: 0.36,
      roughness: 0.35,
      metalness: 0.25,
    });
    this.matAccentCyan = new THREE.MeshStandardMaterial({
      color: 0x18d4c9,
      emissive: 0x12b8ae,
      emissiveIntensity: 0.5,
      roughness: 0.25,
      metalness: 0.2,
    });
    this.matKernCore = new THREE.MeshStandardMaterial({
      color: 0xff8a3d,
      emissive: 0xff5e1a,
      emissiveIntensity: 1.25,
      roughness: 0.18,
      metalness: 0.15,
    });
    this.matMuzzleFlash = new THREE.MeshBasicMaterial({
      color: 0xffbe55,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.viewmodelRoot = new THREE.Group();
    this.viewmodelRoot.position.set(0.22, -0.2, -0.38);
    this.camera.add(this.viewmodelRoot);

    this.weaponGroup = new THREE.Group();
    this.viewmodelRoot.add(this.weaponGroup);

    this.muzzleAnchor = new THREE.Object3D();
    this.weaponGroup.add(this.muzzleAnchor);

    this.muzzleFlashGroup = new THREE.Group();
    this.muzzleFlashGroup.visible = false;
    const flashPlaneA = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), this.matMuzzleFlash);
    flashPlaneA.rotation.y = Math.PI * 0.5;
    const flashPlaneB = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), this.matMuzzleFlash);
    flashPlaneB.rotation.x = Math.PI * 0.5;
    const flashCore = new THREE.Mesh(
      new THREE.ConeGeometry(0.036, 0.14, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.95 })
    );
    flashCore.rotation.x = -Math.PI * 0.5;
    flashCore.position.z = -0.06;
    this.muzzleFlashGroup.add(flashPlaneA, flashPlaneB, flashCore);
    this.muzzleAnchor.add(this.muzzleFlashGroup);

    this.muzzleLight = new THREE.PointLight(0xffa43b, 0, 4.5, 2);
    this.muzzleAnchor.add(this.muzzleLight);

    this.buildWeaponMesh('lanze');
    this.currentViewKey = 'weapon:lanze';
  }

  public setViewmodelVisible(visible: boolean): void {
    this.viewVisible = visible;
    this.viewmodelRoot.visible = visible;
  }

  public applySettings(settings: GameSettings): void {
    this.baseFov = clamp(settings.fov, 70, 110);
  }

  public resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public triggerShotKick(weaponId: WeaponId): void {
    if (this.currentViewKind === 'knife') {
      this.triggerMeleeSwing();
      return;
    }
    const heavy = weaponId === 'falke' || weaponId === 'brecher' || weaponId === 'bolzer';
    this.recoilKickZ = Math.min(0.095, this.recoilKickZ + (heavy ? 0.068 : 0.036));
    this.recoilKickPitch = Math.min(0.14, this.recoilKickPitch + (heavy ? 0.085 : 0.038));
    this.muzzleFlashTimer = 0.042;
    this.muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
    const scale = 0.85 + Math.random() * 0.4;
    this.muzzleFlashGroup.scale.set(scale, scale, scale);
  }

  public triggerMeleeSwing(): void {
    this.meleeSlashTimer = 0.26;
  }

  public getMuzzleWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.camera.updateMatrixWorld(true);
    return this.muzzleAnchor.getWorldPosition(out);
  }

  public isScopedFalke(): boolean {
    return this.getScopeView().type === 'sniper';
  }

  /**
   * Aktiver Visier-Zustand für das HUD. `type` ist nur gesetzt, sobald das Zielen
   * weit genug eingeblendet ist (Präzision: Okular, Reflex/Holo: Leuchtabsehen).
   */
  public getScopeView(): { type: ScopeType; blend: number; zoom: number; level: number } {
    if (this.currentViewKind !== 'weapon' || !this.currentWeaponId) {
      return { type: 'none', blend: 0, zoom: 1, level: 0 };
    }
    const scope = WEAPONS[this.currentWeaponId].scope;
    const threshold = scope.type === 'sniper' ? 0.65 : 0.45;
    const active = scope.type !== 'none' && this.adsBlend > threshold;
    return {
      type: active ? scope.type : 'none',
      blend: this.adsBlend,
      zoom: this.currentZoom,
      level: this.zoomLevelIndex,
    };
  }

  /** Wechselt bei Präzisionsoptiken zur nächsten Zoomstufe (Mausrad / Taste). */
  public cycleZoomLevel(dir: 1 | -1 = 1): void {
    if (!this.currentWeaponId) return;
    const levels = WEAPONS[this.currentWeaponId].scope.zoomLevels;
    if (levels.length <= 1) return;
    this.zoomLevelIndex = (this.zoomLevelIndex + dir + levels.length) % levels.length;
  }

  public update(state: CameraFrameInput): void {
    const dt = Math.min(0.1, Math.max(0.0001, state.frameDt));
    const viewKind: ViewmodelKind = state.viewItem ?? 'weapon';
    const nextViewKey = viewKind === 'weapon' ? `weapon:${state.weaponId}` : viewKind;

    if (this.currentViewKey !== nextViewKey) {
      this.currentViewKey = nextViewKey;
      this.currentViewKind = viewKind;
      if (viewKind === 'knife') {
        this.buildKnifeMesh();
      } else if (viewKind === 'kern') {
        this.buildKernViewMesh();
      } else {
        this.buildWeaponMesh(state.weaponId);
      }
    }

    // 1. Interpolated eye position
    this.camera.position.set(state.eyePos.x, state.eyePos.y, state.eyePos.z);

    // 2. Instant mouse-look + visible deterministic recoil camera kick
    this.camera.rotation.y = state.yaw - state.visualRecoilYawRad * 0.35;
    this.camera.rotation.x = clamp(
      state.pitch + state.visualRecoilPitchRad * 0.65,
      -1.52,
      1.52
    );
    this.camera.rotation.z = 0;

    // 3. Visier-Zoom (Reflex / Holo / Präzision mit Zoomstufen)
    const scopeSpec = WEAPONS[state.weaponId]?.scope;
    const wantsScope =
      viewKind === 'weapon' &&
      !!scopeSpec &&
      scopeSpec.type !== 'none' &&
      state.isAds &&
      !state.isReloading;
    if (!wantsScope) {
      this.zoomLevelIndex = 0;
    }
    const targetAds = wantsScope ? 1 : 0;
    const adsSpeed = scopeSpec?.type === 'sniper' ? 18 : 22;
    this.adsBlend = lerp(this.adsBlend, targetAds, 1 - Math.exp(-adsSpeed * dt));

    const levels = scopeSpec?.zoomLevels ?? [1];
    const zoom = levels[Math.min(this.zoomLevelIndex, levels.length - 1)] ?? 1;
    this.currentZoom = lerp(this.currentZoom, wantsScope ? zoom : 1, 1 - Math.exp(-20 * dt));
    const halfBase = (this.baseFov * Math.PI) / 360;
    const zoomedFov = (Math.atan(Math.tan(halfBase) / Math.max(1, this.currentZoom)) * 360) / Math.PI;
    const targetFov = lerp(this.baseFov, zoomedFov, this.adsBlend);
    if (Math.abs(targetFov - this.currentFov) > 0.02) {
      this.currentFov = targetFov;
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    // 4. Angular look sway
    if (!this.hasPrevAngles) {
      this.prevYaw = state.yaw;
      this.prevPitch = state.pitch;
      this.hasPrevAngles = true;
    }
    let deltaYaw = state.yaw - this.prevYaw;
    if (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    if (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    const deltaPitch = state.pitch - this.prevPitch;
    this.prevYaw = state.yaw;
    this.prevPitch = state.pitch;

    this.swayYaw = clamp(
      lerp(this.swayYaw + deltaYaw * 0.45, 0, 1 - Math.exp(-14 * dt)),
      -0.06,
      0.06
    );
    this.swayPitch = clamp(
      lerp(this.swayPitch + deltaPitch * 0.45, 0, 1 - Math.exp(-14 * dt)),
      -0.06,
      0.06
    );

    // 5. Movement walk/run bob
    const groundedMoving = state.stance !== 'air' && state.horizontalSpeed > 0.25;
    const speedRatio = clamp(state.horizontalSpeed / 5.6, 0, 1.2);
    const targetBob = groundedMoving ? speedRatio : 0;
    this.bobAmount = lerp(this.bobAmount, targetBob, 1 - Math.exp(-10 * dt));
    if (groundedMoving) {
      this.bobPhase += dt * (6.5 + speedRatio * 5.2);
    }

    const bobX = Math.cos(this.bobPhase) * 0.0085 * this.bobAmount * (1 - this.adsBlend * 0.85);
    const bobY =
      Math.abs(Math.sin(this.bobPhase)) * -0.0095 * this.bobAmount * (1 - this.adsBlend * 0.85);

    // 6. Snappy recoil recovery & melee slash decay
    this.recoilKickZ = lerp(this.recoilKickZ, 0, 1 - Math.exp(-20 * dt));
    this.recoilKickPitch = lerp(this.recoilKickPitch, 0, 1 - Math.exp(-18 * dt));
    if (this.meleeSlashTimer > 0) {
      this.meleeSlashTimer = Math.max(0, this.meleeSlashTimer - dt);
    }

    // 7. Muzzle flash decay
    if (this.muzzleFlashTimer > 0 && viewKind === 'weapon') {
      this.muzzleFlashTimer -= dt;
      this.muzzleFlashGroup.visible = true;
      this.muzzleLight.intensity = 2.6 * Math.max(0, this.muzzleFlashTimer / 0.042);
    } else {
      this.muzzleFlashGroup.visible = false;
      this.muzzleLight.intensity = 0;
    }

    // 8. Reload / Knife Slash / Kern Channeling Animations
    let reloadRoll = 0;
    let reloadPitch = 0;
    let reloadDropY = 0;
    let extraOffsetX = 0;
    let extraOffsetZ = 0;
    let extraYaw = 0;

    if (viewKind === 'weapon' && state.isReloading) {
      const p = clamp(state.reloadProgress, 0, 1);
      const tiltCurve = Math.sin(p * Math.PI);
      reloadRoll = 0.46 * tiltCurve;
      reloadPitch = 0.22 * tiltCurve;
      reloadDropY = -0.035 * tiltCurve;

      if (this.magazineMesh) {
        let magOffset = 0;
        if (p < 0.25) {
          magOffset = -(p / 0.25) * 0.22;
        } else if (p < 0.62) {
          const insertT = (p - 0.25) / 0.37;
          magOffset = -0.22 * (1 - insertT);
        }
        this.magazineMesh.position.set(
          this.magazineRestPos.x,
          this.magazineRestPos.y + magOffset,
          this.magazineRestPos.z
        );
      }
    } else if (this.magazineMesh) {
      this.magazineMesh.position.copy(this.magazineRestPos);
    }

    if (viewKind === 'knife' && this.meleeSlashTimer > 0) {
      const slashFrac = 1 - this.meleeSlashTimer / 0.26;
      const arc = Math.sin(slashFrac * Math.PI);
      extraOffsetX = -0.14 * arc;
      extraOffsetZ = -0.11 * arc;
      extraYaw = 0.85 * arc;
      reloadPitch = -0.35 * arc;
      reloadRoll = -0.55 * arc;
    }

    if (viewKind === 'kern') {
      const prog = clamp(state.kernChannelProgress ?? 0, 0, 1);
      if (this.kernCrystalMesh) {
        this.kernCrystalMesh.rotation.y += dt * (2.2 + prog * 10.0);
        this.kernCrystalMesh.rotation.x += dt * (0.9 + prog * 3.5);
        this.matKernCore.emissiveIntensity = 1.15 + prog * 1.4;
      }
      reloadDropY = -0.025 * Math.sin(prog * Math.PI);
      extraOffsetZ = -0.06 * prog;
    }

    this.viewmodelRoot.visible = this.viewVisible;
    // Präzisionsoptik blendet die Waffe aus (Vollbild-Okular), Reflex/Holo bleiben sichtbar.
    const hidesWeapon = this.currentWeaponId ? WEAPONS[this.currentWeaponId].scope.type === 'sniper' : false;
    this.weaponGroup.visible = this.viewVisible && (!hidesWeapon || this.adsBlend < 0.88);

    const defaultX = viewKind === 'kern' ? 0.02 : viewKind === 'knife' ? 0.19 : 0.215;
    const defaultY = viewKind === 'kern' ? -0.19 : viewKind === 'knife' ? -0.175 : -0.195;
    const defaultZ = viewKind === 'kern' ? -0.36 : viewKind === 'knife' ? -0.33 : -0.38;

    // Beim Zielen wird die Visierlinie exakt auf die Bildschirmmitte gezogen.
    const adsY = -this.sightHeight;
    const baseX = lerp(defaultX, 0.0, this.adsBlend);
    const baseY = lerp(defaultY, adsY, this.adsBlend);
    const baseZ = lerp(defaultZ, -0.24, this.adsBlend);

    this.viewmodelRoot.position.set(
      baseX + bobX + extraOffsetX - this.swayYaw * 0.28,
      baseY + bobY + reloadDropY + this.swayPitch * 0.24,
      baseZ + this.recoilKickZ + extraOffsetZ
    );

    this.weaponGroup.rotation.set(
      this.recoilKickPitch + reloadPitch + this.swayPitch * 0.5,
      extraYaw - this.swayYaw * 0.65,
      reloadRoll - this.swayYaw * 0.35
    );
  }

  private clearWeaponGroup(): void {
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.weaponGroup.children) {
      if (child !== this.muzzleAnchor) {
        toRemove.push(child);
      }
    }
    for (const obj of toRemove) {
      this.weaponGroup.remove(obj);
      obj.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          mesh.geometry.dispose();
          if (mesh.userData.ownMaterial) {
            (mesh.material as THREE.Material).dispose();
          }
        }
      });
    }
    this.magazineMesh = null;
    this.kernCrystalMesh = null;
  }

  /**
   * Procedural SHARDLINE Taktik-Klinge (Slot 3 Melee)
   */
  private buildKnifeMesh(): void {
    this.clearWeaponGroup();
    this.currentWeaponId = null;

    const knifePose = new THREE.Group();
    knifePose.rotation.set(0.28, 0.36, -0.26);

    // Ergonomic polymer handle
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.11, 0.036), this.matPolymer);
    grip.position.set(0, -0.04, 0.05);
    knifePose.add(grip);

    // Tactical finger-ring pommel
    const pommelRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.018, 0.0045, 6, 16),
      this.matSteel
    );
    pommelRing.rotation.y = Math.PI * 0.5;
    pommelRing.position.set(0, -0.105, 0.055);
    knifePose.add(pommelRing);

    // Angled cross-guard with orange/cyan shard accents
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.014, 0.068), this.matBodyDark);
    guard.position.set(0, 0.018, 0.042);
    knifePose.add(guard);

    const guardPip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.022), this.matAccentCyan);
    guardPip.position.set(0, 0.022, 0.042);
    knifePose.add(guardPip);

    // Angled geometric titanium shard blade extending forward/upward
    const bladeSpine = new THREE.Mesh(
      new THREE.BoxGeometry(0.009, 0.165, 0.034),
      this.matBladeTitanium
    );
    bladeSpine.position.set(0, 0.108, 0.026);
    bladeSpine.rotation.x = -0.16;
    knifePose.add(bladeSpine);

    // Chisel tanto tip
    const bladeTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.085, 4),
      this.matBladeTitanium
    );
    bladeTip.position.set(0, 0.215, 0.012);
    bladeTip.rotation.x = -0.18;
    bladeTip.rotation.y = Math.PI * 0.25;
    knifePose.add(bladeTip);

    // Glowing thermal plasma edge strip along front edge
    const plasmaEdge = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.21, 0.006),
      this.matAccentOrange
    );
    plasmaEdge.position.set(0, 0.125, 0.006);
    plasmaEdge.rotation.x = -0.17;
    knifePose.add(plasmaEdge);

    this.muzzleAnchor.position.set(0, 0.05, -0.25);
    this.weaponGroup.add(knifePose);
  }

  /**
   * Procedural 3D "Kern" Industrial Energy Core held in hands while planting
   */
  private buildKernViewMesh(): void {
    this.clearWeaponGroup();
    this.currentWeaponId = null;

    const kernHold = new THREE.Group();
    kernHold.rotation.set(0.22, 0, 0);

    // Bottom & top hexagonal titanium end-caps
    const bottomCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.095, 0.032, 6),
      this.matBodyDark
    );
    bottomCap.position.set(0, -0.095, -0.02);
    kernHold.add(bottomCap);

    const topCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.088, 0.028, 6),
      this.matBodyDark
    );
    topCap.position.set(0, 0.095, -0.02);
    kernHold.add(topCap);

    // Cyan status collar ring
    const statusRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.086, 0.086, 0.01, 6),
      this.matAccentCyan
    );
    statusRing.position.set(0, 0.075, -0.02);
    kernHold.add(statusRing);

    // 3 containment cage struts around core
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const strut = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.18, 0.018),
        this.matSteel
      );
      strut.position.set(
        Math.cos(angle) * 0.076,
        0,
        -0.02 + Math.sin(angle) * 0.076
      );
      kernHold.add(strut);
    }

    // Glowing plasma shard crystal inside cage
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.056, 0),
      this.matKernCore
    );
    crystal.scale.set(1, 1.45, 1);
    crystal.position.set(0, 0, -0.02);
    this.kernCrystalMesh = crystal;
    kernHold.add(crystal);

    this.muzzleAnchor.position.set(0, 0, -0.18);
    this.weaponGroup.add(kernHold);
  }

  private buildWeaponMesh(weaponId: WeaponId): void {
    this.clearWeaponGroup();
    this.currentWeaponId = weaponId;

    let receiverLen = 0.36;
    let receiverHeight = 0.068;
    let receiverWidth = 0.048;
    let barrelLen = 0.26;
    let barrelRadius = 0.011;
    let magHeight = 0.135;
    let hasStock = true;
    let hasScope = false;

    switch (weaponId) {
      case 'funke':
        receiverLen = 0.18;
        receiverHeight = 0.046;
        receiverWidth = 0.036;
        barrelLen = 0.05;
        barrelRadius = 0.008;
        magHeight = 0.085;
        hasStock = false;
        break;
      case 'bolzer':
        receiverLen = 0.24;
        receiverHeight = 0.058;
        receiverWidth = 0.042;
        barrelLen = 0.11;
        barrelRadius = 0.012;
        magHeight = 0.095;
        hasStock = false;
        break;
      case 'hornisse':
        receiverLen = 0.26;
        receiverHeight = 0.062;
        receiverWidth = 0.046;
        barrelLen = 0.12;
        barrelRadius = 0.01;
        magHeight = 0.145;
        hasStock = true;
        break;
      case 'brecher':
        receiverLen = 0.38;
        receiverHeight = 0.066;
        receiverWidth = 0.054;
        barrelLen = 0.28;
        barrelRadius = 0.016;
        magHeight = 0.07;
        hasStock = true;
        break;
      case 'falke':
        receiverLen = 0.42;
        receiverHeight = 0.068;
        receiverWidth = 0.05;
        barrelLen = 0.42;
        barrelRadius = 0.013;
        magHeight = 0.095;
        hasStock = true;
        hasScope = true;
        break;
      case 'lanze':
      default:
        receiverLen = 0.36;
        receiverHeight = 0.066;
        receiverWidth = 0.048;
        barrelLen = 0.25;
        barrelRadius = 0.011;
        magHeight = 0.138;
        hasStock = true;
        break;
    }

    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(receiverWidth, receiverHeight, receiverLen),
      this.matBodyDark
    );
    receiver.position.set(0, 0, -0.04);
    this.weaponGroup.add(receiver);

    const lower = new THREE.Mesh(
      new THREE.BoxGeometry(receiverWidth * 0.92, receiverHeight * 0.58, receiverLen * 0.68),
      this.matPolymer
    );
    lower.position.set(0, -receiverHeight * 0.55, 0.0);
    this.weaponGroup.add(lower);

    const orangeStrip = new THREE.Mesh(
      new THREE.BoxGeometry(receiverWidth + 0.004, 0.011, receiverLen * 0.62),
      this.matAccentOrange
    );
    orangeStrip.position.set(0, receiverHeight * 0.22, -0.05);
    this.weaponGroup.add(orangeStrip);

    const statusPip = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.006, 0.016),
      this.matAccentCyan
    );
    statusPip.position.set(0, receiverHeight * 0.52, receiverLen * 0.36);
    this.weaponGroup.add(statusPip);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(receiverWidth * 0.62, 0.012, receiverLen * 0.88),
      this.matSteel
    );
    rail.position.set(0, receiverHeight * 0.5 + 0.006, -0.04);
    this.weaponGroup.add(rail);

    if (barrelLen > 0.14) {
      const shroudLen = barrelLen * 0.58;
      const shroud = new THREE.Mesh(
        new THREE.BoxGeometry(receiverWidth * 0.84, receiverHeight * 0.78, shroudLen),
        this.matBodyDark
      );
      shroud.position.set(0, -0.003, -0.04 - receiverLen * 0.5 - shroudLen * 0.48);
      this.weaponGroup.add(shroud);
    }

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelRadius, barrelRadius * 1.08, barrelLen, 10),
      this.matSteel
    );
    barrel.rotation.x = Math.PI * 0.5;
    const barrelCenterZ = -0.04 - receiverLen * 0.5 - barrelLen * 0.5;
    barrel.position.set(0, 0.006, barrelCenterZ);
    this.weaponGroup.add(barrel);

    const muzzleZ = -0.04 - receiverLen * 0.5 - barrelLen - 0.018;
    const muzzleBrake = new THREE.Mesh(
      new THREE.BoxGeometry(barrelRadius * 2.5, barrelRadius * 2.3, 0.042),
      this.matPolymer
    );
    muzzleBrake.position.set(0, 0.006, muzzleZ);
    this.weaponGroup.add(muzzleBrake);

    this.muzzleAnchor.position.set(0, 0.006, muzzleZ - 0.032);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.105, 0.044), this.matPolymer);
    grip.position.set(0, -0.088, 0.075);
    grip.rotation.x = 0.28;
    this.weaponGroup.add(grip);

    const magZ = weaponId === 'funke' || weaponId === 'bolzer' ? 0.072 : -0.065;
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(receiverWidth * 0.68, magHeight, 0.048),
      this.matSteel
    );
    this.magazineRestPos.set(0, -0.055 - magHeight * 0.42, magZ);
    mag.position.copy(this.magazineRestPos);
    mag.rotation.x = weaponId === 'funke' || weaponId === 'bolzer' ? 0.28 : -0.18;

    const magBaseplate = new THREE.Mesh(
      new THREE.BoxGeometry(receiverWidth * 0.74, 0.014, 0.054),
      this.matAccentOrange
    );
    magBaseplate.position.set(0, -magHeight * 0.5, 0);
    mag.add(magBaseplate);

    this.magazineMesh = mag;
    this.weaponGroup.add(mag);

    if (hasStock) {
      const stock = new THREE.Mesh(
        new THREE.BoxGeometry(receiverWidth * 0.78, receiverHeight * 0.88, 0.16),
        this.matPolymer
      );
      stock.position.set(0, -0.012, -0.04 + receiverLen * 0.5 + 0.075);
      this.weaponGroup.add(stock);
    }

    const scopeType = WEAPONS[weaponId].scope.type;
    const railTop = receiverHeight * 0.5 + 0.012;

    if (hasScope || scopeType === 'sniper') {
      const scopeY = railTop + 0.03;
      // Ringmontagen
      for (const z of [-0.1, 0.02]) {
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), this.matSteel);
        mount.position.set(0, railTop + 0.012, z);
        this.weaponGroup.add(mount);
      }
      const scopeTube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.2, 16),
        this.matBodyDark
      );
      scopeTube.rotation.x = Math.PI * 0.5;
      scopeTube.position.set(0, scopeY, -0.04);
      this.weaponGroup.add(scopeTube);

      // Objektiv- und Okularglocke
      const objective = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.021, 0.06, 16),
        this.matBodyDark
      );
      objective.rotation.x = Math.PI * 0.5;
      objective.position.set(0, scopeY, -0.165);
      this.weaponGroup.add(objective);
      const eyepiece = new THREE.Mesh(
        new THREE.CylinderGeometry(0.021, 0.025, 0.05, 16),
        this.matPolymer
      );
      eyepiece.rotation.x = Math.PI * 0.5;
      eyepiece.position.set(0, scopeY, 0.08);
      this.weaponGroup.add(eyepiece);

      const lensRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.006, 16),
        this.matAccentCyan
      );
      lensRing.rotation.x = Math.PI * 0.5;
      lensRing.position.set(0, scopeY, -0.197);
      this.weaponGroup.add(lensRing);

      // Turrets
      const turretTop = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 10), this.matSteel);
      turretTop.position.set(0, scopeY + 0.026, -0.04);
      const turretSide = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 10), this.matSteel);
      turretSide.rotation.z = Math.PI * 0.5;
      turretSide.position.set(0.026, scopeY, -0.04);
      this.weaponGroup.add(turretTop, turretSide);

      this.sightHeight = scopeY;
    } else if (scopeType === 'reflex' || scopeType === 'holo') {
      // Offenes Visier-Gehäuse: Basis + Rahmen + getöntes Glas
      const isHolo = scopeType === 'holo';
      const frameW = isHolo ? 0.046 : 0.034;
      const frameH = isHolo ? 0.036 : 0.03;
      const sightZ = isHolo ? -0.02 : 0.0;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(frameW, 0.012, isHolo ? 0.07 : 0.045),
        this.matBodyDark
      );
      base.position.set(0, railTop + 0.006, sightZ);
      this.weaponGroup.add(base);

      const centerY = railTop + 0.012 + frameH * 0.5;
      const t = 0.0045;
      const sides = [
        { w: t, h: frameH, x: -frameW * 0.5 + t * 0.5, y: centerY },
        { w: t, h: frameH, x: frameW * 0.5 - t * 0.5, y: centerY },
        { w: frameW, h: t, x: 0, y: centerY + frameH * 0.5 - t * 0.5 },
      ];
      for (const s of sides) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, 0.012), this.matBodyDark);
        bar.position.set(s.x, s.y, sightZ - 0.015);
        this.weaponGroup.add(bar);
      }
      if (isHolo) {
        // Holo-Visiere haben eine Schutzhaube über dem Glas
        const hood = new THREE.Mesh(new THREE.BoxGeometry(frameW, t, 0.06), this.matSteel);
        hood.position.set(0, centerY + frameH * 0.5, sightZ);
        this.weaponGroup.add(hood);
      }
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(frameW - t * 2, frameH - t),
        new THREE.MeshStandardMaterial({
          color: 0x3fd6ff,
          emissive: 0x0a3040,
          transparent: true,
          opacity: 0.18,
          roughness: 0.05,
          metalness: 0.4,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      glass.position.set(0, centerY - t * 0.5, sightZ - 0.015);
      glass.userData.ownMaterial = true;
      this.weaponGroup.add(glass);

      // Kleine Leuchtdiode am Gehäuse
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.005), this.matAccentOrange);
      led.position.set(frameW * 0.5 + 0.002, railTop + 0.01, sightZ + 0.01);
      this.weaponGroup.add(led);

      this.sightHeight = centerY;
    } else {
      const rearPostL = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.022, 0.018), this.matSteel);
      rearPostL.position.set(-0.012, receiverHeight * 0.5 + 0.02, 0.08);
      const rearPostR = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.022, 0.018), this.matSteel);
      rearPostR.position.set(0.012, receiverHeight * 0.5 + 0.02, 0.08);
      const frontPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.024, 0.01),
        this.matAccentOrange
      );
      frontPost.position.set(0, receiverHeight * 0.5 + 0.02, -0.04 - receiverLen * 0.44);
      this.weaponGroup.add(rearPostL, rearPostR, frontPost);
      this.sightHeight = receiverHeight * 0.5 + 0.026;
    }
  }
  public dispose(): void {
    this.clearWeaponGroup();
    this.matBodyDark.dispose();
    this.matSteel.dispose();
    this.matBladeTitanium.dispose();
    this.matPolymer.dispose();
    this.matAccentOrange.dispose();
    this.matAccentCyan.dispose();
    this.matKernCore.dispose();
    this.matMuzzleFlash.dispose();
  }
}
