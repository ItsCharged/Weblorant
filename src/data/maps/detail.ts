import type { Vec3 } from '../../core/types';
import type { BlockMaterial, MapBlock, MapDefinition, MapTheme } from './types';

/**
 * Rein visuelle Karten-Details (keine Kollision, keine Physik, kein Einfluss auf die Simulation).
 *
 * Aus der vorhandenen Block-Geometrie werden deterministisch abgeleitet:
 *  - Gebäude: Dächer (Giebel / Attika / Schneekappe), Fensterbänder, Dachaufbauten
 *  - Mauern: Abdeckungen + Leuchten
 *  - Container: Eckpfosten, Dachholme, Türstangen · Kisten: Spannbänder
 *  - Boden: Flickstellen, Pfützen, Schneewehen
 *  - Skyline außerhalb der Karte passend zum Thema (Kräne, Schiffe, Altstadt, Eisnadeln, Berge)
 *  - Bewegte Elemente: Kranlaufkatzen, Radarschüsseln, Windmühlen, Dachlüfter
 *
 * Wird nur vom Renderer benutzt (`MapBuilder`), nie von `src/game/` oder der Physik.
 */

export interface AnimatedProp {
  id: string;
  /** `spin` dreht um `axis`, `slide` pendelt entlang `axis` um den Pivot. */
  kind: 'spin' | 'slide';
  pivot: Vec3;
  axis: 'x' | 'y' | 'z';
  /** spin: rad/s · slide: Kreisfrequenz der Pendelbewegung */
  speed: number;
  /** slide: halbe Strecke in Metern */
  amplitude?: number;
  phase?: number;
  /** Blöcke relativ zum Pivot. */
  blocks: MapBlock[];
}

