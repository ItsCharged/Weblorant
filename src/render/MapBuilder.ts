import * as THREE from 'three';
import {
  makeArcticSurface,
  makeBrickSurface,
  makeConcreteSurface,
  makeContainerSurface,
  makeFloorSurface,
  makeHazardSurface,
  makeIceGlassSurface,
  makeMetalSurface,
  makeStoneSurface,
  makeTerracottaSurface,
  makeTimberSurface,
  makeWaterSurface,
  makeWoodSurface,
  type SurfaceTexture,
} from './ProceduralTextures';

type SurfaceKey =
  | 'floor'
  | 'concrete'
  | 'container'
  | 'hazard'
  | 'wood'
  | 'metal'
  | 'brick'
  | 'stone'
  | 'timber'
  | 'terracotta'
  | 'arctic'
  | 'ice'
  | 'water';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  BlockMaterial,
  DistanceLineDef,
  MapBlock,
  MapDefinition,
  MapZone,
  RangeButtonId,
  RangeControlButton,
} from '../data/maps/types';
import type { GraphicsQuality } from '../core/types';
import { type AnimatedProp, buildMapDetail } from '../data/maps/detail';
import type { SceneThemeUserData } from './Renderer';

interface AnimatedVisual {
  prop: AnimatedProp;
  group: THREE.Group;
}

export interface RangeUiSnapshot {
  challengeActive: boolean;
  challengeHits: number;
  challengeRemaining: number;
  challengeElapsedSec: number;
  lastChallengeHits?: number;
  lastChallengeTimeSec?: number;
  strafeEnabled: boolean;
  armorEnabled: boolean;
  infiniteAmmo: boolean;
}

interface ButtonVisual {
  def: RangeControlButton;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  frameMat: THREE.MeshStandardMaterial;
  lastActive: boolean | null;
  flashTimer: number;
}

export class MapBuilder {
  private readonly scene: THREE.Scene;
  private mapRoot: THREE.Group | null = null;

  // Shared procedural pattern textures (created once, reused across maps)
  // Hochauflösende Oberflächen (Albedo + Normal-Map, Welt-UV-Kachelung)
  private readonly surfaces: Record<SurfaceKey, SurfaceTexture>;
  private readonly texSprayBoard: THREE.CanvasTexture;
  private readonly texHoloScreen: THREE.CanvasTexture;

  // Cached materials per (BlockMaterial + hex color)
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();

  // Per-map disposable resources
  private readonly mapGeometries: THREE.BufferGeometry[] = [];
  private readonly mapMaterials: THREE.Material[] = [];
  private readonly mapTextures: THREE.Texture[] = [];

  // Dynamic Range 3D panels
  private readonly buttonVisuals = new Map<RangeButtonId, ButtonVisual>();
  private scoreboardCanvas: HTMLCanvasElement | null = null;
  private scoreboardCtx: CanvasRenderingContext2D | null = null;
  private scoreboardTex: THREE.CanvasTexture | null = null;
  private lastScoreboardKey = '';
  private staticBatchCount = 0;

