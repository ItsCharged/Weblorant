import {
  ACTION_PHASE_SEC,
  KNIFE_RUN_SPEED,
  LAG_COMP_MAX_REWIND_MS,
  RUN_SPEED,
  SIM_DT,
  START_CREDITS,
} from '../core/Config';
import {
  aimDirectionFromAngles,
  clamp,
  vec3Clone,
  vec3Dist,
  vec3Dot,
  vec3Normalize,
  vec3Sub,
} from '../core/math';
import type {
  AbilitySlot,
  BuyItemType,
  CharacterId,
  ClientInputPacket,
  ClientReliableMessage,
  InputSnapshot,
  LoadoutSlot,
  LobbyPlayer,
  NetGameEvent,
  NetPlayerState,
  TeamId,
  Vec3,
  WeaponId,
  WorldSnapshot,
} from '../core/types';
import type { MapDefinition, MapZone } from '../data/maps/types';
import { WEAPONS, type WeaponStats } from '../data/weapons';
import { INTERP_DELAY_MS } from '../net/Interpolation';
import { LagCompensation } from '../net/LagCompensation';
import { CharacterMotor } from '../physics/CharacterMotor';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  type AbilityActor,
  AbilitySystem,
  applyBastionDamageReduction,
  computeAbilityRecoilMultiplier,
  computeAbilityReloadMultiplier,
  computeAbilitySpeedMultiplier,
} from './AbilitySystem';
import {
  awardKillCredits,
  getFreeAbilityECharges,
  isSecondaryWeapon,
  type PlayerEconomyLoadout,
  processBuyRequest,
} from './Economy';
import { performPvpHitscan, type PvpHitscanTarget } from './PlayerHitscan';
import {
  applySpreadAndRecoilToAngles,
  getRecoilAnglesRad,
  RecoilState,
} from './Recoil';
import {
  addUltPoint,
  DEFAULT_ROUNDS_TO_WIN,
  RoundManager,
  type RoundParticipantState,
} from './RoundManager';
import {
  computeDamage,
  computeEffectiveWeaponSpreadRad,
  KNIFE_DAMAGE,
  KNIFE_RANGE_M,
  LoadoutInventory,
  type WeaponController,
} from './WeaponLogic';

export const PLAYER_MAX_HP = 100;
export const PLAYER_RESPAWN_DELAY_SEC = 3.0;
export const HOST_MAX_INPUTS_PER_TICK = 4;
export const HOST_MAX_INPUT_QUEUE = 32;
export const HOST_HITSCAN_MAX_RANGE_M = 150;
export const SPAWN_SLOT_SPACING_M = 2.2;
export const CHAT_MAX_LENGTH = 140;
export const CHAT_RATE_LIMIT_COUNT = 4;
export const CHAT_RATE_LIMIT_WINDOW_MS = 3000;

/**
 * Sanitizes raw chat text: strips control characters, collapses whitespace, trims,
 * and truncates to `CHAT_MAX_LENGTH` (140) characters. Returns `''` when nothing remains.
 */
export function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return '';
  return Array.from(collapsed).slice(0, CHAT_MAX_LENGTH).join('').trim();
}

/**
 * Resolves which player UIDs may receive a given authoritative event.
 * Team-only `chat` events are delivered exclusively to members of the sender's team;
 * every other event is delivered to all players.
 */
export function getEventRecipientUids(
  ev: NetGameEvent,
  players: ReadonlyArray<{ uid: string; team: TeamId }>,
): string[] {
  if (ev.type === 'chat' && ev.teamOnly) {
    return players.filter((p) => p.team === ev.team).map((p) => p.uid);
  }
  return players.map((p) => p.uid);
}

export interface HostSimulationOptions {
  hostUid?: string;
  roundsToWin?: number;
  peerRttProvider?: (uid: string) => number;
  initialPhase?: 'buy' | 'action';
  startingPrimaryWeapon?: WeaponId | null;
}

