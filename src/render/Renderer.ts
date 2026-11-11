import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { GraphicsQuality } from '../core/types';
import type { MapTheme } from '../data/maps/types';

type UnderlyingRenderer = WebGPURenderer | THREE.WebGLRenderer;

interface ThemeLightingPreset {
  background: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  skyStops: readonly [string, string, string, string];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPos: readonly [number, number, number];
  fillColor: number;
  fillIntensity: number;
  fillPos: readonly [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
}

const THEME_PRESETS: Record<MapTheme, ThemeLightingPreset> = {
  dockyard: {
    background: 0x9bc4e2,
    fogColor: 0xb4d2e7,
    fogNear: 95,
    fogFar: 240,
    skyStops: ['#4f86b8', '#8bbbe0', '#cde2f2', '#8d9aa6'],
    hemiSky: 0xeaf4ff,
    hemiGround: 0x7b8896,
    hemiIntensity: 1.35,
    sunColor: 0xfff7ea,
    sunIntensity: 1.65,
    sunPos: [44, 78, 36],
    fillColor: 0xcde2ff,
    fillIntensity: 0.78,
    fillPos: [-42, 52, -38],
    ambientColor: 0xffffff,
    ambientIntensity: 0.36,
  },
  oldtown: {
    background: 0x92c4e8,
    fogColor: 0xdccab2,
    fogNear: 100,
    fogFar: 250,
    skyStops: ['#3c7ec2', '#7cbbe8', '#fbe8ce', '#a8957e'],
    hemiSky: 0xfff5e4,
    hemiGround: 0x9c8872,
    hemiIntensity: 1.38,
    sunColor: 0xffefd2,
    sunIntensity: 1.74,
    sunPos: [48, 74, 34],
    fillColor: 0xd4e6fa,
    fillIntensity: 0.76,
    fillPos: [-40, 54, -36],
    ambientColor: 0xfffaf2,
    ambientIntensity: 0.38,
  },
  range: {
    background: 0x96c6e8,
    fogColor: 0xd5cfc6,
    fogNear: 98,
    fogFar: 245,
    skyStops: ['#4282c0', '#82bde8', '#f5e6cf', '#9c9286'],
    hemiSky: 0xf7f4ec,
    hemiGround: 0x8f8274,
    hemiIntensity: 1.4,
    sunColor: 0xfff2dc,
    sunIntensity: 1.7,
    sunPos: [-46, 76, 32],
    fillColor: 0xd2e5fa,
    fillIntensity: 0.8,
    fillPos: [40, 56, -34],
    ambientColor: 0xffffff,
    ambientIntensity: 0.4,
  },
  arctic: {
    background: 0xa8d2ee,
    fogColor: 0xd8eefb,
    fogNear: 96,
    fogFar: 245,
    skyStops: ['#3c76ad', '#7ebae6', '#e6f6ff', '#a2b8cb'],
    hemiSky: 0xe8f6ff,
    hemiGround: 0x8ca3b8,
    hemiIntensity: 1.42,
    sunColor: 0xf5fbff,
    sunIntensity: 1.68,
    sunPos: [42, 72, 40],
    fillColor: 0xc4e4ff,
    fillIntensity: 0.84,
    fillPos: [-44, 54, -36],
    ambientColor: 0xf2f9ff,
    ambientIntensity: 0.38,
  },
};

export interface SceneThemeUserData {
  applyMapTheme?: (theme?: MapTheme) => void;
}

/** Licht-Multiplikatoren pro Qualitätsstufe (MAX: härtere Sonne, weniger Fülllicht -> sichtbare Schatten). */
const QUALITY_LIGHT: Record<
  GraphicsQuality,
  { sun: number; hemi: number; fill: number; ambient: number; env: number }
> = {
  low: { sun: 1, hemi: 1, fill: 1, ambient: 1, env: 0 },
  high: { sun: 1, hemi: 1, fill: 1, ambient: 1, env: 0 },
  max: { sun: 1.5, hemi: 0.6, fill: 0.45, ambient: 0.35, env: 0.6 },
};

const SKY_W = 1024;
const SKY_H = 512;
const SHADOW_HALF_EXTENT = 42;
const SHADOW_SNAP_M = 4;
const SHADOW_FLAG_REFRESH_SEC = 0.5;

export class Renderer {
  public backendName: 'WebGPU' | 'WebGL2' = 'WebGL2';
  public readonly scene: THREE.Scene;
  private renderer!: UnderlyingRenderer;
  private readonly canvas: HTMLCanvasElement;

