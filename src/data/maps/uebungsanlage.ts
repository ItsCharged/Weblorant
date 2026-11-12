import type { Vec3 } from '../../core/types';
import type {
  DistanceLineDef,
  DummySpawnDef,
  MapBlock,
  MapCallout,
  MapDefinition,
  MapZone,
  RangeControlButton,
} from './types';

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

const UEBUNGSANLAGE_BLOCKS: MapBlock[] = [
  // =========================================================================
  // MAIN BRICK & TIMBER FIRING HALL (x: -24..+24, z: -56..+24, top surface y = 0)
  // =========================================================================
  {
    id: 'range_floor_main',
    pos: { x: 0, y: -0.5, z: -16 },
    size: { x: 48, y: 1.0, z: 80 },
    color: 0x464e57,
    material: 'floor',
    label: 'Hallenboden',
  },

  // Warm Brick Perimeter Walls (West wall features an 8m sunlit archway at z = +3..+11)
  {
    id: 'range_wall_north',
    pos: { x: 0, y: 4.5, z: -56.5 },
    size: { x: 50, y: 9.0, z: 1.0 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Nordwand Kugelfang',
  },
  {
    id: 'range_wall_south',
    pos: { x: 0, y: 4.5, z: 24.5 },
    size: { x: 50, y: 9.0, z: 1.0 },
    color: 0xb35a40,
    material: 'brick_warm',
    label: 'Südwand',
  },
  {
    id: 'range_wall_west_north_seg',
    pos: { x: -24.5, y: 4.5, z: -26.5 },
    size: { x: 1.0, y: 9.0, z: 59.0 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Westwand Nordabschnitt',
  },
  {
    id: 'range_wall_west_south_seg',
    pos: { x: -24.5, y: 4.5, z: 17.5 },
    size: { x: 1.0, y: 9.0, z: 13.0 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Westwand Südabschnitt',
  },
  {
    id: 'range_wall_west_arch_lintel',
    pos: { x: -24.5, y: 6.6, z: 7.0 },
    size: { x: 1.2, y: 4.8, z: 8.0 },
    color: 0xc8643b,
    material: 'terracotta',
    label: 'Torbogen zum Außenhof',
  },
  {
    id: 'range_wall_east',
    pos: { x: 24.5, y: 4.5, z: -16 },
    size: { x: 1.0, y: 9.0, z: 80 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Ostwand',
  },

  // High-contrast backstop trim & terracotta wall cornice
  {
    id: 'range_north_trim',
    pos: { x: 0, y: 1.6, z: -55.92 },
    size: { x: 46, y: 0.24, z: 0.14 },
    color: 0xff6b2b,
    material: 'trim_orange',
    collider: false,
  },
  {
    id: 'range_north_cornice',
    pos: { x: 0, y: 8.85, z: -56.4 },
    size: { x: 50, y: 0.34, z: 1.3 },
    color: 0xc8643b,
    material: 'terracotta',
    collider: false,
  },

  // Open-air Timber Roof Trusses & Wall Pilasters letting warm daylight into the hall
  {
    id: 'range_beam_1',
    pos: { x: 0, y: 8.65, z: 10 },
    size: { x: 48, y: 0.58, z: 0.72 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'range_beam_2',
    pos: { x: 0, y: 8.65, z: -4 },
    size: { x: 48, y: 0.58, z: 0.72 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'range_beam_3',
    pos: { x: 0, y: 8.65, z: -18 },
    size: { x: 48, y: 0.58, z: 0.72 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'range_beam_4',
    pos: { x: 0, y: 8.65, z: -32 },
    size: { x: 48, y: 0.58, z: 0.72 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'range_beam_5',
    pos: { x: 0, y: 8.65, z: -46 },
    size: { x: 48, y: 0.58, z: 0.72 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'range_ridge_purlin_west',
    pos: { x: -11.5, y: 8.95, z: -16 },
    size: { x: 0.45, y: 0.42, z: 78 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  {
    id: 'range_ridge_purlin_east',
    pos: { x: 11.5, y: 8.95, z: -16 },
    size: { x: 0.45, y: 0.42, z: 78 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },

  // =========================================================================
  // SHOOTING BOOTH COUNTER, ANGLED HOLO CONSOLE & CONTROL GANTRY
  // =========================================================================
  // Waist-high shooting counter at z = 9.8 (open walkthroughs at x < -4.6 and x > +4.6)
  {
    id: 'range_booth_desk',
    pos: { x: 0, y: 0.5, z: 9.8 },
    size: { x: 9.2, y: 1.0, z: 0.85 },
    color: 0xa8553d,
    material: 'brick_warm',
    label: 'Schießpult',
  },
  {
    id: 'range_booth_countertop',
    pos: { x: 0, y: 1.03, z: 9.8 },
    size: { x: 9.36, y: 0.08, z: 0.94 },
    color: 0x7c5333,
    material: 'timber_beam',
    collider: false,
  },
  // Angled glowing cyan Holo-Console mounted low on right side of desk
  // (y = 1.18, x = +2.15 — zero occlusion of rangeButtons at z = 7.62 or scoreboardPos at y = 4.25!)
  {
    id: 'range_booth_holo_pedestal',
    pos: { x: 2.15, y: 1.11, z: 9.65 },
    size: { x: 1.36, y: 0.1, z: 0.48 },
    color: 0x2f3944,
    material: 'metal',
    collider: false,
  },
  {
    id: 'range_booth_holo_screen',
    pos: { x: 2.15, y: 1.24, z: 9.62 },
    size: { x: 1.26, y: 0.36, z: 0.06 },
    rotX: -0.58,
    color: 0x35e0d8,
    material: 'holo_screen',
    collider: false,
    label: 'Steuerpult-Anzeige',
  },
  // Weapon rack side table on far right end of counter
  {
    id: 'range_booth_side_rack',
    pos: { x: 3.7, y: 1.12, z: 9.85 },
    size: { x: 1.4, y: 0.1, z: 0.52 },
    color: 0x2f3944,
    material: 'metal',
    collider: false,
  },

  // Booth framing pillars & top gantry at z = 7.35 (buttons protrude to z = 7.62, scoreboard sits cleanly above at y = 4.25)
  {
    id: 'range_booth_pillar_left',
    pos: { x: -3.48, y: 1.42, z: 7.35 },
    size: { x: 0.38, y: 2.84, z: 0.28 },
    color: 0x394452,
    material: 'metal',
    label: 'Steuersäule Links',
  },
  {
    id: 'range_booth_pillar_right',
    pos: { x: 3.48, y: 1.42, z: 7.35 },
    size: { x: 0.38, y: 2.84, z: 0.28 },
    color: 0x394452,
    material: 'metal',
    label: 'Steuersäule Rechts',
  },
  {
    id: 'range_booth_header_beam',
    pos: { x: 0, y: 2.74, z: 7.35 },
    size: { x: 7.34, y: 0.2, z: 0.28 },
    color: 0x394452,
    material: 'metal',
  },
  {
    id: 'range_booth_top_mount',
    pos: { x: 0, y: 2.42, z: 7.35 },
    size: { x: 3.6, y: 0.48, z: 0.26 },
    color: 0x26303a,
    material: 'metal',
    collider: false,
  },

  // =========================================================================
  // LEFT WING (x = -16, z = -2): DEDICATED RECOIL SPRAY-TEST WALL (14m)
  // =========================================================================
  {
    id: 'range_spray_wall_frame',
    pos: { x: -16, y: 2.45, z: -2.35 },
    size: { x: 6.6, y: 4.9, z: 0.4 },
    color: 0x45505e,
    material: 'metal',
    label: 'Rückstoß-Wand Rahmen',
  },
  {
    id: 'range_spray_wall_board',
    pos: { x: -16, y: 2.45, z: -2.05 },
    size: { x: 6.0, y: 4.5, z: 0.2 },
    color: 0xe8edf2,
    material: 'spray_board',
    label: 'Spray-Wand (14m)',
  },
  {
    id: 'range_spray_stand_marker',
    pos: { x: -16, y: 0.005, z: 12.05 },
    size: { x: 2.8, y: 0.01, z: 1.6 },
    color: 0x18d4c9,
    material: 'trim_teal',
    collider: false,
    label: '14m Spray-Standplatz',
  },

  // Left-mid elevated bot platform (~34m)
  {
    id: 'range_elevated_target_deck',
    pos: { x: -8.2, y: 1.1, z: -24.2 },
    size: { x: 6.2, y: 2.2, z: 3.6 },
    color: 0x2c6f7a,
    material: 'container_teal',
    label: 'Erhöhte Zielplattform',
  },
  {
    id: 'range_elevated_target_trim',
    pos: { x: -8.2, y: 2.15, z: -22.34 },
    size: { x: 6.2, y: 0.1, z: 0.1 },
    color: 0x18d4c9,
    material: 'trim_teal',
    collider: false,
  },

  // Low cover boxes in firing hall (off dummy sightlines)
  {
    id: 'range_peek_box_west',
    pos: { x: -9.8, y: 0.9, z: -8.5 },
    size: { x: 1.8, y: 1.8, z: 1.8 },
    color: 0xb8844a,
    material: 'wood',
    label: 'Deckungskiste West',
  },
  {
    id: 'range_halfwall_east',
    pos: { x: 8.6, y: 0.65, z: -14.5 },
    size: { x: 2.6, y: 1.3, z: 0.7 },
    color: 0xcab89b,
    material: 'stone_sand',
    label: 'Halbhohe Deckung',
  },

  // =========================================================================
  // RIGHT WING (x = +15, z = +10..-22): CRATES, RAMP CLIMB & RIFLE PERCH
  // =========================================================================
  {
    id: 'range_right_crate_cluster_a',
    pos: { x: 11.2, y: 0.65, z: 9.2 },
    size: { x: 2.0, y: 1.3, z: 2.0 },
    color: 0xba874d,
    material: 'wood',
    label: 'Munitionskiste Rechts',
  },
  {
    id: 'range_right_crate_cluster_b',
    pos: { x: 13.0, y: 1.05, z: 9.6 },
    size: { x: 1.8, y: 2.1, z: 1.8 },
    color: 0x855c38,
    material: 'timber_beam',
  },
  makeRampZ(
    'range_parkour_ramp_1',
    15.5,
    3.6,
    0.5,
    1.6,
    5.8,
    0.0,
    0.32,
    0x855c38,
    'timber_beam',
    'Aufgang Rampe 1',
  ),
  {
    id: 'range_parkour_deck_1',
    pos: { x: 15.5, y: 0.8, z: -2.5 },
    size: { x: 4.6, y: 1.6, z: 6.0 },
    color: 0x855c38,
    material: 'timber_beam',
    label: 'Fachwerk-Galerie 1',
  },
  makeRampZ(
    'range_parkour_ramp_2',
    16.2,
    3.4,
    -11.5,
    3.2,
    -5.5,
    1.6,
    0.32,
    0x6a7685,
    'metal',
    'Aufgang Rampe 2',
  ),
  {
    id: 'range_parkour_sniper_perch',
    pos: { x: 15.5, y: 1.6, z: -15.2 },
    size: { x: 5.8, y: 3.2, z: 7.4 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Schützen-Turm',
  },
  {
    id: 'range_parkour_perch_parapet',
    pos: { x: 13.0, y: 3.68, z: -15.2 },
    size: { x: 0.45, y: 0.96, z: 6.8 },
    color: 0xcab89b,
    material: 'stone_sand',
  },
  {
    id: 'range_parkour_crate_step_a',
    pos: { x: 20.2, y: 0.55, z: -5.2 },
    size: { x: 2.2, y: 1.1, z: 2.2 },
    color: 0xba874d,
    material: 'wood',
  },
  {
    id: 'range_parkour_crate_step_b',
    pos: { x: 20.4, y: 1.1, z: -9.0 },
    size: { x: 2.4, y: 2.2, z: 2.4 },
    color: 0x2c6f7a,
    material: 'container_teal',
  },
  {
    id: 'range_back_container_decor',
    pos: { x: 16.8, y: 1.4, z: -38.0 },
    size: { x: 3.2, y: 2.8, z: 7.5 },
    rotY: -0.22,
    color: 0x3b4e61,
    material: 'container_slate',
  },

  // =========================================================================
  // SUNNY OUTDOOR COURTYARD & PIER PARKOUR (x: -54..-24, z: -26..+24)
  // Accessed via the 8m West Brick Archway at (x = -24.5, z = +3..+11)
  // =========================================================================
  {
    id: 'range_courtyard_threshold',
    pos: { x: -24.5, y: -0.5, z: 7.0 },
    size: { x: 1.0, y: 1.0, z: 8.0 },
    color: 0xd8c7ad,
    material: 'stone_sand',
    label: 'Torbogen-Schwelle',
  },
  {
    id: 'range_courtyard_floor',
    pos: { x: -39.5, y: -0.5, z: -1.0 },
    size: { x: 29.0, y: 1.0, z: 50.0 },
    color: 0xd8c7ad,
    material: 'stone_sand',
    label: 'Sonniger Außenhof',
  },
  // Outer safety boundary around outdoor courtyard (sealed cleanly so player stays inside)
  {
    id: 'range_courtyard_wall_west',
    pos: { x: -54.5, y: 4.0, z: -1.0 },
    size: { x: 1.0, y: 8.0, z: 52.0 },
    color: 0xcab89b,
    material: 'stone_sand',
    label: 'Außenhof Westmauer',
  },
  {
    id: 'range_courtyard_wall_south',
    pos: { x: -39.5, y: 4.0, z: 24.5 },
    size: { x: 29.0, y: 8.0, z: 1.0 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Außenhof Südmauer',
  },
  {
    id: 'range_courtyard_wall_north',
    pos: { x: -39.5, y: 4.0, z: -26.5 },
    size: { x: 29.0, y: 8.0, z: 1.0 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Außenhof Nordmauer',
  },
  {
    id: 'range_courtyard_coping_west',
    pos: { x: -54.45, y: 8.16, z: -1.0 },
    size: { x: 1.3, y: 0.32, z: 52.0 },
    color: 0xc8643b,
    material: 'terracotta',
    collider: false,
  },

  // Harbor Water Basin & Walkable Timber Pier (North-West section of courtyard)
  {
    id: 'range_pier_water_basin',
    pos: { x: -39.5, y: 0.005, z: -17.0 },
    size: { x: 24.0, y: 0.01, z: 16.0 },
    color: 0x2b7285,
    material: 'water_dock',
    collider: false,
    label: 'Hafenbecken Außenhof',
  },
  // Walkable wooden pier deck extending over the water (0.16m high — smooth autostep)
  {
    id: 'range_pier_timber_walkway',
    pos: { x: -38.5, y: 0.08, z: -16.8 },
    size: { x: 5.2, y: 0.16, z: 16.8 },
    color: 0x855c38,
    material: 'timber_beam',
    label: 'Holzsteg am Pier',
  },
  // Stone quay curbs flanking the pier entrance so movement funnels cleanly onto the pier
  {
    id: 'range_pier_quay_curb_east',
    pos: { x: -30.5, y: 0.58, z: -8.8 },
    size: { x: 10.6, y: 1.16, z: 0.7 },
    color: 0xcab89b,
    material: 'stone_sand',
  },
  {
    id: 'range_pier_quay_curb_west',
    pos: { x: -47.6, y: 0.58, z: -8.8 },
    size: { x: 12.6, y: 1.16, z: 0.7 },
    color: 0xcab89b,
    material: 'stone_sand',
  },
  {
    id: 'range_pier_rail_east',
    pos: { x: -35.65, y: 0.58, z: -16.8 },
    size: { x: 0.5, y: 1.16, z: 16.4 },
    color: 0x7c5333,
    material: 'timber_beam',
  },
  {
    id: 'range_pier_rail_west',
    pos: { x: -41.35, y: 0.58, z: -16.8 },
    size: { x: 0.5, y: 1.16, z: 16.4 },
    color: 0x7c5333,
    material: 'timber_beam',
  },

  // Jump & Crouch Parkour Track in South-West Courtyard
  // 1) Crouch-under timber hurdle (bottom at y = 1.32 -> blocks 1.75m standing, clears 1.15m crouch!)
  {
    id: 'range_parkour_crouch_post_l',
    pos: { x: -36.5, y: 1.1, z: 14.0 },
    size: { x: 0.6, y: 2.2, z: 0.6 },
    color: 0xb65d43,
    material: 'brick_warm',
  },
  {
    id: 'range_parkour_crouch_post_r',
    pos: { x: -31.5, y: 1.1, z: 14.0 },
    size: { x: 0.6, y: 2.2, z: 0.6 },
    color: 0xb65d43,
    material: 'brick_warm',
  },
  {
    id: 'range_parkour_crouch_beam',
    pos: { x: -34.0, y: 1.76, z: 14.0 },
    size: { x: 4.4, y: 0.88, z: 0.7 },
    color: 0x7c5333,
    material: 'timber_beam',
    label: 'Duck-Hindernis',
  },
  // 2) Precision Jump Pillars rising along West Courtyard wall
  {
    id: 'range_parkour_step_1',
    pos: { x: -46.5, y: 0.35, z: 16.5 },
    size: { x: 2.4, y: 0.7, z: 2.4 },
    color: 0xcab89b,
    material: 'stone_sand',
    label: 'Sprungstufe 1',
  },
  {
    id: 'range_parkour_step_2',
    pos: { x: -46.5, y: 0.68, z: 11.8 },
    size: { x: 2.4, y: 1.36, z: 2.4 },
    color: 0xc9653c,
    material: 'terracotta',
    label: 'Sprungstufe 2',
  },
  {
    id: 'range_parkour_step_3',
    pos: { x: -46.5, y: 1.0, z: 7.0 },
    size: { x: 2.6, y: 2.0, z: 2.6 },
    color: 0xb65d43,
    material: 'brick_warm',
    label: 'Sprungstufe 3',
  },
  {
    id: 'range_parkour_step_4_platform',
    pos: { x: -46.5, y: 1.25, z: 1.2 },
    size: { x: 3.8, y: 2.5, z: 4.2 },
    color: 0x855c38,
    material: 'timber_beam',
    label: 'Außenhof-Podest',
  },
  // Außenhof-Deckung: Hafenkisten-Stapel am Südrand des Piers (außerhalb der Sichtlinien zum Schießstand)
  {
    id: 'range_courtyard_tactical_crate_1',
    pos: { x: -30.0, y: 0.7, z: 12.0 },
    size: { x: 2.2, y: 1.4, z: 2.2 },
    color: 0x855c38,
    material: 'timber_beam',
    label: 'Außenhof Holzkiste',
  },
  {
    id: 'range_courtyard_tactical_crate_2',
    pos: { x: -30.0, y: 1.8, z: 12.0 },
    size: { x: 1.4, y: 0.8, z: 1.4 },
    color: 0xc9653c,
    material: 'terracotta',
    label: 'Außenhof Stapelkiste',
  },
  {
    id: 'range_courtyard_tactical_crate_3',
    pos: { x: -30.0, y: 0.7, z: -1.0 },
    size: { x: 2.0, y: 1.4, z: 2.0 },
    color: 0xcab89b,
    material: 'stone_sand',
    label: 'Außenhof Steinquader',
  },
];

const UEBUNGSANLAGE_ZONES: MapZone[] = [
  {
    id: 'zone_range_booth',
    label: 'SCHIESSSTAND',
    type: 'range_booth',
    center: { x: 0, y: 0.02, z: 12 },
    size: { x: 10, z: 5.5 },
    color: 0x18d4c9,
  },
];

const UEBUNGSANLAGE_DISTANCE_LINES: DistanceLineDef[] = [
  { z: -0.2, width: 22, label: '10M' },
  { z: -10.2, width: 22, label: '20M' },
  { z: -20.2, width: 24, label: '30M' },
  { z: -40.2, width: 26, label: '50M' },
];

const UEBUNGSANLAGE_BUTTONS: RangeControlButton[] = [
  {
    id: 'start_challenge',
    label: '30-ZIEL-TRAINING',
    pos: { x: -0.92, y: 2.42, z: 7.62 },
    size: { x: 1.55, y: 0.42, z: 0.16 },
  },
  {
    id: 'toggle_strafe',
    label: 'BOT-BEWEGUNG',
    pos: { x: 0.92, y: 2.42, z: 7.62 },
    size: { x: 1.55, y: 0.42, z: 0.16 },
  },
  {
    id: 'toggle_armor',
    label: 'BOT-SCHILD +50',
    pos: { x: -3.48, y: 2.38, z: 7.62 },
    size: { x: 1.25, y: 0.38, z: 0.16 },
  },
  {
    id: 'toggle_inf_ammo',
    label: 'ENDLOS-MUNITION',
    pos: { x: -3.48, y: 1.88, z: 7.62 },
    size: { x: 1.25, y: 0.38, z: 0.16 },
  },
  {
    id: 'clear_spray',
    label: 'SPRAY-RESET',
    pos: { x: -3.48, y: 1.38, z: 7.62 },
    size: { x: 1.25, y: 0.38, z: 0.16 },
  },
];

const UEBUNGSANLAGE_CALLOUTS: MapCallout[] = [
  { id: 'range_call_booth', label: 'Schießstand', pos: { x: 0, y: 0, z: 12 } },
  { id: 'range_call_hall', label: 'Zielhalle', pos: { x: 0, y: 0, z: -14 } },
  { id: 'range_call_spray', label: 'Rückstoß-Wand', pos: { x: -16, y: 0, z: 5 } },
  { id: 'range_call_perch', label: 'Schützen-Turm', pos: { x: 15.5, y: 3.2, z: -15.2 } },
  { id: 'range_call_arch', label: 'Torbogen West', pos: { x: -24.5, y: 0, z: 7 } },
  { id: 'range_call_courtyard', label: 'Außenhof-Parcours', pos: { x: -39, y: 0, z: 10 } },
  { id: 'range_call_pier', label: 'Hafen-Steg', pos: { x: -38.5, y: 0.16, z: -16.8 } },
];

// 8 indoor range dummies (10m..42m + elevated deck) + 2 outdoor courtyard/pier dummies
const UEBUNGSANLAGE_DUMMIES: DummySpawnDef[] = [
  {
    id: 'range_dummy_10m_left',
    pos: { x: -3.4, y: 0, z: -0.2 },
    yaw: Math.PI,
    patrolAmplitude: 1.8,
    patrolAxis: 'x',
    patrolSpeed: 1.8,
  },
  {
    id: 'range_dummy_10m_right',
    pos: { x: 3.6, y: 0, z: -0.2 },
    yaw: Math.PI,
    patrolAmplitude: 1.8,
    patrolAxis: 'x',
    patrolSpeed: 2.0,
  },
  {
    id: 'range_dummy_16m_center',
    pos: { x: 0.0, y: 0, z: -6.2 },
    yaw: Math.PI,
    patrolAmplitude: 2.6,
    patrolAxis: 'x',
    patrolSpeed: 2.1,
  },
  {
    id: 'range_dummy_22m_left',
    pos: { x: -5.2, y: 0, z: -12.2 },
    yaw: Math.PI,
    patrolAmplitude: 2.2,
    patrolAxis: 'x',
    patrolSpeed: 1.9,
  },
  {
    id: 'range_dummy_22m_right',
    pos: { x: 4.8, y: 0, z: -12.2 },
    yaw: Math.PI,
    patrolAmplitude: 2.2,
    patrolAxis: 'x',
    patrolSpeed: 1.7,
  },
  {
    id: 'range_dummy_30m_center',
    pos: { x: 1.4, y: 0, z: -20.2 },
    yaw: Math.PI,
    patrolAmplitude: 3.0,
    patrolAxis: 'x',
    patrolSpeed: 2.2,
  },
  {
    id: 'range_dummy_elevated_34m',
    pos: { x: -8.2, y: 2.2, z: -24.2 },
    yaw: Math.PI,
    patrolAmplitude: 1.8,
    patrolAxis: 'x',
    patrolSpeed: 1.6,
  },
  {
    id: 'range_dummy_42m_far',
    pos: { x: -1.8, y: 0, z: -32.2 },
    yaw: Math.PI,
    patrolAmplitude: 3.2,
    patrolAxis: 'x',
    patrolSpeed: 2.0,
  },
  {
    id: 'range_dummy_courtyard_pier',
    pos: { x: -38.5, y: 0.16, z: -21.5 },
    yaw: Math.PI,
    patrolAmplitude: 1.4,
    patrolAxis: 'x',
    patrolSpeed: 1.6,
  },
  {
    id: 'range_dummy_courtyard_podest',
    pos: { x: -46.5, y: 2.5, z: 1.2 },
    yaw: Math.PI * 0.5,
  },
];

export const UEBUNGSANLAGE_MAP: MapDefinition = {
  id: 'uebungsanlage',
  name: 'Übungsanlage',
  subtitle: 'Backstein-Schießhalle & Sonniger Pier-Parcours · Training',
  theme: 'range',
  bounds: { width: 82, depth: 84 },
  playerSpawn: {
    pos: { x: 0, y: 0.05, z: 12 },
    yaw: 0,
  },
  blocks: UEBUNGSANLAGE_BLOCKS,
  zones: UEBUNGSANLAGE_ZONES,
  dummySpawns: UEBUNGSANLAGE_DUMMIES,
  rangeButtons: UEBUNGSANLAGE_BUTTONS,
  distanceLines: UEBUNGSANLAGE_DISTANCE_LINES,
  callouts: UEBUNGSANLAGE_CALLOUTS,
  scoreboardPos: { x: 0, y: 4.25, z: 7.48 },
  sprayWallBounds: {
    center: { x: -16, y: 2.45, z: -1.95 },
    normal: { x: 0, y: 0, z: 1 },
    width: 6.0,
    height: 4.5,
  },
};
