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

const WERKSTADT_BLOCKS: MapBlock[] = [
  // =========================================================================
  // BASE FLOOR (124 x 124 m sunlit sandstone plaza, top surface at exact y = 0)
  // & PERIMETER WALLS (h = 8.5 m with terracotta coping)
  // =========================================================================
  {
    id: 'ws_floor_main',
    pos: { x: 0, y: -0.5, z: 0 },
    size: { x: 124, y: 1.0, z: 124 },
    color: 0xd8c7ad,
    material: 'stone_sand',
    label: 'Altstadt-Sandsteinboden',
  },
  {
    id: 'ws_perim_north',
    pos: { x: 0, y: 4.25, z: -61.0 },
    size: { x: 124, y: 8.5, z: 2.0 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Nord-Stadtmauer',
  },
  {
    id: 'ws_perim_south',
    pos: { x: 0, y: 4.25, z: 61.0 },
    size: { x: 124, y: 8.5, z: 2.0 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Süd-Stadtmauer',
  },
  {
    id: 'ws_perim_west',
    pos: { x: -61.0, y: 4.25, z: 0 },
    size: { x: 2.0, y: 8.5, z: 120 },
    color: 0xc9b69a,
    material: 'stone_sand',
    label: 'West-Manufakturmauer',
  },
  {
    id: 'ws_perim_east',
    pos: { x: 61.0, y: 4.25, z: 0 },
    size: { x: 2.0, y: 8.5, z: 120 },
    color: 0xc9b69a,
    material: 'stone_sand',
    label: 'Ost-Zunftmauer',
  },
  // Terracotta perimeter roof coping ledges (non-colliding architectural trim)
  {
    id: 'ws_perim_coping_north',
    pos: { x: 0, y: 8.68, z: -60.9 },
    size: { x: 124, y: 0.36, z: 2.3 },
    color: 0xc8643b,
    material: 'terracotta',
    collider: false,
  },
  {
    id: 'ws_perim_coping_south',
    pos: { x: 0, y: 8.68, z: 60.9 },
    size: { x: 124, y: 0.36, z: 2.3 },
    color: 0xc8643b,
    material: 'terracotta',
    collider: false,
  },

  // =========================================================================
  // SÜD-MARKT / ANGREIFER-START (z: +36..+59, open spawn plaza around z = +46..+52)
  // =========================================================================
  {
    id: 'ws_spawn_s_back_arcade',
    pos: { x: 0, y: 2.4, z: 58.2 },
    size: { x: 24.0, y: 4.8, z: 1.6 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Süd-Markt Arkade',
  },
  {
    id: 'ws_spawn_s_cornice',
    pos: { x: 0, y: 4.98, z: 58.1 },
    size: { x: 24.8, y: 0.36, z: 2.0 },
    color: 0xc9653c,
    material: 'terracotta',
    collider: false,
  },
  {
    id: 'ws_spawn_s_pergola_1',
    pos: { x: 0, y: 4.4, z: 54.8 },
    size: { x: 18.0, y: 0.32, z: 0.42 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'ws_spawn_s_pergola_2',
    pos: { x: 0, y: 4.4, z: 51.6 },
    size: { x: 18.0, y: 0.32, z: 0.42 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'ws_spawn_s_west_stall',
    pos: { x: -16.5, y: 1.25, z: 48.5 },
    size: { x: 3.4, y: 2.5, z: 5.8 },
    rotY: 0.14,
    color: 0xcfbda0,
    material: 'stone_sand',
    label: 'Marktstand West',
  },
  {
    id: 'ws_spawn_s_east_stall',
    pos: { x: 16.5, y: 1.25, z: 48.5 },
    size: { x: 3.4, y: 2.5, z: 5.8 },
    rotY: -0.14,
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Marktstand Ost',
  },

  // Süd-Tor Brick Archway framing entry into Kanal-Mitte (z = 31.5, 8.4m clear opening)
  {
    id: 'ws_south_arch_west',
    pos: { x: -8.8, y: 2.7, z: 31.5 },
    size: { x: 9.2, y: 5.4, z: 1.8 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Süd-Bogen West',
  },
  {
    id: 'ws_south_arch_east',
    pos: { x: 8.8, y: 2.7, z: 31.5 },
    size: { x: 9.2, y: 5.4, z: 1.8 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Süd-Bogen Ost',
  },
  {
    id: 'ws_south_arch_lintel',
    pos: { x: 0, y: 4.6, z: 31.5 },
    size: { x: 8.4, y: 1.6, z: 1.9 },
    color: 0xc9653c,
    material: 'terracotta',
    label: 'Süd-Bogen Sturz',
  },

  // =========================================================================
  // STRUCTURAL GUILD BUILDINGS (Separating West Lane, Mid Canal, and East Lane)
  // =========================================================================
  {
    id: 'ws_guild_sw_foundry_hall',
    pos: { x: -23.5, y: 3.1, z: 22.5 },
    size: { x: 19.0, y: 6.2, z: 19.0 },
    color: 0xb65c42,
    material: 'brick_warm',
    label: 'Südwest-Manufaktur',
  },
  {
    id: 'ws_guild_sw_roof_trim',
    pos: { x: -23.5, y: 6.38, z: 22.5 },
    size: { x: 19.6, y: 0.36, z: 19.6 },
    color: 0xc8643b,
    material: 'terracotta',
    collider: false,
  },
  {
    id: 'ws_guild_se_merchant_house',
    pos: { x: 24.0, y: 3.1, z: 22.5 },
    size: { x: 20.0, y: 6.2, z: 19.0 },
    color: 0xd1bfa3,
    material: 'stone_sand',
    label: 'Südost-Zunfthaus',
  },
  {
    id: 'ws_guild_se_roof_trim',
    pos: { x: 24.0, y: 6.38, z: 22.5 },
    size: { x: 20.6, y: 0.36, z: 19.6 },
    color: 0xc8643b,
    material: 'terracotta',
    collider: false,
  },
  // North-West & North-East Guild dividers leaving wide 9.5m Mid connectors at z: +2..+12
  {
    id: 'ws_guild_nw_divider',
    pos: { x: -18.5, y: 2.9, z: -9.5 },
    size: { x: 7.6, y: 5.8, z: 23.0 },
    color: 0xd1bfa3,
    material: 'stone_sand',
    label: 'Gießerei-Mittelbau',
  },
  {
    id: 'ws_guild_ne_divider',
    pos: { x: 18.5, y: 2.9, z: -9.5 },
    size: { x: 8.0, y: 5.8, z: 23.0 },
    color: 0xb65c42,
    material: 'brick_warm',
    label: 'Uhrenturm-Mittelbau',
  },

  // =========================================================================
  // KANAL-MITTE: DECORATIVE SHALLOW CANAL, STONE BRIDGES & TIMBER PERGOLA
  // =========================================================================
  // Decorative canal water strips (non-colliding, framed by half-height stone parapets)
  {
    id: 'ws_canal_water_south',
    pos: { x: 0, y: 0.005, z: 19.0 },
    size: { x: 5.2, y: 0.01, z: 9.2 },
    color: 0x2b7285,
    material: 'water_dock',
    collider: false,
    label: 'Werk-Kanal Süd',
  },
  {
    id: 'ws_canal_water_center',
    pos: { x: 0, y: 0.005, z: 2.0 },
    size: { x: 5.2, y: 0.01, z: 10.6 },
    color: 0x2b7285,
    material: 'water_dock',
    collider: false,
    label: 'Werk-Kanal Mitte',
  },
  {
    id: 'ws_canal_water_north',
    pos: { x: 0, y: 0.005, z: -15.5 },
    size: { x: 5.2, y: 0.01, z: 9.6 },
    color: 0x2b7285,
    material: 'water_dock',
    collider: false,
    label: 'Werk-Kanal Nord',
  },
  // Walkable Stone Bridges spanning the canal (0.14m rise — smooth autostep, zero z-fighting)
  {
    id: 'ws_canal_bridge_south',
    pos: { x: 0, y: 0.07, z: 10.8 },
    size: { x: 9.4, y: 0.14, z: 6.8 },
    color: 0xdfd0b8,
    material: 'stone_sand',
    label: 'Südliche Kanal-Brücke',
  },
  {
    id: 'ws_canal_bridge_north',
    pos: { x: 0, y: 0.07, z: -7.0 },
    size: { x: 9.4, y: 0.14, z: 6.8 },
    color: 0xdfd0b8,
    material: 'stone_sand',
    label: 'Nördliche Kanal-Brücke',
  },
  // Clean 1.15m half-height stone canal balustrades flanking open water basins (solid cover)
  {
    id: 'ws_canal_parapet_sw',
    pos: { x: -2.9, y: 0.58, z: 19.0 },
    size: { x: 0.6, y: 1.16, z: 9.2 },
    color: 0xc7b497,
    material: 'stone_sand',
  },
  {
    id: 'ws_canal_parapet_se',
    pos: { x: 2.9, y: 0.58, z: 19.0 },
    size: { x: 0.6, y: 1.16, z: 9.2 },
    color: 0xc7b497,
    material: 'stone_sand',
  },
  {
    id: 'ws_canal_parapet_cw',
    pos: { x: -2.9, y: 0.58, z: 2.0 },
    size: { x: 0.6, y: 1.16, z: 10.6 },
    color: 0xc7b497,
    material: 'stone_sand',
  },
  {
    id: 'ws_canal_parapet_ce',
    pos: { x: 2.9, y: 0.58, z: 2.0 },
    size: { x: 0.6, y: 1.16, z: 10.6 },
    color: 0xc7b497,
    material: 'stone_sand',
  },
  {
    id: 'ws_canal_parapet_nw',
    pos: { x: -2.9, y: 0.58, z: -15.5 },
    size: { x: 0.6, y: 1.16, z: 9.6 },
    color: 0xc7b497,
    material: 'stone_sand',
  },
  {
    id: 'ws_canal_parapet_ne',
    pos: { x: 2.9, y: 0.58, z: -15.5 },
    size: { x: 0.6, y: 1.16, z: 9.6 },
    color: 0xc7b497,
    material: 'stone_sand',
  },
  // Canal-end stone headwalls so players walk around onto the two wide bridges cleanly
  {
    id: 'ws_canal_cap_south',
    pos: { x: 0, y: 0.58, z: 23.8 },
    size: { x: 6.4, y: 1.16, z: 0.7 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Kanal-Brunnenmauer Süd',
  },
  {
    id: 'ws_canal_cap_north',
    pos: { x: 0, y: 1.45, z: -20.6 },
    size: { x: 6.4, y: 2.9, z: 1.0 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Nord-Kanal Schildmauer',
  },
  // Mid courtyard cover pillars & overhead timber beams
  {
    id: 'ws_mid_west_pillar_cover',
    pos: { x: -9.2, y: 1.35, z: 14.5 },
    size: { x: 2.4, y: 2.7, z: 2.4 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Mitte-Ziegelpfeiler',
  },
  {
    id: 'ws_mid_east_crate_stack',
    pos: { x: 9.4, y: 1.05, z: -1.5 },
    size: { x: 2.2, y: 2.1, z: 2.2 },
    color: 0x8b623c,
    material: 'timber_beam',
    label: 'Mitte-Holzstapel',
  },
  {
    id: 'ws_mid_pergola_beam_1',
    pos: { x: 0, y: 6.6, z: 10.8 },
    size: { x: 26.0, y: 0.38, z: 0.5 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'ws_mid_pergola_beam_2',
    pos: { x: 0, y: 6.6, z: -7.0 },
    size: { x: 26.0, y: 0.38, z: 0.5 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },

  // =========================================================================
  // WEST WING: WEST-ALLEE, GIESSEREI-BOGEN & ZONE A ("GIESSEREI-HOF", -36, 0, -13)
  // =========================================================================
  // Brick archway spanning West-Allee entry
  {
    id: 'ws_west_allee_arch_beam',
    pos: { x: -46.5, y: 4.8, z: 25.0 },
    size: { x: 27.0, y: 1.2, z: 1.6 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'West-Allee Torbogen',
  },
  // Lane divider creating West-Allee (outer) and Gießerei-Zulauf (inner)
  {
    id: 'ws_west_lane_divider',
    pos: { x: -40.5, y: 2.6, z: 13.5 },
    size: { x: 2.6, y: 5.2, z: 18.0 },
    color: 0xd1bfa3,
    material: 'stone_sand',
    label: 'West-Allee Trennmauer',
  },
  {
    id: 'ws_west_allee_planter_cover',
    pos: { x: -51.5, y: 1.25, z: 19.5 },
    size: { x: 3.0, y: 2.5, z: 4.6 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'West-Allee Ziegelblock',
  },
  {
    id: 'ws_west_allee_halfwall',
    pos: { x: -46.2, y: 0.6, z: 5.5 },
    size: { x: 2.8, y: 1.2, z: 1.0 },
    color: 0xcab89b,
    material: 'stone_sand',
    label: 'West-Allee Brustwehr',
  },
  {
    id: 'ws_west_inner_timber_stack',
    pos: { x: -31.0, y: 1.2, z: 6.5 },
    size: { x: 2.4, y: 2.4, z: 4.2 },
    rotY: 0.25,
    color: 0x855c38,
    material: 'timber_beam',
    label: 'Gießerei-Holzlager',
  },

  // Gießerei-Empore (elevated gallery at y = 2.2 overlooking Zone A) + South & North ramps
  {
    id: 'ws_site_a_empore_deck',
    pos: { x: -25.2, y: 1.1, z: -13.0 },
    size: { x: 4.8, y: 2.2, z: 11.6 },
    color: 0xcab89b,
    material: 'stone_sand',
    label: 'Gießerei-Empore',
  },
  {
    id: 'ws_site_a_empore_parapet',
    pos: { x: -27.35, y: 2.75, z: -10.5 },
    size: { x: 0.45, y: 1.1, z: 4.2 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Empore-Brüstung',
  },
  makeRampZ(
    'ws_site_a_ramp_south',
    -25.2,
    3.8,
    -7.2,
    2.2,
    -0.4,
    0.0,
    0.32,
    0xc9653c,
    'terracotta',
    'Aufgang Gießerei-Empore Süd',
  ),
  makeRampZ(
    'ws_site_a_ramp_north',
    -25.2,
    3.8,
    -25.6,
    0.0,
    -18.8,
    2.2,
    0.32,
    0xcab89b,
    'stone_sand',
    'Verteidiger-Aufgang Empore',
  ),

  // Zone A ("Gießerei-Hof", center -36, 0, -13 kept completely clear for Kern planting!)
  {
    id: 'ws_site_a_kiln_pillar',
    pos: { x: -39.6, y: 1.4, z: -9.8 },
    size: { x: 2.4, y: 2.8, z: 2.4 },
    color: 0xb3553b,
    material: 'brick_warm',
    label: 'Schmelzofen-Pfeiler',
  },
  {
    id: 'ws_site_a_sandstone_halfblock',
    pos: { x: -32.6, y: 0.6, z: -16.4 },
    size: { x: 2.4, y: 1.2, z: 1.5 },
    color: 0xd4c2a6,
    material: 'stone_sand',
    label: 'Gießerei-Steinbank',
  },
  {
    id: 'ws_site_a_west_foundry_wall',
    pos: { x: -46.5, y: 2.8, z: -13.0 },
    size: { x: 2.0, y: 5.6, z: 14.0 },
    color: 0xb65c42,
    material: 'brick_warm',
    label: 'Gießerei-Westwand',
  },
  // Open-air timber foundry rafters above Zone A
  {
    id: 'ws_site_a_rafter_1',
    pos: { x: -36.0, y: 7.2, z: -18.0 },
    size: { x: 21.0, y: 0.45, z: 0.6 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'ws_site_a_rafter_2',
    pos: { x: -36.0, y: 7.2, z: -13.0 },
    size: { x: 21.0, y: 0.45, z: 0.6 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'ws_site_a_rafter_3',
    pos: { x: -36.0, y: 7.2, z: -8.0 },
    size: { x: 21.0, y: 0.45, z: 0.6 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  // Defender A approach cover
  {
    id: 'ws_def_a_arch_cover',
    pos: { x: -36.5, y: 1.35, z: -29.5 },
    size: { x: 5.6, y: 2.7, z: 2.2 },
    rotY: -0.14,
    color: 0xd1bfa3,
    material: 'stone_sand',
    label: 'Nord-Gießereitor Deckung',
  },

  // =========================================================================
  // EAST WING: OST-ARKADE, TURM-PASSAGE & ZONE B ("UHRENTURM-PLATZ", +36, 0, -12)
  // =========================================================================
  // Sunlit Ost-Arkade outer colonnade & chicane cover (preserving >= 5m corridor widths)
  {
    id: 'ws_east_arcade_wall',
    pos: { x: 56.5, y: 2.7, z: 12.0 },
    size: { x: 1.6, y: 5.4, z: 40.0 },
    color: 0xb65c42,
    material: 'brick_warm',
    label: 'Ost-Arkade Außenmauer',
  },
  {
    id: 'ws_east_chicane_south',
    pos: { x: 40.2, y: 1.5, z: 21.5 },
    size: { x: 6.4, y: 3.0, z: 1.5 },
    color: 0xcfbda0,
    material: 'stone_sand',
    label: 'Ost-Arkade Süd-Blende',
  },
  {
    id: 'ws_east_chicane_mid',
    pos: { x: 50.8, y: 1.35, z: 10.5 },
    size: { x: 7.4, y: 2.7, z: 2.4 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Ost-Arkade Ziegelblock',
  },
  {
    id: 'ws_east_timber_crates',
    pos: { x: 39.8, y: 1.0, z: 2.8 },
    size: { x: 2.2, y: 2.0, z: 2.2 },
    color: 0x855c38,
    material: 'timber_beam',
    label: 'Arkaden-Kisten',
  },
  // Turm-Passage archway from Kanal-Mitte into Zone B
  {
    id: 'ws_mid_to_b_arch',
    pos: { x: 21.5, y: 4.5, z: 7.2 },
    size: { x: 1.6, y: 1.4, z: 9.6 },
    color: 0xc9653c,
    material: 'terracotta',
    label: 'Turm-Passage Bogen',
  },
  {
    id: 'ws_mid_to_b_halfwall',
    pos: { x: 26.8, y: 0.6, z: 1.8 },
    size: { x: 0.9, y: 1.2, z: 3.2 },
    color: 0xcfbda0,
    material: 'stone_sand',
    label: 'Turm-Passage Halbwand',
  },

  // Elevated Turm-Terrasse (y = 2.2) on East side of Zone B + South & North walkable ramps
  {
    id: 'ws_site_b_terrace_deck',
    pos: { x: 45.5, y: 1.1, z: -11.5 },
    size: { x: 5.0, y: 2.2, z: 12.0 },
    color: 0xd1bfa3,
    material: 'stone_sand',
    label: 'Turm-Terrasse',
  },
  {
    id: 'ws_site_b_terrace_parapet',
    pos: { x: 43.2, y: 2.75, z: -14.2 },
    size: { x: 0.45, y: 1.1, z: 4.4 },
    color: 0xc9653c,
    material: 'terracotta',
    label: 'Terrassen-Brüstung',
  },
  makeRampZ(
    'ws_site_b_ramp_south',
    45.5,
    3.8,
    -5.5,
    2.2,
    1.3,
    0.0,
    0.32,
    0xc9653c,
    'terracotta',
    'Aufgang Turm-Terrasse Süd',
  ),
  makeRampZ(
    'ws_site_b_ramp_north',
    45.5,
    3.8,
    -24.3,
    0.0,
    -17.5,
    2.2,
    0.32,
    0xcab89b,
    'stone_sand',
    'Verteidiger-Aufgang Terrasse',
  ),

  // Iconic Landmark: Der Uhrenturm (north-east corner outside the 11x11 plant zone)
  {
    id: 'ws_clocktower_shaft',
    pos: { x: 45.5, y: 6.5, z: -28.0 },
    size: { x: 5.4, y: 13.0, z: 5.4 },
    color: 0xb65c42,
    material: 'brick_warm',
    label: 'Uhrenturm',
  },
  {
    id: 'ws_clocktower_belfry',
    pos: { x: 45.5, y: 13.8, z: -28.0 },
    size: { x: 6.0, y: 1.6, z: 6.0 },
    color: 0xc9653c,
    material: 'terracotta',
    collider: false,
    label: 'Uhrenturm-Dachkranz',
  },
  {
    id: 'ws_clocktower_dial_south',
    pos: { x: 45.5, y: 10.6, z: -25.22 },
    size: { x: 2.4, y: 2.4, z: 0.14 },
    color: 0x38e2d8,
    material: 'holo_screen',
    collider: false,
    label: 'Turmuhr Südseite',
  },

  // Zone B ("Uhrenturm-Platz", center +36, 0, -12 kept completely open for Kern planting!)
  {
    id: 'ws_site_b_obelisk_plinth',
    pos: { x: 39.4, y: 1.35, z: -15.0 },
    size: { x: 2.4, y: 2.7, z: 2.4 },
    color: 0xd4c2a6,
    material: 'stone_sand',
    label: 'Brunnen-Sockel Zone B',
  },
  {
    id: 'ws_site_b_brick_halfwall',
    pos: { x: 32.6, y: 0.6, z: -8.8 },
    size: { x: 2.6, y: 1.2, z: 1.4 },
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Ziegel-Deckung Zone B',
  },

  // =========================================================================
  // NORD-KONTOR / VERTEIDIGER-START (z: -59..-36, open spawn plaza around z = -46..-52)
  // =========================================================================
  {
    id: 'ws_spawn_n_back_wall',
    pos: { x: 0, y: 2.4, z: -58.2 },
    size: { x: 24.0, y: 4.8, z: 1.6 },
    color: 0xcfbda0,
    material: 'stone_sand',
    label: 'Nord-Kontor Fassade',
  },
  {
    id: 'ws_spawn_n_cornice',
    pos: { x: 0, y: 4.98, z: -58.1 },
    size: { x: 24.8, y: 0.36, z: 2.0 },
    color: 0xc9653c,
    material: 'terracotta',
    collider: false,
  },
  {
    id: 'ws_def_b_rotation_screen',
    pos: { x: 33.5, y: 1.35, z: -29.8 },
    size: { x: 5.6, y: 2.7, z: 2.2 },
    rotY: 0.15,
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Verteidiger-Rotation B Mauer',
  },
  // Süd-Markt Vorplatz Kistenstapel (Angreifer-Vorplatz z = +40)
  {
    id: 'ws_spawn_s_crate_stack_west',
    pos: { x: -20.5, y: 0.7, z: 40.0 },
    size: { x: 2.4, y: 1.4, z: 2.4 },
    color: 0x8b623c,
    material: 'timber_beam',
    label: 'Marktplatz Kistenstapel West',
  },
  {
    id: 'ws_spawn_s_crate_stack_east',
    pos: { x: 20.5, y: 0.7, z: 40.0 },
    size: { x: 2.4, y: 1.4, z: 2.4 },
    color: 0x8b623c,
    material: 'timber_beam',
    label: 'Marktplatz Kistenstapel Ost',
  },
  // Nord-Kontor Rotations-Deckung West
  {
    id: 'ws_def_a_rotation_screen',
    pos: { x: -33.5, y: 1.35, z: -29.8 },
    size: { x: 5.6, y: 2.7, z: 2.2 },
    rotY: -0.15,
    color: 0xb85e43,
    material: 'brick_warm',
    label: 'Verteidiger-Rotation A Mauer',
  },
];

const WERKSTADT_ZONES: MapZone[] = [
  {
    id: 'ws_zone_spawn_attacker',
    label: 'SÜD-MARKT (ANGREIFER)',
    type: 'spawn_attacker',
    center: { x: 0, y: 0, z: 47 },
    size: { x: 20, z: 14 },
    color: 0xff6b2b,
  },
  {
    id: 'ws_zone_spawn_defender',
    label: 'NORD-KONTOR (VERTEIDIGER)',
    type: 'spawn_defender',
    center: { x: 0, y: 0, z: -47 },
    size: { x: 20, z: 14 },
    color: 0x18d4c9,
  },
  {
    id: 'ws_zone_kern_a',
    label: 'KERN-ZONE A · GIESSEREI-HOF',
    type: 'kern_site_a',
    center: { x: -36, y: 0, z: -13 },
    size: { x: 11, z: 11 },
    color: 0xff6b2b,
  },
  {
    id: 'ws_zone_kern_b',
    label: 'KERN-ZONE B · UHRENTURM-PLATZ',
    type: 'kern_site_b',
    center: { x: 36, y: 0, z: -12 },
    size: { x: 11, z: 11 },
    color: 0x18d4c9,
  },
];

const WERKSTADT_SPAWN_BARRIERS: SpawnBarrierDef[] = [
  {
    id: 'ws_barrier_a_west',
    team: 'A',
    pos: { x: -41.0, y: 2.6, z: 35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'ws_barrier_a_mid',
    team: 'A',
    pos: { x: 0.0, y: 2.6, z: 35.5 },
    size: { x: 44.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'ws_barrier_a_east',
    team: 'A',
    pos: { x: 41.0, y: 2.6, z: 35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'ws_barrier_d_west',
    team: 'D',
    pos: { x: -41.0, y: 2.6, z: -35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'ws_barrier_d_mid',
    team: 'D',
    pos: { x: 0.0, y: 2.6, z: -35.5 },
    size: { x: 44.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'ws_barrier_d_east',
    team: 'D',
    pos: { x: 41.0, y: 2.6, z: -35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
];

const WERKSTADT_CALLOUTS: MapCallout[] = [
  { id: 'ws_call_spawn_a', label: 'Süd-Markt', pos: { x: 0, y: 0, z: 47 } },
  { id: 'ws_call_mid_bridge', label: 'Kanal-Brücke', pos: { x: 0, y: 0.2, z: 2 } },
  { id: 'ws_call_a_main', label: 'West-Allee', pos: { x: -46, y: 0, z: 14 } },
  { id: 'ws_call_site_a', label: 'Gießerei-Hof', pos: { x: -36, y: 0, z: -13 } },
  { id: 'ws_call_a_empore', label: 'Gießerei-Empore', pos: { x: -25.2, y: 2.2, z: -13 } },
  { id: 'ws_call_b_main', label: 'Ost-Arkade', pos: { x: 46, y: 0, z: 14 } },
  { id: 'ws_call_site_b', label: 'Uhrenturm-Platz', pos: { x: 36, y: 0, z: -12 } },
  { id: 'ws_call_b_terrace', label: 'Turm-Terrasse', pos: { x: 45.5, y: 2.2, z: -11.5 } },
  { id: 'ws_call_spawn_d', label: 'Nord-Kontor', pos: { x: 0, y: 0, z: -47 } },
];

const WERKSTADT_DUMMIES: DummySpawnDef[] = [
  {
    id: 'ws_dummy_mid_bridge',
    pos: { x: 0.0, y: 0.14, z: 10.8 },
    yaw: Math.PI,
    patrolAmplitude: 2.2,
    patrolAxis: 'x',
    patrolSpeed: 1.8,
  },
  {
    id: 'ws_dummy_mid_north',
    pos: { x: -6.4, y: 0, z: -7.5 },
    yaw: Math.PI,
  },
  {
    id: 'ws_dummy_west_allee',
    pos: { x: -47.0, y: 0, z: 11.5 },
    yaw: Math.PI,
    patrolAmplitude: 2.4,
    patrolAxis: 'x',
    patrolSpeed: 2.0,
  },
  {
    id: 'ws_dummy_site_a_center',
    pos: { x: -36.0, y: 0, z: -13.0 },
    yaw: Math.PI * 0.9,
  },
  {
    id: 'ws_dummy_site_a_empore',
    pos: { x: -25.2, y: 2.2, z: -14.8 },
    yaw: Math.PI * 0.72,
  },
  {
    id: 'ws_dummy_east_arcade',
    pos: { x: 46.8, y: 0, z: 16.0 },
    yaw: Math.PI,
    patrolAmplitude: 2.3,
    patrolAxis: 'x',
    patrolSpeed: 1.9,
  },
  {
    id: 'ws_dummy_turm_passage',
    pos: { x: 24.5, y: 0, z: 6.8 },
    yaw: -Math.PI * 0.65,
  },
  {
    id: 'ws_dummy_site_b_center',
    pos: { x: 36.0, y: 0, z: -12.0 },
    yaw: -Math.PI * 0.88,
  },
  {
    id: 'ws_dummy_site_b_terrace',
    pos: { x: 45.5, y: 2.2, z: -9.5 },
    yaw: -Math.PI * 0.7,
  },
];

export const WERKSTADT_MAP: MapDefinition = {
  id: 'werkstadt',
  name: 'Werkstadt',
  subtitle: 'Sonnige Kanal- & Altstadt-Manufaktur · 120×120m Taktik-Karte',
  theme: 'oldtown',
  bounds: { width: 124, depth: 124 },
  playerSpawn: {
    pos: { x: 0, y: 0.05, z: 47 },
    yaw: 0,
  },
  blocks: [
    ...WERKSTADT_BLOCKS,
    ...makeSharedSetPieces({
      prefix: 'ws_sp',
      siteADeck: { westX: -27.6, topY: 2.2 },
      siteBDeck: { westX: 43.0, topY: 2.2 },
      eastWallInnerX: 55.7,
      crate: { material: 'timber_beam', color: 0x8b623c },
      crateAlt: { material: 'stone_sand', color: 0xcab89b },
      platform: { material: 'stone_sand', color: 0xd1bfa3 },
      parapet: { material: 'brick_warm', color: 0xb65c42 },
      vehicleBody: { material: 'timber_beam', color: 0x855c38 },
      vehicleCab: { material: 'terracotta', color: 0xc8643b },
    }),
  ],
  zones: WERKSTADT_ZONES,
  dummySpawns: WERKSTADT_DUMMIES,
  spawnBarriers: WERKSTADT_SPAWN_BARRIERS,
  callouts: WERKSTADT_CALLOUTS,
};
