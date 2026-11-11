import {
  BUY_PHASE_SEC,
  CROUCH_EYE_HEIGHT,
  KERN_FUSE_SEC,
  KNIFE_RUN_SPEED,
  RUN_SPEED,
  SIM_DT,
  SIM_TICK_RATE,
  STAND_EYE_HEIGHT,
  START_CREDITS,
} from '../core/Config';
import { EventBus } from '../core/EventBus';
import {
  aimDirectionFromAngles,
  clamp,
  vec3Clone,
  vec3Dist,
  vec3Lerp,
  vec3Normalize,
  vec3Sub,
} from '../core/math';
import type {
  AbilitySlot,
  ActiveWorldEffect,
  BuyItemType,
  CharacterId,
  ClientInputPacket,
  ClientReliableMessage,
  HitZone,
  InputSnapshot,
  KernStatus,
  LoadoutSlot,
  LobbyPlayer,
  MapId,
  MatchPhase,
  NetGameEvent,
  NetPlayerState,
  NetSimConfig,
  PlayerAbilityState,
  PlayerStance,
  RoundStateSnapshot,
  RoundWinReason,
  TeamId,
  TransportMode,
  Vec3,
  WeaponId,
  WorldEffectKind,
  WorldSnapshot,
} from '../core/types';
import { CHARACTERS } from '../data/characters';
import type { MapDefinition } from '../data/maps/types';
import { WEAPONS, type WeaponStats } from '../data/weapons';
import { HOST_SNAPSHOT_HZ_P2P, HOST_SNAPSHOT_HZ_RELAY } from '../net/config';
import { lerpAngleRad, SnapshotInterpolator } from '../net/Interpolation';
import { monotonicNowMs } from '../net/NetTransport';
import { ClientPrediction } from '../net/Prediction';
import { StarNetwork } from '../net/StarNetwork';
import { CharacterMotor } from '../physics/CharacterMotor';
import { initRapier, PhysicsWorld } from '../physics/PhysicsWorld';
import {
  computeAbilityRecoilMultiplier,
  computeAbilityReloadMultiplier,
  computeAbilitySpeedMultiplier,
  createDefaultAbilityState,
  RYO_DASH_DURATION_SEC,
  RYO_DASH_LOCKOUT_SEC,
  RYO_DASH_SPEED_MPS,
  TESSA_SHIELD_DEPTH_M,
  TESSA_SHIELD_HEIGHT_M,
  TESSA_SHIELD_WIDTH_M,
} from './AbilitySystem';
import {
  getFreeAbilityECharges,
  getNextRoundMinCredits,
  isInTeamSpawnBuyZone,
  isSecondaryWeapon,
} from './Economy';
import {
  computeTeamSpawnTransform,
  HOST_HITSCAN_MAX_RANGE_M,
  HostSimulation,
  PLAYER_MAX_HP,
} from './HostSimulation';
import {
  getContainingPlantZone,
  KERN_DEFUSE_RADIUS_M,
  KERN_PLANT_MAX_SPEED_MPS,
} from './KernLogic';
import { performPvpHitscan, type PvpHitscanTarget } from './PlayerHitscan';
import {
  applySpreadAndRecoilToAngles,
  getRecoilAnglesRad,
  RecoilController,
} from './Recoil';
import { DEFAULT_ROUNDS_TO_WIN } from './RoundManager';
import {
  computeEffectiveWeaponSpreadDeg,
  computeEffectiveWeaponSpreadRad,
  KNIFE_RANGE_M,
  LoadoutInventory,
  type WeaponController,
} from './WeaponLogic';

export interface OnlineShotEvent {
  shooterUid: string;
  isLocal: boolean;
  isOptimistic: boolean;
  isKnife?: boolean;
  weaponId: WeaponId;
  origin: Vec3;
  hitPoint: Vec3;
  hitNormal: Vec3;
  hitZone: HitZone;
  targetUid?: string;
}

export interface LocalHitConfirmedEvent {
  victimUid: string;
  victimName: string;
  hitZone: 'head' | 'body';
  damage: number;
  killed: boolean;
  hpAfter: number;
  armorAfter: number;
  weaponId: WeaponId;
  hitPoint: Vec3;
}

export interface LocalDamagedEvent {
  attackerUid: string;
  attackerName: string;
  attackerPos: Vec3 | null;
  damage: number;
  hitZone: 'head' | 'body';
  hpAfter: number;
  armorAfter: number;
  killed: boolean;
  weaponId: WeaponId;
}

export interface RemoteDamagedEvent {
  attackerUid: string;
  victimUid: string;
  damage: number;
  hitZone: 'head' | 'body';
  hpAfter: number;
  armorAfter: number;
  killed: boolean;
  weaponId: WeaponId;
}

export interface KillFeedEvent {
  attackerUid: string;
  attackerName: string;
  attackerTeam: TeamId;
  victimUid: string;
  victimName: string;
  victimTeam: TeamId;
  weaponId: WeaponId;
  hitZone: 'head' | 'body';
}

export interface OnlineRespawnEvent {
  uid: string;
  isLocal: boolean;
  pos: Vec3;
  yaw: number;
}

export interface OnlineReloadEvent {
  uid: string;
  isLocal: boolean;
  weaponId: WeaponId;
  durationSec: number;
}

export interface OnlineFootstepEvent {
  uid: string;
  isLocal: boolean;
  pos: Vec3;
}

export interface OnlineBuyResultEvent {
  uid: string;
  isLocal: boolean;
  ok: boolean;
  reason?: string;
  credits: number;
  weaponId?: WeaponId;
  armor?: number;
  armorMax?: number;
}

export interface OnlineRoundPhaseEvent {
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

export interface OnlineKernEvent {
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

export interface OnlineAbilityCastEvent {
  uid: string;
  isLocal: boolean;
  team: TeamId;
  character: CharacterId;
  slot: AbilitySlot;
  abilityName: string;
  origin: Vec3;
  targetPos?: Vec3;
}

export interface OnlineEffectEvent {
  effectId: string;
  kind: WorldEffectKind;
  action: 'triggered' | 'destroyed';
  pos: Vec3;
}

export interface OnlineChatEvent {
  uid: string;
  isLocal: boolean;
  senderName: string;
  team: TeamId;
  text: string;
  teamOnly: boolean;
  timestampMs: number;
}

export type OnlineSessionEvents = {
  shot: OnlineShotEvent;
  localHitConfirmed: LocalHitConfirmedEvent;
  localDamaged: LocalDamagedEvent;
  remoteDamaged: RemoteDamagedEvent;
  killFeed: KillFeedEvent;
  respawn: OnlineRespawnEvent;
  reload: OnlineReloadEvent;
  footstep: OnlineFootstepEvent;
  buyResult: OnlineBuyResultEvent;
  roundPhase: OnlineRoundPhaseEvent;
  kernEvent: OnlineKernEvent;
  abilityCast: OnlineAbilityCastEvent;
  effectEvent: OnlineEffectEvent;
  chat: OnlineChatEvent;
};

export interface KernInteractionPrompt {
  mode: 'plant' | 'defuse' | null;
  zone?: 'A' | 'B';
  canStart: boolean;
  isChanneling: boolean;
  progress01: number;
  halfDefused: boolean;
}

export interface ActiveCameraPose {
  eyePos: Vec3;
  yaw: number;
  pitch: number;
  isSpectating: boolean;
  spectatedPlayer: NetPlayerState | null;
}

export interface RoundDiagnosticsSnapshot {
  roundNumber: number;
  phase: MatchPhase;
  phaseRemainingSec: number;
  barriersActive: boolean;
  scoreA: number;
  scoreB: number;
  credits: number;
  primaryWeapon: WeaponId | null;
  secondaryWeapon: WeaponId;
  armor: number;
  hasKern: boolean;
  kernStatus: KernStatus;
  spectatingUid: string | null;
  abilities: PlayerAbilityState;
  activeEffectsCount: number;
}

export interface RemotePlayerDiagnostic {
  uid: string;
  name: string;
  team: TeamId;
  pos: Vec3;
  hp: number;
  alive: boolean;
}

export interface NetDiagnosticsSnapshot {
  role: 'host' | 'client';
  transportMode: TransportMode;
  rttMs: number;
  packetLossPct: number;
  tickRate: number;
  snapshotRateHz: number;
  fps: number;
  predictionErrorMm: number;
  interpolatedPlayerCount: number;
  localUid: string;
  localPos: Vec3;
  localHp: number;
  localArmor: number;
  localAlive: boolean;
  respawnRemainingSec: number;
  kills: number;
  deaths: number;
  remotePlayerCount: number;
  remotePlayers: RemotePlayerDiagnostic[];
  netSim: NetSimConfig;
  roundNumber: number;
  roundPhase: MatchPhase;
  scoreA: number;
  scoreB: number;
  credits: number;
  activeSlot: LoadoutSlot;
  hasKern: boolean;
  spectatingUid: string | null;
  abilities: PlayerAbilityState;
  activeEffectsCount: number;
}

export interface OnlineSessionOptions {
  roomCode: string;
  localUid: string;
  hostUid: string;
  mapDef: MapDefinition;
  players: ReadonlyArray<LobbyPlayer>;
  roundsToWin?: number;
  initialNetSim?: Partial<NetSimConfig>;
  network?: StarNetwork;
}

function hashSeed(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i += 1) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function createInitialRoundSnapshot(pos: Vec3, carrierUid?: string): RoundStateSnapshot {
  return {
    roundNumber: 1,
    scoreA: 0,
    scoreB: 0,
    phase: 'buy',
    phaseRemainingSec: BUY_PHASE_SEC,
    barriersActive: true,
    sidesSwapped: false,
    isSuddenDeath: false,
    kern: {
      status: carrierUid ? 'carried' : 'dropped',
      pos: vec3Clone(pos),
      ...(carrierUid ? { carrierUid } : {}),
      progress01: 0,
      halfDefused: false,
      fuseRemainingSec: KERN_FUSE_SEC,
    },
  };
}

/**
 * Unified Online Match Controller supporting both Authoritative Host (`role === 'host'`)
 * and Predicted/Interpolated Client (`role === 'client'`) roles over `StarNetwork`,
 * with Kernbruch Round Engine, Economy & Buy Menu requests, 3-slot Loadout (`1` Primary,
 * `2` Pistol, `3` Knife), Buy-Phase Spawn Barriers, and Teammate Spectator Camera.
 * Pure TypeScript — zero 3D engine or DOM imports.
 */
export class OnlineSession {
  public readonly role: 'host' | 'client';
  public readonly roomCode: string;
  public readonly localUid: string;
  public readonly hostUid: string;
  public readonly mapDef: MapDefinition;
  public readonly roundsToWin: number;
  public readonly network: StarNetwork;
  public readonly events = new EventBus<OnlineSessionEvents>();

