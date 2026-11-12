import * as THREE from 'three';

/**
 * Prozedurale, hochauflösende Oberflächen-Texturen (Albedo + Normal-Map + Roughness-Map) für Map-Blöcke.
 *
 * Alles wird deterministisch per Canvas 2D erzeugt (keine externen Bilddateien).
 * Jede Oberfläche liefert:
 *  - `map`          : sRGB-Albedo mit mehrfarbiger Mikro-Chromatik und 100% toroidaler Kachelung
 *  - `normalMap`    : aus einer Höhenkarte per Sobel-Filter abgeleitet (Fugen, Rillen, Maserung)
 *  - `roughnessMap` : aus Mikrostruktur & Höhenkarte abgeleitet (Fugen/Poren rau, glatte Flächen glänzender)
 *  - `tileMeters`   : wie viele Meter eine Kachel in der Welt abdeckt (für Welt-UVs)
 */
export interface SurfaceTexture {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  tileMeters: number;
}

type Ctx = CanvasRenderingContext2D;

const SIZE = 512;

/** Kleiner, deterministischer PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseCssColor(style: unknown): [number, number, number, number] {
  if (typeof style !== 'string') return [200, 200, 200, 1];
  const s = style.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b, 1];
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r, g, b, 1];
    }
  }
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (m) {
    return [
      Math.max(0, Math.min(255, Number(m[1]))),
      Math.max(0, Math.min(255, Number(m[2]))),
      Math.max(0, Math.min(255, Number(m[3]))),
      m[4] !== undefined ? Math.max(0, Math.min(1, Number(m[4]))) : 1,
    ];
  }
  return [200, 200, 200, 1];
}

/**
 * Erzeugt eine HTMLCanvasElement-Instanz im Browser oder einen kompatiblen
 * In-Memory-Software-Canvas in Headless-Node/Vitest-Umgebungen.
 */
function makeCanvas(size = SIZE): { canvas: HTMLCanvasElement; ctx: any } {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) return { canvas, ctx };
  }

  const data = new Uint8ClampedArray(size * size * 4);
  let pathPts: Array<{ x: number; y: number }> = [];

  const blendPixel = (x: number, y: number, rgba: [number, number, number, number]): void => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const a = rgba[3];
    if (a <= 0) return;
    const idx = (y * size + x) * 4;
    const inv = 1 - a;
    data[idx] = Math.round(data[idx] * inv + rgba[0] * a);
    data[idx + 1] = Math.round(data[idx + 1] * inv + rgba[1] * a);
    data[idx + 2] = Math.round(data[idx + 2] * inv + rgba[2] * a);
    data[idx + 3] = 255;
  };

  interface SoftGrad {
    __stops: Array<{ offset: number; rgba: [number, number, number, number] }>;
    __kind: 'linear' | 'radial';
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    r0: number;
    r1: number;
    addColorStop(offset: number, color: string): void;
  }

  const sampleStyle = (style: unknown, x: number, y: number): [number, number, number, number] => {
    if (style && typeof style === 'object' && '__stops' in style) {
      const g = style as SoftGrad;
      const stops = g.__stops;
      if (stops.length === 0) return [200, 200, 200, 1];
      let t = 0;
      if (g.__kind === 'linear') {
        const dx = g.x1 - g.x0;
        const dy = g.y1 - g.y0;
        const len2 = dx * dx + dy * dy;
        t = len2 > 1e-6 ? ((x - g.x0) * dx + (y - g.y0) * dy) / len2 : 0;
      } else {
        const d = Math.hypot(x - g.x0, y - g.y0);
        t = g.r1 > g.r0 ? (d - g.r0) / (g.r1 - g.r0) : 0;
      }
      t = Math.max(0, Math.min(1, t));
      let s0 = stops[0];
      let s1 = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i].offset && t <= stops[i + 1].offset) {
          s0 = stops[i];
          s1 = stops[i + 1];
          break;
        }
      }
      const span = Math.max(1e-6, s1.offset - s0.offset);
      const u = Math.max(0, Math.min(1, (t - s0.offset) / span));
      return [
        s0.rgba[0] + (s1.rgba[0] - s0.rgba[0]) * u,
        s0.rgba[1] + (s1.rgba[1] - s0.rgba[1]) * u,
        s0.rgba[2] + (s1.rgba[2] - s0.rgba[2]) * u,
        s0.rgba[3] + (s1.rgba[3] - s0.rgba[3]) * u,
      ];
    }
    return parseCssColor(style);
  };

  const mockCtx: any = {
    fillStyle: '#000000' as unknown,
    strokeStyle: '#000000' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    fillRect(rx: number, ry: number, rw: number, rh: number) {
      const x0 = Math.max(0, Math.floor(rx));
      const y0 = Math.max(0, Math.floor(ry));
      const x1 = Math.min(size, Math.ceil(rx + rw));
      const y1 = Math.min(size, Math.ceil(ry + rh));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          blendPixel(x, y, sampleStyle(mockCtx.fillStyle, x, y));
        }
      }
    },
    strokeRect(rx: number, ry: number, rw: number, rh: number) {
      const lw = Math.max(1, Math.round(mockCtx.lineWidth));
      const prev = mockCtx.fillStyle;
      mockCtx.fillStyle = mockCtx.strokeStyle;
      mockCtx.fillRect(rx, ry, rw, lw);
      mockCtx.fillRect(rx, ry + rh - lw, rw, lw);
      mockCtx.fillRect(rx, ry, lw, rh);
      mockCtx.fillRect(rx + rw - lw, ry, lw, rh);
      mockCtx.fillStyle = prev;
    },
    beginPath() {
      pathPts = [];
    },
    moveTo(x: number, y: number) {
      pathPts.push({ x, y });
    },
    lineTo(x: number, y: number) {
      pathPts.push({ x, y });
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      const last = pathPts[pathPts.length - 1] ?? { x: cx, y: cy };
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        const it = 1 - t;
        pathPts.push({
          x: it * it * last.x + 2 * it * t * cx + t * t * x,
          y: it * it * last.y + 2 * it * t * cy + t * t * y,
        });
      }
    },
    arcTo(x1: number, y1: number, x2: number, y2: number, _r: number) {
      pathPts.push({ x: x1, y: y1 }, { x: x2, y: y2 });
    },
    arc(cx: number, cy: number, r: number, startAngle = 0, endAngle = Math.PI * 2) {
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const a = startAngle + ((endAngle - startAngle) * i) / steps;
        pathPts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    },
    ellipse(cx: number, cy: number, rx: number, ry: number) {
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const a = (Math.PI * 2 * i) / steps;
        pathPts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
    },
    closePath() {
      if (pathPts.length > 1) pathPts.push({ ...pathPts[0] });
    },
    fill() {
      if (pathPts.length < 3) return;
      let minX = size;
      let minY = size;
      let maxX = 0;
      let maxY = 0;
      for (const p of pathPts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const x0 = Math.max(0, Math.floor(minX));
      const y0 = Math.max(0, Math.floor(minY));
      const x1 = Math.min(size - 1, Math.ceil(maxX));
      const y1 = Math.min(size - 1, Math.ceil(maxY));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          blendPixel(x, y, sampleStyle(mockCtx.fillStyle, x, y));
        }
      }
    },
    stroke() {
      if (pathPts.length < 2) return;
      const rgba = sampleStyle(mockCtx.strokeStyle, pathPts[0].x, pathPts[0].y);
      const halfW = Math.max(0, Math.floor(mockCtx.lineWidth * 0.5));
      for (let i = 0; i < pathPts.length - 1; i++) {
        const p0 = pathPts[i];
        const p1 = pathPts[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y)));
        for (let s = 0; s <= steps; s++) {
          const px = Math.round(p0.x + ((p1.x - p0.x) * s) / steps);
          const py = Math.round(p0.y + ((p1.y - p0.y) * s) / steps);
          for (let dy = -halfW; dy <= halfW; dy++) {
            for (let dx = -halfW; dx <= halfW; dx++) {
              blendPixel(px + dx, py + dy, rgba);
            }
          }
        }
      }
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): SoftGrad {
      return {
        __stops: [],
        __kind: 'linear',
        x0,
        y0,
        x1,
        y1,
        r0: 0,
        r1: 0,
        addColorStop(offset: number, color: string) {
          this.__stops.push({ offset, rgba: parseCssColor(color) });
          this.__stops.sort((a, b) => a.offset - b.offset);
        },
      };
    },
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SoftGrad {
      return {
        __stops: [],
        __kind: 'radial',
        x0,
        y0,
        x1,
        y1,
        r0,
        r1,
        addColorStop(offset: number, color: string) {
          this.__stops.push({ offset, rgba: parseCssColor(color) });
          this.__stops.sort((a, b) => a.offset - b.offset);
        },
      };
    },
    getImageData(_x: number, _y: number, w: number, h: number): ImageData {
      return { data: new Uint8ClampedArray(data), width: w, height: h, colorSpace: 'srgb' } as ImageData;
    },
    putImageData(img: ImageData) {
      data.set(img.data);
    },
    createImageData(w: number, h: number): ImageData {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h, colorSpace: 'srgb' } as ImageData;
    },
  } as unknown as Ctx;

  const mockCanvas = {
    width: size,
    height: size,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;

  return { canvas: mockCanvas, ctx: mockCtx };
}

