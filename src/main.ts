import './ui/styles.css';
import { ref, set } from 'firebase/database';
import { SynthAudio } from './audio/SynthAudio';
import {
  BUY_PHASE_SEC,
  DEFAULT_SETTINGS,
  loadSavedKeybinds,
  saveKeybinds,
  SIM_TICK_RATE,
  START_CREDITS,
} from './core/Config';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './core/InputManager';
import {
  type AbilitySlot,
  ALL_MAP_IDS,
  type BuyItemType,
  type CharacterId,
  type GameSettings,
  type GraphicsQuality,
  type InputSnapshot,
  type KernStatus,
  type LoadoutSlot,
  type MapId,
  type MatchPhase,
  type NetSimConfig,
  type PlayerAbilityState,
  type RoomMatchSummary,
  type RoomStatus,
  type RoundWinReason,
  type TeamId,
  type TransportMode,
  type Vec3,
  type WeaponId,
} from './core/types';
import { CHARACTER_LIST, DEFAULT_CHARACTER_ID, TEAM_DEFS } from './data/characters';
import { getMapDefinition } from './data/maps';
import { recordMatchHistory, recordProgress } from './data/progression';
import {
  getFirebaseServices,
  isFirebaseConfigured,
  loadSavedPlayerName,
  LobbyService,
  MatchmakingService,
  type MatchAssignment,
  type RoomSnapshot,
  savePlayerName,
} from './firebase';
import { LocalSession } from './game/LocalSession';
import { OnlineSession, type RemotePlayerDiagnostic } from './game/OnlineSession';
import { AbilityEffectsRenderer } from './render/AbilityEffectsRenderer';
import { DummyRenderer } from './render/DummyRenderer';
import { FirstPersonCamera } from './render/FirstPersonCamera';
import { KernAndBarrierRenderer } from './render/KernAndBarrierRenderer';
import { MapBuilder } from './render/MapBuilder';
import { RemotePlayerRenderer } from './render/RemotePlayerRenderer';
import { Renderer } from './render/Renderer';
import { ShotEffects } from './render/ShotEffects';
import { BuyMenu } from './ui/BuyMenu';
import { ChatOverlay } from './ui/ChatOverlay';
import { DebugOverlay } from './ui/DebugOverlay';
import {
  HudOverlay,
  NETSIM_PRESETS,
  type OnlineHudContext,
} from './ui/HudOverlay';
import { LobbyScreen } from './ui/LobbyScreen';
import { MatchEndOverlay } from './ui/MatchEndOverlay';
import { Minimap, type MinimapMarker } from './ui/Minimap';
import {
  formatPingLabel,
  rowFromNetPlayer,
  type ScoreboardRow,
  ScoreboardOverlay,
} from './ui/ScoreboardOverlay';

export type ScreenMode = 'landing' | 'lobby' | 'in_game';

export interface ShardlineDiagnostics {
  readonly fps: number;
  readonly tickRate: number;
  readonly backend: string;
  readonly activeMap: MapId;
  readonly pointerLocked: boolean;
  readonly playerPos: Vec3;
  readonly weaponId: WeaponId;
  readonly ammo: {
    readonly inMag: number;
    readonly reserve: number;
    readonly infinite: boolean;
  };
  readonly aliveDummies: number;
  readonly totalHits: number;
  readonly totalKills: number;
  readonly character: CharacterId;
  readonly abilities: PlayerAbilityState;
  readonly activeEffectsCount: number;
  readonly minimapActive: boolean;
  readonly drawCalls: number;
}

export interface ShardlineLobbyDiagnostics {
  readonly screen: ScreenMode;
  readonly uid: string | null;
  readonly roomCode: string | null;
  readonly isHost: boolean;
  readonly team: TeamId | null;
  readonly character: CharacterId;
  readonly playerCount: number;
  readonly status: RoomStatus | 'offline';
}

export interface ShardlineNetDiagnostics {
  readonly role: 'host' | 'client' | 'offline';
  readonly transportMode: TransportMode;
  readonly rttMs: number;
  readonly packetLossPct: number;
  readonly tickRate: number;
  readonly snapshotRateHz: number;
  readonly fps: number;
  readonly predictionErrorMm: number;
  readonly interpolatedPlayerCount: number;
  readonly localUid: string | null;
  readonly localPos: Vec3;
  readonly localHp: number;
  readonly localAlive: boolean;
  readonly kills: number;
  readonly deaths: number;
  readonly remotePlayerCount: number;
  readonly remotePlayers: ReadonlyArray<RemotePlayerDiagnostic>;
  readonly netSim: NetSimConfig;
  readonly abilities: PlayerAbilityState;
  readonly activeEffectsCount: number;
}

export interface ShardlineRoundDiagnostics {
  readonly roundNumber: number;
  readonly phase: MatchPhase;
  readonly phaseRemainingSec: number;
  readonly barriersActive: boolean;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly credits: number;
  readonly primaryWeapon: WeaponId | null;
  readonly secondaryWeapon: WeaponId;
  readonly armor: number;
  readonly hasKern: boolean;
  readonly kernStatus: KernStatus;
  readonly spectatingUid: string | null;
  readonly abilities: PlayerAbilityState;
  readonly activeEffectsCount: number;
}

export interface ShardlineGlobalHook {
  getDiagnostics: () => ShardlineDiagnostics;
  getLobbyDiagnostics: () => ShardlineLobbyDiagnostics;
  getNetDiagnostics: () => ShardlineNetDiagnostics;
  getRoundDiagnostics: () => ShardlineRoundDiagnostics;
  requestBuy: (itemType: BuyItemType, itemId: string) => void;
  castAbility: (slot: AbilitySlot) => boolean;
  setOfflineCharacter: (characterId: CharacterId) => void;
  setNetSim: (partialCfg: Partial<NetSimConfig>) => NetSimConfig;
  setTestInput: (partialInput: Partial<InputSnapshot> | null) => void;
  switchMap: (mapId: MapId) => void;
  toggleDebugOverlay: () => boolean;
}

declare global {
  interface Window {
    __SHARDLINE__?: ShardlineGlobalHook;
  }
}

