import {
  DEFAULT_KEYBINDS,
  findKeybindConflicts,
  formatKeyCodeLabel,
  KEYBIND_ACTION_META,
  type KeybindCategory,
} from '../core/Config';
import type {
  CharacterId,
  GameSettings,
  GraphicsQuality,
  KernSnapshot,
  KeybindAction,
  KeybindMap,
  LoadoutSlot,
  MapId,
  NetSimConfig,
  PlayerAbilityState,
  PlayerStance,
  RoundStateSnapshot,
  TeamId,
  TransportMode,
  Vec3,
  WeaponId,
} from '../core/types';
import { CHARACTERS, CHARACTER_LIST, TEAM_DEFS } from '../data/characters';
import { MAP_LIST } from '../data/maps';
import { getSelectedFinishes } from '../data/progression';
import {
  getAbilitySvg,
  getArmorSvg,
  getKernSvg,
  getRoleSvg,
  getWeaponSvg,
} from '../data/uiIcons';
import { WEAPONS } from '../data/weapons';

export const HUD_WEAPON_SLOTS: readonly WeaponId[] = [
  'lanze',
  'funke',
  'bolzer',
  'hornisse',
  'brecher',
  'falke',
];

const CROSSHAIR_COLORS = [
  { hex: '#18d4c9', name: 'Cyan' },
  { hex: '#ff6b2b', name: 'Bernstein' },
  { hex: '#5cff5c', name: 'Signalgrün' },
  { hex: '#ffe14d', name: 'Gelb' },
  { hex: '#ffffff', name: 'Weiß' },
];

export type NetSimPresetId = 'ideal' | 'ping100' | 'loss150' | 'relay';

export const NETSIM_PRESETS: Record<NetSimPresetId, NetSimConfig> = {
  ideal: {
    enabled: false,
    latencyMs: 0,
    jitterMs: 0,
    packetLossPct: 0,
    forceRelay: false,
  },
  ping100: {
    enabled: true,
    latencyMs: 100,
    jitterMs: 8,
    packetLossPct: 0,
    forceRelay: false,
  },
  loss150: {
    enabled: true,
    latencyMs: 150,
    jitterMs: 15,
    packetLossPct: 5,
    forceRelay: false,
  },
  relay: {
    enabled: true,
    latencyMs: 0,
    jitterMs: 0,
    packetLossPct: 0,
    forceRelay: true,
  },
};

export interface HudRosterMember {
  uid: string;
  character: CharacterId;
  alive: boolean;
  isSelf?: boolean;
}

export interface OnlineHudContext {
  roomCode: string;
  team: TeamId;
  character: CharacterId;
  onlinePlayerCount: number;
  isHost: boolean;
  transportMode: TransportMode;
  rttMs: number;
  packetLossPct?: number;
  kills: number;
  deaths: number;
  roundsToWin: number;
  aliveAttackers: number;
  totalAttackers: number;
  aliveDefenders: number;
  totalDefenders: number;
  rosterA?: ReadonlyArray<HudRosterMember>;
  rosterD?: ReadonlyArray<HudRosterMember>;
  round: RoundStateSnapshot | null;
  credits: number;
  primaryWeapon: WeaponId | null;
  secondaryWeapon: WeaponId;
  activeSlot: LoadoutSlot;
  hasKern: boolean;
  ultPoints: number;
  abilities?: PlayerAbilityState | null;
  canPlantZone: 'A' | 'B' | null;
  canDefuseKern: boolean;
  canBuyNow: boolean;
  spectateTargetName: string | null;
}

export interface HudCallbacks {
  onPlayClick: () => void;
  onSelectMap: (mapId: MapId) => void;
  onSelectWeapon: (weaponId: WeaponId) => void;
  onSelectCharacter?: (characterId: CharacterId) => void;
  onSettingsChange: (settings: GameSettings) => void;
  onReturnToLobby: () => void;
  onNetSimChange: (config: NetSimConfig) => void;
}

export interface HudFrameState {
  mapId: MapId;
  mapTitle: string;
  hp: number;
  maxHp: number;
  shield: number;
  isAlive: boolean;
  respawnRemainingSec: number;
  stance: PlayerStance;
  weaponId: WeaponId;
  ammoInMag: number;
  reserveAmmo: number;
  infiniteAmmo: boolean;
  isReloading: boolean;
  reloadProgress: number; // 0..1
  spreadDeg: number;
  isScopedFalke: boolean;
  /** Aktiver Visier-Zustand (Reflex/Holo/Präzision) für Absehen & Okular. */
  scopeView?: { type: 'none' | 'reflex' | 'holo' | 'sniper'; blend: number; zoom: number; level: number };
  pointerLocked: boolean;
  challengeActive: boolean;
  challengeHits: number;
  challengeRemaining: number;
  challengeElapsedSec: number;
  lastChallengeHits?: number;
  lastChallengeTimeSec?: number;
  characterId: CharacterId;
  credits?: number;
  abilities?: PlayerAbilityState | null;
  smokeBlindness?: number;
  fps?: number;
  tickRate?: number;
  packetLossPct?: number;
  aliveTargetsOffline?: number;
  totalTargetsOffline?: number;
  offlineTotalKills?: number;
  offlineLoadout?: {
    primaryWeapon: WeaponId | null;
    secondaryWeapon: WeaponId;
    activeSlot: LoadoutSlot;
  };
  onlineContext: OnlineHudContext | null;
}

interface FeedItem {
  el: HTMLElement;
  age: number;
  ttl: number;
}

interface DamageArcIndicator {
  el: HTMLElement;
  age: number;
  ttl: number;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

const CARTRIDGE_SVG = `<svg viewBox="0 0 14 34" width="11" height="26" fill="none" aria-hidden="true" class="hud-cartridge-svg">
  <path d="M4 2h6l2 7v21H2V9l2-7Z" fill="currentColor" fill-opacity="0.88"/>
  <rect x="1.5" y="30" width="11" height="2.5" fill="currentColor"/>
</svg>`;

export class HudOverlay {
  private readonly settings: GameSettings;
  private readonly callbacks: HudCallbacks;

  private readonly hudRoot: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private gameplayActive = false;
  private openedFromLobby = false;
  private isOnlineMatchMode = false;

  // Top micro-telemetry & badges
  private readonly microTelemetryEl: HTMLElement;
  private lastTelemetryText = '';
  private readonly mapTitleEl: HTMLElement;
  private readonly mapHintEl: HTMLElement;
  private readonly onlineBadgeEl: HTMLElement;
  private readonly transportBadgeEl: HTMLElement;
  private readonly challengeBannerEl: HTMLElement;
  private readonly offlineWeaponStripEl: HTMLElement;
  private readonly weaponChipEls = new Map<WeaponId, HTMLElement>();
  private readonly killFeedEl: HTMLElement;
  private readonly feedItems: FeedItem[] = [];

  // Top-Center Angled Symmetrical Match Header
  private readonly roundHeaderEl: HTMLElement;
  private readonly alivePipsAEl: HTMLElement;
  private readonly scoreAEl: HTMLElement;
  private readonly roundBadgeEl: HTMLElement;
  private readonly roundTimerEl: HTMLElement;
  private readonly plantedKernBadgeEl: HTMLElement;
  private readonly kernCenterIconEl: HTMLElement;
  private readonly scoreBEl: HTMLElement;
  private readonly alivePipsDEl: HTMLElement;
  private lastPipsKey = '';

  // Left Key-Hint Pills & F1 / F2 Overlays
  private readonly leftHintsColEl: HTMLElement;
  private readonly hintF1PillEl: HTMLElement;
  private readonly hintF2PillEl: HTMLElement;
  private readonly buyHintPillEl: HTMLElement;
  private readonly f1AbilityOverlayEl: HTMLElement;
  private readonly f2SpecialistOverlayEl: HTMLElement;
  private f1OverlayVisible = false;
  private f2OverlayVisible = false;
  private lastF1CharRendered: CharacterId | null = null;
  private lastF2CharRendered: CharacterId | null = null;

  // Center Kern Plant / Defuse Prompt & Native <progress> Bar
  private readonly kernActionBoxEl: HTMLElement;
  private readonly kernPromptEl: HTMLElement;
  private readonly kernProgressEl: HTMLProgressElement;
  private readonly kernCheckpointMarkEl: HTMLElement;
  private readonly kernProgressMetaEl: HTMLElement;

  // Round Transition Banner (3.5s)
  private readonly roundBannerEl: HTMLElement;
  private readonly roundBannerKickerEl: HTMLElement;
  private readonly roundBannerHeadlineEl: HTMLElement;
  private roundBannerTimer = 0;

  // Smoke Occlusion, Damage & Spectator/Respawn Banner
  private readonly smokeBlindEl: HTMLElement;
  private readonly damageVignetteEl: HTMLElement;
  private readonly damageArcRingEl: HTMLElement;
  private readonly damageArcs: DamageArcIndicator[] = [];
  private damageVignetteTimer = 0;

  private readonly respawnBannerEl: HTMLElement;
  private readonly respawnKickerEl: HTMLElement;
  private readonly respawnTimerTextEl: HTMLElement;

  // Reticle & Scope
  private readonly reticleWrapEl: HTMLElement;
  private readonly chTop: HTMLElement;
  private readonly chBottom: HTMLElement;
  private readonly chLeft: HTMLElement;
  private readonly chRight: HTMLElement;
  private readonly hitmarkerEl: HTMLElement;
  private readonly scopeOverlayEl: HTMLElement;
  private readonly sightReticleEl: HTMLElement;
  private readonly scopeZoomEl: HTMLElement;
  private readonly unlockedPromptEl: HTMLElement;

  // Bottom-Left Symmetrical Vitals
  private readonly statusPillsEl: HTMLElement;
  private lastStatusPillsKey = '';
  private readonly shieldIconEl: HTMLElement;
  private lastShieldTierKey = '';
  private readonly hpValEl: HTMLElement;
  private readonly shieldValEl: HTMLElement;
  private readonly stanceValEl: HTMLElement;

  // Bottom-Center Slim HP Bar + 4 Symmetrical Ability / Kern / Ult Slots
  private readonly hpFillEl: HTMLElement;
  private readonly shieldFillEl: HTMLElement;
  private readonly abilityBarEl: HTMLElement;
  private readonly kernCarrierPillEl: HTMLElement;
  private renderedAbilityKey = '';

  // Bottom-Right 3-Slot Weapon Silhouettes, Splitter & Symmetrical Ammo Cluster
  private readonly splitterPillEl: HTMLElement;
  private readonly loadoutSlotsEl: HTMLElement;
  private readonly slot1El: HTMLElement;
  private readonly slot2El: HTMLElement;
  private readonly slot3El: HTMLElement;
  private lastLoadoutSvgKey = '';
  private readonly weaponNameEl: HTMLElement;
  private readonly weaponCatEl: HTMLElement;
  private readonly ammoMagEl: HTMLElement;
  private readonly ammoSepEl: HTMLElement;
  private readonly ammoReserveEl: HTMLElement;
  private readonly reloadWrapEl: HTMLElement;
  private readonly reloadFillEl: HTMLElement;

  // Dialog refs
  private readonly dialogPrimaryActionsEl: HTMLElement;
  private readonly btnPlay: HTMLButtonElement;
  private readonly btnReturnLobby: HTMLButtonElement;
  private readonly offlineMapsSectionEl: HTMLElement;
  private readonly offlineSpecialistSectionEl: HTMLElement;
  private readonly offlineArsenalSectionEl: HTMLElement;
  private readonly mapBtns = new Map<MapId, HTMLButtonElement>();
  private readonly specialistBtns = new Map<CharacterId, HTMLButtonElement>();
  private readonly arsenalBtns = new Map<WeaponId, HTMLButtonElement>();
  private readonly netSimToolbarEl: HTMLElement;
  private readonly netSimButtons: HTMLButtonElement[] = [];

  // Keybindings Editor refs
  private readonly keybindsContainerEl: HTMLElement;
  private readonly keybindConflictBannerEl: HTMLElement;
  private readonly btnResetKeybinds: HTMLButtonElement;
  private readonly controlsStripEl: HTMLElement;
  private capturingKeybindAction: KeybindAction | null = null;
  private readonly keybindButtons = new Map<KeybindAction, HTMLButtonElement>();

  private hitmarkerTimer = 0;
  private hitmarkerDuration = 0.16;