export interface MapDetail {
  blocks: MapBlock[];
  animated: AnimatedProp[];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function darken(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

interface ThemeStyle {
  roof: 'gable' | 'parapet' | 'snow';
  roofMat: BlockMaterial;
  roofColor: number;
  windowColor: number;
  capMat: BlockMaterial;
  capColor: number;
  lampA: { material: BlockMaterial; color: number };
  lampB: { material: BlockMaterial; color: number };
}

const STYLES: Record<MapTheme, ThemeStyle> = {
  dockyard: {
    roof: 'parapet',
    roofMat: 'concrete',
    roofColor: 0x5a6673,
    windowColor: 0x8fc4dd,
    capMat: 'metal',
    capColor: 0x45515f,
    lampA: { material: 'trim_orange', color: 0xff6b2b },
    lampB: { material: 'trim_teal', color: 0x18d4c9 },
  },
  range: {
    roof: 'gable',
    roofMat: 'terracotta',
    roofColor: 0xa85a3c,
    windowColor: 0xcfe3ee,
    capMat: 'terracotta',
    capColor: 0xa85a3c,
    lampA: { material: 'trim_orange', color: 0xffb060 },
    lampB: { material: 'trim_teal', color: 0x18d4c9 },
  },
  oldtown: {
    roof: 'gable',
    roofMat: 'terracotta',
    roofColor: 0xc8643b,
    windowColor: 0xf2d9a6,
    capMat: 'terracotta',
    capColor: 0xc8643b,
    lampA: { material: 'trim_orange', color: 0xffc47a },
    lampB: { material: 'trim_orange', color: 0xffc47a },
  },
  arctic: {
    roof: 'snow',
    roofMat: 'concrete',
    roofColor: 0xf4f9ff,
    windowColor: 0xbfefff,
    capMat: 'metal',
    capColor: 0x8fa3b5,
    lampA: { material: 'trim_teal', color: 0x18d4c9 },
    lampB: { material: 'trim_teal', color: 0x18d4c9 },
  },
};

const WALL_MATERIALS: ReadonlySet<BlockMaterial> = new Set<BlockMaterial>([
  'wall_light',
  'concrete',
  'brick_warm',
  'stone_sand',
  'arctic_panel',
]);

const ROOF_PITCH = 0.5;

export function buildMapDetail(map: MapDefinition): MapDetail {
  const theme: MapTheme = map.theme ?? 'dockyard';
  const style = STYLES[theme];
  const rand = makeRng(hashString(map.id));
  const blocks: MapBlock[] = [];
  const animated: AnimatedProp[] = [];
  let n = 0;
  const nextId = (tag: string): string => `dt_${tag}_${n++}`;

  const push = (
    tag: string,
    pos: Vec3,
    size: Vec3,
    material: BlockMaterial,
    color: number,
    rot?: { x?: number; y?: number; z?: number },
  ): void => {
    blocks.push({
      id: nextId(tag),
      pos,
      size,
      material,
      color,
      rotX: rot?.x,
      rotY: rot?.y,
      rotZ: rot?.z,
      collider: false,
    });
  };

  /** Kind-Block im lokalen Koordinatensystem eines (ggf. um Y gedrehten) Eltern-Blocks. */
  const child = (
    parent: MapBlock,
    tag: string,
    dx: number,
    dy: number,
    dz: number,
    size: Vec3,
    material: BlockMaterial,
    color: number,
  ): void => {
    const ry = parent.rotY ?? 0;
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    push(
      tag,
      {
        x: parent.pos.x + dx * cos + dz * sin,
        y: parent.pos.y + dy,
        z: parent.pos.z - dx * sin + dz * cos,
      },
      size,
      material,
      color,
      ry !== 0 ? { y: ry } : undefined,
    );
  };

  /** Satteldach aus zwei geneigten Platten + Füllkörper. */
  const gableRoof = (
    cx: number,
    baseY: number,
    cz: number,
    w: number,
    d: number,
    material: BlockMaterial,
    color: number,
    fillColor: number,
    fillMat: BlockMaterial,
  ): void => {
    const alongZ = d >= w;
    const half = (alongZ ? w : d) / 2;
    const len = (alongZ ? d : w) + 0.9;
    const rise = half * Math.tan(ROOF_PITCH);
    const slope = half / Math.cos(ROOF_PITCH) + 0.5;
    const lateral = half / 2 + 0.25 * Math.cos(ROOF_PITCH);
    const y = baseY + rise / 2 - 0.25 * Math.sin(ROOF_PITCH) + 0.12;
    for (const side of [1, -1] as const) {
      if (alongZ) {
        push('roof', { x: cx + side * lateral, y, z: cz }, { x: slope, y: 0.3, z: len }, material, color, {
          z: -side * ROOF_PITCH,
        });
      } else {
        push('roof', { x: cx, y, z: cz + side * lateral }, { x: len, y: 0.3, z: slope }, material, color, {
          x: side * ROOF_PITCH,
        });
      }
    }
    const fillH = rise * 0.55;
    push(
      'attic',
      { x: cx, y: baseY + fillH / 2, z: cz },
      alongZ ? { x: w * 0.5, y: fillH, z: d } : { x: w, y: fillH, z: d * 0.5 },
      fillMat,
      fillColor,
    );
  };

  // =========================================================================
  // 1. Details an vorhandenen Blöcken
  // =========================================================================
  for (const b of map.blocks) {
    if (b.rotX || b.rotZ) continue;
    const top = b.pos.y + b.size.y / 2;
    const bottom = b.pos.y - b.size.y / 2;
    const minXZ = Math.min(b.size.x, b.size.z);
    const maxXZ = Math.max(b.size.x, b.size.z);
    const solid = b.collider !== false;

    // --- Portalkran-Ausleger: pendelnde Laufkatze mit Last ---
    if (!solid && b.material === 'metal' && b.size.y <= 1.2 && b.size.x >= 20 && b.size.z >= 10 && b.pos.y >= 7) {
      const under = bottom;
      animated.push({
        id: nextId('trolley'),
        kind: 'slide',
        pivot: { x: b.pos.x, y: under, z: b.pos.z },
        axis: 'x',
        speed: 0.22 + rand() * 0.1,
        amplitude: b.size.x / 2 - 3.5,
        phase: rand() * 6.28,
        blocks: [
          { id: nextId('tr'), pos: { x: 0, y: -0.3, z: 0 }, size: { x: 2.4, y: 0.6, z: 2.4 }, material: 'hazard', color: 0xd48b28, collider: false },
          { id: nextId('tr'), pos: { x: 0, y: -1.0, z: 0 }, size: { x: 0.1, y: 0.8, z: 0.1 }, material: 'metal', color: 0x2c343d, collider: false },
          { id: nextId('tr'), pos: { x: 0, y: -2.2, z: 0 }, size: { x: 1.8, y: 1.6, z: 3.2 }, material: rand() > 0.5 ? 'container_orange' : 'container_teal', color: rand() > 0.5 ? 0xd9652b : 0x2c6f7a, collider: false },
        ],
      });
      continue;
    }

    if (!solid) continue;

    const wallLike = WALL_MATERIALS.has(b.material);

    // --- Gebäude ---
    if (wallLike && b.size.y >= 4.5 && minXZ >= 6 && bottom <= 0.2) {
      const hw = b.size.x / 2;
      const hd = b.size.z / 2;

      // Fensterband auf allen vier Seiten
      if (b.size.y >= 5) {
        const wy = b.size.y / 2 - 1.9;
        const faces: { len: number; place: (t: number) => [number, number]; size: Vec3 }[] = [
          { len: b.size.x, place: (t) => [t, hd + 0.03], size: { x: 1.4, y: 1.3, z: 0.08 } },
          { len: b.size.x, place: (t) => [t, -hd - 0.03], size: { x: 1.4, y: 1.3, z: 0.08 } },
          { len: b.size.z, place: (t) => [hw + 0.03, t], size: { x: 0.08, y: 1.3, z: 1.4 } },
          { len: b.size.z, place: (t) => [-hw - 0.03, t], size: { x: 0.08, y: 1.3, z: 1.4 } },
        ];
        for (const f of faces) {
          const count = Math.floor((f.len - 2) / 3.4);
          if (count < 1) continue;
          const span = (count - 1) * 3.4;
          for (let i = 0; i < count; i++) {
            const [dx, dz] = f.place(-span / 2 + i * 3.4);
            child(b, 'win', dx, wy, dz, f.size, 'ice_glass', style.windowColor);
            // Fensterbank
            child(
              b,
              'sill',
              dx,
              wy - 0.72,
              dz,
              { x: f.size.x > 1 ? 1.6 : 0.2, y: 0.1, z: f.size.z > 1 ? 1.6 : 0.2 },
              style.capMat,
              style.capColor,
            );
          }
        }
      }

      if (style.roof === 'gable' && !b.rotY) {
        gableRoof(b.pos.x, top + 0.36, b.pos.z, b.size.x, b.size.z, style.roofMat, style.roofColor, darken(b.color, 0.92), b.material);
        // Schornstein
        child(b, 'chimney', hw * 0.45, b.size.y / 2 + 1.6, -hd * 0.3, { x: 0.9, y: 2.6, z: 0.9 }, 'brick_warm', 0x9c4f38);
      } else {
        // Attika rundum
        const pc = style.roof === 'snow' ? darken(b.color, 0.86) : style.roofColor;
        const pm = style.roof === 'snow' ? b.material : style.roofMat;
        child(b, 'par', 0, b.size.y / 2 + 0.2, hd - 0.15, { x: b.size.x, y: 0.4, z: 0.3 }, pm, pc);
        child(b, 'par', 0, b.size.y / 2 + 0.2, -hd + 0.15, { x: b.size.x, y: 0.4, z: 0.3 }, pm, pc);
        child(b, 'par', hw - 0.15, b.size.y / 2 + 0.2, 0, { x: 0.3, y: 0.4, z: b.size.z - 0.6 }, pm, pc);
        child(b, 'par', -hw + 0.15, b.size.y / 2 + 0.2, 0, { x: 0.3, y: 0.4, z: b.size.z - 0.6 }, pm, pc);

        // Leuchtband knapp unter der Dachkante
        const lamp = rand() > 0.5 ? style.lampA : style.lampB;
        const by = b.size.y / 2 - 0.7;
        child(b, 'band', 0, by, hd + 0.03, { x: b.size.x, y: 0.1, z: 0.06 }, lamp.material, lamp.color);
        child(b, 'band', 0, by, -hd - 0.03, { x: b.size.x, y: 0.1, z: 0.06 }, lamp.material, lamp.color);
        child(b, 'band', hw + 0.03, by, 0, { x: 0.06, y: 0.1, z: b.size.z }, lamp.material, lamp.color);
        child(b, 'band', -hw - 0.03, by, 0, { x: 0.06, y: 0.1, z: b.size.z }, lamp.material, lamp.color);

        if (style.roof === 'snow') {
          child(b, 'snow', 0, b.size.y / 2 + 0.52, 0, { x: b.size.x - 0.8, y: 0.25, z: b.size.z - 0.8 }, 'concrete', style.roofColor);
          child(b, 'mast', -hw * 0.5, b.size.y / 2 + 2.6, hd * 0.4, { x: 0.14, y: 4.4, z: 0.14 }, 'metal', 0x4b5868);
          if (minXZ >= 8) {
            // drehende Radarschüssel
            const ry = b.rotY ?? 0;
            const lx = hw * 0.35;
            const lz = -hd * 0.35;
            animated.push({
              id: nextId('radar'),
              kind: 'spin',
              pivot: {
                x: b.pos.x + lx * Math.cos(ry) + lz * Math.sin(ry),
                y: top + 0.65,
                z: b.pos.z - lx * Math.sin(ry) + lz * Math.cos(ry),
              },
              axis: 'y',
              speed: 0.9,
              phase: rand() * 6.28,
              blocks: [
                { id: nextId('rd'), pos: { x: 0, y: 0.7, z: 0 }, size: { x: 0.3, y: 1.4, z: 0.3 }, material: 'metal', color: 0x4b5868, collider: false },
                { id: nextId('rd'), pos: { x: 0, y: 1.9, z: 0.2 }, size: { x: 2.6, y: 1.3, z: 0.14 }, material: 'arctic_panel', color: 0xe6eff8, collider: false, rotX: -0.25 },
                { id: nextId('rd'), pos: { x: 0, y: 1.9, z: -0.25 }, size: { x: 0.16, y: 0.16, z: 0.8 }, material: 'trim_teal', color: 0x18d4c9, collider: false },
              ],
            });
          }
        } else {
          // Klimageräte + drehender Dachlüfter
          child(b, 'ac', hw * 0.4, b.size.y / 2 + 0.55, hd * 0.35, { x: 1.8, y: 1.1, z: 1.3 }, 'metal', 0x8a96a3);
          child(b, 'ac', -hw * 0.45, b.size.y / 2 + 0.45, -hd * 0.2, { x: 1.2, y: 0.9, z: 2.2 }, 'metal', 0x7c8794);
          child(b, 'duct', 0, b.size.y / 2 + 0.25, hd * 0.35, { x: hw * 0.8, y: 0.3, z: 0.4 }, 'metal', 0x9aa6b2);
          const ry = b.rotY ?? 0;
          const lx = -hw * 0.1;
          const lz = -hd * 0.5;
          animated.push({
            id: nextId('fan'),
            kind: 'spin',
            pivot: {
              x: b.pos.x + lx * Math.cos(ry) + lz * Math.sin(ry),
              y: top + 0.1,
              z: b.pos.z - lx * Math.sin(ry) + lz * Math.cos(ry),
            },
            axis: 'y',
            speed: 3.2,
            phase: rand() * 6.28,
            blocks: [
              { id: nextId('fn'), pos: { x: 0, y: 0.45, z: 0 }, size: { x: 0.5, y: 0.9, z: 0.5 }, material: 'metal', color: 0x5a6673, collider: false },
              { id: nextId('fn'), pos: { x: 0, y: 0.95, z: 0 }, size: { x: 2.2, y: 0.06, z: 0.3 }, material: 'metal', color: 0xcfd6de, collider: false },
              { id: nextId('fn'), pos: { x: 0, y: 0.95, z: 0 }, size: { x: 0.3, y: 0.06, z: 2.2 }, material: 'metal', color: 0xcfd6de, collider: false },
            ],
          });
        }
      }
      continue;
    }

    // --- Lange Mauern: Abdeckung + Leuchten ---
    if (wallLike && b.size.y >= 4 && minXZ < 3 && maxXZ >= 10 && bottom <= 0.2) {
      const alongX = b.size.x >= b.size.z;
      child(
        b,
        'cap',
        0,
        b.size.y / 2 + 0.11,
        0,
        alongX ? { x: b.size.x + 0.1, y: 0.22, z: b.size.z + 0.36 } : { x: b.size.x + 0.36, y: 0.22, z: b.size.z + 0.1 },
        style.capMat,
        style.capColor,
      );
      const count = Math.max(1, Math.floor(maxXZ / 10));
      const ly = Math.min(b.size.y / 2 - 0.8, 4.2 - b.pos.y);
      for (let i = 0; i < count; i++) {
        const t = -maxXZ / 2 + ((i + 0.5) * maxXZ) / count;
        const lamp = i % 2 === 0 ? style.lampA : style.lampB;
        for (const side of [1, -1]) {
          const off = side * (minXZ / 2 + 0.1);
          if (alongX) {
            child(b, 'lamp', t, ly, off, { x: 0.7, y: 0.16, z: 0.2 }, lamp.material, lamp.color);
          } else {
            child(b, 'lamp', off, ly, t, { x: 0.2, y: 0.16, z: 0.7 }, lamp.material, lamp.color);
          }
        }
      }
      continue;
    }

    // --- Frachtcontainer: Eckpfosten, Dachholme, Türstangen ---
    if (b.material.startsWith('container_') && b.size.y >= 2.4 && b.size.y <= 3.2 && maxXZ >= 4.5) {
      const hw = b.size.x / 2;
      const hd = b.size.z / 2;
      const frame = darken(b.color, 0.62);
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) {
          child(b, 'post', sx * (hw - 0.05), 0.02, sz * (hd - 0.05), { x: 0.18, y: b.size.y + 0.06, z: 0.18 }, b.material, frame);
        }
      }
      const alongZ = b.size.z >= b.size.x;
      for (const s of [1, -1]) {
        if (alongZ) {
          child(b, 'rail', s * (hw - 0.05), b.size.y / 2 + 0.03, 0, { x: 0.14, y: 0.1, z: b.size.z }, b.material, frame);
        } else {
          child(b, 'rail', 0, b.size.y / 2 + 0.03, s * (hd - 0.05), { x: b.size.x, y: 0.1, z: 0.14 }, b.material, frame);
        }
      }
      // Türverriegelung an einer Stirnseite
      const short = alongZ ? b.size.x : b.size.z;
      for (const f of [-0.3, -0.1, 0.1, 0.3]) {
        if (alongZ) {
          child(b, 'rod', f * short, 0, hd + 0.04, { x: 0.05, y: b.size.y - 0.3, z: 0.05 }, 'metal', 0xcfd6de);
        } else {
          child(b, 'rod', hw + 0.04, 0, f * short, { x: 0.05, y: b.size.y - 0.3, z: 0.05 }, 'metal', 0xcfd6de);
        }
      }
      continue;
    }

    // --- Holzkisten: Spannbänder ---
    if ((b.material === 'wood' || b.material === 'timber_beam') && maxXZ <= 3 && b.size.y <= 2.6) {
      for (const f of [-0.25, 0.25]) {
        child(b, 'strap', 0, f * b.size.y, 0, { x: b.size.x + 0.05, y: 0.09, z: b.size.z + 0.05 }, 'metal', 0x3d4650);
      }
    }
  }