  // Local player weapon inventory & recoil view state
  public readonly inventory: LoadoutInventory;
  public readonly recoil: RecoilController;

  // Client-side prediction & interpolation engines
  public readonly prediction = new ClientPrediction();
  public readonly interpolator = new SnapshotInterpolator();

  // Host-only simulation OR Client-only local physics world + motor
  public readonly hostSim: HostSimulation | null;
  private readonly clientPhysicsWorld: PhysicsWorld | null;
  private readonly clientMotor: CharacterMotor | null;

  // Synchronized Round & Kern state
  public roundState: RoundStateSnapshot;

  // Camera & HUD observable state
  public prevEyePos: Vec3 = { x: 0, y: 1.62, z: 0 };
  public currEyePos: Vec3 = { x: 0, y: 1.62, z: 0 };
  public currentYaw = 0;
  public currentPitch = 0;
  public currentSpreadDeg = 0;
  public isAdsActive = false;

  public localTeam: TeamId = 'A';
  public localCharacter: CharacterId = 'ryo';
  public localName = 'Spezialist';
  public playerHp = PLAYER_MAX_HP;
  public playerMaxHp = PLAYER_MAX_HP;
  public playerShield = 0;
  public playerArmorMax = 0;
  public localAlive = true;
  public respawnRemainingSec = 0;
  public credits = START_CREDITS;
  public hasKern = false;

  public chargesQ = 0;
  public chargesE = 0;
  public localAbilities: PlayerAbilityState = createDefaultAbilityState('ryo');

  public totalShots = 0;
  public totalHits = 0;
  public localKills = 0;
  public localDeaths = 0;
  public localAssists = 0;
  public localPlants = 0;
  public localDefuses = 0;
  public localUltPoints = 0;

  public spectateTargetUid: string | null = null;

  private seqCounter = 0;
  private pendingEquipSlot: LoadoutSlot | undefined = undefined;
  private pendingWeaponSlot: WeaponId | undefined = undefined;
  private clientTeamLossStreak = 0;
  private clientEffects: ActiveWorldEffect[] = [];
  private readonly clientShieldColliderIds = new Set<string>();
  private readonly rosterMeta = new Map<string, LobbyPlayer>();
  private readonly lastShotPointByUid = new Map<string, Vec3>();
  private readonly hostPrevRemoteTransforms = new Map<
    string,
    { pos: Vec3; yaw: number; pitch: number }
  >();
  private cachedRemotePlayers: NetPlayerState[] = [];
  private readonly unsubs: Array<() => void> = [];
  private disposed = false;

  public static async create(options: OnlineSessionOptions): Promise<OnlineSession> {
    await initRapier();
    return new OnlineSession(options);
  }

  constructor(options: OnlineSessionOptions) {
    this.roomCode = options.roomCode;
    this.localUid = options.localUid;
    this.hostUid = options.hostUid;
    this.mapDef = options.mapDef;
    this.roundsToWin = Math.max(1, options.roundsToWin ?? DEFAULT_ROUNDS_TO_WIN);
    this.role = options.localUid === options.hostUid ? 'host' : 'client';

    for (const p of options.players) {
      this.rosterMeta.set(p.uid, { ...p });
    }

    const selfMeta = this.rosterMeta.get(this.localUid);
    if (selfMeta) {
      this.localTeam = selfMeta.team;
      this.localCharacter = selfMeta.character;
      this.localName = selfMeta.name;
    }
    this.chargesE = getFreeAbilityECharges(this.localCharacter);
    this.localAbilities = createDefaultAbilityState(
      this.localCharacter,
      this.chargesQ,
      this.chargesE,
      0,
    );

    const initialPeerUids = options.players
      .filter((p) => p.uid !== options.hostUid && p.online !== false)
      .map((p) => p.uid);

    this.network =
      options.network ??
      new StarNetwork({
        role: this.role,
        roomCode: options.roomCode,
        localUid: options.localUid,
        hostUid: options.hostUid,
        initialPeerUids,
        initialNetSim: options.initialNetSim,
      });

    if (this.role === 'host') {
      this.hostSim = new HostSimulation(options.mapDef, options.players, {
        hostUid: options.hostUid,
        roundsToWin: this.roundsToWin,
        peerRttProvider: (peerUid) => this.network.getPeerRttMs(peerUid),
      });
      this.clientPhysicsWorld = null;
      this.clientMotor = null;

      let hostPlayer = this.hostSim.getPlayer(this.localUid);
      if (!hostPlayer) {
        hostPlayer = this.hostSim.addOrUpdateLobbyPlayer({
          uid: this.localUid,
          name: this.localName,
          team: this.localTeam,
          character: this.localCharacter,
        });
      }

      this.inventory = hostPlayer.inventory;
      this.recoil = hostPlayer.recoil;
      this.roundState = this.hostSim.roundManager.toSnapshot();
      this.hasKern = this.roundState.kern.carrierUid === this.localUid;
      this.credits = hostPlayer.credits;
      this.chargesQ = hostPlayer.chargesQ;
      this.chargesE = hostPlayer.chargesE;
      this.localAbilities = this.hostSim.abilitySystem.getPlayerAbilityState(hostPlayer);
      this.currentYaw = hostPlayer.yaw;
      this.currentPitch = hostPlayer.pitch;
      this.currEyePos = hostPlayer.motor.getEyePos();
      this.prevEyePos = vec3Clone(this.currEyePos);

      if (this.network.host) {
        this.unsubs.push(
          this.network.host.onClientInput((peerUid, pkt) => {
            if (this.disposed || !this.hostSim) return;
            this.hostSim.enqueueInput(peerUid, pkt);
          }),
        );

        this.unsubs.push(
          this.network.host.onClientMessage((peerUid, msg) => {
            if (this.disposed || !this.hostSim) return;
            const immediateEvents = this.hostSim.handleClientMessage(peerUid, msg);
            this.syncHostLocalMirror();
            for (const ev of immediateEvents) {
              this.hostBroadcastEvent(ev);
              this.handleAuthoritativeEvent(ev);
            }
          }),
        );
      }
    } else {
      this.hostSim = null;
      this.clientPhysicsWorld = new PhysicsWorld(options.mapDef);
      this.clientPhysicsWorld.setSpawnBarriersActive(true);

      const spawn = this.computeInitialSpawnForLocal(options.players);
      this.clientMotor = new CharacterMotor(this.clientPhysicsWorld, spawn.pos);
      this.inventory = new LoadoutInventory(null, 'funke');
      this.recoil = new RecoilController(hashSeed(this.localUid), this.inventory.fallbackGun.weapon);

      const firstAttacker = options.players.find(
        (p) => p.online !== false && p.team === 'A',
      );
      this.roundState = createInitialRoundSnapshot(spawn.pos, firstAttacker?.uid);
      this.hasKern = firstAttacker?.uid === this.localUid;

      this.currentYaw = spawn.yaw;
      this.currentPitch = 0;
      this.currEyePos = this.clientMotor.getEyePos();
      this.prevEyePos = vec3Clone(this.currEyePos);

      if (this.network.client) {
        this.unsubs.push(
          this.network.client.onSnapshot((snap) => {
            if (this.disposed) return;
            this.handleClientSnapshot(snap);
          }),
        );

        this.unsubs.push(
          this.network.client.onEvent((ev) => {
            if (this.disposed) return;
            this.handleAuthoritativeEvent(ev);
          }),
        );
      }
    }
  }

  private computeInitialSpawnForLocal(players: ReadonlyArray<LobbyPlayer>): {
    pos: Vec3;
    yaw: number;
  } {
    const teamUids = players
      .filter((p) => p.online !== false && p.team === this.localTeam)
      .map((p) => p.uid)
      .sort();
    if (!teamUids.includes(this.localUid)) {
      teamUids.push(this.localUid);
      teamUids.sort();
    }
    const slotIdx = Math.max(0, teamUids.indexOf(this.localUid));
    return computeTeamSpawnTransform(this.localTeam, slotIdx, teamUids.length);
  }