  constructor(container: HTMLElement, initialSettings: GameSettings, callbacks: HudCallbacks) {
    this.settings = {
      ...initialSettings,
      crosshair: { ...initialSettings.crosshair },
      keybinds: { ...(initialSettings.keybinds ?? DEFAULT_KEYBINDS) },
    };
    this.callbacks = callbacks;

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'shard-hud';
    this.hudRoot.hidden = true;
    this.hudRoot.innerHTML = `
      <div class="hud-smoke-blind" id="hud-smoke-blind" hidden></div>
      <div class="hud-damage-vignette" id="hud-damage-vignette"></div>
      <div class="hud-damage-ring" id="hud-damage-ring"></div>

      <!-- TOP-LEFT MICRO-TELEMETRY BAR -->
      <div class="hud-micro-telemetry" id="hud-micro-telemetry" aria-hidden="true">
        CLIENT-FPS: --  |  SERVER-TICKRATE: 30 HZ  |  PAKETVERLUST: 0%
      </div>

      <header class="hud-top-bar">
        <div class="hud-top-left">
          <div class="hud-badge-row">
            <div class="hud-map-badge">
              <span class="hud-map-title" id="hud-map-title">HAFENWERK</span>
              <span class="hud-map-hint" id="hud-map-hint">[M] Karte · [ESC] Menü</span>
            </div>
            <div class="hud-transport-badge" id="hud-transport-badge" hidden></div>
          </div>
          <div class="hud-online-badge" id="hud-online-badge" hidden></div>
          <div class="hud-challenge-banner" id="hud-challenge-banner" hidden></div>
          <nav class="hud-weapon-strip" aria-label="Schnellwahl Bewaffnung" id="hud-weapon-strip"></nav>
        </div>

        <!-- SYMMETRICAL ANGLED TOP MATCH HEADER -->
        <div class="hud-round-header" id="hud-round-header">
          <div class="round-team-side is-ally">
            <div class="round-alive-pips" id="hud-pips-a" aria-label="Verbündetes Team"></div>
            <span class="round-score-num" id="hud-score-a">0</span>
          </div>

          <div class="round-center-clock">
            <span class="round-sub-badge" id="hud-round-badge">RUNDE 1 · KAUFPHASE</span>
            <span class="round-main-timer" id="hud-round-timer">1:40</span>
            <div class="round-kern-emblem" id="hud-kern-center-icon">${getKernSvg()}</div>
            <div class="round-planted-pill" id="hud-planted-pill" hidden>
              ◆ KERN AKTIV · 40.0s
            </div>
          </div>

          <div class="round-team-side is-enemy">
            <span class="round-score-num" id="hud-score-b">0</span>
            <div class="round-alive-pips" id="hud-pips-d" aria-label="Gegnerisches Team"></div>
          </div>
        </div>

        <div class="hud-kill-feed" id="hud-killfeed" aria-live="polite"></div>
      </header>

      <!-- LEFT KEY-HINT PILLS & INTERACTIVE F1 / F2 PANELS -->
      <aside class="hud-left-hints" id="hud-left-hints" aria-label="Tastenhinweise">
        <div class="hud-key-pill" id="hud-hint-f1">
          <kbd id="hud-kbd-f1">F1</kbd>
          <span>Fähigkeits-Info</span>
        </div>
        <div class="hud-key-pill" id="hud-hint-f2">
          <kbd id="hud-kbd-f2">F2</kbd>
          <span>Spezialist wechseln</span>
        </div>
        <div class="hud-key-pill is-buy" id="hud-buy-hint-pill">
          <kbd id="hud-kbd-buy">B</kbd>
          <span>Kaufmenü</span>
        </div>
      </aside>

      <aside class="hud-f1-card" id="hud-f1-overlay" hidden aria-label="Fähigkeits-Referenz"></aside>
      <aside class="hud-f2-card" id="hud-f2-overlay" hidden aria-label="Schnellwahl Spezialist"></aside>

      <div class="hud-round-banner" id="hud-round-banner" hidden role="status" aria-live="polite">
        <div class="round-banner-kicker" id="hud-round-banner-kicker">RUNDENENDE</div>
        <div class="round-banner-headline" id="hud-round-banner-headline">ANGREIFER GEWINNEN</div>
      </div>

      <div class="hud-scope-overlay" id="hud-scope-overlay" hidden>
        <div class="scope-lens">
          <div class="scope-axis-h"></div>
          <div class="scope-axis-v"></div>
          <div class="scope-mil scope-mil-h"></div>
          <div class="scope-mil scope-mil-v"></div>
          <div class="scope-center-pip"></div>
        </div>
        <div class="scope-zoom-readout" id="hud-scope-zoom">2.5×</div>
      </div>

      <div class="hud-sight-reticle" id="hud-sight-reticle" hidden>
        <div class="sight-dot"></div>
        <div class="sight-ring"></div>
      </div>

      <div class="hud-reticle-wrap" id="hud-reticle-wrap">
        <div class="crosshair-line" data-ch="top"></div>
        <div class="crosshair-line" data-ch="bottom"></div>
        <div class="crosshair-line" data-ch="left"></div>
        <div class="crosshair-line" data-ch="right"></div>
      </div>

      <div class="hud-hitmarker" id="hud-hitmarker">
        <span class="hitmarker-arm tl"></span>
        <span class="hitmarker-arm tr"></span>
        <span class="hitmarker-arm bl"></span>
        <span class="hitmarker-arm br"></span>
      </div>

      <div class="hud-kern-action-box" id="hud-kern-action-box" hidden>
        <div class="hud-kern-prompt" id="hud-kern-prompt">[4 HALTEN] KERN PLATZIEREN</div>
        <div class="hud-kern-progress-wrap" id="hud-kern-progress-wrap">
          <progress
            id="hud-kern-progress"
            class="shard-progress"
            max="1"
            value="0"
            aria-labelledby="hud-kern-prompt"
          ></progress>
          <span class="hud-defuse-checkpoint" id="hud-defuse-checkpoint" hidden title="50% Checkpoint"></span>
        </div>
        <div class="hud-kern-meta" id="hud-kern-meta"></div>
      </div>

      <div class="hud-respawn-banner" id="hud-respawn-banner" hidden>
        <div class="respawn-banner-kicker" id="hud-respawn-kicker">KAMPFUNFÄHIG</div>
        <div class="respawn-banner-main" id="hud-respawn-text">AUSGESCHALTET</div>
      </div>

      <div class="hud-unlocked-prompt" id="hud-unlocked-prompt" hidden>
        <span>Maus entsperrt · Klick ins Spielfeld zum Steuern</span>
        <button type="button" class="hud-unlocked-btn" id="btn-reopen-menu">Menü öffnen [ESC]</button>
      </div>

      <!-- BOTTOM-LEFT SYMMETRICAL VITALS (Hexagon Shield + 0/25/50 + Big 100 HP + /) -->
      <section class="hud-bottom-left" aria-label="Spielerstatus">
        <div class="hud-status-pills" id="hud-status-pills" aria-live="polite"></div>
        <div class="hud-stance-pill">
          <span class="hud-stance-caption">HALTUNG</span>
          <span class="hud-stance-value" id="hud-stance-val">STAND</span>
        </div>
        <div class="hud-vitals-sym">
          <div class="hud-shield-cluster">
            <span class="hud-shield-hex" id="hud-shield-icon">${getArmorSvg('none')}</span>
            <span class="hud-shield-value" id="hud-shield-val">0</span>
          </div>
          <span class="hud-hp-value" id="hud-hp-val">100</span>
          <span class="hud-sym-slash" aria-hidden="true">/</span>
        </div>
      </section>

      <!-- BOTTOM-CENTER SLIM HP BAR + 4 ABILITY / KERN / ULT SLOTS -->
      <section class="hud-bottom-center" aria-label="Lebensbalken und Spezialisten-Fähigkeiten">
        <div class="hud-center-bars">
          <div class="hud-center-hp-track">
            <div class="hud-bar-fill" id="hud-hp-fill"></div>
          </div>
          <div class="hud-center-shield-track">
            <div class="hud-bar-fill shield-fill" id="hud-shield-fill"></div>
          </div>
        </div>
        <div class="hud-ability-row-wrap">
          <div class="hud-ability-bar" id="hud-ability-bar"></div>
          <div class="hud-kern-slot-tile" id="hud-kern-carrier-pill" hidden>
            <span class="ability-slot-svg">${getKernSvg()}</span>
            <span class="ability-keycap" id="hud-kern-slot-keycap">4</span>
            <span class="ability-pips-row">KERN</span>
          </div>
        </div>
      </section>

      <!-- BOTTOM-RIGHT 3-SLOT WEAPON SILHOUETTES + \\ + BIG AMMO + SPLITTER -->
      <section class="hud-bottom-right" aria-label="Waffe, Inventar und Splitter">
        <div class="hud-loadout-slots" id="hud-loadout-slots" aria-label="Waffen-Inventar">
          <div class="hud-slot-silhouette" id="hud-slot-1"></div>
          <div class="hud-slot-silhouette" id="hud-slot-2"></div>
          <div class="hud-slot-silhouette" id="hud-slot-3"></div>
        </div>

        <div class="hud-reload-wrap" id="hud-reload-wrap" hidden>
          <div class="hud-reload-label">NACHLADEN...</div>
          <div class="hud-reload-track"><div class="hud-reload-fill" id="hud-reload-fill"></div></div>
        </div>

        <div class="hud-ammo-sym-row">
          <span class="hud-sym-slash is-right" aria-hidden="true">\\</span>
          <div class="hud-ammo-cluster">
            <span class="hud-ammo-mag" id="hud-ammo-mag">25</span>
            <span class="hud-ammo-sep" id="hud-ammo-sep">${CARTRIDGE_SVG}</span>
            <span class="hud-ammo-reserve" id="hud-ammo-reserve">75</span>
          </div>
          <div class="hud-economy-meta">
            <div class="hud-weapon-meta">
              <span class="hud-weapon-name" id="hud-weapon-name">LANZE</span>
              <span class="hud-weapon-cat" id="hud-weapon-cat">STURMGEWEHR</span>
            </div>
            <div class="hud-splitter-pill" id="hud-splitter-pill">◆ 800</div>
          </div>
        </div>
      </section>
    `;
    container.appendChild(this.hudRoot);

    this.offlineWeaponStripEl = this.hudRoot.querySelector('#hud-weapon-strip') as HTMLElement;
    HUD_WEAPON_SLOTS.forEach((wId, index) => {
      const stats = WEAPONS[wId];
      const chip = document.createElement('div');
      chip.className = 'hud-weapon-chip';
      chip.innerHTML = `<span class="hud-weapon-key">[${index + 1}]</span><span>${stats.name}</span>`;
      this.offlineWeaponStripEl.appendChild(chip);
      this.weaponChipEls.set(wId, chip);
    });

    this.microTelemetryEl = this.hudRoot.querySelector('#hud-micro-telemetry') as HTMLElement;
    this.mapTitleEl = this.hudRoot.querySelector('#hud-map-title') as HTMLElement;
    this.mapHintEl = this.hudRoot.querySelector('#hud-map-hint') as HTMLElement;
    this.onlineBadgeEl = this.hudRoot.querySelector('#hud-online-badge') as HTMLElement;
    this.transportBadgeEl = this.hudRoot.querySelector('#hud-transport-badge') as HTMLElement;
    this.challengeBannerEl = this.hudRoot.querySelector('#hud-challenge-banner') as HTMLElement;
    this.killFeedEl = this.hudRoot.querySelector('#hud-killfeed') as HTMLElement;

    this.roundHeaderEl = this.hudRoot.querySelector('#hud-round-header') as HTMLElement;
    this.alivePipsAEl = this.hudRoot.querySelector('#hud-pips-a') as HTMLElement;
    this.scoreAEl = this.hudRoot.querySelector('#hud-score-a') as HTMLElement;
    this.roundBadgeEl = this.hudRoot.querySelector('#hud-round-badge') as HTMLElement;
    this.roundTimerEl = this.hudRoot.querySelector('#hud-round-timer') as HTMLElement;
    this.plantedKernBadgeEl = this.hudRoot.querySelector('#hud-planted-pill') as HTMLElement;
    this.kernCenterIconEl = this.hudRoot.querySelector('#hud-kern-center-icon') as HTMLElement;
    this.scoreBEl = this.hudRoot.querySelector('#hud-score-b') as HTMLElement;
    this.alivePipsDEl = this.hudRoot.querySelector('#hud-pips-d') as HTMLElement;

    this.leftHintsColEl = this.hudRoot.querySelector('#hud-left-hints') as HTMLElement;
    this.hintF1PillEl = this.hudRoot.querySelector('#hud-hint-f1') as HTMLElement;
    this.hintF2PillEl = this.hudRoot.querySelector('#hud-hint-f2') as HTMLElement;
    this.buyHintPillEl = this.hudRoot.querySelector('#hud-buy-hint-pill') as HTMLElement;
    this.f1AbilityOverlayEl = this.hudRoot.querySelector('#hud-f1-overlay') as HTMLElement;
    this.f2SpecialistOverlayEl = this.hudRoot.querySelector('#hud-f2-overlay') as HTMLElement;

    this.kernActionBoxEl = this.hudRoot.querySelector('#hud-kern-action-box') as HTMLElement;
    this.kernPromptEl = this.hudRoot.querySelector('#hud-kern-prompt') as HTMLElement;
    this.kernProgressEl = this.hudRoot.querySelector('#hud-kern-progress') as HTMLProgressElement;
    this.kernCheckpointMarkEl = this.hudRoot.querySelector(
      '#hud-defuse-checkpoint'
    ) as HTMLElement;
    this.kernProgressMetaEl = this.hudRoot.querySelector('#hud-kern-meta') as HTMLElement;

    this.roundBannerEl = this.hudRoot.querySelector('#hud-round-banner') as HTMLElement;
    this.roundBannerKickerEl = this.hudRoot.querySelector(
      '#hud-round-banner-kicker'
    ) as HTMLElement;
    this.roundBannerHeadlineEl = this.hudRoot.querySelector(
      '#hud-round-banner-headline'
    ) as HTMLElement;

    this.smokeBlindEl = this.hudRoot.querySelector('#hud-smoke-blind') as HTMLElement;
    this.damageVignetteEl = this.hudRoot.querySelector('#hud-damage-vignette') as HTMLElement;
    this.damageArcRingEl = this.hudRoot.querySelector('#hud-damage-ring') as HTMLElement;
    this.respawnBannerEl = this.hudRoot.querySelector('#hud-respawn-banner') as HTMLElement;
    this.respawnKickerEl = this.hudRoot.querySelector('#hud-respawn-kicker') as HTMLElement;
    this.respawnTimerTextEl = this.hudRoot.querySelector('#hud-respawn-text') as HTMLElement;

    this.reticleWrapEl = this.hudRoot.querySelector('#hud-reticle-wrap') as HTMLElement;
    this.chTop = this.hudRoot.querySelector('[data-ch="top"]') as HTMLElement;
    this.chBottom = this.hudRoot.querySelector('[data-ch="bottom"]') as HTMLElement;
    this.chLeft = this.hudRoot.querySelector('[data-ch="left"]') as HTMLElement;
    this.chRight = this.hudRoot.querySelector('[data-ch="right"]') as HTMLElement;
    this.hitmarkerEl = this.hudRoot.querySelector('#hud-hitmarker') as HTMLElement;
    this.scopeOverlayEl = this.hudRoot.querySelector('#hud-scope-overlay') as HTMLElement;
    this.sightReticleEl = this.hudRoot.querySelector('#hud-sight-reticle') as HTMLElement;
    this.scopeZoomEl = this.hudRoot.querySelector('#hud-scope-zoom') as HTMLElement;
    this.unlockedPromptEl = this.hudRoot.querySelector('#hud-unlocked-prompt') as HTMLElement;

    this.statusPillsEl = this.hudRoot.querySelector('#hud-status-pills') as HTMLElement;
    this.shieldIconEl = this.hudRoot.querySelector('#hud-shield-icon') as HTMLElement;
    this.hpValEl = this.hudRoot.querySelector('#hud-hp-val') as HTMLElement;
    this.shieldValEl = this.hudRoot.querySelector('#hud-shield-val') as HTMLElement;
    this.hpFillEl = this.hudRoot.querySelector('#hud-hp-fill') as HTMLElement;
    this.shieldFillEl = this.hudRoot.querySelector('#hud-shield-fill') as HTMLElement;
    this.stanceValEl = this.hudRoot.querySelector('#hud-stance-val') as HTMLElement;
    this.abilityBarEl = this.hudRoot.querySelector('#hud-ability-bar') as HTMLElement;

    this.kernCarrierPillEl = this.hudRoot.querySelector('#hud-kern-carrier-pill') as HTMLElement;
    this.splitterPillEl = this.hudRoot.querySelector('#hud-splitter-pill') as HTMLElement;
    this.loadoutSlotsEl = this.hudRoot.querySelector('#hud-loadout-slots') as HTMLElement;
    this.slot1El = this.hudRoot.querySelector('#hud-slot-1') as HTMLElement;
    this.slot2El = this.hudRoot.querySelector('#hud-slot-2') as HTMLElement;
    this.slot3El = this.hudRoot.querySelector('#hud-slot-3') as HTMLElement;

    this.weaponNameEl = this.hudRoot.querySelector('#hud-weapon-name') as HTMLElement;
    this.weaponCatEl = this.hudRoot.querySelector('#hud-weapon-cat') as HTMLElement;
    this.ammoMagEl = this.hudRoot.querySelector('#hud-ammo-mag') as HTMLElement;
    this.ammoSepEl = this.hudRoot.querySelector('#hud-ammo-sep') as HTMLElement;
    this.ammoReserveEl = this.hudRoot.querySelector('#hud-ammo-reserve') as HTMLElement;
    this.reloadWrapEl = this.hudRoot.querySelector('#hud-reload-wrap') as HTMLElement;
    this.reloadFillEl = this.hudRoot.querySelector('#hud-reload-fill') as HTMLElement;

    // Build Native <dialog> Pause / Settings Modal
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'pause-dialog';
    this.dialog.className = 'shard-dialog';
    this.dialog.setAttribute('aria-labelledby', 'pause-dialog-title');

    const swatchesHtml = CROSSHAIR_COLORS.map(
      (c) =>
        `<button type="button" class="color-swatch-btn ${
          this.settings.crosshair.color.toLowerCase() === c.hex ? 'is-active' : ''
        }" data-ch-color="${c.hex}" style="background:${c.hex}" aria-label="Fadenkreuzfarbe ${c.name}"></button>`
    ).join('');

    this.dialog.innerHTML = `
      <div class="dialog-header">
        <div>
          <h1 class="dialog-brand-title" id="pause-dialog-title">SHARDLINE</h1>
          <p class="dialog-brand-sub">Einsatz-Menü · Einstellungen, Netcode &amp; Steuerung</p>
        </div>
        <span class="dialog-tag">SIM · 30 HZ</span>
      </div>

      <div class="dialog-body">
        <div class="dialog-primary-actions" id="dialog-primary-actions">
          <button type="button" id="btn-play" class="btn-play-primary" autofocus>
            SPIEL FORTSETZEN / STARTEN (Klick für Maus-Steuerung)
          </button>
          <button type="button" id="btn-return-lobby" class="btn-return-lobby">
            HAUPTMENÜ / LOBBY
          </button>
        </div>

        <div id="dialog-offline-maps-section">
          <h2 class="dialog-section-label">Kartenwahl (Offline-Training)</h2>
          <div class="map-select-grid" id="dialog-map-grid"></div>
        </div>

        <div id="dialog-offline-specialist-section">
          <h2 class="dialog-section-label">Spezialist wechseln (Offline-Training · [Q] / [E] / [X] sofort testen)</h2>
          <div class="offline-specialist-grid" id="dialog-specialist-row"></div>
        </div>

        <div id="dialog-offline-arsenal-section">
          <h2 class="dialog-section-label">Bewaffnung (Standard: [1] Lanze · [1] Primär / [2] Sekundär / [3] Klinge)</h2>
          <div class="arsenal-row" id="dialog-arsenal-row"></div>
        </div>

        <div class="netsim-section">
          <div class="netsim-header-row">
            <h2 class="dialog-section-label">Dev Netzwerk-Simulator (Latenz, Paketverlust &amp; Relay-Test)</h2>
            <span class="netsim-hint">[F3] Live-Telemetrie</span>
          </div>
          <div
            class="netsim-toolbar"
            id="netsim-toolbar"
            role="toolbar"
            focusgroup="toolbar wrap"
            aria-label="Netzwerk-Simulator"
          >
            <button type="button" id="btn-netsim-0" class="netsim-btn" data-netsim="ideal" aria-pressed="true">
              Ideal (0 ms)
            </button>
            <button type="button" id="btn-netsim-100" class="netsim-btn" data-netsim="ping100" aria-pressed="false">
              100 ms Ping
            </button>
            <button type="button" id="btn-netsim-loss" class="netsim-btn" data-netsim="loss150" aria-pressed="false">
              150 ms + 5% Loss
            </button>
            <button type="button" id="btn-netsim-relay" class="netsim-btn" data-netsim="relay" aria-pressed="false">
              RTDB Relay erzwingen
            </button>
          </div>
        </div>

        <div class="settings-columns">
          <div class="settings-box">
            <h2 class="dialog-section-label">Grafik</h2>
            <div class="quality-selector" id="quality-selector" role="radiogroup" aria-label="Grafikqualität">
              <button type="button" class="quality-btn" role="radio" data-quality="low">
                <span class="quality-btn-title">NIEDRIG</span>
                <span class="quality-btn-sub">Maximale FPS</span>
              </button>
              <button type="button" class="quality-btn" role="radio" data-quality="high">
                <span class="quality-btn-title">HOCH</span>
                <span class="quality-btn-sub">Standard</span>
              </button>
              <button type="button" class="quality-btn" role="radio" data-quality="max">
                <span class="quality-btn-title">MAX</span>
                <span class="quality-btn-sub">Schatten &amp; Reflexionen</span>
              </button>
            </div>
            <p class="quality-hint" id="quality-hint"></p>

            <h2 class="dialog-section-label">Steuerung &amp; Audio</h2>

            <div class="slider-field">
              <div class="slider-label-row">
                <label for="slider-sens">Mausempfindlichkeit</label>
                <span class="slider-readout" id="out-sens">${this.settings.sensitivity.toFixed(2)}</span>
              </div>
              <input type="range" id="slider-sens" class="shard-slider" min="0.10" max="3.50" step="0.05" value="${this.settings.sensitivity}" />
            </div>

            <div class="slider-field">
              <div class="slider-label-row">
                <label for="slider-fov">Sichtfeld (FOV)</label>
                <span class="slider-readout" id="out-fov">${Math.round(this.settings.fov)}°</span>
              </div>
              <input type="range" id="slider-fov" class="shard-slider" min="70" max="110" step="1" value="${Math.round(this.settings.fov)}" />
            </div>

            <div class="slider-field">
              <div class="slider-label-row">
                <label for="slider-vol">Lautstärke</label>
                <span class="slider-readout" id="out-vol">${Math.round(this.settings.volume * 100)}%</span>
              </div>
              <input type="range" id="slider-vol" class="shard-slider" min="0" max="100" step="1" value="${Math.round(this.settings.volume * 100)}" />
            </div>
          </div>

          <div class="settings-box">
            <h2 class="dialog-section-label">Fadenkreuz</h2>

            <div class="swatch-row">
              <span class="slider-label-row">Farbe</span>
              <div class="swatch-group" id="ch-swatch-group">${swatchesHtml}</div>
            </div>

            <div class="slider-field">
              <div class="slider-label-row">
                <label for="slider-ch-size">Linienlänge</label>
                <span class="slider-readout" id="out-ch-size">${this.settings.crosshair.size}px</span>
              </div>
              <input type="range" id="slider-ch-size" class="shard-slider" min="3" max="18" step="1" value="${this.settings.crosshair.size}" />
            </div>

            <div class="slider-field">
              <div class="slider-label-row">
                <label for="slider-ch-gap">Innenlücke</label>
                <span class="slider-readout" id="out-ch-gap">${this.settings.crosshair.gap}px</span>
              </div>
              <input type="range" id="slider-ch-gap" class="shard-slider" min="0" max="14" step="1" value="${this.settings.crosshair.gap}" />
            </div>

            <label class="checkbox-row" for="chk-ch-dynamic">
              <input type="checkbox" id="chk-ch-dynamic" ${this.settings.crosshair.dynamicSpread ? 'checked' : ''} />
              <span>Dynamische Streuungs-Öffnung</span>
            </label>
          </div>
        </div>

        <section class="keybinds-section" aria-labelledby="keybinds-section-title">
          <div class="keybinds-header-row">
            <div>
              <h2 class="dialog-section-label" id="keybinds-section-title">Tastenbelegung (Anpassen &amp; Konfliktprüfung)</h2>
              <p class="keybinds-sub">Klicke auf eine Taste und drücke die gewünschte neue Taste ([ESC] bricht ab). Doppelbelegungen werden automatisch bereinigt.</p>
            </div>
            <button type="button" id="btn-reset-keybinds" class="keybind-reset-btn">
              AUF STANDARD ZURÜCKSETZEN
            </button>
          </div>
          <div class="keybind-conflict-banner" id="keybind-conflict-banner" role="status" aria-live="polite"></div>
          <div class="keybinds-categories-grid" id="keybinds-container"></div>
        </section>

        <div class="controls-strip" id="dialog-controls-strip"></div>
      </div>
    `;
    container.appendChild(this.dialog);

    const specialistRow = this.dialog.querySelector('#dialog-specialist-row') as HTMLElement;
    CHARACTER_LIST.forEach((charDef) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `btn-offline-char-${charDef.id}`;
      btn.className = `specialist-select-btn ${charDef.id === 'ryo' ? 'is-selected' : ''}`;
      btn.style.setProperty('--char-accent', charDef.accentHex);
      btn.innerHTML = `
        <span class="spec-btn-top">
          <span class="spec-btn-name">${charDef.name}</span>
          <span class="spec-btn-role">${charDef.role}</span>
        </span>
        <span class="spec-btn-abilities">[Q] ${charDef.abilities.q.name} · [E] ${charDef.abilities.e.name} · [X] ${charDef.abilities.ult.name}</span>
      `;
      btn.addEventListener('click', () => {
        this.highlightCharacter(charDef.id);
        this.callbacks.onSelectCharacter?.(charDef.id);
      });
      specialistRow.appendChild(btn);
      this.specialistBtns.set(charDef.id, btn);
    });