/** Kachelbares Wert-Rauschen (mehrere Oktaven, optional anisotrop) direkt in ImageData gemischt. */
function fbmNoise(
  ctx: Ctx,
  size: number,
  seed: number,
  amount: number,
  baseCells = 8,
  octaves = 4,
  mode: 'albedo' | 'height' = 'albedo',
  baseCellsY = baseCells,
): void {
  const rand = rng(seed);
  const grids: { cx: number; cy: number; values: Float32Array }[] = [];
  for (let o = 0; o < octaves; o++) {
    const cx = Math.max(1, baseCells << o);
    const cy = Math.max(1, baseCellsY << o);
    const values = new Float32Array(cx * cy);
    for (let i = 0; i < values.length; i++) values[i] = rand();
    grids.push({ cx, cy, values });
  }

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      let amp = 0.5;
      let norm = 0;
      for (const g of grids) {
        const fx = (x / size) * g.cx;
        const fy = (y / size) * g.cy;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const cx = g.cx;
        const cy = g.cy;
        const v00 = g.values[(y0 % cy) * cx + (x0 % cx)];
        const v10 = g.values[(y0 % cy) * cx + ((x0 + 1) % cx)];
        const v01 = g.values[((y0 + 1) % cy) * cx + (x0 % cx)];
        const v11 = g.values[((y0 + 1) % cy) * cx + ((x0 + 1) % cx)];
        const a = v00 + (v10 - v00) * sx;
        const b = v01 + (v11 - v01) * sx;
        n += (a + (b - a) * sy) * amp;
        norm += amp;
        amp *= 0.5;
      }
      n = n / norm - 0.5; // -0.5..0.5
      const i = (y * size + x) * 4;
      const delta = n * amount * 255;
      if (mode === 'height') {
        d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, d[i] + delta));
      } else {
        d[i] = Math.max(0, Math.min(255, d[i] + delta));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + delta));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + delta));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Feine Körnung + optionale subtile Farbtemperatur-Mikro-Variation pro Pixel. */
function grain(ctx: Ctx, size: number, seed: number, amount: number, chromaAmount = 0.015): void {
  const rand = rng(seed);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (rand() - 0.5) * amount * 255;
    const c = (rand() - 0.5) * chromaAmount * 255;
    d[i] = Math.max(0, Math.min(255, d[i] + g + c));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g - c));
  }
  ctx.putImageData(img, 0, 0);
}

/** Weiche Schmutz-/Wasserflecken (100% toroidal über alle Kanten gewrappt). */
function stains(ctx: Ctx, size: number, seed: number, count: number, color: string, maxR: number): void {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = maxR * (0.35 + rand() * 0.65);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
}

/** Kratzer / Haarrisse (100% toroidal über ox, oy ∈ {-size, 0, size} gewrappt). */
function scratches(ctx: Ctx, size: number, seed: number, count: number, color: string, maxLen: number): void {
  const rand = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const ang = rand() * Math.PI * 2;
    const len = maxLen * (0.2 + rand() * 0.8);
    const lw = 0.6 + rand() * 1.1;
    const jx = (rand() - 0.5) * 6;
    const jy = (rand() - 0.5) * 6;
    const ex = Math.cos(ang) * len;
    const ey = Math.sin(ang) * len;
    ctx.lineWidth = lw;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + ex * 0.5 + jx, y + oy + ey * 0.5 + jy, x + ox + ex, y + oy + ey);
        ctx.stroke();
      }
    }
  }
}