  public get activeMapId(): MapId {
    return this.mapDef.id;
  }

  public get motor(): CharacterMotor {
    if (this.role === 'host') {
      return this.hostSim!.getPlayer(this.localUid)!.motor;
    }
    return this.clientMotor!;
  }

  public get stance(): PlayerStance {
    return this.motor.stance;
  }

  /**
   * Returns a valid gun `WeaponController` (active gun when in Slot 1/2, or fallback gun when Knife Slot 3 is drawn).
   */
  public get weapon(): WeaponController {
    return this.inventory.fallbackGun;
  }

  /**
   * Returns the currently drawn gun `WeaponController`, or `null` when Slot 3 (Tactical Knife) is drawn.
   */
  public get activeGun(): WeaponController | null {
    return this.inventory.activeGun;
  }

  public get activeSlot(): LoadoutSlot {
    return this.inventory.activeSlot;
  }

  public get primaryWeapon(): WeaponId | null {
    return this.inventory.primaryWeaponId;
  }

  public get secondaryWeapon(): WeaponId {
    return this.inventory.secondaryWeaponId;
  }

  public get localMaxUltPoints(): number {
    return CHARACTERS[this.localCharacter].abilities.ult.ultPoints ?? 7;
  }

  public getWeaponStats(): WeaponStats {
    return WEAPONS[this.weapon.weaponId];
  }

  public getVisualRecoil(): { pitchRad: number; yawRad: number } {
    if (this.inventory.activeSlot === 3) {
      return { pitchRad: 0, yawRad: 0 };
    }
    return {
      pitchRad: this.recoil.currentPitchRad,
      yawRad: this.recoil.currentYawRad,
    };
  }

  /**
   * Switches local weapon slot (`1` Primary, `2` Secondary/Pistol, `3` Tactical Knife).
   */
  public equipSlot(slot: LoadoutSlot): boolean {
    if (slot !== 1 && slot !== 2 && slot !== 3) return false;
    if (slot === 1 && !this.inventory.primary) return false;

    this.pendingEquipSlot = slot;
    if (this.role === 'client') {
      const ok = this.inventory.selectSlot(slot);
      if (ok) {
        const gun = this.inventory.activeGun;
        if (gun) this.recoil.setWeapon(gun.weapon);
        else this.recoil.reset();
        this.isAdsActive = false;
      }
      return ok;
    }
    return true;
  }

  public equipWeapon(id: WeaponId): void {
    if (!Object.prototype.hasOwnProperty.call(WEAPONS, id)) return;
    if (this.inventory.primary?.weaponId === id) {
      this.equipSlot(1);
      return;
    }
    if (this.inventory.secondary.weaponId === id) {
      this.equipSlot(2);
      return;
    }
    this.pendingWeaponSlot = id;
  }

  /**
   * Returns `true` when the local player can purchase items right now (`Buy` phase + alive + inside team Spawn Zone).
   */
  public canBuyNow(): boolean {
    return (
      this.roundState.phase === 'buy' &&
      this.localAlive &&
      isInTeamSpawnBuyZone(this.localTeam, this.motor.feetPos)
    );
  }

  public getNextRoundMinCredits(): number {
    if (this.role === 'host' && this.hostSim) {
      const streak = this.hostSim.roundManager.lossStreaks[this.localTeam] ?? 0;
      return getNextRoundMinCredits(this.credits, streak);
    }
    return getNextRoundMinCredits(this.credits, this.clientTeamLossStreak);
  }

  /**
   * Sends a Buy Menu purchase request (`weapon`, `armor`, `ability_q`, `ability_e`) to the authoritative Host.
   */
  public requestBuy(itemType: BuyItemType, itemId: string): void {
    if (this.disposed) return;

    if (this.role === 'host' && this.hostSim) {
      const buyEvt = this.hostSim.handleBuyRequest(this.localUid, itemType, itemId);
      this.syncHostLocalMirror();
      if (buyEvt) {
        this.hostBroadcastEvent(buyEvt);
        this.handleAuthoritativeEvent(buyEvt);
      }
      return;
    }

    this.network.sendClientMessage({
      type: 'buy_request',
      itemType,
      itemId,
    });
  }

  /**
   * Requests a full match reset back to Round 1 (`MatchEndOverlay` Host action).
   */
  public requestRestartMatch(): void {
    if (this.disposed) return;

    if (this.role === 'host' && this.hostSim) {
      const evs = this.hostSim.restartMatch();
      this.syncHostLocalMirror();
      this.prevEyePos = vec3Clone(this.currEyePos);
      for (const ev of evs) {
        this.hostBroadcastEvent(ev);
        this.handleAuthoritativeEvent(ev);
      }
      const snap = this.hostSim.buildSnapshot(Date.now());
      this.network.host?.broadcastSnapshot(snap, monotonicNowMs());
      return;
    }

    this.network.sendClientMessage({ type: 'restart_match' });
  }

  public sendClientMessage(msg: ClientReliableMessage): void {
    if (this.disposed) return;
    if (this.role === 'host' && this.hostSim) {
      const evs = this.hostSim.handleClientMessage(this.localUid, msg);
      this.syncHostLocalMirror();
      for (const ev of evs) {
        this.hostBroadcastEvent(ev);
        this.handleAuthoritativeEvent(ev);
      }
      return;
    }
    this.network.sendClientMessage(msg);
  }

  /**
   * Sends an in-game chat message (`teamOnly` restricts delivery to teammates).
   * Host validates directly; Client sends a reliable `chat` message to the Host.
   */
  public sendChatMessage(text: string, teamOnly: boolean): void {
    if (this.disposed) return;
    if (typeof text !== 'string' || text.trim().length === 0) return;
    this.sendClientMessage({ type: 'chat', text, teamOnly: Boolean(teamOnly) });
  }

  /**
   * Host-only: delivers an authoritative event to connected peers, isolating team-only
   * chat so that only members of the sender's team receive it.
   */
  private hostBroadcastEvent(ev: NetGameEvent): void {
    const hostNet = this.network.host;
    if (!hostNet) return;
    if (ev.type === 'chat' && ev.teamOnly && this.hostSim) {
      const recipients = new Set(this.hostSim.getEventRecipients(ev));
      for (const peerUid of hostNet.getPeerUids()) {
        if (recipients.has(peerUid)) {
          hostNet.sendEventToPeer(peerUid, ev);
        }
      }
      return;
    }
    hostNet.broadcastEvent(ev);
  }

  /**
   * Returns current `PlayerAbilityState` for the local player (or spectated teammate if dead).
   */
  public getAbilityState(): PlayerAbilityState {
    const spectated = this.getSpectatedPlayer();
    if (spectated?.abilities) {
      return spectated.abilities;
    }
    if (this.role === 'host' && this.hostSim) {
      const selfPlayer = this.hostSim.getPlayer(this.localUid);
      if (selfPlayer) {
        this.localAbilities = this.hostSim.abilitySystem.getPlayerAbilityState(selfPlayer);
      }
    }
    return this.localAbilities;
  }

  /**
   * Returns all currently active 3D world ability effects (`smoke_dome`, `ember_field`, `shield_post`, etc.).
   */
  public getActiveEffects(): ReadonlyArray<ActiveWorldEffect> {
    if (this.role === 'host' && this.hostSim) {
      return this.hostSim.abilitySystem.getEffects();
    }
    return this.clientEffects;
  }

  /**
   * Returns `true` when the local player is actively standing in range to plant or defuse the Kern,
   * allowing `InputManager.setKernInteractAvailable` to disambiguate `KeyE` seamlessly.
   */
  public isKernInteractAvailable(): boolean {
    const prompt = this.getKernInteractionPrompt();
    return prompt.mode !== null && (prompt.canStart || prompt.isChanneling);
  }

  /**
   * Casts Specialist Ability (`'q' | 'e' | 'x'`) on the authoritative Host (or sends reliable
   * `ability_use` message from Client with 0ms local prediction for Ryo's dash/buffs).
   */
  public castAbility(slot: AbilitySlot, targetPos?: Vec3): boolean {
    if (this.disposed) return false;
    if (slot !== 'q' && slot !== 'e' && slot !== 'x') return false;
    if (!this.localAlive) return false;
    if (this.roundState.phase !== 'action' && this.roundState.phase !== 'planted') {
      return false;
    }

    const prompt = this.getKernInteractionPrompt();
    if (prompt.isChanneling) return false;

    if (this.role === 'host' && this.hostSim) {
      const evs = this.hostSim.handleAbilityUse(
        this.localUid,
        slot,
        this.currentYaw,
        this.currentPitch,
        targetPos,
      );
      this.syncHostLocalMirror();
      for (const ev of evs) {
        this.hostBroadcastEvent(ev);
        this.handleAuthoritativeEvent(ev);
      }
      return evs.length > 0;
    }

    // Client-side validation & optimistic local dash/buff prediction
    if (slot === 'q' && this.localAbilities.qCharges <= 0) return false;
    if (slot === 'e' && this.localAbilities.eCharges <= 0) return false;
    if (slot === 'x' && this.localAbilities.ultPoints < this.localAbilities.ultMax) {
      return false;
    }

    if (slot === 'q') {
      this.localAbilities.qCharges = Math.max(0, this.localAbilities.qCharges - 1);
      this.chargesQ = this.localAbilities.qCharges;
    } else if (slot === 'e') {
      this.localAbilities.eCharges = Math.max(0, this.localAbilities.eCharges - 1);
      this.chargesE = this.localAbilities.eCharges;
    } else {
      this.localAbilities.ultPoints = 0;
      this.localUltPoints = 0;
    }

    if (this.localCharacter === 'ryo') {
      if (slot === 'q' && this.clientMotor) {
        const vel = this.clientMotor.velocity;
        const hLen = Math.hypot(vel.x, vel.z);
        const dirX = hLen > 0.25 ? vel.x / hLen : -Math.sin(this.currentYaw);
        const dirZ = hLen > 0.25 ? vel.z / hLen : -Math.cos(this.currentYaw);
        this.clientMotor.startDash(dirX, dirZ, RYO_DASH_SPEED_MPS, RYO_DASH_DURATION_SEC);
        this.localAbilities.weaponLockoutSec = Math.max(
          this.localAbilities.weaponLockoutSec,
          RYO_DASH_LOCKOUT_SEC,
        );
      } else if (slot === 'e') {
        this.localAbilities.activeBuff = 'adrenalin';
        this.localAbilities.buffRemainingSec = 4.0;
      } else if (slot === 'x') {
        this.localAbilities.activeBuff = 'ueberlast';
        this.localAbilities.buffRemainingSec = 8.0;
      }
    }

    this.network.sendClientMessage({
      type: 'ability_use',
      slot,
      yaw: this.currentYaw,
      pitch: this.currentPitch,
      ...(targetPos ? { targetPos: vec3Clone(targetPos) } : {}),
    });
    return true;
  }