    const arsenalRow = this.dialog.querySelector('#dialog-arsenal-row') as HTMLElement;
    HUD_WEAPON_SLOTS.forEach((wId) => {
      const stats = WEAPONS[wId];
      const slotTag = wId === 'funke' || wId === 'bolzer' ? '[Slot 2]' : '[Slot 1]';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `arsenal-btn ${wId === 'lanze' ? 'is-equipped' : ''}`;
      btn.textContent = `${slotTag} ${stats.name}`;
      btn.addEventListener('click', () => {
        this.callbacks.onSelectWeapon(wId);
        this.highlightWeapon(wId);
      });
      arsenalRow.appendChild(btn);
      this.arsenalBtns.set(wId, btn);
    });

    this.dialogPrimaryActionsEl = this.dialog.querySelector(
      '#dialog-primary-actions'
    ) as HTMLElement;
    this.btnPlay = this.dialog.querySelector('#btn-play') as HTMLButtonElement;
    this.btnReturnLobby = this.dialog.querySelector('#btn-return-lobby') as HTMLButtonElement;
    this.offlineMapsSectionEl = this.dialog.querySelector(
      '#dialog-offline-maps-section'
    ) as HTMLElement;
    this.offlineSpecialistSectionEl = this.dialog.querySelector(
      '#dialog-offline-specialist-section'
    ) as HTMLElement;
    this.offlineArsenalSectionEl = this.dialog.querySelector(
      '#dialog-offline-arsenal-section'
    ) as HTMLElement;