/** Toroidal gewrappte Mineral-/Zuschlagstoff-Sprenkel (für Beton, Asphalt, Stein, Putz). */
function speckles(
  ctx: Ctx,
  size: number,
  seed: number,
  count: number,
  colors: readonly string[],
  minR = 0.7,
  maxR = 2.4,
): void {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = minR + rand() * (maxR - minR);
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Erzeugt eine Normal-Map aus einer Graustufen-Höhenkarte (Sobel, kachelbar). */
function normalFromHeight(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = height.width;
  const src = height.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size, size).data;
  const { canvas, ctx } = makeCanvas(size);
  const out = ctx.createImageData(size, size);
  const h = (x: number, y: number): number => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return src[(yi * size + xi) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) -
        (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy =
        h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) -
        (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/**
 * Erzeugt eine physikalisch plausible Roughness-Map aus Höhenkarte + Albedo:
 * Vertiefungen (Fugen, Poren, Risse) und verwitterte/matte Stellen erhalten hohe Rauheit (0.85..0.96),
 * während erhabene/glatte Stein-, Ziegel-, Metall- oder Glasflächen niedrigere Rauheit (0.42..0.68) besitzen.
 */
function roughnessFromHeight(
  height: HTMLCanvasElement,
  albedo: HTMLCanvasElement,
  minRough = 0.44,
  maxRough = 0.96,
): HTMLCanvasElement {
  const size = height.width;
  const hData = height.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size, size).data;
  const aData = albedo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size, size).data;
  const { canvas, ctx } = makeCanvas(size);
  const out = ctx.createImageData(size, size);

  const sampleH = (x: number, y: number): number => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return hData[(yi * size + xi) * 4] / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const h = hData[i] / 255;
      const lum = (0.299 * aData[i] + 0.587 * aData[i + 1] + 0.114 * aData[i + 2]) / 255;
      const dx = sampleH(x + 1, y) - sampleH(x - 1, y);
      const dy = sampleH(x, y + 1) - sampleH(x, y - 1);
      const slope = Math.min(1, Math.hypot(dx, dy) * 3.2);
      const smoothness = Math.max(0, Math.min(1, 0.68 * h + 0.32 * lum - slope * 0.35));
      const rough = minRough + (1 - smoothness) * (maxRough - minRough);
      const v = Math.max(0, Math.min(255, Math.round(rough * 255)));
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function finish(
  albedo: HTMLCanvasElement,
  height: HTMLCanvasElement,
  normalStrength: number,
  tileMeters: number,
  minRough = 0.44,
  maxRough = 0.96,
): SurfaceTexture {
  const map = new THREE.CanvasTexture(albedo);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;

  const normalMap = new THREE.CanvasTexture(normalFromHeight(height, normalStrength));
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughnessFromHeight(height, albedo, minRough, maxRough));
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = 8;

  return { map, normalMap, roughnessMap, tileMeters };
}

/** Malt dieselbe Geometrie in Albedo (Farbe) und Höhe (Grau). */
function dual(
  draw: (ctx: Ctx, pass: 'albedo' | 'height') => void,
): { albedo: HTMLCanvasElement; height: HTMLCanvasElement; actx: Ctx; hctx: Ctx } {
  const a = makeCanvas();
  const h = makeCanvas();
  draw(a.ctx, 'albedo');
  draw(h.ctx, 'height');
  return { albedo: a.canvas, height: h.canvas, actx: a.ctx, hctx: h.ctx };
}

// ---------------------------------------------------------------------------
// Oberflächen
// ---------------------------------------------------------------------------

/** Industrieboden: großformatige gegossene Betonplatten mit feinen Dehnungsfugen und Mineralzuschlag. */
export function makeFloorSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#dfe4e8' : '#a4a4a4';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Leichte Tonwert-Variation zwischen den 2×2 Großplatten
    const tones = [0, -5, 4, -2];
    const half = SIZE / 2;
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const dt = tones[py * 2 + px];
        ctx.fillStyle = isA
          ? `rgb(${223 + dt},${228 + dt},${232 + dt})`
          : `rgb(${164 + dt * 2},${164 + dt * 2},${164 + dt * 2})`;
        ctx.fillRect(px * half, py * half, half, half);
      }
    }

    // Dezente Dehnungsfugen (sauber kachelbar an 0 und SIZE/2)
    ctx.strokeStyle = isA ? '#b8c0c8' : '#4a4a4a';
    ctx.lineWidth = 3;
    for (const p of [0, half, SIZE]) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(SIZE, p);
      ctx.stroke();
    }
  });
  fbmNoise(actx, SIZE, 11, 0.09, 4, 5);
  speckles(actx, SIZE, 1101, 220, ['rgba(175,182,190,0.45)', 'rgba(245,248,250,0.40)', 'rgba(155,148,140,0.35)'], 0.8, 2.0);
  stains(actx, SIZE, 12, 5, 'rgba(85,92,100,0.05)', 140);
  scratches(actx, SIZE, 14, 42, 'rgba(245,248,252,0.08)', 48);
  grain(actx, SIZE, 15, 0.045, 0.015);
  fbmNoise(hctx, SIZE, 16, 0.2, 8, 4, 'height');
  return finish(albedo, height, 2.0, 6.0, 0.52, 0.94);
}

/** Walzasphalt / Tarmac: dunkler Mineral-Splittbelag mit Quarz-/Basalt-Körnung ohne Betonplatten-Raster. */
export function makeAsphaltSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#d6dce2' : '#909090';
    ctx.fillRect(0, 0, SIZE, SIZE);
  });
  fbmNoise(actx, SIZE, 171, 0.12, 4, 5);
  fbmNoise(actx, SIZE, 172, 0.06, 2, 3, 'albedo', 8); // leichte Walzspuren
  speckles(
    actx,
    SIZE,
    173,
    520,
    [
      'rgba(248,250,252,0.42)',
      'rgba(165,174,184,0.48)',
      'rgba(195,182,168,0.36)',
      'rgba(130,138,148,0.45)',
    ],
    0.7,
    2.2,
  );
  speckles(hctx, SIZE, 174, 520, ['#d0d0d0', '#585858', '#b8b8b8'], 0.8, 2.2);
  scratches(actx, SIZE, 175, 24, 'rgba(105,112,120,0.12)', 65);
  scratches(hctx, SIZE, 175, 24, 'rgba(40,40,40,0.35)', 65);
  stains(actx, SIZE, 176, 5, 'rgba(95,102,110,0.05)', 150);
  grain(actx, SIZE, 177, 0.075, 0.018);
  fbmNoise(hctx, SIZE, 178, 0.28, 12, 4, 'height');
  return finish(albedo, height, 2.2, 6.0, 0.58, 0.96);
}

