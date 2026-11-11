import * as THREE from 'three';

/**
 * Prozedurale, hochauflösende Oberflächen-Texturen (Albedo + Normal-Map) für Map-Blöcke.
 *
 * Alles wird deterministisch per Canvas 2D erzeugt (keine externen Bilddateien).
 * Jede Oberfläche liefert:
 *  - `map`        : sRGB-Albedo, hell gehalten, damit `block.color` sauber einfärbt
 *  - `normalMap`  : aus einer Höhenkarte per Sobel-Filter abgeleitet (Fugen, Rillen, Maserung)
 *  - `tileMeters` : wie viele Meter eine Kachel in der Welt abdeckt (für Welt-UVs)
 */
export interface SurfaceTexture {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
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

function makeCanvas(size = SIZE): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
}

/** Kachelbares Wert-Rauschen (mehrere Oktaven) direkt in ImageData gemischt. */
function fbmNoise(
  ctx: Ctx,
  size: number,
  seed: number,
  amount: number,
  baseCells = 8,
  octaves = 4,
  mode: 'albedo' | 'height' = 'albedo',
): void {
  const rand = rng(seed);
  const grids: { cells: number; values: Float32Array }[] = [];
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const values = new Float32Array(cells * cells);
    for (let i = 0; i < values.length; i++) values[i] = rand();
    grids.push({ cells, values });
  }

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      let amp = 0.5;
      let norm = 0;
      for (const g of grids) {
        const fx = (x / size) * g.cells;
        const fy = (y / size) * g.cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const c = g.cells;
        const v00 = g.values[(y0 % c) * c + (x0 % c)];
        const v10 = g.values[(y0 % c) * c + ((x0 + 1) % c)];
        const v01 = g.values[((y0 + 1) % c) * c + (x0 % c)];
        const v11 = g.values[((y0 + 1) % c) * c + ((x0 + 1) % c)];
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

/** Feine Körnung pro Pixel. */
function grain(ctx: Ctx, size: number, seed: number, amount: number): void {
  const rand = rng(seed);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (rand() - 0.5) * amount * 255;
    d[i] = Math.max(0, Math.min(255, d[i] + g));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g));
  }
  ctx.putImageData(img, 0, 0);
}

/** Weiche Schmutz-/Wasserflecken. */
function stains(ctx: Ctx, size: number, seed: number, count: number, color: string, maxR: number): void {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = maxR * (0.3 + rand() * 0.7);
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

/** Kratzer / Haarrisse. */
function scratches(ctx: Ctx, size: number, seed: number, count: number, color: string, maxLen: number): void {
  const rand = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const ang = rand() * Math.PI * 2;
    const len = maxLen * (0.2 + rand() * 0.8);
    ctx.lineWidth = 0.6 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const mx = x + Math.cos(ang) * len * 0.5 + (rand() - 0.5) * 6;
    const my = y + Math.sin(ang) * len * 0.5 + (rand() - 0.5) * 6;
    ctx.quadraticCurveTo(mx, my, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
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

function finish(
  albedo: HTMLCanvasElement,
  height: HTMLCanvasElement,
  normalStrength: number,
  tileMeters: number,
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

  return { map, normalMap, tileMeters };
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

/** Industrieboden: große gegossene Platten mit Fugen, Abrieb und Ölflecken. */
export function makeFloorSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    ctx.fillStyle = pass === 'albedo' ? '#dfe3e6' : '#9a9a9a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // 2×2 Platten pro Kachel mit Dehnungsfugen
    ctx.strokeStyle = pass === 'albedo' ? '#aab2ba' : '#3a3a3a';
    ctx.lineWidth = 5;
    for (const p of [0, SIZE / 2, SIZE]) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(SIZE, p);
      ctx.stroke();
    }
  });
  fbmNoise(actx, SIZE, 11, 0.12, 4, 5);
  stains(actx, SIZE, 12, 7, 'rgba(70,74,80,0.10)', 120);
  stains(actx, SIZE, 13, 3, 'rgba(40,36,30,0.14)', 50);
  scratches(actx, SIZE, 14, 60, 'rgba(255,255,255,0.18)', 60);
  grain(actx, SIZE, 15, 0.06);
  fbmNoise(hctx, SIZE, 16, 0.25, 8, 4, 'height');
  return finish(albedo, height, 2.4, 4);
}

