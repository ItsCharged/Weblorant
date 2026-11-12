export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PlayerStance = 'stand' | 'walk' | 'crouch' | 'air';

export type WeaponId = 'funke' | 'bolzer' | 'hornisse' | 'brecher' | 'lanze' | 'falke';

export type MapId = 'uebungsanlage' | 'hafenwerk' | 'werkstadt' | 'kryowerk';

export const TACTICAL_MAP_IDS: readonly MapId[] = ['hafenwerk', 'werkstadt', 'kryowerk'];

export const ALL_MAP_IDS: readonly MapId[] = [
  'hafenwerk',
  'werkstadt',
  'kryowerk',
  'uebungsanlage',
];

export function isValidMapId(value: unknown): value is MapId {
  return (
    value === 'uebungsanlage' ||
    value === 'hafenwerk' ||
    value === 'werkstadt' ||
    value === 'kryowerk'
  );
}

export type HitZone = 'head' | 'body' | 'world' | 'button' | 'none';

export type LoadoutSlot = 1 | 2 | 3;

export type ArmorTierId = 'none' | 'light' | 'heavy';

export type BuyItemType = 'weapon' | 'armor' | 'ability_q' | 'ability_e';

export type KernStatus =
  | 'carried'
  | 'dropped'
  | 'planting'
  | 'planted'
  | 'defusing'
  | 'detonated'
  | 'defused';

export type RoundWinReason =
  | 'kern_detonated'
  | 'defenders_eliminated'
  | 'kern_defused'
  | 'attackers_eliminated'
  | 'time_expired';

export interface InputSnapshot {
  seq: number;
  forward: number;
  right: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  fire: boolean;
  ads: boolean;
  reload: boolean;
  holdKern?: boolean;
  equipSlot?: LoadoutSlot;
  yaw: number;
  pitch: number;
  dt: number;
}

export interface CrosshairSettings {
  color: string;
  size: number;
  thickness: number;
  gap: number;
  dynamicSpread: boolean;
}

/** Grafikqualität: low = Leistung, high = Standard, max = Schatten, Reflexionen, realistischeres Licht. */
export type GraphicsQuality = 'low' | 'high' | 'max';

export type KeybindAction =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'walk'
  | 'crouch'
  | 'reload'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'kernInteract'
  | 'abilityQ'
  | 'abilityE'
  | 'abilityUlt'
  | 'zoomCycle'
  | 'buyMenu'
  | 'scoreboard'
  | 'abilityInfo'
  | 'specialistSelect'
  | 'debugOverlay'
  | 'mapSwitchOffline';

export type KeybindMap = Record<KeybindAction, string>;

export type MobileControlsMode = 'auto' | 'on' | 'off';

export type MobileControlId =
  | 'joystick'
  | 'fire'
  | 'ads'
  | 'jump'
  | 'crouch'
  | 'reload'
  | 'abilityQ'
  | 'abilityE'
  | 'abilityUlt'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'kern'
  | 'shop'
  | 'pause';

export interface MobileControlPosition {
  xPct: number;
  yPct: number;
  scale: number;
  opacity: number;
}

export type MobileLayoutConfig = Record<MobileControlId, MobileControlPosition>;

export interface GameSettings {
  graphics: GraphicsQuality;
  sensitivity: number;
  fov: number;
  volume: number;
  crosshair: CrosshairSettings;
  keybinds: KeybindMap;
  mobileControls: MobileControlsMode;
}

export type TeamId = 'A' | 'D';

export type CharacterId = 'ryo' | 'mira' | 'brann' | 'tessa';

export type RoomStatus = 'lobby' | 'playing' | 'ended';

export type MatchPhase = 'buy' | 'action' | 'planted' | 'post_round' | 'ended';

export interface RoomSettings {
  teamSize: number;
  roundsToWin: number;
  mapId: MapId;
}

export interface LobbyPlayer {
  uid: string;
  name: string;
  team: TeamId;
  character: CharacterId;
  ready: boolean;
  online: boolean;
}

export interface RoomMatchSummary {
  round: number;
  scoreA: number;
  scoreB: number;
  phase: MatchPhase;
}

export type TransportMode = 'connecting' | 'p2p' | 'relay' | 'loopback' | 'disconnected';

export interface NetSimConfig {
  enabled: boolean;
  latencyMs: number;
  jitterMs: number;
  packetLossPct: number;
  forceRelay: boolean;
}

export interface TransportMetrics {
  mode: TransportMode;
  rttMs: number;
  packetLossPct: number;
  txPacketsPerSec: number;
  rxPacketsPerSec: number;
}

export interface ClientInputPacket {
  seq: number;
  clientTimeMs: number;
  forward: number;
  right: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  fire: boolean;
  ads: boolean;
  reload: boolean;
  holdKern?: boolean;
  equipSlot?: LoadoutSlot;
  weaponSlot?: WeaponId;
  yaw: number;
  pitch: number;
}

export type AbilitySlot = 'q' | 'e' | 'x';

