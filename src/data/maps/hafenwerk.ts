import type { Vec3 } from '../../core/types';
import type {
  DummySpawnDef,
  MapBlock,
  MapCallout,
  MapDefinition,
  MapZone,
  SpawnBarrierDef,
} from './types';
import { makeSharedSetPieces } from './setpieces';

/**
 * Computes a cuboid block rotated around X so its top walking surface
 * connects (x, yNorth, zNorth) to (x, ySouth, zSouth) seamlessly (zNorth < zSouth).
 */
function makeRampZ(
  id: string,
  x: number,
  width: number,
  zNorth: number,
  yNorth: number,
  zSouth: number,
  ySouth: number,
  thickness: number,
  color: number,
  material: MapBlock['material'],
  label?: string,
): MapBlock {
  const dz = zSouth - zNorth;
  const dy = yNorth - ySouth;
  const length = Math.hypot(dz, dy);
  const rotX = Math.atan2(dy, dz);
  const midY = (yNorth + ySouth) * 0.5;
  const midZ = (zNorth + zSouth) * 0.5;
  const pos: Vec3 = {
    x,
    y: midY - thickness * 0.5 * Math.cos(rotX),
    z: midZ - thickness * 0.5 * Math.sin(rotX),
  };
  return {
    id,
    pos,
    size: { x: width, y: thickness, z: length },
    rotX,
    color,
    material,
    collider: true,
    label,
  };
}

