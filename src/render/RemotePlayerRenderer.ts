import * as THREE from 'three';
import type { CharacterId, NetPlayerState, TeamId, Vec3, WeaponId } from '../core/types';
import { CHARACTERS, TEAM_DEFS } from '../data/characters';

interface RemotePlayerVisual {
  uid: string;
  group: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  pelvis: THREE.Mesh;
  torsoCore: THREE.Mesh;
  chestPlate: THREE.Mesh;
  trimStripFront: THREE.Mesh;
  trimStripBack: THREE.Mesh;
  emblemFront: THREE.Mesh;
  emblemBack: THREE.Mesh;
  shoulderL: THREE.Mesh;
  shoulderR: THREE.Mesh;
  neck: THREE.Mesh;
  headGroup: THREE.Group;
  shieldRing: THREE.Mesh;
  weaponPivot: THREE.Group;
  weaponBarrel: THREE.Mesh;
  weaponScope: THREE.Mesh;
  weaponMag: THREE.Mesh;
  muzzleAnchor: THREE.Object3D;
  muzzleFlashMesh: THREE.Mesh;

  // Per-instance materials (for independent team/character colors and hit flash)
  suitMat: THREE.MeshStandardMaterial;
  teamTrimMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshStandardMaterial;
  emblemMat: THREE.MeshStandardMaterial;
  muzzleFlashMat: THREE.MeshBasicMaterial;

  // Ally nameplate sprite & cached state to avoid redundant canvas redraws
  nameplateSprite: THREE.Sprite;
  nameplateMat: THREE.SpriteMaterial;
  nameplateTex: THREE.CanvasTexture;
  nameplateCanvas: HTMLCanvasElement;
  renderedLabelKey: string;

  // Phase 5 Tactical Scan Reveal Marker (`◈ MARKIERT`), Überlast Aura & Bollwerk Rim
  revealedSprite: THREE.Sprite;
  revealedMat: THREE.SpriteMaterial;
  ueberlastAura: THREE.Mesh;
  bastionRim: THREE.Mesh;

  // Animation & state tracking
  team: TeamId;
  character: CharacterId;
  equippedWeapon: WeaponId;
  crouchBlend: number;
  walkPhase: number;
  hitFlashTimer: number;
  muzzleFlashTimer: number;
  wasFlashing: boolean;
  lastVitals: number;
  wasAlive: boolean;
  lastPos: Vec3;
}

interface FloatingCombatPopup {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  age: number;
  lifetime: number;
  velocityY: number;
}

export class RemotePlayerRenderer {
  private readonly root: THREE.Group;
  private readonly instances = new Map<string, RemotePlayerVisual>();
  private readonly popups: FloatingCombatPopup[] = [];

