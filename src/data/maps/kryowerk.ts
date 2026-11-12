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

const KRYOWERK_BLOCKS: MapBlock[] = [
  // =========================================================================
  // BASE FLOOR (124 x 124 m arctic station tarmac, top surface at exact y = 0)
  // & PERIMETER MODULES (h = 8.5 m high-contrast white/slate arctic_panel)
  // =========================================================================
  {
    id: 'kw_floor_main',
    pos: { x: 0, y: -0.5, z: 0 },
    size: { x: 124, y: 1.0, z: 124 },
    color: 0x455261,
    material: 'concrete',
    label: 'Polarstation Plattform',
  },
  {
    id: 'kw_perim_north',
    pos: { x: 0, y: 4.25, z: -61.0 },
    size: { x: 124, y: 8.5, z: 2.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Nord-Stationswand',
  },
  {
    id: 'kw_perim_south',
    pos: { x: 0, y: 4.25, z: 61.0 },
    size: { x: 124, y: 8.5, z: 2.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Süd-Stationswand',
  },
  {
    id: 'kw_perim_west',
    pos: { x: -61.0, y: 4.25, z: 0 },
    size: { x: 2.0, y: 8.5, z: 120 },
    color: 0xd3dfe9,
    material: 'arctic_panel',
    label: 'West-Reaktorwand',
  },
  {
    id: 'kw_perim_east',
    pos: { x: 61.0, y: 4.25, z: 0 },
    size: { x: 2.0, y: 8.5, z: 120 },
    color: 0xd3dfe9,
    material: 'arctic_panel',
    label: 'Ost-Kaibegrenzung',
  },
  // Decorative polar ice-water trench outside East quay (non-colliding visual detail)
  {
    id: 'kw_polar_sea_decor_east',
    pos: { x: 66.0, y: -0.25, z: -6.0 },
    size: { x: 7.5, y: 0.2, z: 88.0 },
    color: 0x1e6078,
    material: 'water_dock',
    collider: false,
  },

  // =========================================================================
  // SÜD-HANGAR / ANGREIFER-START (z: +36..+59, open spawn bay around z = +46..+52)
  // =========================================================================
  {
    id: 'kw_spawn_s_hangar_wall',
    pos: { x: 0, y: 2.5, z: 58.2 },
    size: { x: 24.0, y: 5.0, z: 1.6 },
    color: 0xe3ecf5,
    material: 'arctic_panel',
    label: 'Süd-Hangar Rückwand',
  },
  {
    id: 'kw_spawn_s_holo_banner',
    pos: { x: 0, y: 3.4, z: 57.3 },
    size: { x: 7.2, y: 1.1, z: 0.14 },
    color: 0x35e0d8,
    material: 'holo_screen',
    collider: false,
    label: 'Süd-Hangar Statusanzeige',
  },
  {
    id: 'kw_spawn_s_cryo_pod_w',
    pos: { x: -16.2, y: 1.35, z: 49.0 },
    size: { x: 3.0, y: 2.7, z: 6.4 },
    rotY: 0.16,
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Süd-Hangar Modul West',
  },
  {
    id: 'kw_spawn_s_cryo_pod_e',
    pos: { x: 16.2, y: 1.35, z: 49.0 },
    size: { x: 3.0, y: 2.7, z: 6.4 },
    rotY: -0.16,
    color: 0xd9652b,
    material: 'container_orange',
    label: 'Süd-Hangar Modul Ost',
  },

  // Süd-Schott Portal framing entry into Mittel-Röhre & Kesselraum (8.6m clear doorway)
  {
    id: 'kw_mid_south_bulkhead_w',
    pos: { x: -9.1, y: 2.7, z: 31.5 },
    size: { x: 9.6, y: 5.4, z: 1.6 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Süd-Schott West',
  },
  {
    id: 'kw_mid_south_bulkhead_e',
    pos: { x: 9.1, y: 2.7, z: 31.5 },
    size: { x: 9.6, y: 5.4, z: 1.6 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Süd-Schott Ost',
  },
  {
    id: 'kw_mid_south_bulkhead_header',
    pos: { x: 0, y: 4.6, z: 31.5 },
    size: { x: 8.6, y: 1.6, z: 1.8 },
    color: 0x3b4958,
    material: 'metal',
    label: 'Süd-Schott Träger',
  },

  // =========================================================================
  // STRUCTURAL RESEARCH MODULES (Separating A-Schleuse, Mid, and Polar-Schneise)
  // =========================================================================
  {
    id: 'kw_module_sw_cryolab',
    pos: { x: -23.5, y: 3.0, z: 22.5 },
    size: { x: 19.0, y: 6.0, z: 19.0 },
    color: 0xe2ebf4,
    material: 'arctic_panel',
    label: 'Kryo-Modul Südwest',
  },
  {
    id: 'kw_module_se_storage',
    pos: { x: 24.5, y: 3.0, z: 22.5 },
    size: { x: 21.0, y: 6.0, z: 19.0 },
    color: 0xd8e3ee,
    material: 'arctic_panel',
    label: 'Versorgungs-Modul Südost',
  },
  // North-West & North-East dividers leaving wide 9.6m connectors at z: +2..+12
  {
    id: 'kw_module_nw_divider',
    pos: { x: -18.2, y: 2.9, z: -9.5 },
    size: { x: 7.4, y: 5.8, z: 23.0 },
    color: 0xdbe6f0,
    material: 'arctic_panel',
    label: 'Reaktor-Trennmodul',
  },
  {
    id: 'kw_module_ne_divider',
    pos: { x: 18.5, y: 2.9, z: -9.5 },
    size: { x: 8.2, y: 5.8, z: 23.0 },
    color: 0xdbe6f0,
    material: 'arctic_panel',
    label: 'Kran-Trennmodul',
  },

  // =========================================================================
  // CENTER: MITTEL-RÖHRE & KESSELRAUM (x: -14..+14, z: -26..+26)
  // =========================================================================
  // Mittel-Röhre overhead conduit arches & elevated catwalk on West-Mid
  {
    id: 'kw_mid_tube_deck',
    pos: { x: -10.2, y: 0.7, z: -2.0 },
    size: { x: 4.8, y: 1.4, z: 8.6 },
    color: 0x4b5868,
    material: 'metal',
    label: 'Mittel-Röhre Steg',
  },
  makeRampZ(
    'kw_mid_tube_ramp_south',
    -10.2,
    3.6,
    2.3,
    1.4,
    6.9,
    0.0,
    0.3,
    0xcad8e6,
    'arctic_panel',
    'Aufgang Mittel-Röhre',
  ),
  {
    id: 'kw_mid_tube_arch_1',
    pos: { x: -10.2, y: 4.8, z: 1.5 },
    size: { x: 5.4, y: 0.7, z: 1.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    collider: false,
  },
  {
    id: 'kw_mid_tube_arch_2',
    pos: { x: -10.2, y: 4.8, z: -4.5 },
    size: { x: 5.4, y: 0.7, z: 1.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    collider: false,
  },
  // Kesselraum central geothermal boiler & solid frosted ice_glass partition
  {
    id: 'kw_mid_boiler_core',
    pos: { x: 2.2, y: 1.45, z: 7.2 },
    size: { x: 3.0, y: 2.9, z: 5.6 },
    rotY: 0.35,
    color: 0xd9652b,
    material: 'container_orange',
    label: 'Geothermie-Kessel',
  },
  {
    id: 'kw_mid_ice_partition',
    pos: { x: -1.8, y: 1.35, z: -5.2 },
    size: { x: 4.8, y: 2.7, z: 0.8 },
    color: 0x8fd6ef,
    material: 'ice_glass',
    label: 'Kesselraum Frostwand',
  },
  {
    id: 'kw_mid_east_valve_box',
    pos: { x: 8.6, y: 0.6, z: -1.2 },
    size: { x: 2.4, y: 1.2, z: 2.4 },
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'Ventilblock Ost',
  },
  {
    id: 'kw_mid_north_shield',
    pos: { x: 0.8, y: 1.5, z: -26.5 },
    size: { x: 6.6, y: 3.0, z: 1.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Nord-Kesselraum Blende',
  },

  // =========================================================================
  // WEST WING: A-SCHLEUSE & ZONE A ("REAKTOR-HALLE", -36, 0, -13)
  // =========================================================================
  {
    id: 'kw_aschleuse_divider',
    pos: { x: -40.5, y: 2.6, z: 14.0 },
    size: { x: 2.4, y: 5.2, z: 19.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'A-Schleuse Trennwand',
  },
  {
    id: 'kw_aschleuse_ice_baffle_s',
    pos: { x: -50.8, y: 1.35, z: 21.0 },
    size: { x: 4.6, y: 2.7, z: 0.9 },
    color: 0x8fd6ef,
    material: 'ice_glass',
    label: 'A-Schleuse Frostschild Süd',
  },
  {
    id: 'kw_aschleuse_cryo_crate',
    pos: { x: -46.0, y: 0.6, z: 7.2 },
    size: { x: 2.6, y: 1.2, z: 1.2 },
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'A-Schleuse Halbdeckung',
  },
  {
    id: 'kw_aschleuse_inner_module',
    pos: { x: -30.8, y: 1.35, z: 6.2 },
    size: { x: 2.6, y: 2.7, z: 4.8 },
    rotY: 0.28,
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'Vorraum-Modul A',
  },

  // Reaktor-Galerie (multi-tier elevated gallery at y = 2.4 overlooking Zone A) + 2 ramps
  {
    id: 'kw_site_a_gallery_deck',
    pos: { x: -25.0, y: 1.2, z: -13.0 },
    size: { x: 5.0, y: 2.4, z: 12.4 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Reaktor-Galerie',
  },
  {
    id: 'kw_site_a_gallery_ice_guard',
    pos: { x: -27.25, y: 2.95, z: -10.4 },
    size: { x: 0.45, y: 1.1, z: 4.6 },
    color: 0x8fd6ef,
    material: 'ice_glass',
    label: 'Galerie-Frostbrüstung',
  },
  makeRampZ(
    'kw_site_a_gallery_ramp_south',
    -25.0,
    3.8,
    -6.8,
    2.4,
    0.4,
    0.0,
    0.34,
    0xcad8e6,
    'arctic_panel',
    'Aufgang Reaktor-Galerie Süd',
  ),
  makeRampZ(
    'kw_site_a_gallery_ramp_north',
    -25.0,
    3.8,
    -26.4,
    0.0,
    -19.2,
    2.4,
    0.34,
    0x566474,
    'metal',
    'Verteidiger-Rampe Galerie',
  ),

  // Zone A ("Reaktor-Halle", center -36, 0, -13 kept completely open for Kern planting!)
  {
    id: 'kw_site_a_reactor_pylon',
    pos: { x: -39.8, y: 1.6, z: -9.6 },
    size: { x: 2.6, y: 3.2, z: 2.6 },
    color: 0xe6eff8,
    material: 'arctic_panel',
    label: 'Geothermie-Reaktorkern',
  },
  {
    id: 'kw_site_a_reactor_holo',
    pos: { x: -38.42, y: 1.9, z: -9.6 },
    size: { x: 0.14, y: 1.2, z: 1.6 },
    color: 0x35e0d8,
    material: 'holo_screen',
    collider: false,
    label: 'Reaktor-Telemetrie',
  },
  {
    id: 'kw_site_a_ice_halfshield',
    pos: { x: -32.4, y: 0.6, z: -16.4 },
    size: { x: 2.6, y: 1.2, z: 0.9 },
    color: 0x8fd6ef,
    material: 'ice_glass',
    label: 'Reaktor-Frostdeckung',
  },
  {
    id: 'kw_site_a_west_bay_wall',
    pos: { x: -46.8, y: 3.1, z: -13.0 },
    size: { x: 2.0, y: 6.2, z: 16.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Reaktor-Hallenwand West',
  },
  // Open-air reactor ceiling girders
  {
    id: 'kw_site_a_truss_1',
    pos: { x: -35.8, y: 7.8, z: -19.0 },
    size: { x: 22.0, y: 0.6, z: 0.8 },
    color: 0x455261,
    material: 'metal',
    collider: false,
  },
  {
    id: 'kw_site_a_truss_2',
    pos: { x: -35.8, y: 7.8, z: -13.0 },
    size: { x: 22.0, y: 0.6, z: 0.8 },
    color: 0x455261,
    material: 'metal',
    collider: false,
  },
  {
    id: 'kw_site_a_truss_3',
    pos: { x: -35.8, y: 7.8, z: -7.0 },
    size: { x: 22.0, y: 0.6, z: 0.8 },
    color: 0x455261,
    material: 'metal',
    collider: false,
  },
  {
    id: 'kw_def_a_lab_cover',
    pos: { x: -36.5, y: 1.35, z: -30.2 },
    size: { x: 5.8, y: 2.7, z: 2.4 },
    rotY: -0.15,
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Nord-Labor Deckung',
  },

  // =========================================================================
  // EAST WING: POLAR-SCHNEISE (LONG FALKE SIGHTLINE) & ZONE B ("VERLADEKRAN", +36, 0, -12)
  // =========================================================================
  // East quay safety wall along Polar-Schneise
  {
    id: 'kw_polar_quay_curb',
    pos: { x: 58.2, y: 0.65, z: 6.0 },
    size: { x: 1.2, y: 1.3, z: 58.0 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Ost-Kai Brüstung',
  },
  // Staggered cover along the long East sightline for Falke duels & rifle advances
  {
    id: 'kw_blang_south_container',
    pos: { x: 49.5, y: 1.35, z: 24.0 },
    size: { x: 2.8, y: 2.7, z: 6.0 },
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Polar-Schneise Süd-Container',
  },
  {
    id: 'kw_blang_ice_windbreak',
    pos: { x: 40.5, y: 1.35, z: 12.5 },
    size: { x: 3.8, y: 2.7, z: 0.9 },
    color: 0x8fd6ef,
    material: 'ice_glass',
    label: 'Polar-Schneise Frostwand',
  },
  {
    id: 'kw_blang_half_block',
    pos: { x: 51.8, y: 0.6, z: 2.5 },
    size: { x: 2.6, y: 1.2, z: 1.2 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Polar-Schneise Halbdeckung',
  },
  // Kesselraum-zu-B connector gate & half-wall
  {
    id: 'kw_mid_to_b_portal',
    pos: { x: 22.0, y: 4.6, z: 7.2 },
    size: { x: 1.4, y: 1.4, z: 9.8 },
    color: 0x455261,
    material: 'metal',
    label: 'Kesselraum-Tor B',
  },
  {
    id: 'kw_mid_to_b_ice_cover',
    pos: { x: 27.2, y: 0.6, z: 1.8 },
    size: { x: 0.8, y: 1.2, z: 3.4 },
    color: 0x8fd6ef,
    material: 'ice_glass',
    label: 'B-Verbinder Frostdeckung',
  },

  // Elevated Kran-Podest (y = 2.3) overlooking Zone B + South hazard ramp & North metal ramp
  {
    id: 'kw_site_b_crane_deck',
    pos: { x: 46.2, y: 1.15, z: -12.0 },
    size: { x: 5.2, y: 2.3, z: 12.8 },
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'Kran-Podest',
  },
  {
    id: 'kw_site_b_crane_railing',
    pos: { x: 43.8, y: 2.8, z: -14.8 },
    size: { x: 0.4, y: 1.0, z: 4.4 },
    color: 0x18d4c9,
    material: 'trim_teal',
    label: 'Kran-Podest Geländer',
  },
  makeRampZ(
    'kw_site_b_ramp_south',
    46.2,
    3.8,
    -5.6,
    2.3,
    1.4,
    0.0,
    0.34,
    0xcad8e6,
    'arctic_panel',
    'Aufgang Kran-Podest Süd',
  ),
  makeRampZ(
    'kw_site_b_ramp_north',
    46.2,
    3.8,
    -25.4,
    0.0,
    -18.4,
    2.3,
    0.34,
    0x566474,
    'metal',
    'Verteidiger-Rampe Kran-Podest',
  ),

  // Zone B ("Verladekran", center +36, 0, -12 kept completely open for Kern planting!)
  {
    id: 'kw_site_b_cargo_container',
    pos: { x: 32.2, y: 1.35, z: -15.2 },
    size: { x: 2.6, y: 2.7, z: 5.0 },
    rotY: -0.22,
    color: 0xd9652b,
    material: 'container_orange',
    label: 'Verladekran Hauptcontainer',
  },
  {
    id: 'kw_site_b_cryo_halfbox',
    pos: { x: 39.6, y: 0.6, z: -8.6 },
    size: { x: 2.2, y: 1.2, z: 2.0 },
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Verladekran Frachtkiste',
  },
  // Towering Polar Verladekran Gantry (legs outside 11x11 plant zone)
  {
    id: 'kw_site_b_gantry_leg_n',
    pos: { x: 52.0, y: 4.6, z: -19.5 },
    size: { x: 1.4, y: 9.2, z: 1.4 },
    color: 0xd48b28,
    material: 'hazard',
    label: 'Verladekran Stütze Nord',
  },
  {
    id: 'kw_site_b_gantry_leg_s',
    pos: { x: 52.0, y: 4.6, z: -4.5 },
    size: { x: 1.4, y: 9.2, z: 1.4 },
    color: 0xd48b28,
    material: 'hazard',
    label: 'Verladekran Stütze Süd',
  },
  {
    id: 'kw_site_b_gantry_boom',
    pos: { x: 43.0, y: 9.5, z: -12.0 },
    size: { x: 24.0, y: 1.0, z: 16.4 },
    color: 0x455261,
    material: 'metal',
    collider: false,
    label: 'Verladekran Ausleger',
  },

  // =========================================================================
  // NORD-FORSCHUNGSDOCK / VERTEIDIGER-START (z: -59..-36, open spawn bay around z = -46..-52)
  // =========================================================================
  {
    id: 'kw_spawn_n_dock_wall',
    pos: { x: 0, y: 2.5, z: -58.2 },
    size: { x: 24.0, y: 5.0, z: 1.6 },
    color: 0xe3ecf5,
    material: 'arctic_panel',
    label: 'Nord-Forschungsdock Wand',
  },
  {
    id: 'kw_spawn_n_holo_banner',
    pos: { x: 0, y: 3.4, z: -57.3 },
    size: { x: 7.2, y: 1.1, z: 0.14 },
    color: 0x35e0d8,
    material: 'holo_screen',
    collider: false,
    label: 'Nord-Dock Statusanzeige',
  },
  {
    id: 'kw_def_b_rotation_container',
    pos: { x: 34.0, y: 1.35, z: -30.4 },
    size: { x: 5.8, y: 2.7, z: 2.6 },
    rotY: 0.16,
    color: 0x3b4e61,
    material: 'container_slate',
    label: 'Verteidiger-Kranweg Container',
  },
  // Süd-Hof Kryo-Lagerkisten & Versorgungsstapel (Angreifer-Hangar Vorplatz)
  {
    id: 'kw_spawn_s_courtyard_pod',
    pos: { x: -20.5, y: 0.8, z: 39.5 },
    size: { x: 2.4, y: 1.6, z: 2.4 },
    color: 0xdce6f0,
    material: 'arctic_panel',
    label: 'Kryo-Depot Pod West',
  },
  {
    id: 'kw_spawn_s_courtyard_crate',
    pos: { x: 20.5, y: 0.7, z: 39.5 },
    size: { x: 2.4, y: 1.4, z: 2.4 },
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Kryo-Depot Container Ost',
  },
  // Nord-Forschungsdock Rotations-Deckung West
  {
    id: 'kw_def_a_rotation_container',
    pos: { x: -34.0, y: 1.35, z: -30.4 },
    size: { x: 5.8, y: 2.7, z: 2.6 },
    rotY: -0.16,
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Verteidiger-Reaktorweg Container',
  },
];

const KRYOWERK_ZONES: MapZone[] = [
  {
    id: 'kw_zone_spawn_attacker',
    label: 'SÜD-HANGAR (ANGREIFER)',
    type: 'spawn_attacker',
    center: { x: 0, y: 0, z: 47 },
    size: { x: 20, z: 14 },
    color: 0xff6b2b,
  },
  {
    id: 'kw_zone_spawn_defender',
    label: 'NORD-FORSCHUNGSDOCK (VERTEIDIGER)',
    type: 'spawn_defender',
    center: { x: 0, y: 0, z: -47 },
    size: { x: 20, z: 14 },
    color: 0x18d4c9,
  },
  {
    id: 'kw_zone_kern_a',
    label: 'KERN-ZONE A · REAKTOR-HALLE',
    type: 'kern_site_a',
    center: { x: -36, y: 0, z: -13 },
    size: { x: 11, z: 11 },
    color: 0xff6b2b,
  },
  {
    id: 'kw_zone_kern_b',
    label: 'KERN-ZONE B · VERLADEKRAN',
    type: 'kern_site_b',
    center: { x: 36, y: 0, z: -12 },
    size: { x: 11, z: 11 },
    color: 0x18d4c9,
  },
];

const KRYOWERK_SPAWN_BARRIERS: SpawnBarrierDef[] = [
  {
    id: 'kw_barrier_a_west',
    team: 'A',
    pos: { x: -41.0, y: 2.6, z: 35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'kw_barrier_a_mid',
    team: 'A',
    pos: { x: 0.0, y: 2.6, z: 35.5 },
    size: { x: 44.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'kw_barrier_a_east',
    team: 'A',
    pos: { x: 41.0, y: 2.6, z: 35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'kw_barrier_d_west',
    team: 'D',
    pos: { x: -41.0, y: 2.6, z: -35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'kw_barrier_d_mid',
    team: 'D',
    pos: { x: 0.0, y: 2.6, z: -35.5 },
    size: { x: 44.0, y: 5.2, z: 0.4 },
  },
  {
    id: 'kw_barrier_d_east',
    team: 'D',
    pos: { x: 41.0, y: 2.6, z: -35.5 },
    size: { x: 40.0, y: 5.2, z: 0.4 },
  },
];

const KRYOWERK_CALLOUTS: MapCallout[] = [
  { id: 'kw_call_spawn_a', label: 'Süd-Hangar', pos: { x: 0, y: 0, z: 47 } },
  { id: 'kw_call_mid_tube', label: 'Mittel-Röhre', pos: { x: -10.2, y: 1.4, z: -2 } },
  { id: 'kw_call_mid_boiler', label: 'Kesselraum', pos: { x: 2.5, y: 0, z: 2 } },
  { id: 'kw_call_a_airlock', label: 'A-Schleuse', pos: { x: -46, y: 0, z: 14 } },
  { id: 'kw_call_site_a', label: 'Reaktor-Halle', pos: { x: -36, y: 0, z: -13 } },
  { id: 'kw_call_a_gallery', label: 'Reaktor-Galerie', pos: { x: -25, y: 2.4, z: -13 } },
  { id: 'kw_call_b_long', label: 'Polar-Schneise', pos: { x: 47, y: 0, z: 14 } },
  { id: 'kw_call_site_b', label: 'Verladekran', pos: { x: 36, y: 0, z: -12 } },
  { id: 'kw_call_spawn_d', label: 'Nord-Forschungsdock', pos: { x: 0, y: 0, z: -47 } },
];

const KRYOWERK_DUMMIES: DummySpawnDef[] = [
  {
    id: 'kw_dummy_kesselraum_south',
    pos: { x: 2.0, y: 0, z: 17.5 },
    yaw: Math.PI,
    patrolAmplitude: 2.4,
    patrolAxis: 'x',
    patrolSpeed: 1.9,
  },
  {
    id: 'kw_dummy_mittel_roehre',
    pos: { x: -10.2, y: 1.4, z: -3.2 },
    yaw: Math.PI * 0.85,
  },
  {
    id: 'kw_dummy_aschleuse',
    pos: { x: -46.8, y: 0, z: 13.5 },
    yaw: Math.PI,
    patrolAmplitude: 2.4,
    patrolAxis: 'x',
    patrolSpeed: 2.0,
  },
  {
    id: 'kw_dummy_site_a_floor',
    pos: { x: -36.0, y: 0, z: -13.0 },
    yaw: Math.PI * 0.9,
  },
  {
    id: 'kw_dummy_site_a_gallery',
    pos: { x: -25.0, y: 2.4, z: -14.8 },
    yaw: Math.PI * 0.72,
  },
  {
    id: 'kw_dummy_polar_schneise_long',
    pos: { x: 46.5, y: 0, z: 18.0 },
    yaw: Math.PI,
    patrolAmplitude: 2.6,
    patrolAxis: 'x',
    patrolSpeed: 2.1,
  },
  {
    id: 'kw_dummy_polar_schneise_north',
    pos: { x: 46.5, y: 0, z: -4.0 },
    yaw: Math.PI,
  },
  {
    id: 'kw_dummy_site_b_floor',
    pos: { x: 36.0, y: 0, z: -12.0 },
    yaw: -Math.PI * 0.88,
  },
  {
    id: 'kw_dummy_site_b_crane_deck',
    pos: { x: 46.2, y: 2.3, z: -9.6 },
    yaw: -Math.PI * 0.7,
  },
];

export const KRYOWERK_MAP: MapDefinition = {
  id: 'kryowerk',
  name: 'Kryowerk',
  subtitle: 'Arktische Geothermie- & Polarstation · 120×120m Taktik-Karte',
  theme: 'arctic',
  bounds: { width: 124, depth: 124 },
  playerSpawn: {
    pos: { x: 0, y: 0.05, z: 47 },
    yaw: 0,
  },
  blocks: [
    ...KRYOWERK_BLOCKS,
    ...makeSharedSetPieces({
      prefix: 'kw_sp',
      siteADeck: { westX: -27.5, topY: 2.4 },
      siteBDeck: { westX: 43.6, topY: 2.25 },
      eastWallInnerX: 57.6,
      crate: { material: 'container_teal', color: 0x2c6f7a },
      crateAlt: { material: 'container_slate', color: 0x3b4e61 },
      platform: { material: 'arctic_panel', color: 0xdce6f0 },
      parapet: { material: 'ice_glass', color: 0x8fd6ef },
      vehicleBody: { material: 'container_orange', color: 0xd9652b },
      vehicleCab: { material: 'metal', color: 0x455261 },
    }),
  ],
  zones: KRYOWERK_ZONES,
  dummySpawns: KRYOWERK_DUMMIES,
  spawnBarriers: KRYOWERK_SPAWN_BARRIERS,
  callouts: KRYOWERK_CALLOUTS,
};