const HAFENWERK_BLOCKS: MapBlock[] = [
  // =========================================================================
  // BASE FLOOR (128 x 128 m, top surface at exact y = 0) & PERIMETER WALLS (h = 8)
  // =========================================================================
  {
    id: 'hw_floor_main',
    pos: { x: 0, y: -0.5, z: 0 },
    size: { x: 128, y: 1.0, z: 128 },
    color: 0x3b434d,
    material: 'asphalt',
    label: 'Hafenkai Boden',
  },
  {
    id: 'hw_perim_north',
    pos: { x: 0, y: 4.0, z: -63.0 },
    size: { x: 128, y: 8.0, z: 2.0 },
    color: 0xc2cbd4,
    material: 'wall_light',
    label: 'Nord-Begrenzung',
  },
  {
    id: 'hw_perim_south',
    pos: { x: 0, y: 4.0, z: 63.0 },
    size: { x: 128, y: 8.0, z: 2.0 },
    color: 0xc2cbd4,
    material: 'wall_light',
    label: 'Süd-Begrenzung',
  },
  {
    id: 'hw_perim_west',
    pos: { x: -63.0, y: 4.0, z: 0 },
    size: { x: 2.0, y: 8.0, z: 124 },
    color: 0xb9c3ce,
    material: 'wall_light',
    label: 'West-Kai Begrenzung',
  },
  {
    id: 'hw_perim_east',
    pos: { x: 63.0, y: 4.0, z: 0 },
    size: { x: 2.0, y: 8.0, z: 124 },
    color: 0xb9c3ce,
    material: 'wall_light',
    label: 'Ost-Hafenmauer',
  },

  // =========================================================================
  // SOUTH COURTYARD / ANGREIFER-BASIS (z: +34..+60)
  // =========================================================================
  {
    id: 'hw_spawn_s_back_shelter',
    pos: { x: 0, y: 2.2, z: 59.5 },
    size: { x: 22.0, y: 4.4, z: 1.6 },
    color: 0x525f6d,
    material: 'concrete',
    label: 'Angreifer-Rückwand',
  },
  {
    id: 'hw_spawn_s_trim',
    pos: { x: 0, y: 3.8, z: 58.6 },
    size: { x: 20.0, y: 0.25, z: 0.16 },
    color: 0xff6b2b,
    material: 'trim_orange',
    collider: false,
  },
  {
    id: 'hw_spawn_s_container_w',
    pos: { x: -16.5, y: 1.35, z: 51.0 },
    size: { x: 2.8, y: 2.7, z: 6.8 },
    rotY: 0.18,
    color: 0xd9652b,
    material: 'container_orange',
  },
  {
    id: 'hw_spawn_s_container_e',
    pos: { x: 16.5, y: 1.35, z: 51.0 },
    size: { x: 2.8, y: 2.7, z: 6.8 },
    rotY: -0.18,
    color: 0x3b4e61,
    material: 'container_slate',
  },

  // Süd-Tor framing archway into Zentral-Hof (8m wide doorway at x: -4..+4, z = 32)
  {
    id: 'hw_mid_south_gate_w',
    pos: { x: -9.0, y: 2.6, z: 32.0 },
    size: { x: 10.0, y: 5.2, z: 1.6 },
    color: 0xcad2db,
    material: 'wall_light',
    label: 'Süd-Tor Westflügel',
  },
  {
    id: 'hw_mid_south_gate_e',
    pos: { x: 9.0, y: 2.6, z: 32.0 },
    size: { x: 10.0, y: 5.2, z: 1.6 },
    color: 0xcad2db,
    material: 'wall_light',
    label: 'Süd-Tor Ostflügel',
  },
  {
    id: 'hw_mid_south_gate_lintel',
    pos: { x: 0, y: 4.5, z: 32.0 },
    size: { x: 8.0, y: 1.4, z: 1.6 },
    color: 0x45515f,
    material: 'metal',
    label: 'Süd-Tor Bogen',
  },
  {
    id: 'hw_mid_south_gate_trim',
    pos: { x: 0, y: 3.72, z: 32.88 },
    size: { x: 8.0, y: 0.16, z: 0.12 },
    color: 0xff6b2b,
    material: 'trim_orange',
    collider: false,
  },

  // =========================================================================
  // STRUCTURAL LANE DIVIDERS (West Warehouse & East Logistics Hall)
  // =========================================================================
  {
    id: 'hw_building_sw_warehouse',
    pos: { x: -24.0, y: 2.8, z: 24.0 },
    size: { x: 20.0, y: 5.6, z: 20.0 },
    color: 0xcfd6de,
    material: 'wall_light',
    label: 'Südwest-Speicher',
  },
  {
    id: 'hw_building_se_logistics',
    pos: { x: 25.0, y: 2.8, z: 24.0 },
    size: { x: 22.0, y: 5.6, z: 20.0 },
    color: 0xcfd6de,
    material: 'wall_light',
    label: 'Südost-Logistikhalle',
  },
  // Mid-to-West north divider (leaves 10m A-Verbinder gap at z: +4..+14)
  {
    id: 'hw_divider_nw_terminal',
    pos: { x: -18.0, y: 2.7, z: -9.0 },
    size: { x: 8.0, y: 5.4, z: 26.0 },
    color: 0xc4cdd7,
    material: 'wall_light',
    label: 'Mitte-West Trennwand',
  },
  // Mid-to-East north divider (leaves 10m Mitte-zu-B-Tor gap at z: +4..+14)
  {
    id: 'hw_divider_ne_terminal',
    pos: { x: 18.5, y: 2.7, z: -9.0 },
    size: { x: 9.0, y: 5.4, z: 26.0 },
    color: 0xc4cdd7,
    material: 'wall_light',
    label: 'Mitte-Ost Trennwand',
  },

  // =========================================================================
  // ZENTRAL-HOF (MITTE) around (0, 0, 4)
  // =========================================================================
  // Diagonal orange shipping container dividing sightlines cleanly
  {
    id: 'hw_mid_diag_container',
    pos: { x: -2.2, y: 1.35, z: 6.5 },
    size: { x: 2.8, y: 2.7, z: 7.2 },
    rotY: 0.48,
    color: 0xd9652b,
    material: 'container_orange',
    label: 'Mitte-Container',
  },
  // Stacked cargo crates on East-Mid
  {
    id: 'hw_mid_crate_lower',
    pos: { x: 6.8, y: 0.6, z: 1.5 },
    size: { x: 2.2, y: 1.2, z: 2.2 },
    color: 0xb9854c,
    material: 'wood',
    label: 'Mitte-Kiste Unten',
  },
  {
    id: 'hw_mid_crate_upper',
    pos: { x: 6.8, y: 1.65, z: 0.9 },
    size: { x: 1.5, y: 0.9, z: 1.5 },
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'Mitte-Kiste Oben',
  },
  // Elevated West-Mid Podest (y = 1.4) + seamless walkable ramp
  {
    id: 'hw_mid_west_podest',
    pos: { x: -11.4, y: 0.7, z: -3.5 },
    size: { x: 4.8, y: 1.4, z: 7.4 },
    color: 0x6f7b88,
    material: 'concrete',
    label: 'Mitte-Podest',
  },
  makeRampZ(
    'hw_mid_west_podest_ramp',
    -11.4,
    3.6,
    0.2,
    1.4,
    4.6,
    0.0,
    0.3,
    0x616e7a,
    'concrete',
    'Aufgang Mitte-Podest',
  ),
  // North-Mid cover wall preventing raw spawn-to-spawn sightline
  {
    id: 'hw_mid_north_baffle',
    pos: { x: 1.2, y: 1.5, z: -28.0 },
    size: { x: 6.8, y: 3.0, z: 1.1 },
    color: 0x7a8592,
    material: 'concrete',
    label: 'Nord-Mitte Schildmauer',
  },

  // =========================================================================
  // WEST WING: A-LANG, A-KURZ, A-BRÜCKE & KERN-ZONE A (-36, 0, -14)
  // =========================================================================
  // Quay seawall curb along far-west dock edge
  {
    id: 'hw_alang_seawall_curb',
    pos: { x: -59.5, y: 0.65, z: 6.0 },
    size: { x: 1.2, y: 1.3, z: 64.0 },
    color: 0x677381,
    material: 'concrete',
    label: 'Kaimauer West',
  },
  // Divider wall separating A-Lang (west) from A-Kurz (east)
  {
    id: 'hw_alang_akurz_divider',
    pos: { x: -39.5, y: 2.5, z: 14.0 },
    size: { x: 2.4, y: 5.0, z: 22.0 },
    color: 0xcad2db,
    material: 'wall_light',
    label: 'A-Lang Trennwand',
  },
  // Cover along the 48m A-Lang sightline
  {
    id: 'hw_alang_cover_south_container',
    pos: { x: -51.5, y: 1.35, z: 24.5 },
    size: { x: 2.8, y: 2.7, z: 6.2 },
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'A-Lang Süd-Container',
  },
  {
    id: 'hw_alang_cover_mid_block',
    pos: { x: -45.2, y: 0.6, z: 8.0 },
    size: { x: 2.6, y: 1.2, z: 1.0 },
    color: 0x838f9c,
    material: 'concrete',
    label: 'A-Lang Halbdeckung',
  },
  {
    id: 'hw_alang_cover_north_crates',
    pos: { x: -53.2, y: 1.1, z: -2.0 },
    size: { x: 2.4, y: 2.2, z: 2.4 },
    color: 0xb9854c,
    material: 'wood',
    label: 'A-Lang Nord-Kiste',
  },

  // A-Kurz angled alley cover
  {
    id: 'hw_akurz_angled_container',
    pos: { x: -30.5, y: 1.35, z: 6.0 },
    size: { x: 2.6, y: 2.7, z: 5.4 },
    rotY: 0.34,
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'A-Kurz Winkel-Container',
  },

  // Elevated A-Brücke platform (y = 2.4) overlooking Kern-Zone A + South & North ramps
  {
    id: 'hw_site_a_bridge_deck',
    pos: { x: -25.5, y: 1.2, z: -14.0 },
    size: { x: 5.0, y: 2.4, z: 12.0 },
    color: 0x5d6978,
    material: 'concrete',
    label: 'A-Brücke Plattform',
  },
  {
    id: 'hw_site_a_bridge_railing',
    pos: { x: -27.75, y: 2.9, z: -11.2 },
    size: { x: 0.4, y: 1.0, z: 4.2 },
    color: 0x434f5d,
    material: 'metal',
    label: 'A-Brücke Brüstung',
  },
  makeRampZ(
    'hw_site_a_bridge_ramp_south',
    -25.5,
    4.0,
    -8.0,
    2.4,
    -0.8,
    0.0,
    0.34,
    0x63707c,
    'concrete',
    'A-Kurz Rampe zur A-Brücke',
  ),
  makeRampZ(
    'hw_site_a_bridge_ramp_north',
    -25.5,
    3.8,
    -27.2,
    0.0,
    -20.0,
    2.4,
    0.34,
    0x687584,
    'metal',
    'Verteidiger-Aufgang A-Brücke',
  ),

  // Kern-Zone A (-36, 0, -14) on-site tactical cover & Harbor Crane landmark
  {
    id: 'hw_site_a_center_anchor',
    pos: { x: -35.8, y: 1.15, z: -13.5 },
    size: { x: 2.6, y: 2.3, z: 2.6 },
    color: 0xd9652b,
    material: 'container_orange',
    label: 'Zone A Hauptblock',
  },
  {
    id: 'hw_site_a_crouch_crate',
    pos: { x: -39.6, y: 0.55, z: -17.2 },
    size: { x: 1.8, y: 1.1, z: 1.8 },
    color: 0xb9854c,
    material: 'wood',
    label: 'Zone A Kiste',
  },
  // Iconic Harbor Crane overhead gantry at West-Kai (legs outside 11x11 site)
  {
    id: 'hw_site_a_crane_leg_n',
    pos: { x: -45.5, y: 3.8, z: -21.5 },
    size: { x: 1.2, y: 7.6, z: 1.2 },
    color: 0xd9652b,
    material: 'metal',
    label: 'Hafenkran Stütze Nord',
  },
  {
    id: 'hw_site_a_crane_leg_s',
    pos: { x: -45.5, y: 3.8, z: -6.5 },
    size: { x: 1.2, y: 7.6, z: 1.2 },
    color: 0xd9652b,
    material: 'metal',
    label: 'Hafenkran Stütze Süd',
  },
  {
    id: 'hw_site_a_crane_boom',
    pos: { x: -41.0, y: 7.8, z: -14.0 },
    size: { x: 24.0, y: 0.9, z: 16.2 },
    color: 0x45515f,
    material: 'metal',
    collider: false,
    label: 'Hafenkran Ausleger',
  },

  // Verteidiger-Zugang A cover (North-West rotation)
  {
    id: 'hw_def_a_container',
    pos: { x: -38.0, y: 1.35, z: -31.5 },
    size: { x: 6.4, y: 2.7, z: 2.8 },
    rotY: -0.15,
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Verteidiger-Zugang A Container',
  },

  // =========================================================================
  // EAST WING: B-GASSE, MITTE-ZU-B-TOR, B-RAMPE & KERN-ZONE B (+36, 0, -12)
  // =========================================================================
  // Outer wall framing B-Gasse along east side
  {
    id: 'hw_bgasse_outer_wall',
    pos: { x: 57.5, y: 2.6, z: 13.0 },
    size: { x: 1.6, y: 5.2, z: 42.0 },
    color: 0xc4cdd7,
    material: 'wall_light',
    label: 'B-Gasse Außenmauer',
  },
  // B-Gasse tight CQB chicanes (preserving >= 5m wide lanes!)
  {
    id: 'hw_bgasse_chicane_1',
    pos: { x: 40.5, y: 1.6, z: 22.5 },
    size: { x: 7.0, y: 3.2, z: 1.4 },
    color: 0x7c8794,
    material: 'concrete',
    label: 'B-Gasse Schikane Süd',
  },
  {
    id: 'hw_bgasse_chicane_2',
    pos: { x: 52.0, y: 1.35, z: 11.5 },
    size: { x: 8.2, y: 2.7, z: 2.8 },
    color: 0xd9652b,
    material: 'container_orange',
    label: 'B-Gasse Schikane Ost',
  },
  {
    id: 'hw_bgasse_corner_box',
    pos: { x: 40.2, y: 0.95, z: 3.2 },
    size: { x: 2.2, y: 1.9, z: 2.2 },
    color: 0xb9854c,
    material: 'wood',
    label: 'B-Gasse Eckkiste',
  },

  // Mitte-zu-B-Tor archway & tactical half-wall
  {
    id: 'hw_mid_to_b_gate_lintel',
    pos: { x: 22.0, y: 4.5, z: 9.0 },
    size: { x: 1.4, y: 1.4, z: 10.0 },
    color: 0x45515f,
    material: 'metal',
    label: 'Mitte-zu-B-Tor Bogen',
  },
  {
    id: 'hw_mid_to_b_halfwall',
    pos: { x: 27.2, y: 0.6, z: 2.0 },
    size: { x: 0.8, y: 1.2, z: 3.4 },
    color: 0x838f9c,
    material: 'concrete',
    label: 'B-Tor Halbwand',
  },

  // Elevated B-Rampe container catwalk (y = 2.4) overlooking Kern-Zone B + ramps
  {
    id: 'hw_site_b_catwalk_deck',
    pos: { x: 45.5, y: 1.2, z: -12.0 },
    size: { x: 5.2, y: 2.4, z: 14.0 },
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'B-Rampe Laufsteg',
  },
  {
    id: 'hw_site_b_catwalk_railing',
    pos: { x: 43.1, y: 2.9, z: -15.2 },
    size: { x: 0.4, y: 1.0, z: 4.6 },
    color: 0x18d4c9,
    material: 'trim_teal',
    label: 'B-Rampe Brüstung',
  },
  makeRampZ(
    'hw_site_b_ramp_south',
    46.0,
    3.8,
    -5.0,
    2.4,
    2.2,
    0.0,
    0.34,
    0x63707c,
    'concrete',
    'Aufgang B-Rampe Süd',
  ),
  makeRampZ(
    'hw_site_b_ramp_north',
    45.5,
    3.8,
    -26.2,
    0.0,
    -19.0,
    2.4,
    0.34,
    0x687584,
    'metal',
    'Verteidiger-Aufgang B-Rampe',
  ),

  // Kern-Zone B (+36, 0, -12) on-site cover & Ost-Lagerhalle open-skylight trusses
  {
    id: 'hw_site_b_angled_container',
    pos: { x: 34.0, y: 1.35, z: -12.8 },
    size: { x: 2.6, y: 2.7, z: 5.4 },
    rotY: -0.26,
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Zone B Kern-Container',
  },
  {
    id: 'hw_site_b_pallet_cover',
    pos: { x: 38.8, y: 0.55, z: -8.6 },
    size: { x: 2.0, y: 1.1, z: 2.0 },
    color: 0xb9854c,
    material: 'wood',
    label: 'Zone B Frachtpalette',
  },
  // Open-air warehouse columns & overhead skylight beams (zero dark shadows!)
  {
    id: 'hw_site_b_hall_col_nw',
    pos: { x: 27.5, y: 3.9, z: -20.5 },
    size: { x: 1.0, y: 7.8, z: 1.0 },
    color: 0x4b5664,
    material: 'metal',
  },
  {
    id: 'hw_site_b_hall_col_sw',
    pos: { x: 27.5, y: 3.9, z: -3.5 },
    size: { x: 1.0, y: 7.8, z: 1.0 },
    color: 0x4b5664,
    material: 'metal',
  },
  {
    id: 'hw_site_b_hall_truss_1',
    pos: { x: 38.5, y: 7.9, z: -20.5 },
    size: { x: 23.0, y: 0.65, z: 0.9 },
    color: 0x4b5664,
    material: 'metal',
    collider: false,
  },
  {
    id: 'hw_site_b_hall_truss_2',
    pos: { x: 38.5, y: 7.9, z: -12.0 },
    size: { x: 23.0, y: 0.65, z: 0.9 },
    color: 0x4b5664,
    material: 'metal',
    collider: false,
  },
  {
    id: 'hw_site_b_hall_truss_3',
    pos: { x: 38.5, y: 7.9, z: -3.5 },
    size: { x: 23.0, y: 0.65, z: 0.9 },
    color: 0x4b5664,
    material: 'metal',
    collider: false,
  },

  // =========================================================================
  // NORTH COURTYARD / VERTEIDIGER-BASIS (z: -58..-34)
  // =========================================================================
  {
    id: 'hw_spawn_n_back_shelter',
    pos: { x: 0, y: 2.2, z: -59.5 },
    size: { x: 22.0, y: 4.4, z: 1.6 },
    color: 0x525f6d,
    material: 'concrete',
    label: 'Verteidiger-Rückwand',
  },
  {
    id: 'hw_spawn_n_trim',
    pos: { x: 0, y: 3.8, z: -58.6 },
    size: { x: 20.0, y: 0.25, z: 0.16 },
    color: 0x18d4c9,
    material: 'trim_teal',
    collider: false,
  },
  {
    id: 'hw_def_b_rotation_cover',
    pos: { x: 34.5, y: 1.35, z: -31.0 },
    size: { x: 6.2, y: 2.7, z: 2.8 },
    rotY: 0.16,
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'Verteidiger-Zugang B Container',
  },
  // Süd-Hof Taktische Kiste & Container-Deckung (Angreifer-Hof z = +42)
  {
    id: 'hw_spawn_s_courtyard_crates',
    pos: { x: -21.0, y: 0.7, z: 42.0 },
    size: { x: 2.4, y: 1.4, z: 2.4 },
    color: 0xb9854c,
    material: 'wood',
    label: 'Süd-Hof Deckungskisten West',
  },
  {
    id: 'hw_spawn_s_courtyard_crate_hi',
    pos: { x: -21.0, y: 1.9, z: 42.0 },
    size: { x: 1.4, y: 1.0, z: 1.4 },
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'Süd-Hof Stapelkiste',
  },
  {
    id: 'hw_spawn_s_courtyard_crates_east',
    pos: { x: 21.0, y: 0.7, z: 42.0 },
    size: { x: 2.4, y: 1.4, z: 2.4 },
    color: 0xb9854c,
    material: 'wood',
    label: 'Süd-Hof Deckungskisten Ost',
  },
  // Nord-Hof / Verteidiger-Zugang A Container-Deckung
  {
    id: 'hw_def_a_rotation_cover',
    pos: { x: -34.5, y: 1.35, z: -31.0 },
    size: { x: 6.2, y: 2.7, z: 2.8 },
    rotY: -0.16,
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Verteidiger-Zugang A Container',
  },

  // =========================================================================
  // DECORATIVE HARBOR BASIN & CRANE GIRDER SILHOUETTES (Outside playable bounds, collider: false)
  // =========================================================================
  {
    id: 'hw_decor_west_harbor_basin',
    pos: { x: -72.0, y: -0.35, z: -6.0 },
    size: { x: 14.0, y: 0.2, z: 118.0 },
    color: 0x22667a,
    material: 'water_dock',
    collider: false,
    label: 'West-Hafenbecken',
  },
  {
    id: 'hw_decor_north_harbor_basin',
    pos: { x: 0.0, y: -0.35, z: -72.0 },
    size: { x: 132.0, y: 0.2, z: 14.0 },
    color: 0x22667a,
    material: 'water_dock',
    collider: false,
    label: 'Nord-Hafenbucht',
  },
  {
    id: 'hw_decor_west_quay_crane_leg_1',
    pos: { x: -67.5, y: 6.5, z: 16.0 },
    size: { x: 1.6, y: 13.0, z: 1.6 },
    color: 0xd9652b,
    material: 'metal',
    collider: false,
  },
  {
    id: 'hw_decor_west_quay_crane_leg_2',
    pos: { x: -67.5, y: 6.5, z: 30.0 },
    size: { x: 1.6, y: 13.0, z: 1.6 },
    color: 0xd9652b,
    material: 'metal',
    collider: false,
  },
  {
    id: 'hw_decor_west_quay_crane_girder',
    pos: { x: -62.0, y: 13.2, z: 23.0 },
    size: { x: 22.0, y: 1.1, z: 15.6 },
    color: 0x45515f,
    material: 'metal',
    collider: false,
  },
  {
    id: 'hw_decor_east_dock_gantry',
    pos: { x: 67.5, y: 10.4, z: -12.0 },
    size: { x: 6.0, y: 1.0, z: 28.0 },
    color: 0x45515f,
    material: 'metal',
    collider: false,
  },
];