/** Sichtbeton: Schalungsfugen, Ankerlöcher, Lunker, leichte Ausblühungen. */
export function makeConcreteSurface(): SurfaceTexture {
  const rand = rng(21);
  const pores: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 260; i++) pores.push({ x: rand() * SIZE, y: rand() * SIZE, r: 0.8 + rand() * 2.4 });

  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    ctx.fillStyle = pass === 'albedo' ? '#e6e9ec' : '#a0a0a0';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Schalungsfugen
    ctx.strokeStyle = pass === 'albedo' ? '#c3cad1' : '#505050';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, SIZE - 3, SIZE / 2 - 3);
    ctx.strokeRect(1.5, SIZE / 2 + 1.5, SIZE - 3, SIZE / 2 - 3);
    // Ankerlöcher
    for (const y of [64, 192, 320, 448]) {
      for (const x of [64, 448]) {
        ctx.fillStyle = pass === 'albedo' ? '#a7b0b9' : '#2a2a2a';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pass === 'albedo' ? '#8d969f' : '#151515';
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Lunker
    ctx.fillStyle = pass === 'albedo' ? 'rgba(150,158,166,0.75)' : '#4a4a4a';
    for (const p of pores) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  fbmNoise(actx, SIZE, 22, 0.14, 3, 5);
  stains(actx, SIZE, 23, 6, 'rgba(90,96,104,0.09)', 140);
  // vertikale Regenläufer
  const r2 = rng(24);
  for (let i = 0; i < 14; i++) {
    const x = r2() * SIZE;
    const g = actx.createLinearGradient(0, 0, 0, SIZE * (0.3 + r2() * 0.5));
    g.addColorStop(0, 'rgba(80,86,92,0.10)');
    g.addColorStop(1, 'rgba(80,86,92,0)');
    actx.fillStyle = g;
    actx.fillRect(x, 0, 3 + r2() * 8, SIZE);
  }
  grain(actx, SIZE, 25, 0.07);
  fbmNoise(hctx, SIZE, 26, 0.3, 16, 3, 'height');
  return finish(albedo, height, 2.0, 3);
}

/** Wellblech-Container: Sicken, Rahmen, Lackabplatzer, Rostläufer. */
export function makeContainerSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#eef1f4' : '#808080';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Trapez-Sicken
    const pitch = 32;
    for (let x = 0; x < SIZE; x += pitch) {
      const g = ctx.createLinearGradient(x, 0, x + pitch, 0);
      if (isA) {
        g.addColorStop(0, '#d4dbe2');
        g.addColorStop(0.2, '#f7f9fb');
        g.addColorStop(0.5, '#f7f9fb');
        g.addColorStop(0.7, '#c9d1d9');
        g.addColorStop(1, '#d4dbe2');
      } else {
        g.addColorStop(0, '#404040');
        g.addColorStop(0.2, '#d0d0d0');
        g.addColorStop(0.5, '#d0d0d0');
        g.addColorStop(0.7, '#404040');
        g.addColorStop(1, '#404040');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, pitch, SIZE);
    }
    // Rahmenprofil oben/unten
    ctx.fillStyle = isA ? '#c1c9d1' : '#e0e0e0';
    ctx.fillRect(0, 0, SIZE, 18);
    ctx.fillRect(0, SIZE - 18, SIZE, 18);
    ctx.fillStyle = isA ? '#a9b2bc' : '#202020';
    ctx.fillRect(0, 18, SIZE, 3);
    ctx.fillRect(0, SIZE - 21, SIZE, 3);
  });
  fbmNoise(actx, SIZE, 31, 0.1, 4, 4);
  // Rostläufer von oben
  const r = rng(32);
  for (let i = 0; i < 10; i++) {
    const x = r() * SIZE;
    const len = 60 + r() * 220;
    const g = actx.createLinearGradient(0, 18, 0, 18 + len);
    g.addColorStop(0, 'rgba(120,70,40,0.28)');
    g.addColorStop(1, 'rgba(120,70,40,0)');
    actx.fillStyle = g;
    actx.fillRect(x, 18, 2 + r() * 5, len);
  }
  // Lackabplatzer
  for (let i = 0; i < 26; i++) {
    actx.fillStyle = `rgba(110,118,126,${0.25 + r() * 0.3})`;
    actx.beginPath();
    const cx = r() * SIZE;
    const cy = r() * SIZE;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const rr = 2 + r() * 6;
      actx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    actx.closePath();
    actx.fill();
  }
  scratches(actx, SIZE, 33, 50, 'rgba(255,255,255,0.22)', 40);
  grain(actx, SIZE, 34, 0.05);
  fbmNoise(hctx, SIZE, 35, 0.08, 8, 3, 'height');
  return finish(albedo, height, 3.2, 2.6);
}