export type WorldEffectKind =
  | 'dash_trail'
  | 'echo_sensor'
  | 'jammer_field'
  | 'global_reveal'
  | 'smoke_dome'
  | 'ember_field'
  | 'dark_ring'
  | 'magnet_mine'
  | 'shield_post'
  | 'bastion_zone';

export interface ActiveWorldEffect {
  id: string;
  kind: WorldEffectKind;
  ownerUid: string;
  team: TeamId;
  pos: Vec3;
  yaw: number;
  radius: number;
  innerRadius?: number;
  height?: number;
  remainingSec: number;
  totalSec: number;
  hp?: number;
  maxHp?: number;
  armed?: boolean;
  triggered?: boolean;
}

export interface PlayerAbilityState {
  qCharges: number;
  qMax: number;
  eCharges: number;
  eMax: number;
  ultPoints: number;
  ultMax: number;
  activeBuff: 'adrenalin' | 'ueberlast' | null;
  buffRemainingSec: number;
  weaponLockoutSec: number;
  slowedSec: number;
  revealedSec: number;
  revealedToTeam: TeamId | null;
  bastionProtected: boolean;
}

export interface NetPlayerState {
  uid: string;
  name: string;
  team: TeamId;
  character: CharacterId;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  stance: PlayerStance;
  hp: number;
  armor: number;
  armorMax: number;
  alive: boolean;
  weaponId: WeaponId;
  primaryWeapon: WeaponId | null;
  secondaryWeapon: WeaponId;
  activeSlot: LoadoutSlot;
  ammoInMag: number;
  isReloading: boolean;
  hasKern: boolean;
  credits: number;
  kills: number;
  deaths: number;
  assists: number;
  plants: number;
  defuses: number;
  ultPoints: number;
  lastAckSeq: number;
  abilities?: PlayerAbilityState;
}

export interface KernSnapshot {
  status: KernStatus;
  pos: Vec3;
  carrierUid?: string;
  plantedZone?: 'A' | 'B';
  actorUid?: string;
  progress01: number;
  halfDefused: boolean;
  fuseRemainingSec: number;
}

export interface RoundStateSnapshot {
  roundNumber: number;
  scoreA: number;
  scoreB: number;
  phase: MatchPhase;
  phaseRemainingSec: number;
  barriersActive: boolean;
  sidesSwapped: boolean;
  isSuddenDeath: boolean;
  winnerTeam?: TeamId;
  winReason?: RoundWinReason;
  matchWinnerTeam?: TeamId;
  kern: KernSnapshot;
}

export interface WorldSnapshot {
  tick: number;
  serverTimeMs: number;
  players: NetPlayerState[];
  round?: RoundStateSnapshot;
  effects?: ActiveWorldEffect[];
}

export type ClientReliableMessage =
  | { type: 'buy_request'; itemType: BuyItemType; itemId: string }
  | { type: 'ability_use'; slot: AbilitySlot; yaw: number; pitch: number; targetPos?: Vec3 }
  | { type: 'chat'; text: string; teamOnly?: boolean }
  | { type: 'restart_match' };

export type NetGameEvent =
  | {
      type: 'shot';
      shooterUid: string;
      weaponId: WeaponId;
      origin: Vec3;
      hitPoint: Vec3;
      hitZone: HitZone;
      targetUid?: string;
    }
  | {
      type: 'damage';
      attackerUid: string;
      victimUid: string;
      damage: number;
      hitZone: 'head' | 'body';
      hpAfter: number;
      armorAfter: number;
      killed: boolean;
      weaponId: WeaponId;
    }
  | { type: 'respawn'; uid: string; pos: Vec3; yaw: number }
  | { type: 'reload'; uid: string; weaponId: WeaponId }
  | { type: 'footstep'; uid: string; pos: Vec3 }
  | {
      type: 'buy_result';
      uid: string;
      ok: boolean;
      reason?: string;
      credits: number;
      weaponId?: WeaponId;
      armor?: number;
      armorMax?: number;
    }
  | {
      type: 'round_phase';
      phase: MatchPhase;
      roundNumber: number;
      scoreA: number;
      scoreB: number;
      winnerTeam?: TeamId;
      winReason?: RoundWinReason;
      sidesSwapped?: boolean;
      isSuddenDeath?: boolean;
      matchWinnerTeam?: TeamId;
    }
  | {
      type: 'kern_event';
      action:
        | 'picked_up'
        | 'dropped'
        | 'plant_start'
        | 'planted'
        | 'defuse_start'
        | 'half_defused'
        | 'defused'
        | 'detonated';
      uid?: string;
      zone?: 'A' | 'B';
      pos: Vec3;
    }
  | {
      type: 'ability_cast';
      uid: string;
      team: TeamId;
      character: CharacterId;
      slot: AbilitySlot;
      abilityName: string;
      origin: Vec3;
      targetPos?: Vec3;
    }
  | {
      type: 'effect_event';
      effectId: string;
      kind: WorldEffectKind;
      action: 'triggered' | 'destroyed';
      pos: Vec3;
    }
  | {
      type: 'chat';
      uid: string;
      senderName: string;
      team: TeamId;
      text: string;
      teamOnly: boolean;
      timestampMs: number;
    };