export class AuthoritativePlayer
  implements RoundParticipantState, PlayerEconomyLoadout, AbilityActor
{
  public readonly uid: string;
  public name: string;
  public team: TeamId;
  public originalLobbyTeam: TeamId;
  public character: CharacterId;
  public readonly motor: CharacterMotor;
  public readonly inventory: LoadoutInventory;
  public readonly recoil: RecoilState;

  public hp = PLAYER_MAX_HP;
  public armor = 0;
  public armorMax = 0;
  public alive = true;
  public respawnTimer = 0;
  public yaw: number;
  public pitch = 0;

  public credits = START_CREDITS;
  public chargesQ = 0;
  public chargesE = 0;
  public holdKern = false;
  public isChannelingKern = false;

  public kills = 0;
  public deaths = 0;
  public assists = 0;
  public plants = 0;
  public defuses = 0;
  public ultPoints = 0;

  public lastAckSeq = 0;
  public lastQueuedSeq = 0;
  public inputBudget = HOST_MAX_INPUTS_PER_TICK;
  public readonly inputQueue: ClientInputPacket[] = [];
  public readonly roundDamageByAttacker = new Map<string, number>();
  public readonly recentChatTimestampsMs: number[] = [];

  constructor(options: {
    uid: string;
    name: string;
    team: TeamId;
    character: CharacterId;
    motor: CharacterMotor;
    yaw: number;
    startingPrimaryWeapon?: WeaponId | null;
  }) {
    this.uid = options.uid;
    this.name = options.name;
    this.team = options.team;
    this.originalLobbyTeam = options.team;
    this.character = options.character;
    this.motor = options.motor;
    this.yaw = options.yaw;
    this.inventory = new LoadoutInventory(options.startingPrimaryWeapon ?? null, 'funke');
    this.recoil = new RecoilState(hashUidSeed(options.uid), this.inventory.fallbackGun.weapon);
    this.chargesE = getFreeAbilityECharges(options.character);
  }

  public get pos(): Vec3 {
    return this.motor.feetPos;
  }

  public get eyePos(): Vec3 {
    return this.motor.getEyePos();
  }

  public get vel(): Vec3 {
    return this.motor.velocity;
  }

  public startDash(dirX: number, dirZ: number, speedMps: number, durationSec: number): void {
    this.motor.startDash(dirX, dirZ, speedMps, durationSec);
  }

  public get grounded(): boolean {
    return this.motor.grounded;
  }

  public get horizontalSpeed(): boolean extends never ? number : number {
    return this.motor.horizontalSpeed;
  }

  public get primaryWeapon(): WeaponId | null {
    return this.inventory.primaryWeaponId;
  }

  public set primaryWeapon(id: WeaponId | null) {
    this.inventory.syncOwnedWeapons(id, this.inventory.secondaryWeaponId);
  }

  public get secondaryWeapon(): WeaponId {
    return this.inventory.secondaryWeaponId;
  }

  public set secondaryWeapon(id: WeaponId) {
    this.inventory.syncOwnedWeapons(this.inventory.primaryWeaponId, id);
  }

  public get activeSlot(): LoadoutSlot {
    return this.inventory.activeSlot;
  }

  public set activeSlot(slot: LoadoutSlot) {
    this.inventory.selectSlot(slot);
  }

  public get weapon(): WeaponController {
    return this.inventory.fallbackGun;
  }
}

function hashUidSeed(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i += 1) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Computes lateral non-overlapping team spawn position and yaw for a player slot,
 * resolving against the map's `spawn_attacker` / `spawn_defender` zone when provided.
 */
export function computeTeamSpawnTransform(
  team: TeamId,
  slotIndex: number,
  teamCount: number,
  zones?: ReadonlyArray<MapZone>,
): { pos: Vec3; yaw: number } {
  const safeCount = Math.max(1, teamCount);
  const clampedSlot = clamp(slotIndex, 0, safeCount - 1);
  const offsetX = (clampedSlot - (safeCount - 1) * 0.5) * SPAWN_SLOT_SPACING_M;

  const targetZoneType = team === 'D' ? 'spawn_defender' : 'spawn_attacker';
  const spawnZone = zones?.find((z) => z.type === targetZoneType);
  const baseX = spawnZone ? spawnZone.center.x : 0;
  const baseY = spawnZone ? Math.max(0.05, spawnZone.center.y + 0.05) : 0.05;
  const baseZ = spawnZone ? spawnZone.center.z : team === 'D' ? -52 : 52;

  return {
    pos: { x: baseX + offsetX, y: baseY, z: baseZ },
    yaw: team === 'D' ? Math.PI : 0,
  };
}

/**
 * Pure TypeScript 30 Hz Authoritative Host Simulation with Kernbruch Round Engine,
 * Economy & Buy validation, 6-weapon + Tactical Knife combat, Buy-Phase Spawn Barriers,
 * and 200ms hard-capped Lag Compensation.
 */
export class HostSimulation {
  public readonly mapDef: MapDefinition;
  public readonly physicsWorld: PhysicsWorld;
  public readonly roundManager: RoundManager;
  public readonly abilitySystem: AbilitySystem;
  public readonly lagComp = new LagCompensation();
  public readonly hostUid: string | undefined;
  public tickCount = 0;

  private readonly players = new Map<string, AuthoritativePlayer>();
  private readonly peerRttProvider?: (uid: string) => number;
  private readonly startingPrimaryWeapon: WeaponId | null;
  private disposed = false;

  constructor(
    mapDef: MapDefinition,
    initialPlayers: ReadonlyArray<LobbyPlayer> = [],
    options: HostSimulationOptions = {},
  ) {
    this.mapDef = mapDef;
    this.hostUid = options.hostUid;
    this.peerRttProvider = options.peerRttProvider;
    this.startingPrimaryWeapon = options.startingPrimaryWeapon ?? null;
    this.physicsWorld = new PhysicsWorld(mapDef);
    this.abilitySystem = new AbilitySystem(this.physicsWorld);
    this.roundManager = new RoundManager({
      roundsToWin: options.roundsToWin ?? DEFAULT_ROUNDS_TO_WIN,
      zones: mapDef.zones ?? [],
    });

    for (const p of initialPlayers) {
      if (p.online !== false) {
        this.addOrUpdateLobbyPlayer(p);
      }
    }

    this.roundManager.startMatch(this.getPlayers());
    this.abilitySystem.resetForNewRound(this.getPlayers(), true);

    if (this.startingPrimaryWeapon) {
      for (const p of this.players.values()) {
        p.inventory.grantWeapon(this.startingPrimaryWeapon, true);
        p.recoil.setWeapon(p.weapon.weapon);
      }
    }

    if (options.initialPhase === 'action') {
      this.roundManager.phase = 'action';
      this.roundManager.phaseRemainingSec = ACTION_PHASE_SEC;
      this.roundManager.barriersActive = false;
    }

    this.physicsWorld.setSpawnBarriersActive(this.roundManager.barriersActive);
    this.repositionAllSpawns();
    this.roundManager.kern.resetForRound(this.getPlayers());
  }