  /**
   * Computes HUD action prompt & progress state for Kern planting (`Zone A/B`) or defusing (`<= 2.2m`).
   */
  public getKernInteractionPrompt(): KernInteractionPrompt {
    const kern = this.roundState.kern;

    if (
      this.localAlive &&
      this.localTeam === 'A' &&
      this.hasKern &&
      this.roundState.phase === 'action'
    ) {
      const zone = getContainingPlantZone(this.motor.feetPos, this.mapDef.zones);
      const isChanneling = kern.status === 'planting' && kern.actorUid === this.localUid;
      if (zone || isChanneling) {
        const canStart =
          this.motor.grounded && this.motor.horizontalSpeed < KERN_PLANT_MAX_SPEED_MPS;
        return {
          mode: 'plant',
          zone: zone ?? kern.plantedZone,
          canStart,
          isChanneling,
          progress01: isChanneling ? kern.progress01 : 0,
          halfDefused: false,
        };
      }
    }

    if (
      this.localAlive &&
      this.localTeam === 'D' &&
      this.roundState.phase === 'planted' &&
      (kern.status === 'planted' || kern.status === 'defusing')
    ) {
      const inRange = vec3Dist(this.motor.feetPos, kern.pos) <= KERN_DEFUSE_RADIUS_M;
      const isChanneling = kern.status === 'defusing' && kern.actorUid === this.localUid;
      if (inRange || isChanneling) {
        return {
          mode: 'defuse',
          zone: kern.plantedZone,
          canStart: true,
          isChanneling,
          progress01: kern.progress01,
          halfDefused: kern.halfDefused,
        };
      }
    }

    return {
      mode: null,
      canStart: false,
      isChanneling: false,
      progress01: 0,
      halfDefused: kern.halfDefused,
    };
  }

  /**
   * Cycles spectator camera target across alive teammates (`+1` next, `-1` previous).
   */
  public cycleSpectator(dir: 1 | -1 = 1): string | null {
    const aliveTeammates = this.cachedRemotePlayers.filter(
      (p) => p.alive && p.team === this.localTeam && p.uid !== this.localUid,
    );
    if (aliveTeammates.length === 0) {
      this.spectateTargetUid = null;
      return null;
    }

    const curIdx = this.spectateTargetUid
      ? aliveTeammates.findIndex((p) => p.uid === this.spectateTargetUid)
      : -1;

    const nextIdx =
      curIdx < 0
        ? 0
        : (curIdx + dir + aliveTeammates.length) % aliveTeammates.length;

    this.spectateTargetUid = aliveTeammates[nextIdx].uid;
    return this.spectateTargetUid;
  }

  /**
   * Returns the currently spectated alive teammate when the local player is eliminated, or `null`.
   */
  public getSpectatedPlayer(): NetPlayerState | null {
    if (this.localAlive) {
      this.spectateTargetUid = null;
      return null;
    }

    const aliveTeammates = this.cachedRemotePlayers.filter(
      (p) => p.alive && p.team === this.localTeam && p.uid !== this.localUid,
    );
    if (aliveTeammates.length === 0) {
      this.spectateTargetUid = null;
      return null;
    }

    let chosen = this.spectateTargetUid
      ? aliveTeammates.find((p) => p.uid === this.spectateTargetUid)
      : undefined;
    if (!chosen) {
      chosen = aliveTeammates[0];
      this.spectateTargetUid = chosen.uid;
    }
    return chosen;
  }

  /**
   * Returns 30Hz->render interpolated camera eye position (or spectated teammate's eye pos when dead).
   */
  public getInterpolatedEyePos(alpha: number): Vec3 {
    const spectated = this.getSpectatedPlayer();
    if (spectated) {
      const eyeH = spectated.stance === 'crouch' ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
      return {
        x: spectated.pos.x,
        y: spectated.pos.y + eyeH,
        z: spectated.pos.z,
      };
    }

    const base = vec3Lerp(this.prevEyePos, this.currEyePos, clamp(alpha, 0, 1));
    if (this.role === 'client') {
      return this.prediction.applySmoothing(base);
    }
    return base;
  }

  /**
   * Returns active first-person camera pose (local player when alive, or spectated alive teammate when dead).
   */
  public getActiveCameraPose(alpha: number): ActiveCameraPose {
    const spectated = this.getSpectatedPlayer();
    if (spectated) {
      const eyeH = spectated.stance === 'crouch' ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
      return {
        eyePos: {
          x: spectated.pos.x,
          y: spectated.pos.y + eyeH,
          z: spectated.pos.z,
        },
        yaw: spectated.yaw,
        pitch: spectated.pitch,
        isSpectating: true,
        spectatedPlayer: spectated,
      };
    }

    return {
      eyePos: this.getInterpolatedEyePos(alpha),
      yaw: this.currentYaw,
      pitch: this.currentPitch,
      isSpectating: false,
      spectatedPlayer: null,
    };
  }

  /**
   * Returns full scoreboard player states (local + remote) sorted by Team and Kills.
   */
  public getAllPlayers(): NetPlayerState[] {
    if (this.role === 'host' && this.hostSim) {
      const snap = this.hostSim.buildSnapshot(Date.now());
      return snap.players.sort((a, b) =>
        a.team !== b.team ? (a.team === 'A' ? -1 : 1) : b.kills - a.kills,
      );
    }

    const activeGun = this.inventory.activeGun;
    const localState: NetPlayerState = {
      uid: this.localUid,
      name: this.localName,
      team: this.localTeam,
      character: this.localCharacter,
      pos: vec3Clone(this.motor.feetPos),
      vel: vec3Clone(this.motor.velocity),
      yaw: this.currentYaw,
      pitch: this.currentPitch,
      stance: this.motor.stance,
      hp: this.playerHp,
      armor: this.playerShield,
      armorMax: this.playerArmorMax,
      alive: this.localAlive,
      weaponId: this.weapon.weaponId,
      primaryWeapon: this.inventory.primaryWeaponId,
      secondaryWeapon: this.inventory.secondaryWeaponId,
      activeSlot: this.inventory.activeSlot,
      ammoInMag: activeGun ? activeGun.ammoInMag : 0,
      isReloading: activeGun ? activeGun.isReloading : false,
      hasKern: this.hasKern,
      credits: this.credits,
      kills: this.localKills,
      deaths: this.localDeaths,
      assists: this.localAssists,
      plants: this.localPlants,
      defuses: this.localDefuses,
      ultPoints: this.localUltPoints,
      lastAckSeq: this.seqCounter,
      abilities: { ...this.localAbilities },
    };

    const all = [localState, ...this.cachedRemotePlayers.map((p) => ({ ...p, pos: vec3Clone(p.pos), vel: vec3Clone(p.vel) }))];
    return all.sort((a, b) =>
      a.team !== b.team ? (a.team === 'A' ? -1 : 1) : b.kills - a.kills,
    );
  }

  /**
   * Synchronizes active roster from `LobbyService` if a peer joins or disconnects mid-match.
   */
  public syncLobbyPlayers(players: ReadonlyArray<LobbyPlayer>): void {
    if (this.disposed) return;

    this.rosterMeta.clear();
    const activeIds = new Set<string>();

    for (const p of players) {
      this.rosterMeta.set(p.uid, { ...p });
      if (p.uid === this.localUid) {
        this.localCharacter = p.character;
        this.localName = p.name;
        if (!this.roundState.sidesSwapped) {
          this.localTeam = p.team;
        } else {
          this.localTeam = p.team === 'A' ? 'D' : 'A';
        }
      }
      if (p.online !== false) {
        activeIds.add(p.uid);
      }
    }

    if (this.role === 'host' && this.hostSim) {
      for (const p of players) {
        if (p.online !== false) {
          this.hostSim.addOrUpdateLobbyPlayer(p);
        }
      }
      for (const existing of this.hostSim.getPlayers()) {
        if (existing.uid !== this.localUid && !activeIds.has(existing.uid)) {
          const dropEvt = this.hostSim.removePlayer(existing.uid);
          this.hostPrevRemoteTransforms.delete(existing.uid);
          if (dropEvt) {
            this.hostBroadcastEvent(dropEvt);
            this.handleAuthoritativeEvent(dropEvt);
          }
        }
      }
      const peerUids = Array.from(activeIds).filter((uid) => uid !== this.hostUid);
      this.network.syncPeers(peerUids);
    }
  }