  // Shared procedural low-poly character geometries (1:1 aligned with PlayerHitscan)
  private readonly legGeo = new THREE.BoxGeometry(0.18, 0.66, 0.22);
  private readonly pelvisGeo = new THREE.BoxGeometry(0.46, 0.18, 0.28);
  private readonly torsoGeo = new THREE.CylinderGeometry(0.29, 0.25, 0.62, 10);
  private readonly chestPlateGeo = new THREE.BoxGeometry(0.45, 0.42, 0.32);
  private readonly trimStripGeo = new THREE.BoxGeometry(0.38, 0.08, 0.03);
  private readonly emblemGeo = new THREE.OctahedronGeometry(0.075, 0);
  private readonly shoulderGeo = new THREE.BoxGeometry(0.19, 0.22, 0.27);
  private readonly armGeo = new THREE.BoxGeometry(0.13, 0.46, 0.15);
  private readonly neckGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.14, 8);
  // Exact head hitbox radius ~0.21 m centered at y + 1.56 (stand) / y + 1.04 (crouch)
  private readonly headGeo = new THREE.SphereGeometry(0.208, 16, 12);
  private readonly visorGeo = new THREE.CylinderGeometry(
    0.215,
    0.215,
    0.078,
    14,
    1,
    true,
    -Math.PI * 0.42,
    Math.PI * 0.84
  );
  private readonly backCrestGeo = new THREE.BoxGeometry(0.14, 0.07, 0.06);
  private readonly shieldRingGeo = new THREE.TorusGeometry(0.44, 0.02, 8, 28);

  // Held 3D weapon geometries (oriented along -Z aim axis)
  private readonly weaponReceiverGeo = new THREE.BoxGeometry(0.075, 0.11, 0.42);
  private readonly weaponBarrelGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.44, 8);
  private readonly weaponMagGeo = new THREE.BoxGeometry(0.048, 0.17, 0.085);
  private readonly weaponScopeGeo = new THREE.CylinderGeometry(0.026, 0.028, 0.24, 8);
  private readonly muzzleFlashGeo = new THREE.OctahedronGeometry(0.085, 0);

  private readonly sharedDarkGunMat = new THREE.MeshStandardMaterial({
    color: 0x17202b,
    roughness: 0.45,
    metalness: 0.62,
  });
  private readonly sharedLimbMat = new THREE.MeshStandardMaterial({
    color: 0x161f29,
    roughness: 0.64,
    metalness: 0.32,
  });
  private readonly sharedShieldMat = new THREE.MeshBasicMaterial({
    color: 0x18d4c9,
    transparent: true,
    opacity: 0.72,
  });
  private readonly auraRingGeo = new THREE.TorusGeometry(0.5, 0.024, 8, 28);
  private readonly bastionFootGeo = new THREE.RingGeometry(0.46, 0.58, 24);
  private readonly sharedUeberlastMat = new THREE.MeshBasicMaterial({
    color: 0xff6b2b,
    transparent: true,
    opacity: 0.82,
  });
  private readonly sharedBastionMat = new THREE.MeshBasicMaterial({
    color: 0x2ee59d,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly revealedBadgeTex: THREE.CanvasTexture;
  private pulseClock = 0;

  private readonly tempWorldVec = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = 'shardline-remote-players';
    scene.add(this.root);
    this.revealedBadgeTex = this.createRevealedBadgeTexture();
  }

  private createRevealedBadgeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // High-contrast tactical pill
      ctx.fillStyle = 'rgba(12, 18, 27, 0.9)';
      ctx.fillRect(16, 12, 224, 46);
      ctx.strokeStyle = '#ff6b2b';
      ctx.lineWidth = 4;
      ctx.strokeRect(16, 12, 224, 46);

      ctx.font = '900 24px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd166';
      ctx.fillText('◈ MARKIERT', 128, 35);

      // Glowing target diamond below label
      ctx.beginPath();
      ctx.moveTo(128, 68);
      ctx.lineTo(154, 94);
      ctx.lineTo(128, 120);
      ctx.lineTo(102, 94);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 107, 43, 0.35)';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ff6b2b';
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  public clear(): void {
    for (const inst of this.instances.values()) {
      this.disposeInstance(inst);
    }
    this.instances.clear();

    for (const popup of this.popups) {
      this.root.remove(popup.sprite);
      popup.material.dispose();
      popup.texture.dispose();
    }
    this.popups.length = 0;
  }

  public triggerHitFlash(uid: string): void {
    const inst = this.instances.get(uid);
    if (inst) {
      inst.hitFlashTimer = 0.14;
    }
  }

  public triggerMuzzleFlash(uid: string): void {
    const inst = this.instances.get(uid);
    if (inst) {
      inst.muzzleFlashTimer = 0.055;
      inst.muzzleFlashMesh.visible = true;
      inst.muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
    }
  }

  public getMuzzleWorldPosition(uid: string): Vec3 | null {
    const inst = this.instances.get(uid);
    if (!inst || !inst.group.visible) return null;
    inst.group.updateWorldMatrix(true, true);
    inst.muzzleAnchor.getWorldPosition(this.tempWorldVec);
    return {
      x: this.tempWorldVec.x,
      y: this.tempWorldVec.y,
      z: this.tempWorldVec.z,
    };
  }

  public spawnDamageNumber(worldPos: Vec3, damage: number, isHeadshot: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = isHeadshot
      ? '900 54px "Segoe UI", system-ui, sans-serif'
      : '800 44px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = `${Math.round(damage)}`;
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(8, 12, 18, 0.92)';
    ctx.strokeText(text, 96, 48);

    ctx.fillStyle = isHeadshot ? '#ffb02e' : '#f4f8fc';
    ctx.fillText(text, 96, 48);

    if (isHeadshot) {
      ctx.fillStyle = '#ff6b2b';
      ctx.fillRect(52, 78, 88, 5);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    const jitterX = (Math.random() - 0.5) * 0.2;
    const jitterZ = (Math.random() - 0.5) * 0.2;
    sprite.position.set(worldPos.x + jitterX, worldPos.y + 0.22, worldPos.z + jitterZ);
    const baseScale = isHeadshot ? 0.95 : 0.76;
    sprite.scale.set(baseScale * 1.6, baseScale * 0.8, 1);
    sprite.renderOrder = 26;

    this.root.add(sprite);
    this.popups.push({
      sprite,
      material,
      texture,
      age: 0,
      lifetime: 0.82,
      velocityY: isHeadshot ? 1.35 : 1.05,
    });
  }

  public sync(
    players: ReadonlyArray<NetPlayerState>,
    localUid: string,
    localTeam: TeamId,
    frameDt: number
  ): void {
    this.pulseClock += Math.min(0.1, Math.max(0.0001, frameDt));
    const activeUids = new Set<string>();

    for (const p of players) {
      if (p.uid === localUid) continue;
      activeUids.add(p.uid);

      let inst = this.instances.get(p.uid);
      if (!inst) {
        inst = this.createInstance(p);
        this.instances.set(p.uid, inst);
        this.root.add(inst.group);
      }

      // Sync team / character colors if player switched in lobby before/during match
      if (inst.team !== p.team || inst.character !== p.character) {
        this.applyIdentityColors(inst, p.team, p.character);
      }

      // Sync held weapon proportions if switched
      if (inst.equippedWeapon !== p.weaponId) {
        this.applyWeaponProportions(inst, p.weaponId);
      }

      // Detect damage pulse from vitals drop
      const totalVitals = p.hp + p.armor;
      if (inst.wasAlive && p.alive && totalVitals < inst.lastVitals) {
        inst.hitFlashTimer = 0.14;
      }
      inst.lastVitals = totalVitals;

      if (!p.alive) {
        inst.group.visible = false;
        inst.wasAlive = false;
        continue;
      }

      const justRespawned = !inst.wasAlive;
      inst.wasAlive = true;
      inst.group.visible = true;

      // World position & horizontal aim yaw (yaw = 0 faces -Z)
      inst.group.position.set(p.pos.x, p.pos.y, p.pos.z);
      inst.group.rotation.y = p.yaw;

      // Smooth crouch compression aligned 1:1 with PlayerHitscan:
      // Stand head = y + 1.56, body = 0.05..1.38 | Crouch head = y + 1.04, body = 0.05..0.88
      const targetCrouch = p.stance === 'crouch' ? 1 : 0;
      if (justRespawned) {
        inst.crouchBlend = targetCrouch;
        inst.lastPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      } else {
        const blendStep = Math.min(1, frameDt * 15);
        inst.crouchBlend += (targetCrouch - inst.crouchBlend) * blendStep;
      }

      const c = inst.crouchBlend;
      const lerp = (a: number, b: number): number => a + (b - a) * c;

      // Subtle leg stride from horizontal movement
      const dx = p.pos.x - inst.lastPos.x;
      const dz = p.pos.z - inst.lastPos.z;
      inst.lastPos.x = p.pos.x;
      inst.lastPos.y = p.pos.y;
      inst.lastPos.z = p.pos.z;
      const moveSpeed = frameDt > 0.0005 ? Math.hypot(dx, dz) / frameDt : 0;
      if (moveSpeed > 0.25 && p.stance !== 'air') {
        inst.walkPhase += frameDt * Math.min(13, 4.5 + moveSpeed * 1.35);
      } else {
        inst.walkPhase *= Math.max(0, 1 - frameDt * 10);
      }
      const legSwing = moveSpeed > 0.25 ? Math.sin(inst.walkPhase) * 0.34 * (1 - c * 0.45) : 0;

      const legScaleY = lerp(1.0, 0.62);
      const legY = lerp(0.33, 0.205);
      inst.leftLeg.scale.y = legScaleY;
      inst.rightLeg.scale.y = legScaleY;
      inst.leftLeg.position.y = legY;
      inst.rightLeg.position.y = legY;
      inst.leftLeg.rotation.x = legSwing;
      inst.rightLeg.rotation.x = -legSwing;

      inst.pelvis.position.y = lerp(0.72, 0.42);

      inst.torsoCore.scale.y = lerp(1.0, 0.72);
      inst.torsoCore.position.y = lerp(1.07, 0.66);

      inst.chestPlate.scale.y = lerp(1.0, 0.74);
      inst.chestPlate.position.y = lerp(1.12, 0.69);

      const trimY = lerp(1.22, 0.76);
      inst.trimStripFront.position.y = trimY;
      inst.trimStripBack.position.y = trimY;

      const emblemY = lerp(1.11, 0.68);
      inst.emblemFront.position.y = emblemY;
      inst.emblemBack.position.y = emblemY;

      const shoulderY = lerp(1.24, 0.79);
      inst.shoulderL.position.y = shoulderY;
      inst.shoulderR.position.y = shoulderY;

      inst.neck.position.y = lerp(1.4, 0.9);
      // Exact head center height matching PlayerHitscan (1.56 stand / 1.04 crouch)
      inst.headGroup.position.y = lerp(1.56, 1.04);

      // Held weapon pivot pitches up/down with player.pitch (+ reload tilt)
      inst.weaponPivot.position.y = lerp(1.16, 0.72);
      const clampedPitch = Math.max(-1.35, Math.min(1.35, p.pitch));
      const reloadTilt = p.isReloading ? -0.45 : 0;
      inst.weaponPivot.rotation.x = clampedPitch + reloadTilt;
      inst.weaponPivot.rotation.z = p.isReloading ? 0.35 : 0;

      // Armor ring indicator
      if (p.armor > 0) {
        inst.shieldRing.visible = true;
        inst.shieldRing.position.y = lerp(1.08, 0.67);
        inst.shieldRing.rotation.z += frameDt * 1.4;
      } else {
        inst.shieldRing.visible = false;
      }

      // Hit flash decay
      if (inst.hitFlashTimer > 0) {
        inst.hitFlashTimer = Math.max(0, inst.hitFlashTimer - frameDt);
      }
      const flashing = inst.hitFlashTimer > 0;
      if (flashing !== inst.wasFlashing) {
        inst.wasFlashing = flashing;
        this.applyFlashState(inst, flashing);
      }

      // Muzzle flash decay
      if (inst.muzzleFlashTimer > 0) {
        inst.muzzleFlashTimer = Math.max(0, inst.muzzleFlashTimer - frameDt);
        inst.muzzleFlashMat.opacity = Math.min(1, inst.muzzleFlashTimer / 0.055);
        if (inst.muzzleFlashTimer <= 0) {
          inst.muzzleFlashMesh.visible = false;
        }
      }

      // Overhead Nameplate: always visible for ALLIES (`Name · 100 TP`), hidden for enemies (zero wallhack!)
      const isAlly = p.team === localTeam;
      inst.nameplateSprite.visible = isAlly;
      if (isAlly) {
        inst.nameplateSprite.position.y = lerp(2.04, 1.52);
        const hpRounded = Math.max(0, Math.round(p.hp));
        const armorRounded = Math.max(0, Math.round(p.armor));
        const labelKey = `${p.name}|${hpRounded}|${armorRounded}|${p.team}`;
        if (inst.renderedLabelKey !== labelKey) {
          inst.renderedLabelKey = labelKey;
          this.drawAllyNameplate(inst, p.name, hpRounded, armorRounded, p.team);
        }
      }

      // Phase 5 Tactical Scan Reveal Marker (`◈ MARKIERT` through walls ONLY during active reveal!)
      const ab = p.abilities;
      const isRevealedToLocal =
        !isAlly && (ab?.revealedSec ?? 0) > 0 && ab?.revealedToTeam === localTeam;
      inst.revealedSprite.visible = isRevealedToLocal;
      if (isRevealedToLocal) {
        inst.revealedSprite.position.y = lerp(2.08, 1.56);
        const pulseScale = 1 + 0.08 * Math.sin(this.pulseClock * 9.5);
        inst.revealedSprite.scale.set(1.12 * pulseScale, 0.56 * pulseScale, 1);
        inst.revealedMat.opacity = 0.84 + 0.16 * Math.sin(this.pulseClock * 11);
      }

      // Phase 5 Active Buff / Protective Shimmer (`Überlast` orange aura, `Bollwerk` cyan shield rim)
      const hasUeberlast = ab?.activeBuff === 'ueberlast' && (ab.buffRemainingSec ?? 0) > 0;
      inst.ueberlastAura.visible = hasUeberlast;
      if (hasUeberlast) {
        inst.ueberlastAura.position.y = lerp(1.14, 0.72);
        inst.ueberlastAura.rotation.z -= frameDt * 3.2;
      }

      const hasBastion = ab?.bastionProtected === true;
      inst.bastionRim.visible = hasBastion;
      if (hasBastion) {
        inst.bastionRim.rotation.z += frameDt * 1.8;
      }
    }

    // Dispose instances for players who left the room
    for (const [uid, inst] of this.instances.entries()) {
      if (!activeUids.has(uid)) {
        this.disposeInstance(inst);
        this.instances.delete(uid);
      }
    }

    // Update floating damage numbers
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const popup = this.popups[i];
      popup.age += frameDt;
      if (popup.age >= popup.lifetime) {
        this.root.remove(popup.sprite);
        popup.material.dispose();
        popup.texture.dispose();
        this.popups.splice(i, 1);
        continue;
      }
      popup.sprite.position.y += popup.velocityY * frameDt;
      popup.velocityY *= Math.max(0, 1 - 2.4 * frameDt);
      const lifeFrac = popup.age / popup.lifetime;
      popup.material.opacity = lifeFrac < 0.55 ? 1 : 1 - (lifeFrac - 0.55) / 0.45;
    }
  }

  private createInstance(p: NetPlayerState): RemotePlayerVisual {
    const group = new THREE.Group();
    group.name = `remote-player-${p.uid}`;

    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x222c38,
      roughness: 0.55,
      metalness: 0.4,
    });
    const teamTrimMat = new THREE.MeshStandardMaterial({
      color: 0xff6b2b,
      roughness: 0.36,
      metalness: 0.35,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xdce6f0,
      emissive: 0x1c2632,
      emissiveIntensity: 0.18,
      roughness: 0.32,
      metalness: 0.28,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xff6b2b,
      emissive: 0xff5912,
      emissiveIntensity: 0.95,
      roughness: 0.2,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const emblemMat = new THREE.MeshStandardMaterial({
      color: 0xff6b2b,
      emissive: 0xff6b2b,
      emissiveIntensity: 0.55,
      roughness: 0.28,
      metalness: 0.25,
    });
    const muzzleFlashMat = new THREE.MeshBasicMaterial({
      color: 0xffb84d,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    // Legs & Pelvis
    const leftLeg = new THREE.Mesh(this.legGeo, this.sharedLimbMat);
    leftLeg.position.set(-0.13, 0.33, 0);
    const rightLeg = new THREE.Mesh(this.legGeo, this.sharedLimbMat);
    rightLeg.position.set(0.13, 0.33, 0);

    const pelvis = new THREE.Mesh(this.pelvisGeo, suitMat);
    pelvis.position.set(0, 0.72, 0);

    // Torso & Chest Plate
    const torsoCore = new THREE.Mesh(this.torsoGeo, suitMat);
    torsoCore.position.set(0, 1.07, 0);

    const chestPlate = new THREE.Mesh(this.chestPlateGeo, suitMat);
    chestPlate.position.set(0, 1.12, 0);

    // Team armor trim strips (front -Z & back +Z)
    const trimStripFront = new THREE.Mesh(this.trimStripGeo, teamTrimMat);
    trimStripFront.position.set(0, 1.22, -0.168);
    const trimStripBack = new THREE.Mesh(this.trimStripGeo, teamTrimMat);
    trimStripBack.position.set(0, 1.22, 0.168);

    // Specialist role shard emblem on chest & back
    const emblemFront = new THREE.Mesh(this.emblemGeo, emblemMat);
    emblemFront.position.set(0, 1.11, -0.175);
    emblemFront.scale.set(1, 1.25, 0.45);
    const emblemBack = new THREE.Mesh(this.emblemGeo, emblemMat);
    emblemBack.position.set(0, 1.11, 0.175);
    emblemBack.scale.set(1, 1.25, 0.45);

    // Team-colored shoulder pauldrons
    const shoulderL = new THREE.Mesh(this.shoulderGeo, teamTrimMat);
    shoulderL.position.set(-0.29, 1.24, 0);
    const shoulderR = new THREE.Mesh(this.shoulderGeo, teamTrimMat);
    shoulderR.position.set(0.29, 1.24, 0);

    // Left support arm (tucked forward toward handguard)
    const leftArm = new THREE.Mesh(this.armGeo, this.sharedLimbMat);
    leftArm.position.set(-0.22, -0.18, -0.12);
    leftArm.rotation.x = 0.72;
    leftArm.rotation.z = -0.32;
    shoulderL.add(leftArm);

    // Neck & Head Group (headGroup centered at exact hitscan sphere center!)
    const neck = new THREE.Mesh(this.neckGeo, this.sharedLimbMat);
    neck.position.set(0, 1.4, 0);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.56, 0);

    const headMesh = new THREE.Mesh(this.headGeo, headMat);
    // Visor rotated by Math.PI so it faces -Z (the exact forward aim direction!)
    const visorMesh = new THREE.Mesh(this.visorGeo, visorMat);
    visorMesh.position.set(0, 0.006, 0);
    visorMesh.rotation.y = Math.PI;

    // Back helmet team crest so silhouette also reads unmistakably from behind
    const backCrest = new THREE.Mesh(this.backCrestGeo, visorMat);
    backCrest.position.set(0, 0.02, 0.19);

    headGroup.add(headMesh, visorMesh, backCrest);

    // Subtle armor shield ring
    const shieldRing = new THREE.Mesh(this.shieldRingGeo, this.sharedShieldMat);
    shieldRing.position.set(0, 1.08, 0);
    shieldRing.rotation.x = Math.PI * 0.5;
    shieldRing.visible = false;

    // Right arm + 3D Held Weapon Pivot (pitches with player.pitch, aims along -Z)
    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(0.22, 1.16, -0.06);

    const rightArm = new THREE.Mesh(this.armGeo, this.sharedLimbMat);
    rightArm.position.set(0.05, -0.12, -0.14);
    rightArm.rotation.x = Math.PI * 0.46;
    weaponPivot.add(rightArm);

    const weaponReceiver = new THREE.Mesh(this.weaponReceiverGeo, this.sharedDarkGunMat);
    weaponReceiver.position.set(0, 0, -0.28);

    const weaponStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.024, 0.28),
      teamTrimMat
    );
    weaponStripe.position.set(0, 0.035, -0.28);

    const weaponBarrel = new THREE.Mesh(this.weaponBarrelGeo, this.sharedDarkGunMat);
    weaponBarrel.rotation.x = Math.PI * 0.5;
    weaponBarrel.position.set(0, 0.02, -0.62);

    const weaponMag = new THREE.Mesh(this.weaponMagGeo, this.sharedDarkGunMat);
    weaponMag.position.set(0, -0.11, -0.27);
    weaponMag.rotation.x = 0.22;

    const weaponScope = new THREE.Mesh(this.weaponScopeGeo, this.sharedDarkGunMat);
    weaponScope.rotation.x = Math.PI * 0.5;
    weaponScope.position.set(0, 0.085, -0.28);
    weaponScope.visible = false;

    const muzzleAnchor = new THREE.Object3D();
    muzzleAnchor.position.set(0, 0.02, -0.86);

    const muzzleFlashMesh = new THREE.Mesh(this.muzzleFlashGeo, muzzleFlashMat);
    muzzleFlashMesh.position.copy(muzzleAnchor.position);
    muzzleFlashMesh.visible = false;

    weaponPivot.add(
      weaponReceiver,
      weaponStripe,
      weaponBarrel,
      weaponMag,
      weaponScope,
      muzzleAnchor,
      muzzleFlashMesh
    );

    // Overhead Ally Nameplate Sprite (`Name · 100 TP`)
    const nameplateCanvas = document.createElement('canvas');
    nameplateCanvas.width = 384;
    nameplateCanvas.height = 80;
    const nameplateTex = new THREE.CanvasTexture(nameplateCanvas);
    nameplateTex.colorSpace = THREE.SRGBColorSpace;
    const nameplateMat = new THREE.SpriteMaterial({
      map: nameplateTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const nameplateSprite = new THREE.Sprite(nameplateMat);
    nameplateSprite.position.set(0, 2.04, 0);
    nameplateSprite.scale.set(1.55, 0.32, 1);
    nameplateSprite.renderOrder = 20;
    nameplateSprite.visible = false;

    const revealedMat = new THREE.SpriteMaterial({
      map: this.revealedBadgeTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const revealedSprite = new THREE.Sprite(revealedMat);
    revealedSprite.position.set(0, 2.08, 0);
    revealedSprite.scale.set(1.12, 0.56, 1);
    revealedSprite.renderOrder = 999;
    revealedSprite.visible = false;

    const ueberlastAura = new THREE.Mesh(this.auraRingGeo, this.sharedUeberlastMat);
    ueberlastAura.rotation.x = Math.PI * 0.5;
    ueberlastAura.position.set(0, 1.14, 0);
    ueberlastAura.visible = false;

    const bastionRim = new THREE.Mesh(this.bastionFootGeo, this.sharedBastionMat);
    bastionRim.rotation.x = -Math.PI * 0.5;
    bastionRim.position.set(0, 0.04, 0);
    bastionRim.visible = false;

    group.add(
      leftLeg,
      rightLeg,
      pelvis,
      torsoCore,
      chestPlate,
      trimStripFront,
      trimStripBack,
      emblemFront,
      emblemBack,
      shoulderL,
      shoulderR,
      neck,
      headGroup,
      shieldRing,
      weaponPivot,
      nameplateSprite,
      revealedSprite,
      ueberlastAura,
      bastionRim
    );

    const inst: RemotePlayerVisual = {
      uid: p.uid,
      group,
      leftLeg,
      rightLeg,
      pelvis,
      torsoCore,
      chestPlate,
      trimStripFront,
      trimStripBack,
      emblemFront,
      emblemBack,
      shoulderL,
      shoulderR,
      neck,
      headGroup,
      shieldRing,
      weaponPivot,
      weaponBarrel,
      weaponScope,
      weaponMag,
      muzzleAnchor,
      muzzleFlashMesh,
      suitMat,
      teamTrimMat,
      headMat,
      visorMat,
      emblemMat,
      muzzleFlashMat,
      nameplateSprite,
      nameplateMat,
      nameplateTex,
      nameplateCanvas,
      renderedLabelKey: '',
      revealedSprite,
      revealedMat,
      ueberlastAura,
      bastionRim,
      team: p.team,
      character: p.character,
      equippedWeapon: p.weaponId,
      crouchBlend: p.stance === 'crouch' ? 1 : 0,
      walkPhase: 0,
      hitFlashTimer: 0,
      muzzleFlashTimer: 0,
      wasFlashing: false,
      lastVitals: p.hp + p.armor,
      wasAlive: p.alive,
      lastPos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
    };

    this.applyIdentityColors(inst, p.team, p.character);
    this.applyWeaponProportions(inst, p.weaponId);
    return inst;
  }

  private applyIdentityColors(
    inst: RemotePlayerVisual,
    team: TeamId,
    character: CharacterId
  ): void {
    inst.team = team;
    inst.character = character;

    const teamColor = TEAM_DEFS[team]?.color ?? (team === 'A' ? 0xff6b2b : 0x18d4c9);
    const charAccent = CHARACTERS[character]?.accentColor ?? teamColor;

    // Distinct warm-slate vs cool-slate base armor + vibrant team trim & glowing visor
    inst.suitMat.color.setHex(team === 'A' ? 0x2b2226 : 0x1b2936);
    inst.teamTrimMat.color.setHex(teamColor);
    inst.teamTrimMat.emissive.setHex(teamColor);
    inst.teamTrimMat.emissiveIntensity = 0.24;

    inst.visorMat.color.setHex(teamColor);
    inst.visorMat.emissive.setHex(teamColor);
    inst.visorMat.emissiveIntensity = 1.05;

    inst.emblemMat.color.setHex(charAccent);
    inst.emblemMat.emissive.setHex(charAccent);
    inst.emblemMat.emissiveIntensity = 0.65;
  }

  private applyWeaponProportions(inst: RemotePlayerVisual, weaponId: WeaponId): void {
    inst.equippedWeapon = weaponId;

    let barrelScaleY = 1.0;
    let barrelZ = -0.62;
    let muzzleZ = -0.86;
    let showScope = false;
    let showMag = true;

    switch (weaponId) {
      case 'funke':
        barrelScaleY = 0.42;
        barrelZ = -0.44;
        muzzleZ = -0.56;
        showMag = false;
        break;
      case 'bolzer':
        barrelScaleY = 0.58;
        barrelZ = -0.49;
        muzzleZ = -0.64;
        showMag = false;
        break;
      case 'hornisse':
        barrelScaleY = 0.68;
        barrelZ = -0.52;
        muzzleZ = -0.68;
        break;
      case 'brecher':
        barrelScaleY = 0.92;
        barrelZ = -0.58;
        muzzleZ = -0.8;
        showMag = false;
        break;
      case 'falke':
        barrelScaleY = 1.48;
        barrelZ = -0.74;
        muzzleZ = -1.08;
        showScope = true;
        break;
      case 'lanze':
      default:
        barrelScaleY = 1.05;
        barrelZ = -0.62;
        muzzleZ = -0.88;
        break;
    }

    inst.weaponBarrel.scale.set(1, barrelScaleY, 1);
    inst.weaponBarrel.position.z = barrelZ;
    inst.weaponScope.visible = showScope;
    inst.weaponMag.visible = showMag;
    inst.muzzleAnchor.position.z = muzzleZ;
    inst.muzzleFlashMesh.position.z = muzzleZ;
  }

  private applyFlashState(inst: RemotePlayerVisual, flashing: boolean): void {
    if (flashing) {
      inst.suitMat.emissive.setHex(0xffffff);
      inst.suitMat.emissiveIntensity = 0.78;
      inst.teamTrimMat.emissive.setHex(0xffffff);
      inst.teamTrimMat.emissiveIntensity = 0.85;
      inst.headMat.emissive.setHex(0xffffff);
      inst.headMat.emissiveIntensity = 0.9;
    } else {
      const teamColor = TEAM_DEFS[inst.team]?.color ?? 0xff6b2b;
      inst.suitMat.emissive.setHex(0x000000);
      inst.suitMat.emissiveIntensity = 0;
      inst.teamTrimMat.emissive.setHex(teamColor);
      inst.teamTrimMat.emissiveIntensity = 0.24;
      inst.headMat.emissive.setHex(0x1c2632);
      inst.headMat.emissiveIntensity = 0.18;
    }
  }

  private drawAllyNameplate(
    inst: RemotePlayerVisual,
    name: string,
    hp: number,
    armor: number,
    team: TeamId
  ): void {
    const canvas = inst.nameplateCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const accentHex = TEAM_DEFS[team]?.hex ?? (team === 'A' ? '#ff6b2b' : '#18d4c9');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark chamfered tactical pill background
    ctx.fillStyle = 'rgba(10, 15, 22, 0.86)';
    ctx.beginPath();
    ctx.moveTo(14, 10);
    ctx.lineTo(canvas.width - 22, 10);
    ctx.lineTo(canvas.width - 10, 22);
    ctx.lineTo(canvas.width - 10, canvas.height - 12);
    ctx.lineTo(14, canvas.height - 12);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Left accent bar
    ctx.fillStyle = accentHex;
    ctx.fillRect(14, 10, 6, canvas.height - 22);

    const safeName = name.length > 14 ? `${name.slice(0, 14)}…` : name;
    const vitalsStr = armor > 0 ? `${hp}+${armor} TP` : `${hp} TP`;
    const label = `${safeName} · ${vitalsStr}`;

    ctx.font = '800 24px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f7fc';
    ctx.fillText(label, canvas.width * 0.5 + 2, 36);

    // Mini HP bar along bottom of ally tag
    const barX = 28;
    const barW = canvas.width - 50;
    const barY = canvas.height - 21;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(barX, barY, barW, 5);
    const hpFrac = Math.max(0, Math.min(1, hp / 100));
    ctx.fillStyle = accentHex;
    ctx.fillRect(barX, barY, barW * hpFrac, 5);

    inst.nameplateTex.needsUpdate = true;
  }

  private disposeInstance(inst: RemotePlayerVisual): void {
    this.root.remove(inst.group);
    inst.suitMat.dispose();
    inst.teamTrimMat.dispose();
    inst.headMat.dispose();
    inst.visorMat.dispose();
    inst.emblemMat.dispose();
    inst.muzzleFlashMat.dispose();
    inst.nameplateMat.dispose();
    inst.nameplateTex.dispose();
    inst.revealedMat.dispose();
  }

  public dispose(): void {
    this.clear();
    this.legGeo.dispose();
    this.pelvisGeo.dispose();
    this.torsoGeo.dispose();
    this.chestPlateGeo.dispose();
    this.trimStripGeo.dispose();
    this.emblemGeo.dispose();
    this.shoulderGeo.dispose();
    this.armGeo.dispose();
    this.neckGeo.dispose();
    this.headGeo.dispose();
    this.visorGeo.dispose();
    this.backCrestGeo.dispose();
    this.shieldRingGeo.dispose();
    this.auraRingGeo.dispose();
    this.bastionFootGeo.dispose();
    this.weaponReceiverGeo.dispose();
    this.weaponBarrelGeo.dispose();
    this.weaponMagGeo.dispose();
    this.weaponScopeGeo.dispose();
    this.muzzleFlashGeo.dispose();
    this.sharedDarkGunMat.dispose();
    this.sharedLimbMat.dispose();
    this.sharedShieldMat.dispose();
    this.sharedUeberlastMat.dispose();
    this.sharedBastionMat.dispose();
    this.revealedBadgeTex.dispose();
  }
}