  public getPlayer(uid: string): AuthoritativePlayer | undefined {
    return this.players.get(uid);
  }

  public getPlayers(): AuthoritativePlayer[] {
    return Array.from(this.players.values());
  }

  private getTeamSlotTransform(uid: string, team: TeamId): { pos: Vec3; yaw: number } {
    const teamUids = Array.from(this.players.values())
      .filter((p) => p.team === team)
      .map((p) => p.uid)
      .sort();
    if (!teamUids.includes(uid)) {
      teamUids.push(uid);
      teamUids.sort();
    }
    const idx = Math.max(0, teamUids.indexOf(uid));
    return computeTeamSpawnTransform(team, idx, teamUids.length, this.mapDef.zones);
  }

  public repositionAllSpawns(): void {
    for (const p of this.players.values()) {
      const spawn = this.getTeamSlotTransform(p.uid, p.team);
      p.yaw = spawn.yaw;
      p.pitch = 0;
      p.holdKern = false;
      p.isChannelingKern = false;
      p.roundDamageByAttacker.clear();
      p.inventory.refillAllAmmo();
      p.recoil.setWeapon(p.weapon.weapon);
      p.motor.dashRemainingSec = 0;
      p.motor.speedMultiplier = 1.0;
      p.motor.teleport(spawn.pos);
    }
  }

  public addOrUpdateLobbyPlayer(
    playerInfo: Pick<LobbyPlayer, 'uid' | 'name' | 'team' | 'character'>,
  ): AuthoritativePlayer {
    const effectiveTeam: TeamId = this.roundManager.sidesSwapped
      ? playerInfo.team === 'A'
        ? 'D'
        : 'A'
      : playerInfo.team;

    const existing = this.players.get(playerInfo.uid);
    if (existing) {
      const lobbyTeamChanged = existing.originalLobbyTeam !== playerInfo.team;
      existing.name = playerInfo.name;
      existing.originalLobbyTeam = playerInfo.team;
      existing.character = playerInfo.character;
      if (lobbyTeamChanged) {
        existing.team = effectiveTeam;
        const spawn = this.getTeamSlotTransform(existing.uid, existing.team);
        existing.yaw = spawn.yaw;
        existing.pitch = 0;
        existing.motor.teleport(spawn.pos);
      }
      return existing;
    }

    const spawn = this.getTeamSlotTransform(playerInfo.uid, effectiveTeam);
    const motor = new CharacterMotor(this.physicsWorld, spawn.pos);
    const created = new AuthoritativePlayer({
      uid: playerInfo.uid,
      name: playerInfo.name,
      team: effectiveTeam,
      character: playerInfo.character,
      motor,
      yaw: spawn.yaw,
      startingPrimaryWeapon: this.startingPrimaryWeapon,
    });
    created.originalLobbyTeam = playerInfo.team;

    this.players.set(playerInfo.uid, created);
    return created;
  }

  public removePlayer(uid: string): NetGameEvent | null {
    const existing = this.players.get(uid);
    if (!existing) return null;
    const dropEvt = this.roundManager.notifyPlayerDownOrLeft(uid, existing.motor.feetPos);
    this.abilitySystem.removePlayer(uid);
    existing.motor.dispose();
    this.players.delete(uid);
    return dropEvt;
  }

  /**
   * Authoritatively processes a reliable `ClientReliableMessage` (`buy_request`, `ability_use`, `restart_match`, etc.).
   */
  public handleClientMessage(uid: string, msg: ClientReliableMessage): NetGameEvent[] {
    if (this.disposed) return [];
    const events: NetGameEvent[] = [];

    if (msg.type === 'buy_request') {
      const buyEvt = this.handleBuyRequest(uid, msg.itemType, msg.itemId);
      if (buyEvt) events.push(buyEvt);
      return events;
    }

    if (msg.type === 'ability_use') {
      return this.handleAbilityUse(uid, msg.slot, msg.yaw, msg.pitch, msg.targetPos);
    }

    if (msg.type === 'chat') {
      const chatEvt = this.handleChatMessage(uid, msg.text, Boolean(msg.teamOnly));
      if (chatEvt) events.push(chatEvt);
      return events;
    }

    if (msg.type === 'restart_match') {
      if (!this.hostUid || uid === this.hostUid) {
        events.push(...this.restartMatch());
      }
      return events;
    }

    return events;
  }

  /**
   * Validates a chat message (sanitized text `1..140` chars, max `4` messages per `3 s`
   * per player) and produces the authoritative `chat` event, or `null` when rejected.
   */
  public handleChatMessage(
    uid: string,
    rawText: unknown,
    teamOnly: boolean,
    nowMs: number = Date.now(),
  ): NetGameEvent | null {
    const player = this.players.get(uid);
    if (!player || this.disposed) return null;

    const text = sanitizeChatText(rawText);
    if (text.length === 0) return null;

    const stamps = player.recentChatTimestampsMs;
    while (stamps.length > 0 && nowMs - stamps[0] >= CHAT_RATE_LIMIT_WINDOW_MS) {
      stamps.shift();
    }
    if (stamps.length >= CHAT_RATE_LIMIT_COUNT) {
      return null;
    }
    stamps.push(nowMs);

    return {
      type: 'chat',
      uid: player.uid,
      senderName: player.name,
      team: player.team,
      text,
      teamOnly: Boolean(teamOnly),
      timestampMs: nowMs,
    };
  }