/** Architektur-Sichtbeton: mehrskalige Mineralstruktur ohne Stempel-Ankerlöcher oder abgeschnittene Regenläufer. */
export function makeConcreteSurface(): SurfaceTexture {
  const rand = rng(21);
  const pores: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 180; i++) pores.push({ x: rand() * SIZE, y: rand() * SIZE, r: 0.7 + rand() * 1.6 });

  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#e4e8ec' : '#9c9c9c';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Dezente, voll kachelbare horizontale Schalungs-Haarfugen (ohne harte Randkästen oder Ankerlöcher)
    ctx.strokeStyle = isA ? 'rgba(182,190,198,0.42)' : 'rgba(95,95,95,0.55)';
    ctx.lineWidth = 1.5;
    for (const y of [SIZE * 0.25, SIZE * 0.5, SIZE * 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SIZE, y);
      ctx.stroke();
    }

    // Feine Lunker & Mineralporen (100% toroidal gewrappt)
    ctx.fillStyle = isA ? 'rgba(164,172,180,0.42)' : '#5a5a5a';
    for (const p of pores) {
      for (const ox of [-SIZE, 0, SIZE]) {
        for (const oy of [-SIZE, 0, SIZE]) {
          if (p.x + ox + p.r < 0 || p.x + ox - p.r > SIZE || p.y + oy + p.r < 0 || p.y + oy - p.r > SIZE) continue;
          ctx.beginPath();
          ctx.arc(p.x + ox, p.y + oy, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  fbmNoise(actx, SIZE, 22, 0.1, 4, 5);
  // Toroidal kachelbare vertikale Witterungsschlieren (kein harter Schnitt bei y = 0)
  fbmNoise(actx, SIZE, 24, 0.055, 16, 3, 'albedo', 2);
  speckles(
    actx,
    SIZE,
    2401,
    240,
    ['rgba(210,204,194,0.38)', 'rgba(175,184,192,0.38)', 'rgba(248,250,252,0.34)'],
    0.7,
    1.8,
  );
  stains(actx, SIZE, 23, 5, 'rgba(110,116,124,0.045)', 140);
  scratches(actx, SIZE, 27, 28, 'rgba(165,172,180,0.12)', 42);
  grain(actx, SIZE, 25, 0.045, 0.016);
  fbmNoise(hctx, SIZE, 26, 0.22, 12, 4, 'height');
  return finish(albedo, height, 1.8, 5.2, 0.54, 0.95);
}

/** Fassadenputz / Stucco (`wall_light`): feiner mineralischer Architekturputz mit warmer/kühler Mikropigmentierung. */
export function makePlasterSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#eaedf0' : '#9e9e9e';
    ctx.fillRect(0, 0, SIZE, SIZE);
  });
  fbmNoise(actx, SIZE, 181, 0.075, 4, 5);
  fbmNoise(actx, SIZE, 182, 0.04, 12, 3, 'albedo', 4);
  speckles(
    actx,
    SIZE,
    183,
    280,
    ['rgba(255,252,246,0.38)', 'rgba(206,200,192,0.32)', 'rgba(192,200,208,0.30)'],
    0.6,
    1.7,
  );
  stains(actx, SIZE, 184, 5, 'rgba(140,136,130,0.038)', 150);
  scratches(actx, SIZE, 185, 22, 'rgba(255,255,255,0.08)', 34);
  grain(actx, SIZE, 186, 0.04, 0.015);
  fbmNoise(hctx, SIZE, 187, 0.16, 12, 4, 'height');
  return finish(albedo, height, 1.45, 5.5, 0.56, 0.92);
}

/** Wellblech-Container: durchgehende Trapez-Sicken und toroidal gewrappte Gebrauchsspuren ohne Mittelbalken. */
export function makeContainerSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#eef1f4' : '#808080';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Durchgehende vertikale Trapez-Sicken (nahtlos über jede Höhe)
    const pitch = 32;
    for (let x = 0; x < SIZE; x += pitch) {
      const g = ctx.createLinearGradient(x, 0, x + pitch, 0);
      if (isA) {
        g.addColorStop(0, '#d5dce3');
        g.addColorStop(0.22, '#f5f8fa');
        g.addColorStop(0.52, '#f5f8fa');
        g.addColorStop(0.75, '#cad2da');
        g.addColorStop(1, '#d5dce3');
      } else {
        g.addColorStop(0, '#484848');
        g.addColorStop(0.22, '#cccccc');
        g.addColorStop(0.52, '#cccccc');
        g.addColorStop(0.75, '#484848');
        g.addColorStop(1, '#484848');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, pitch, SIZE);
    }
  });
  fbmNoise(actx, SIZE, 31, 0.08, 4, 4);
  fbmNoise(actx, SIZE, 32, 0.05, 16, 3, 'albedo', 2);
  // Toroidal gewrappte Lackabplatzer
  const r = rng(320);
  for (let i = 0; i < 18; i++) {
    const cx = r() * SIZE;
    const cy = r() * SIZE;
    const alpha = 0.14 + r() * 0.16;
    const rads = Array.from({ length: 7 }, () => 1.8 + r() * 4.2);
    actx.fillStyle = `rgba(115,122,130,${alpha})`;
    for (const ox of [-SIZE, 0, SIZE]) {
      for (const oy of [-SIZE, 0, SIZE]) {
        if (cx + ox + 8 < 0 || cx + ox - 8 > SIZE || cy + oy + 8 < 0 || cy + oy - 8 > SIZE) continue;
        actx.beginPath();
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          const rr = rads[k];
          const px = cx + ox + Math.cos(a) * rr;
          const py = cy + oy + Math.sin(a) * rr;
          if (k === 0) actx.moveTo(px, py);
          else actx.lineTo(px, py);
        }
        actx.closePath();
        actx.fill();
      }
    }
  }
  stains(actx, SIZE, 321, 5, 'rgba(120,76,48,0.06)', 110);
  scratches(actx, SIZE, 33, 38, 'rgba(255,255,255,0.14)', 36);
  grain(actx, SIZE, 34, 0.04, 0.012);
  fbmNoise(hctx, SIZE, 35, 0.08, 8, 3, 'height');
  return finish(albedo, height, 2.8, 3.6, 0.38, 0.88);
}