  // Grafikqualität & rein visuelle Deko (Dächer, Fenster, Skyline, bewegte Elemente)
  private quality: GraphicsQuality = 'high';
  private detailRoot: THREE.Group | null = null;
  private readonly animatedVisuals: AnimatedVisual[] = [];
  private animTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.surfaces = {
      floor: makeFloorSurface(),
      concrete: makeConcreteSurface(),
      container: makeContainerSurface(),
      hazard: makeHazardSurface(),
      wood: makeWoodSurface(),
      metal: makeMetalSurface(),
      brick: makeBrickSurface(),
      stone: makeStoneSurface(),
      timber: makeTimberSurface(),
      terracotta: makeTerracottaSurface(),
      arctic: makeArcticSurface(),
      ice: makeIceGlassSurface(),
      water: makeWaterSurface(),
    };
    this.texSprayBoard = this.makeSprayBoardTexture();
    this.texHoloScreen = this.makeHoloScreenTexture();
  }

  public buildMap(mapDef: MapDefinition): void {
    this.clearCurrentMap();
    (this.scene.userData as SceneThemeUserData).applyMapTheme?.(mapDef.theme ?? 'dockyard');

    const root = new THREE.Group();
    root.name = `map-${mapDef.id}`;
    this.mapRoot = root;

    // 1. Solid architectural blocks — statically batched per (material, color) group
    //    so ~100 individual block meshes collapse into ~8–20 draw calls.
    this.staticBatchCount = 0;
    this.addBatchedBlockMeshes(root, mapDef.blocks);

    // 1b. Rein visuelle Details (keine Physik): in eigener Gruppe, bei NIEDRIG ausgeblendet
    const detail = buildMapDetail(mapDef);
    const detailRoot = new THREE.Group();
    detailRoot.name = 'map-detail';
    this.addBatchedBlockMeshes(detailRoot, detail.blocks);
    for (const prop of detail.animated) {
      const group = new THREE.Group();
      group.name = prop.id;
      group.position.set(prop.pivot.x, prop.pivot.y, prop.pivot.z);
      for (const block of prop.blocks) {
        this.addBlockMesh(group, block);
      }
      detailRoot.add(group);
      this.animatedVisuals.push({ prop, group });
    }
    detailRoot.visible = this.quality !== 'low';
    this.detailRoot = detailRoot;
    root.add(detailRoot);

    // 2. Tactical floor zones & floating site signboards
    for (const zone of mapDef.zones) {
      this.addZoneVisuals(root, zone);
    }

    // 3. Range distance markers (10M, 20M, 30M, 50M)
    if (mapDef.distanceLines) {
      for (const line of mapDef.distanceLines) {
        this.addDistanceLine(root, line);
      }
    }

    // 4. Shootable 3D Range control buttons
    if (mapDef.rangeButtons) {
      for (const btn of mapDef.rangeButtons) {
        this.addRangeButton(root, btn);
      }
    }

    // 5. Overhead 3D Live Scoreboard
    if (mapDef.scoreboardPos) {
      this.addScoreboard(root, mapDef.scoreboardPos);
    }

    this.scene.add(root);
  }

  /**
   * Passt Materialien und Deko an die Grafikqualität an (zur Laufzeit umschaltbar).
   * - `low`  : keine Normal-Maps, keine Deko, keine anisotrope Filterung
   * - `high` : Normal-Maps + Deko
   * - `max`  : zusätzlich glattere Metalle/Wasser/Eis für Himmelsreflexionen, 16× Anisotropie
   */
  public setQuality(quality: GraphicsQuality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    if (this.detailRoot) this.detailRoot.visible = quality !== 'low';
    const aniso = quality === 'low' ? 1 : quality === 'max' ? 16 : 8;
    for (const s of Object.values(this.surfaces)) {
      for (const tex of [s.map, s.normalMap]) {
        if (tex.anisotropy !== aniso) {
          tex.anisotropy = aniso;
          tex.needsUpdate = true;
        }
      }
    }
    for (const mat of this.materialCache.values()) {
      this.applyMaterialQuality(mat);
    }
  }

  private applyMaterialQuality(mat: THREE.MeshStandardMaterial): void {
    const kind = mat.userData.blockKind as BlockMaterial;
    const surface = mat.userData.surface as SurfaceTexture | null;
    const baseRough = mat.userData.baseRoughness as number;
    const baseMetal = mat.userData.baseMetalness as number;

    mat.normalMap = this.quality === 'low' || !surface ? null : surface.normalMap;

    let roughness = baseRough;
    let metalness = baseMetal;
    if (this.quality === 'max') {
      if (kind === 'water_dock') {
        roughness = 0.06;
        metalness = 0.55;
      } else if (kind === 'ice_glass') {
        roughness = 0.1;
        metalness = 0.3;
      } else if (kind === 'metal' || kind.startsWith('container_')) {
        roughness = baseRough * 0.7;
        metalness = Math.min(1, baseMetal + 0.15);
      } else if (kind === 'floor' || kind === 'asphalt') {
        roughness = baseRough * 0.82;
      }
    }
    mat.roughness = roughness;
    mat.metalness = metalness;
    mat.needsUpdate = true;
  }

  /** Pro Frame: bewegte Deko (Kräne, Radar, Windmühlen, Lüfter) und fließendes Wasser. */
  public update(frameDt: number): void {
    if (this.quality === 'low') return;
    const dt = Math.min(0.1, Math.max(0, frameDt));
    this.animTime += dt;

    const water = this.surfaces.water;
    water.map.offset.x = (water.map.offset.x + dt * 0.012) % 1;
    water.map.offset.y = (water.map.offset.y + dt * 0.02) % 1;
    water.normalMap.offset.copy(water.map.offset);

    for (const { prop, group } of this.animatedVisuals) {
      const phase = prop.phase ?? 0;
      if (prop.kind === 'spin') {
        group.rotation[prop.axis] = phase + this.animTime * prop.speed;
      } else {
        const offset = Math.sin(phase + this.animTime * prop.speed) * (prop.amplitude ?? 0);
        group.position[prop.axis] = prop.pivot[prop.axis] + offset;
      }
    }
  }

  public flashButton(buttonId: RangeButtonId): void {
    const vis = this.buttonVisuals.get(buttonId);
    if (vis) {
      vis.flashTimer = 0.22;
      vis.lastActive = null; // Force crisp redraw
    }
  }

  public updateRangeVisuals(snapshot: RangeUiSnapshot, frameDt: number): void {
    // Update shootable button panels
    for (const [id, vis] of this.buttonVisuals.entries()) {
      let isActive = false;
      if (id === 'start_challenge') isActive = snapshot.challengeActive;
      else if (id === 'toggle_strafe') isActive = snapshot.strafeEnabled;
      else if (id === 'toggle_armor') isActive = snapshot.armorEnabled;
      else if (id === 'toggle_inf_ammo') isActive = snapshot.infiniteAmmo;
      else if (id === 'clear_spray') isActive = vis.flashTimer > 0;

      if (vis.flashTimer > 0) {
        vis.flashTimer = Math.max(0, vis.flashTimer - frameDt);
        if (vis.flashTimer === 0) {
          vis.lastActive = null;
        }
      }

      const effectiveActive = isActive || vis.flashTimer > 0;
      if (vis.lastActive !== effectiveActive) {
        vis.lastActive = effectiveActive;
        this.drawButtonCanvas(vis, isActive, vis.flashTimer > 0);
        vis.frameMat.color.setHex(effectiveActive ? 0x18d4c9 : 0x2b3948);
        vis.frameMat.emissive.setHex(
          vis.flashTimer > 0 ? 0xff6b2b : isActive ? 0x12a89f : 0x0a1017
        );
        vis.frameMat.emissiveIntensity = vis.flashTimer > 0 ? 0.9 : isActive ? 0.55 : 0.15;
      }
    }

    // Update 3D overhead scoreboard (quantize elapsed time to 0.1s so texture updates at most 10/s)
    if (this.scoreboardCanvas && this.scoreboardCtx && this.scoreboardTex) {
      const tenths = Math.floor(snapshot.challengeElapsedSec * 10);
      const lastTimeTenths = Math.floor((snapshot.lastChallengeTimeSec ?? 0) * 10);
      const key = `${snapshot.challengeActive ? 1 : 0}|${snapshot.challengeHits}|${snapshot.challengeRemaining}|${tenths}|${snapshot.lastChallengeHits ?? -1}|${lastTimeTenths}|${snapshot.strafeEnabled ? 1 : 0}|${snapshot.armorEnabled ? 1 : 0}|${snapshot.infiniteAmmo ? 1 : 0}`;
      if (key !== this.lastScoreboardKey) {
        this.lastScoreboardKey = key;
        this.drawScoreboardCanvas(
          this.scoreboardCtx,
          this.scoreboardCanvas.width,
          this.scoreboardCanvas.height,
          snapshot
        );
        this.scoreboardTex.needsUpdate = true;
      }
    }
  }

  /** Number of merged static block meshes in the current map (diagnostics). */
  public getStaticBatchCount(): number {
    return this.staticBatchCount;
  }

  private addBatchedBlockMeshes(parent: THREE.Group, blocks: ReadonlyArray<MapBlock>): void {
    const groups = new Map<string, { kind: BlockMaterial; color: number; geos: THREE.BufferGeometry[] }>();
    const tmpObj = new THREE.Object3D();

    for (const block of blocks) {
      const key = `${block.material}:${block.color.toString(16)}`;
      let group = groups.get(key);
      if (!group) {
        group = { kind: block.material, color: block.color, geos: [] };
        groups.set(key, group);
      }
      const geo = new THREE.BoxGeometry(block.size.x, block.size.y, block.size.z);
      this.applyWorldUVs(geo, block);
      tmpObj.position.set(block.pos.x, block.pos.y, block.pos.z);
      tmpObj.rotation.set(block.rotX ?? 0, block.rotY ?? 0, block.rotZ ?? 0, 'XYZ');
      tmpObj.scale.set(1, 1, 1);
      tmpObj.updateMatrix();
      geo.applyMatrix4(tmpObj.matrix);
      group.geos.push(geo);
    }

    for (const [key, group] of groups.entries()) {
      const mat = this.getBlockMaterial(group.kind, group.color);
      const merged = group.geos.length === 1 ? group.geos[0] : mergeGeometries(group.geos, false);

      if (!merged) {
        // Fallback: attribute mismatch (should never happen for BoxGeometry) -> keep individual meshes
        for (const g of group.geos) {
          this.mapGeometries.push(g);
          const mesh = new THREE.Mesh(g, mat);
          mesh.name = `static-${key}`;
          parent.add(mesh);
          this.staticBatchCount += 1;
        }
        continue;
      }

      if (merged !== group.geos[0]) {
        for (const g of group.geos) g.dispose();
      }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      this.mapGeometries.push(merged);

      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `static-batch-${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      this.staticBatchCount += 1;
    }
  }

  /**
   * Ersetzt die Standard-UVs (0..1 pro Fläche → gestreckt auf großen Blöcken)
   * durch Box-projizierte Welt-UVs: 1 Kachel = `tileMeters` Meter, nahtlos über
   * benachbarte Blöcke hinweg.
   */
  private applyWorldUVs(geo: THREE.BoxGeometry, block: MapBlock): void {
    const tile = this.getTileMeters(block.material);
    if (tile <= 0) return;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const ox = block.pos.x;
    const oy = block.pos.y;
    const oz = block.pos.z;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox;
      const y = pos.getY(i) + oy;
      const z = pos.getZ(i) + oz;
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      let u: number;
      let v: number;
      if (Math.abs(nx) > 0.5) {
        u = nx > 0 ? -z : z;
        v = y;
      } else if (Math.abs(ny) > 0.5) {
        u = x;
        v = ny > 0 ? -z : z;
      } else {
        u = nz > 0 ? x : -x;
        v = y;
      }
      uv.setXY(i, u / tile, v / tile);
    }
    uv.needsUpdate = true;
  }

  private getTileMeters(kind: BlockMaterial): number {
    switch (kind) {
      case 'floor':
      case 'asphalt':
        return this.surfaces.floor.tileMeters;
      case 'concrete':
      case 'wall_light':
        return this.surfaces.concrete.tileMeters;
      case 'container_orange':
      case 'container_teal':
      case 'container_slate':
        return this.surfaces.container.tileMeters;
      case 'metal':
        return this.surfaces.metal.tileMeters;
      case 'wood':
        return this.surfaces.wood.tileMeters;
      case 'hazard':
        return this.surfaces.hazard.tileMeters;
      case 'brick_warm':
        return this.surfaces.brick.tileMeters;
      case 'stone_sand':
        return this.surfaces.stone.tileMeters;
      case 'timber_beam':
        return this.surfaces.timber.tileMeters;
      case 'terracotta':
        return this.surfaces.terracotta.tileMeters;
      case 'arctic_panel':
        return this.surfaces.arctic.tileMeters;
      case 'ice_glass':
        return this.surfaces.ice.tileMeters;
      case 'water_dock':
        return this.surfaces.water.tileMeters;
      default:
        // spray_board / holo_screen / trims: Bild bleibt 1:1 pro Fläche
        return 0;
    }
  }

  /** Legacy single-block path (kept for interactive / special-case meshes). */
  public addBlockMesh(parent: THREE.Group, block: MapBlock): void {
    const geo = new THREE.BoxGeometry(block.size.x, block.size.y, block.size.z);
    this.applyWorldUVs(geo, { ...block, pos: { x: 0, y: 0, z: 0 } });
    this.mapGeometries.push(geo);

    const mat = this.getBlockMaterial(block.material, block.color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(block.pos.x, block.pos.y, block.pos.z);
    mesh.rotation.set(block.rotX ?? 0, block.rotY ?? 0, block.rotZ ?? 0, 'XYZ');
    mesh.name = block.id;
    parent.add(mesh);
  }

  private getBlockMaterial(kind: BlockMaterial, color: number): THREE.MeshStandardMaterial {
    const key = `${kind}:${color.toString(16)}`;
    const existing = this.materialCache.get(key);
    if (existing) return existing;

    let surface: SurfaceTexture | null = null;
    let map: THREE.CanvasTexture | null = null;
    let emissiveMap: THREE.CanvasTexture | null = null;
    let roughness = 0.78;
    let metalness = 0.08;
    let emissive = 0x000000;
    let emissiveIntensity = 0;

    switch (kind) {
      case 'floor':
      case 'asphalt':
        surface = this.surfaces.floor;
        roughness = 0.86;
        metalness = 0.05;
        break;
      case 'concrete':
      case 'wall_light':
        surface = this.surfaces.concrete;
        roughness = 0.8;
        metalness = 0.06;
        break;
      case 'container_orange':
      case 'container_teal':
      case 'container_slate':
        surface = this.surfaces.container;
        roughness = 0.56;
        metalness = 0.34;
        break;
      case 'metal':
        surface = this.surfaces.metal;
        roughness = 0.42;
        metalness = 0.62;
        break;
      case 'wood':
        surface = this.surfaces.wood;
        roughness = 0.76;
        metalness = 0.04;
        break;
      case 'hazard':
        surface = this.surfaces.hazard;
        roughness = 0.65;
        metalness = 0.15;
        break;
      case 'trim_orange':
        roughness = 0.38;
        metalness = 0.25;
        emissive = 0xff5e1a;
        emissiveIntensity = 0.32;
        break;
      case 'trim_teal':
        roughness = 0.38;
        metalness = 0.25;
        emissive = 0x12b8ae;
        emissiveIntensity = 0.35;
        break;
      case 'spray_board':
        map = this.texSprayBoard;
        roughness = 0.65;
        metalness = 0.05;
        break;
      case 'brick_warm':
        surface = this.surfaces.brick;
        roughness = 0.84;
        metalness = 0.04;
        break;
      case 'stone_sand':
        surface = this.surfaces.stone;
        roughness = 0.82;
        metalness = 0.04;
        break;
      case 'timber_beam':
        surface = this.surfaces.timber;
        roughness = 0.74;
        metalness = 0.06;
        break;
      case 'terracotta':
        surface = this.surfaces.terracotta;
        roughness = 0.68;
        metalness = 0.06;
        break;
      case 'arctic_panel':
        surface = this.surfaces.arctic;
        roughness = 0.52;
        metalness = 0.28;
        break;
      case 'ice_glass':
        surface = this.surfaces.ice;
        roughness = 0.2;
        metalness = 0.18;
        emissive = 0x1b5670;
        emissiveIntensity = 0.22;
        break;
      case 'water_dock':
        surface = this.surfaces.water;
        roughness = 0.22;
        metalness = 0.24;
        emissive = 0x0c3547;
        emissiveIntensity = 0.22;
        break;
      case 'holo_screen':
        map = this.texHoloScreen;
        emissiveMap = this.texHoloScreen;
        roughness = 0.26;
        metalness = 0.18;
        emissive = 0xffffff;
        emissiveIntensity = 0.62;
        break;
    }

    const usePureTextureColor =
      kind === 'spray_board' || kind === 'hazard' || kind === 'holo_screen';

    if (surface) {
      map = surface.map;
    }
    const normalStrength =
      kind === 'ice_glass' || kind === 'water_dock' ? 0.35 : kind === 'floor' || kind === 'asphalt' ? 0.55 : 0.85;

    const mat = new THREE.MeshStandardMaterial({
      color: usePureTextureColor ? 0xffffff : color,
      map,
      normalMap: surface ? surface.normalMap : null,
      normalScale: new THREE.Vector2(normalStrength, normalStrength),
      emissiveMap,
      roughness,
      metalness,
      emissive,
      emissiveIntensity,
    });
    mat.userData.blockKind = kind;
    mat.userData.surface = surface;
    mat.userData.baseRoughness = roughness;
    mat.userData.baseMetalness = metalness;
    this.applyMaterialQuality(mat);
    this.materialCache.set(key, mat);
    return mat;
  }

  private addZoneVisuals(parent: THREE.Group, zone: MapZone): void {
    const isKernSite = zone.type === 'kern_site_a' || zone.type === 'kern_site_b';
    const borderThickness = isKernSite ? 0.26 : 0.14;
    const yBase = zone.center.y + (isKernSite ? 0.022 : 0.015);

    const accentHex =
      zone.type === 'kern_site_a'
        ? 0xff6b2b
        : zone.type === 'kern_site_b'
          ? 0x18d4c9
          : zone.color;

    // Subtle translucent tactical pad fill
    const padGeo = new THREE.PlaneGeometry(zone.size.x, zone.size.z);
    padGeo.rotateX(-Math.PI * 0.5);
    const padMat = new THREE.MeshBasicMaterial({
      color: accentHex,
      transparent: true,
      opacity: isKernSite ? 0.13 : 0.06,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(zone.center.x, yBase, zone.center.z);
    parent.add(pad);
    this.mapGeometries.push(padGeo);
    this.mapMaterials.push(padMat);

    // Crisp glowing perimeter frame strips (4 edges, zero z-fighting)
    const borderMat = new THREE.MeshBasicMaterial({
      color: accentHex,
      transparent: true,
      opacity: isKernSite ? 0.88 : 0.45,
    });
    this.mapMaterials.push(borderMat);

    const stripNGeo = new THREE.BoxGeometry(zone.size.x, 0.024, borderThickness);
    const stripSGeo = new THREE.BoxGeometry(zone.size.x, 0.024, borderThickness);
    const innerZ = Math.max(0.2, zone.size.z - borderThickness * 2);
    const stripWGeo = new THREE.BoxGeometry(borderThickness, 0.024, innerZ);
    const stripEGeo = new THREE.BoxGeometry(borderThickness, 0.024, innerZ);
    this.mapGeometries.push(stripNGeo, stripSGeo, stripWGeo, stripEGeo);

    const stripN = new THREE.Mesh(stripNGeo, borderMat);
    stripN.position.set(
      zone.center.x,
      zone.center.y + 0.016,
      zone.center.z - zone.size.z * 0.5 + borderThickness * 0.5
    );
    const stripS = new THREE.Mesh(stripSGeo, borderMat);
    stripS.position.set(
      zone.center.x,
      zone.center.y + 0.016,
      zone.center.z + zone.size.z * 0.5 - borderThickness * 0.5
    );
    const stripW = new THREE.Mesh(stripWGeo, borderMat);
    stripW.position.set(
      zone.center.x - zone.size.x * 0.5 + borderThickness * 0.5,
      zone.center.y + 0.016,
      zone.center.z
    );
    const stripE = new THREE.Mesh(stripEGeo, borderMat);
    stripE.position.set(
      zone.center.x + zone.size.x * 0.5 - borderThickness * 0.5,
      zone.center.y + 0.016,
      zone.center.z
    );
    parent.add(stripN, stripS, stripW, stripE);

    // Floating overhead "ZONE A" / "ZONE B" tactical beacon signboard
    if (isKernSite) {
      const signText = zone.type === 'kern_site_a' ? 'KERN-ZONE A' : 'KERN-ZONE B';
      const subText = zone.label.toUpperCase();
      const signTex = this.makeSignboardTexture(
        signText,
        subText,
        zone.type === 'kern_site_a' ? '#ff6b2b' : '#18d4c9'
      );
      this.mapTextures.push(signTex);

      const signMat = new THREE.SpriteMaterial({
        map: signTex,
        transparent: true,
        depthWrite: false,
      });
      this.mapMaterials.push(signMat);

      const sprite = new THREE.Sprite(signMat);
      sprite.position.set(zone.center.x, zone.center.y + 5.2, zone.center.z);
      sprite.scale.set(5.4, 1.55, 1);
      parent.add(sprite);
    }
  }

  private addDistanceLine(parent: THREE.Group, line: DistanceLineDef): void {
    const lineGeo = new THREE.PlaneGeometry(line.width, 0.14);
    lineGeo.rotateX(-Math.PI * 0.5);
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0x18d4c9,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.position.set(0, 0.018, line.z);
    parent.add(lineMesh);
    this.mapGeometries.push(lineGeo);
    this.mapMaterials.push(lineMat);

    // Floor distance badge on left & right edges of the lane
    const badgeTex = this.makeDistanceBadgeTexture(line.label);
    this.mapTextures.push(badgeTex);

    const badgeGeo = new THREE.PlaneGeometry(2.1, 0.85);
    badgeGeo.rotateX(-Math.PI * 0.5);
    const badgeMat = new THREE.MeshBasicMaterial({
      map: badgeTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mapGeometries.push(badgeGeo);
    this.mapMaterials.push(badgeMat);

    const badgeLeft = new THREE.Mesh(badgeGeo, badgeMat);
    badgeLeft.position.set(-line.width * 0.5 + 1.4, 0.022, line.z + 0.55);

    const badgeRight = new THREE.Mesh(badgeGeo, badgeMat);
    badgeRight.position.set(line.width * 0.5 - 1.4, 0.022, line.z + 0.55);

    parent.add(badgeLeft, badgeRight);
  }

  private addRangeButton(parent: THREE.Group, btn: RangeControlButton): void {
    const frameGeo = new THREE.BoxGeometry(btn.size.x, btn.size.y, btn.size.z);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2b3948,
      emissive: 0x0a1017,
      emissiveIntensity: 0.15,
      roughness: 0.38,
      metalness: 0.65,
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(btn.pos.x, btn.pos.y, btn.pos.z);
    parent.add(frameMesh);
    this.mapGeometries.push(frameGeo);
    this.mapMaterials.push(frameMat);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.mapTextures.push(texture);

    const faceGeo = new THREE.PlaneGeometry(btn.size.x * 0.94, btn.size.y * 0.88);
    const faceMat = new THREE.MeshBasicMaterial({ map: texture });
    this.mapGeometries.push(faceGeo);
    this.mapMaterials.push(faceMat);

    // Front face (+Z, facing shooting booth) & back face (-Z)
    const frontFace = new THREE.Mesh(faceGeo, faceMat);
    frontFace.position.set(btn.pos.x, btn.pos.y, btn.pos.z + btn.size.z * 0.5 + 0.006);

    const backFace = new THREE.Mesh(faceGeo, faceMat);
    backFace.position.set(btn.pos.x, btn.pos.y, btn.pos.z - btn.size.z * 0.5 - 0.006);
    backFace.rotation.y = Math.PI;

    parent.add(frontFace, backFace);

    const vis: ButtonVisual = {
      def: btn,
      canvas,
      ctx,
      texture,
      frameMat,
      lastActive: null,
      flashTimer: 0,
    };
    this.buttonVisuals.set(btn.id, vis);
    this.drawButtonCanvas(vis, false, false);
  }

  private drawButtonCanvas(vis: ButtonVisual, active: boolean, flashing: boolean): void {
    const { ctx, canvas, def } = vis;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = flashing ? '#2d1c14' : active ? '#0d2629' : '#0e151d';
    ctx.fillRect(0, 0, w, h);

    const borderColor = flashing ? '#ff6b2b' : active ? '#18d4c9' : '#4a5d70';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    // Status LED pill
    ctx.fillStyle = borderColor;
    ctx.fillRect(28, 28, 18, h - 56);

    // Action badge top-left
    ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = active ? '#18d4c9' : '#8fa4b8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const subStatus =
      def.id === 'clear_spray'
        ? 'ANSCHIESSEN ZUM LEEREN'
        : active
          ? 'STATUS: AKTIV'
          : 'ANSCHIESSEN ZUM SCHALTEN';
    ctx.fillText(subStatus, 64, 30);

    // Main crisp button label
    ctx.font = '900 40px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#f3f8fc';
    ctx.textBaseline = 'bottom';
    ctx.fillText(def.label, 64, h - 30);

    vis.texture.needsUpdate = true;
  }

  private addScoreboard(parent: THREE.Group, pos: { x: number; y: number; z: number }): void {
    const boardWidth = 6.8;
    const boardHeight = 2.2;

    const housingGeo = new THREE.BoxGeometry(boardWidth + 0.26, boardHeight + 0.26, 0.22);
    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x16202a,
      roughness: 0.45,
      metalness: 0.7,
    });
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.set(pos.x, pos.y, pos.z);
    parent.add(housing);
    this.mapGeometries.push(housingGeo);
    this.mapMaterials.push(housingMat);

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 360;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.scoreboardCanvas = canvas;
    this.scoreboardCtx = ctx;
    this.scoreboardTex = tex;
    this.lastScoreboardKey = '';
    this.mapTextures.push(tex);

    const screenGeo = new THREE.PlaneGeometry(boardWidth, boardHeight);
    const screenMat = new THREE.MeshBasicMaterial({ map: tex });
    this.mapGeometries.push(screenGeo);
    this.mapMaterials.push(screenMat);

    const frontScreen = new THREE.Mesh(screenGeo, screenMat);
    frontScreen.position.set(pos.x, pos.y, pos.z + 0.12);
    parent.add(frontScreen);

    this.drawScoreboardCanvas(ctx, canvas.width, canvas.height, {
      challengeActive: false,
      challengeHits: 0,
      challengeRemaining: 30,
      challengeElapsedSec: 0,
      strafeEnabled: false,
      armorEnabled: false,
      infiniteAmmo: false,
    });
  }

  private drawScoreboardCanvas(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: RangeUiSnapshot
  ): void {
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);

    // Top SHARDLINE tactical header bar
    ctx.fillStyle = snap.challengeActive ? '#ff6b2b' : '#18d4c9';
    ctx.fillRect(0, 0, w, 10);

    ctx.strokeStyle = '#243444';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 12, w - 12, h - 18);

    // Row 1: Mode title (full width, centered — never collides with status row)
    ctx.font = '800 26px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = snap.challengeActive ? '#ff8247' : '#18d4c9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const modeTitle = snap.challengeActive
      ? 'MODUS: 30-ZIEL-PRÄZISIONSTEST (AKTIV)'
      : 'SHARDLINE ÜBUNGSANLAGE · FREIES TRAINING';
    ctx.fillText(modeTitle, w * 0.5, 22);

    // Row 2: Active modifiers stacked cleanly on their own row
    ctx.font = '700 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#a6bbd0';
    const mods = [
      `BEWEGUNG: ${snap.strafeEnabled ? 'AN' : 'AUS'}`,
      `SCHILD +50: ${snap.armorEnabled ? 'AN' : 'AUS'}`,
      `ENDLOS-MUNI: ${snap.infiniteAmmo ? 'AN' : 'AUS'}`,
    ].join('     ·     ');
    ctx.fillText(mods, w * 0.5, 58);

    // Divider line
    ctx.fillStyle = '#1e2c3a';
    ctx.fillRect(40, 92, w - 80, 3);

    const hits = snap.challengeActive
      ? snap.challengeHits
      : (snap.lastChallengeHits ?? snap.challengeHits);
    const remaining = snap.challengeActive ? snap.challengeRemaining : 0;
    const secs = snap.challengeActive
      ? snap.challengeElapsedSec
      : (snap.lastChallengeTimeSec ?? snap.challengeElapsedSec);

    const cols = [
      { label: 'TREFFER', value: `${hits} / 30`, color: '#ff6b2b', x: 190 },
      { label: 'VERBLEIBEND', value: `${remaining}`, color: '#f2f7fc', x: 512 },
      { label: 'ZEIT', value: `${secs.toFixed(1)} s`, color: '#18d4c9', x: 834 },
    ];

    for (const col of cols) {
      ctx.textAlign = 'center';
      ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#7e95ab';
      ctx.fillText(col.label, col.x, 112);

      ctx.font = '900 72px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = col.color;
      ctx.fillText(col.value, col.x, 148);
    }

    // Subtle divider above footer
    ctx.fillStyle = '#182430';
    ctx.fillRect(40, h - 54, w - 80, 2);

    ctx.textAlign = 'center';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#7a91a8';
    ctx.fillText(
      'SCHALTTAFELN LINKS ANSCHIESSEN ZUM SCHALTEN · LINKE HALLE: RÜCKSTOSS-WAND',
      w * 0.5,
      h - 38
    );
  }

  private makeSignboardTexture(
    title: string,
    subtitle: string,
    accentCss: string
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(11, 17, 24, 0.88)';
    ctx.fillRect(8, 8, 496, 144);

    ctx.strokeStyle = accentCss;
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 144);

    ctx.fillStyle = accentCss;
    ctx.fillRect(8, 8, 22, 144);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 54px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#f5f9fd';
    ctx.fillText(title, 266, 64);

    ctx.font = '700 24px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = accentCss;
    ctx.fillText(subtitle, 266, 118);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeDistanceBadgeTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 112;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(12, 19, 27, 0.9)';
    ctx.fillRect(4, 4, 248, 104);
    ctx.strokeStyle = '#18d4c9';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 104);

    ctx.font = '900 58px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#18d4c9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 58);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeSprayBoardTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Dark tactical slate contrast board so bright orange impact markers pop unmistakably
    ctx.fillStyle = '#141d26';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#253545';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    // Center reference axes + concentric rings anchored near lower-middle for upward recoil climb
    const cx = 256;
    const cy = 352;
    ctx.strokeStyle = '#18d4c9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, 32);
    ctx.lineTo(cx, 480);
    ctx.moveTo(48, cy);
    ctx.lineTo(464, cy);
    ctx.stroke();

    for (const r of [48, 112, 176, 240]) {
      ctx.strokeStyle = r === 48 ? '#ff6b2b' : 'rgba(24, 212, 201, 0.42)';
      ctx.lineWidth = r === 48 ? 4 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#ff6b2b';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '800 24px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9db2c7';
    ctx.textAlign = 'center';
    ctx.fillText('RÜCKSTOSS-ANALYSEWAND · ZIELPUNKT UNTEN', 256, 36);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeHoloScreenTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#081520';
    ctx.fillRect(0, 0, 256, 256);

    // Glowing cyan tactical grid
    ctx.strokeStyle = '#134e5c';
    ctx.lineWidth = 2;
    for (let i = 32; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 16);
      ctx.lineTo(i, 240);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16, i);
      ctx.lineTo(240, i);
      ctx.stroke();
    }

    // Outer frame
    ctx.strokeStyle = '#18d4c9';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 236, 236);

    // Header bar + telemetry bars
    ctx.fillStyle = '#18d4c9';
    ctx.fillRect(24, 24, 148, 14);
    ctx.fillStyle = '#ff6b2b';
    ctx.fillRect(184, 24, 48, 14);

    const barHeights = [84, 128, 62, 146, 108, 134];
    barHeights.forEach((bh, idx) => {
      const bx = 30 + idx * 34;
      ctx.fillStyle = idx === 3 ? '#ff6b2b' : '#18d4c9';
      ctx.fillRect(bx, 220 - bh, 20, bh);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public clearCurrentMap(): void {
    if (this.mapRoot) {
      this.scene.remove(this.mapRoot);
      this.mapRoot = null;
    }

    for (const g of this.mapGeometries) g.dispose();
    this.mapGeometries.length = 0;

    for (const m of this.mapMaterials) m.dispose();
    this.mapMaterials.length = 0;

    for (const t of this.mapTextures) t.dispose();
    this.mapTextures.length = 0;

    this.detailRoot = null;
    this.animatedVisuals.length = 0;

    this.buttonVisuals.clear();
    this.scoreboardCanvas = null;
    this.scoreboardCtx = null;
    this.scoreboardTex = null;
    this.lastScoreboardKey = '';
  }

  public dispose(): void {
    this.clearCurrentMap();
    for (const m of this.materialCache.values()) {
      m.dispose();
    }
    this.materialCache.clear();
    for (const s of Object.values(this.surfaces)) {
      s.map.dispose();
      s.normalMap.dispose();
    }
    this.texSprayBoard.dispose();
    this.texHoloScreen.dispose();
  }
}