  /**
   * Fixed 30 Hz simulation tick called by `GameLoop`.
   */
  public tick(input: InputSnapshot): void {
    if (this.disposed) return;

    const dt = input.dt > 0 ? input.dt : SIM_DT;
    const nowWallMs = Date.now();
    this.prevEyePos = vec3Clone(this.currEyePos);

    // Smooth client-side countdown between snapshots
    if (this.role === 'client' && this.roundState.phase !== 'ended') {
      this.roundState.phaseRemainingSec = Math.max(0, this.roundState.phaseRemainingSec - dt);
      if (this.roundState.phase === 'planted') {
        this.roundState.kern.fuseRemainingSec = Math.max(
          0,
          this.roundState.kern.fuseRemainingSec - dt,
        );
      }
    }

    const canAct = this.localAlive && this.roundState.phase !== 'ended';
    if (this.localAlive) {
      this.currentYaw = input.yaw;
      this.currentPitch = input.pitch;
    }

    const requestedSlot = input.equipSlot ?? this.pendingEquipSlot;
    this.pendingEquipSlot = undefined;
    if (this.role === 'client' && canAct && requestedSlot) {
      const ok = this.inventory.selectSlot(requestedSlot);
      if (ok) {
        const gun = this.inventory.activeGun;
        if (gun) this.recoil.setWeapon(gun.weapon);
        else this.recoil.reset();
        this.isAdsActive = false;
      }
    }

    const activeGun = this.inventory.activeGun;
    const autoReload =
      canAct &&
      activeGun !== null &&
      input.fire &&
      activeGun.ammoInMag === 0 &&
      !activeGun.isReloading &&
      activeGun.fireCooldown <= 1e-6 &&
      activeGun.canReload();

    this.seqCounter += 1;
    const weaponSlot = this.pendingWeaponSlot;
    this.pendingWeaponSlot = undefined;

    const pkt: ClientInputPacket = {
      seq: this.seqCounter,
      clientTimeMs: nowWallMs,
      forward: canAct ? clamp(input.forward, -1, 1) : 0,
      right: canAct ? clamp(input.right, -1, 1) : 0,
      jump: canAct ? input.jump : false,
      crouch: canAct ? input.crouch : false,
      walk: canAct ? input.walk : false,
      fire: canAct ? input.fire : false,
      ads: canAct ? input.ads : false,
      reload: canAct ? input.reload || autoReload : false,
      ...(canAct && input.holdKern ? { holdKern: true } : {}),
      ...(canAct && requestedSlot ? { equipSlot: requestedSlot } : {}),
      ...(weaponSlot ? { weaponSlot } : {}),
      yaw: this.currentYaw,
      pitch: this.currentPitch,
    };

    if (this.role === 'host') {
      this.tickAsHost(pkt, dt, nowWallMs);
    } else {
      this.tickAsClient(pkt, dt, nowWallMs);
    }
  }

  private syncHostLocalMirror(): void {
    if (!this.hostSim) return;
    this.roundState = this.hostSim.roundManager.toSnapshot();

    const selfPlayer = this.hostSim.getPlayer(this.localUid);
    if (!selfPlayer) return;

    this.localTeam = selfPlayer.team;
    this.localCharacter = selfPlayer.character;
    this.currEyePos = selfPlayer.motor.getEyePos();
    this.playerHp = selfPlayer.hp;
    this.playerShield = selfPlayer.armor;
    this.playerArmorMax = selfPlayer.armorMax;
    this.localAlive = selfPlayer.alive;
    this.respawnRemainingSec = 0;
    this.credits = selfPlayer.credits;
    this.chargesQ = selfPlayer.chargesQ;
    this.chargesE = selfPlayer.chargesE;
    this.hasKern =
      (this.roundState.kern.status === 'carried' ||
        this.roundState.kern.status === 'planting') &&
      this.roundState.kern.carrierUid === this.localUid;

    this.localKills = selfPlayer.kills;
    this.localDeaths = selfPlayer.deaths;
    this.localAssists = selfPlayer.assists;
    this.localPlants = selfPlayer.plants;
    this.localDefuses = selfPlayer.defuses;
    this.localUltPoints = selfPlayer.ultPoints;
    this.localAbilities = this.hostSim.abilitySystem.getPlayerAbilityState(selfPlayer);
  }

  private tickAsHost(pkt: ClientInputPacket, dt: number, nowWallMs: number): void {
    if (!this.hostSim) return;

    for (const p of this.hostSim.getPlayers()) {
      if (p.uid === this.localUid) continue;
      this.hostPrevRemoteTransforms.set(p.uid, {
        pos: vec3Clone(p.motor.feetPos),
        yaw: p.yaw,
        pitch: p.pitch,
      });
    }

    const wasAlive = this.localAlive;
    this.hostSim.enqueueInput(this.localUid, pkt);
    const simEvents = this.hostSim.step(dt, nowWallMs);

    this.syncHostLocalMirror();

    const selfPlayer = this.hostSim.getPlayer(this.localUid);
    if (selfPlayer) {
      const activeGun = selfPlayer.inventory.activeGun;
      this.isAdsActive = Boolean(
        pkt.ads &&
          activeGun &&
          activeGun.weapon.hasScopeZoom &&
          !activeGun.isReloading &&
          selfPlayer.alive,
      );
      this.currentSpreadDeg = activeGun
        ? computeEffectiveWeaponSpreadDeg(
            activeGun.weapon,
            selfPlayer.motor.stance,
            selfPlayer.motor.horizontalSpeed,
            selfPlayer.recoil.shotIndex,
            this.isAdsActive,
          )
        : 0;

      if (!wasAlive && selfPlayer.alive) {
        this.prevEyePos = vec3Clone(this.currEyePos);
      }
    }

    for (const ev of simEvents) {
      this.hostBroadcastEvent(ev);
      this.handleAuthoritativeEvent(ev);
    }

    const snap = this.hostSim.buildSnapshot(nowWallMs);
    this.network.host?.broadcastSnapshot(snap, monotonicNowMs());
  }

  private tickClientTimersAndEffects(dt: number): void {
    if (dt <= 0) return;

    if (this.localAbilities.buffRemainingSec > 0) {
      this.localAbilities.buffRemainingSec = Math.max(
        0,
        this.localAbilities.buffRemainingSec - dt,
      );
      if (this.localAbilities.buffRemainingSec <= 1e-6) {
        this.localAbilities.buffRemainingSec = 0;
        this.localAbilities.activeBuff = null;
      }
    }
    if (this.localAbilities.weaponLockoutSec > 0) {
      this.localAbilities.weaponLockoutSec = Math.max(
        0,
        this.localAbilities.weaponLockoutSec - dt,
      );
    }
    if (this.localAbilities.slowedSec > 0) {
      this.localAbilities.slowedSec = Math.max(0, this.localAbilities.slowedSec - dt);
    }
    if (this.localAbilities.revealedSec > 0) {
      this.localAbilities.revealedSec = Math.max(0, this.localAbilities.revealedSec - dt);
      if (this.localAbilities.revealedSec <= 1e-6) {
        this.localAbilities.revealedSec = 0;
        this.localAbilities.revealedToTeam = null;
      }
    }

    for (let i = this.clientEffects.length - 1; i >= 0; i--) {
      const eff = this.clientEffects[i];
      eff.remainingSec -= dt;
      if (eff.remainingSec <= 1e-6) {
        if (eff.kind === 'shield_post' && this.clientShieldColliderIds.has(eff.id)) {
          this.clientPhysicsWorld?.removeDynamicBlockCollider(eff.id);
          this.clientShieldColliderIds.delete(eff.id);
        }
        this.clientEffects.splice(i, 1);
      }
    }
  }