  private skyCanvas: HTMLCanvasElement | null = null;
  private skyCtx: CanvasRenderingContext2D | null = null;
  private skyTex: THREE.CanvasTexture | null = null;
  /** Dieselbe Himmels-Leinwand als Umgebungs-Map für Reflexionen (nur MAX). */
  private envTex: THREE.CanvasTexture | null = null;
  private hemiLight!: THREE.HemisphereLight;
  private sunLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private bounceLight!: THREE.AmbientLight;
  private currentTheme: MapTheme | null = null;
  private activePreset: ThemeLightingPreset = THEME_PRESETS.dockyard;
  private quality: GraphicsQuality = 'high';
  private readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.4);
  private shadowFlagTimer = 0;

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.setupLightingAndSky();
    (this.scene.userData as SceneThemeUserData).applyMapTheme = (theme?: MapTheme) => {
      this.applyTheme(theme ?? 'dockyard');
    };
  }

  public static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const instance = new Renderer(canvas);
    await instance.initBackend();
    instance.applyQualityToBackend();
    instance.resize();
    return instance;
  }

  private async initBackend(): Promise<void> {
    let canUseWebGPU = false;
    try {
      const nav = navigator as Navigator & {
        gpu?: { requestAdapter?: () => Promise<unknown | null> };
      };
      if (nav.gpu && typeof nav.gpu.requestAdapter === 'function') {
        const adapter = await nav.gpu.requestAdapter();
        if (adapter) {
          canUseWebGPU = true;
        }
      }
    } catch {
      canUseWebGPU = false;
    }

    if (canUseWebGPU) {
      try {
        const gpuRenderer = new WebGPURenderer({
          canvas: this.canvas,
          antialias: true,
          powerPreference: 'high-performance',
        });
        await gpuRenderer.init();
        gpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        gpuRenderer.toneMappingExposure = 1.08;
        this.renderer = gpuRenderer;
        this.backendName = 'WebGPU';
        return;
      } catch {
        // Fallback to WebGL2 cleanly if WebGPU init fails
      }
    }

    const glRenderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    glRenderer.toneMappingExposure = 1.08;
    glRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = glRenderer;
    this.backendName = 'WebGL2';
  }

  private setupLightingAndSky(): void {
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0xb4d2e7, 95, 240);

    // Prozeduraler Himmel (Verlauf + Wolken + Sonnenscheibe) als Kuppel und als Reflexionsquelle
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = SKY_W;
    skyCanvas.height = SKY_H;
    const ctx = skyCanvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      this.skyCanvas = skyCanvas;
      this.skyCtx = ctx;
      const skyTex = new THREE.CanvasTexture(skyCanvas);
      skyTex.colorSpace = THREE.SRGBColorSpace;
      // Kuppel-UVs laufen gespiegelt zur Equirect-Konvention -> spiegeln, damit die
      // gemalte Sonne dort steht, wo das Sonnenlicht tatsächlich herkommt.
      skyTex.wrapS = THREE.RepeatWrapping;
      skyTex.repeat.x = -1;
      this.skyTex = skyTex;

      const envTex = new THREE.CanvasTexture(skyCanvas);
      envTex.colorSpace = THREE.SRGBColorSpace;
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      this.envTex = envTex;

      const skyGeo = new THREE.SphereGeometry(195, 32, 20);
      const skyMat = new THREE.MeshBasicMaterial({
        map: skyTex,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      const skyDome = new THREE.Mesh(skyGeo, skyMat);
      skyDome.name = 'shardline-skydome';
      skyDome.renderOrder = -10;
      this.scene.add(skyDome);
    }

    // High-readability tactical lighting — zero dark corners anywhere
    this.hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0x7b8896, 1.35);
    this.hemiLight.position.set(0, 60, 0);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff7ea, 1.65);
    this.sunLight.position.set(44, 78, 36);
    this.sunLight.shadow.mapSize.set(4096, 4096);
    this.sunLight.shadow.camera.left = -SHADOW_HALF_EXTENT;
    this.sunLight.shadow.camera.right = SHADOW_HALF_EXTENT;
    this.sunLight.shadow.camera.top = SHADOW_HALF_EXTENT;
    this.sunLight.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 320;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.05;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.fillLight = new THREE.DirectionalLight(0xcde2ff, 0.78);
    this.fillLight.position.set(-42, 52, -38);
    this.scene.add(this.fillLight);

    this.bounceLight = new THREE.AmbientLight(0xffffff, 0.36);
    this.scene.add(this.bounceLight);

    this.applyTheme('dockyard');
  }

  public applyTheme(theme: MapTheme = 'dockyard'): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;

    const preset = THEME_PRESETS[theme] ?? THEME_PRESETS.dockyard;
    this.activePreset = preset;
    this.sunDir.set(preset.sunPos[0], preset.sunPos[1], preset.sunPos[2]).normalize();

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(preset.background);
    } else {
      this.scene.background = new THREE.Color(preset.background);
    }

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(preset.fogColor);
      this.scene.fog.near = preset.fogNear;
      this.scene.fog.far = preset.fogFar;
    } else {
      this.scene.fog = new THREE.Fog(preset.fogColor, preset.fogNear, preset.fogFar);
    }

    this.paintSky(preset);
    this.applyLighting();
  }

  /** Malt Verlauf, Wolken und Sonnenscheibe in die Equirect-Himmelsleinwand. */
  private paintSky(preset: ThemeLightingPreset): void {
    const ctx = this.skyCtx;
    if (!ctx || !this.skyCanvas) return;

    const grad = ctx.createLinearGradient(0, 0, 0, SKY_H);
    grad.addColorStop(0.0, preset.skyStops[0]);
    grad.addColorStop(0.44, preset.skyStops[1]);
    grad.addColorStop(0.53, preset.skyStops[2]);
    grad.addColorStop(1.0, preset.skyStops[3]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SKY_W, SKY_H);

    // --- Wolken: horizontal kachelbares Wert-Rauschen über der Horizontlinie ---
    let seed = 0x51ed270b;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const octaves: { cx: number; cy: number; v: Float32Array }[] = [];
    for (let o = 0; o < 5; o++) {
      const cx = 6 << o;
      const cy = 3 << o;
      const v = new Float32Array(cx * (cy + 1));
      for (let i = 0; i < v.length; i++) v[i] = rand();
      octaves.push({ cx, cy, v });
    }
    const cloudRows = Math.floor(SKY_H * 0.5);
    const img = ctx.getImageData(0, 0, SKY_W, cloudRows);
    const d = img.data;
    for (let y = 0; y < cloudRows; y++) {
      // Ausblenden zum Horizont und leicht zum Zenit (Equirect-Verzerrung kaschieren)
      const elev = 1 - y / cloudRows; // 1 = Zenit, 0 = Horizont
      const fade = Math.min(1, elev / 0.14) * Math.min(1, (1 - elev) / 0.3 + 0.25);
      for (let x = 0; x < SKY_W; x++) {
        let n = 0;
        let amp = 0.5;
        let norm = 0;
        for (const oc of octaves) {
          const fx = (x / SKY_W) * oc.cx;
          const fy = (y / cloudRows) * oc.cy;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = fx - x0;
          const ty = fy - y0;
          const sx = tx * tx * (3 - 2 * tx);
          const sy = ty * ty * (3 - 2 * ty);
          const x1 = (x0 + 1) % oc.cx;
          const top = oc.v[y0 * oc.cx + x0] + (oc.v[y0 * oc.cx + x1] - oc.v[y0 * oc.cx + x0]) * sx;
          const bot =
            oc.v[(y0 + 1) * oc.cx + x0] +
            (oc.v[(y0 + 1) * oc.cx + x1] - oc.v[(y0 + 1) * oc.cx + x0]) * sx;
          n += (top + (bot - top) * sy) * amp;
          norm += amp;
          amp *= 0.5;
        }
        n /= norm;
        const t = Math.min(1, Math.max(0, (n - 0.5) / 0.2));
        const alpha = t * t * (3 - 2 * t) * fade * 0.9;
        if (alpha <= 0.003) continue;
        const i = (y * SKY_W + x) * 4;
        // dichte Wolkenkerne leicht grau, Ränder weiß
        const shade = 255 - t * 26;
        d[i] += (shade - d[i]) * alpha;
        d[i + 1] += (shade - d[i + 1]) * alpha;
        d[i + 2] += (Math.min(255, shade + 6) - d[i + 2]) * alpha;
      }
    }
    ctx.putImageData(img, 0, 0);

    // --- Sonnenscheibe + Halo an der tatsächlichen Lichtrichtung ---
    const u = Math.atan2(this.sunDir.z, this.sunDir.x) / (Math.PI * 2) + 0.5;
    const v = Math.asin(this.sunDir.y) / Math.PI + 0.5;
    const sunX = u * SKY_W;
    const sunY = (1 - v) * SKY_H;
    for (const ox of [-SKY_W, 0, SKY_W]) {
      const halo = ctx.createRadialGradient(sunX + ox, sunY, 0, sunX + ox, sunY, 120);
      halo.addColorStop(0, 'rgba(255,252,235,1)');
      halo.addColorStop(0.1, 'rgba(255,250,225,0.95)');
      halo.addColorStop(0.16, 'rgba(255,244,205,0.42)');
      halo.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(sunX + ox - 120, sunY - 120, 240, 240);
    }

    if (this.skyTex) this.skyTex.needsUpdate = true;
    if (this.envTex) this.envTex.needsUpdate = true;
  }

  /** Setzt Lichtfarben/-stärken aus Theme-Preset × Qualitäts-Multiplikator. */
  private applyLighting(): void {
    const preset = this.activePreset;
    const q = QUALITY_LIGHT[this.quality];

    this.hemiLight.color.setHex(preset.hemiSky);
    this.hemiLight.groundColor.setHex(preset.hemiGround);
    this.hemiLight.intensity = preset.hemiIntensity * q.hemi;

    this.sunLight.color.setHex(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity * q.sun;
    this.sunLight.position.set(preset.sunPos[0], preset.sunPos[1], preset.sunPos[2]);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.target.updateMatrixWorld();

    this.fillLight.color.setHex(preset.fillColor);
    this.fillLight.intensity = preset.fillIntensity * q.fill;
    this.fillLight.position.set(preset.fillPos[0], preset.fillPos[1], preset.fillPos[2]);

    this.bounceLight.color.setHex(preset.ambientColor);
    this.bounceLight.intensity = preset.ambientIntensity * q.ambient;

    this.scene.environment = q.env > 0 ? this.envTex : null;
    this.scene.environmentIntensity = q.env > 0 ? q.env : 1;
  }

  public getQuality(): GraphicsQuality {
    return this.quality;
  }

  /**
   * Wechselt die Grafikqualität zur Laufzeit.
   * - `low`  : reduzierte Renderauflösung, keine Schatten/Reflexionen
   * - `high` : volle Auflösung (bisheriger Standard)
   * - `max`  : Echtzeit-Schatten (PCF-Soft), Himmelsreflexionen (IBL), kontrastreicheres Sonnenlicht
   */
  public setQuality(quality: GraphicsQuality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.applyLighting();
    if (this.renderer) {
      this.applyQualityToBackend();
      this.resize();
    }
  }

  private applyQualityToBackend(): void {
    const shadows = this.quality === 'max';
    const shadowMap = this.renderer.shadowMap;
    const changed = shadowMap.enabled !== shadows;
    shadowMap.enabled = shadows;
    shadowMap.type = THREE.PCFSoftShadowMap;
    this.sunLight.castShadow = shadows;
    this.refreshShadowFlags();
    this.shadowFlagTimer = 0;
    if (changed) {
      // Schatten an/aus ändert die Shader-Programme -> Materialien neu kompilieren
      this.scene.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        if (Array.isArray(mat)) for (const m of mat) m.needsUpdate = true;
        else mat.needsUpdate = true;
      });
    }
  }

  /** Markiert alle (auch später hinzugefügten) Meshes als Schattenwerfer/-empfänger. */
  private refreshShadowFlags(): void {
    const enable = this.quality === 'max';
    const visit = (obj: THREE.Object3D): void => {
      // Viewmodel hängt an der Kamera -> soll keine Weltschatten werfen
      if ((obj as THREE.Camera).isCamera) return;
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.name !== 'shardline-skydome') {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
          | (THREE.Material & { isMeshBasicMaterial?: boolean })
          | undefined;
        const lit = !!mat && !mat.isMeshBasicMaterial;
        mesh.castShadow = enable && lit && !mat.transparent;
        mesh.receiveShadow = enable && lit;
      }
      for (const child of obj.children) visit(child);
    };
    visit(this.scene);
  }

  public resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const deviceDpr = window.devicePixelRatio || 1;
    const dpr = this.quality === 'low' ? Math.min(deviceDpr, 1) * 0.7 : Math.min(deviceDpr, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
  }

  public render(camera: THREE.Camera, frameDt = 0): void {
    if (this.quality === 'max') {
      // Schatten-Frustum folgt dem Spieler (gerastert, damit Schattenkanten nicht flimmern)
      const tx = Math.round(camera.position.x / SHADOW_SNAP_M) * SHADOW_SNAP_M;
      const tz = Math.round(camera.position.z / SHADOW_SNAP_M) * SHADOW_SNAP_M;
      this.sunLight.target.position.set(tx, 0, tz);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.position.set(
        tx + this.sunDir.x * 150,
        this.sunDir.y * 150,
        tz + this.sunDir.z * 150,
      );

      this.shadowFlagTimer += frameDt;
      if (this.shadowFlagTimer >= SHADOW_FLAG_REFRESH_SEC) {
        this.shadowFlagTimer = 0;
        this.refreshShadowFlags();
      }
    }
    this.renderer.render(this.scene, camera);
  }

  /** Draw calls of the last rendered frame (diagnostics; 0 if the backend does not report). */
  public getDrawCalls(): number {
    const info = (this.renderer as unknown as { info?: { render?: { calls?: number; drawCalls?: number } } }).info;
    return info?.render?.drawCalls ?? info?.render?.calls ?? 0;
  }

  public dispose(): void {
    this.skyTex?.dispose();
    this.envTex?.dispose();
    this.renderer.dispose();
  }
}