const HAFENWERK_ZONES: MapZone[] = [
  {
    id: 'zone_spawn_attacker',
    label: 'ANGREIFER-START',
    type: 'spawn_attacker',
    center: { x: 0, y: 0, z: 52 },
    size: { x: 18, z: 10 },
    color: 0xff6b2b,
  },
  {
    id: 'zone_spawn_defender',
    label: 'VERTEIDIGER-START',
    type: 'spawn_defender',
    center: { x: 0, y: 0, z: -52 },
    size: { x: 18, z: 10 },
    color: 0x18d4c9,
  },
  {
    id: 'zone_kern_a',
    label: 'KERN-ZONE A',
    type: 'kern_site_a',
    center: { x: -36, y: 0, z: -14 },
    size: { x: 11, z: 11 },
    color: 0xff6b2b,
  },
  {
    id: 'zone_kern_b',
    label: 'KERN-ZONE B',
    type: 'kern_site_b',
    center: { x: 36, y: 0, z: -12 },
    size: { x: 11, z: 11 },
    color: 0x18d4c9,
  },
];

// 10 tactical target dummies across Mid, A-Lang, Kern-Zone A, B-Gasse, and Kern-Zone B
// (3 equipped with patrolAmplitude: 2.5 for moving-target tracking practice)
const HAFENWERK_DUMMIES: DummySpawnDef[] = [
  // Mid (2) — south-mid dummy is visible down Süd-Tor right from Attacker Spawn
  {
    id: 'hw_dummy_mid_south',
    pos: { x: 1.2, y: 0, z: 18.0 },
    yaw: Math.PI,
    patrolAmplitude: 2.5,
    patrolAxis: 'x',
    patrolSpeed: 1.9,
  },
  {
    id: 'hw_dummy_mid_north',
    pos: { x: -3.5, y: 0, z: -8.5 },
    yaw: Math.PI,
  },

  // A-Lang (2)
  {
    id: 'hw_dummy_alang_mid',
    pos: { x: -46.8, y: 0, z: 15.0 },
    yaw: Math.PI,
    patrolAmplitude: 2.5,
    patrolAxis: 'x',
    patrolSpeed: 2.0,
  },
  {
    id: 'hw_dummy_alang_north',
    pos: { x: -47.8, y: 0, z: -4.5 },
    yaw: Math.PI,
  },

  // Kern-Zone A & elevated A-Brücke (2)
  {
    id: 'hw_dummy_site_a_floor',
    pos: { x: -39.6, y: 0, z: -11.8 },
    yaw: Math.PI * 0.88,
  },
  {
    id: 'hw_dummy_site_a_bridge',
    pos: { x: -25.5, y: 2.4, z: -15.8 },
    yaw: Math.PI * 0.72,
  },

  // B-Gasse (2)
  {
    id: 'hw_dummy_bgasse_mid',
    pos: { x: 48.5, y: 0, z: 17.5 },
    yaw: Math.PI,
    patrolAmplitude: 2.5,
    patrolAxis: 'x',
    patrolSpeed: 2.1,
  },
  {
    id: 'hw_dummy_bgasse_entry',
    pos: { x: 43.8, y: 0, z: 4.5 },
    yaw: Math.PI,
  },

  // Kern-Zone B & elevated B-Rampe catwalk (2)
  {
    id: 'hw_dummy_site_b_floor',
    pos: { x: 38.4, y: 0, z: -15.0 },
    yaw: -Math.PI * 0.88,
  },
  {
    id: 'hw_dummy_site_b_catwalk',
    pos: { x: 45.5, y: 2.4, z: -9.2 },
    yaw: -Math.PI * 0.68,
  },
];