  /**
   * Returns recipient UIDs for an authoritative event (team-only chat isolation).
   */
  public getEventRecipients(ev: NetGameEvent): string[] {
    return getEventRecipientUids(ev, this.getPlayers());
  }

  public handleAbilityUse(
    uid: string,
    slot: AbilitySlot,
    yaw: number,
    pitch: number,
    targetPos?: Vec3,
  ): NetGameEvent[] {
    const player = this.players.get(uid);
    if (!player || this.disposed) return [];
    if (slot !== 'q' && slot !== 'e' && slot !== 'x') return [];

    player.isChannelingKern =
      (this.roundManager.kern.status === 'planting' ||
        this.roundManager.kern.status === 'defusing') &&
      this.roundManager.kern.actorUid === player.uid;

    const safeYaw = Number.isFinite(yaw) ? yaw : player.yaw;
    const safePitch = clamp(Number.isFinite(pitch) ? pitch : player.pitch, -1.55, 1.55);
    player.yaw = safeYaw;
    player.pitch = safePitch;

    const safeTargetPos =
      targetPos &&
      Number.isFinite(targetPos.x) &&
      Number.isFinite(targetPos.y) &&
      Number.isFinite(targetPos.z)
        ? { x: targetPos.x, y: targetPos.y, z: targetPos.z }
        : undefined;

    const res = this.abilitySystem.castAbility(
      player,
      slot,
      safeYaw,
      safePitch,
      safeTargetPos,
      this.getPlayers(),
      { phase: this.roundManager.phase },
    );

    return res.events;
  }

  public handleBuyRequest(
    uid: string,
    itemType: BuyItemType,
    itemId: string,
  ): NetGameEvent | null {
    const player = this.players.get(uid);
    if (!player) return null;

    const result = processBuyRequest(
      player,
      this.roundManager.phase,
      itemType,
      itemId,
      this.mapDef.zones,
    );
    if (result.ok && result.weaponId) {
      if (isSecondaryWeapon(result.weaponId)) {
        player.inventory.grantWeapon(result.weaponId, !player.inventory.primary);
      } else {
        player.inventory.grantWeapon(result.weaponId, true);
      }
      player.recoil.setWeapon(player.weapon.weapon);
    }

    return {
      type: 'buy_result',
      uid: player.uid,
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
      credits: result.credits,
      ...(result.weaponId ? { weaponId: result.weaponId } : {}),
      ...(result.armor !== undefined ? { armor: result.armor } : {}),
      ...(result.armorMax !== undefined ? { armorMax: result.armorMax } : {}),
    };
  }

  public restartMatch(): NetGameEvent[] {
    const events: NetGameEvent[] = [];
    for (const p of this.players.values()) {
      p.team = p.originalLobbyTeam;
      p.inputQueue.length = 0;
      p.roundDamageByAttacker.clear();
    }

    const phaseEvt = this.roundManager.startMatch(this.getPlayers());
    this.abilitySystem.resetForNewRound(this.getPlayers(), true);
    this.physicsWorld.setSpawnBarriersActive(true);
    this.lagComp.clear();
    this.repositionAllSpawns();
    this.roundManager.kern.resetForRound(this.getPlayers());

    for (const p of this.players.values()) {
      events.push({
        type: 'respawn',
        uid: p.uid,
        pos: vec3Clone(p.motor.feetPos),
        yaw: p.yaw,
      });
    }
    events.push(phaseEvt);
    return events;
  }

  /**
   * Sanitizes and queues an incoming `ClientInputPacket`.
   */
  public enqueueInput(uid: string, packet: ClientInputPacket): void {
    const player = this.players.get(uid);
    if (!player || this.disposed) return;

    if (!Number.isFinite(packet.seq) || packet.seq <= player.lastQueuedSeq) {
      return;
    }

    const validSlot: LoadoutSlot | undefined =
      packet.equipSlot === 1 || packet.equipSlot === 2 || packet.equipSlot === 3
        ? packet.equipSlot
        : undefined;

    const sanitized: ClientInputPacket = {
      seq: Math.floor(packet.seq),
      clientTimeMs: Number.isFinite(packet.clientTimeMs) ? packet.clientTimeMs : 0,
      forward: clamp(Number.isFinite(packet.forward) ? packet.forward : 0, -1, 1),
      right: clamp(Number.isFinite(packet.right) ? packet.right : 0, -1, 1),
      jump: Boolean(packet.jump),
      crouch: Boolean(packet.crouch),
      walk: Boolean(packet.walk),
      fire: Boolean(packet.fire),
      ads: Boolean(packet.ads),
      reload: Boolean(packet.reload),
      ...(packet.holdKern ? { holdKern: true } : {}),
      ...(validSlot ? { equipSlot: validSlot } : {}),
      weaponSlot:
        packet.weaponSlot && Object.prototype.hasOwnProperty.call(WEAPONS, packet.weaponSlot)
          ? packet.weaponSlot
          : undefined,
      yaw: Number.isFinite(packet.yaw) ? packet.yaw : player.yaw,
      pitch: clamp(Number.isFinite(packet.pitch) ? packet.pitch : player.pitch, -1.55, 1.55),
    };

    player.lastQueuedSeq = sanitized.seq;
    player.inputQueue.push(sanitized);
    while (player.inputQueue.length > HOST_MAX_INPUT_QUEUE) {
      player.inputQueue.shift();
    }
  }