/** Warnmarkierung: schräge Streifen mit abgetretener Farbe. */
export function makeHazardSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#f2ad22' : '#909090';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = isA ? '#1b2026' : '#888888';
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
  fbmNoise(actx, SIZE, 41, 0.12, 4, 4);
  // abgetretene Stellen
  stains(actx, SIZE, 42, 14, 'rgba(150,150,140,0.35)', 50);
  scratches(actx, SIZE, 43, 90, 'rgba(180,180,170,0.35)', 50);
  grain(actx, SIZE, 44, 0.08);
  fbmNoise(hctx, SIZE, 45, 0.2, 16, 3, 'height');
  return finish(albedo, height, 1.6, 1.5);
}

/** Holzplanken: Maserung, Astlöcher, Nagelreihen, Fugen. */
export function makeWoodSurface(): SurfaceTexture {
  const r = rng(51);
  const planks = 6;
  const ph = SIZE / planks;
  const plankTone = Array.from({ length: planks }, () => r());
  const knots = Array.from({ length: 8 }, () => ({ x: r() * SIZE, p: Math.floor(r() * planks), s: 4 + r() * 8 }));

  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    for (let p = 0; p < planks; p++) {
      const t = plankTone[p];
      ctx.fillStyle = isA
        ? `rgb(${230 - t * 22},${214 - t * 24},${188 - t * 26})`
        : `rgb(${150 + t * 30},${150 + t * 30},${150 + t * 30})`;
      ctx.fillRect(0, p * ph, SIZE, ph);
      // Maserung
      const gr = rng(60 + p);
      for (let k = 0; k < 26; k++) {
        const y = p * ph + gr() * ph;
        ctx.strokeStyle = isA ? `rgba(150,110,70,${0.06 + gr() * 0.12})` : `rgba(60,60,60,${0.2 + gr() * 0.3})`;
        ctx.lineWidth = 0.6 + gr() * 1.6;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= SIZE; x += 32) {
          ctx.lineTo(x, y + Math.sin(x * 0.012 + k + p) * 2.2 + (gr() - 0.5) * 1.2);
        }
        ctx.stroke();
      }
      // Fuge
      ctx.fillStyle = isA ? '#7d6448' : '#101010';
      ctx.fillRect(0, p * ph, SIZE, 3);
      // Nägel
      ctx.fillStyle = isA ? '#5e6266' : '#e0e0e0';
      for (const x of [20, SIZE / 2, SIZE - 20]) {
        ctx.beginPath();
        ctx.arc(x, p * ph + 12, 2.5, 0, Math.PI * 2);
        ctx.arc(x, p * ph + ph - 10, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const k of knots) {
      const y = k.p * ph + ph / 2;
      const g = ctx.createRadialGradient(k.x, y, 0, k.x, y, k.s);
      g.addColorStop(0, isA ? 'rgba(110,70,40,0.75)' : 'rgba(40,40,40,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(k.x, y, k.s * 1.8, k.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  fbmNoise(actx, SIZE, 52, 0.08, 4, 4);
  stains(actx, SIZE, 53, 5, 'rgba(90,70,50,0.10)', 120);
  grain(actx, SIZE, 54, 0.05);
  return finish(albedo, height, 2.6, 2.4);
}

/** Gebürstetes Stahlblech mit Riffelung, Schweißnähten und Nieten. */
export function makeMetalSurface(): SurfaceTexture {
  const r = rng(71);
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#dfe5eb' : '#808080';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // gebürstete Linien
    const rr = rng(72);
    for (let y = 0; y < SIZE; y += 1) {
      ctx.fillStyle = isA ? `rgba(255,255,255,${rr() * 0.12})` : `rgba(128,128,128,0)`;
      ctx.fillRect(0, y, SIZE, 1);
    }
    // Plattenteilung 2×2 mit Nieten
    ctx.strokeStyle = isA ? '#a7b3bf' : '#202020';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, SIZE / 2 - 3, SIZE / 2 - 3);
    ctx.strokeRect(SIZE / 2 + 1.5, 1.5, SIZE / 2 - 3, SIZE / 2 - 3);
    ctx.strokeRect(1.5, SIZE / 2 + 1.5, SIZE / 2 - 3, SIZE / 2 - 3);
    ctx.strokeRect(SIZE / 2 + 1.5, SIZE / 2 + 1.5, SIZE / 2 - 3, SIZE / 2 - 3);
    for (const bx of [0, SIZE / 2]) {
      for (const by of [0, SIZE / 2]) {
        for (let k = 16; k < SIZE / 2; k += 40) {
          for (const [x, y] of [
            [bx + k, by + 12],
            [bx + k, by + SIZE / 2 - 12],
            [bx + 12, by + k],
            [bx + SIZE / 2 - 12, by + k],
          ]) {
            const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
            g.addColorStop(0, isA ? '#ffffff' : '#ffffff');
            g.addColorStop(1, isA ? '#9aa6b2' : '#909090');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, 3.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  });
  fbmNoise(actx, SIZE, 73, 0.07, 4, 4);
  stains(actx, SIZE, 74, 5, 'rgba(110,90,70,0.10)', 90);
  scratches(actx, SIZE, 75, 120, 'rgba(255,255,255,0.25)', 50);
  scratches(actx, SIZE, 76, 40, 'rgba(60,66,74,0.18)', 30);
  grain(actx, SIZE, 77, 0.04);
  void r;
  return finish(albedo, height, 3.0, 2);
}

/** Warmer Ziegel mit unregelmäßigen Steinen, tiefen Mörtelfugen und Abplatzern. */
export function makeBrickSurface(): SurfaceTexture {
  const r = rng(81);
  const rows = 10;
  const cols = 4;
  const rowH = SIZE / rows;
  const colW = SIZE / cols;
  const bricks: { x: number; y: number; w: number; h: number; t: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? colW / 2 : 0;
    for (let c = -1; c <= cols; c++) {
      bricks.push({ x: c * colW + off + 3, y: row * rowH + 3, w: colW - 6, h: rowH - 6, t: r() });
    }
  }
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#c9c0b5' : '#202020';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (const b of bricks) {
      if (isA) {
        const v = 236 - b.t * 34;
        ctx.fillStyle = `rgb(${v},${v - 10 - b.t * 10},${v - 22 - b.t * 14})`;
      } else {
        const v = 170 + b.t * 50;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
      }
      // leicht abgerundete Steine
      const rad = 3;
      ctx.beginPath();
      ctx.moveTo(b.x + rad, b.y);
      ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, rad);
      ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, rad);
      ctx.arcTo(b.x, b.y + b.h, b.x, b.y, rad);
      ctx.arcTo(b.x, b.y, b.x + b.w, b.y, rad);
      ctx.fill();
      if (isA) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(b.x + 2, b.y + 1, b.w - 4, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(b.x + 2, b.y + b.h - 3, b.w - 4, 2);
      }
    }
  });
  fbmNoise(actx, SIZE, 82, 0.14, 8, 4);
  stains(actx, SIZE, 83, 8, 'rgba(110,100,90,0.12)', 100);
  grain(actx, SIZE, 84, 0.08);
  fbmNoise(hctx, SIZE, 85, 0.22, 32, 2, 'height');
  return finish(albedo, height, 3.4, 2.2);
}