  // =========================================================================
  // 2. Boden-Variation (nicht in Zonen, nicht auf der Mittelachse)
  // =========================================================================
  if (theme !== 'range') {
    const hx = map.bounds.width / 2 - 6;
    const hz = map.bounds.depth / 2 - 6;
    const inZone = (x: number, z: number, r: number): boolean =>
      map.zones.some(
        (zn) =>
          Math.abs(x - zn.center.x) < zn.size.x / 2 + r + 1.5 &&
          Math.abs(z - zn.center.z) < zn.size.z / 2 + r + 1.5,
      );
    for (let i = 0; i < 44; i++) {
      const x = (rand() * 2 - 1) * hx;
      const z = (rand() * 2 - 1) * hz;
      const sx = 2.5 + rand() * 5.5;
      const sz = 2 + rand() * 4.5;
      const roll = rand();
      const ry = rand() * Math.PI;
      if (Math.abs(x) < 6 + sx / 2 || inZone(x, z, Math.max(sx, sz) / 2)) continue;
      let material: BlockMaterial;
      let color: number;
      if (theme === 'arctic') {
        material = roll < 0.7 ? 'concrete' : 'ice_glass';
        color = roll < 0.7 ? 0xf7fbff : 0xcdeeff;
      } else if (theme === 'oldtown') {
        material = roll < 0.75 ? 'stone_sand' : 'water_dock';
        color = roll < 0.75 ? 0xb3a385 : 0x4a7f8c;
      } else {
        material = roll < 0.7 ? 'asphalt' : 'water_dock';
        color = roll < 0.7 ? 0x2c333b : 0x2f5d6e;
      }
      const puddle = material === 'water_dock' || material === 'ice_glass';
      push(
        'ground',
        { x, y: 0.015, z },
        { x: puddle ? sx * 0.6 : sx, y: 0.03, z: puddle ? sz * 0.6 : sz },
        material,
        color,
        { y: ry },
      );
    }
  }