// Full-width airtight Buy-Phase Spawn Barriers at z = +35.5 (Team A South) and z = -35.5 (Team D North)
// Partitioned cleanly across A-Lang West, Süd/Nord-Mitte, and B-Gasse East covering [-62..+62] with zero gaps.
const HAFENWERK_SPAWN_BARRIERS: SpawnBarrierDef[] = [
  {
    id: 'hw_barrier_a_west',
    team: 'A',
    pos: { x: -43.0, y: 2.6, z: 35.5 },
    size: { x: 38.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'hw_barrier_a_mid',
    team: 'A',
    pos: { x: 0.0, y: 2.6, z: 35.5 },
    size: { x: 48.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'hw_barrier_a_east',
    team: 'A',
    pos: { x: 43.0, y: 2.6, z: 35.5 },
    size: { x: 38.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'hw_barrier_d_west',
    team: 'D',
    pos: { x: -43.0, y: 2.6, z: -35.5 },
    size: { x: 38.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'hw_barrier_d_mid',
    team: 'D',
    pos: { x: 0.0, y: 2.6, z: -35.5 },
    size: { x: 48.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'hw_barrier_d_east',
    team: 'D',
    pos: { x: 43.0, y: 2.6, z: -35.5 },
    size: { x: 38.0, y: 5.2, z: 0.4 },
  },
];

const HAFENWERK_CALLOUTS: MapCallout[] = [
  { id: 'hw_call_a_dock', label: 'A-Dock', pos: { x: -36, y: 0, z: -14 } },
  { id: 'hw_call_a_rampe', label: 'A-Rampe', pos: { x: -25.5, y: 2.4, z: -14 } },
  { id: 'hw_call_mittel_hof', label: 'Mittel-Hof', pos: { x: 0, y: 0, z: 4 } },
  { id: 'hw_call_b_kranlager', label: 'B-Kranlager', pos: { x: 36, y: 0, z: -12 } },
  { id: 'hw_call_b_lang', label: 'B-Lang', pos: { x: 47, y: 0, z: 14 } },
  { id: 'hw_call_angreifer_kai', label: 'Angreifer-Kai', pos: { x: 0, y: 0, z: 52 } },
  { id: 'hw_call_verteidiger_bucht', label: 'Verteidiger-Bucht', pos: { x: 0, y: 0, z: -52 } },
];

export const HAFENWERK_MAP: MapDefinition = {
  id: 'hafenwerk',
  name: 'Hafenwerk',
  subtitle: 'Industriehafen · 120×120m Taktik-Karte (Kern-Zone A & B)',
  theme: 'dockyard',
  bounds: { width: 128, depth: 128 },
  playerSpawn: {
    pos: { x: 0, y: 0.05, z: 52 },
    yaw: 0,
  },
  blocks: [
    ...HAFENWERK_BLOCKS,
    ...makeSharedSetPieces({
      prefix: 'hw_sp',
      siteADeck: { westX: -28.0, topY: 2.4 },
      siteBDeck: { westX: 42.9, topY: 2.4 },
      eastWallInnerX: 56.7,
      crate: { material: 'wood', color: 0xb9854c },
      crateAlt: { material: 'container_slate', color: 0x3b4e61 },
      platform: { material: 'concrete', color: 0x6f7b88 },
      parapet: { material: 'hazard', color: 0xd48b28 },
      vehicleBody: { material: 'container_orange', color: 0xd9652b },
      vehicleCab: { material: 'metal', color: 0x45515f },
    }),
  ],
  zones: HAFENWERK_ZONES,
  dummySpawns: HAFENWERK_DUMMIES,
  spawnBarriers: HAFENWERK_SPAWN_BARRIERS,
  callouts: HAFENWERK_CALLOUTS,
};
