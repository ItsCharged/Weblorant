import * as THREE from 'three';
import type { Vec3 } from '../core/types';

export interface DummyRenderView {
  readonly id: string;
  readonly pos: Vec3;
  readonly yaw: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly armor: number;
  readonly maxArmor: number;
  readonly alive: boolean;
  readonly hitFlashTimer: number;
}

interface DummyVisualInstance {
  group: THREE.Group;
  torsoMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshStandardMaterial;
  shieldRing: THREE.Mesh;
  barGroup: THREE.Group;
  hpFill: THREE.Mesh;
  armorFill: THREE.Mesh;
  wasFlashing: boolean;
}

interface FloatingDamagePopup {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  age: number;
  lifetime: number;
  velocityY: number;
}

export class DummyRenderer {
  private readonly root: THREE.Group;
  private readonly instances = new Map<string, DummyVisualInstance>();
  private readonly popups: FloatingDamagePopup[] = [];

  // Shared geometries for low draw overhead and crisp silhouette
  private readonly legGeo = new THREE.BoxGeometry(0.18, 0.66, 0.22);
  private readonly pelvisGeo = new THREE.BoxGeometry(0.46, 0.18, 0.28);
  private readonly torsoGeo = new THREE.CylinderGeometry(0.28, 0.24, 0.62, 10);
  private readonly chestPlateGeo = new THREE.BoxGeometry(0.44, 0.42, 0.32);
  private readonly shoulderGeo = new THREE.BoxGeometry(0.18, 0.22, 0.26);
  private readonly armGeo = new THREE.BoxGeometry(0.14, 0.52, 0.16);
  private readonly neckGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.14, 8);
  private readonly headGeo = new THREE.SphereGeometry(0.205, 16, 12);
  private readonly visorGeo = new THREE.CylinderGeometry(
    0.212,
    0.212,
    0.075,
    14,
    1,
    true,
    -Math.PI * 0.42,
    Math.PI * 0.84
  );
  private readonly shieldRingGeo = new THREE.TorusGeometry(0.44, 0.022, 8, 28);
  private readonly barBgGeo = new THREE.PlaneGeometry(0.76, 0.09);
  private readonly barFillGeo = new THREE.PlaneGeometry(0.72, 0.045);

  private readonly sharedDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1a232e,
    roughness: 0.62,
    metalness: 0.35,
  });
  private readonly sharedShieldMat = new THREE.MeshBasicMaterial({
    color: 0x18d4c9,
    transparent: true,
    opacity: 0.82,
  });
  private readonly barBgMat = new THREE.MeshBasicMaterial({
    color: 0x0b1016,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  private readonly hpFillMat = new THREE.MeshBasicMaterial({
    color: 0xff6b2b,
    side: THREE.DoubleSide,
  });
  private readonly armorFillMat = new THREE.MeshBasicMaterial({
    color: 0x18d4c9,
    side: THREE.DoubleSide,
  });

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = 'shardline-dummies';
    scene.add(this.root);
  }

  public clearDummies(): void {
    for (const inst of this.instances.values()) {
      this.root.remove(inst.group);
      inst.torsoMat.dispose();
      inst.headMat.dispose();
      inst.visorMat.dispose();
    }
    this.instances.clear();

    for (const popup of this.popups) {
      this.root.remove(popup.sprite);
      popup.material.dispose();
      popup.texture.dispose();
    }
    this.popups.length = 0;
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
    const jitterX = (Math.random() - 0.5) * 0.22;
    const jitterZ = (Math.random() - 0.5) * 0.22;
    sprite.position.set(worldPos.x + jitterX, worldPos.y + 0.24, worldPos.z + jitterZ);
    const baseScale = isHeadshot ? 0.95 : 0.76;
    sprite.scale.set(baseScale * 1.6, baseScale * 0.8, 1);
    sprite.renderOrder = 25;

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
    dummies: ReadonlyArray<DummyRenderView>,
    camera: THREE.Camera,
    frameDt: number
  ): void {
    const activeIds = new Set<string>();

    for (const d of dummies) {
      activeIds.add(d.id);
      let inst = this.instances.get(d.id);
      if (!inst) {
        inst = this.createDummyInstance();
        this.instances.set(d.id, inst);
        this.root.add(inst.group);
      }

      inst.group.visible = d.alive;
      if (!d.alive) continue;

      inst.group.position.set(d.pos.x, d.pos.y, d.pos.z);
      // Dummy yaw=0 faces +Z or -Z; align visor toward player spawn (+Z when yaw=0 or via rotation.y = d.yaw)
      inst.group.rotation.y = d.yaw;

      // Hit flash highlight
      const flashing = d.hitFlashTimer > 0;
      if (flashing !== inst.wasFlashing) {
        inst.wasFlashing = flashing;
        if (flashing) {
          inst.torsoMat.emissive.setHex(0xffffff);
          inst.torsoMat.emissiveIntensity = 0.72;
          inst.headMat.emissive.setHex(0xffffff);
          inst.headMat.emissiveIntensity = 0.85;
        } else {
          inst.torsoMat.emissive.setHex(0x000000);
          inst.torsoMat.emissiveIntensity = 0;
          inst.headMat.emissive.setHex(0x202a36);
          inst.headMat.emissiveIntensity = 0.18;
        }
      }

      // Shield ring visibility & subtle spin
      if (d.armor > 0) {
        inst.shieldRing.visible = true;
        inst.shieldRing.rotation.z += frameDt * 1.4;
      } else {
        inst.shieldRing.visible = false;
      }

      // Overhead mini HP + Armor bar when damaged or shielded
      const showBar = d.hp < d.maxHp || d.armor > 0;
      inst.barGroup.visible = showBar;
      if (showBar) {
        inst.barGroup.quaternion.copy(camera.quaternion);
        const hpFrac = Math.max(0.001, Math.min(1, d.hp / Math.max(1, d.maxHp)));
        inst.hpFill.scale.x = hpFrac;
        inst.hpFill.position.x = -(1 - hpFrac) * 0.36;

        if (d.armor > 0 && d.maxArmor > 0) {
          inst.armorFill.visible = true;
          const armorFrac = Math.max(0.001, Math.min(1, d.armor / d.maxArmor));
          inst.armorFill.scale.x = armorFrac;
          inst.armorFill.position.x = -(1 - armorFrac) * 0.36;
        } else {
          inst.armorFill.visible = false;
        }
      }
    }

    // Prune stale dummy meshes if map switched
    for (const [id, inst] of this.instances.entries()) {
      if (!activeIds.has(id)) {
        this.root.remove(inst.group);
        inst.torsoMat.dispose();
        inst.headMat.dispose();
        inst.visorMat.dispose();
        this.instances.delete(id);
      }
    }

    // Animate floating damage numbers
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += frameDt;
      if (p.age >= p.lifetime) {
        this.root.remove(p.sprite);
        p.material.dispose();
        p.texture.dispose();
        this.popups.splice(i, 1);
        continue;
      }
      p.sprite.position.y += p.velocityY * frameDt;
      p.velocityY *= Math.max(0, 1 - 2.4 * frameDt);
      const lifeFrac = p.age / p.lifetime;
      p.material.opacity = lifeFrac < 0.55 ? 1 : 1 - (lifeFrac - 0.55) / 0.45;
    }
  }

  private createDummyInstance(): DummyVisualInstance {
    const group = new THREE.Group();

    const torsoMat = new THREE.MeshStandardMaterial({
      color: 0x263342,
      roughness: 0.52,
      metalness: 0.45,
    });

    // Bright light-titanium helmet so head silhouette pops against dark torso at 50m+
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xdbe5ef,
      emissive: 0x202a36,
      emissiveIntensity: 0.18,
      roughness: 0.32,
      metalness: 0.3,
    });

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xff6b2b,
      emissive: 0xff5912,
      emissiveIntensity: 0.95,
      roughness: 0.2,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    // Legs (y = 0.0 .. 0.66)
    const leftLeg = new THREE.Mesh(this.legGeo, this.sharedDarkMat);
    leftLeg.position.set(-0.13, 0.33, 0);
    const rightLeg = new THREE.Mesh(this.legGeo, this.sharedDarkMat);
    rightLeg.position.set(0.13, 0.33, 0);

    // Pelvis (y = 0.64 .. 0.82)
    const pelvis = new THREE.Mesh(this.pelvisGeo, torsoMat);
    pelvis.position.set(0, 0.72, 0);

    // Core cylinder + armored chest plate (y = 0.78 .. 1.38 — matches body hitbox top 1.38!)
    const torsoCore = new THREE.Mesh(this.torsoGeo, torsoMat);
    torsoCore.position.set(0, 1.07, 0);

    const chestPlate = new THREE.Mesh(this.chestPlateGeo, torsoMat);
    chestPlate.position.set(0, 1.12, 0);

    // Shoulder pauldrons & arms
    const shoulderL = new THREE.Mesh(this.shoulderGeo, torsoMat);
    shoulderL.position.set(-0.29, 1.24, 0);
    const shoulderR = new THREE.Mesh(this.shoulderGeo, torsoMat);
    shoulderR.position.set(0.29, 1.24, 0);

    const armL = new THREE.Mesh(this.armGeo, this.sharedDarkMat);
    armL.position.set(-0.29, 0.94, 0);
    const armR = new THREE.Mesh(this.armGeo, this.sharedDarkMat);
    armR.position.set(0.29, 0.94, 0);

    // Neck collar
    const neck = new THREE.Mesh(this.neckGeo, this.sharedDarkMat);
    neck.position.set(0, 1.4, 0);

    // Head sphere centered at exact Hitscan head height y = 1.56 (radius 0.205)
    const head = new THREE.Mesh(this.headGeo, headMat);
    head.position.set(0, 1.56, 0);

    // 360-readable wrap-around attacker-orange visor band on helmet
    const visorFront = new THREE.Mesh(this.visorGeo, visorMat);
    visorFront.position.set(0, 1.565, 0);
    // Add back trim band too so dummy head reads crisply from every angle
    const visorBack = new THREE.Mesh(this.visorGeo, visorMat);
    visorBack.position.set(0, 1.565, 0);
    visorBack.rotation.y = Math.PI;

    // Optional cyan shield ring around upper torso when Bot-Schild +50 is active
    const shieldRing = new THREE.Mesh(this.shieldRingGeo, this.sharedShieldMat);
    shieldRing.position.set(0, 1.08, 0);
    shieldRing.rotation.x = Math.PI * 0.5;
    shieldRing.visible = false;

    // Overhead mini HP + Armor bar
    const barGroup = new THREE.Group();
    barGroup.position.set(0, 1.96, 0);
    const barBg = new THREE.Mesh(this.barBgGeo, this.barBgMat);
    const hpFill = new THREE.Mesh(this.barFillGeo, this.hpFillMat);
    hpFill.position.set(0, -0.014, 0.004);
    const armorFill = new THREE.Mesh(this.barFillGeo, this.armorFillMat);
    armorFill.position.set(0, 0.022, 0.004);
    barGroup.add(barBg, hpFill, armorFill);
    barGroup.visible = false;

    group.add(
      leftLeg,
      rightLeg,
      pelvis,
      torsoCore,
      chestPlate,
      shoulderL,
      shoulderR,
      armL,
      armR,
      neck,
      head,
      visorFront,
      visorBack,
      shieldRing,
      barGroup
    );

    return {
      group,
      torsoMat,
      headMat,
      visorMat,
      shieldRing,
      barGroup,
      hpFill,
      armorFill,
      wasFlashing: false,
    };
  }

  public dispose(): void {
    this.clearDummies();
    this.legGeo.dispose();
    this.pelvisGeo.dispose();
    this.torsoGeo.dispose();
    this.chestPlateGeo.dispose();
    this.shoulderGeo.dispose();
    this.armGeo.dispose();
    this.neckGeo.dispose();
    this.headGeo.dispose();
    this.visorGeo.dispose();
    this.shieldRingGeo.dispose();
    this.barBgGeo.dispose();
    this.barFillGeo.dispose();
    this.sharedDarkMat.dispose();
    this.sharedShieldMat.dispose();
    this.barBgMat.dispose();
    this.hpFillMat.dispose();
    this.armorFillMat.dispose();
  }
}