/** Sandstein-Quader in Läuferverband mit Kantenbruch. */
export function makeStoneSurface(): SurfaceTexture {
  const r = rng(91);
  const rows = 4;
  const rowH = SIZE / rows;
  const blocks: { x: number; y: number; w: number; h: number; t: number }[] = [];
  for (let row = 0; row < rows; row++) {
    let x = row % 2 ? -SIZE * 0.25 : 0;
    while (x < SIZE) {
      const w = SIZE * (0.3 + r() * 0.25);
      blocks.push({ x: x + 3, y: row * rowH + 3, w: w - 6, h: rowH - 6, t: r() });
      x += w;
    }
  }
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#bfb4a4' : '#282828';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (const b of blocks) {
      const draw = (ox: number) => {
        if (isA) {
          const v = 244 - b.t * 26;
          ctx.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
        } else {
          ctx.fillStyle = `rgb(${180 + b.t * 40},${180 + b.t * 40},${180 + b.t * 40})`;
        }
        ctx.fillRect(b.x + ox, b.y, b.w, b.h);
      };
      draw(0);
      if (b.x + b.w > SIZE) draw(-SIZE);
      if (b.x < 0) draw(SIZE);
    }
  });
  fbmNoise(actx, SIZE, 92, 0.16, 6, 5);
  stains(actx, SIZE, 93, 7, 'rgba(120,110,90,0.10)', 120);
  grain(actx, SIZE, 94, 0.07);
  fbmNoise(hctx, SIZE, 95, 0.35, 12, 4, 'height');
  return finish(albedo, height, 2.6, 3);
}