    const mapGridEl = this.dialog.querySelector('#dialog-map-grid') as HTMLElement;
    for (const mapDef of MAP_LIST) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = mapDef.id === 'uebungsanlage' ? 'btn-map-range' : `btn-map-${mapDef.id}`;
      btn.className = `map-card-btn ${mapDef.id === 'hafenwerk' ? 'is-selected' : ''}`;
      btn.innerHTML = `
        <span class="map-card-title">${mapDef.name}</span>
        <span class="map-card-desc">${mapDef.subtitle}</span>
      `;
      btn.addEventListener('click', () => {
        this.highlightMap(mapDef.id);
        this.callbacks.onSelectMap(mapDef.id);
      });
      mapGridEl.appendChild(btn);
      this.mapBtns.set(mapDef.id, btn);
    }

    this.netSimToolbarEl = this.dialog.querySelector('#netsim-toolbar') as HTMLElement;
    this.netSimButtons = Array.from(
      this.netSimToolbarEl.querySelectorAll<HTMLButtonElement>('.netsim-btn')
    );

    this.keybindsContainerEl = this.dialog.querySelector('#keybinds-container') as HTMLElement;
    this.keybindConflictBannerEl = this.dialog.querySelector(
      '#keybind-conflict-banner'
    ) as HTMLElement;
    this.btnResetKeybinds = this.dialog.querySelector('#btn-reset-keybinds') as HTMLButtonElement;
    this.controlsStripEl = this.dialog.querySelector('#dialog-controls-strip') as HTMLElement;

