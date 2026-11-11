import type { MapId, TeamId, Vec3 } from '../../core/types';

export type BlockMaterial =
  | 'floor'
  | 'asphalt'
  | 'concrete'
  | 'wall_light'
  | 'metal'
  | 'container_orange'
  | 'container_teal'
  | 'container_slate'
  | 'wood'
  | 'hazard'
  | 'trim_orange'
  | 'trim_teal'
  | 'spray_board'
  | 'brick_warm'
  | 'stone_sand'
  | 'timber_beam'
  | 'terracotta'
  | 'arctic_panel'
  | 'ice_glass'
  | 'water_dock'
  | 'holo_screen';

export type MapTheme = 'dockyard' | 'range' | 'oldtown' | 'arctic';

export interface MapCallout {
  id: string;
  label: string;
  pos: Vec3;
}

export interface MapBlock {
  id: string;
  /** Center position of the box [x, y, z]. */
  pos: Vec3;
  /** Full dimensions [width, height, depth]. */
  size: Vec3;
  /** Intrinsic XYZ Euler rotation in radians. */
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  color: number;
  material: BlockMaterial;
  /** Defaults to true when omitted. */
  collider?: boolean;
  label?: string;
}

export type MapZoneType =
  | 'spawn_attacker'
  | 'spawn_defender'
  | 'kern_site_a'
  | 'kern_site_b'
  | 'range_booth';

export interface MapZone {
  id: string;
  label: string;
  type: MapZoneType;
  center: Vec3;
  size: { x: number; z: number };
  color: number;
}

export interface DummySpawnDef {
  id: string;
  /** Ground / feet position (pos.y is floor surface Y). */
  pos: Vec3;
  yaw: number;
  patrolAmplitude?: number;
  patrolAxis?: 'x' | 'z';
  patrolSpeed?: number;
}

export type RangeButtonId =
  | 'start_challenge'
  | 'toggle_strafe'
  | 'toggle_armor'
  | 'toggle_inf_ammo'
  | 'clear_spray';

export interface RangeControlButton {
  id: RangeButtonId;
  label: string;
  pos: Vec3;
  size: Vec3;
}

export interface DistanceLineDef {
  z: number;
  width: number;
  label: string;
}

export interface SprayWallBounds {
  center: Vec3;
  normal: Vec3;
  width: number;
  height: number;
}

export interface SpawnBarrierDef {
  id: string;
  team: TeamId;
  pos: Vec3;
  size: Vec3;
}

export interface MapDefinition {
  id: MapId;
  name: string;
  subtitle: string;
  theme?: MapTheme;
  bounds: { width: number; depth: number };
  playerSpawn: { pos: Vec3; yaw: number };
  blocks: MapBlock[];
  zones: MapZone[];
  dummySpawns: DummySpawnDef[];
  spawnBarriers?: SpawnBarrierDef[];
  callouts?: MapCallout[];
  rangeButtons?: RangeControlButton[];
  distanceLines?: DistanceLineDef[];
  scoreboardPos?: Vec3;
  sprayWallBounds?: SprayWallBounds;
}