/** Massive Balken: lange Maserung, Risse, Eisenbeschläge mit Bolzen. */
export function makeTimberSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#ecdcc4' : '#a0a0a0';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const gr = rng(101);
    for (let k = 0; k < 90; k++) {
      const y = gr() * SIZE;
      ctx.strokeStyle = isA ? `rgba(140,100,60,${0.05 + gr() * 0.14})` : `rgba(50,50,50,${0.2 + gr() * 0.4})`;
      ctx.lineWidth = 0.5 + gr() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= SIZE; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.008 + k) * 3);
      ctx.stroke();
    }
    // Trockenrisse
    for (let k = 0; k < 6; k++) {
      const y = gr() * SIZE;
      const x0 = gr() * SIZE;
      ctx.strokeStyle = isA ? 'rgba(80,55,30,0.55)' : '#000';
      ctx.lineWidth = 1.5 + gr() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 40 + gr() * 120, y + (gr() - 0.5) * 4);
      ctx.stroke();
    }
    // Beschlagbänder
    for (const x of [0, SIZE / 2]) {
      ctx.fillStyle = isA ? '#6d757d' : '#e8e8e8';
      ctx.fillRect(x + 6, 0, 22, SIZE);
      ctx.fillStyle = isA ? '#4c5359' : '#ffffff';
      for (let y = 32; y < SIZE; y += 64) {
        ctx.beginPath();
        ctx.arc(x + 17, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  fbmNoise(actx, SIZE, 102, 0.1, 4, 4);
  stains(actx, SIZE, 103, 4, 'rgba(100,60,30,0.10)', 120);
  grain(actx, SIZE, 104, 0.05);
  return finish(albedo, height, 2.4, 2.4);
}

/** Mönch-Nonne-Dachziegel mit Überlappung. */
export function makeTerracottaSurface(): SurfaceTexture {
  const r = rng(111);
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#e9d8cb' : '#404040';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const tileW = SIZE / 8;
    const tileH = SIZE / 4;
    for (let row = 0; row < 4; row++) {
      for (let c = 0; c < 8; c++) {
        const x = c * tileW;
        const y = row * tileH;
        const g = ctx.createLinearGradient(x, 0, x + tileW, 0);
        const t = r();
        if (isA) {
          g.addColorStop(0, `rgb(${210 - t * 20},${185 - t * 20},${170 - t * 20})`);
          g.addColorStop(0.5, `rgb(${250 - t * 16},${238 - t * 18},${228 - t * 18})`);
          g.addColorStop(1, `rgb(${205 - t * 20},${180 - t * 20},${165 - t * 20})`);
        } else {
          g.addColorStop(0, '#606060');
          g.addColorStop(0.5, '#f0f0f0');
          g.addColorStop(1, '#606060');
        }
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, y, tileW - 2, tileH - 4);
        // Schattenkante der Überlappung
        ctx.fillStyle = isA ? 'rgba(90,60,45,0.35)' : '#101010';
        ctx.fillRect(x, y + tileH - 5, tileW, 5);
      }
    }
  });
  fbmNoise(actx, SIZE, 112, 0.12, 6, 4);
  stains(actx, SIZE, 113, 8, 'rgba(80,90,60,0.12)', 80); // Moos
  grain(actx, SIZE, 114, 0.06);
  return finish(albedo, height, 3.2, 2.4);
}