  private tickAsClient(pkt: ClientInputPacket, dt: number, nowWallMs: number): void {
    if (!this.clientMotor || !this.clientPhysicsWorld) return;

    this.clientPhysicsWorld.setSpawnBarriersActive(this.roundState.barriersActive);
    this.tickClientTimersAndEffects(dt);

    const isChannelingKern =
      (this.roundState.kern.status === 'planting' ||
        this.roundState.kern.status === 'defusing') &&
      this.roundState.kern.actorUid === this.localUid;

    const isKnifeSprint =
      !isChannelingKern &&
      this.inventory.activeSlot === 3 &&
      this.clientMotor.grounded &&
      !pkt.crouch &&
      !pkt.walk &&
      !pkt.jump &&
      (Math.abs(pkt.forward) > 1e-4 || Math.abs(pkt.right) > 1e-4);

    const knifeMult = isKnifeSprint ? KNIFE_RUN_SPEED / RUN_SPEED : 1.0;
    this.clientMotor.speedMultiplier = computeAbilitySpeedMultiplier(
      this.localAbilities,
      knifeMult,
    );

    const snapInput: InputSnapshot = {
      seq: pkt.seq,
      forward: isChannelingKern ? 0 : pkt.forward,
      right: isChannelingKern ? 0 : pkt.right,
      jump: isChannelingKern ? false : pkt.jump,
      crouch: pkt.crouch,
      walk: pkt.walk,
      fire: pkt.fire,
      ads: pkt.ads,
      reload: pkt.reload,
      holdKern: pkt.holdKern,
      equipSlot: pkt.equipSlot,
      yaw: pkt.yaw,
      pitch: pkt.pitch,
      dt,
    };

    if (this.localAlive) {
      const { footstepTriggered } = this.clientMotor.step(snapInput);
      this.clientMotor.syncWorldQueries();
      this.currEyePos = this.clientMotor.getEyePos();
      this.prediction.recordInput(snapInput, this.clientMotor.feetPos);

      if (footstepTriggered) {
        this.events.emit('footstep', {
          uid: this.localUid,
          isLocal: true,
          pos: vec3Clone(this.clientMotor.feetPos),
        });
      }

      const weaponLocked = this.localAbilities.weaponLockoutSec > 1e-6;
      const combatAllowed =
        (this.roundState.phase === 'action' || this.roundState.phase === 'planted') &&
        !isChannelingKern &&
        !weaponLocked;
      const allowReload = this.roundState.phase !== 'ended' && !isChannelingKern;

      const reloadMult = computeAbilityReloadMultiplier(this.localAbilities);
      const activeGunBefore = this.inventory.activeGun;
      if (activeGunBefore && activeGunBefore.isReloading && reloadMult > 1.0 && dt > 0) {
        activeGunBefore.reloadTimer -= dt * (reloadMult - 1.0);
      }

      const stepRes = this.inventory.step(
        dt,
        combatAllowed ? pkt.fire : false,
        allowReload ? pkt.reload : false,
      );

      const activeGun = this.inventory.activeGun;
      this.isAdsActive = Boolean(
        pkt.ads && activeGun && activeGun.weapon.hasScopeZoom && !activeGun.isReloading,
      );

      if (stepRes.reloadStarted && activeGun) {
        this.recoil.reset();
        this.events.emit('reload', {
          uid: this.localUid,
          isLocal: true,
          weaponId: activeGun.weaponId,
          durationSec: activeGun.weapon.reloadTimeSec,
        });
      }

      if (stepRes.slashedKnife && combatAllowed) {
        this.emitOptimisticClientKnifeSlash(pkt.yaw, pkt.pitch, nowWallMs);
      } else if (stepRes.firedGun && activeGun && combatAllowed) {
        this.emitOptimisticClientShot(activeGun.weapon, pkt.yaw, pkt.pitch, nowWallMs);
      }

      if (activeGun) {
        const holdingContinuous =
          combatAllowed &&
          pkt.fire &&
          !activeGun.isReloading &&
          activeGun.ammoInMag > 0 &&
          (activeGun.weapon.automatic || stepRes.firedGun);

        this.recoil.update(dt, holdingContinuous, activeGun.weapon);
        this.currentSpreadDeg = computeEffectiveWeaponSpreadDeg(
          activeGun.weapon,
          this.clientMotor.stance,
          this.clientMotor.horizontalSpeed,
          this.recoil.shotIndex,
          this.isAdsActive,
        );
      } else {
        this.currentSpreadDeg = 0;
      }
    } else {
      this.isAdsActive = false;
      this.currEyePos = this.clientMotor.getEyePos();
    }

    this.network.client?.sendInput(pkt);
  }

  private emitOptimisticClientShot(
    stats: WeaponStats,
    baseYaw: number,
    basePitch: number,
    nowWallMs: number,
  ): void {
    if (!this.clientPhysicsWorld || !this.clientMotor) return;
    this.totalShots += 1;

    const origin = vec3Clone(this.currEyePos);
    const firedShotIndex = Math.floor(this.recoil.shotIndex);
    const recoilMult = computeAbilityRecoilMultiplier(this.localAbilities);
    const rawRecoil = getRecoilAnglesRad(stats, firedShotIndex);
    const recoilPitchRad = rawRecoil.pitchRad * recoilMult;
    const recoilYawRad = rawRecoil.yawRad * recoilMult;
    const spreadRad =
      computeEffectiveWeaponSpreadRad(
        stats,
        this.clientMotor.stance,
        this.clientMotor.horizontalSpeed,
        firedShotIndex,
        this.isAdsActive,
      ) * recoilMult;

    const remotePlayers = this.interpolator.sampleRemotePlayers(this.localUid, nowWallMs);
    const targets: PvpHitscanTarget[] = remotePlayers.map((rp) => ({
      uid: rp.uid,
      team: rp.team,
      alive: rp.alive,
      pos: rp.pos,
      stance: rp.stance,
    }));

    const pellets = Math.max(1, stats.pellets);
    for (let p = 0; p < pellets; p += 1) {
      const applied = applySpreadAndRecoilToAngles(
        baseYaw,
        basePitch,
        recoilPitchRad,
        recoilYawRad,
        spreadRad,
        this.recoil.rng,
      );

      const hit = performPvpHitscan(
        origin,
        applied.dir,
        HOST_HITSCAN_MAX_RANGE_M,
        this.clientPhysicsWorld,
        targets,
        this.localUid,
        this.localTeam,
      );

      this.events.emit('shot', {
        shooterUid: this.localUid,
        isLocal: true,
        isOptimistic: true,
        weaponId: stats.id,
        origin: vec3Clone(origin),
        hitPoint: vec3Clone(hit.point),
        hitNormal: vec3Clone(hit.normal),
        hitZone: hit.hitZone,
        targetUid: hit.targetUid,
      });
    }

    this.recoil.onFire(stats);
  }

  private emitOptimisticClientKnifeSlash(
    baseYaw: number,
    basePitch: number,
    nowWallMs: number,
  ): void {
    if (!this.clientPhysicsWorld) return;
    const origin = vec3Clone(this.currEyePos);
    const dir = aimDirectionFromAngles(baseYaw, basePitch);
    const remotePlayers = this.interpolator.sampleRemotePlayers(this.localUid, nowWallMs);
    const targets: PvpHitscanTarget[] = remotePlayers.map((rp) => ({
      uid: rp.uid,
      team: rp.team,
      alive: rp.alive,
      pos: rp.pos,
      stance: rp.stance,
    }));

    const hit = performPvpHitscan(
      origin,
      dir,
      KNIFE_RANGE_M,
      this.clientPhysicsWorld,
      targets,
      this.localUid,
      this.localTeam,
    );

    this.events.emit('shot', {
      shooterUid: this.localUid,
      isLocal: true,
      isOptimistic: true,
      isKnife: true,
      weaponId: this.weapon.weaponId,
      origin,
      hitPoint: vec3Clone(hit.point),
      hitNormal: vec3Clone(hit.normal),
      hitZone: hit.hitZone,
      targetUid: hit.targetUid,
    });
  }

  private handleClientSnapshot(snap: WorldSnapshot): void {
    const nowWallMs = Date.now();
    this.interpolator.pushSnapshot(snap, nowWallMs);

    if (snap.round) {
      this.roundState = {
        ...snap.round,
        kern: {
          ...snap.round.kern,
          pos: vec3Clone(snap.round.kern.pos),
        },
      };
      this.clientPhysicsWorld?.setSpawnBarriersActive(snap.round.barriersActive);
    }

    if (snap.effects !== undefined) {
      this.syncClientEffectsFromSnapshot(snap.effects);
    }

    for (const p of snap.players) {
      const existingMeta = this.rosterMeta.get(p.uid);
      if (!existingMeta) {
        this.rosterMeta.set(p.uid, {
          uid: p.uid,
          name: p.name,
          team: p.team,
          character: p.character,
          ready: true,
          online: true,
        });
      } else {
        existingMeta.team = p.team;
        existingMeta.name = p.name;
        existingMeta.character = p.character;
      }
    }

    const selfState = snap.players.find((p) => p.uid === this.localUid);
    if (!selfState || !this.clientMotor) return;

    const wasAlive = this.localAlive;
    this.localTeam = selfState.team;
    this.localCharacter = selfState.character;
    this.playerHp = selfState.hp;
    this.playerShield = selfState.armor;
    this.playerArmorMax = selfState.armorMax;
    this.localAlive = selfState.alive;
    this.credits = selfState.credits;
    this.hasKern = selfState.hasKern;
    this.localKills = selfState.kills;
    this.localDeaths = selfState.deaths;
    this.localAssists = selfState.assists;
    this.localPlants = selfState.plants;
    this.localDefuses = selfState.defuses;
    this.localUltPoints = selfState.ultPoints;

    if (selfState.abilities) {
      this.localAbilities = { ...selfState.abilities };
      this.chargesQ = selfState.abilities.qCharges;
      this.chargesE = selfState.abilities.eCharges;
    } else {
      this.localAbilities = createDefaultAbilityState(
        this.localCharacter,
        this.chargesQ,
        this.chargesE,
        this.localUltPoints,
      );
    }

    this.inventory.syncOwnedWeapons(
      selfState.primaryWeapon,
      selfState.secondaryWeapon,
      !wasAlive && selfState.alive ? selfState.activeSlot : undefined,
    );

    if (wasAlive && !selfState.alive) {
      this.isAdsActive = false;
    } else if (!wasAlive && selfState.alive) {
      this.spectateTargetUid = null;
      this.inventory.refillAllAmmo();
      const gun = this.inventory.activeGun;
      if (gun) this.recoil.setWeapon(gun.weapon);
      else this.recoil.reset();
    }

    const rec = this.prediction.reconcile(selfState, this.clientMotor);
    this.currEyePos = this.clientMotor.getEyePos();
    if (rec.snapped) {
      this.prevEyePos = vec3Clone(this.currEyePos);
    }
  }