function formatWinReasonHeadline(winnerTeam: TeamId, winReason?: RoundWinReason): string {
  const teamLabel = TEAM_DEFS[winnerTeam].name.toUpperCase();
  switch (winReason) {
    case 'kern_detonated':
      return `${teamLabel} GEWINNEN · KERN DETONIERT`;
    case 'kern_defused':
      return `${teamLabel} GEWINNEN · KERN ENTSCHÄRFT`;
    case 'time_expired':
      return `${teamLabel} GEWINNEN · ZEIT ABGELAUFEN`;
    case 'defenders_eliminated':
    case 'attackers_eliminated':
    default:
      return `${teamLabel} GEWINNEN · GEGNER AUSGESCHALTET`;
  }
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root') as HTMLElement | null;
  if (!canvas || !uiRoot) {
    throw new Error('SHARDLINE mount elements (#game-canvas / #ui-root) missing in index.html.');
  }

  const GRAPHICS_STORAGE_KEY = 'shardline.graphicsQuality';
  const loadGraphicsQuality = (): GraphicsQuality => {
    try {
      const raw = window.localStorage.getItem(GRAPHICS_STORAGE_KEY);
      if (raw === 'low' || raw === 'high' || raw === 'max') return raw;
    } catch {
      // Speicher nicht verfügbar (z. B. privater Modus) -> Standard
    }
    return DEFAULT_SETTINGS.graphics;
  };

  let settings: GameSettings = {
    ...DEFAULT_SETTINGS,
    graphics: loadGraphicsQuality(),
    crosshair: { ...DEFAULT_SETTINGS.crosshair },
    keybinds: loadSavedKeybinds(),
  };

  let screenMode: ScreenMode = 'landing';
  let selectedOfflineCharacter: CharacterId = DEFAULT_CHARACTER_ID;
  let offlinePrimaryWeapon: WeaponId = 'lanze';
  let offlineSecondaryWeapon: WeaponId = 'funke';
  let offlineActiveSlot: LoadoutSlot = 1;
  let latestRoomSnapshot: RoomSnapshot | null = null;
  let enteredMatchForRoomCode: string | null = null;
  let onlineSession: OnlineSession | null = null;
  let onlineSessionStartingCode: string | null = null;
  let currentNetSim: NetSimConfig = { ...NETSIM_PRESETS.ideal };
  let testInputOverride: Partial<InputSnapshot> | null = null;
  let tabScoreboardHeld = false;
  let lastSyncedRtdbMatchKey = '';
  let wasRangeChallengeCompleted = false;

  // 1. Initialize Renderer (WebGPU with safe automatic WebGL2 fallback) & Rapier LocalSession
  const initialMap = getMapDefinition('hafenwerk');
  const [renderer, session] = await Promise.all([
    Renderer.create(canvas),
    LocalSession.create(initialMap),
  ]);

  // 2. Audio & Scene Subsystems
  const audio = new SynthAudio(settings.volume);
  const fpCamera = new FirstPersonCamera(settings);
  renderer.scene.add(fpCamera.camera);

  const mapBuilder = new MapBuilder(renderer.scene);
  renderer.setQuality(settings.graphics);
  mapBuilder.setQuality(settings.graphics);
  mapBuilder.buildMap(initialMap);

  const kernAndBarrierRenderer = new KernAndBarrierRenderer(renderer.scene);
  kernAndBarrierRenderer.buildBarriers(initialMap);
  kernAndBarrierRenderer.reset();

  const dummyRenderer = new DummyRenderer(renderer.scene);
  const remotePlayerRenderer = new RemotePlayerRenderer(renderer.scene);
  remotePlayerRenderer.setVisible(false);
  const abilityEffectsRenderer = new AbilityEffectsRenderer(renderer.scene);
  const shotEffects = new ShotEffects(renderer.scene);
  const debugOverlay = new DebugOverlay(uiRoot);
  const minimap = new Minimap(uiRoot);
  minimap.setMap(initialMap);
  const tabScoreboard = new ScoreboardOverlay(uiRoot);
  const chatOverlay = new ChatOverlay(uiRoot, {
    onSend: (text: string, teamOnly: boolean) => {
      onlineSession?.sendChatMessage(text, teamOnly);
    },
    canOpen: () =>
      screenMode === 'in_game' &&
      onlineSession !== null &&
      input.isPointerLocked() &&
      !buyMenu.isOpen() &&
      !matchEndOverlay.isOpen() &&
      !hud.isMenuOpen(),
  });
  let lastTransportMode: TransportMode | null = null;

  const syncOfflineWeaponSlot = (weaponId: WeaponId): void => {
    if (weaponId === 'funke' || weaponId === 'bolzer') {
      offlineSecondaryWeapon = weaponId;
      offlineActiveSlot = 2;
    } else {
      offlinePrimaryWeapon = weaponId;
      offlineActiveSlot = 1;
    }
    session.equipWeapon(weaponId);
  };

  // 3. Input Manager (Pointer Lock strictly gated to active gameplay clicks)
  const input = new InputManager(canvas, {
    sensitivity: settings.sensitivity,
    keybinds: settings.keybinds,
    lockOnCanvasClick: false,
    onDebugToggle: () => {
      debugOverlay.toggle();
    },
    onAbilityInfoToggle: () => {
      if (screenMode !== 'in_game') return;
      hud.toggleAbilityInfoOverlay();
      audio.playUiBeep(true);
    },
    onSpecialistSelectToggle: () => {
      if (screenMode !== 'in_game' || latestRoomSnapshot !== null || onlineSession !== null) return;
      hud.toggleOfflineSpecialistOverlay();
      audio.playUiBeep(true);
    },
    onMapSwitchOffline: () => {
      if (screenMode !== 'in_game' || latestRoomSnapshot !== null || onlineSession !== null) return;
      const idx = ALL_MAP_IDS.indexOf(session.activeMapId);
      const nextMap = ALL_MAP_IDS[(idx + 1) % ALL_MAP_IDS.length];
      switchOfflineMap(nextMap);
      audio.playUiBeep(true);
    },
    onWeaponSlot: (slot: number) => {
      if (screenMode !== 'in_game') return;
      if (onlineSession) {
        if (slot === 1 || slot === 2 || slot === 3) {
          const switched = onlineSession.equipSlot(slot as LoadoutSlot);
          if (switched) {
            audio.playUiBeep(true);
          }
        }
        return;
      }

      if (slot === 1) {
        offlineActiveSlot = 1;
        session.equipWeapon(offlinePrimaryWeapon);
        audio.playUiBeep(true);
      } else if (slot === 2) {
        offlineActiveSlot = 2;
        session.equipWeapon(offlineSecondaryWeapon);
        audio.playUiBeep(true);
      } else if (slot === 3) {
        offlineActiveSlot = 3;
        audio.playUiBeep(true);
      }
    },
    onSpectatorCycle: (dir: 1 | -1) => {
      if (screenMode !== 'in_game' || !onlineSession || onlineSession.localAlive) return;
      const nextUid = onlineSession.cycleSpectator(dir);
      if (nextUid) {
        audio.playUiBeep(true);
      }
    },
    onAbilityKey: (slot: AbilitySlot) => {
      if (screenMode !== 'in_game') return;
      if (buyMenu.isOpen() || matchEndOverlay.isOpen() || hud.isMenuOpen()) return;
      audio.resume();
      if (onlineSession) {
        onlineSession.castAbility(slot);
      } else {
        session.castAbility(slot);
      }
    },
    onScoreboardToggle: (held: boolean) => {
      tabScoreboardHeld = held;
    },
    onZoomCycle: (dir: 1 | -1) => {
      fpCamera.cycleZoomLevel(dir);
    },
  });
  input.setAngles(initialMap.playerSpawn.yaw, 0);

  // Low-frequency Firebase RTDB match summary writer (Host only; ONLY on roundNumber or phase transition)
  const syncHostMatchSummaryToRtdb = (
    roomCode: string,
    roundNumber: number,
    scoreA: number,
    scoreB: number,
    phase: MatchPhase
  ): void => {
    if (!isFirebaseConfigured()) return;
    const key = `${roomCode}:${roundNumber}:${phase}:${scoreA}:${scoreB}`;
    const transitionKey = `${roomCode}:${roundNumber}:${phase}`;
    if (lastSyncedRtdbMatchKey === transitionKey) return;
    lastSyncedRtdbMatchKey = transitionKey;
    void key;

    try {
      const { db } = getFirebaseServices();
      const payload: RoomMatchSummary = {
        round: roundNumber,
        scoreA,
        scoreB,
        phase,
      };
      void set(ref(db, `rooms/${roomCode}/match`), payload).catch(() => {});
    } catch {
      // Ignore Firebase offline/unconfigured environments cleanly
    }
  };

  // Phase 4 Buy Menu & Match-End / Live Scoreboard Overlays
  const buyMenu = new BuyMenu(uiRoot, {
    onBuyRequest: (itemType: BuyItemType, itemId: string) => {
      audio.resume();
      if (onlineSession) {
        onlineSession.requestBuy(itemType, itemId);
      } else {
        if (itemType === 'weapon') {
          syncOfflineWeaponSlot(itemId as WeaponId);
          audio.playBuySuccess();
          buyMenu.showPurchaseFeedback(true, 'Waffe ausgerüstet.');
        } else if (itemType === 'armor') {
          session.playerShield = itemId === 'heavy' ? 50 : 25;
          audio.playBuySuccess();
          buyMenu.showPurchaseFeedback(true, 'Schild angelegt.');
        } else if (itemType === 'ability_q' || itemType === 'ability_e') {
          session.refillFullAbilities();
          audio.playBuySuccess();
          buyMenu.showPurchaseFeedback(true, 'Fähigkeiten aufgefüllt.');
        }
      }
    },
    onClose: () => {
      if (screenMode === 'in_game' && !matchEndOverlay.isOpen() && !hud.isMenuOpen()) {
        input.requestLock();
      }
    },
  });

  const lobbyService = new LobbyService();
  const matchmaking = new MatchmakingService();
  /** Aktives automatisch gebildetes Match (Host wartet auf alle Teilnehmer, dann Auto-Start). */
  let pendingQueueMatch: { assignment: MatchAssignment; startDeadline: number; started: boolean } | null =
    null;
  let queuePlayerName = '';

  const returnToLanding = async (
    leaveActiveRoom: boolean,
    noticeReason?: string
  ): Promise<void> => {
    testInputOverride = null;
    tabScoreboardHeld = false;
    buyMenu.close();
    matchEndOverlay.hide();
    disposeOnlineSession();
    pendingQueueMatch = null;
    if (matchmaking.isSearching()) {
      await matchmaking.cancel();
    }
    if (leaveActiveRoom && lobbyService.getCurrentSnapshot()) {
      await lobbyService.leaveRoom();
    }
    enteredMatchForRoomCode = null;
    latestRoomSnapshot = null;
    screenMode = 'landing';
    input.setSpectatorMode(false);
    input.exitLock();
    hud.setGameplayActive(false);
    lobbyScreen.refreshProgression();
    lobbyScreen.showLanding();
    if (noticeReason) {
      lobbyScreen.showClosureNotice(noticeReason);
    }
  };

  const matchEndOverlay = new MatchEndOverlay(uiRoot, {
    onReturnToRoomLobby: () => {
      audio.resume();
      audio.playUiBeep(true);
      const snap = lobbyService.getCurrentSnapshot();
      if (snap && snap.isHost && isFirebaseConfigured()) {
        matchEndOverlay.hide();
        try {
          const { db } = getFirebaseServices();
          void set(ref(db, `rooms/${snap.code}/status`), 'lobby').catch(() => {
            onlineSession?.requestRestartMatch();
          });
          return;
        } catch {
          // Fall back to in-session restart
        }
      }
      matchEndOverlay.hide();
      onlineSession?.requestRestartMatch();
      input.requestLock();
    },
    onLeaveRoom: () => {
      audio.resume();
      audio.playUiBeep(false);
      void returnToLanding(true);
    },
  });

  canvas.addEventListener('click', () => {
    if (
      screenMode === 'in_game' &&
      !input.isPointerLocked() &&
      !buyMenu.isOpen() &&
      !matchEndOverlay.isOpen()
    ) {
      audio.resume();
      input.requestLock();
    }
  });

  // Helper: Cleanly tear down active OnlineSession + StarNetwork + 3D remote player & Kern meshes
  function disposeOnlineSession(): void {
    onlineSessionStartingCode = null;
    lastSyncedRtdbMatchKey = '';
    tabScoreboardHeld = false;
    tabScoreboard.hide();
    chatOverlay.setEnabled(false);
    chatOverlay.clear();
    lastTransportMode = null;
    minimap.setVisible(false);
    buyMenu.close();
    matchEndOverlay.hide();
    audio.updateKernFuseAudio(false, 0, 0);
    input.setSpectatorMode(false);
    fpCamera.setViewmodelVisible(true);
    if (onlineSession) {
      onlineSession.dispose();
      onlineSession = null;
    }
    kernAndBarrierRenderer.reset();
    abilityEffectsRenderer.clear();
    remotePlayerRenderer.clear();
    remotePlayerRenderer.setVisible(false);
    shotEffects.clearAll();
  }

  // Helper: Apply Net-Simulator config across UI toolbar & active OnlineSession
  const applyNetSimConfig = (partialCfg: Partial<NetSimConfig>): NetSimConfig => {
    const next: NetSimConfig = {
      ...currentNetSim,
      ...partialCfg,
    };
    if (partialCfg.enabled === undefined) {
      next.enabled =
        next.latencyMs > 0 ||
        next.jitterMs > 0 ||
        next.packetLossPct > 0 ||
        next.forceRelay === true;
    }
    currentNetSim = next;
    onlineSession?.setNetSim(currentNetSim);
    hud.syncNetSimToolbar(currentNetSim);
    return { ...currentNetSim };
  };

  // 4. Offline Map Switch Helper
  const switchOfflineMap = (mapId: MapId): void => {
    disposeOnlineSession();
    const mapDef = getMapDefinition(mapId);
    session.loadMap(mapDef);
    session.setCharacter(selectedOfflineCharacter);
    input.setAngles(mapDef.playerSpawn.yaw, 0);
    mapBuilder.buildMap(mapDef);
    minimap.setMap(mapDef);
    kernAndBarrierRenderer.buildBarriers(mapDef);
    kernAndBarrierRenderer.reset();
    abilityEffectsRenderer.clear();
    dummyRenderer.clearDummies();
    shotEffects.clearAll();
    hud.highlightMap(mapId);
    hud.highlightCharacter(selectedOfflineCharacter);
  };

  // 5. Start Online Authoritative Host / Predicted Client Session
  const startOnlineMatch = async (snap: RoomSnapshot): Promise<void> => {
    if (onlineSessionStartingCode === snap.code) return;
    onlineSessionStartingCode = snap.code;
    enteredMatchForRoomCode = snap.code;
    screenMode = 'in_game';
    lobbyScreen.hide();

    disposeOnlineSession();
    onlineSessionStartingCode = snap.code;

    const myUid = lobbyService.getUid() ?? snap.hostUid;
    const me = snap.players.find((p) => p.uid === myUid);
    if (me?.character) {
      selectedOfflineCharacter = me.character;
    }

    const mapDef = getMapDefinition(snap.settings.mapId);
    mapBuilder.buildMap(mapDef);
    minimap.setMap(mapDef);
    kernAndBarrierRenderer.buildBarriers(mapDef);
    dummyRenderer.clearDummies();
    shotEffects.clearAll();
    hud.highlightMap(mapDef.id);
    hud.setGameplayActive(true, true);

    const created = await OnlineSession.create({
      roomCode: snap.code,
      localUid: myUid,
      hostUid: snap.hostUid,
      mapDef,
      players: snap.players,
      roundsToWin: snap.settings.roundsToWin,
      initialNetSim: currentNetSim,
    });

    // Guard against room exit during async physics creation
    if (enteredMatchForRoomCode !== snap.code || screenMode !== 'in_game') {
      created.dispose();
      onlineSessionStartingCode = null;
      return;
    }

    onlineSession = created;
    onlineSessionStartingCode = null;
    remotePlayerRenderer.setVisible(true);
    chatOverlay.clear();
    chatOverlay.setLocalTeam(created.localTeam);
    chatOverlay.setEnabled(true);
    chatOverlay.addSystem('Einsatz-Chat bereit · [Enter] schreiben · [Tab] im Chat: ALLE / TEAM');
    created.events.on('chat', (ev) => {
      chatOverlay.setLocalTeam(created.localTeam);
      chatOverlay.addMessage({
        senderName: ev.senderName,
        team: ev.team,
        text: ev.text,
        teamOnly: ev.teamOnly,
        isLocal: ev.isLocal,
      });
    });
    input.setAngles(created.currentYaw, 0);

    // Initial low-frequency RTDB match summary sync on Host
    if (created.role === 'host') {
      syncHostMatchSummaryToRtdb(
        created.roomCode,
        created.roundState.roundNumber,
        created.roundState.scoreA,
        created.roundState.scoreB,
        created.roundState.phase
      );
    }

    // Sync any roster updates that arrived while session was initializing
    if (latestRoomSnapshot && latestRoomSnapshot.code === snap.code) {
      created.syncLobbyPlayers(latestRoomSnapshot.players);
    }

    // Wire OnlineSession combat, movement, Economy, Round & Kern events
    created.events.on('shot', (ev) => {
      if (ev.isKnife) {
        if (ev.isLocal) {
          audio.playMeleeSlash();
          fpCamera.triggerMeleeSwing();
        }
        return;
      }

      if (ev.isLocal) {
        audio.playShot(ev.weaponId);
        fpCamera.triggerShotKick(ev.weaponId);
        const muzzleWorld = fpCamera.getMuzzleWorldPosition();
        shotEffects.spawnShotEffect(muzzleWorld, ev.hitPoint, ev.hitNormal, ev.hitZone);
      } else {
        const listenerPos = created.motor.feetPos;
        const listenerYaw = input.getAngles().yaw;
        audio.playRemoteShot(ev.weaponId, listenerPos, listenerYaw, ev.origin);
        remotePlayerRenderer.triggerMuzzleFlash(ev.shooterUid);
        const muzzlePos =
          remotePlayerRenderer.getMuzzleWorldPosition(ev.shooterUid) ?? ev.origin;
        shotEffects.spawnShotEffect(muzzlePos, ev.hitPoint, ev.hitNormal, ev.hitZone);
      }
    });

    let localMatchHeadshots = 0;
    let localMatchKernActions = 0;
    let recordedMatchKey = '';

    created.events.on('localHitConfirmed', (ev) => {
      audio.playHit(ev.hitZone, ev.killed);
      hud.triggerHitmarker(ev.hitZone, ev.killed);
      remotePlayerRenderer.triggerHitFlash(ev.victimUid);
      remotePlayerRenderer.spawnDamageNumber(ev.hitPoint, ev.damage, ev.hitZone === 'head');
      if (ev.killed) {
        const hs = ev.hitZone === 'head' ? 1 : 0;
        localMatchHeadshots += hs;
        recordProgress({ kills: 1, headshots: hs });
      }
    });

    created.events.on('localDamaged', (ev) => {
      audio.playDamageTaken();
      hud.triggerDamageIndicator(
        ev.attackerPos ?? undefined,
        created.motor.feetPos,
        input.getAngles().yaw
      );
    });

    created.events.on('remoteDamaged', (ev) => {
      remotePlayerRenderer.triggerHitFlash(ev.victimUid);
    });

    created.events.on('killFeed', (ev) => {
      hud.pushPvpKillFeed(
        ev.attackerName,
        ev.attackerTeam,
        ev.victimName,
        ev.victimTeam,
        ev.weaponId,
        ev.hitZone === 'head'
      );
    });

    created.events.on('respawn', (ev) => {
      if (ev.isLocal) {
        input.setAngles(ev.yaw, 0);
        audio.playUiBeep(true);
      }
    });

    created.events.on('reload', (ev) => {
      if (ev.isLocal) {
        audio.playReload();
      }
    });

    created.events.on('footstep', (ev) => {
      if (ev.isLocal) {
        audio.playFootstep();
      } else {
        audio.playRemoteFootstep(created.motor.feetPos, input.getAngles().yaw, ev.pos);
      }
    });

    created.events.on('buyResult', (ev) => {
      if (!ev.isLocal) return;
      if (ev.ok) {
        audio.playBuySuccess();
        buyMenu.showPurchaseFeedback(true, 'Ausrüstung erworben.');
      } else {
        audio.playBuyError();
        buyMenu.showPurchaseFeedback(false, ev.reason || 'Kauf fehlgeschlagen.');
      }
    });

    created.events.on('roundPhase', (ev) => {
      if (created.role === 'host') {
        syncHostMatchSummaryToRtdb(
          created.roomCode,
          ev.roundNumber,
          ev.scoreA,
          ev.scoreB,
          ev.phase
        );
      }

      if (ev.phase === 'buy') {
        matchEndOverlay.hide();
        chatOverlay.addSystem(`Runde ${ev.roundNumber} · Kaufphase · Stand ${ev.scoreA}:${ev.scoreB}`);
        if (ev.isSuddenDeath) {
          hud.showRoundBanner(
            `RUNDE ${ev.roundNumber} · SUDDEN DEATH`,
            'ENTSCHEIDUNGSRUNDE · 5.000 ◆ SPLITTER',
            'neutral',
            3.8
          );
        } else if (ev.sidesSwapped && ev.roundNumber === 7) {
          hud.showRoundBanner(
            `RUNDE ${ev.roundNumber} · HALBZEIT`,
            'SEITENWECHSEL · AUSRÜSTUNG ZURÜCKGESETZT',
            'neutral',
            3.8
          );
        } else {
          hud.showRoundBanner(
            `RUNDE ${ev.roundNumber} · KAUFPHASE`,
            '[B] ARSENAL ÖFFNEN · SCHUTZBARRIEREN AKTIV',
            created.localTeam === 'A' ? 'a' : 'd',
            2.8
          );
        }
        audio.playUiBeep(true);
      } else if (ev.phase === 'action') {
        if (buyMenu.isOpen()) {
          buyMenu.close();
          input.requestLock();
        }
        hud.showRoundBanner(
          `RUNDE ${ev.roundNumber} GESTARTET`,
          'SCHUTZBARRIEREN GESENKT · EINSATZ FREI',
          'neutral',
          2.4
        );
        audio.playUiBeep(true);
      } else if (ev.phase === 'planted') {
        chatOverlay.addSystem('Kern platziert · 40 Sekunden bis zur Detonation', 'warn');
        hud.showRoundBanner(
          'WARNUNG · KERN PLATZIERT',
          '40 SEKUNDEN BIS ZUR DETONATION',
          'a',
          3.2
        );
      } else if (ev.phase === 'post_round' && ev.winnerTeam) {
        recordProgress({ rounds: 1 });
        const headline = formatWinReasonHeadline(ev.winnerTeam, ev.winReason);
        hud.showRoundBanner(
          `RUNDENENDE · ${ev.scoreA} : ${ev.scoreB}`,
          headline,
          ev.winnerTeam === 'A' ? 'a' : 'd',
          3.6
        );
      } else if (ev.phase === 'ended') {
        const endKey = `${created.roomCode}:${ev.roundNumber}:${ev.scoreA}:${ev.scoreB}`;
        if (recordedMatchKey !== endKey) {
          recordedMatchKey = endKey;
          const allyScore = created.localTeam === 'A' ? ev.scoreA : ev.scoreB;
          const enemyScore = created.localTeam === 'A' ? ev.scoreB : ev.scoreA;
          recordProgress({ rounds: 1 });
          recordMatchHistory({
            mapId: created.activeMapId,
            mode: 'kernbruch',
            character: created.localCharacter,
            won: allyScore > enemyScore,
            scoreAlly: allyScore,
            scoreEnemy: enemyScore,
            kills: created.localKills,
            deaths: created.localDeaths,
            assists: 0,
            headshots: localMatchHeadshots,
            kernActions: localMatchKernActions,
          });
          lobbyScreen.refreshProgression();
        }
        buyMenu.close();
        hud.closeMenu();
        input.exitLock();
      }
    });

    created.events.on('kernEvent', (ev) => {
      switch (ev.action) {
        case 'plant_start':
          audio.playKernPlantStart();
          break;
        case 'planted':
          audio.playKernPlanted();
          if (ev.uid === created.localUid) {
            localMatchKernActions += 1;
            recordProgress({ kernActions: 1 });
          }
          break;
        case 'defuse_start':
          audio.playKernDefuseStart();
          break;
        case 'half_defused':
          audio.playKernHalfDefused();
          break;
        case 'defused':
          audio.playKernDefused();
          if (ev.uid === created.localUid) {
            localMatchKernActions += 1;
            recordProgress({ kernActions: 1 });
          }
          break;
        case 'detonated':
          audio.playKernDetonated();
          break;
        case 'picked_up':
          if (ev.uid === created.localUid) {
            audio.playUiBeep(true);
          }
          break;
        case 'dropped':
        default:
          break;
      }
    });

    created.events.on('abilityCast', (ev) => {
      audio.playAbilityCast(ev.character, ev.slot);
      if (ev.character === 'mira' && ev.slot === 'x' && ev.team !== created.localTeam) {
        hud.showRoundBanner(
          'WARNUNG · AUFKLÄRUNG',
          'WEITBLICK AKTIV · POSITION ENTHÜLLT',
          'a',
          2.4
        );
      }
    });

    created.events.on('effectEvent', (ev) => {
      if (ev.action === 'triggered') {
        audio.playMineTrigger();
      } else if (ev.action === 'destroyed') {
        audio.playBarrierHit();
      }
    });

    hud.showRoundBanner(
      `RUNDE ${created.roundState.roundNumber} · KAUFPHASE`,
      '[B] ARSENAL ÖFFNEN · SCHUTZBARRIEREN AKTIV',
      created.localTeam === 'A' ? 'a' : 'd',
      3.0
    );

    audio.playUiBeep(true);
    if (!input.isPointerLocked()) {
      hud.openMenu();
    }
  };

  // 7. Gameplay HUD & Native <dialog> Pause Menu
  const hud = new HudOverlay(uiRoot, settings, {
    onPlayClick: () => {
      audio.resume();
      input.requestLock();
    },
    onSelectMap: (mapId: MapId) => {
      if (latestRoomSnapshot) return; // Online match controls its own map
      audio.resume();
      switchOfflineMap(mapId);
      audio.playUiBeep(true);
    },
    onSelectWeapon: (weaponId: WeaponId) => {
      audio.resume();
      if (onlineSession) {
        onlineSession.equipWeapon(weaponId);
      } else {
        session.equipWeapon(weaponId);
      }
      audio.playUiBeep(true);
    },
    onSelectCharacter: (characterId: CharacterId) => {
      if (onlineSession) return;
      audio.resume();
      selectedOfflineCharacter = characterId;
      session.setCharacter(characterId);
      abilityEffectsRenderer.clear();
      hud.highlightCharacter(characterId);
      lobbyScreen.setSelectedSoloCharacter(characterId);
      audio.playUiBeep(true);
    },
    onSettingsChange: (nextSettings: GameSettings) => {
      const graphicsChanged = nextSettings.graphics !== settings.graphics;
      settings = nextSettings;
      if (graphicsChanged) {
        renderer.setQuality(settings.graphics);
        mapBuilder.setQuality(settings.graphics);
        try {
          window.localStorage.setItem(GRAPHICS_STORAGE_KEY, settings.graphics);
        } catch {
          // Auswahl gilt dann nur für diese Sitzung
        }
      }
      input.setSensitivity(settings.sensitivity);
      fpCamera.applySettings(settings);
      audio.setVolume(settings.volume);
    },
    onReturnToLobby: () => {
      audio.resume();
      audio.playUiBeep(false);
      void returnToLanding(true);
    },
    onNetSimChange: (netSimCfg: NetSimConfig) => {
      audio.resume();
      applyNetSimConfig(netSimCfg);
      audio.playUiBeep(true);
    },
  });
  hud.highlightMap(initialMap.id);

  // 8. Full-Screen SHARDLINE Main Menu & Multiplayer Lobby Screen
  const initialSavedName = loadSavedPlayerName(null);
  const lobbyScreen = new LobbyScreen(uiRoot, initialSavedName, {
    onPlayerNameChange: (name: string) => {
      savePlayerName(name);
    },
    onCreateRoom: async (playerName: string) => {
      audio.resume();
      const snap = await lobbyService.createRoom(playerName);
      audio.playUiBeep(true);
      latestRoomSnapshot = snap;
      screenMode = 'lobby';
      lobbyScreen.syncRoom(snap);
    },
    onJoinRoom: async (roomCode: string, playerName: string) => {
      audio.resume();
      const snap = await lobbyService.joinRoom(roomCode, playerName);
      audio.playUiBeep(true);
      latestRoomSnapshot = snap;
      if (snap.status === 'lobby') {
        screenMode = 'lobby';
        lobbyScreen.syncRoom(snap);
      } else if (snap.status === 'playing' && enteredMatchForRoomCode !== snap.code) {
        void startOnlineMatch(snap);
      }
    },
    onLeaveRoom: async () => {
      audio.playUiBeep(false);
      await returnToLanding(true);
    },
    onSelectTeam: async (team: TeamId) => {
      audio.playUiBeep(true);
      await lobbyService.setTeam(team);
    },
    onSelectCharacter: async (character: CharacterId) => {
      selectedOfflineCharacter = character;
      audio.playUiBeep(true);
      await lobbyService.setCharacter(character);
    },
    onToggleReady: async (nextReady: boolean) => {
      audio.playUiBeep(nextReady);
      await lobbyService.setReady(nextReady);
    },
    onUpdateSettings: async (partial) => {
      audio.playUiBeep(true);
      await lobbyService.updateSettings(partial);
    },
    onStartMatch: async () => {
      audio.resume();
      audio.playUiBeep(true);
      await lobbyService.startMatch();
    },
    onFindMatch: async (playerName: string, teamSize: number) => {
      audio.resume();
      audio.playUiBeep(true);
      queuePlayerName = playerName;
      lobbyScreen.setQueueState(true, 'Netzwerk wird geprüft …');
      await matchmaking.start(playerName, teamSize);
    },
    onCancelQueue: async () => {
      audio.playUiBeep(false);
      await matchmaking.cancel();
    },
    onStartOffline: (mapId: MapId) => {
      audio.resume();
      audio.playUiBeep(true);
      testInputOverride = null;
      disposeOnlineSession();
      enteredMatchForRoomCode = null;
      latestRoomSnapshot = null;
      screenMode = 'in_game';
      lobbyScreen.hide();
      switchOfflineMap(mapId);
      hud.setGameplayActive(true, false);
      input.requestLock();

      // If pointer lock was declined by automated/headless environment, open pause dialog cleanly
      window.setTimeout(() => {
        if (screenMode === 'in_game' && !input.isPointerLocked()) {
          hud.openMenu();
        }
      }, 120);
    },
    onOpenSettings: () => {
      audio.resume();
      audio.playUiBeep(true);
      hud.openLobbySettings();
    },
    onOfflineCharacterChange: (characterId: CharacterId) => {
      selectedOfflineCharacter = characterId;
      session.setCharacter(characterId);
      hud.highlightCharacter(characterId);
    },
  });

  // --- Automatische Warteschlange: Status, Zuweisung, Auto-Beitritt ---
  const formatWait = (sec: number): string =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  matchmaking.onStatus = (status) => {
    if (status.state === 'idle') {
      lobbyScreen.setQueueState(false);
    } else if (status.state === 'probing') {
      lobbyScreen.setQueueState(true, 'Netzwerk & Latenz werden gemessen …');
    } else if (status.state === 'searching') {
      const local =
        status.localPeers > 0
          ? ` · ${status.localPeers} im selben Netzwerk (werden mitgenommen)`
          : '';
      lobbyScreen.setQueueState(
        true,
        `Suche Match ${formatWait(status.waitingSec)} · ${status.queueSize} in der Warteschlange${local}`
      );
    } else {
      const lanCount = status.plan.localGroups.reduce((n, g) => n + g.length, 0);
      const size = Object.keys(status.plan.members).length;
      lobbyScreen.setQueueState(
        true,
        `Match gefunden · ${size} Spieler · Ø ${status.plan.avgLatencyMs} ms` +
          (lanCount > 0 ? ` · ${lanCount} lokal verbunden` : '') +
          (status.isHost ? ' · Du bist Host' : ' · Verbinde …')
      );
    }
  };

  matchmaking.onAssignment = (assignment) => {
    void (async () => {
      try {
        const { match, isHost, team } = assignment;
        if (isHost) {
          const snap = await lobbyService.createRoom(queuePlayerName, {
            teamSize: Math.max(1, Math.min(5, match.teamSize)),
          });
          await matchmaking.publishRoomCode(match.id, snap.code);
          pendingQueueMatch = {
            assignment,
            startDeadline: Date.now() + 25_000,
            started: false,
          };
          latestRoomSnapshot = snap;
          screenMode = 'lobby';
          lobbyScreen.syncRoom(snap);
          tryAutoStartQueueMatch(snap);
        } else if (match.roomCode) {
          const snap = await lobbyService.joinRoom(match.roomCode, queuePlayerName, team);
          await lobbyService.setReady(true);
          latestRoomSnapshot = snap;
          screenMode = 'lobby';
          lobbyScreen.syncRoom(snap);
        }
        lobbyScreen.setQueueState(false, 'Match gefunden · Einsatz startet gleich …');
        audio.playUiBeep(true);
      } catch (err) {
        lobbyScreen.setQueueState(false);
        lobbyScreen.showClosureNotice(
          err instanceof Error ? err.message : 'Automatisches Match konnte nicht beitreten.'
        );
      }
    })();
  };

  /** Host startet automatisch, sobald alle geplanten Spieler da sind (oder nach Timeout mit ≥2). */
  const tryAutoStartQueueMatch = (snap: NonNullable<typeof latestRoomSnapshot>): void => {
    const pending = pendingQueueMatch;
    if (!pending || pending.started || !snap.isHost || snap.status !== 'lobby') return;
    const expected = Object.keys(pending.assignment.match.members);
    const present = snap.players.filter((p) => p.online && expected.includes(p.uid)).length;
    const everyoneHere = present >= expected.length;
    const timedOut = Date.now() >= pending.startDeadline && snap.players.length >= 2;
    if (everyoneHere || timedOut) {
      pending.started = true;
      void lobbyService.startMatch().catch(() => {
        pending.started = false;
      });
    }
  };
  window.setInterval(() => {
    const snap = lobbyService.getCurrentSnapshot();
    if (snap) tryAutoStartQueueMatch(snap);
  }, 1000);

  // Subscribe to Firebase Realtime Room Updates & Host Disconnect Events
  lobbyService.onRoomUpdate((snap) => {
    latestRoomSnapshot = snap;
    if (snap) tryAutoStartQueueMatch(snap);
    if (!snap) {
      disposeOnlineSession();
      if (screenMode === 'lobby') {
        screenMode = 'landing';
        lobbyScreen.showLanding();
      }
      return;
    }

    if (snap.status === 'lobby') {
      disposeOnlineSession();
      enteredMatchForRoomCode = null;
      screenMode = 'lobby';
      input.exitLock();
      hud.setGameplayActive(false);
      lobbyScreen.syncRoom(snap);
      return;
    }

    if (snap.status === 'playing') {
      if (onlineSession && onlineSession.roomCode === snap.code) {
        onlineSession.syncLobbyPlayers(snap.players);
      } else if (enteredMatchForRoomCode !== snap.code) {
        void startOnlineMatch(snap);
      }
    }
  });

  lobbyService.onRoomClosed((reason) => {
    audio.playUiBeep(false);
    void returnToLanding(
      false,
      reason || 'Der Host hat das Spiel verlassen – Raum wurde geschlossen.'
    );
  });

  // Initialize Anonymous Auth in background on page boot
  if (isFirebaseConfigured()) {
    void lobbyService
      .initAuth()
      .then((uid) => {
        lobbyScreen.setAuthStatus(uid);
        lobbyScreen.setPlayerNameInput(loadSavedPlayerName(uid));
      })
      .catch(() => {
        lobbyScreen.setAuthStatus(null, 'Offline-Modus · Cloud-Auth nicht erreichbar');
      });
  } else {
    lobbyScreen.setAuthStatus(null, 'Offline-Modus · Keine Cloud-Konfiguration');
  }

  input.onPointerLockChange = (locked: boolean) => {
    if (screenMode !== 'in_game') return;
    if (!locked && (buyMenu.isOpen() || matchEndOverlay.isOpen())) {
      hud.closeMenu();
      return;
    }
    hud.onPointerLockChanged(locked);
  };

  input.onShopToggle = () => {
    if (screenMode !== 'in_game') return;
    audio.resume();

    // Online Match: Toggle Phase 4 Buy Menu (`#buy-menu-overlay`)
    if (onlineSession) {
      if (onlineSession.roundState.phase === 'ended') return;
      if (buyMenu.isOpen()) {
        buyMenu.close();
        audio.playUiBeep(false);
        input.requestLock();
      } else {
        hud.closeMenu();
        buyMenu.open();
        audio.playUiBeep(true);
        input.exitLock();
      }
      return;
    }

    // Offline Training Mode: Toggle Phase 4 Buy Menu (`#buy-menu-overlay`)
    if (buyMenu.isOpen()) {
      buyMenu.close();
      audio.playUiBeep(false);
      input.requestLock();
    } else {
      hud.closeMenu();
      buyMenu.open();
      audio.playUiBeep(true);
      input.exitLock();
    }
  };

  // Hotkeys `M` (offline map toggle), `F1` (ability info), and `F2` (offline specialist switcher)
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'F1' && screenMode === 'in_game') {
      e.preventDefault();
      hud.toggleAbilityInfoOverlay();
      audio.playUiBeep(true);
      return;
    }

    if (e.code === 'F2' && screenMode === 'in_game' && latestRoomSnapshot === null && onlineSession === null) {
      e.preventDefault();
      hud.toggleOfflineSpecialistOverlay();
      audio.playUiBeep(true);
      return;
    }

    if (e.code !== 'KeyM') return;
    if (screenMode !== 'in_game' || latestRoomSnapshot !== null || onlineSession !== null) return;
    const nextMap: MapId = session.activeMapId === 'hafenwerk' ? 'uebungsanlage' : 'hafenwerk';
    switchOfflineMap(nextMap);
    audio.playUiBeep(true);
  });

  // 9. Wire Offline Deterministic Session Events -> Audio, Tracers, Hitmarkers & Feed
  session.events.on('shot', (payload) => {
    if (onlineSession) return;
    audio.playShot(payload.weaponId);
    fpCamera.triggerShotKick(payload.weaponId);

    const muzzleWorld = fpCamera.getMuzzleWorldPosition();
    for (const hit of payload.pelletHits) {
      shotEffects.spawnShotEffect(muzzleWorld, hit.point, hit.normal, hit.hitZone);
    }

    if (session.mapDef.sprayWallBounds) {
      shotEffects.syncSprayWallPoints(
        session.sprayImpacts,
        session.mapDef.sprayWallBounds.normal
      );
    }
  });

  session.events.on('hit', (payload) => {
    if (onlineSession) return;
    audio.playHit(payload.hitZone, payload.killed);
    hud.triggerHitmarker(payload.hitZone, payload.killed);
    dummyRenderer.spawnDamageNumber(payload.point, payload.damage, payload.hitZone === 'head');
  });

  session.events.on('kill', (payload) => {
    if (onlineSession) return;
    hud.pushEliminationFeed(payload.hitZone, payload.damage);
    recordProgress({
      kills: 1,
      headshots: payload.hitZone === 'head' ? 1 : 0,
    });
  });

  session.events.on('reloadStart', () => {
    if (onlineSession) return;
    audio.playReload();
  });

  session.events.on('footstep', () => {
    if (onlineSession) return;
    audio.playFootstep();
  });

  session.events.on('rangeButton', (payload) => {
    if (onlineSession) return;
    audio.playUiBeep(payload.active || payload.buttonId === 'clear_spray');
    mapBuilder.flashButton(payload.buttonId);
    if (payload.buttonId === 'clear_spray') {
      shotEffects.syncSprayWallPoints([], session.mapDef.sprayWallBounds?.normal);
    }
  });

  session.events.on('abilityCast', (ev) => {
    if (onlineSession) return;
    audio.playAbilityCast(ev.character, ev.slot);
  });

  session.events.on('effectEvent', (ev) => {
    if (onlineSession) return;
    if (ev.action === 'triggered') {
      audio.playMineTrigger();
    } else if (ev.action === 'destroyed') {
      audio.playBarrierHit();
    }
  });

  // 10. Window Resize Handling
  window.addEventListener('resize', () => {
    renderer.resize();
    fpCamera.resize();
  });

  // 11. Fixed 30 Hz Simulation + Uncapped Interpolated Render Loop
  const loop = new GameLoop(
    (simDt) => {
      if (onlineSession) {
        input.setSpectatorMode(!onlineSession.localAlive);
        input.setKernInteractAvailable(onlineSession.isKernInteractAvailable());
      } else {
        if (input.isSpectatorMode()) {
          input.setSpectatorMode(false);
        }
        input.setKernInteractAvailable(false);
      }

      let snapshot = input.sampleInput(simDt);

      // Merge optional programmatic QA test input when headless automation drives movement/fire
      if (testInputOverride) {
        if (testInputOverride.yaw !== undefined || testInputOverride.pitch !== undefined) {
          const curAngles = input.getAngles();
          const nextYaw = testInputOverride.yaw ?? curAngles.yaw;
          const nextPitch = testInputOverride.pitch ?? curAngles.pitch;
          input.setAngles(nextYaw, nextPitch);
          snapshot = {
            ...snapshot,
            ...testInputOverride,
            yaw: nextYaw,
            pitch: nextPitch,
            seq: snapshot.seq,
            dt: simDt,
          };
        } else {
          snapshot = {
            ...snapshot,
            ...testInputOverride,
            seq: snapshot.seq,
            dt: simDt,
          };
        }
      }

      if (onlineSession) {
        onlineSession.tick(snapshot);
      } else {
        session.tick(snapshot);
      }
    },
    (alpha, frameDt) => {
      if (onlineSession) {
        const remotePlayers = onlineSession.updateRenderFrame(frameDt, alpha);
        const round = onlineSession.roundState;
        const pose = onlineSession.getActiveCameraPose(alpha);
        const liveAngles = input.getAngles();
        const camYaw = pose.isSpectating ? pose.yaw : liveAngles.yaw;
        const camPitch = pose.isSpectating ? pose.pitch : liveAngles.pitch;
        const visRecoil = pose.isSpectating
          ? { pitchRad: 0, yawRad: 0 }
          : onlineSession.getVisualRecoil();

        const kernPrompt = onlineSession.getKernInteractionPrompt();
        const isChannelingPlant =
          onlineSession.localAlive &&
          kernPrompt.mode === 'plant' &&
          kernPrompt.isChanneling;

        const activeSlot = pose.spectatedPlayer
          ? pose.spectatedPlayer.activeSlot
          : onlineSession.activeSlot;
        const drawnWeaponId = pose.spectatedPlayer
          ? pose.spectatedPlayer.weaponId
          : onlineSession.weapon.weaponId;
        const viewItem: 'weapon' | 'knife' | 'kern' = isChannelingPlant
          ? 'kern'
          : activeSlot === 3
            ? 'knife'
            : 'weapon';

        fpCamera.setViewmodelVisible(onlineSession.localAlive || pose.isSpectating);
        fpCamera.update({
          eyePos: pose.eyePos,
          yaw: camYaw,
          pitch: camPitch,
          visualRecoilPitchRad: visRecoil.pitchRad,
          visualRecoilYawRad: visRecoil.yawRad,
          weaponId: drawnWeaponId,
          viewItem,
          kernChannelProgress: isChannelingPlant ? kernPrompt.progress01 : 0,
          isAds: !pose.isSpectating && onlineSession.isAdsActive,
          isReloading: pose.spectatedPlayer
            ? pose.spectatedPlayer.isReloading
            : onlineSession.weapon.isReloading,
          reloadProgress: pose.spectatedPlayer ? 0.5 : onlineSession.weapon.reloadProgress,
          horizontalSpeed: pose.spectatedPlayer
            ? Math.hypot(pose.spectatedPlayer.vel.x, pose.spectatedPlayer.vel.z)
            : onlineSession.motor.horizontalSpeed,
          stance: pose.spectatedPlayer ? pose.spectatedPlayer.stance : onlineSession.stance,
          frameDt,
        });

        // Update 3D Buy-Phase Spawn Barriers & World Kern device
        kernAndBarrierRenderer.sync(round, frameDt);

        // Accelerating spatial Kern fuse audio (40..20s 1/s, 20..10s 2/s, 10..5s 4/s, 5..0s 8/s)
        audio.updateKernFuseAudio(
          round.phase === 'planted',
          round.kern.fuseRemainingSec,
          frameDt,
          pose.eyePos,
          camYaw,
          round.kern.pos
        );

        const omittedFirstPersonUid = pose.spectatedPlayer
          ? pose.spectatedPlayer.uid
          : onlineSession.localUid;
        remotePlayerRenderer.sync(
          remotePlayers,
          omittedFirstPersonUid,
          onlineSession.localTeam,
          frameDt
        );
        const activeEffects = onlineSession.getActiveEffects();
        abilityEffectsRenderer.sync(activeEffects, onlineSession.localTeam, frameDt);
        const onlineSmokeBlindness =
          onlineSession.localAlive || pose.isSpectating
            ? abilityEffectsRenderer.isPointInsideSmoke(pose.eyePos, activeEffects)
            : 0;
        shotEffects.update(frameDt);
        mapBuilder.update(frameDt);
        renderer.render(fpCamera.camera, frameDt);

        const allPlayers = onlineSession.getAllPlayers();
        const attackers = allPlayers.filter((p) => p.team === 'A');
        const defenders = allPlayers.filter((p) => p.team === 'D');
        const aliveAttackers = attackers.filter((p) => p.alive).length;
        const aliveDefenders = defenders.filter((p) => p.alive).length;

        const netDiag = onlineSession.getNetDiagnostics(loop.fps);
        const onlineCount = latestRoomSnapshot
          ? latestRoomSnapshot.players.filter((p) => p.online).length
          : allPlayers.length;

        const canBuyNow = onlineSession.canBuyNow();
        const cannotBuyReason =
          round.phase !== 'buy'
            ? 'KAUFPHASE BEENDET'
            : !onlineSession.localAlive
              ? 'AUSGESCHALTET'
              : 'NUR IN SPAWN-ZONE KAUFBAR';

        const localAbilities = onlineSession.getAbilityState();

        buyMenu.update(
          {
            playerName: onlineSession.localName,
            team: onlineSession.localTeam,
            character: onlineSession.localCharacter,
            credits: onlineSession.credits,
            primaryWeapon: onlineSession.primaryWeapon,
            secondaryWeapon: onlineSession.secondaryWeapon,
            activeSlot: onlineSession.activeSlot,
            armor: onlineSession.playerShield,
            armorMax: onlineSession.playerArmorMax,
            hasKern: onlineSession.hasKern,
            qCharges: localAbilities.qCharges,
            qMax: localAbilities.qMax,
            eCharges: localAbilities.eCharges,
            eMax: localAbilities.eMax,
            ultPoints: localAbilities.ultPoints,
            ultMax: localAbilities.ultMax,
            phase: round.phase,
            phaseRemainingSec: round.phaseRemainingSec,
            canBuyNow,
            cannotBuyReason,
          },
          frameDt
        );

        if (round.phase === 'ended') {
          if (buyMenu.isOpen()) buyMenu.close();
          if (hud.isMenuOpen()) hud.closeMenu();
          if (input.isPointerLocked()) input.exitLock();
          matchEndOverlay.show({
            mode: 'ended',
            localUid: onlineSession.localUid,
            localTeam: onlineSession.localTeam,
            isHost: onlineSession.role === 'host',
            roundNumber: round.roundNumber,
            roundsToWin: onlineSession.roundsToWin,
            scoreA: round.scoreA,
            scoreB: round.scoreB,
            matchWinnerTeam: round.matchWinnerTeam,
            players: allPlayers,
          });
        } else {
          matchEndOverlay.hide();
        }

        // Tab scoreboard (held; pointer lock stays engaged)
        if (tabScoreboardHeld && round.phase !== 'ended') {
          const rows: ScoreboardRow[] = allPlayers.map((p) => {
            const isSelf = p.uid === onlineSession!.localUid;
            const isHostPlayer = p.uid === onlineSession!.hostUid;
            return rowFromNetPlayer(p, {
              isSelf,
              ultMax: p.abilities?.ultMax ?? 7,
              pingLabel: formatPingLabel(
                isSelf,
                isHostPlayer,
                onlineSession!.role === 'host',
                netDiag.rttMs,
                netDiag.transportMode
              ),
            });
          });
          const allyScore = onlineSession.localTeam === 'A' ? round.scoreA : round.scoreB;
          const enemyScore = onlineSession.localTeam === 'A' ? round.scoreB : round.scoreA;
          tabScoreboard.show({
            title: `RUNDE ${round.roundNumber}`,
            subtitle: `ERSTER AUF ${onlineSession.roundsToWin} · ${onlineSession.mapDef.name.toUpperCase()}`,
            localTeam: onlineSession.localTeam,
            scoreAlly: allyScore,
            scoreEnemy: enemyScore,
            rows,
          });
        } else {
          tabScoreboard.hide();
        }

        // Relay / transport change notices in chat
        if (lastTransportMode !== netDiag.transportMode) {
          if (lastTransportMode !== null) {
            if (netDiag.transportMode === 'relay') {
              chatOverlay.addSystem('Verbindung auf RTDB-Relay (10 Hz) umgeschaltet', 'warn');
            } else if (netDiag.transportMode === 'p2p') {
              chatOverlay.addSystem('Direkte WebRTC-P2P-Verbindung aktiv');
            }
          }
          lastTransportMode = netDiag.transportMode;
        }

        // Minimap (allies, own Kern, revealed enemies only)
        const localTeamId = onlineSession.localTeam;
        const toMarker = (p: (typeof allPlayers)[number]): MinimapMarker => ({
          uid: p.uid,
          pos: p.pos,
          yaw: p.yaw,
          alive: p.alive,
          hasKern: p.hasKern,
        });
        minimap.setVisible(true);
        minimap.update(
          {
            localPos: onlineSession.motor.feetPos,
            localYaw: liveAngles.yaw,
            localTeam: localTeamId,
            localAlive: onlineSession.localAlive,
            localHasKern: onlineSession.hasKern,
            allies: allPlayers
              .filter((p) => p.team === localTeamId && p.uid !== onlineSession!.localUid)
              .map(toMarker),
            revealedEnemies: allPlayers
              .filter(
                (p) =>
                  p.team !== localTeamId &&
                  p.alive &&
                  (p.abilities?.revealedSec ?? 0) > 0 &&
                  p.abilities?.revealedToTeam === localTeamId
              )
              .map(toMarker),
            kern: round.kern,
            effects: activeEffects,
            phase: round.phase,
            barriersActive: round.barriersActive,
          },
          frameDt
        );
        chatOverlay.update(frameDt);

        const localUidRef = onlineSession.localUid;
        const onlineContext: OnlineHudContext = {
          roomCode: onlineSession.roomCode,
          team: onlineSession.localTeam,
          character: onlineSession.localCharacter,
          onlinePlayerCount: onlineCount,
          isHost: onlineSession.role === 'host',
          transportMode: netDiag.transportMode,
          rttMs: netDiag.rttMs,
          packetLossPct: netDiag.packetLossPct,
          kills: onlineSession.localKills,
          deaths: onlineSession.localDeaths,
          roundsToWin: onlineSession.roundsToWin,
          aliveAttackers,
          totalAttackers: Math.max(1, attackers.length),
          aliveDefenders,
          totalDefenders: Math.max(1, defenders.length),
          rosterA: attackers.map((p) => ({
            uid: p.uid,
            character: p.character,
            alive: p.alive,
            isSelf: p.uid === localUidRef,
          })),
          rosterD: defenders.map((p) => ({
            uid: p.uid,
            character: p.character,
            alive: p.alive,
            isSelf: p.uid === localUidRef,
          })),
          round,
          credits: onlineSession.credits,
          primaryWeapon: onlineSession.primaryWeapon,
          secondaryWeapon: onlineSession.secondaryWeapon,
          activeSlot: onlineSession.activeSlot,
          hasKern: onlineSession.hasKern,
          ultPoints: localAbilities.ultPoints,
          abilities: localAbilities,
          canPlantZone:
            kernPrompt.mode === 'plant' && kernPrompt.canStart && kernPrompt.zone
              ? kernPrompt.zone
              : null,
          canDefuseKern: kernPrompt.mode === 'defuse' && kernPrompt.canStart,
          canBuyNow,
          spectateTargetName: pose.spectatedPlayer ? pose.spectatedPlayer.name : null,
        };

        const activeGun = onlineSession.activeGun;
        hud.update(
          {
            mapId: onlineSession.activeMapId,
            mapTitle: onlineSession.mapDef.name,
            hp: pose.spectatedPlayer ? pose.spectatedPlayer.hp : onlineSession.playerHp,
            maxHp: onlineSession.playerMaxHp,
            shield: pose.spectatedPlayer ? pose.spectatedPlayer.armor : onlineSession.playerShield,
            isAlive: onlineSession.localAlive,
            respawnRemainingSec: onlineSession.respawnRemainingSec,
            stance: onlineSession.stance,
            weaponId: onlineSession.weapon.weaponId,
            ammoInMag: activeGun ? activeGun.ammoInMag : 0,
            reserveAmmo: activeGun ? activeGun.reserveAmmo : 0,
            infiniteAmmo: false,
            isReloading: activeGun ? activeGun.isReloading : false,
            reloadProgress: activeGun ? activeGun.reloadProgress : 0,
            spreadDeg: onlineSession.currentSpreadDeg,
            isScopedFalke: onlineSession.localAlive && fpCamera.isScopedFalke(),
            scopeView: onlineSession.localAlive ? fpCamera.getScopeView() : undefined,
            pointerLocked:
              input.isPointerLocked() || buyMenu.isOpen() || matchEndOverlay.isOpen(),
            challengeActive: false,
            challengeHits: 0,
            challengeRemaining: 0,
            challengeElapsedSec: 0,
            characterId: pose.spectatedPlayer
              ? pose.spectatedPlayer.character
              : onlineSession.localCharacter,
            credits: onlineSession.credits,
            abilities: localAbilities,
            smokeBlindness: onlineSmokeBlindness,
            fps: loop.fps,
            tickRate: SIM_TICK_RATE,
            packetLossPct: netDiag.packetLossPct,
            onlineContext,
          },
          frameDt
        );

        debugOverlay.update({
          fps: loop.fps,
          simTickRate: SIM_TICK_RATE,
          measuredTicksPerSec: loop.ticksPerSecond,
          backendName: renderer.backendName,
          drawCalls: renderer.getDrawCalls(),
          mapId: onlineSession.activeMapId,
          pos: onlineSession.motor.feetPos,
          speed: onlineSession.motor.horizontalSpeed,
          stance: onlineSession.stance,
          spreadDeg: onlineSession.currentSpreadDeg,
          recoilShotIndex: Math.floor(onlineSession.recoil.shotIndex),
          aliveDummies: remotePlayers.filter((p) => p.alive).length,
          totalDummies: remotePlayers.length,
          net: {
            role: netDiag.role,
            transportMode: netDiag.transportMode,
            rttMs: netDiag.rttMs,
            packetLossPct: netDiag.packetLossPct,
            snapshotRateHz: netDiag.snapshotRateHz,
            reconcileErrorMm: netDiag.predictionErrorMm,
            interpolatedPlayers: netDiag.interpolatedPlayerCount,
            netSim: netDiag.netSim,
          },
        });
        return;
      }

      // Offline LocalSession Render Path
      audio.updateKernFuseAudio(false, 0, frameDt);
      fpCamera.setViewmodelVisible(true);

      const eyePos = session.getInterpolatedEyePos(alpha);
      const angles = input.getAngles();
      const visRecoil = session.getVisualRecoil();

      fpCamera.update({
        eyePos,
        yaw: angles.yaw,
        pitch: angles.pitch,
        visualRecoilPitchRad: visRecoil.pitchRad,
        visualRecoilYawRad: visRecoil.yawRad,
        weaponId: session.weapon.weaponId,
        viewItem: offlineActiveSlot === 3 ? 'knife' : 'weapon',
        isAds: offlineActiveSlot !== 3 && session.isAdsActive,
        isReloading: offlineActiveSlot !== 3 && session.weapon.isReloading,
        reloadProgress: session.weapon.reloadProgress,
        horizontalSpeed: session.motor.horizontalSpeed,
        stance: session.stance,
        frameDt,
      });

      const challenge = session.challengeState;
      if (challenge.completed && !wasRangeChallengeCompleted) {
        wasRangeChallengeCompleted = true;
        recordProgress({ rounds: 1 });
        recordMatchHistory({
          mapId: 'uebungsanlage',
          mode: 'training',
          character: session.characterId,
          outcome: 'training',
          won: true,
          scoreAlly: challenge.lastScoreHits,
          scoreEnemy: 30,
          kills: challenge.lastScoreHits,
          deaths: 0,
          assists: 0,
        });
      } else if (!challenge.completed) {
        wasRangeChallengeCompleted = false;
      }

      if (session.activeMapId === 'uebungsanlage') {
        mapBuilder.updateRangeVisuals(
          {
            challengeActive: challenge.active,
            challengeHits: challenge.hits,
            challengeRemaining: challenge.remaining,
            challengeElapsedSec: challenge.elapsedSec,
            lastChallengeHits: challenge.completed ? challenge.lastScoreHits : undefined,
            lastChallengeTimeSec: challenge.completed ? challenge.lastScoreTimeSec : undefined,
            strafeEnabled: session.strafeEnabled,
            armorEnabled: session.armorEnabled,
            infiniteAmmo: session.infiniteAmmo,
          },
          frameDt
        );
      }

      const offlineEffects = session.getActiveEffects();
      abilityEffectsRenderer.sync(offlineEffects, 'A', frameDt);
      const offlineSmokeBlindness = abilityEffectsRenderer.isPointInsideSmoke(
        eyePos,
        offlineEffects
      );
      const offlineAbilities = session.getAbilityState();

      dummyRenderer.sync(session.getDummies(), fpCamera.camera, frameDt);
      shotEffects.update(frameDt);

      mapBuilder.update(frameDt);
      renderer.render(fpCamera.camera, frameDt);

      // Offline minimap (training targets) + Tab training overview
      const offlineDummies = session.getDummies();
      minimap.setVisible(screenMode === 'in_game');
      if (screenMode === 'in_game') {
        minimap.update(
          {
            localPos: session.motor.feetPos,
            localYaw: angles.yaw,
            localTeam: 'A',
            localAlive: true,
            allies: [],
            revealedEnemies: [],
            trainingTargets: offlineDummies.map((d) => ({
              uid: d.id,
              pos: d.pos,
              alive: d.alive,
            })),
            effects: offlineEffects,
            phase: null,
          },
          frameDt
        );
      }
      chatOverlay.update(frameDt);

      if (tabScoreboardHeld && screenMode === 'in_game') {
        const selfDef = CHARACTER_LIST.find((c) => c.id === session.characterId) ?? CHARACTER_LIST[0];
        const selfRow: ScoreboardRow = {
          uid: 'self',
          name: loadSavedPlayerName(lobbyService.getUid()) || 'Agent',
          team: 'A',
          character: selfDef.id,
          alive: true,
          weaponLabel: offlineActiveSlot === 3 ? 'Taktik-Klinge' : session.getWeaponStats().name,
          weaponSvgId: offlineActiveSlot === 3 ? 'knife' : session.weapon.weaponId,
          armor: session.playerShield,
          armorMax: 50,
          ultPoints: offlineAbilities.ultPoints,
          ultMax: offlineAbilities.ultMax,
          kills: session.totalKills,
          deaths: 0,
          assists: 0,
          credits: START_CREDITS,
          pingLabel: 'OFFLINE',
          isSelf: true,
        };
        const botRows: ScoreboardRow[] = offlineDummies.map((d, i) => ({
          uid: d.id,
          name: `Trainingsziel ${i + 1}`,
          team: 'D',
          character: CHARACTER_LIST[i % CHARACTER_LIST.length].id,
          alive: d.alive,
          weaponLabel: 'Ziel',
          weaponSvgId: null,
          armor: 0,
          armorMax: 0,
          ultPoints: 0,
          ultMax: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          credits: 0,
          pingLabel: '—',
          isSelf: false,
        }));
        tabScoreboard.show({
          title: 'TRAININGS-ÜBERSICHT',
          subtitle: `${session.mapDef.name.toUpperCase()} · ${session.getAliveDummyCount()} / ${offlineDummies.length} ZIELE AKTIV`,
          localTeam: 'A',
          scoreAlly: session.totalKills,
          scoreEnemy: session.getAliveDummyCount(),
          allyLabel: 'DU',
          enemyLabel: 'TRAININGSZIELE',
          rows: [selfRow, ...botRows],
        });
      } else {
        tabScoreboard.hide();
      }
      if (buyMenu.isOpen()) {
        buyMenu.update(
          {
            playerName: loadSavedPlayerName(lobbyService.getUid()) || 'Agent',
            team: 'A',
            character: session.characterId,
            credits: 9000,
            primaryWeapon: offlinePrimaryWeapon,
            secondaryWeapon: offlineSecondaryWeapon,
            activeSlot: offlineActiveSlot,
            armor: session.playerShield,
            armorMax: 50,
            hasKern: false,
            qCharges: offlineAbilities.qCharges,
            qMax: offlineAbilities.qMax,
            eCharges: offlineAbilities.eCharges,
            eMax: offlineAbilities.eMax,
            ultPoints: offlineAbilities.ultPoints,
            ultMax: offlineAbilities.ultMax,
            phase: 'buy',
            phaseRemainingSec: 999,
            canBuyNow: true,
            cannotBuyReason: '',
          },
          frameDt
        );
      }

      hud.update(
        {
          mapId: session.activeMapId,
          mapTitle: session.mapDef.name,
          hp: session.playerHp,
          maxHp: session.playerMaxHp,
          shield: session.playerShield,
          isAlive: true,
          respawnRemainingSec: 0,
          stance: session.stance,
          weaponId: session.weapon.weaponId,
          ammoInMag: session.weapon.ammoInMag,
          reserveAmmo: session.weapon.reserveAmmo,
          infiniteAmmo: session.infiniteAmmo,
          isReloading: session.weapon.isReloading,
          reloadProgress: session.weapon.reloadProgress,
          spreadDeg: session.currentSpreadDeg,
          isScopedFalke: offlineActiveSlot !== 3 && fpCamera.isScopedFalke(),
          scopeView: offlineActiveSlot !== 3 ? fpCamera.getScopeView() : undefined,
          pointerLocked: input.isPointerLocked() || buyMenu.isOpen(),
          challengeActive: challenge.active,
          challengeHits: challenge.hits,
          challengeRemaining: challenge.remaining,
          challengeElapsedSec: challenge.elapsedSec,
          lastChallengeHits: challenge.lastScoreHits > 0 ? challenge.lastScoreHits : undefined,
          lastChallengeTimeSec:
            challenge.lastScoreTimeSec > 0 ? challenge.lastScoreTimeSec : undefined,
          characterId: session.characterId,
          credits: START_CREDITS,
          abilities: offlineAbilities,
          smokeBlindness: offlineSmokeBlindness,
          fps: loop.fps,
          tickRate: SIM_TICK_RATE,
          packetLossPct: 0,
          aliveTargetsOffline: session.getAliveDummyCount(),
          totalTargetsOffline: session.getDummies().length,
          offlineTotalKills: session.totalKills,
          offlineLoadout: {
            primaryWeapon: offlinePrimaryWeapon,
            secondaryWeapon: offlineSecondaryWeapon,
            activeSlot: offlineActiveSlot,
          },
          onlineContext: null,
        },
        frameDt
      );

      debugOverlay.update({
        fps: loop.fps,
        simTickRate: SIM_TICK_RATE,
        measuredTicksPerSec: loop.ticksPerSecond,
        backendName: renderer.backendName,
        drawCalls: renderer.getDrawCalls(),
        mapId: session.activeMapId,
        pos: session.motor.feetPos,
        speed: session.motor.horizontalSpeed,
        stance: session.stance,
        spreadDeg: session.currentSpreadDeg,
        recoilShotIndex: Math.floor(session.recoil.shotIndex),
        aliveDummies: session.getAliveDummyCount(),
        totalDummies: session.getDummies().length,
        net: {
          role: 'offline',
          transportMode: 'disconnected',
          rttMs: 0,
          packetLossPct: 0,
          snapshotRateHz: 0,
          reconcileErrorMm: 0,
          interpolatedPlayers: 0,
          netSim: { ...currentNetSim },
        },
      });
    }
  );

  // 12. Expose Read-Only Runtime Diagnostics & Test Hooks (Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5)
  window.__SHARDLINE__ = {
    getDiagnostics: (): ShardlineDiagnostics => {
      if (onlineSession) {
        const feet = onlineSession.motor.feetPos;
        const aliveRemotes = onlineSession.getRemotePlayers().filter((p) => p.alive).length;
        const activeGun = onlineSession.activeGun;
        return Object.freeze({
          fps: Math.round(loop.fps),
          tickRate: SIM_TICK_RATE,
          backend: renderer.backendName,
          activeMap: onlineSession.activeMapId,
          pointerLocked: input.isPointerLocked(),
          playerPos: Object.freeze({
            x: Number(feet.x.toFixed(3)),
            y: Number(feet.y.toFixed(3)),
            z: Number(feet.z.toFixed(3)),
          }),
          weaponId: onlineSession.weapon.weaponId,
          ammo: Object.freeze({
            inMag: activeGun ? activeGun.ammoInMag : 0,
            reserve: activeGun ? activeGun.reserveAmmo : 0,
            infinite: false,
          }),
          aliveDummies: aliveRemotes,
          totalHits: onlineSession.totalHits,
          totalKills: onlineSession.localKills,
          character: onlineSession.localCharacter,
          abilities: Object.freeze({ ...onlineSession.getAbilityState() }),
          activeEffectsCount: onlineSession.getActiveEffects().length,
          minimapActive: minimap.isActive(),
          drawCalls: renderer.getDrawCalls(),
        });
      }

      const feet = session.motor.feetPos;
      return Object.freeze({
        fps: Math.round(loop.fps),
        tickRate: SIM_TICK_RATE,
        backend: renderer.backendName,
        activeMap: session.activeMapId,
        pointerLocked: input.isPointerLocked(),
        playerPos: Object.freeze({
          x: Number(feet.x.toFixed(3)),
          y: Number(feet.y.toFixed(3)),
          z: Number(feet.z.toFixed(3)),
        }),
        weaponId: session.weapon.weaponId,
        ammo: Object.freeze({
          inMag: session.weapon.ammoInMag,
          reserve: session.weapon.reserveAmmo,
          infinite: session.infiniteAmmo,
        }),
        aliveDummies: session.getAliveDummyCount(),
        totalHits: session.totalHits,
        totalKills: session.totalKills,
        character: session.characterId,
        abilities: Object.freeze({ ...session.getAbilityState() }),
        activeEffectsCount: session.getActiveEffects().length,
        minimapActive: minimap.isActive(),
        drawCalls: renderer.getDrawCalls(),
      });
    },
    getLobbyDiagnostics: (): ShardlineLobbyDiagnostics => {
      const uid = lobbyService.getUid();
      const snap = lobbyService.getCurrentSnapshot();
      const me = snap?.players.find((p) => p.uid === uid) ?? null;
      const onlineCount = snap ? snap.players.filter((p) => p.online).length : 0;
      return Object.freeze({
        screen: screenMode,
        uid,
        roomCode: snap ? snap.code : null,
        isHost: snap ? snap.isHost : false,
        team: me ? me.team : null,
        character: me ? me.character : selectedOfflineCharacter,
        playerCount: onlineCount,
        status: snap ? snap.status : 'offline',
      });
    },
    getNetDiagnostics: (): ShardlineNetDiagnostics => {
      if (onlineSession) {
        const d = onlineSession.getNetDiagnostics(loop.fps);
        return Object.freeze({
          role: d.role,
          transportMode: d.transportMode,
          rttMs: Math.round(d.rttMs * 10) / 10,
          packetLossPct: Math.round(d.packetLossPct * 10) / 10,
          tickRate: d.tickRate,
          snapshotRateHz: d.snapshotRateHz,
          fps: d.fps,
          predictionErrorMm: d.predictionErrorMm,
          interpolatedPlayerCount: d.interpolatedPlayerCount,
          localUid: d.localUid,
          localPos: Object.freeze({
            x: Number(d.localPos.x.toFixed(3)),
            y: Number(d.localPos.y.toFixed(3)),
            z: Number(d.localPos.z.toFixed(3)),
          }),
          localHp: d.localHp,
          localAlive: d.localAlive,
          kills: d.kills,
          deaths: d.deaths,
          remotePlayerCount: d.remotePlayerCount,
          remotePlayers: Object.freeze(
            d.remotePlayers.map((rp) =>
              Object.freeze({
                uid: rp.uid,
                name: rp.name,
                team: rp.team,
                pos: Object.freeze({
                  x: Number(rp.pos.x.toFixed(3)),
                  y: Number(rp.pos.y.toFixed(3)),
                  z: Number(rp.pos.z.toFixed(3)),
                }),
                hp: rp.hp,
                alive: rp.alive,
              })
            )
          ),
          netSim: Object.freeze({ ...d.netSim }),
          abilities: Object.freeze({ ...d.abilities }),
          activeEffectsCount: d.activeEffectsCount,
        });
      }

      const feet = session.motor.feetPos;
      return Object.freeze({
        role: 'offline',
        transportMode: 'disconnected',
        rttMs: 0,
        packetLossPct: 0,
        tickRate: SIM_TICK_RATE,
        snapshotRateHz: 0,
        fps: Math.round(loop.fps),
        predictionErrorMm: 0,
        interpolatedPlayerCount: 0,
        localUid: lobbyService.getUid(),
        localPos: Object.freeze({
          x: Number(feet.x.toFixed(3)),
          y: Number(feet.y.toFixed(3)),
          z: Number(feet.z.toFixed(3)),
        }),
        localHp: session.playerHp,
        localAlive: true,
        kills: 0,
        deaths: 0,
        remotePlayerCount: 0,
        remotePlayers: Object.freeze([]),
        netSim: Object.freeze({ ...currentNetSim }),
        abilities: Object.freeze({ ...session.getAbilityState() }),
        activeEffectsCount: session.getActiveEffects().length,
      });
    },
    getRoundDiagnostics: (): ShardlineRoundDiagnostics => {
      if (onlineSession) {
        const rd = onlineSession.getRoundDiagnostics();
        return Object.freeze({
          roundNumber: rd.roundNumber,
          phase: rd.phase,
          phaseRemainingSec: rd.phaseRemainingSec,
          barriersActive: rd.barriersActive,
          scoreA: rd.scoreA,
          scoreB: rd.scoreB,
          credits: rd.credits,
          primaryWeapon: rd.primaryWeapon,
          secondaryWeapon: rd.secondaryWeapon,
          armor: rd.armor,
          hasKern: rd.hasKern,
          kernStatus: rd.kernStatus,
          spectatingUid: rd.spectatingUid,
          abilities: Object.freeze({ ...rd.abilities }),
          activeEffectsCount: rd.activeEffectsCount,
        });
      }

      return Object.freeze({
        roundNumber: 1,
        phase: 'buy' as MatchPhase,
        phaseRemainingSec: BUY_PHASE_SEC,
        barriersActive: false,
        scoreA: 0,
        scoreB: 0,
        credits: START_CREDITS,
        primaryWeapon: session.weapon.weaponId === 'funke' || session.weapon.weaponId === 'bolzer'
          ? null
          : session.weapon.weaponId,
        secondaryWeapon:
          session.weapon.weaponId === 'bolzer' ? 'bolzer' : ('funke' as WeaponId),
        armor: session.playerShield,
        hasKern: false,
        kernStatus: 'carried' as KernStatus,
        spectatingUid: null,
        abilities: Object.freeze({ ...session.getAbilityState() }),
        activeEffectsCount: session.getActiveEffects().length,
      });
    },
    requestBuy: (itemType: BuyItemType, itemId: string): void => {
      onlineSession?.requestBuy(itemType, itemId);
    },
    castAbility: (slot: AbilitySlot): boolean => {
      audio.resume();
      if (onlineSession) {
        return onlineSession.castAbility(slot);
      }
      return session.castAbility(slot);
    },
    setOfflineCharacter: (characterId: CharacterId): void => {
      if (onlineSession) return;
      selectedOfflineCharacter = characterId;
      session.setCharacter(characterId);
      abilityEffectsRenderer.clear();
      hud.highlightCharacter(characterId);
      lobbyScreen.setSelectedSoloCharacter(characterId);
    },
    setNetSim: (partialCfg: Partial<NetSimConfig>): NetSimConfig => {
      return applyNetSimConfig(partialCfg);
    },
    setTestInput: (partialInput: Partial<InputSnapshot> | null): void => {
      if (!partialInput) {
        testInputOverride = null;
        return;
      }
      testInputOverride = { ...partialInput };
      if (partialInput.yaw !== undefined || partialInput.pitch !== undefined) {
        const cur = input.getAngles();
        input.setAngles(partialInput.yaw ?? cur.yaw, partialInput.pitch ?? cur.pitch);
      }
    },
    switchMap: (mapId: MapId): void => {
      if (screenMode !== 'in_game') {
        screenMode = 'in_game';
        lobbyScreen.hide();
        hud.setGameplayActive(true, false);
      }
      switchOfflineMap(mapId);
    },
    toggleDebugOverlay: (): boolean => {
      return debugOverlay.toggle();
    },
  };

  loop.start();
}

void bootstrap();