/** Polarstation-Paneele: Sandwichplatten mit Dichtfugen, Lüftungsschlitzen, Nieten, Frost. */
export function makeArcticSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#eef3f8' : '#909090';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = isA ? '#b3c1ce' : '#202020';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, SIZE / 2 - 6, SIZE - 6);
    ctx.strokeRect(SIZE / 2 + 3, 3, SIZE / 2 - 6, SIZE - 6);
    // Versteifungssicken
    for (const x of [0, SIZE / 2]) {
      ctx.fillStyle = isA ? '#dfe7ef' : '#d0d0d0';
      ctx.fillRect(x + 20, SIZE * 0.47, SIZE / 2 - 40, 26);
      ctx.fillStyle = isA ? '#c6d2dd' : '#505050';
      ctx.fillRect(x + 20, SIZE * 0.47 + 26, SIZE / 2 - 40, 3);
      // Lüftungsschlitze
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = isA ? '#8796a5' : '#101010';
        ctx.fillRect(x + 40, 60 + k * 14, SIZE / 2 - 80, 6);
      }
      // Nieten
      ctx.fillStyle = isA ? '#8fa0b1' : '#ffffff';
      for (const y of [18, SIZE - 18]) {
        for (const xx of [x + 18, x + SIZE / 2 - 18]) {
          ctx.beginPath();
          ctx.arc(xx, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  fbmNoise(actx, SIZE, 121, 0.06, 4, 4);
  stains(actx, SIZE, 122, 10, 'rgba(255,255,255,0.35)', 110); // Frost
  stains(actx, SIZE, 123, 4, 'rgba(90,110,130,0.08)', 120);
  grain(actx, SIZE, 124, 0.04);
  return finish(albedo, height, 2.6, 3);
}

/** Kryo-Verglasung: Verlauf, Frostschlieren, Eisblumen am Rand. */
export function makeIceGlassSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    if (isA) {
      const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
      g.addColorStop(0, '#d9f2ff');
      g.addColorStop(0.5, '#f4fbff');
      g.addColorStop(1, '#bfe4f7');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#909090';
    }
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = isA ? '#8fc2dc' : '#ffffff';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, SIZE - 14, SIZE - 14);
  });
  // Lichtschlieren
  actx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = -SIZE; i < SIZE; i += 150) {
    actx.beginPath();
    actx.moveTo(i, 0);
    actx.lineTo(i + 40, 0);
    actx.lineTo(i + 40 + SIZE, SIZE);
    actx.lineTo(i + SIZE, SIZE);
    actx.closePath();
    actx.fill();
  }
  // Eisblumen: verästelte Linien vom Rand
  const r = rng(131);
  const branch = (ctx: Ctx, x: number, y: number, ang: number, len: number, depth: number): void => {
    if (depth <= 0 || len < 3) return;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = depth * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    branch(ctx, x2, y2, ang - 0.6 + r() * 0.2, len * 0.62, depth - 1);
    branch(ctx, x2, y2, ang + 0.6 - r() * 0.2, len * 0.62, depth - 1);
  };
  actx.strokeStyle = 'rgba(255,255,255,0.55)';
  hctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 14; i++) {
    const edge = Math.floor(r() * 4);
    const t = r() * SIZE;
    const [x, y, a] =
      edge === 0 ? [t, 14, Math.PI / 2] : edge === 1 ? [t, SIZE - 14, -Math.PI / 2] : edge === 2 ? [14, t, 0] : [SIZE - 14, t, Math.PI];
    const len = 20 + r() * 40;
    branch(actx, x, y, a + (r() - 0.5), len, 5);
    branch(hctx, x, y, a + (r() - 0.5), len, 5);
  }
  grain(actx, SIZE, 132, 0.03);
  return finish(albedo, height, 1.2, 3);
}

/** Hafenwasser: Wellenmuster mit Schaumkronen und Tiefenvariation. */
export function makeWaterSurface(): SurfaceTexture {
  const { albedo, height, actx, hctx } = dual((ctx, pass) => {
    const isA = pass === 'albedo';
    ctx.fillStyle = isA ? '#9fd9ec' : '#808080';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let row = 0; row < 16; row++) {
      const baseY = row * (SIZE / 16) + 16;
      ctx.strokeStyle = isA ? (row % 2 === 0 ? 'rgba(235,250,255,0.75)' : 'rgba(100,180,205,0.7)') : row % 2 === 0 ? '#e0e0e0' : '#303030';
      ctx.lineWidth = 3 + (row % 3);
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x += 8) {
        const phase = (x / SIZE) * Math.PI * 6 + row * 1.3;
        const y = baseY + Math.sin(phase) * 6 + Math.sin(phase * 2.3) * 2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  fbmNoise(actx, SIZE, 141, 0.18, 4, 4);
  fbmNoise(hctx, SIZE, 142, 0.4, 4, 4, 'height');
  return finish(albedo, height, 1.8, 6);
}