  /**
   * Advances the authoritative simulation by one fixed 30 Hz tick.
   */
  public step(dt: number = SIM_DT, serverTimeMs: number = Date.now()): NetGameEvent[] {
    if (this.disposed) return [];

    this.tickCount += 1;
    const events: NetGameEvent[] = [];

    // 1. Ensure spawn barriers match current round state prior to movement sweeps
    this.physicsWorld.setSpawnBarriersActive(this.roundManager.barriersActive);

    // 2. Process queued inputs for every alive player (anti-speedhack budget <= 4/tick)
    for (const player of this.players.values()) {
      player.inputBudget = Math.min(HOST_MAX_INPUTS_PER_TICK, player.inputBudget + 1);

      if (!player.alive) {
        player.holdKern = false;
        while (player.inputQueue.length > 0) {
          const discarded = player.inputQueue.shift()!;
          player.lastAckSeq = Math.max(player.lastAckSeq, discarded.seq);
        }
        continue;
      }

      if (player.inputQueue.length === 0) {
        player.holdKern = false;
        this.stepIdlePlayer(player, dt);
        continue;
      }

      let processed = 0;
      while (player.inputQueue.length > 0 && player.inputBudget > 0) {
        const pkt = player.inputQueue.shift()!;
        player.inputBudget -= 1;
        processed += 1;
        this.processPlayerInput(player, pkt, dt, serverTimeMs, events);
        player.lastAckSeq = Math.max(player.lastAckSeq, pkt.seq);
        if (!player.alive) {
          break;
        }
      }

      if (processed === 0 && player.alive) {
        this.stepIdlePlayer(player, dt);
      }
    }

    // 3. Advance Specialist Abilities, active World Effects & Glutfeld incendiary damage
    const abilityRes = this.abilitySystem.step(dt, this.getPlayers());
    events.push(...abilityRes.events);
    if (
      abilityRes.burns.length > 0 &&
      (this.roundManager.phase === 'action' || this.roundManager.phase === 'planted')
    ) {
      for (const burn of abilityRes.burns) {
        const victim = this.players.get(burn.victimUid);
        const attacker = this.players.get(burn.attackerUid);
        if (!victim || !victim.alive || !attacker) continue;
        this.applyValidatedDamage(
          attacker,
          victim,
          burn.damage,
          'body',
          attacker.inventory.fallbackGun.weaponId,
          events,
          true,
        );
      }
    }

    // 4. Advance Kernbruch Round State Machine (`buy` -> `action` -> `planted` -> `post_round` -> `ended`)
    const roundOutcome = this.roundManager.step(dt, this.getPlayers());

    if (roundOutcome.barriersChangedTo !== undefined) {
      this.physicsWorld.setSpawnBarriersActive(roundOutcome.barriersChangedTo);
    }

    if (roundOutcome.roundStartedRespawnNeeded) {
      const fullAbilityReset =
        roundOutcome.sidesJustSwapped || this.roundManager.isSuddenDeath;
      this.abilitySystem.resetForNewRound(this.getPlayers(), fullAbilityReset);
      this.lagComp.clear();
      this.repositionAllSpawns();
      this.roundManager.kern.resetForRound(this.getPlayers());
      for (const p of this.players.values()) {
        events.push({
          type: 'respawn',
          uid: p.uid,
          pos: vec3Clone(p.motor.feetPos),
          yaw: p.yaw,
        });
      }
    }

    events.push(...roundOutcome.events);

    // 5. Record world-space hitbox frame into 1000ms Lag Compensation history buffer
    this.lagComp.recordFrame(
      serverTimeMs,
      Array.from(this.players.values()).map((p) => ({
        uid: p.uid,
        team: p.team,
        alive: p.alive,
        pos: p.motor.feetPos,
        stance: p.motor.stance,
      })),
    );

    return events;
  }

  private stepIdlePlayer(player: AuthoritativePlayer, dt: number): void {
    const abilityState = this.abilitySystem.getPlayerAbilityState(player);
    player.motor.speedMultiplier = computeAbilitySpeedMultiplier(abilityState, 1.0);

    const idleInput: InputSnapshot = {
      seq: player.lastAckSeq,
      forward: 0,
      right: 0,
      jump: false,
      crouch: player.motor.stance === 'crouch',
      walk: false,
      fire: false,
      ads: false,
      reload: false,
      yaw: player.yaw,
      pitch: player.pitch,
      dt,
    };
    player.motor.step(idleInput);
    player.motor.syncWorldQueries();

    const reloadMult = computeAbilityReloadMultiplier(abilityState);
    const activeGunBefore = player.inventory.activeGun;
    if (activeGunBefore && activeGunBefore.isReloading && reloadMult > 1.0 && dt > 0) {
      activeGunBefore.reloadTimer -= dt * (reloadMult - 1.0);
    }

    player.inventory.step(dt, false, false);
    const activeGun = player.inventory.activeGun;
    if (activeGun) {
      player.recoil.update(dt, false, activeGun.weapon);
    }
  }