    this.buildKeybindsEditor();
    this.setupListeners();
    this.setupNetSimToolbar();
    this.updateCrosshairGeometry(0);
    this.renderAbilityBar('ryo', null, 0);
    this.syncKeybindUiLabels();
  }

  private buildKeybindsEditor(): void {
    const categories: Array<{ id: KeybindCategory; title: string }> = [
      { id: 'movement', title: 'BEWEGUNG & HALTUNG' },
      { id: 'combat', title: 'WAFFEN & VISIERUNG' },
      { id: 'abilities', title: 'FÄHIGKEITEN & KERN' },
      { id: 'menus', title: 'TAKTIK-MENÜS & ANZEIGEN' },
    ];

    this.keybindsContainerEl.innerHTML = '';
    this.keybindButtons.clear();

    for (const cat of categories) {
      const box = document.createElement('div');
      box.className = 'keybind-category-card';
      const heading = document.createElement('h3');
      heading.className = 'keybind-cat-heading';
      heading.textContent = cat.title;
      box.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'keybind-rows-list';

      const items = KEYBIND_ACTION_META.filter((m) => m.category === cat.id);
      for (const meta of items) {
        const row = document.createElement('div');
        row.className = 'keybind-row';
        row.dataset.keybindAction = meta.action;

        const copyWrap = document.createElement('div');
        copyWrap.className = 'keybind-row-copy';
        const labelEl = document.createElement('span');
        labelEl.className = 'keybind-row-label';
        labelEl.textContent = meta.label;
        const descEl = document.createElement('span');
        descEl.className = 'keybind-row-desc';
        descEl.textContent = meta.description;
        copyWrap.append(labelEl, descEl);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = `btn-keybind-${meta.action}`;
        btn.className = 'keybind-capture-btn';
        btn.dataset.keybindAction = meta.action;
        btn.addEventListener('click', () => {
          this.startKeybindCapture(meta.action);
        });

        row.append(copyWrap, btn);
        list.appendChild(row);
        this.keybindButtons.set(meta.action, btn);
      }

      box.appendChild(list);
      this.keybindsContainerEl.appendChild(box);
    }

    this.btnResetKeybinds.addEventListener('click', () => {
      this.cancelKeybindCapture();
      this.settings.keybinds = { ...DEFAULT_KEYBINDS };
      this.renderedAbilityKey = '';
      this.lastLoadoutSvgKey = '';
      this.lastF1CharRendered = null;
      this.lastF2CharRendered = null;
      this.syncKeybindUiLabels();
      this.callbacks.onSettingsChange(this.cloneSettings());
    });

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (!this.capturingKeybindAction || !this.dialog.open) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.code === 'Escape') {
          this.cancelKeybindCapture();
          return;
        }

        const targetAction = this.capturingKeybindAction;
        const newCode = e.code;
        if (!newCode) return;

        // Automatically swap if another action already uses `newCode` so zero conflicts ever occur
        const previousCode = this.settings.keybinds[targetAction];
        for (const meta of KEYBIND_ACTION_META) {
          if (meta.action !== targetAction && this.settings.keybinds[meta.action] === newCode) {
            this.settings.keybinds[meta.action] = previousCode;
          }
        }
        this.settings.keybinds[targetAction] = newCode;
        this.capturingKeybindAction = null;

        this.renderedAbilityKey = '';
        this.lastLoadoutSvgKey = '';
        this.lastF1CharRendered = null;
        this.lastF2CharRendered = null;
        this.syncKeybindUiLabels();
        this.callbacks.onSettingsChange(this.cloneSettings());
      },
      true
    );
  }

  private startKeybindCapture(action: KeybindAction): void {
    if (this.capturingKeybindAction === action) {
      this.cancelKeybindCapture();
      return;
    }
    this.capturingKeybindAction = action;
    this.syncKeybindUiLabels();
  }

  private cancelKeybindCapture(): void {
    if (!this.capturingKeybindAction) return;
    this.capturingKeybindAction = null;
    this.syncKeybindUiLabels();
  }

  private syncKeybindUiLabels(): void {
    const kb: KeybindMap = this.settings.keybinds;
    const conflicts = findKeybindConflicts(kb);
    const conflictingActions = new Set<KeybindAction>();
    for (const c of conflicts) {
      for (const a of c.actions) {
        conflictingActions.add(a);
      }
    }

    for (const [action, btn] of this.keybindButtons.entries()) {
      const isCapturing = this.capturingKeybindAction === action;
      const hasConflict = conflictingActions.has(action);
      btn.dataset.keybindCapture = isCapturing ? 'true' : 'false';
      btn.classList.toggle('is-capturing', isCapturing);
      btn.classList.toggle('is-conflict', hasConflict);
      btn.textContent = isCapturing ? 'TASTE DRÜCKEN…' : formatKeyCodeLabel(kb[action]);
    }

    if (conflicts.length === 0) {
      this.keybindConflictBannerEl.dataset.state = 'ok';
      this.keybindConflictBannerEl.textContent =
        '✓ Alle 22 Aktionen sind eindeutig belegt · Keine Tastenkonflikte.';
    } else {
      this.keybindConflictBannerEl.dataset.state = 'warn';
      const detail = conflicts
        .map((c) => `${formatKeyCodeLabel(c.code)} (${c.actions.length}×)`)
        .join(', ');
      this.keybindConflictBannerEl.textContent = `⚠ Doppelbelegung erkannt: ${detail}`;
    }

    // Update live HUD keycap pills
    const kbdF1 = this.hudRoot.querySelector('#hud-kbd-f1');
    if (kbdF1) kbdF1.textContent = formatKeyCodeLabel(kb.abilityInfo);
    const kbdF2 = this.hudRoot.querySelector('#hud-kbd-f2');
    if (kbdF2) kbdF2.textContent = formatKeyCodeLabel(kb.specialistSelect);
    const kbdBuy = this.hudRoot.querySelector('#hud-kbd-buy');
    if (kbdBuy) kbdBuy.textContent = formatKeyCodeLabel(kb.buyMenu);
    const kernKeycap = this.hudRoot.querySelector('#hud-kern-slot-keycap');
    if (kernKeycap) kernKeycap.textContent = formatKeyCodeLabel(kb.kernInteract);

    this.controlsStripEl.innerHTML = `
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.moveForward)}/${formatKeyCodeLabel(kb.moveLeft)}/${formatKeyCodeLabel(kb.moveBack)}/${formatKeyCodeLabel(kb.moveRight)}</kbd>Bewegung</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.abilityQ)} / ${formatKeyCodeLabel(kb.abilityE)} / ${formatKeyCodeLabel(kb.abilityUlt)}</kbd>Fähigkeiten</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.abilityInfo)}</kbd>Fähigkeits-Info</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.specialistSelect)}</kbd>Spezialist (Training)</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.buyMenu)}</kbd>Kaufmenü</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.slot1)}–${formatKeyCodeLabel(kb.slot3)}</kbd>Waffe / Klinge</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.kernInteract)}</kbd>Kern</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.scoreboard)}</kbd>Statistik</span>
      <span><kbd class="keycap">${formatKeyCodeLabel(kb.debugOverlay)}</kbd>Diagnose</span>
      <span><kbd class="keycap">ESC</kbd>Menü</span>
    `;
  }

  private setupListeners(): void {
    this.btnPlay.addEventListener('click', () => {
      const wasLobbySettings = this.openedFromLobby;
      this.openedFromLobby = false;
      if (this.dialog.open) {
        this.dialog.close('play');
      }
      if (wasLobbySettings || !this.gameplayActive) {
        return;
      }
      this.unlockedPromptEl.hidden = true;
      this.callbacks.onPlayClick();
    });

    this.btnReturnLobby.addEventListener('click', () => {
      this.openedFromLobby = false;
      if (this.dialog.open) {
        this.dialog.close('lobby');
      }
      this.unlockedPromptEl.hidden = true;
      this.callbacks.onReturnToLobby();
    });

    this.dialog.addEventListener('close', () => {
      this.openedFromLobby = false;
      this.dialog.returnValue = '';
    });

    this.dialog.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.dialog && this.openedFromLobby) {
        this.closeMenu();
      }
    });

    const reopenBtn = this.hudRoot.querySelector('#btn-reopen-menu') as HTMLButtonElement;
    reopenBtn.addEventListener('click', () => {
      this.openMenu();
    });

    this.setupSlider('slider-sens', 'out-sens', (val) => {
      this.settings.sensitivity = val;
      this.callbacks.onSettingsChange(this.cloneSettings());
      return val.toFixed(2);
    });

    this.setupSlider('slider-fov', 'out-fov', (val) => {
      this.settings.fov = val;
      this.callbacks.onSettingsChange(this.cloneSettings());
      return `${Math.round(val)}°`;
    });

    this.setupSlider('slider-vol', 'out-vol', (val) => {
      this.settings.volume = val / 100;
      this.callbacks.onSettingsChange(this.cloneSettings());
      return `${Math.round(val)}%`;
    });

    this.setupSlider('slider-ch-size', 'out-ch-size', (val) => {
      this.settings.crosshair.size = Math.round(val);
      this.updateCrosshairGeometry(0);
      this.callbacks.onSettingsChange(this.cloneSettings());
      return `${Math.round(val)}px`;
    });

    this.setupSlider('slider-ch-gap', 'out-ch-gap', (val) => {
      this.settings.crosshair.gap = Math.round(val);
      this.updateCrosshairGeometry(0);
      this.callbacks.onSettingsChange(this.cloneSettings());
      return `${Math.round(val)}px`;
    });

    const swatchBtns = this.dialog.querySelectorAll<HTMLButtonElement>('[data-ch-color]');
    swatchBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const hex = btn.dataset.chColor || '#18d4c9';
        this.settings.crosshair.color = hex;
        swatchBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
        this.updateCrosshairGeometry(0);
        this.callbacks.onSettingsChange(this.cloneSettings());
      });
    });

    const qualityBtns = this.dialog.querySelectorAll<HTMLButtonElement>('[data-quality]');
    const qualityHint = this.dialog.querySelector('#quality-hint') as HTMLElement;
    const QUALITY_HINTS: Record<GraphicsQuality, string> = {
      low: 'Reduzierte Auflösung, keine Reliefs und keine Deko-Details – für schwächere Geräte.',
      high: 'Detailtexturen mit Relief, volle Auflösung, alle Deko-Details.',
      max: 'Zusätzlich Echtzeit-Schatten, Himmelsreflexionen, bewegtes Wasser und kontrastreicheres Sonnenlicht.',
    };
    const syncQualityButtons = (): void => {
      qualityBtns.forEach((b) => {
        const active = b.dataset.quality === this.settings.graphics;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      qualityHint.textContent = QUALITY_HINTS[this.settings.graphics];
    };
    qualityBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.quality;
        if (q !== 'low' && q !== 'high' && q !== 'max') return;
        if (q === this.settings.graphics) return;
        this.settings.graphics = q;
        syncQualityButtons();
        this.callbacks.onSettingsChange(this.cloneSettings());
      });
    });
    syncQualityButtons();

    const chkDynamic = this.dialog.querySelector('#chk-ch-dynamic') as HTMLInputElement;
    chkDynamic.addEventListener('change', () => {
      this.settings.crosshair.dynamicSpread = chkDynamic.checked;
      this.updateCrosshairGeometry(0);
      this.callbacks.onSettingsChange(this.cloneSettings());
    });
  }

  private setupNetSimToolbar(): void {
    const supportsNativeFocusGroup =
      typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

    if (!supportsNativeFocusGroup) {
      this.netSimButtons.forEach((btn, idx) => {
        btn.tabIndex = idx === 0 ? 0 : -1;
      });
      this.netSimToolbarEl.addEventListener('keydown', (e: KeyboardEvent) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        const currentIdx = this.netSimButtons.indexOf(
          document.activeElement as HTMLButtonElement
        );
        if (currentIdx === -1) return;
        e.preventDefault();
        const len = this.netSimButtons.length;
        let nextIdx = currentIdx;
        if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % len;
        else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + len) % len;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = len - 1;

        this.netSimButtons[currentIdx].tabIndex = -1;
        this.netSimButtons[nextIdx].tabIndex = 0;
        this.netSimButtons[nextIdx].focus();
      });
    }

    for (const btn of this.netSimButtons) {
      btn.addEventListener('click', () => {
        const presetId = (btn.dataset.netsim as NetSimPresetId | undefined) ?? 'ideal';
        const cfg = { ...NETSIM_PRESETS[presetId] };
        this.setActiveNetSimButton(btn);
        this.callbacks.onNetSimChange(cfg);
      });
    }
  }

  private setActiveNetSimButton(activeBtn: HTMLButtonElement | null): void {
    const supportsNativeFocusGroup =
      typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

    for (const btn of this.netSimButtons) {
      const isPressed = btn === activeBtn;
      btn.setAttribute('aria-pressed', isPressed ? 'true' : 'false');
      if (!supportsNativeFocusGroup) {
        btn.tabIndex = isPressed ? 0 : -1;
      }
    }
    if (!activeBtn && !supportsNativeFocusGroup && this.netSimButtons.length > 0) {
      this.netSimButtons[0].tabIndex = 0;
    }
  }

  public syncNetSimToolbar(cfg: NetSimConfig): void {
    let matchedId: NetSimPresetId | null = null;
    if (!cfg.enabled && !cfg.forceRelay) {
      matchedId = 'ideal';
    } else if (cfg.forceRelay) {
      matchedId = 'relay';
    } else if (cfg.packetLossPct >= 4 && cfg.latencyMs >= 120) {
      matchedId = 'loss150';
    } else if (cfg.latencyMs >= 80 && cfg.packetLossPct === 0) {
      matchedId = 'ping100';
    }

    const matchedBtn = matchedId
      ? this.netSimButtons.find((b) => b.dataset.netsim === matchedId) ?? null
      : null;
    this.setActiveNetSimButton(matchedBtn);
  }

  private setupSlider(
    sliderId: string,
    readoutId: string,
    onValue: (val: number) => string
  ): void {
    const slider = this.dialog.querySelector(`#${sliderId}`) as HTMLInputElement;
    const readout = this.dialog.querySelector(`#${readoutId}`) as HTMLElement;

    const syncCssVars = (formattedText?: string): void => {
      slider.style.setProperty('--attr-min', slider.min || '0');
      slider.style.setProperty('--attr-max', slider.max || '100');
      slider.style.setProperty('--control-value', slider.value);
      if (formattedText) {
        slider.setAttribute('aria-valuetext', formattedText);
      }
    };

    syncCssVars(readout.textContent || slider.value);
    slider.addEventListener('input', () => {
      const numeric = Number(slider.value);
      const formatted = onValue(numeric);
      readout.textContent = formatted;
      syncCssVars(formatted);
    });
  }

  private cloneSettings(): GameSettings {
    return {
      ...this.settings,
      crosshair: { ...this.settings.crosshair },
    };
  }

  public setGameplayActive(active: boolean, isOnlineMatch = false): void {
    this.gameplayActive = active;
    this.isOnlineMatchMode = isOnlineMatch;
    this.openedFromLobby = false;
    this.hudRoot.hidden = !active;
    this.offlineMapsSectionEl.hidden = isOnlineMatch;
    this.offlineSpecialistSectionEl.hidden = isOnlineMatch;
    this.offlineArsenalSectionEl.hidden = isOnlineMatch;
    this.offlineWeaponStripEl.hidden = isOnlineMatch;
    this.hintF2PillEl.hidden = isOnlineMatch;

    this.btnPlay.textContent = 'SPIEL FORTSETZEN / STARTEN (Klick für Maus-Steuerung)';
    this.btnReturnLobby.hidden = false;
    this.btnReturnLobby.textContent = isOnlineMatch
      ? 'ZURÜCK ZUR LOBBY / RAUM VERLASSEN'
      : 'HAUPTMENÜ / LOBBY';
    this.mapHintEl.textContent = isOnlineMatch
      ? '[B] Kaufmenü · [F1] Info · [ESC] Menü'
      : '[M] Karte · [F1] Info · [F2] Spezialist · [ESC]';

    if (!active) {
      this.closeMenu();
      this.f1OverlayVisible = false;
      this.f2OverlayVisible = false;
      this.f1AbilityOverlayEl.hidden = true;
      this.f2SpecialistOverlayEl.hidden = true;
      this.unlockedPromptEl.hidden = true;
      this.respawnBannerEl.hidden = true;
      this.transportBadgeEl.hidden = true;
      this.kernActionBoxEl.hidden = true;
      this.roundBannerEl.hidden = true;
      this.kernCarrierPillEl.hidden = true;
      this.smokeBlindEl.hidden = true;
      this.statusPillsEl.innerHTML = '';
      this.lastStatusPillsKey = '';
      this.roundBannerTimer = 0;
      this.clearDamageIndicators();
    }
  }

  /**
   * Opens the native `<dialog id="pause-dialog">` settings modal directly from the Client Lobby (`⚙` button).
   */
  public openLobbySettings(): void {
    this.openedFromLobby = true;
    this.offlineMapsSectionEl.hidden = true;
    this.offlineSpecialistSectionEl.hidden = true;
    this.offlineArsenalSectionEl.hidden = true;
    this.btnReturnLobby.hidden = true;
    this.btnPlay.textContent = 'EINSTELLUNGEN SCHLIESSEN';
    void this.dialogPrimaryActionsEl;
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
  }

  public openMenu(): void {
    if (!this.gameplayActive) return;
    this.openedFromLobby = false;
    this.offlineMapsSectionEl.hidden = this.isOnlineMatchMode;
    this.offlineSpecialistSectionEl.hidden = this.isOnlineMatchMode;
    this.offlineArsenalSectionEl.hidden = this.isOnlineMatchMode;
    this.btnReturnLobby.hidden = false;
    this.btnPlay.textContent = 'SPIEL FORTSETZEN / STARTEN (Klick für Maus-Steuerung)';
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
    this.unlockedPromptEl.hidden = true;
  }

  public closeMenu(): void {
    this.openedFromLobby = false;
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  public isMenuOpen(): boolean {
    return this.dialog.open;
  }

  public toggleAbilityInfoOverlay(): boolean {
    if (!this.gameplayActive) return false;
    this.f1OverlayVisible = !this.f1OverlayVisible;
    if (this.f1OverlayVisible) {
      this.f2OverlayVisible = false;
      this.f2SpecialistOverlayEl.hidden = true;
      this.hintF2PillEl.classList.remove('is-active');
    }
    this.f1AbilityOverlayEl.hidden = !this.f1OverlayVisible;
    this.hintF1PillEl.classList.toggle('is-active', this.f1OverlayVisible);
    this.lastF1CharRendered = null;
    return this.f1OverlayVisible;
  }

  public toggleOfflineSpecialistOverlay(): boolean {
    if (!this.gameplayActive || this.isOnlineMatchMode) return false;
    this.f2OverlayVisible = !this.f2OverlayVisible;
    if (this.f2OverlayVisible) {
      this.f1OverlayVisible = false;
      this.f1AbilityOverlayEl.hidden = true;
      this.hintF1PillEl.classList.remove('is-active');
    }
    this.f2SpecialistOverlayEl.hidden = !this.f2OverlayVisible;
    this.hintF2PillEl.classList.toggle('is-active', this.f2OverlayVisible);
    this.lastF2CharRendered = null;
    return this.f2OverlayVisible;
  }

  public isOfflineSpecialistOverlayOpen(): boolean {
    return this.f2OverlayVisible;
  }

  public closeOfflineSpecialistOverlay(): void {
    this.f2OverlayVisible = false;
    this.f2SpecialistOverlayEl.hidden = true;
    this.hintF2PillEl.classList.remove('is-active');
  }

  public onPointerLockChanged(locked: boolean): void {
    if (!this.gameplayActive) return;
    if (locked) {
      this.closeMenu();
      this.unlockedPromptEl.hidden = true;
    } else {
      this.openMenu();
    }
  }

  public highlightMap(mapId: MapId): void {
    for (const [id, btn] of this.mapBtns.entries()) {
      btn.classList.toggle('is-selected', id === mapId);
    }
  }

  public highlightWeapon(weaponId: WeaponId): void {
    for (const [id, chip] of this.weaponChipEls.entries()) {
      chip.classList.toggle('is-active', id === weaponId);
    }
    for (const [id, btn] of this.arsenalBtns.entries()) {
      btn.classList.toggle('is-equipped', id === weaponId);
    }
  }

  public highlightCharacter(characterId: CharacterId): void {
    for (const [id, btn] of this.specialistBtns.entries()) {
      btn.classList.toggle('is-selected', id === characterId);
    }
  }

  public showRoundBanner(
    kicker: string,
    headline: string,
    tone: 'a' | 'd' | 'neutral' = 'neutral',
    durationSec = 3.5
  ): void {
    this.roundBannerKickerEl.textContent = kicker;
    this.roundBannerHeadlineEl.textContent = headline;
    this.roundBannerEl.dataset.tone = tone;
    this.roundBannerEl.hidden = false;
    this.roundBannerEl.style.opacity = '1';
    this.roundBannerTimer = durationSec;
  }

  public triggerHitmarker(zone: 'head' | 'body', killed: boolean): void {
    this.hitmarkerDuration = killed ? 0.24 : 0.14;
    this.hitmarkerTimer = this.hitmarkerDuration;
    const isFiery = zone === 'head' || killed;
    this.hitmarkerEl.style.setProperty('--hm-color', isFiery ? '#ff5e1f' : '#ffffff');
    const scale = killed ? 1.25 : zone === 'head' ? 1.12 : 1.0;
    this.hitmarkerEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
    this.hitmarkerEl.style.opacity = '1';
  }

  public triggerDamageIndicator(
    attackerPos?: Vec3,
    listenerPos?: Vec3,
    listenerYaw?: number
  ): void {
    this.damageVignetteTimer = 0.42;
    this.damageVignetteEl.style.opacity = '1';

    if (attackerPos && listenerPos && listenerYaw !== undefined) {
      const dx = attackerPos.x - listenerPos.x;
      const dz = attackerPos.z - listenerPos.z;
      if (Math.hypot(dx, dz) > 0.05) {
        const fx = -Math.sin(listenerYaw);
        const fz = -Math.cos(listenerYaw);
        const rx = Math.cos(listenerYaw);
        const rz = -Math.sin(listenerYaw);
        const forwardComp = dx * fx + dz * fz;
        const rightComp = dx * rx + dz * rz;
        const angleDeg = (Math.atan2(rightComp, forwardComp) * 180) / Math.PI;

        const arc = document.createElement('div');
        arc.className = 'hud-damage-arc';
        arc.style.setProperty('--arc-deg', `${angleDeg.toFixed(1)}deg`);
        this.damageArcRingEl.appendChild(arc);
        this.damageArcs.push({ el: arc, age: 0, ttl: 0.78 });

        while (this.damageArcs.length > 5) {
          const oldest = this.damageArcs.shift();
          oldest?.el.remove();
        }
      }
    }
  }

  private clearDamageIndicators(): void {
    this.damageVignetteTimer = 0;
    this.damageVignetteEl.style.opacity = '0';
    for (const arc of this.damageArcs) {
      arc.el.remove();
    }
    this.damageArcs.length = 0;
  }

  public pushEliminationFeed(zone: 'head' | 'body', damage: number): void {
    const entry = document.createElement('div');
    const isHead = zone === 'head';
    entry.className = `hud-feed-entry ${isHead ? 'is-headshot' : ''}`;
    const zoneLabel = isHead ? 'Kopftreffer' : 'Körpertreffer';
    entry.textContent = `Ziel ausgeschaltet · ${zoneLabel} (${Math.round(damage)})`;
    this.prependFeedEntry(entry, 3.6);
  }

  public pushPvpKillFeed(
    killerName: string,
    killerTeam: TeamId,
    victimName: string,
    victimTeam: TeamId,
    weaponLabelOrId: WeaponId | 'knife',
    isHeadshot: boolean
  ): void {
    const entry = document.createElement('div');
    entry.className = `hud-feed-entry is-pvp ${isHeadshot ? 'is-headshot' : ''}`;

    const killerSpan = document.createElement('span');
    killerSpan.className = 'killfeed-name';
    killerSpan.dataset.team = killerTeam;
    killerSpan.textContent = killerName;

    const weaponSpan = document.createElement('span');
    weaponSpan.className = 'killfeed-weapon';
    const wName =
      weaponLabelOrId === 'knife'
        ? 'KLINGE'
        : WEAPONS[weaponLabelOrId]?.name.toUpperCase() ?? weaponLabelOrId.toUpperCase();
    weaponSpan.textContent = `[${wName}${isHeadshot ? ' · KOPF' : ''}]`;

    const victimSpan = document.createElement('span');
    victimSpan.className = 'killfeed-name';
    victimSpan.dataset.team = victimTeam;
    victimSpan.textContent = victimName;

    entry.append(killerSpan, weaponSpan, victimSpan);
    this.prependFeedEntry(entry, 5.0);
  }

  private prependFeedEntry(entry: HTMLElement, ttl: number): void {
    this.killFeedEl.prepend(entry);
    this.feedItems.unshift({ el: entry, age: 0, ttl });

    while (this.feedItems.length > 5) {
      const oldest = this.feedItems.pop();
      oldest?.el.remove();
    }
  }

  private renderAbilityBar(
    characterId: CharacterId,
    abilities: PlayerAbilityState | null | undefined,
    fallbackUltPoints: number
  ): void {
    const c = CHARACTERS[characterId] ?? CHARACTERS.ryo;
    const qMax = abilities?.qMax ?? c.abilities.q.maxCharges ?? 1;
    const qCharges = abilities ? abilities.qCharges : qMax;
    const eMax = abilities?.eMax ?? c.abilities.e.maxCharges ?? 1;
    const eCharges = abilities ? abilities.eCharges : eMax;
    const ultMax = abilities?.ultMax ?? c.abilities.ult.ultPoints ?? 7;
    const ultPts = Math.min(
      ultMax,
      Math.max(0, abilities ? abilities.ultPoints : fallbackUltPoints)
    );
    const ultReady = ultPts >= ultMax;

    const key = `${characterId}:${qCharges}/${qMax}:${eCharges}/${eMax}:${ultPts}/${ultMax}`;
    if (this.renderedAbilityKey === key) return;
    this.renderedAbilityKey = key;

    const buildDots = (filled: number, total: number): string => {
      const n = Math.max(1, Math.min(6, total));
      const f = Math.max(0, Math.min(n, filled));
      const spans: string[] = [];
      for (let i = 0; i < n; i += 1) {
        spans.push(`<span class="ab-charge-dot ${i < f ? 'is-on' : ''}"></span>`);
      }
      return spans.join('');
    };

    const buildDiamondPips = (filled: number, total: number): string => {
      const n = Math.max(1, Math.min(8, total));
      const f = Math.max(0, Math.min(n, filled));
      const pips: string[] = [];
      for (let i = 0; i < n; i += 1) {
        pips.push(`<span class="ab-ult-diamond ${i < f ? 'is-on' : ''}">${i < f ? '◆' : '◇'}</span>`);
      }
      return pips.join('');
    };

    this.abilityBarEl.style.setProperty('--char-accent', c.accentHex);
    this.abilityBarEl.innerHTML = `
      <div class="hud-ability-slot ${qCharges <= 0 ? 'is-empty' : ''}" data-slot="q" title="[Q] ${c.abilities.q.name}">
        <span class="ability-slot-svg">${getAbilitySvg(c.id, 'q')}</span>
        <span class="ability-keycap">Q</span>
        <div class="ability-pips-row">${buildDots(qCharges, qMax)}</div>
      </div>

      <div class="hud-ability-slot ${eCharges <= 0 ? 'is-empty' : ''}" data-slot="e" title="[E] ${c.abilities.e.name}">
        <span class="ability-slot-svg">${getAbilitySvg(c.id, 'e')}</span>
        <span class="ability-keycap">E</span>
        <div class="ability-pips-row">${buildDots(eCharges, eMax)}</div>
      </div>

      <div class="hud-ability-slot is-ult ${ultReady ? 'is-ult-ready' : ''}" data-slot="x" title="[X] ${c.abilities.ult.name}">
        <span class="ability-slot-svg">${getAbilitySvg(c.id, 'ult')}</span>
        <span class="ability-keycap">${ultReady ? 'X · BEREIT' : 'X'}</span>
        <div class="ability-pips-row is-diamonds">${buildDiamondPips(ultPts, ultMax)}</div>
      </div>
    `;
  }

  private renderF1AndF2Overlays(characterId: CharacterId): void {
    if (this.f1OverlayVisible && this.lastF1CharRendered !== characterId) {
      this.lastF1CharRendered = characterId;
      const c = CHARACTERS[characterId] ?? CHARACTERS.ryo;
      this.f1AbilityOverlayEl.innerHTML = `
        <div class="f1-header" style="--char-accent: ${c.accentHex}">
          <span class="f1-role-icon">${getRoleSvg(c.role)}</span>
          <div>
            <div class="f1-title">${c.name.toUpperCase()}</div>
            <div class="f1-sub">${c.role.toUpperCase()} · [F1] SCHLIESSEN</div>
          </div>
        </div>
        <div class="f1-ab-list">
          <div class="f1-ab-row">
            <span class="f1-ab-icon">${getAbilitySvg(c.id, 'q')}</span>
            <div>
              <strong>[Q] ${c.abilities.q.name}</strong>
              <span>${c.abilities.q.summary}</span>
            </div>
          </div>
          <div class="f1-ab-row">
            <span class="f1-ab-icon">${getAbilitySvg(c.id, 'e')}</span>
            <div>
              <strong>[E] ${c.abilities.e.name}</strong>
              <span>${c.abilities.e.summary}</span>
            </div>
          </div>
          <div class="f1-ab-row">
            <span class="f1-ab-icon">${getAbilitySvg(c.id, 'ult')}</span>
            <div>
              <strong>[X] ${c.abilities.ult.name} (${c.abilities.ult.ultPoints ?? 7} Pkt.)</strong>
              <span>${c.abilities.ult.summary}</span>
            </div>
          </div>
        </div>
      `;
    }

    if (this.f2OverlayVisible && this.lastF2CharRendered !== characterId) {
      this.lastF2CharRendered = characterId;
      this.f2SpecialistOverlayEl.innerHTML = `
        <div class="f2-header">
          <span>SPEZIALIST WECHSELN (TASTEN 1–4 ODER KLICK)</span>
          <kbd>F2</kbd>
        </div>
        <div class="f2-grid">
          ${CHARACTER_LIST.map(
            (c, idx) => `
              <button
                type="button"
                class="f2-char-btn ${c.id === characterId ? 'is-selected' : ''}"
                data-f2-char="${c.id}"
                style="--char-accent: ${c.accentHex}"
              >
                <span class="f2-key">[${idx + 1}]</span>
                <span class="f2-icon">${getRoleSvg(c.role)}</span>
                <span class="f2-name">${c.name}</span>
              </button>
            `
          ).join('')}
        </div>
      `;

      this.f2SpecialistOverlayEl
        .querySelectorAll<HTMLButtonElement>('[data-f2-char]')
        .forEach((btn) => {
          btn.addEventListener('click', () => {
            const cid = btn.dataset.f2Char as CharacterId;
            if (cid && CHARACTERS[cid]) {
              this.highlightCharacter(cid);
              this.callbacks.onSelectCharacter?.(cid);
              this.closeOfflineSpecialistOverlay();
            }
          });
        });
    }
  }

  private renderStatusPills(
    abilities: PlayerAbilityState | null | undefined,
    isAlive: boolean
  ): void {
    if (!abilities || !isAlive) {
      if (this.lastStatusPillsKey !== '') {
        this.statusPillsEl.innerHTML = '';
        this.lastStatusPillsKey = '';
      }
      return;
    }

    const pills: Array<{ tone: string; label: string }> = [];
    if (abilities.activeBuff === 'adrenalin' && abilities.buffRemainingSec > 0.05) {
      pills.push({
        tone: 'cyan',
        label: `ADRENALIN ${abilities.buffRemainingSec.toFixed(1)}s`,
      });
    } else if (abilities.activeBuff === 'ueberlast' && abilities.buffRemainingSec > 0.05) {
      pills.push({
        tone: 'amber',
        label: `ÜBERLAST ${abilities.buffRemainingSec.toFixed(1)}s`,
      });
    }

    if (abilities.bastionProtected) {
      pills.push({ tone: 'teal', label: 'BOLLWERK -50%' });
    }
    if (abilities.slowedSec > 0.05) {
      pills.push({
        tone: 'warn',
        label: `VERLANGSAMT -40% (${abilities.slowedSec.toFixed(1)}s)`,
      });
    }
    if (abilities.revealedSec > 0.05) {
      pills.push({ tone: 'alert', label: 'AUFGEKLÄRT!' });
    }

    const key = pills.map((p) => `${p.tone}:${p.label}`).join('|');
    if (this.lastStatusPillsKey === key) return;
    this.lastStatusPillsKey = key;

    this.statusPillsEl.innerHTML = pills
      .map((p) => `<span class="hud-status-pill" data-tone="${p.tone}">${p.label}</span>`)
      .join('');
  }

  private renderSymmetricalRosterHeader(
    allyRoster: ReadonlyArray<HudRosterMember>,
    enemyRoster: ReadonlyArray<HudRosterMember>
  ): void {
    const serialize = (list: ReadonlyArray<HudRosterMember>): string =>
      list.map((m) => `${m.character}:${m.alive ? 1 : 0}:${m.isSelf ? 1 : 0}`).join(',');
    const key = `${serialize(allyRoster)}|${serialize(enemyRoster)}`;
    if (this.lastPipsKey === key) return;
    this.lastPipsKey = key;

    const renderSide = (
      parent: HTMLElement,
      members: ReadonlyArray<HudRosterMember>,
      side: 'ally' | 'enemy'
    ): void => {
      parent.innerHTML = members
        .slice(0, 5)
        .map((m) => {
          const c = CHARACTERS[m.character] ?? CHARACTERS.ryo;
          return `
            <span
              class="round-spec-pip is-${side} ${m.alive ? 'is-alive' : 'is-dead'} ${m.isSelf ? 'is-self' : ''}"
              title="${c.name}"
            >
              ${getRoleSvg(c.role)}
            </span>
          `;
        })
        .join('');
    };

    renderSide(this.alivePipsAEl, allyRoster, 'ally');
    renderSide(this.alivePipsDEl, enemyRoster, 'enemy');
  }

  private updateRoundAndKernHud(ctx: OnlineHudContext, isAlive: boolean): void {
    const r = ctx.round;
    if (!r) {
      this.roundHeaderEl.hidden = true;
      this.kernActionBoxEl.hidden = true;
      return;
    }

    this.roundHeaderEl.hidden = false;

    const allyIsA = ctx.team === 'A';
    const allyScore = allyIsA ? r.scoreA : r.scoreB;
    const enemyScore = allyIsA ? r.scoreB : r.scoreA;
    this.scoreAEl.textContent = `${allyScore}`;
    this.scoreBEl.textContent = `${enemyScore}`;

    const buildFallbackRoster = (
      alive: number,
      total: number,
      defaultChar: CharacterId
    ): HudRosterMember[] => {
      const count = Math.max(1, Math.min(5, total));
      const arr: HudRosterMember[] = [];
      for (let i = 0; i < count; i += 1) {
        arr.push({
          uid: `slot_${i}`,
          character: CHARACTER_LIST[(i + (defaultChar === 'ryo' ? 0 : 1)) % CHARACTER_LIST.length].id,
          alive: i < alive,
          isSelf: i === 0,
        });
      }
      return arr;
    };

    const rawA =
      ctx.rosterA && ctx.rosterA.length > 0
        ? ctx.rosterA
        : buildFallbackRoster(ctx.aliveAttackers, ctx.totalAttackers, ctx.character);
    const rawD =
      ctx.rosterD && ctx.rosterD.length > 0
        ? ctx.rosterD
        : buildFallbackRoster(ctx.aliveDefenders, ctx.totalDefenders, 'tessa');

    const allyRoster = allyIsA ? rawA : rawD;
    const enemyRoster = allyIsA ? rawD : rawA;
    this.renderSymmetricalRosterHeader(allyRoster, enemyRoster);

    const phaseLabel =
      r.phase === 'buy'
        ? 'KAUFPHASE'
        : r.phase === 'action'
          ? 'EINSATZ'
          : r.phase === 'planted'
            ? 'KERN SCHARF'
            : r.phase === 'post_round'
              ? 'RUNDENENDE'
              : 'MATCH BEENDET';

    if (r.isSuddenDeath) {
      this.roundBadgeEl.textContent = `SUDDEN DEATH · RUNDE ${r.roundNumber}`;
      this.roundBadgeEl.dataset.special = 'sd';
    } else {
      this.roundBadgeEl.textContent = `RUNDE ${r.roundNumber} · ${phaseLabel}`;
      delete this.roundBadgeEl.dataset.special;
    }

    const kern: KernSnapshot = r.kern;
    if (r.phase === 'planted') {
      this.roundTimerEl.hidden = true;
      this.kernCenterIconEl.hidden = true;
      this.plantedKernBadgeEl.hidden = false;
      const zoneStr = kern.plantedZone ? `ZONE ${kern.plantedZone}` : 'ZONE';
      this.plantedKernBadgeEl.textContent = `◆ KERN (${zoneStr}) · ${Math.max(
        0,
        kern.fuseRemainingSec
      ).toFixed(1)}s`;
      this.plantedKernBadgeEl.dataset.urgent = kern.fuseRemainingSec <= 10 ? 'true' : 'false';
    } else {
      this.roundTimerEl.hidden = false;
      this.kernCenterIconEl.hidden = false;
      this.plantedKernBadgeEl.hidden = true;
      this.roundTimerEl.textContent = formatClock(r.phaseRemainingSec);
      this.roundTimerEl.dataset.phase = r.phase;
    }

    // Center Kern Plant / Defuse Action Box + Native <progress>
    const isLocalPlanting = kern.status === 'planting' && isAlive;
    const isLocalDefusing = kern.status === 'defusing' && isAlive;

    if (isLocalPlanting) {
      this.kernActionBoxEl.hidden = false;
      this.kernActionBoxEl.dataset.mode = 'plant';
      const zoneName = kern.plantedZone ?? ctx.canPlantZone ?? 'A';
      this.kernPromptEl.textContent = `KERN WIRD PLATZIERT (ZONE ${zoneName})…`;
      this.kernProgressEl.value = Math.max(0, Math.min(1, kern.progress01));
      this.kernCheckpointMarkEl.hidden = true;
      const remSec = Math.max(0, (1 - kern.progress01) * 4.0);
      this.kernProgressMetaEl.textContent = `${remSec.toFixed(1)} s verbleibend`;
    } else if (isLocalDefusing) {
      this.kernActionBoxEl.hidden = false;
      this.kernActionBoxEl.dataset.mode = 'defuse';
      this.kernPromptEl.textContent = 'KERN WIRD ENTSCHÄRFT…';
      this.kernProgressEl.value = Math.max(0, Math.min(1, kern.progress01));
      this.kernCheckpointMarkEl.hidden = false;
      this.kernCheckpointMarkEl.dataset.reached = kern.halfDefused ? 'true' : 'false';
      const remSec = Math.max(0, (1 - kern.progress01) * 7.0);
      this.kernProgressMetaEl.textContent = kern.halfDefused
        ? `50% CHECKPOINT GESICHERT · ${remSec.toFixed(1)} s`
        : `${remSec.toFixed(1)} s · Checkpoint bei 3.5 s`;
    } else if (isAlive && ctx.hasKern && ctx.canPlantZone && r.phase === 'action') {
      this.kernActionBoxEl.hidden = false;
      this.kernActionBoxEl.dataset.mode = 'prompt-plant';
      this.kernPromptEl.textContent = `[4 / E HALTEN] KERN PLATZIEREN (ZONE ${ctx.canPlantZone})`;
      this.kernProgressEl.value = 0;
      this.kernCheckpointMarkEl.hidden = true;
      this.kernProgressMetaEl.textContent = '4.0 s Kanalisierung';
    } else if (isAlive && ctx.canDefuseKern && r.phase === 'planted') {
      this.kernActionBoxEl.hidden = false;
      this.kernActionBoxEl.dataset.mode = 'prompt-defuse';
      this.kernPromptEl.textContent = '[4 / E HALTEN] KERN ENTSCHÄRFEN';
      this.kernProgressEl.value = kern.halfDefused ? 0.5 : 0;
      this.kernCheckpointMarkEl.hidden = false;
      this.kernCheckpointMarkEl.dataset.reached = kern.halfDefused ? 'true' : 'false';
      this.kernProgressMetaEl.textContent = kern.halfDefused
        ? 'Ab 50% Checkpoint fortsetzen (3.5 s)'
        : '7.0 s Gesamt · 50% Checkpoint bei 3.5 s';
    } else {
      this.kernActionBoxEl.hidden = true;
    }
  }

  private renderLoadoutSilhouettes(
    primaryWeapon: WeaponId | null,
    secondaryWeapon: WeaponId,
    activeSlot: LoadoutSlot
  ): void {
    const finishes = getSelectedFinishes();
    const priFin = primaryWeapon ? finishes[primaryWeapon] : 'standard';
    const secFin = finishes[secondaryWeapon] ?? 'standard';
    const knifeFin = finishes.knife ?? 'standard';

    const key = `${primaryWeapon ?? 'none'}:${priFin}|${secondaryWeapon}:${secFin}|knife:${knifeFin}|slot:${activeSlot}`;
    if (this.lastLoadoutSvgKey === key) return;
    this.lastLoadoutSvgKey = key;

    if (primaryWeapon) {
      this.slot1El.innerHTML = `
        <span class="slot-sil-svg">${getWeaponSvg(primaryWeapon, priFin)}</span>
        <span class="slot-sil-meta"><kbd>1</kbd> ${WEAPONS[primaryWeapon].name.toUpperCase()}</span>
      `;
    } else {
      this.slot1El.innerHTML = `
        <span class="slot-sil-empty">KEINE PRIMÄRWAFFE</span>
        <span class="slot-sil-meta"><kbd>1</kbd> LEER</span>
      `;
    }

    this.slot2El.innerHTML = `
      <span class="slot-sil-svg is-sidearm">${getWeaponSvg(secondaryWeapon, secFin)}</span>
      <span class="slot-sil-meta"><kbd>2</kbd> ${WEAPONS[secondaryWeapon].name.toUpperCase()}</span>
    `;

    this.slot3El.innerHTML = `
      <span class="slot-sil-svg is-knife">${getWeaponSvg('knife', knifeFin)}</span>
      <span class="slot-sil-meta"><kbd>3</kbd> TAKTIK-KLINGE</span>
    `;

    this.slot1El.classList.toggle('is-active', activeSlot === 1);
    this.slot1El.classList.toggle('is-empty', primaryWeapon === null);
    this.slot2El.classList.toggle('is-active', activeSlot === 2);
    this.slot3El.classList.toggle('is-active', activeSlot === 3);
  }

  private updateCrosshairGeometry(spreadDeg: number): void {
    const { color, size, thickness, gap, dynamicSpread } = this.settings.crosshair;
    const bloomPx = dynamicSpread ? Math.min(34, spreadDeg * 5.2) : 0;
    const effGap = Math.round(gap + bloomPx);
    const halfThick = thickness / 2;

    this.reticleWrapEl.style.setProperty('--ch-color', color);

    this.chTop.style.width = `${thickness}px`;
    this.chTop.style.height = `${size}px`;
    this.chTop.style.left = `${-halfThick}px`;
    this.chTop.style.top = `${-effGap - size}px`;

    this.chBottom.style.width = `${thickness}px`;
    this.chBottom.style.height = `${size}px`;
    this.chBottom.style.left = `${-halfThick}px`;
    this.chBottom.style.top = `${effGap}px`;

    this.chLeft.style.width = `${size}px`;
    this.chLeft.style.height = `${thickness}px`;
    this.chLeft.style.left = `${-effGap - size}px`;
    this.chLeft.style.top = `${-halfThick}px`;

    this.chRight.style.width = `${size}px`;
    this.chRight.style.height = `${thickness}px`;
    this.chRight.style.left = `${effGap}px`;
    this.chRight.style.top = `${-halfThick}px`;
  }

  public update(state: HudFrameState, frameDt: number): void {
    if (!this.gameplayActive) return;

    // 1. Top-Left Micro-Telemetry Line (`Client-FPS | Server-Tickrate | Paketverlust`)
    const fpsVal = Math.max(0, Math.round(state.fps ?? 60));
    const tickVal = state.tickRate ?? 30;
    const lossVal = Math.max(
      0,
      Math.round((state.packetLossPct ?? state.onlineContext?.packetLossPct ?? 0) * 10) / 10
    );
    const pingPart = state.onlineContext
      ? `  |  PING: ${Math.max(0, Math.round(state.onlineContext.rttMs))} MS`
      : '';
    const telemetryStr = `CLIENT-FPS: ${fpsVal}  |  SERVER-TICKRATE: ${tickVal} HZ  |  PAKETVERLUST: ${lossVal}%${pingPart}`;
    if (telemetryStr !== this.lastTelemetryText) {
      this.lastTelemetryText = telemetryStr;
      this.microTelemetryEl.textContent = telemetryStr;
    }

    this.mapTitleEl.textContent = state.mapTitle;
    this.highlightMap(state.mapId);
    this.highlightWeapon(state.weaponId);
    this.highlightCharacter(state.characterId);

    const effectiveAbilities = state.abilities ?? state.onlineContext?.abilities ?? null;
    const ultPts = effectiveAbilities?.ultPoints ?? state.onlineContext?.ultPoints ?? 0;
    this.renderAbilityBar(state.characterId, effectiveAbilities, ultPts);
    this.renderStatusPills(effectiveAbilities, state.isAlive);
    this.renderF1AndF2Overlays(state.characterId);

    // Symmetric full-screen smoke blindness vignette
    const smokeDensity = Math.max(0, Math.min(1, state.smokeBlindness ?? 0));
    if (smokeDensity > 0.01) {
      this.smokeBlindEl.hidden = false;
      this.smokeBlindEl.style.opacity = (0.95 * smokeDensity).toFixed(2);
    } else {
      this.smokeBlindEl.hidden = true;
    }

    // Round transition banner decay
    if (this.roundBannerTimer > 0) {
      this.roundBannerTimer = Math.max(0, this.roundBannerTimer - frameDt);
      if (this.roundBannerTimer <= 0) {
        this.roundBannerEl.hidden = true;
      } else if (this.roundBannerTimer < 0.45) {
        this.roundBannerEl.style.opacity = (this.roundBannerTimer / 0.45).toFixed(2);
      }
    }

    // Online Room vs Offline Training HUD
    if (state.onlineContext) {
      const ctx = state.onlineContext;
      const teamDef = TEAM_DEFS[ctx.team];
      const charDef = CHARACTERS[ctx.character] ?? CHARACTERS.ryo;
      this.onlineBadgeEl.hidden = false;
      this.onlineBadgeEl.dataset.team = ctx.team;
      this.onlineBadgeEl.textContent = `RAUM ${ctx.roomCode} · ${teamDef.name.toUpperCase()} · ${charDef.name.toUpperCase()} · K/T ${ctx.kills}/${ctx.deaths}`;

      this.transportBadgeEl.hidden = false;
      const rttRounded = Math.max(0, Math.round(ctx.rttMs));
      if (ctx.transportMode === 'relay') {
        this.transportBadgeEl.dataset.mode = 'relay';
        this.transportBadgeEl.textContent =
          rttRounded > 0
            ? `RELAY (10 HZ) · ${rttRounded} MS`
            : 'RELAY (10 HZ)';
      } else if (ctx.isHost) {
        this.transportBadgeEl.dataset.mode = 'p2p';
        this.transportBadgeEl.textContent =
          ctx.transportMode === 'p2p'
            ? `WEBRTC HOST · ${rttRounded} MS`
            : 'HOST · 0 MS';
      } else if (ctx.transportMode === 'p2p' || ctx.transportMode === 'loopback') {
        this.transportBadgeEl.dataset.mode = 'p2p';
        this.transportBadgeEl.textContent = `WEBRTC P2P · ${rttRounded} MS`;
      } else if (ctx.transportMode === 'connecting') {
        this.transportBadgeEl.dataset.mode = 'connecting';
        this.transportBadgeEl.textContent = 'VERBINDET...';
      } else {
        this.transportBadgeEl.dataset.mode = 'disconnected';
        this.transportBadgeEl.textContent = 'GETRENNT';
      }

      this.updateRoundAndKernHud(ctx, state.isAlive);

      const inBuyPhase = ctx.round?.phase === 'buy';
      this.leftHintsColEl.hidden = !(inBuyPhase || this.f1OverlayVisible);
      this.buyHintPillEl.dataset.active = ctx.canBuyNow ? 'true' : 'false';
      const buySpan = this.buyHintPillEl.querySelector('span');
      if (buySpan) {
        buySpan.textContent = ctx.canBuyNow ? 'Kaufmenü aktiv' : 'Kaufmenü';
      }

      this.splitterPillEl.textContent = `◆ ${Math.round(ctx.credits).toLocaleString('de-DE')}`;
      this.kernCarrierPillEl.hidden = !ctx.hasKern;

      this.renderLoadoutSilhouettes(
        ctx.primaryWeapon,
        ctx.secondaryWeapon,
        ctx.activeSlot
      );
    } else {
      // Offline / Übungsanlage Symmetrical Tactical Header & 3-Slot Silhouettes
      this.onlineBadgeEl.hidden = true;
      this.transportBadgeEl.hidden = true;
      this.kernActionBoxEl.hidden = true;
      this.kernCarrierPillEl.hidden = true;
      this.leftHintsColEl.hidden = false;
      this.buyHintPillEl.dataset.active = 'true';
      const buySpan = this.buyHintPillEl.querySelector('span');
      if (buySpan) {
        buySpan.textContent = 'Arsenal / Menü';
      }

      this.roundHeaderEl.hidden = false;
      this.plantedKernBadgeEl.hidden = true;
      this.roundTimerEl.hidden = false;
      this.kernCenterIconEl.hidden = false;

      const aliveBots = state.aliveTargetsOffline ?? 0;
      const totalBots = Math.max(1, Math.min(5, state.totalTargetsOffline ?? 5));
      this.scoreAEl.textContent = `${state.offlineTotalKills ?? 0}`;
      this.scoreBEl.textContent = `${aliveBots}`;

      if (state.challengeActive) {
        this.roundBadgeEl.textContent = `30-ZIEL-TEST · ${state.challengeHits}/30`;
        this.roundTimerEl.textContent = `${state.challengeElapsedSec.toFixed(1)}s`;
      } else {
        this.roundBadgeEl.textContent = `${state.mapTitle.toUpperCase()} · TRAINING`;
        this.roundTimerEl.textContent = '∞';
      }

      const offlineAlly: HudRosterMember[] = [
        { uid: 'self', character: state.characterId, alive: true, isSelf: true },
      ];
      const offlineBots: HudRosterMember[] = [];
      for (let i = 0; i < totalBots; i += 1) {
        offlineBots.push({
          uid: `bot_${i}`,
          character: CHARACTER_LIST[i % CHARACTER_LIST.length].id,
          alive: i < aliveBots,
        });
      }
      this.renderSymmetricalRosterHeader(offlineAlly, offlineBots);

      this.splitterPillEl.textContent = `◆ ${Math.round(state.credits ?? 800).toLocaleString('de-DE')}`;

      const isSidearm = state.weaponId === 'funke' || state.weaponId === 'bolzer';
      const priOffline: WeaponId | null = isSidearm ? 'lanze' : state.weaponId;
      const secOffline: WeaponId = isSidearm ? state.weaponId : 'funke';
      const slotOffline: LoadoutSlot = isSidearm ? 2 : 1;
      this.renderLoadoutSilhouettes(priOffline, secOffline, slotOffline);
    }

    // Spectator / Eliminated Banner
    if (!state.isAlive) {
      this.respawnBannerEl.hidden = false;
      const specName = state.onlineContext?.spectateTargetName ?? null;
      if (specName) {
        this.respawnKickerEl.textContent = 'ZUSCHAUERMODUS';
        this.respawnTimerTextEl.textContent = `${specName} · [MAUSKLICK ZUM WECHSELN]`;
      } else if (state.respawnRemainingSec > 0.05) {
        this.respawnKickerEl.textContent = 'KAMPFUNFÄHIG';
        const secStr = Math.max(0, state.respawnRemainingSec).toFixed(1);
        this.respawnTimerTextEl.textContent = `AUSGESCHALTET · WIEDEREINSTIEG IN ${secStr}s`;
      } else {
        this.respawnKickerEl.textContent = 'RUNDE LÄUFT';
        this.respawnTimerTextEl.textContent = 'AUSGESCHALTET · WARTE AUF NÄCHSTE RUNDE';
      }
    } else {
      this.respawnBannerEl.hidden = true;
    }

    this.unlockedPromptEl.hidden = state.pointerLocked || this.dialog.open;

    // Range challenge pill
    if (state.mapId === 'uebungsanlage' && state.challengeActive) {
      this.challengeBannerEl.hidden = false;
      this.challengeBannerEl.textContent = `30-ZIEL-TEST: ${state.challengeHits}/30 · ${state.challengeElapsedSec.toFixed(1)}s`;
    } else if (
      state.mapId === 'uebungsanlage' &&
      state.lastChallengeTimeSec !== undefined &&
      state.lastChallengeTimeSec > 0
    ) {
      this.challengeBannerEl.hidden = false;
      this.challengeBannerEl.textContent = `LETZTER LAUF: ${state.lastChallengeHits ?? 0}/30 · ${state.lastChallengeTimeSec.toFixed(1)}s`;
    } else {
      this.challengeBannerEl.hidden = true;
    }

    // Scope vs normal crosshair
    if (!state.isAlive && !state.onlineContext?.spectateTargetName) {
      this.scopeOverlayEl.hidden = true;
      this.sightReticleEl.hidden = true;
      this.reticleWrapEl.hidden = true;
    } else {
      const scopeType = state.scopeView?.type ?? (state.isScopedFalke ? 'sniper' : 'none');
      const sniper = scopeType === 'sniper';
      const openSight = scopeType === 'reflex' || scopeType === 'holo';
      this.scopeOverlayEl.hidden = !sniper;
      this.sightReticleEl.hidden = !openSight;
      this.reticleWrapEl.hidden = sniper || openSight;
      if (sniper) {
        const zoomText = `${(state.scopeView?.zoom ?? 2.5).toFixed(1)}×`;
        if (this.scopeZoomEl.textContent !== zoomText) this.scopeZoomEl.textContent = zoomText;
      } else if (openSight) {
        this.sightReticleEl.dataset.kind = scopeType;
        this.sightReticleEl.style.opacity = Math.min(1, (state.scopeView?.blend ?? 1) * 1.4).toFixed(2);
      } else {
        this.updateCrosshairGeometry(state.spreadDeg);
      }
    }

    // Hitmarker decay
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - frameDt);
      const opacity = this.hitmarkerTimer / this.hitmarkerDuration;
      this.hitmarkerEl.style.opacity = opacity.toFixed(2);
    }

    // Damage vignette & directional arc decay
    if (this.damageVignetteTimer > 0) {
      this.damageVignetteTimer = Math.max(0, this.damageVignetteTimer - frameDt);
      this.damageVignetteEl.style.opacity = (this.damageVignetteTimer / 0.42).toFixed(2);
    }
    for (let i = this.damageArcs.length - 1; i >= 0; i -= 1) {
      const arc = this.damageArcs[i];
      arc.age += frameDt;
      if (arc.age >= arc.ttl) {
        arc.el.remove();
        this.damageArcs.splice(i, 1);
      } else {
        const alpha = 1 - arc.age / arc.ttl;
        arc.el.style.opacity = alpha.toFixed(2);
      }
    }

    // Killfeed decay
    for (let i = this.feedItems.length - 1; i >= 0; i -= 1) {
      const item = this.feedItems[i];
      item.age += frameDt;
      if (item.age >= item.ttl) {
        item.el.remove();
        this.feedItems.splice(i, 1);
      } else if (item.ttl - item.age < 0.45) {
        item.el.style.opacity = ((item.ttl - item.age) / 0.45).toFixed(2);
      }
    }

    // Symmetrical Bottom-Left Vitals & Bottom-Center HP Bar
    const hpClamped = Math.max(0, Math.round(state.hp));
    const shieldClamped = Math.max(0, Math.round(state.shield));
    const shieldTier: 'none' | 'light' | 'heavy' =
      shieldClamped > 25 ? 'heavy' : shieldClamped > 0 ? 'light' : 'none';
    if (this.lastShieldTierKey !== shieldTier) {
      this.lastShieldTierKey = shieldTier;
      this.shieldIconEl.innerHTML = getArmorSvg(shieldTier);
      this.shieldIconEl.dataset.tier = shieldTier;
    }

    this.hpValEl.textContent = `${hpClamped}`;
    this.hpValEl.classList.toggle('is-critical', state.isAlive && hpClamped <= 30);
    this.shieldValEl.textContent = `${shieldClamped}`;
    this.hpFillEl.style.width = `${Math.max(0, Math.min(100, (hpClamped / Math.max(1, state.maxHp)) * 100))}%`;
    this.hpFillEl.classList.toggle('is-critical', state.isAlive && hpClamped <= 30);
    this.shieldFillEl.style.width = `${Math.max(0, Math.min(100, (shieldClamped / 50) * 100))}%`;

    const stanceMap: Record<PlayerStance, string> = {
      stand: 'STAND',
      walk: 'GEHEN',
      crouch: 'DUCKEN',
      air: 'SPRUNG',
    };
    this.stanceValEl.textContent = state.isAlive
      ? (stanceMap[state.stance] ?? 'STAND')
      : 'ZUSCHAUER';

    // Symmetrical Bottom-Right Weapon & Ammo Cluster
    const isKnifeEquipped = state.onlineContext?.activeSlot === 3;
    if (isKnifeEquipped) {
      this.weaponNameEl.textContent = 'TAKTIK-KLINGE';
      this.weaponCatEl.textContent = 'NAHKAMPF · +TEMPO';
      this.ammoMagEl.textContent = '—';
      this.ammoMagEl.classList.remove('is-low');
      this.ammoSepEl.hidden = true;
      this.ammoReserveEl.textContent = '';
      this.reloadWrapEl.hidden = true;
    } else {
      const wStats = WEAPONS[state.weaponId];
      this.weaponNameEl.textContent = wStats.name.toUpperCase();
      this.weaponCatEl.textContent = wStats.category.toUpperCase();
      this.ammoMagEl.textContent = `${state.ammoInMag}`;
      this.ammoMagEl.classList.toggle(
        'is-low',
        state.ammoInMag <= Math.max(2, Math.floor(wStats.magSize * 0.25))
      );
      this.ammoSepEl.hidden = false;
      this.ammoReserveEl.textContent = state.infiniteAmmo ? '∞' : `${state.reserveAmmo}`;

      if (state.isReloading && state.isAlive) {
        this.reloadWrapEl.hidden = false;
        this.reloadFillEl.style.width = `${Math.max(0, Math.min(100, state.reloadProgress * 100))}%`;
      } else {
        this.reloadWrapEl.hidden = true;
      }
    }
  }
}