  // =========================================================================
  // 3. Skyline außerhalb der Karte (steht auf verdecktem Sockel, damit sie über die Mauer ragt)
  // =========================================================================
  const halfW = map.bounds.width / 2;
  const halfD = map.bounds.depth / 2;
  const PER_SIDE = 7;
  const containerColors = [0xd9652b, 0x2c6f7a, 0x3b4e61, 0xb9443a, 0xd8b23a, 0x5b7fa6];
  const houseColors = [0xd9c7a8, 0xcbb592, 0xe2d3b7, 0xb86a4c, 0xc98a62, 0xd6b98f];

  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < PER_SIDE; k++) {
      const horizontal = side < 2; // Nord/Süd-Seite: Objekte reihen sich entlang x
      const span = (horizontal ? halfW : halfD) * 2 + 30;
      const along = -span / 2 + ((k + 0.25 + rand() * 0.5) * span) / PER_SIDE;
      const dist = (horizontal ? halfD : halfW) + 18 + rand() * 30;
      const sign = side % 2 === 0 ? -1 : 1;
      const x = horizontal ? along : sign * dist;
      const z = horizontal ? sign * dist : along;
      const base = 6 + rand() * 8;
      const roll = rand();
      // Blickrichtung zur Karte: Achse, auf der das Objekt „zur Karte zeigt“
      const faceAxis: 'x' | 'z' = horizontal ? 'z' : 'x';
      const inward = -sign;

      if (theme === 'dockyard') {
        if (roll < 0.38) {
          // Containerstapel
          const levels = 3 + Math.floor(rand() * 4);
          const rotY = rand() > 0.5 ? 0 : Math.PI / 2;
          for (let l = 0; l < levels; l++) {
            push(
              'stack',
              { x: x + (rand() - 0.5) * 1.2, y: base + l * 2.7 + 1.35, z: z + (rand() - 0.5) * 1.2 },
              { x: 2.6 * (1 + Math.floor(rand() * 2)), y: 2.7, z: 12.2 },
              (['container_orange', 'container_teal', 'container_slate'] as const)[Math.floor(rand() * 3)],
              containerColors[Math.floor(rand() * containerColors.length)],
              { y: rotY },
            );
          }
        } else if (roll < 0.62) {
          // Lagerhalle
          const w = 18 + rand() * 12;
          const h = 10 + rand() * 6;
          const d = 12 + rand() * 8;
          push('hall', { x, y: base + h / 2, z }, { x: w, y: h, z: d }, 'wall_light', 0xb9c3ce);
          push('hall', { x, y: base + h + 0.4, z }, { x: w + 0.8, y: 0.8, z: d + 0.8 }, 'metal', 0x45515f);
          push('hall', { x, y: base + h - 1.4, z: z + (faceAxis === 'z' ? (inward * d) / 2 : 0) }, faceAxis === 'z' ? { x: w, y: 0.3, z: 0.2 } : { x: w + 0.2, y: 0.3, z: d + 0.2 }, 'trim_orange', 0xff6b2b);
        } else if (roll < 0.86) {
          // Containerbrücke mit pendelnder Laufkatze
          const h = 24 + rand() * 8;
          const beamAxis: 'x' | 'z' = faceAxis;
          const legOff = 7;
          for (const s of [1, -1]) {
            push(
              'crane',
              horizontal ? { x: x + s * legOff, y: base + h / 2, z } : { x, y: base + h / 2, z: z + s * legOff },
              { x: 1.8, y: h, z: 1.8 },
              'metal',
              0xd9652b,
            );
          }
          push(
            'crane',
            { x: horizontal ? x : x + inward * 8, y: base + h + 0.7, z: horizontal ? z + inward * 8 : z },
            beamAxis === 'z' ? { x: 3, y: 1.4, z: 34 } : { x: 34, y: 1.4, z: 3 },
            'metal',
            0x45515f,
          );
          push('crane', { x, y: base + h - 2.2, z }, horizontal ? { x: 16, y: 1, z: 1.4 } : { x: 1.4, y: 1, z: 16 }, 'metal', 0xd9652b);
          animated.push({
            id: nextId('farTrolley'),
            kind: 'slide',
            pivot: { x: horizontal ? x : x + inward * 8, y: base + h, z: horizontal ? z + inward * 8 : z },
            axis: beamAxis,
            speed: 0.18 + rand() * 0.12,
            amplitude: 12,
            phase: rand() * 6.28,
            blocks: [
              { id: nextId('ft'), pos: { x: 0, y: -0.5, z: 0 }, size: { x: 3, y: 1, z: 3 }, material: 'hazard', color: 0xd48b28, collider: false },
              { id: nextId('ft'), pos: { x: 0, y: -3.5, z: 0 }, size: { x: 0.14, y: 5, z: 0.14 }, material: 'metal', color: 0x2c343d, collider: false },
              {
                id: nextId('ft'),
                pos: { x: 0, y: -7.3, z: 0 },
                size: beamAxis === 'z' ? { x: 12.2, y: 2.7, z: 2.6 } : { x: 2.6, y: 2.7, z: 12.2 },
                material: 'container_teal',
                color: containerColors[Math.floor(rand() * containerColors.length)],
                collider: false,
              },
            ],
          });
        } else {
          // Frachtschiff, längs zur Kartenkante
          const hull = horizontal ? { x: 46, y: 9, z: 11 } : { x: 11, y: 9, z: 46 };
          push('ship', { x, y: base + 2, z }, hull, 'container_slate', 0x27303b);
          push('ship', { x: horizontal ? x - 14 : x, y: base + 11, z: horizontal ? z : z - 14 }, { x: 9, y: 9, z: 9 }, 'wall_light', 0xe8edf2);
          push('ship', { x: horizontal ? x - 14 : x, y: base + 17.5, z: horizontal ? z : z - 14 }, { x: 3, y: 4, z: 3 }, 'container_orange', 0xd9652b);
          for (let c = 0; c < 3; c++) {
            push(
              'ship',
              { x: horizontal ? x + 2 + c * 6.5 : x, y: base + 7.9 + (c % 2) * 1.3, z: horizontal ? z : z + 2 + c * 6.5 },
              horizontal ? { x: 6, y: 2.7 + (c % 2) * 2.7, z: 9 } : { x: 9, y: 2.7 + (c % 2) * 2.7, z: 6 },
              'container_orange',
              containerColors[Math.floor(rand() * containerColors.length)],
            );
          }
        }
      } else if (theme === 'arctic') {
        if (roll < 0.5) {
          // Eisnadeln
          const spikes = 2 + Math.floor(rand() * 3);
          for (let s = 0; s < spikes; s++) {
            const h = 18 + rand() * 26;
            const w = 3 + rand() * 5;
            push(
              'spike',
              { x: x + (rand() - 0.5) * 12, y: base + h / 2 - 4, z: z + (rand() - 0.5) * 12 },
              { x: w, y: h, z: w * (0.6 + rand() * 0.6) },
              'ice_glass',
              rand() > 0.5 ? 0x9fdcf2 : 0xc8efff,
              { y: rand() * Math.PI, z: (rand() - 0.5) * 0.5, x: (rand() - 0.5) * 0.3 },
            );
          }
        } else if (roll < 0.75) {
          // Forschungsstation mit Radar
          push('station', { x, y: base + 5, z }, { x: 16, y: 10, z: 11 }, 'arctic_panel', 0xdce6f0);
          push('station', { x, y: base + 10.3, z }, { x: 16.6, y: 0.5, z: 11.6 }, 'concrete', 0xf4f9ff);
          push('station', { x, y: base + 8, z }, { x: 16.1, y: 0.25, z: 11.1 }, 'trim_teal', 0x18d4c9);
          animated.push({
            id: nextId('farRadar'),
            kind: 'spin',
            pivot: { x: x + 3, y: base + 10.5, z },
            axis: 'y',
            speed: 0.6 + rand() * 0.4,
            phase: rand() * 6.28,
            blocks: [
              { id: nextId('fr'), pos: { x: 0, y: 2, z: 0 }, size: { x: 0.6, y: 4, z: 0.6 }, material: 'metal', color: 0x4b5868, collider: false },
              { id: nextId('fr'), pos: { x: 0, y: 5.4, z: 0.4 }, size: { x: 7, y: 3.6, z: 0.3 }, material: 'arctic_panel', color: 0xe6eff8, collider: false, rotX: -0.25 },
            ],
          });
        } else {
          // Funkmast mit Leuchtspitze
          const h = 30 + rand() * 14;
          push('mast', { x, y: base + h / 2, z }, { x: 0.9, y: h, z: 0.9 }, 'metal', 0x4b5868);
          push('mast', { x, y: base + h * 0.6, z }, { x: 5, y: 0.3, z: 0.3 }, 'metal', 0x4b5868);
          push('mast', { x, y: base + h + 0.4, z }, { x: 1.2, y: 0.8, z: 1.2 }, 'trim_teal', 0x18d4c9);
        }
      } else {
        // oldtown / range
        if (roll < 0.58) {
          const w = 9 + rand() * 7;
          const h = 9 + rand() * 9;
          const d = 9 + rand() * 5;
          const col = houseColors[Math.floor(rand() * houseColors.length)];
          const mat: BlockMaterial = rand() > 0.5 ? 'stone_sand' : 'brick_warm';
          push('house', { x, y: base + h / 2, z }, { x: w, y: h, z: d }, mat, col);
          gableRoof(x, base + h, z, w, d, 'terracotta', style.roofColor, darken(col, 0.9), mat);
        } else if (roll < 0.72) {
          // Glockenturm
          const h = 26 + rand() * 10;
          push('tower', { x, y: base + h / 2, z }, { x: 5.2, y: h, z: 5.2 }, 'brick_warm', 0xb65c42);
          push('tower', { x, y: base + h + 0.6, z }, { x: 6.6, y: 1.2, z: 6.6 }, 'terracotta', style.roofColor);
          push('tower', { x, y: base + h + 3.2, z }, { x: 3.2, y: 4.4, z: 3.2 }, 'terracotta', style.roofColor, { y: Math.PI / 4 });
        } else if (roll < 0.9) {
          // Zypressen-Gruppe
          const trees = 2 + Math.floor(rand() * 3);
          for (let t = 0; t < trees; t++) {
            const h = 14 + rand() * 10;
            const tx = x + (rand() - 0.5) * 9;
            const tz = z + (rand() - 0.5) * 9;
            const green = rand() > 0.5 ? 0x3f6b45 : 0x355c3d;
            push('tree', { x: tx, y: base + h / 2, z: tz }, { x: 2.2, y: h, z: 2.2 }, 'concrete', green);
            push('tree', { x: tx, y: base + h / 2 - 0.6, z: tz }, { x: 2.2, y: h - 1.2, z: 2.2 }, 'concrete', green, { y: Math.PI / 4 });
          }
        } else {
          // Windmühle – Flügel drehen sich zur Karte hin
          const h = 20 + rand() * 6;
          push('mill', { x, y: base + h / 2, z }, { x: 5, y: h, z: 5 }, 'stone_sand', 0xd9c7a8);
          push('mill', { x, y: base + h + 1.2, z }, { x: 5.8, y: 2.4, z: 5.8 }, 'terracotta', style.roofColor, { y: Math.PI / 4 });
          const off = inward * 3.2;
          animated.push({
            id: nextId('millBlades'),
            kind: 'spin',
            pivot: { x: faceAxis === 'x' ? x + off : x, y: base + h - 1, z: faceAxis === 'z' ? z + off : z },
            axis: faceAxis,
            speed: 0.7 + rand() * 0.3,
            phase: rand() * 6.28,
            blocks:
              faceAxis === 'z'
                ? [
                    { id: nextId('mb'), pos: { x: 0, y: 0, z: 0 }, size: { x: 18, y: 1.4, z: 0.2 }, material: 'timber_beam', color: 0x8b623c, collider: false },
                    { id: nextId('mb'), pos: { x: 0, y: 0, z: 0 }, size: { x: 1.4, y: 18, z: 0.2 }, material: 'timber_beam', color: 0x8b623c, collider: false },
                  ]
                : [
                    { id: nextId('mb'), pos: { x: 0, y: 0, z: 0 }, size: { x: 0.2, y: 1.4, z: 18 }, material: 'timber_beam', color: 0x8b623c, collider: false },
                    { id: nextId('mb'), pos: { x: 0, y: 0, z: 0 }, size: { x: 0.2, y: 18, z: 1.4 }, material: 'timber_beam', color: 0x8b623c, collider: false },
                  ],
          });
        }
      }
    }
  }

  // --- Ferner Hintergrund-Ring: Hochhäuser / Hügel / Berge ---
  const FAR_COUNT = 18;
  for (let i = 0; i < FAR_COUNT; i++) {
    const ang = ((i + rand() * 0.7) / FAR_COUNT) * Math.PI * 2;
    const r = Math.max(halfW, halfD) + 85 + rand() * 45;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (theme === 'dockyard') {
      const h = 45 + rand() * 55;
      const w = 12 + rand() * 12;
      push('city', { x, y: h / 2, z }, { x: w, y: h, z: w * (0.7 + rand() * 0.5) }, 'wall_light', rand() > 0.5 ? 0x9fb0c2 : 0x8799ac, { y: rand() * Math.PI });
    } else {
      // Würfel auf der Spitze -> Gipfel-Silhouette
      const s = theme === 'arctic' ? 60 + rand() * 50 : 46 + rand() * 30;
      const color =
        theme === 'arctic' ? (rand() > 0.4 ? 0xeef5fb : 0xcfdde9) : rand() > 0.5 ? 0x7f9a6a : 0x8fa878;
      push('peak', { x, y: theme === 'arctic' ? s * 0.18 : -s * 0.12, z }, { x: s, y: s, z: s }, 'concrete', color, {
        x: 0.6155,
        z: Math.PI / 4,
        y: rand() * Math.PI,
      });
    }
  }

  return { blocks, animated };
}