/** Warnmarkierung: industrielle Sicherheitsfläche mit dezenter Diagonal-Schraffur und toroidalem Abrieb. */
export function makeHazardSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#e3a224' : '#949494';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = isA ? '#242b33' : '#787878';
    const w = SIZE / 4;
    for (let i = -SIZE; i < SIZE * 2; i += w) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + w / 2, 0);
      ctx.lineTo(i + w / 2 - SIZE, SIZE);
      ctx.lineTo(i - SIZE, SIZE);
      ctx.closePath();
      ctx.fill();
    }
  });
  fbmNoise(actx, SIZE, 41, 0.1, 4, 4);
  stains(actx, SIZE, 42, 8, 'rgba(120,122,118,0.18)', 70);
  scratches(actx, SIZE, 43, 55, 'rgba(200,200,192,0.20)', 44);
  grain(actx, SIZE, 44, 0.06, 0.012);
  fbmNoise(hctx, SIZE, 45, 0.18, 16, 3, 'height');
  return finish(albedo, height, 1.5, 2.4, 0.48, 0.92);
}

/** Holzplanken: mehrfarbige Naturholz-Planken mit organischer Maserung und toroidal gewrappten Astlöchern. */
export function makeWoodSurface(): SurfaceTexture {
  const r = rng(51);
  const planks = 6;
  const ph = SIZE / planks;
  const plankTone = Array.from({ length: planks }, () => ({
    t: r(),
    warm: (r() - 0.5) * 14,
    jointX: Math.floor(64 + r() * (SIZE - 128)),
  }));
  const knots = Array.from({ length: 5 }, () => ({
    x: r() * SIZE,
    p: Math.floor(r() * planks),
    s: 3.5 + r() * 5.5,
  }));

  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    for (let p = 0; p < planks; p++) {
      const { t, warm, jointX } = plankTone[p];
      ctx.fillStyle = isA
        ? `rgb(${Math.round(232 - t * 24 + warm)},${Math.round(212 - t * 26)},${Math.round(184 - t * 28 - warm * 0.6)})`
        : `rgb(${Math.round(152 + t * 28)},${Math.round(152 + t * 28)},${Math.round(152 + t * 28)})`;
      ctx.fillRect(0, p * ph, SIZE, ph);
      // Periodisch kachelbare Maserung (Frequenz = ganzzahliges Vielfaches von 2π / SIZE)
      const gr = rng(60 + p);
      for (let k = 0; k < 28; k++) {
        const y = p * ph + gr() * ph;
        ctx.strokeStyle = isA
          ? `rgba(138,96,58,${0.05 + gr() * 0.10})`
          : `rgba(65,65,65,${0.18 + gr() * 0.25})`;
        ctx.lineWidth = 0.6 + gr() * 1.4;
        ctx.beginPath();
        for (let x = 0; x <= SIZE; x += 16) {
          const wave = Math.sin((x / SIZE) * Math.PI * 4 + k + p) * 2.0;
          if (x === 0) ctx.moveTo(x, y + wave);
          else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
      }
      // Horizontale Plankenfuge
      ctx.fillStyle = isA ? '#876d52' : '#181818';
      ctx.fillRect(0, p * ph, SIZE, 2.5);
      // Dezente Stoßfuge pro Planke
      ctx.fillRect(jointX, p * ph, 2, ph);
    }
    // Toroidal gewrappte dezente Astlöcher
    for (const k of knots) {
      const y = k.p * ph + ph * 0.5;
      for (const ox of [-SIZE, 0, SIZE]) {
        if (k.x + ox + k.s * 2 < 0 || k.x + ox - k.s * 2 > SIZE) continue;
        const g = ctx.createRadialGradient(k.x + ox, y, 0, k.x + ox, y, k.s * 1.6);
        g.addColorStop(0, isA ? 'rgba(115,76,44,0.48)' : 'rgba(55,55,55,0.85)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(k.x + ox, y, k.s * 1.6, k.s * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  fbmNoise(actx, SIZE, 52, 0.07, 4, 4);
  stains(actx, SIZE, 53, 4, 'rgba(95,72,50,0.06)', 120);
  grain(actx, SIZE, 54, 0.04, 0.015);
  return finish(albedo, height, 2.3, 3.6, 0.48, 0.90);
}

/** Gebürsteter Baustahl: großformatige Stahltafeln mit feinen Fasen und dezenten Eckverschraubungen. */
export function makeMetalSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#dfe5eb' : '#888888';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Leicht abgesetzte 2×2 Großtafeln
    const half = SIZE / 2;
    const panelDelta = [2, -3, -2, 3];
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const d = panelDelta[py * 2 + px];
        ctx.fillStyle = isA
          ? `rgb(${222 + d},${228 + d},${235 + d})`
          : `rgb(${136 + d * 2},${136 + d * 2},${136 + d * 2})`;
        ctx.fillRect(px * half, py * half, half, half);
      }
    }

    // Feine gebürstete Linien
    const rr = rng(72);
    for (let y = 0; y < SIZE; y += 1) {
      ctx.fillStyle = isA ? `rgba(255,255,255,${rr() * 0.08})` : 'rgba(128,128,128,0)';
      ctx.fillRect(0, y, SIZE, 1);
    }

    // Dezente Plattenfugen + flache Eck-Senkschrauben (kein dichter Nieten-Perlenkranz mehr)
    ctx.strokeStyle = isA ? '#b2beca' : '#323232';
    ctx.lineWidth = 2;
    for (const p of [0, half, SIZE]) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(SIZE, p);
      ctx.stroke();
    }
    ctx.fillStyle = isA ? '#9ca8b5' : '#646464';
    for (const bx of [0, half]) {
      for (const by of [0, half]) {
        for (const [cx, cy] of [
          [bx + 18, by + 18],
          [bx + half - 18, by + 18],
          [bx + 18, by + half - 18],
          [bx + half - 18, by + half - 18],
        ]) {
          ctx.beginPath();
          ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  fbmNoise(actx, SIZE, 73, 0.06, 4, 4);
  stains(actx, SIZE, 74, 4, 'rgba(105,92,78,0.06)', 100);
  scratches(actx, SIZE, 75, 70, 'rgba(255,255,255,0.14)', 45);
  scratches(actx, SIZE, 76, 30, 'rgba(70,78,88,0.12)', 32);
  grain(actx, SIZE, 77, 0.035, 0.01);
  return finish(albedo, height, 2.2, 4.0, 0.32, 0.82);
}

/**
 * Mehrfarbiges Ziegelmauerwerk: heller Kalk-/Sandmörtel (#d4ccc0) im Kontrast zu
 * individuell variierenden Terrakotta-, Ocker-, gebrannten Siena- und Klinker-Ziegeln.
 */
export function makeBrickSurface(): SurfaceTexture {
  const r = rng(81);
  const rows = 16;
  const cols = 6;
  const rowH = SIZE / rows;
  const colW = SIZE / cols;

  // Reichhaltige Farbpalette aus echten Ziegel-Farbtönen (Terrakotta, Siena, Ocker, Klinker)
  const palette: ReadonlyArray<[number, number, number]> = [
    [194, 98, 68],   // klassisches Terrakotta
    [178, 84, 58],   // gebranntes Siena
    [208, 118, 78],  // warmer Ocker-Ziegel
    [162, 74, 52],   // dunkler Klinker
    [200, 106, 74],  // heller Lehmziegel
    [186, 92, 64],   // Altstadt-Rotziegel
  ];

  interface BrickCell {
    x: number;
    y: number;
    w: number;
    h: number;
    rgb: [number, number, number];
    hVal: number;
  }
  const bricks: BrickCell[] = [];
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? colW / 2 : 0;
    for (let c = 0; c < cols; c++) {
      const base = palette[Math.floor(r() * palette.length)];
      const jitter = (r() - 0.5) * 18;
      const warmShift = (r() - 0.5) * 10;
      bricks.push({
        x: c * colW + off + 2.5,
        y: row * rowH + 2.5,
        w: colW - 5,
        h: rowH - 5,
        rgb: [
          Math.max(90, Math.min(240, Math.round(base[0] + jitter + warmShift))),
          Math.max(55, Math.min(210, Math.round(base[1] + jitter * 0.8))),
          Math.max(40, Math.min(185, Math.round(base[2] + jitter * 0.65 - warmShift * 0.4))),
        ],
        hVal: Math.round(176 + r() * 48),
      });
    }
  }

  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    // Kontrastreicher warmgrauer Kalkmörtel in der Albedo + tiefe Fuge in der Höhenkarte
    ctx.fillStyle = isA ? '#d4ccc0' : '#242424';
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (const b of bricks) {
      for (const ox of [-SIZE, 0, SIZE]) {
        const bx = b.x + ox;
        if (bx + b.w < 0 || bx > SIZE) continue;
        if (isA) {
          ctx.fillStyle = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`;
        } else {
          ctx.fillStyle = `rgb(${b.hVal},${b.hVal},${b.hVal})`;
        }
        ctx.fillRect(bx, b.y, b.w, b.h);
        if (isA) {
          ctx.fillStyle = 'rgba(255,244,230,0.16)';
          ctx.fillRect(bx + 1, b.y + 1, b.w - 2, 2);
          ctx.fillStyle = 'rgba(35,18,12,0.12)';
          ctx.fillRect(bx + 1, b.y + b.h - 2, b.w - 2, 2);
        }
      }
    }
  });
  fbmNoise(actx, SIZE, 82, 0.08, 6, 4);
  speckles(actx, SIZE, 8201, 260, ['rgba(236,226,212,0.32)', 'rgba(115,52,36,0.28)'], 0.6, 1.6);
  stains(actx, SIZE, 83, 5, 'rgba(95,82,70,0.04)', 120);
  grain(actx, SIZE, 84, 0.05, 0.018);
  fbmNoise(hctx, SIZE, 85, 0.16, 16, 3, 'height');
  return finish(albedo, height, 3.0, 4.6, 0.55, 0.96);
}

/** Naturstein-Quader (Sandstein / Kalkstein): mehrfarbige Werkstein-Blöcke mit vertieften Mörtelfugen. */
export function makeStoneSurface(): SurfaceTexture {
  const r = rng(91);
  const rows = 6;
  const rowH = SIZE / rows;

  const stonePalette: ReadonlyArray<[number, number, number]> = [
    [224, 208, 182], // warmer Sandstein
    [214, 194, 165], // Goldocker-Werkstein
    [228, 218, 202], // heller Kalkstein
    [204, 186, 160], // dunklerer Bruchstein
    [218, 204, 184], // beiger Quaderstein
  ];

  interface StoneBlock {
    x: number;
    y: number;
    w: number;
    h: number;
    rgb: [number, number, number];
    hVal: number;
  }
  const blocks: StoneBlock[] = [];
  for (let row = 0; row < rows; row++) {
    const numCols = 3 + (row % 2);
    const rawWeights = Array.from({ length: numCols }, () => 0.75 + r() * 0.5);
    const sumW = rawWeights.reduce((a, b) => a + b, 0);
    let x = row % 2 ? (SIZE / numCols) * 0.45 : 0;
    for (let c = 0; c < numCols; c++) {
      const w = (rawWeights[c] / sumW) * SIZE;
      const base = stonePalette[Math.floor(r() * stonePalette.length)];
      const jitter = (r() - 0.5) * 14;
      blocks.push({
        x: x + 2.5,
        y: row * rowH + 2.5,
        w: w - 5,
        h: rowH - 5,
        rgb: [
          Math.max(150, Math.min(246, Math.round(base[0] + jitter))),
          Math.max(140, Math.min(238, Math.round(base[1] + jitter * 0.9))),
          Math.max(120, Math.min(225, Math.round(base[2] + jitter * 0.8))),
        ],
        hVal: Math.round(180 + r() * 44),
      });
      x += w;
    }
  }

  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#aea393' : '#262626';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (const b of blocks) {
      for (const ox of [-SIZE, 0, SIZE]) {
        const bx = b.x + ox;
        if (bx + b.w < 0 || bx > SIZE) continue;
        ctx.fillStyle = isA
          ? `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`
          : `rgb(${b.hVal},${b.hVal},${b.hVal})`;
        ctx.fillRect(bx, b.y, b.w, b.h);
        if (isA) {
          ctx.fillStyle = 'rgba(255,250,240,0.18)';
          ctx.fillRect(bx + 2, b.y + 1, b.w - 4, 2);
          ctx.fillStyle = 'rgba(50,40,28,0.10)';
          ctx.fillRect(bx + 2, b.y + b.h - 3, b.w - 4, 2);
        }
      }
    }
  });
  fbmNoise(actx, SIZE, 92, 0.09, 6, 5);
  speckles(actx, SIZE, 9201, 260, ['rgba(248,242,230,0.35)', 'rgba(150,134,112,0.30)'], 0.7, 1.9);
  stains(actx, SIZE, 93, 5, 'rgba(115,102,84,0.04)', 130);
  grain(actx, SIZE, 94, 0.045, 0.016);
  fbmNoise(hctx, SIZE, 95, 0.22, 12, 4, 'height');
  return finish(albedo, height, 2.4, 5.0, 0.54, 0.95);
}

/** Massive Konstruktionsbalken: mehrtonige Balkenlagen und durchgehende Maserung ohne störende Eisenbänder. */
export function makeTimberSurface(): SurfaceTexture {
  const r = rng(100);
  const beams = 4;
  const bh = SIZE / beams;
  const beamTones = Array.from({ length: beams }, () => ({
    t: r(),
    warm: (r() - 0.5) * 16,
  }));

  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    for (let b = 0; b < beams; b++) {
      const { t, warm } = beamTones[b];
      ctx.fillStyle = isA
        ? `rgb(${Math.round(234 - t * 22 + warm)},${Math.round(212 - t * 24)},${Math.round(182 - t * 26 - warm * 0.5)})`
        : `rgb(${Math.round(156 + t * 26)},${Math.round(156 + t * 26)},${Math.round(156 + t * 26)})`;
      ctx.fillRect(0, b * bh, SIZE, bh);

      // Durchgehende, horizontal periodische Holzmaserung
      const gr = rng(101 + b);
      for (let k = 0; k < 26; k++) {
        const y = b * bh + gr() * bh;
        ctx.strokeStyle = isA
          ? `rgba(132,90,52,${0.05 + gr() * 0.11})`
          : `rgba(58,58,58,${0.18 + gr() * 0.28})`;
        ctx.lineWidth = 0.6 + gr() * 1.6;
        ctx.beginPath();
        for (let x = 0; x <= SIZE; x += 16) {
          const wave = Math.sin((x / SIZE) * Math.PI * 2 + k * 0.7 + b) * 2.5;
          if (x === 0) ctx.moveTo(x, y + wave);
          else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
      }
      // Balkenfuge
      ctx.fillStyle = isA ? '#826447' : '#1c1c1c';
      ctx.fillRect(0, b * bh, SIZE, 2.5);
    }

    // Feine, toroidal gewrappte Trockenrisse
    const cr = rng(105);
    for (let k = 0; k < 5; k++) {
      const y = cr() * SIZE;
      const x0 = cr() * SIZE;
      const len = 45 + cr() * 85;
      const dy = (cr() - 0.5) * 3;
      ctx.strokeStyle = isA ? 'rgba(86,58,34,0.38)' : '#282828';
      ctx.lineWidth = 1.1 + cr() * 0.9;
      for (const ox of [-SIZE, 0, SIZE]) {
        if (x0 + ox + len < 0 || x0 + ox > SIZE) continue;
        ctx.beginPath();
        ctx.moveTo(x0 + ox, y);
        ctx.lineTo(x0 + ox + len, y + dy);
        ctx.stroke();
      }
    }
  });
  fbmNoise(actx, SIZE, 102, 0.075, 4, 4);
  stains(actx, SIZE, 103, 4, 'rgba(98,64,36,0.05)', 120);
  grain(actx, SIZE, 104, 0.04, 0.015);
  return finish(albedo, height, 2.2, 4.5, 0.48, 0.90);
}

/** Mönch-Nonne-Dachziegel mit mehrfarbiger Terrakotta-Schattierung und Überlappung. */
export function makeTerracottaSurface(): SurfaceTexture {
  const r = rng(111);
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#e6d2c2' : '#404040';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const tileW = SIZE / 8;
    const tileH = SIZE / 4;
    for (let row = 0; row < 4; row++) {
      for (let c = 0; c < 8; c++) {
        const x = c * tileW;
        const y = row * tileH;
        const g = ctx.createLinearGradient(x, 0, x + tileW, 0);
        const t = r();
        const w = (r() - 0.5) * 14;
        if (isA) {
          g.addColorStop(0, `rgb(${Math.round(208 - t * 22 + w)},${Math.round(178 - t * 20)},${Math.round(160 - t * 20)})`);
          g.addColorStop(0.5, `rgb(${Math.round(248 - t * 16 + w)},${Math.round(230 - t * 18)},${Math.round(216 - t * 18)})`);
          g.addColorStop(1, `rgb(${Math.round(202 - t * 22 + w)},${Math.round(172 - t * 20)},${Math.round(154 - t * 20)})`);
        } else {
          g.addColorStop(0, '#606060');
          g.addColorStop(0.5, '#f0f0f0');
          g.addColorStop(1, '#606060');
        }
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, y, tileW - 2, tileH - 4);
        ctx.fillStyle = isA ? 'rgba(90,60,45,0.28)' : '#141414';
        ctx.fillRect(x, y + tileH - 4, tileW, 4);
      }
    }
  });
  fbmNoise(actx, SIZE, 112, 0.09, 6, 4);
  stains(actx, SIZE, 113, 5, 'rgba(90,96,68,0.06)', 90);
  grain(actx, SIZE, 114, 0.045, 0.015);
  return finish(albedo, height, 2.8, 3.8, 0.46, 0.90);
}

/**
 * Polarstation-Verbundpaneele: glatte High-Tech-Fassadenplatten mit feinen Fasen und Eckverschlüssen,
 * ohne sich wiederholende Lüftungsgitter-Stempel.
 */
export function makeArcticSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#edf3f8' : '#969696';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // 2×2 leicht versetzte Architektur-Verbundplatten mit subtiler Tonwert-Staffelung
    const half = SIZE / 2;
    const panelTones = [0, -4, 3, -2];
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const dt = panelTones[py * 2 + px];
        const x0 = px * half;
        const y0 = py * half;
        ctx.fillStyle = isA
          ? `rgb(${236 + dt},${242 + dt},${248 + dt})`
          : `rgb(${152 + dt * 2},${152 + dt * 2},${152 + dt * 2})`;
        ctx.fillRect(x0, y0, half, half);

        // Feine umlaufende Innenfase pro Verbundplatte
        ctx.strokeStyle = isA ? 'rgba(255,255,255,0.45)' : '#b8b8b8';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 4, y0 + 4, half - 8, half - 8);

        // Dezente Präzisions-Eckverschlüsse
        ctx.fillStyle = isA ? '#b6c4d2' : '#747474';
        for (const [cx, cy] of [
          [x0 + 14, y0 + 14],
          [x0 + half - 14, y0 + 14],
          [x0 + 14, y0 + half - 14],
          [x0 + half - 14, y0 + half - 14],
        ]) {
          ctx.beginPath();
          ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Saubere kachelbare Plattenfugen
    ctx.strokeStyle = isA ? '#c2cfd9' : '#343434';
    ctx.lineWidth = 2.5;
    for (const p of [0, half, SIZE]) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(SIZE, p);
      ctx.stroke();
    }
  });
  fbmNoise(actx, SIZE, 121, 0.045, 4, 4);
  stains(actx, SIZE, 122, 5, 'rgba(255,255,255,0.14)', 130);
  stains(actx, SIZE, 123, 4, 'rgba(110,130,148,0.045)', 130);
  scratches(actx, SIZE, 125, 24, 'rgba(255,255,255,0.12)', 40);
  grain(actx, SIZE, 124, 0.03, 0.01);
  return finish(albedo, height, 1.9, 5.0, 0.36, 0.84);
}

/** Kryo-Verglasung: nahtlos kachelbares Kristallglas ohne harten Außenrahmen, mit toroidalen Frostschlieren. */
export function makeIceGlassSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#def3ff' : '#909090';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Nahtlos periodische diagonale Lichtbrechungsbänder (cos(2π(x+y)/SIZE))
    for (let i = -SIZE; i < SIZE * 2; i += 128) {
      ctx.fillStyle = isA ? 'rgba(255,255,255,0.22)' : 'rgba(180,180,180,0.20)';
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 36, 0);
      ctx.lineTo(i + 36 + SIZE, SIZE);
      ctx.lineTo(i + SIZE, SIZE);
      ctx.closePath();
      ctx.fill();
    }
  });
  fbmNoise(actx, SIZE, 130, 0.1, 4, 4);
  fbmNoise(hctx, SIZE, 130, 0.22, 6, 4, 'height');
  // Toroidal gewrappte feine Eiskristall-Adern
  scratches(actx, SIZE, 131, 42, 'rgba(255,255,255,0.32)', 52);
  scratches(hctx, SIZE, 131, 42, 'rgba(235,235,235,0.45)', 52);
  stains(actx, SIZE, 133, 6, 'rgba(255,255,255,0.20)', 110);
  grain(actx, SIZE, 132, 0.025, 0.008);
  return finish(albedo, height, 1.1, 4.8, 0.14, 0.62);
}

/** Hafenwasser: organisches 2D-Wellen- & Kaustik-Interferenzmuster (frei von horizontalen Streifenlinien). */
export function makeWaterSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    const img = ctx.createImageData(SIZE, SIZE);
    const d = img.data;
    const tau = Math.PI * 2;
    for (let y = 0; y < SIZE; y++) {
      const ny = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const nx = x / SIZE;
        // 2D-Überlagerung mehrerer exakt periodischer Wellenrichtungen
        const w1 = Math.sin(tau * (nx * 3 + ny * 2));
        const w2 = Math.cos(tau * (nx * 2 - ny * 4) + 1.1);
        const w3 = Math.sin(tau * (nx * 5 + ny * 5) + 2.4);
        const w4 = Math.cos(tau * (nx * 7 - ny * 3) + 0.7);
        const wave = (w1 * 0.36 + w2 * 0.32 + w3 * 0.2 + w4 * 0.12) * 0.5 + 0.5; // 0..1
        const crest = Math.pow(wave, 2.2);
        const i = (y * SIZE + x) * 4;
        if (isA) {
          d[i] = Math.round(118 + wave * 68 + crest * 46);
          d[i + 1] = Math.round(186 + wave * 48 + crest * 20);
          d[i + 2] = Math.round(208 + wave * 34 + crest * 12);
          d[i + 3] = 255;
        } else {
          const hv = Math.round(60 + wave * 145 + crest * 45);
          d[i] = hv;
          d[i + 1] = hv;
          d[i + 2] = hv;
          d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  fbmNoise(actx, SIZE, 141, 0.14, 4, 4);
  fbmNoise(hctx, SIZE, 142, 0.32, 6, 4, 'height');
  return finish(albedo, height, 1.6, 8.0, 0.08, 0.48);
}

/** Zypressen- und Hecken-Laub: organische Nadel-/Blattstruktur statt künstlichem Beton. */
export function makeFoliageSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#345538' : '#707070';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const r = rng(151);
    const count = 380;
    for (let i = 0; i < count; i++) {
      const x = r() * SIZE;
      const y = r() * SIZE;
      const rad = 5 + r() * 11;
      const cVar = (r() - 0.5) * 36;
      ctx.fillStyle = isA
        ? `rgb(${Math.max(20, Math.min(80, 52 + cVar * 0.7))},${Math.max(50, Math.min(130, 92 + cVar))},${Math.max(25, Math.min(85, 58 + cVar * 0.8))})`
        : `rgb(${Math.max(40, Math.min(220, 110 + (r() - 0.5) * 80))},${Math.max(40, Math.min(220, 110 + (r() - 0.5) * 80))},${Math.max(40, Math.min(220, 110 + (r() - 0.5) * 80))})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();

      // Toroidales Wrapping für Kachelbarkeit
      for (const ox of [-SIZE, 0, SIZE]) {
        for (const oy of [-SIZE, 0, SIZE]) {
          if (ox === 0 && oy === 0) continue;
          if (x + ox >= -rad && x + ox <= SIZE + rad && y + oy >= -rad && y + oy <= SIZE + rad) {
            ctx.beginPath();
            ctx.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  });

  fbmNoise(actx, SIZE, 152, 0.16, 4, 4);
  fbmNoise(hctx, SIZE, 153, 0.38, 5, 4, 'height');
  grain(actx, SIZE, 154, 0.045, 0.015);
  return finish(albedo, height, 1.8, 3.2, 0.74, 0.98);
}