  private handleAuthoritativeEvent(ev: NetGameEvent): void {
    switch (ev.type) {
      case 'shot': {
        this.lastShotPointByUid.set(ev.shooterUid, vec3Clone(ev.hitPoint));
        if (this.role === 'client' && ev.shooterUid === this.localUid) {
          return;
        }
        if (this.role === 'host' && ev.shooterUid === this.localUid) {
          this.totalShots += 1;
        }

        const toOrigin = vec3Normalize(vec3Sub(ev.origin, ev.hitPoint));
        this.events.emit('shot', {
          shooterUid: ev.shooterUid,
          isLocal: ev.shooterUid === this.localUid,
          isOptimistic: false,
          weaponId: ev.weaponId,
          origin: vec3Clone(ev.origin),
          hitPoint: vec3Clone(ev.hitPoint),
          hitNormal: toOrigin,
          hitZone: ev.hitZone,
          targetUid: ev.targetUid,
        });
        break;
      }

      case 'damage': {
        const attackerMeta = this.rosterMeta.get(ev.attackerUid);
        const victimMeta = this.rosterMeta.get(ev.victimUid);
        const attackerName = attackerMeta?.name ?? 'Spieler';
        const victimName = victimMeta?.name ?? 'Spieler';
        const attackerTeam = attackerMeta?.team ?? 'A';
        const victimTeam = victimMeta?.team ?? 'D';

        if (ev.attackerUid === this.localUid) {
          this.totalHits += 1;
          const hitPoint =
            this.lastShotPointByUid.get(ev.attackerUid) ?? vec3Clone(this.currEyePos);
          this.events.emit('localHitConfirmed', {
            victimUid: ev.victimUid,
            victimName,
            hitZone: ev.hitZone,
            damage: ev.damage,
            killed: ev.killed,
            hpAfter: ev.hpAfter,
            armorAfter: ev.armorAfter,
            weaponId: ev.weaponId,
            hitPoint,
          });
        }

        if (ev.victimUid === this.localUid) {
          this.playerHp = ev.hpAfter;
          this.playerShield = ev.armorAfter;
          if (ev.killed) {
            this.localAlive = false;
            this.isAdsActive = false;
          }

          const attackerPos = this.findPlayerWorldPos(ev.attackerUid);
          this.events.emit('localDamaged', {
            attackerUid: ev.attackerUid,
            attackerName,
            attackerPos,
            damage: ev.damage,
            hitZone: ev.hitZone,
            hpAfter: ev.hpAfter,
            armorAfter: ev.armorAfter,
            killed: ev.killed,
            weaponId: ev.weaponId,
          });
        } else {
          this.events.emit('remoteDamaged', {
            attackerUid: ev.attackerUid,
            victimUid: ev.victimUid,
            damage: ev.damage,
            hitZone: ev.hitZone,
            hpAfter: ev.hpAfter,
            armorAfter: ev.armorAfter,
            killed: ev.killed,
            weaponId: ev.weaponId,
          });
        }

        if (ev.killed) {
          if (this.role === 'client') {
            if (ev.attackerUid === this.localUid) {
              this.localKills += 1;
              this.credits = Math.min(9000, this.credits + 200);
            }
            if (ev.victimUid === this.localUid) {
              this.localDeaths += 1;
            }
          }
          this.events.emit('killFeed', {
            attackerUid: ev.attackerUid,
            attackerName,
            attackerTeam,
            victimUid: ev.victimUid,
            victimName,
            victimTeam,
            weaponId: ev.weaponId,
            hitZone: ev.hitZone,
          });
        }
        break;
      }

      case 'respawn': {
        const isLocal = ev.uid === this.localUid;
        if (isLocal) {
          this.localAlive = true;
          this.spectateTargetUid = null;
          this.playerHp = PLAYER_MAX_HP;
          this.respawnRemainingSec = 0;
          this.currentYaw = ev.yaw;
          this.currentPitch = 0;

          if (this.role === 'client' && this.clientMotor) {
            this.prediction.reset();
            this.clientMotor.teleport(ev.pos);
            this.inventory.refillAllAmmo();
            const gun = this.inventory.activeGun;
            if (gun) this.recoil.setWeapon(gun.weapon);
            else this.recoil.reset();
            this.currEyePos = this.clientMotor.getEyePos();
            this.prevEyePos = vec3Clone(this.currEyePos);
          } else if (this.role === 'host') {
            this.prevEyePos = vec3Clone(this.currEyePos);
          }
        }

        this.events.emit('respawn', {
          uid: ev.uid,
          isLocal,
          pos: vec3Clone(ev.pos),
          yaw: ev.yaw,
        });
        break;
      }

      case 'reload': {
        const isLocal = ev.uid === this.localUid;
        if (this.role === 'client' && isLocal) {
          return;
        }
        this.events.emit('reload', {
          uid: ev.uid,
          isLocal,
          weaponId: ev.weaponId,
          durationSec: WEAPONS[ev.weaponId].reloadTimeSec,
        });
        break;
      }

      case 'footstep': {
        const isLocal = ev.uid === this.localUid;
        if (this.role === 'client' && isLocal) {
          return;
        }
        this.events.emit('footstep', {
          uid: ev.uid,
          isLocal,
          pos: vec3Clone(ev.pos),
        });
        break;
      }

      case 'buy_result': {
        const isLocal = ev.uid === this.localUid;
        if (isLocal && this.role === 'client') {
          this.credits = ev.credits;
          if (ev.ok && ev.weaponId) {
            this.inventory.grantWeapon(
              ev.weaponId,
              !isSecondaryWeapon(ev.weaponId) || !this.inventory.primary,
            );
            const gun = this.inventory.activeGun;
            if (gun) this.recoil.setWeapon(gun.weapon);
          }
          if (ev.ok && ev.armor !== undefined) {
            this.playerShield = ev.armor;
          }
          if (ev.ok && ev.armorMax !== undefined) {
            this.playerArmorMax = ev.armorMax;
          }
        }

        this.events.emit('buyResult', {
          uid: ev.uid,
          isLocal,
          ok: ev.ok,
          reason: ev.reason,
          credits: ev.credits,
          weaponId: ev.weaponId,
          armor: ev.armor,
          armorMax: ev.armorMax,
        });
        break;
      }

      case 'round_phase': {
        if (this.role === 'client') {
          this.roundState.phase = ev.phase;
          this.roundState.roundNumber = ev.roundNumber;
          this.roundState.scoreA = ev.scoreA;
          this.roundState.scoreB = ev.scoreB;
          this.roundState.winnerTeam = ev.winnerTeam;
          this.roundState.winReason = ev.winReason;
          if (ev.sidesSwapped !== undefined) {
            this.roundState.sidesSwapped = ev.sidesSwapped;
          }
          if (ev.isSuddenDeath !== undefined) {
            this.roundState.isSuddenDeath = ev.isSuddenDeath;
          }
          this.roundState.matchWinnerTeam = ev.matchWinnerTeam;
          this.roundState.barriersActive = ev.phase === 'buy';
          this.clientPhysicsWorld?.setSpawnBarriersActive(this.roundState.barriersActive);

          if (ev.phase === 'post_round' && ev.winnerTeam) {
            if (ev.winnerTeam === this.localTeam) {
              this.clientTeamLossStreak = 0;
            } else {
              this.clientTeamLossStreak += 1;
            }
          } else if (ev.phase === 'buy' && (ev.roundNumber === 1 || ev.roundNumber === this.roundsToWin || ev.isSuddenDeath)) {
            this.clientTeamLossStreak = 0;
          }
        }

        this.events.emit('roundPhase', {
          phase: ev.phase,
          roundNumber: ev.roundNumber,
          scoreA: ev.scoreA,
          scoreB: ev.scoreB,
          winnerTeam: ev.winnerTeam,
          winReason: ev.winReason,
          sidesSwapped: ev.sidesSwapped,
          isSuddenDeath: ev.isSuddenDeath,
          matchWinnerTeam: ev.matchWinnerTeam,
        });
        break;
      }

      case 'kern_event': {
        this.events.emit('kernEvent', {
          action: ev.action,
          uid: ev.uid,
          zone: ev.zone,
          pos: vec3Clone(ev.pos),
        });
        break;
      }

      case 'ability_cast': {
        this.events.emit('abilityCast', {
          uid: ev.uid,
          isLocal: ev.uid === this.localUid,
          team: ev.team,
          character: ev.character,
          slot: ev.slot,
          abilityName: ev.abilityName,
          origin: vec3Clone(ev.origin),
          ...(ev.targetPos ? { targetPos: vec3Clone(ev.targetPos) } : {}),
        });
        break;
      }

      case 'effect_event': {
        if (this.role === 'client') {
          if (ev.action === 'destroyed') {
            const idx = this.clientEffects.findIndex((e) => e.id === ev.effectId);
            if (idx >= 0) {
              this.clientEffects.splice(idx, 1);
            }
            if (this.clientShieldColliderIds.has(ev.effectId)) {
              this.clientPhysicsWorld?.removeDynamicBlockCollider(ev.effectId);
              this.clientShieldColliderIds.delete(ev.effectId);
            }
          } else if (ev.action === 'triggered') {
            const found = this.clientEffects.find((e) => e.id === ev.effectId);
            if (found) {
              found.triggered = true;
              found.remainingSec = Math.min(found.remainingSec, 0.4);
            }
          }
        }

        this.events.emit('effectEvent', {
          effectId: ev.effectId,
          kind: ev.kind,
          action: ev.action,
          pos: vec3Clone(ev.pos),
        });
        break;
      }

      case 'chat': {
        // Defense-in-depth: never surface another team's team-only chat locally
        if (ev.teamOnly && ev.team !== this.localTeam) {
          return;
        }
        this.events.emit('chat', {
          uid: ev.uid,
          isLocal: ev.uid === this.localUid,
          senderName: ev.senderName,
          team: ev.team,
          text: ev.text,
          teamOnly: ev.teamOnly,
          timestampMs: ev.timestampMs,
        });
        break;
      }
    }
  }