  private processPlayerInput(
    player: AuthoritativePlayer,
    pkt: ClientInputPacket,
    dt: number,
    serverTimeMs: number,
    events: NetGameEvent[],
  ): void {
    player.yaw = pkt.yaw;
    player.pitch = pkt.pitch;
    player.holdKern = Boolean(pkt.holdKern);

    // Slot switch (`1` Primary, `2` Pistol, `3` Knife)
    if (pkt.equipSlot) {
      const switched = player.inventory.selectSlot(pkt.equipSlot);
      if (switched) {
        const gun = player.inventory.activeGun;
        if (gun) {
          player.recoil.setWeapon(gun.weapon);
        } else {
          player.recoil.reset();
        }
      }
    } else if (pkt.weaponSlot) {
      // Legacy direct weapon slot switch if player owns that weapon
      if (player.inventory.primary?.weaponId === pkt.weaponSlot) {
        player.inventory.selectSlot(1);
        player.recoil.setWeapon(player.inventory.primary.weapon);
      } else if (player.inventory.secondary.weaponId === pkt.weaponSlot) {
        player.inventory.selectSlot(2);
        player.recoil.setWeapon(player.inventory.secondary.weapon);
      }
    }

    const isChannelingKern =
      (this.roundManager.kern.status === 'planting' ||
        this.roundManager.kern.status === 'defusing') &&
      this.roundManager.kern.actorUid === player.uid;
    player.isChannelingKern = isChannelingKern;

    const isKnifeSprint =
      !isChannelingKern &&
      player.inventory.activeSlot === 3 &&
      player.motor.grounded &&
      !pkt.crouch &&
      !pkt.walk &&
      !pkt.jump &&
      (Math.abs(pkt.forward) > 1e-4 || Math.abs(pkt.right) > 1e-4);

    const abilityState = this.abilitySystem.getPlayerAbilityState(player);
    const knifeMult = isKnifeSprint ? KNIFE_RUN_SPEED / RUN_SPEED : 1.0;
    player.motor.speedMultiplier = computeAbilitySpeedMultiplier(abilityState, knifeMult);

    const motorInput: InputSnapshot = {
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

    const { footstepTriggered } = player.motor.step(motorInput);
    player.motor.syncWorldQueries();

    if (footstepTriggered) {
      events.push({
        type: 'footstep',
        uid: player.uid,
        pos: vec3Clone(player.motor.feetPos),
      });
    }

    // Weapons cannot fire during `'buy'`, `'ended'`, Kern channeling, or Gleitschritt lockout
    const weaponLockedOut = this.abilitySystem.isWeaponLockedOut(player.uid);
    const combatAllowed =
      (this.roundManager.phase === 'action' || this.roundManager.phase === 'planted') &&
      !isChannelingKern &&
      !weaponLockedOut;

    const allowReload = this.roundManager.phase !== 'ended' && !isChannelingKern;
    const reloadMult = computeAbilityReloadMultiplier(abilityState);
    const activeGunBefore = player.inventory.activeGun;
    if (activeGunBefore && activeGunBefore.isReloading && reloadMult > 1.0 && dt > 0) {
      activeGunBefore.reloadTimer -= dt * (reloadMult - 1.0);
    }

    const stepRes = player.inventory.step(
      dt,
      combatAllowed ? pkt.fire : false,
      allowReload ? pkt.reload : false,
    );

    const activeGun = player.inventory.activeGun;
    if (stepRes.reloadStarted && activeGun) {
      player.recoil.reset();
      events.push({
        type: 'reload',
        uid: player.uid,
        weaponId: activeGun.weaponId,
      });
    }

    if (stepRes.slashedKnife && combatAllowed) {
      this.resolveAuthoritativeKnifeSlash(player, pkt, serverTimeMs, events);
    } else if (stepRes.firedGun && activeGun && combatAllowed) {
      this.resolveAuthoritativeGunShot(player, activeGun.weapon, pkt, serverTimeMs, events);
    }

    if (activeGun) {
      const holdingContinuous =
        combatAllowed &&
        pkt.fire &&
        !activeGun.isReloading &&
        activeGun.ammoInMag > 0 &&
        (activeGun.weapon.automatic || stepRes.firedGun);
      player.recoil.update(dt, holdingContinuous, activeGun.weapon);
    }
  }

  private computeRewindMsForShooter(shooterUid: string, pkt: ClientInputPacket, serverTimeMs: number): number {
    if (this.hostUid && shooterUid === this.hostUid) {
      return 0;
    }

    if (this.peerRttProvider) {
      const peerRttMs = Math.max(0, this.peerRttProvider(shooterUid));
      return clamp(peerRttMs * 0.5 + INTERP_DELAY_MS, 0, LAG_COMP_MAX_REWIND_MS);
    }

    if (this.hostUid && shooterUid !== this.hostUid) {
      return clamp(INTERP_DELAY_MS, 0, LAG_COMP_MAX_REWIND_MS);
    }

    if (pkt.clientTimeMs > 0 && serverTimeMs > pkt.clientTimeMs) {
      const rawDiff = serverTimeMs - pkt.clientTimeMs;
      if (rawDiff <= 1000) {
        return clamp(rawDiff, 0, LAG_COMP_MAX_REWIND_MS);
      }
    }

    return 0;
  }

  private getTargetsForHitscan(
    shooterUid: string,
    pkt: ClientInputPacket,
    serverTimeMs: number,
  ): PvpHitscanTarget[] {
    const rewindMs = this.computeRewindMsForShooter(shooterUid, pkt, serverTimeMs);
    if (rewindMs > 0 && this.lagComp.frameCount > 0) {
      return this.lagComp
        .getRewoundTargets(serverTimeMs, rewindMs)
        .filter((t) => t.uid !== shooterUid && t.alive);
    }

    const out: PvpHitscanTarget[] = [];
    for (const p of this.players.values()) {
      if (p.uid === shooterUid || !p.alive) continue;
      out.push({
        uid: p.uid,
        team: p.team,
        alive: p.alive,
        pos: p.motor.feetPos,
        stance: p.motor.stance,
      });
    }
    return out;
  }

  private resolveAuthoritativeGunShot(
    shooter: AuthoritativePlayer,
    stats: WeaponStats,
    pkt: ClientInputPacket,
    serverTimeMs: number,
    events: NetGameEvent[],
  ): void {
    const origin = shooter.motor.getEyePos();
    const firedShotIndex = Math.floor(shooter.recoil.shotIndex);
    const abilityState = this.abilitySystem.getPlayerAbilityState(shooter);
    const recoilMult = computeAbilityRecoilMultiplier(abilityState);

    const rawRecoil = getRecoilAnglesRad(stats, firedShotIndex);
    const recoilPitchRad = rawRecoil.pitchRad * recoilMult;
    const recoilYawRad = rawRecoil.yawRad * recoilMult;

    const isAds = pkt.ads && stats.hasScopeZoom;
    const spreadRad =
      computeEffectiveWeaponSpreadRad(
        stats,
        shooter.motor.stance,
        shooter.motor.horizontalSpeed,
        firedShotIndex,
        isAds,
      ) * recoilMult;

    const targets = this.getTargetsForHitscan(shooter.uid, pkt, serverTimeMs);

    // Accumulate damage per victim across multi-pellet weapons (`Brecher` 8x shotgun)
    const accumulatedHits = new Map<
      string,
      { totalDamage: number; hasHeadshot: boolean }
    >();

    const pellets = Math.max(1, stats.pellets);
    for (let p = 0; p < pellets; p += 1) {
      const applied = applySpreadAndRecoilToAngles(
        pkt.yaw,
        pkt.pitch,
        recoilPitchRad,
        recoilYawRad,
        spreadRad,
        shooter.recoil.rng,
      );

      const hit = performPvpHitscan(
        origin,
        applied.dir,
        HOST_HITSCAN_MAX_RANGE_M,
        this.physicsWorld,
        targets,
        shooter.uid,
        shooter.team,
        this.abilitySystem.getDestructibleGadgetTargets(),
      );

      events.push({
        type: 'shot',
        shooterUid: shooter.uid,
        weaponId: stats.id,
        origin: vec3Clone(origin),
        hitPoint: vec3Clone(hit.point),
        hitZone: hit.hitZone,
        targetUid: hit.targetUid,
      });

      if (hit.hitEffectId) {
        const gadgetDamage = computeDamage(stats, 'body', hit.distance);
        const destroyEvt = this.abilitySystem.damageWorldEffect(
          hit.hitEffectId,
          gadgetDamage,
          shooter.team,
        );
        if (destroyEvt) {
          events.push(destroyEvt);
        }
      } else if ((hit.hitZone === 'head' || hit.hitZone === 'body') && hit.targetUid) {
        const victim = this.players.get(hit.targetUid);
        if (victim && victim.alive && victim.team !== shooter.team) {
          const pelletDamage = computeDamage(stats, hit.hitZone, hit.distance);
          if (pelletDamage > 0) {
            const entry = accumulatedHits.get(victim.uid) ?? {
              totalDamage: 0,
              hasHeadshot: false,
            };
            entry.totalDamage += pelletDamage;
            if (hit.hitZone === 'head') {
              entry.hasHeadshot = true;
            }
            accumulatedHits.set(victim.uid, entry);
          }
        }
      }
    }

    shooter.recoil.onFire(stats);

    for (const [victimUid, hitData] of accumulatedHits.entries()) {
      const victim = this.players.get(victimUid);
      if (!victim || !victim.alive) continue;
      this.applyValidatedDamage(
        shooter,
        victim,
        hitData.totalDamage,
        hitData.hasHeadshot ? 'head' : 'body',
        stats.id,
        events,
      );
    }
  }

  private resolveAuthoritativeKnifeSlash(
    shooter: AuthoritativePlayer,
    pkt: ClientInputPacket,
    serverTimeMs: number,
    events: NetGameEvent[],
  ): void {
    const origin = shooter.motor.getEyePos();
    const aimDir = aimDirectionFromAngles(pkt.yaw, pkt.pitch);
    const targets = this.getTargetsForHitscan(shooter.uid, pkt, serverTimeMs);
    const fallbackWeaponId = shooter.inventory.fallbackGun.weaponId;

    const hit = performPvpHitscan(
      origin,
      aimDir,
      KNIFE_RANGE_M,
      this.physicsWorld,
      targets,
      shooter.uid,
      shooter.team,
      this.abilitySystem.getDestructibleGadgetTargets(),
    );

    if (hit.hitEffectId) {
      const destroyEvt = this.abilitySystem.damageWorldEffect(
        hit.hitEffectId,
        KNIFE_DAMAGE,
        shooter.team,
      );
      if (destroyEvt) {
        events.push(destroyEvt);
      }
    }

    let hitVictimUid =
      (hit.hitZone === 'head' || hit.hitZone === 'body') && hit.targetUid
        ? hit.targetUid
        : undefined;
    let hitPoint = hit.point;
    let hitZone = hit.hitZone;

    // Close-quarters melee sweep cone (`<= 2.2 m`, `cos(28°)` front arc) if center ray grazed past
    if (!hitVictimUid) {
      let bestDist = KNIFE_RANGE_M;
      for (const t of targets) {
        if (!t.alive || t.team === shooter.team || t.uid === shooter.uid) continue;
        const chest = { x: t.pos.x, y: t.pos.y + 1.0, z: t.pos.z };
        const d = vec3Dist(origin, chest);
        if (d > bestDist || d <= 1e-5) continue;
        const toTarget = vec3Normalize(vec3Sub(chest, origin));
        if (vec3Dot(aimDir, toTarget) < 0.88) continue;
        const wallHit = this.physicsWorld.castWorldRay(origin, toTarget, d);
        if (wallHit && wallHit.distance < d - 0.05) continue;
        bestDist = d;
        hitVictimUid = t.uid;
        hitPoint = chest;
        hitZone = 'body';
      }
    }

    events.push({
      type: 'shot',
      shooterUid: shooter.uid,
      weaponId: fallbackWeaponId,
      origin: vec3Clone(origin),
      hitPoint: vec3Clone(hitPoint),
      hitZone,
      targetUid: hitVictimUid,
    });

    if (hitVictimUid) {
      const victim = this.players.get(hitVictimUid);
      if (victim && victim.alive && victim.team !== shooter.team) {
        this.applyValidatedDamage(
          shooter,
          victim,
          KNIFE_DAMAGE,
          hitZone === 'head' ? 'head' : 'body',
          fallbackWeaponId,
          events,
        );
      }
    }
  }

  private applyValidatedDamage(
    shooter: AuthoritativePlayer,
    victim: AuthoritativePlayer,
    rawDamage: number,
    hitZone: 'head' | 'body',
    weaponId: WeaponId,
    events: NetGameEvent[],
    skipBastionReduction = false,
  ): void {
    const reducedRaw = skipBastionReduction
      ? rawDamage
      : applyBastionDamageReduction(
          rawDamage,
          this.abilitySystem.isPlayerBastionProtected(victim.uid),
        );
    const damage = Math.max(0, Math.round(reducedRaw));
    if (damage <= 0 || !victim.alive) return;

    const prevDealt = victim.roundDamageByAttacker.get(shooter.uid) ?? 0;
    victim.roundDamageByAttacker.set(shooter.uid, prevDealt + damage);

    const absorbed = Math.min(victim.armor, damage);
    victim.armor -= absorbed;
    victim.hp = Math.max(0, victim.hp - (damage - absorbed));

    const killed = victim.hp <= 0;
    let kernDropEvt: NetGameEvent | null = null;

    if (killed) {
      victim.hp = 0;
      victim.armor = 0;
      victim.alive = false;
      victim.holdKern = false;
      victim.inputQueue.length = 0;

      shooter.kills += 1;
      victim.deaths += 1;

      // Award +200 Splitter kill reward & +1 Ult point to both killer and eliminated player
      awardKillCredits(shooter);
      addUltPoint(shooter, 1);
      addUltPoint(victim, 1);

      // Credit assists to any teammate who dealt >= 25 damage in this round
      for (const [contributorUid, dealt] of victim.roundDamageByAttacker.entries()) {
        if (contributorUid !== shooter.uid && dealt >= 25) {
          const helper = this.players.get(contributorUid);
          if (helper && helper.team === shooter.team) {
            helper.assists += 1;
          }
        }
      }

      kernDropEvt = this.roundManager.notifyPlayerDownOrLeft(
        victim.uid,
        victim.motor.feetPos,
      );
    }

    events.push({
      type: 'damage',
      attackerUid: shooter.uid,
      victimUid: victim.uid,
      damage,
      hitZone,
      hpAfter: victim.hp,
      armorAfter: victim.armor,
      killed,
      weaponId,
    });

    if (kernDropEvt) {
      events.push(kernDropEvt);
    }
  }

  public buildSnapshot(serverTimeMs: number = Date.now()): WorldSnapshot {
    const kernCarrierUid =
      (this.roundManager.kern.status === 'carried' ||
        this.roundManager.kern.status === 'planting')
        ? this.roundManager.kern.carrierUid
        : undefined;

    const players: NetPlayerState[] = [];
    for (const p of this.players.values()) {
      const activeGun = p.inventory.activeGun;
      const fallbackGun = p.inventory.fallbackGun;
      players.push({
        uid: p.uid,
        name: p.name,
        team: p.team,
        character: p.character,
        pos: vec3Clone(p.motor.feetPos),
        vel: vec3Clone(p.motor.velocity),
        yaw: p.yaw,
        pitch: p.pitch,
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
        abilities: this.abilitySystem.getPlayerAbilityState(p),
      });
    }

    return {
      tick: this.tickCount,
      serverTimeMs,
      players,
      round: this.roundManager.toSnapshot(),
      effects: this.abilitySystem.getEffectsSnapshot(),
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.players.values()) {
      p.motor.dispose();
    }
    this.players.clear();
    this.lagComp.clear();
    this.physicsWorld.dispose();
  }
}
