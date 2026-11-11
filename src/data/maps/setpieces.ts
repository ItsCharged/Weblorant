import type { BlockMaterial, MapBlock } from './types';

/**
 * Gemeinsame Gameplay-Bausteine für die drei Taktik-Karten (identisches Grundlayout):
 *
 *  1. Kisten-Treppen an beiden Kern-Zonen: schneller Aufstieg von der Zone auf die
 *     erhöhte Plattform (zwei Sprünge à ~0,8 m statt Umweg über die Rampe).
 *  2. Scharfschützen-Podeste am Südende der beiden Außenbahnen (A-Lang / B-Lang)
 *     mit Brüstung – erhöhter Blick die lange Bahn hinunter.
 *  3. Fahrzeug-Deckung direkt hinter den Spawn-Barrieren beider Teams, damit der
 *     erste Schritt aus dem Spawn nicht ungedeckt ist.
 *
 * Alle Blöcke haben Kollision. Positionen sind so gewählt, dass Laufwege (≥ 3 m),
 * Kern-Zonen, Spawn-Zonen und die Mittelachse x = 0 frei bleiben.
 */

export interface Surface {
  material: BlockMaterial;
  color: number;
}

export interface SetPieceOptions {
  prefix: string;
  /** Westkante (x) und Oberkante (y) der erhöhten Plattform an Kern-Zone A. */
  siteADeck: { westX: number; topY: number };
  /** Westkante (x) und Oberkante (y) der erhöhten Plattform an Kern-Zone B. */
  siteBDeck: { westX: number; topY: number };
  /** Innenkante (x) der östlichen Außenmauer – begrenzt das B-Lang-Podest. */
  eastWallInnerX: number;
  crate: Surface;
  crateAlt: Surface;
  platform: Surface;
  parapet: Surface;
  vehicleBody: Surface;
  vehicleCab: Surface;
}

function box(
  id: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  s: Surface,
  label?: string,
): MapBlock {
  return {
    id,
    pos: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 },
    size: { x: x1 - x0, y: y1 - y0, z: z1 - z0 },
    color: s.color,
    material: s.material,
    label,
  };
}

export function makeSharedSetPieces(o: SetPieceOptions): MapBlock[] {
  const p = o.prefix;
  const out: MapBlock[] = [];

  // --- 1. Kisten-Treppen auf die Plattformen (Zone liegt jeweils westlich der Plattform) ---
  // `along: 'x'` reiht die Stufen von Westen an die Plattform; `'z'` legt beide Stufen
  // direkt an die Plattformkante (untere Stufe südlich), wenn westlich kein Platz ist.
  const stairs = (
    tag: string,
    deck: { westX: number; topY: number },
    zc: number,
    along: 'x' | 'z',
  ): void => {
    const h1 = deck.topY / 3;
    const h2 = (deck.topY * 2) / 3;
    const hx0 = deck.westX - 1.25;
    const hx1 = deck.westX - 0.05;
    out.push(
      along === 'x'
        ? box(`${p}_${tag}_stair_low`, hx0 - 1.2, hx0, 0, h1, zc - 0.6, zc + 0.6, o.crate, 'Kistentreppe unten')
        : box(`${p}_${tag}_stair_low`, hx0, hx1, 0, h1, zc + 0.6, zc + 1.8, o.crate, 'Kistentreppe unten'),
      box(`${p}_${tag}_stair_high`, hx0, hx1, 0, h2, zc - 0.6, zc + 0.6, o.crateAlt, 'Kistentreppe oben'),
    );
  };
  stairs('site_a', o.siteADeck, -17.5, 'x');
  // Kern-Zone B reicht bis dicht an die Plattform -> Stufen entlang der Kante, außerhalb der Zone
  stairs('site_b', o.siteBDeck, -5.8, 'z');
  // --- 2. Scharfschützen-Podeste am Südende der Außenbahnen ---
  const perch = (tag: string, x0: number, x1: number, stepX0: number, stepX1: number): void => {
    out.push(
      box(`${p}_${tag}_perch`, x0, x1, 0, 1.4, 29.0, 34.5, o.platform, 'Ausguck-Podest'),
      box(`${p}_${tag}_perch_step`, stepX0, stepX1, 0, 0.7, 31.0, 33.5, o.crate, 'Ausguck-Stufe'),
      box(`${p}_${tag}_perch_parapet`, x0, x1, 1.4, 2.3, 29.0, 29.4, o.parapet, 'Ausguck-Brüstung'),
    );
  };
  perch('alang', -58.4, -54.0, -54.0, -52.6);
  const eastX1 = Math.min(55.9, o.eastWallInnerX - 0.2);
  perch('blang', eastX1 - 4.2, eastX1, eastX1 - 5.6, eastX1 - 4.2);

  // --- 3. Fahrzeug-Deckung hinter den Spawn-Barrieren (z = ±35,5) ---
  const vehicle = (tag: string, xc: number, zc: number, cabSide: 1 | -1): void => {
    out.push(
      box(`${p}_${tag}_vehicle_body`, xc - 2.1, xc + 2.1, 0, 1.3, zc - 1.0, zc + 1.0, o.vehicleBody, 'Transporter'),
      box(
        `${p}_${tag}_vehicle_cab`,
        xc + cabSide * 0.9,
        xc + cabSide * 2.1,
        1.3,
        2.05,
        zc - 0.95,
        zc + 0.95,
        o.vehicleCab,
        'Transporter-Kabine',
      ),
    );
  };
  vehicle('spawn_s', -9.5, 38.0, 1);
  vehicle('spawn_n', 9.5, -38.0, 1);

  return out;
}