  private syncClientEffectsFromSnapshot(effects: ReadonlyArray<ActiveWorldEffect>): void {
    const activeShieldIds = new Set<string>();
    this.clientEffects = effects.map((eff) => {
      if (eff.kind === 'shield_post' && eff.remainingSec > 1e-6) {
        activeShieldIds.add(eff.id);
        if (!this.clientShieldColliderIds.has(eff.id)) {
          this.clientPhysicsWorld?.addDynamicBlockCollider(
            eff.id,
            {
              x: eff.pos.x,
              y: eff.pos.y + TESSA_SHIELD_HEIGHT_M * 0.5,
              z: eff.pos.z,
            },
            {
              x: TESSA_SHIELD_WIDTH_M,
              y: TESSA_SHIELD_HEIGHT_M,
              z: TESSA_SHIELD_DEPTH_M,
            },
            eff.yaw,
          );
          this.clientShieldColliderIds.add(eff.id);
        }
      }
      return {
        ...eff,
        pos: vec3Clone(eff.pos),
      };
    });

    for (const oldId of Array.from(this.clientShieldColliderIds)) {
      if (!activeShieldIds.has(oldId)) {
        this.clientPhysicsWorld?.removeDynamicBlockCollider(oldId);
        this.clientShieldColliderIds.delete(oldId);
      }
    }
  }

  private findPlayerWorldPos(uid: string): Vec3 | null {
    if (this.role === 'host' && this.hostSim) {
      const p = this.hostSim.getPlayer(uid);
      return p ? vec3Clone(p.motor.feetPos) : null;
    }
    const found = this.cachedRemotePlayers.find((p) => p.uid === uid);
    return found ? vec3Clone(found.pos) : null;
  }

  /**
   * Called once per render frame (`renderFn(alpha, frameDt)`) to decay prediction smoothing
   * and sample smooth remote player transforms for `RemotePlayerRenderer` & Spectator Camera.
   */
  public updateRenderFrame(
    frameDt: number,
    alpha = 1,
    nowWallMs: number = Date.now(),
  ): ReadonlyArray<NetPlayerState> {
    if (this.disposed) return [];

    if (this.role === 'client') {
      this.prediction.decayErrorOffset(frameDt);
      this.cachedRemotePlayers = this.interpolator.sampleRemotePlayers(this.localUid, nowWallMs);
      if (!this.localAlive) {
        this.getSpectatedPlayer();
      }
      return this.cachedRemotePlayers;
    }

    if (!this.hostSim) return [];
    const t = clamp(alpha, 0, 1);
    const out: NetPlayerState[] = [];
    const kernCarrierUid =
      (this.hostSim.roundManager.kern.status === 'carried' ||
        this.hostSim.roundManager.kern.status === 'planting')
        ? this.hostSim.roundManager.kern.carrierUid
        : undefined;

    for (const p of this.hostSim.getPlayers()) {
      if (p.uid === this.localUid) continue;

      const prev = this.hostPrevRemoteTransforms.get(p.uid);
      const currPos = p.motor.feetPos;
      const shouldLerp = prev && p.alive && vec3Dist(prev.pos, currPos) < 6.0;
      const activeGun = p.inventory.activeGun;
      const fallbackGun = p.inventory.fallbackGun;

      out.push({
        uid: p.uid,
        name: p.name,
        team: p.team,
        character: p.character,
        pos: shouldLerp ? vec3Lerp(prev.pos, currPos, t) : vec3Clone(currPos),
        vel: vec3Clone(p.motor.velocity),
        yaw: shouldLerp ? lerpAngleRad(prev.yaw, p.yaw, t) : p.yaw,
        pitch: shouldLerp ? prev.pitch + (p.pitch - prev.pitch) * t : p.pitch,
        stance: p.motor.stance,
        hp: p.hp,
        armor: p.armor,
        armorMax: p.armorMax,
        alive: p.alive,
        weaponId: activeGun ? activeGun.weaponId : fallbackGun.weaponId,
        primaryWeapon: p.inventory.primaryWeaponId,
        secondaryWeapon: p.inventory.secondaryWeaponId,
        activeSlot: p.inventory.activeSlot,
        ammoInMag: activeGun ? activeGun.ammoInMag : 0,
        isReloading: activeGun ? activeGun.isReloading : false,
        hasKern: kernCarrierUid === p.uid,
        credits: p.credits,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        plants: p.plants,
        defuses: p.defuses,
        ultPoints: p.ultPoints,
        lastAckSeq: p.lastAckSeq,
        abilities: this.hostSim.abilitySystem.getPlayerAbilityState(p),
      });
    }

    this.cachedRemotePlayers = out;
    if (!this.localAlive) {
      this.getSpectatedPlayer();
    }
    return out;
  }

  public getRemotePlayers(): ReadonlyArray<NetPlayerState> {
    return this.cachedRemotePlayers;
  }

  public setNetSim(cfg: Partial<NetSimConfig>): void {
    this.network.setNetSim(cfg);
  }

  public getNetSim(): NetSimConfig {
    return this.network.getNetSim();
  }

  /**
   * Returns exact Phase 4 Round/Economy/Kern/Spectator diagnostics for `__SHARDLINE__.getRoundDiagnostics()`.
   */
  public getRoundDiagnostics(): RoundDiagnosticsSnapshot {
    const spectated = this.getSpectatedPlayer();
    return {
      roundNumber: this.roundState.roundNumber,
      phase: this.roundState.phase,
      phaseRemainingSec: Math.round(this.roundState.phaseRemainingSec * 10) / 10,
      barriersActive: this.roundState.barriersActive,
      scoreA: this.roundState.scoreA,
      scoreB: this.roundState.scoreB,
      credits: this.credits,
      primaryWeapon: this.inventory.primaryWeaponId,
      secondaryWeapon: this.inventory.secondaryWeaponId,
      armor: this.playerShield,
      hasKern: this.hasKern,
      kernStatus: this.roundState.kern.status,
      spectatingUid: spectated ? spectated.uid : null,
      abilities: { ...this.getAbilityState() },
      activeEffectsCount: this.getActiveEffects().length,
    };
  }

  public getNetDiagnostics(fps = 0): NetDiagnosticsSnapshot {
    const metrics = this.network.getMetrics();
    const mode = metrics.mode;
    const snapshotRateHz =
      mode === 'relay'
        ? HOST_SNAPSHOT_HZ_RELAY
        : mode === 'p2p' || mode === 'loopback'
          ? HOST_SNAPSHOT_HZ_P2P
          : 0;

    const predictionErrorMm =
      this.role === 'client'
        ? Math.round(this.prediction.lastReconcileErrorM * 1000 * 10) / 10
        : 0;

    const localPos = vec3Clone(this.motor.feetPos);
    const spectated = this.getSpectatedPlayer();

    return {
      role: this.role,
      transportMode: mode,
      rttMs: metrics.rttMs,
      packetLossPct: metrics.packetLossPct,
      tickRate: SIM_TICK_RATE,
      snapshotRateHz,
      fps: Math.round(fps),
      predictionErrorMm,
      interpolatedPlayerCount: this.cachedRemotePlayers.length,
      localUid: this.localUid,
      localPos,
      localHp: this.playerHp,
      localArmor: this.playerShield,
      localAlive: this.localAlive,
      respawnRemainingSec: Math.round(this.respawnRemainingSec * 10) / 10,
      kills: this.localKills,
      deaths: this.localDeaths,
      remotePlayerCount: this.cachedRemotePlayers.length,
      remotePlayers: this.cachedRemotePlayers.map((rp) => ({
        uid: rp.uid,
        name: rp.name,
        team: rp.team,
        pos: vec3Clone(rp.pos),
        hp: rp.hp,
        alive: rp.alive,
      })),
      netSim: this.network.getNetSim(),
      roundNumber: this.roundState.roundNumber,
      roundPhase: this.roundState.phase,
      scoreA: this.roundState.scoreA,
      scoreB: this.roundState.scoreB,
      credits: this.credits,
      activeSlot: this.inventory.activeSlot,
      hasKern: this.hasKern,
      spectatingUid: spectated ? spectated.uid : null,
      abilities: { ...this.getAbilityState() },
      activeEffectsCount: this.getActiveEffects().length,
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;

    this.events.clear();
    this.network.close();
    this.hostSim?.dispose();
    this.clientMotor?.dispose();
    this.clientPhysicsWorld?.dispose();
  }
}
