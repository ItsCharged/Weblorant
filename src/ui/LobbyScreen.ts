import {
  type CharacterId,
  isValidMapId,
  type LobbyPlayer,
  type MapId,
  type RoomMatchSummary,
  type RoomSettings,
  type RoomStatus,
  type TeamId,
} from '../core/types';
import { CHARACTER_LIST, CHARACTERS, DEFAULT_CHARACTER_ID, type RoleArchetype, TEAM_DEFS } from '../data/characters';
import { getMapDefinition, MAP_LIST } from '../data/maps';
import {
  type ArsenalWeaponId,
  getCareerSummary,
  getMatchHistory,
  getObjectivesOverview,
  getSelectedFinishes,
  setWeaponFinish,
  WEAPON_FINISHES,
  type WeaponFinishId,
} from '../data/progression';
import {
  getAbilitySvg,
  getCharacterPortraitSvg,
  getKernSvg,
  getRoleSvg,
  getWeaponSvg,
} from '../data/uiIcons';
import { WEAPONS } from '../data/weapons';

export interface LobbyRoomView {
  code: string;
  hostUid: string;
  isHost: boolean;
  status: RoomStatus;
  settings: RoomSettings;
  players: LobbyPlayer[];
  match: RoomMatchSummary | null;
}

export interface LobbyScreenCallbacks {
  onPlayerNameChange: (name: string) => void;
  onCreateRoom: (playerName: string) => Promise<void>;
  onJoinRoom: (roomCode: string, playerName: string) => Promise<void>;
  onLeaveRoom: () => Promise<void>;
  onSelectTeam: (team: TeamId) => Promise<void>;
  onSelectCharacter: (character: CharacterId) => Promise<void>;
  onToggleReady: (nextReady: boolean) => Promise<void>;
  onUpdateSettings: (partial: Partial<RoomSettings>) => Promise<void>;
  onStartMatch: () => Promise<void>;
  onStartOffline: (mapId: MapId) => void;
  /** Automatische Warteschlange (lokale Gruppen + Web, latenzoptimiert). */
  onFindMatch?: (playerName: string, teamSize: number) => Promise<void>;
  onCancelQueue?: () => Promise<void>;
  onOpenSettings?: () => void;
  onOfflineCharacterChange?: (character: CharacterId) => void;
}

type ClientTabId = 'play' | 'objectives' | 'specialists' | 'history' | 'arsenal';
type SpecialistSubTabId = 'info' | 'q' | 'e' | 'ult';
type RoleFilterId = 'all' | RoleArchetype;

const CLIENT_TABS: readonly { id: ClientTabId; label: string; isPlayPrimary?: boolean }[] = [
  { id: 'play', label: 'SPIELEN', isPlayPrimary: true },
  { id: 'objectives', label: 'EINSATZZIELE' },
  { id: 'specialists', label: 'SPEZIALISTEN' },
  { id: 'history', label: 'VERLAUF' },
  { id: 'arsenal', label: 'ARSENAL' },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimestampShort(ms: number): string {
  try {
    const d = new Date(ms);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${month}. · ${hh}:${mm}`;
  } catch {
    return 'Heute';
  }
}

export class LobbyScreen {
  private readonly root: HTMLElement;
  private readonly callbacks: LobbyScreenCallbacks;

  private activeView: 'landing' | 'lobby' = 'landing';
  private activeTab: ClientTabId = 'play';
  private visible = true;
  private localUid: string | null = null;
  private currentRoom: LobbyRoomView | null = null;
  private busy = false;

  // Solo / showcase state
  private soloCharacter: CharacterId = DEFAULT_CHARACTER_ID;
  private soloPreviewMapId: MapId = 'hafenwerk';
  private showcaseCharacter: CharacterId = DEFAULT_CHARACTER_ID;
  private showcaseRoleFilter: RoleFilterId = 'all';
  private showcaseSubTab: SpecialistSubTabId = 'info';
  private selectedArsenalWeapon: ArsenalWeaponId = 'lanze';

  // Topbar & navigation refs
  private readonly tabButtons = new Map<ClientTabId, HTMLButtonElement>();
  private readonly tabPanels = new Map<ClientTabId, HTMLElement>();
  private readonly authBadgeEl: HTMLElement;
  private readonly topRankBadgeEl: HTMLElement;
  private readonly btnLobbySettings: HTMLButtonElement;
  private readonly noticeBannerEl: HTMLElement;
  private readonly noticeTextEl: HTMLElement;

  // Mode drawer refs
  private readonly modeDrawer: HTMLDialogElement;
  private readonly btnOpenModeDrawer: HTMLButtonElement;
  private readonly btnCloseModeDrawer: HTMLButtonElement;
  private readonly modeCardTitleEl: HTMLElement;
  private readonly modeCardSubEl: HTMLElement;
  private readonly modeCardMapBadgeEl: HTMLElement;

  // Play tab: Sub-menu navigation & preserved controls
  private playActiveSubView: 'match' | 'room' | 'training' = 'match';
  private readonly playSubNavBtns = new Map<'match' | 'room' | 'training', HTMLButtonElement>();
  private readonly playSubViews = new Map<'match' | 'room' | 'training', HTMLElement>();
  private readonly soloJoinBlockEl: HTMLElement;
  private readonly roomActiveBlockEl: HTMLElement;
  private readonly inputPlayerName: HTMLInputElement;
  private readonly inputRoomCode: HTMLInputElement;
  private readonly btnCreateRoom: HTMLButtonElement;
  private readonly btnFindMatch: HTMLButtonElement;
  private queueSearching = false;
  private readonly btnJoinRoom: HTMLButtonElement;
  private readonly btnQuickRange: HTMLButtonElement;
  private readonly offlineMapBtns = new Map<MapId, HTMLButtonElement>();
  private readonly landingErrorEl: HTMLElement;

  // Room controls
  private readonly roomCodeEl: HTMLElement;
  private readonly btnCopyCode: HTMLButtonElement;
  private readonly copyTipEl: HTMLElement;
  private readonly hostSettingsWrapEl: HTMLElement;
  private readonly guestSettingsWrapEl: HTMLElement;
  private readonly selectTeamSize: HTMLSelectElement;
  private readonly selectRoundsWin: HTMLSelectElement;
  private readonly selectRoomMap: HTMLSelectElement;
  private readonly guestSettingsTextEl: HTMLElement;
  private readonly btnLeaveRoom: HTMLButtonElement;
  private readonly roomErrorEl: HTMLElement;

  private readonly teamACountEl: HTMLElement;
  private readonly teamDCountEl: HTMLElement;
  private readonly teamASlotsEl: HTMLElement;
  private readonly teamDSlotsEl: HTMLElement;
  private readonly btnTeamA: HTMLButtonElement;
  private readonly btnTeamD: HTMLButtonElement;

  private readonly charCardBtns = new Map<CharacterId, HTMLButtonElement>();
  private readonly partyBannersWrapEl: HTMLElement;
  private readonly footerStatusHintEl: HTMLElement;
  private readonly btnToggleReady: HTMLButtonElement;
  private readonly btnStartMatch: HTMLButtonElement;

  // Right squad rail
  private readonly squadRailListEl: HTMLElement;
  private readonly squadRailSummaryEl: HTMLElement;

  // Secondary tab dynamic containers
  private readonly objectivesPanelContentEl: HTMLElement;
  private readonly specialistsPanelContentEl: HTMLElement;
  private readonly historyPanelContentEl: HTMLElement;
  private readonly arsenalPanelContentEl: HTMLElement;

  // Copy feedback state (per modern-web-guidance `copy-button`)
  private copyTimer: number | null = null;
  private lastCopyAnnouncement = '';

  constructor(container: HTMLElement, initialName: string, callbacks: LobbyScreenCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.id = 'lobby-screen';
    this.root.className = 'shard-lobby-overlay';

    const offlineOrderedMaps = [
      getMapDefinition('uebungsanlage'),
      ...MAP_LIST.filter((m) => m.id !== 'uebungsanlage'),
    ];
    const offlineDrawerButtonsHtml = offlineOrderedMaps
      .map((m) => {
        const btnId = m.id === 'uebungsanlage' ? 'btn-offline-range' : `btn-offline-${m.id}`;
        const title =
          m.id === 'uebungsanlage' ? 'Übungsanlage · Schießstand' : `${m.name} · Offline-Erkundung`;
        return `
          <button type="button" id="${btnId}" data-offline-map="${m.id}" class="drawer-mode-tile">
            <span class="drawer-tile-kicker">${m.id === 'uebungsanlage' ? 'PRÄZISION & SPRAY-WALL' : 'TAKTIK-KARTE SOLO'}</span>
            <span class="drawer-tile-title">${escapeHtml(title)}</span>
            <span class="drawer-tile-sub">${escapeHtml(m.subtitle)}</span>
          </button>
        `;
      })
      .join('');

    const roomMapOptionsHtml = MAP_LIST.map(
      (m) =>
        `<option value="${m.id}" ${m.id === 'hafenwerk' ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');

    const quickCharButtonsHtml = CHARACTER_LIST.map(
      (c) => `
        <button
          type="button"
          id="char-${c.id}"
          class="lobby-char-chip"
          data-char-id="${c.id}"
          style="--char-accent: ${c.accentHex}"
          aria-pressed="${c.id === this.soloCharacter ? 'true' : 'false'}"
        >
          <span class="char-chip-role-icon">${getRoleSvg(c.role)}</span>
          <span class="char-chip-text">
            <span class="char-chip-name">${escapeHtml(c.name)}</span>
            <span class="char-chip-role">${escapeHtml(c.role)}</span>
          </span>
        </button>
      `
    ).join('');

    const navTabsHtml = CLIENT_TABS.map((tab, idx) => {
      const selected = idx === 0;
      const tabIcon =
        tab.id === 'play'
          ? `<span class="nav-play-diamond" aria-hidden="true">${getKernSvg()}</span>`
          : '';
      return `
        <button
          type="button"
          role="tab"
          id="client-tab-${tab.id}"
          class="client-nav-tab ${tab.isPlayPrimary ? 'is-play-emblem' : ''}"
          aria-controls="client-panel-${tab.id}"
          aria-selected="${selected ? 'true' : 'false'}"
          tabindex="${selected ? '0' : '-1'}"
          data-client-tab="${tab.id}"
        >
          ${tabIcon}
          <span class="client-nav-tab-label">${tab.label}</span>
        </button>
      `;
    }).join('');

    this.root.innerHTML = `
      <div class="client-shell">
        <header class="client-topbar">
          <div class="client-brand">
            <span class="lobby-brand-mark" aria-hidden="true"></span>
            <div class="client-brand-copy">
              <span class="lobby-brand-title">SHARDLINE</span>
              <span class="lobby-brand-subtitle">TAKTIK-CLIENT</span>
            </div>
          </div>

          <div
            class="client-tablist"
            role="tablist"
            focusgroup="tablist nomemory"
            aria-label="Hauptnavigation"
          >
            ${navTabsHtml}
          </div>

          <div class="client-topbar-right">
            <div class="client-rank-pill" id="lobby-top-rank" title="Taktische Einsatz-Stufe">
              <span class="rank-diamond" aria-hidden="true">◆</span>
              <span class="rank-pill-label">SPLITTER-RANG I</span>
            </div>
            <div class="lobby-auth-badge" id="lobby-auth-badge" data-state="connecting">
              Verbinde...
            </div>
            <button
              type="button"
              id="btn-lobby-settings"
              class="client-gear-btn"
              aria-label="Einstellungen öffnen"
              title="Einstellungen &amp; Steuerung"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="3.4" stroke="currentColor" stroke-width="2"/>
                <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9" stroke="currentColor" stroke-width="2" stroke-linecap="square"/>
              </svg>
            </button>
          </div>
        </header>

        <div class="lobby-notice-banner" id="lobby-notice" role="alert" hidden>
          <span id="lobby-notice-text"></span>
          <button type="button" class="lobby-notice-close" id="btn-dismiss-notice" aria-label="Hinweis schließen">✕</button>
        </div>

        <div class="client-main-grid">
          <div class="client-panels-stage">
            <!-- TAB 1: SPIELEN (5-BANNER GRUPPEN-HUB) -->
            <section
              role="tabpanel"
              id="client-panel-play"
              aria-labelledby="client-tab-play"
              class="client-tabpanel"
            >
              <div class="client-panel-inner is-play-layout">
                <aside class="play-left-column" aria-label="Modus, Rufzeichen und Raumsteuerung">
                  <!-- Taktische Einsatz-Zentrale Header & Sub-Navigation -->
                  <div class="play-subnav-bar" role="tablist" aria-label="Einsatz-Bereiche">
                    <button
                      type="button"
                      role="tab"
                      id="play-subtab-match"
                      class="play-subnav-btn is-active"
                      aria-selected="true"
                      aria-controls="play-subview-match"
                      data-play-subview="match"
                    >
                      <span class="subnav-kicker">// 01</span>
                      <span class="subnav-title">MATCH</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="play-subtab-room"
                      class="play-subnav-btn"
                      aria-selected="false"
                      aria-controls="play-subview-room"
                      data-play-subview="room"
                    >
                      <span class="subnav-kicker">// 02</span>
                      <span class="subnav-title">TRUPP &amp; RAUM</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="play-subtab-training"
                      class="play-subnav-btn"
                      aria-selected="false"
                      aria-controls="play-subview-training"
                      data-play-subview="training"
                    >
                      <span class="subnav-kicker">// 03</span>
                      <span class="subnav-title">TRAINING</span>
                    </button>
                  </div>

                  <!-- SUB-VIEW 1: MATCH & SCHNELLSTART -->
                  <div class="play-subview-panel" id="play-subview-match" role="tabpanel" aria-labelledby="play-subtab-match">
                    <div class="tactical-section-head">
                      <span class="tactical-section-kicker">// 01 EINSATZZENTRALE</span>
                      <h3 class="tactical-section-title">MODUS &amp; SCHNELLSTART</h3>
                    </div>

                    <button
                      type="button"
                      id="btn-open-mode-drawer"
                      class="play-mode-card"
                      aria-haspopup="dialog"
                      aria-controls="lobby-mode-drawer"
                    >
                      <div class="play-mode-card-top">
                        <span class="play-mode-kicker">EINSATZ-MODUS</span>
                        <span class="play-mode-map-tag" id="play-mode-map-badge">HAFENWERK</span>
                      </div>
                      <div class="play-mode-title" id="play-mode-card-title">KERNBRUCH · ONLINE</div>
                      <div class="play-mode-sub" id="play-mode-card-sub">3v3 · 7 Sieg-Runden · Modus &amp; Karte wählen ▸</div>
                    </button>

                    <div class="play-side-card">
                      <div class="lobby-field">
                        <div class="lobby-label-row">
                          <label for="input-player-name">Rufzeichen</label>
                          <span id="player-name-hint" class="lobby-field-hint">1–16 Zeichen</span>
                        </div>
                        <input
                          type="text"
                          id="input-player-name"
                          class="lobby-text-input"
                          maxlength="16"
                          minlength="1"
                          required
                          autocomplete="nickname"
                          spellcheck="false"
                          aria-invalid="false"
                          aria-describedby="player-name-hint"
                          data-error="player-name-error"
                          placeholder="Agent"
                        />
                        <div id="player-name-error" class="lobby-field-error">
                          Bitte Rufzeichen mit 1–16 Zeichen eingeben.
                        </div>
                      </div>
                    </div>

                    <!-- SPEZIALISTEN SCHNELLWAHL -->
                    <div class="play-side-card" aria-label="Spezialisten-Schnellwahl">
                      <div class="play-side-heading">AKTIVER SPEZIALIST</div>
                      <div class="play-char-chip-grid">
                        ${quickCharButtonsHtml}
                      </div>
                    </div>
                  </div>

                  <!-- SUB-VIEW 2: TRUPP & RAUM -->
                  <div class="play-subview-panel" id="play-subview-room" role="tabpanel" aria-labelledby="play-subtab-room" hidden>
                    <div class="tactical-section-head">
                      <span class="tactical-section-kicker">// 02 TRUPP &amp; RAUM</span>
                      <h3 class="tactical-section-title">LOBBY &amp; RAUMVERWALTUNG</h3>
                    </div>

                    <!-- SOLO RAUMCODE BEITRITT -->
                    <div class="play-side-card" id="lobby-solo-join-block">
                      <form id="form-join-room" class="lobby-join-form" novalidate>
                        <div class="lobby-field">
                          <div class="lobby-label-row">
                            <label for="input-room-code">Raumcode beitreten</label>
                            <span id="room-code-hint" class="lobby-field-hint">5 Zeichen</span>
                          </div>
                          <div class="lobby-join-row">
                            <input
                              type="text"
                              id="input-room-code"
                              class="lobby-text-input is-code"
                              maxlength="5"
                              minlength="5"
                              pattern="[A-HJ-NP-Z2-9]{5}"
                              autocomplete="off"
                              spellcheck="false"
                              aria-invalid="false"
                              aria-describedby="room-code-hint"
                              data-error="room-code-error"
                              placeholder="K7M4P"
                            />
                            <button type="submit" id="btn-join-room" class="lobby-cta-btn is-cyan is-compact">
                              BEITRETEN
                            </button>
                          </div>
                          <div id="room-code-error" class="lobby-field-error">
                            5-stelliger Code (ohne O, I, 0, 1).
                          </div>
                        </div>
                      </form>
                      <div class="lobby-inline-error" id="lobby-error" role="alert" hidden></div>
                    </div>

                    <!-- AKTIVER ONLINE-RAUM BLOCK -->
                    <div class="play-side-card is-room-active" id="lobby-room-active-block" hidden>
                      <div class="room-code-strip">
                        <div>
                          <span class="room-code-caption">RAUMCODE</span>
                          <code class="room-code-value" id="lobby-room-code">-----</code>
                        </div>
                        <span class="copy-wrap">
                          <button
                            type="button"
                            id="btn-copy-code"
                            class="room-copy-btn"
                            command="--copy"
                            commandfor="lobby-room-code"
                          >
                            KOPIEREN
                          </button>
                          <span class="copy-tip" id="copy-code-tip" role="status"></span>
                        </span>
                      </div>

                      <div class="room-teams-compact">
                        <div class="room-team-mini is-a">
                          <div class="room-team-mini-head">
                            <span class="team-badge is-a">ANGREIFER</span>
                            <span class="team-count" id="team-a-count">0 / 3</span>
                            <button type="button" id="btn-team-a" class="team-switch-btn is-a">BEITRETEN</button>
                          </div>
                          <div class="team-slots-list is-compact" id="team-a-slots"></div>
                        </div>

                        <div class="room-team-mini is-d">
                          <div class="room-team-mini-head">
                            <span class="team-badge is-d">VERTEIDIGER</span>
                            <span class="team-count" id="team-d-count">0 / 3</span>
                            <button type="button" id="btn-team-d" class="team-switch-btn is-d">BEITRETEN</button>
                          </div>
                          <div class="team-slots-list is-compact" id="team-d-slots"></div>
                        </div>
                      </div>

                      <div class="lobby-inline-error" id="lobby-room-error" role="alert" hidden></div>

                      <button type="button" id="btn-leave-room" class="room-leave-btn is-full">
                        GRUPPE VERLASSEN
                      </button>
                    </div>
                  </div>

                  <!-- SUB-VIEW 3: TAKTIK & TRAINING -->
                  <div class="play-subview-panel" id="play-subview-training" role="tabpanel" aria-labelledby="play-subtab-training" hidden>
                    <div class="tactical-section-head">
                      <span class="tactical-section-kicker">// 03 TAKTIK-TRAINING</span>
                      <h3 class="tactical-section-title">ÜBUNGSANLAGE &amp; DRILLS</h3>
                    </div>

                    <div class="play-side-card">
                      <button type="button" id="btn-quick-range" class="play-warmup-btn is-featured">
                        <span class="play-warmup-title">ÜBUNGSANLAGE BETRETEN</span>
                        <span class="play-warmup-sub">Schießstand · Spray-Wall · Bot-Drills</span>
                      </button>
                      <div class="play-training-info">
                        Trainiere Waffenhandhabung, Rückstoßkontrolle auf 10m/20m/30m Distanzen und teste alle Spezialisten-Fähigkeiten ohne Druck.
                      </div>
                    </div>
                  </div>
                </aside>

                <div class="play-center-stage">
                  <div class="party-banners-stage" id="lobby-party-banners" aria-label="Gruppen-Aufstellung"></div>

                  <footer class="play-bottom-cta">
                    <div class="lobby-footer-status" id="lobby-footer-status">
                      Bereit für Einsatz · Match finden, Raum erstellen oder mit Code beitreten.
                    </div>
                    <div class="play-cta-buttons">
                      <button type="button" id="btn-find-match" class="play-primary-cta is-coral is-find-match">
                        MATCH FINDEN
                      </button>
                      <button type="button" id="btn-create-room" class="play-primary-cta is-cyan">
                        RAUM ERSTELLEN
                      </button>
                      <button type="button" id="btn-toggle-ready" class="play-primary-cta is-cyan" hidden>
                        BEREIT
                      </button>
                      <button type="button" id="btn-start-match" class="play-primary-cta is-coral" hidden>
                        MATCH STARTEN
                      </button>
                    </div>
                  </footer>
                </div>
              </div>
            </section>

            <!-- TAB 2: EINSATZZIELE -->
            <section
              role="tabpanel"
              id="client-panel-objectives"
              aria-labelledby="client-tab-objectives"
              class="client-tabpanel"
              hidden
            >
              <div class="client-panel-inner" id="client-objectives-content"></div>
            </section>

            <!-- TAB 3: SPEZIALISTEN -->
            <section
              role="tabpanel"
              id="client-panel-specialists"
              aria-labelledby="client-tab-specialists"
              class="client-tabpanel"
              hidden
            >
              <div class="client-panel-inner is-specialists-layout" id="client-specialists-content"></div>
            </section>

            <!-- TAB 4: VERLAUF -->
            <section
              role="tabpanel"
              id="client-panel-history"
              aria-labelledby="client-tab-history"
              class="client-tabpanel"
              hidden
            >
              <div class="client-panel-inner" id="client-history-content"></div>
            </section>

            <!-- TAB 5: ARSENAL -->
            <section
              role="tabpanel"
              id="client-panel-arsenal"
              aria-labelledby="client-tab-arsenal"
              class="client-tabpanel"
              hidden
            >
              <div class="client-panel-inner" id="client-arsenal-content"></div>
            </section>
          </div>

          <!-- RECHTE TRUPP- & ONLINE-SEITENLEISTE -->
          <aside class="client-squad-rail" aria-label="Trupp- und Verbindungsstatus">
            <div class="squad-rail-header">
              <span class="squad-rail-dot" id="squad-rail-dot"></span>
              <span class="squad-rail-title" id="squad-rail-summary">SOLO · 1/5</span>
            </div>
            <div class="squad-rail-list" id="squad-rail-list"></div>
          </aside>
        </div>

        <!-- SLIDE-OUT MODUS- & KARTEN-SCHUBLADE (modern-web-guidance: navigation-drawer) -->
        <dialog
          id="lobby-mode-drawer"
          class="lobby-mode-drawer"
          aria-labelledby="mode-drawer-title"
        >
          <div class="mode-drawer-inner">
            <header class="mode-drawer-header">
              <div>
                <span class="mode-drawer-kicker">EINSATZ-KONFIGURATION</span>
                <h2 id="mode-drawer-title" class="mode-drawer-title">MODUS &amp; KARTE WÄHLEN</h2>
              </div>
              <button
                type="button"
                id="btn-close-mode-drawer"
                class="mode-drawer-close"
                aria-label="Modus-Auswahl schließen"
              >
                ✕
              </button>
            </header>

            <div class="mode-drawer-body">
              <section class="drawer-category" aria-labelledby="drawer-cat-kern">
                <h3 id="drawer-cat-kern" class="drawer-cat-heading">KERN · MEHRSPIELER</h3>
                <button type="button" id="btn-drawer-kernbruch" class="drawer-mode-tile is-featured">
                  <span class="drawer-tile-kicker">5-STELLIGER RAUMCODE · P2P / RELAY</span>
                  <span class="drawer-tile-title">Kernbruch Online-Raum</span>
                  <span class="drawer-tile-sub">Angreifer gegen Verteidiger · Kaufphase, Fähigkeiten &amp; Kern-Entschärfung</span>
                </button>
              </section>

              <section class="drawer-category" aria-labelledby="drawer-cat-options">
                <h3 id="drawer-cat-options" class="drawer-cat-heading">RAUM-OPTIONEN</h3>
                <div id="room-settings-host" class="drawer-room-options">
                  <label class="room-setting-item" for="select-room-map">
                    <span>Karte</span>
                    <select id="select-room-map">
                      ${roomMapOptionsHtml}
                    </select>
                  </label>
                  <label class="room-setting-item" for="select-team-size">
                    <span>Teamgröße</span>
                    <select id="select-team-size">
                      <option value="1">1v1</option>
                      <option value="2">2v2</option>
                      <option value="3" selected>3v3</option>
                      <option value="4">4v4</option>
                      <option value="5">5v5</option>
                    </select>
                  </label>
                  <label class="room-setting-item" for="select-rounds-win">
                    <span>Sieg-Runden</span>
                    <select id="select-rounds-win">
                      <option value="3">3</option>
                      <option value="5">5</option>
                      <option value="7" selected>7</option>
                      <option value="9">9</option>
                      <option value="13">13</option>
                    </select>
                  </label>
                </div>
                <div id="room-settings-guest" class="room-settings-readonly-group" hidden>
                  <span id="room-settings-guest-text">3v3 · 7 Sieg-Runden · Karte: Hafenwerk</span>
                </div>
              </section>

              <section class="drawer-category" aria-labelledby="drawer-cat-warmup">
                <h3 id="drawer-cat-warmup" class="drawer-cat-heading">AUFWÄRMEN · OFFLINE-TRAINING</h3>
                <div class="drawer-offline-grid">
                  ${offlineDrawerButtonsHtml}
                </div>
              </section>
            </div>
          </div>
        </dialog>
      </div>
    `;

    container.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;

    for (const tab of CLIENT_TABS) {
      this.tabButtons.set(tab.id, q(`#client-tab-${tab.id}`));
      this.tabPanels.set(tab.id, q(`#client-panel-${tab.id}`));
    }

    this.authBadgeEl = q('#lobby-auth-badge');
    this.topRankBadgeEl = q('#lobby-top-rank');
    this.btnLobbySettings = q('#btn-lobby-settings');
    this.noticeBannerEl = q('#lobby-notice');
    this.noticeTextEl = q('#lobby-notice-text');

    this.modeDrawer = q('#lobby-mode-drawer');
    this.btnOpenModeDrawer = q('#btn-open-mode-drawer');
    this.btnCloseModeDrawer = q('#btn-close-mode-drawer');
    this.modeCardTitleEl = q('#play-mode-card-title');
    this.modeCardSubEl = q('#play-mode-card-sub');
    this.modeCardMapBadgeEl = q('#play-mode-map-badge');

    for (const subId of ['match', 'room', 'training'] as const) {
      this.playSubNavBtns.set(subId, q(`#play-subtab-${subId}`));
      this.playSubViews.set(subId, q(`#play-subview-${subId}`));
    }

    this.soloJoinBlockEl = q('#lobby-solo-join-block');
    this.roomActiveBlockEl = q('#lobby-room-active-block');
    this.inputPlayerName = q('#input-player-name');
    this.inputRoomCode = q('#input-room-code');
    this.btnCreateRoom = q('#btn-create-room');
    this.btnFindMatch = q('#btn-find-match');
    this.btnJoinRoom = q('#btn-join-room');
    this.btnQuickRange = q('#btn-quick-range');
    for (const m of MAP_LIST) {
      const btnId = m.id === 'uebungsanlage' ? '#btn-offline-range' : `#btn-offline-${m.id}`;
      this.offlineMapBtns.set(m.id, q(btnId));
    }
    this.landingErrorEl = q('#lobby-error');

    this.roomCodeEl = q('#lobby-room-code');
    this.btnCopyCode = q('#btn-copy-code');
    this.copyTipEl = q('#copy-code-tip');
    this.hostSettingsWrapEl = q('#room-settings-host');
    this.guestSettingsWrapEl = q('#room-settings-guest');
    this.selectTeamSize = q('#select-team-size');
    this.selectRoundsWin = q('#select-rounds-win');
    this.selectRoomMap = q('#select-room-map');
    this.guestSettingsTextEl = q('#room-settings-guest-text');
    this.btnLeaveRoom = q('#btn-leave-room');
    this.roomErrorEl = q('#lobby-room-error');

    this.teamACountEl = q('#team-a-count');
    this.teamDCountEl = q('#team-d-count');
    this.teamASlotsEl = q('#team-a-slots');
    this.teamDSlotsEl = q('#team-d-slots');
    this.btnTeamA = q('#btn-team-a');
    this.btnTeamD = q('#btn-team-d');

    this.partyBannersWrapEl = q('#lobby-party-banners');
    this.footerStatusHintEl = q('#lobby-footer-status');
    this.btnToggleReady = q('#btn-toggle-ready');
    this.btnStartMatch = q('#btn-start-match');

    this.squadRailListEl = q('#squad-rail-list');
    this.squadRailSummaryEl = q('#squad-rail-summary');

    this.objectivesPanelContentEl = q('#client-objectives-content');
    this.specialistsPanelContentEl = q('#client-specialists-content');
    this.historyPanelContentEl = q('#client-history-content');
    this.arsenalPanelContentEl = q('#client-arsenal-content');

    for (const c of CHARACTER_LIST) {
      this.charCardBtns.set(c.id, q(`#char-${c.id}`));
    }

    this.inputPlayerName.value = initialName;
    this.setupListeners();
    this.refreshAllViews();
  }

  private setupListeners(): void {
    // Topbar Tablist (accessible ARIA tabs + roving tabindex fallback)
    const supportsNativeFocusGroup =
      typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

    for (const tab of CLIENT_TABS) {
      const btn = this.tabButtons.get(tab.id);
      if (!btn) continue;
      btn.addEventListener('click', () => {
        this.activateTab(tab.id, false);
      });
    }

    if (!supportsNativeFocusGroup) {
      const tablistEl = this.root.querySelector('.client-tablist') as HTMLElement;
      tablistEl.addEventListener('keydown', (e: KeyboardEvent) => {
        const navKeys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!navKeys.includes(e.key)) return;
        const orderedBtns = CLIENT_TABS.map((t) => this.tabButtons.get(t.id)!);
        const idx = orderedBtns.indexOf(document.activeElement as HTMLButtonElement);
        if (idx === -1) return;
        e.preventDefault();
        let nextIdx = idx;
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % orderedBtns.length;
        else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + orderedBtns.length) % orderedBtns.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = orderedBtns.length - 1;
        this.activateTab(CLIENT_TABS[nextIdx].id, true);
      });
    }

    // Play Subnav tabs (Match, Trupp & Raum, Training)
    for (const [subId, btn] of this.playSubNavBtns.entries()) {
      btn.addEventListener('click', () => {
        this.activatePlaySubView(subId);
      });
    }

    // Settings gear button
    this.btnLobbySettings.addEventListener('click', () => {
      this.callbacks.onOpenSettings?.();
    });

    // Notice banner dismiss
    const dismissBtn = this.root.querySelector('#btn-dismiss-notice') as HTMLButtonElement;
    dismissBtn.addEventListener('click', () => {
      this.noticeBannerEl.hidden = true;
    });

    // Slide-out Mode Drawer (`<dialog>` with backdrop light-dismiss)
    this.btnOpenModeDrawer.addEventListener('click', () => {
      this.openModeDrawer();
    });
    this.btnCloseModeDrawer.addEventListener('click', () => {
      this.closeModeDrawer();
    });
    this.modeDrawer.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.modeDrawer) {
        this.closeModeDrawer();
      }
    });

    const btnDrawerKernbruch = this.root.querySelector(
      '#btn-drawer-kernbruch'
    ) as HTMLButtonElement;
    btnDrawerKernbruch.addEventListener('click', () => {
      this.closeModeDrawer();
      this.activateTab('play', false);
      if (!this.currentRoom) {
        this.btnCreateRoom.focus();
      }
    });

    // Player name input & ARIA sync (`validate-input-after-interaction`)
    this.inputPlayerName.addEventListener('input', () => {
      this.syncFieldAriaInvalid(this.inputPlayerName);
      const trimmed = this.inputPlayerName.value.trim().slice(0, 16);
      if (trimmed.length >= 1) {
        this.callbacks.onPlayerNameChange(trimmed);
      }
      this.renderPartyBanners();
      this.renderSquadRail();
      if (this.activeTab === 'arsenal') {
        this.renderArsenalPanel();
      }
    });
    this.inputPlayerName.addEventListener('blur', () => {
      const trimmed = this.inputPlayerName.value.trim().slice(0, 16);
      if (trimmed.length >= 1) {
        this.inputPlayerName.value = trimmed;
        this.callbacks.onPlayerNameChange(trimmed);
      }
      this.syncFieldAriaInvalid(this.inputPlayerName);
      this.renderPartyBanners();
    });

    // Room code input
    this.inputRoomCode.addEventListener('input', () => {
      const cleaned = this.inputRoomCode.value
        .toUpperCase()
        .replace(/[\s-]+/g, '')
        .slice(0, 5);
      if (this.inputRoomCode.value !== cleaned) {
        this.inputRoomCode.value = cleaned;
      }
      this.syncFieldAriaInvalid(this.inputRoomCode);
      this.clearErrors();
    });
    this.inputRoomCode.addEventListener('blur', () => {
      this.syncFieldAriaInvalid(this.inputRoomCode);
    });

    // Create Room
    this.btnCreateRoom.addEventListener('click', () => {
      void this.handleCreateRoom();
    });

    // Automatische Warteschlange
    this.btnFindMatch.addEventListener('click', () => {
      void this.handleFindMatch();
    });

    // Join Room
    const joinForm = this.root.querySelector('#form-join-room') as HTMLFormElement;
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.handleJoinRoom();
    });

    // Quick Übungsanlage CTA + Drawer Offline Map buttons
    this.btnQuickRange.addEventListener('click', () => {
      this.closeModeDrawer();
      this.clearErrors();
      this.callbacks.onStartOffline('uebungsanlage');
    });

    for (const [mapId, btn] of this.offlineMapBtns.entries()) {
      btn.addEventListener('click', () => {
        this.closeModeDrawer();
        this.clearErrors();
        this.callbacks.onStartOffline(mapId);
      });
    }

    // Copy Room Code (`copy-button` pattern)
    if ('CommandEvent' in window) {
      document.addEventListener(
        'command',
        (event: Event) => {
          const cmdEvt = event as Event & { command?: string; source?: Element };
          if (cmdEvt.command === '--copy' && cmdEvt.source === this.btnCopyCode) {
            void this.copyRoomCode();
          }
        },
        true
      );
    } else {
      this.btnCopyCode.addEventListener('click', () => {
        void this.copyRoomCode();
      });
    }

    // Host Room Settings (also updates solo preview when not yet in a room)
    this.selectTeamSize.addEventListener('change', () => {
      const teamSize = Number(this.selectTeamSize.value);
      this.updateModePreviewCard();
      if (this.currentRoom && this.currentRoom.isHost) {
        void this.runLobbyAction(() => this.callbacks.onUpdateSettings({ teamSize }));
      }
    });
    this.selectRoundsWin.addEventListener('change', () => {
      const roundsToWin = Number(this.selectRoundsWin.value);
      this.updateModePreviewCard();
      if (this.currentRoom && this.currentRoom.isHost) {
        void this.runLobbyAction(() => this.callbacks.onUpdateSettings({ roundsToWin }));
      }
    });
    this.selectRoomMap.addEventListener('change', () => {
      const candidate = this.selectRoomMap.value;
      if (isValidMapId(candidate)) {
        this.soloPreviewMapId = candidate;
        this.updateModePreviewCard();
        if (this.currentRoom && this.currentRoom.isHost) {
          void this.runLobbyAction(() => this.callbacks.onUpdateSettings({ mapId: candidate }));
        }
      }
    });

    // Leave Room
    this.btnLeaveRoom.addEventListener('click', () => {
      void this.runLobbyAction(() => this.callbacks.onLeaveRoom());
    });

    // Switch Team A / D
    this.btnTeamA.addEventListener('click', () => {
      void this.runLobbyAction(() => this.callbacks.onSelectTeam('A'));
    });
    this.btnTeamD.addEventListener('click', () => {
      void this.runLobbyAction(() => this.callbacks.onSelectTeam('D'));
    });

    // Select Specialist (works both in online room and solo preview!)
    for (const [charId, btn] of this.charCardBtns.entries()) {
      btn.addEventListener('click', () => {
        this.soloCharacter = charId;
        this.showcaseCharacter = charId;
        this.callbacks.onOfflineCharacterChange?.(charId);
        if (this.currentRoom) {
          void this.runLobbyAction(() => this.callbacks.onSelectCharacter(charId));
        } else {
          this.syncSelectedCharacterChips(charId);
          this.renderPartyBanners();
          this.renderSquadRail();
        }
      });
    }

    // Ready Toggle (Guests)
    this.btnToggleReady.addEventListener('click', () => {
      if (!this.currentRoom || !this.localUid) return;
      const me = this.currentRoom.players.find((p) => p.uid === this.localUid);
      const nextReady = !(me?.ready ?? false);
      void this.runLobbyAction(() => this.callbacks.onToggleReady(nextReady));
    });

    // Start Match (Host)
    this.btnStartMatch.addEventListener('click', () => {
      void this.runLobbyAction(() => this.callbacks.onStartMatch());
    });
  }

  private activateTab(nextTab: ClientTabId, moveFocus: boolean): void {
    this.activeTab = nextTab;
    for (const tab of CLIENT_TABS) {
      const btn = this.tabButtons.get(tab.id)!;
      const panel = this.tabPanels.get(tab.id)!;
      const isSelected = tab.id === nextTab;
      btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      btn.tabIndex = isSelected ? 0 : -1;
      panel.hidden = !isSelected;
      if (isSelected && moveFocus) {
        btn.focus();
      }
    }

    if (nextTab === 'objectives') {
      this.renderObjectivesPanel();
    } else if (nextTab === 'specialists') {
      this.renderSpecialistsPanel();
    } else if (nextTab === 'history') {
      this.renderHistoryPanel();
    } else if (nextTab === 'arsenal') {
      this.renderArsenalPanel();
    }
  }

  public activatePlaySubView(subId: 'match' | 'room' | 'training'): void {
    this.playActiveSubView = subId;
    for (const [id, btn] of this.playSubNavBtns.entries()) {
      const active = id === subId;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    }
    for (const [id, panel] of this.playSubViews.entries()) {
      panel.hidden = id !== subId;
    }
  }

  private openModeDrawer(): void {
    if (!this.modeDrawer.open) {
      this.modeDrawer.showModal();
    }
  }

  private closeModeDrawer(): void {
    if (this.modeDrawer.open) {
      this.modeDrawer.close();
    }
  }

  private refreshAllViews(): void {
    this.updateTopCareerRankBadge();
    this.updateModePreviewCard();
    this.syncSelectedCharacterChips(this.getEffectiveLocalCharacter());
    this.renderPartyBanners();
    this.renderSquadRail();
    this.renderObjectivesPanel();
    this.renderSpecialistsPanel();
    this.renderHistoryPanel();
    this.renderArsenalPanel();
  }

  public refreshProgression(): void {
    this.updateTopCareerRankBadge();
    this.renderPartyBanners();
    this.renderObjectivesPanel();
    this.renderHistoryPanel();
    this.renderArsenalPanel();
  }

  public setSelectedSoloCharacter(character: CharacterId): void {
    this.soloCharacter = character;
    this.showcaseCharacter = character;
    if (!this.currentRoom) {
      this.syncSelectedCharacterChips(character);
      this.renderPartyBanners();
      this.renderSquadRail();
    }
  }

  private getEffectiveLocalCharacter(): CharacterId {
    if (this.currentRoom && this.localUid) {
      const me = this.currentRoom.players.find((p) => p.uid === this.localUid);
      if (me) return me.character;
    }
    return this.soloCharacter;
  }

  private getEffectiveLocalCallsign(): string {
    if (this.currentRoom && this.localUid) {
      const me = this.currentRoom.players.find((p) => p.uid === this.localUid);
      if (me?.name) return me.name;
    }
    const val = this.inputPlayerName.value.trim();
    return val || 'Agent';
  }

  private syncSelectedCharacterChips(activeChar: CharacterId): void {
    for (const [charId, btn] of this.charCardBtns.entries()) {
      const selected = charId === activeChar;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }

  private updateTopCareerRankBadge(): void {
    const career = getCareerSummary();
    const labelEl = this.topRankBadgeEl.querySelector('.rank-pill-label');
    if (labelEl) {
      labelEl.textContent = career.rankTitle;
    }
  }

  private updateModePreviewCard(): void {
    if (this.currentRoom) {
      const s = this.currentRoom.settings;
      const mapDef = getMapDefinition(s.mapId);
      this.modeCardMapBadgeEl.textContent = mapDef.name.toUpperCase();
      this.modeCardTitleEl.textContent = `KERNBRUCH · RAUM ${this.currentRoom.code}`;
      this.modeCardSubEl.textContent = `${s.teamSize}v${s.teamSize} · ${s.roundsToWin} Sieg-Runden · Modus & Karte ▸`;
      return;
    }

    const mapDef = getMapDefinition(this.soloPreviewMapId);
    const teamSize = Number(this.selectTeamSize.value) || 3;
    const roundsWin = Number(this.selectRoundsWin.value) || 7;
    this.modeCardMapBadgeEl.textContent = mapDef.name.toUpperCase();
    this.modeCardTitleEl.textContent = 'KERNBRUCH · ONLINE';
    this.modeCardSubEl.textContent = `${teamSize}v${teamSize} · ${roundsWin} Sieg-Runden · Modus & Karte wählen ▸`;
  }

  /**
   * Renders the 5 side-by-side vertical chevron player banners (`[0] [1] [2:FEATURED] [3] [4]`).
   */
  private renderPartyBanners(): void {
    const career = getCareerSummary();
    const slots: Array<LobbyPlayer | null> = [null, null, null, null, null];

    if (this.currentRoom) {
      const online = this.currentRoom.players.filter((p) => p.online);
      const me =
        online.find((p) => p.uid === this.localUid) ??
        online.find((p) => p.uid === this.currentRoom?.hostUid) ??
        online[0] ??
        null;
      const others = online.filter((p) => p !== me);

      slots[2] = me;
      const flankOrder = [1, 3, 0, 4];
      for (let i = 0; i < flankOrder.length && i < others.length; i += 1) {
        slots[flankOrder[i]] = others[i];
      }
    } else {
      // Solo lobby state: center banner features local player
      slots[2] = {
        uid: this.localUid ?? 'local',
        name: this.getEffectiveLocalCallsign(),
        team: 'A',
        character: this.soloCharacter,
        ready: true,
        online: true,
      };
    }

    this.partyBannersWrapEl.innerHTML = slots
      .map((player, idx) => {
        const isCenter = idx === 2;
        if (!player) {
          const inviteHint = this.currentRoom
            ? `Code ${this.currentRoom.code} kopieren`
            : 'Raum erstellen / Code eingeben';
          return `
            <button
              type="button"
              class="party-banner is-empty ${isCenter ? 'is-center' : ''}"
              data-empty-slot="${idx}"
              aria-label="Freier Trupp-Platz (${escapeHtml(inviteHint)})"
            >
              <div class="party-banner-top-edge"></div>
              <div class="party-empty-plus" aria-hidden="true">+</div>
              <span class="party-empty-title">FREIER PLATZ</span>
              <span class="party-empty-sub">${escapeHtml(inviteHint)}</span>
            </button>
          `;
        }

        const charDef = CHARACTERS[player.character] ?? CHARACTERS.ryo;
        const isHost = this.currentRoom ? player.uid === this.currentRoom.hostUid : true;
        const isSelf = !this.currentRoom || player.uid === this.localUid;
        const isReady = !this.currentRoom || isHost || player.ready;
        const teamAccent = this.currentRoom
          ? TEAM_DEFS[player.team].hex
          : charDef.accentHex;
        const teamLabel = this.currentRoom
          ? TEAM_DEFS[player.team].name.toUpperCase()
          : 'EINSATZBEREIT';
        const statusText = !this.currentRoom
          ? 'TRUPPFÜHRER'
          : isHost
            ? 'HOST · BEREIT'
            : isReady
              ? 'BEREIT'
              : 'WARTET';

        return `
          <article
            class="party-banner is-occupied ${isCenter ? 'is-center' : ''} ${isReady ? 'is-ready' : 'is-waiting'}"
            style="--banner-accent: ${teamAccent}; --char-accent: ${charDef.accentHex}"
          >
            <div class="party-banner-top-edge"></div>
            <header class="party-banner-head">
              <span class="party-status-pill ${isReady ? 'is-ready' : 'is-wait'}">${statusText}</span>
              <span class="party-team-tag">${teamLabel}</span>
            </header>

            <div class="party-portrait-stage">
              ${getCharacterPortraitSvg(charDef.id)}
            </div>

            <footer class="party-banner-foot">
              <div class="party-role-row">
                <span class="party-role-icon">${getRoleSvg(charDef.role)}</span>
                <span class="party-char-title">${escapeHtml(charDef.name.toUpperCase())} · ${escapeHtml(charDef.role.toUpperCase())}</span>
              </div>
              <div class="party-player-name">
                ${escapeHtml(player.name)}${isSelf && this.currentRoom ? ' <span class="party-self-tag">DU</span>' : ''}
              </div>
              <div class="party-rank-plate">${isSelf ? escapeHtml(career.rankTitle) : 'AKTIVER AGENT'}</div>
            </footer>
          </article>
        `;
      })
      .join('');

    const emptyBtns = this.partyBannersWrapEl.querySelectorAll<HTMLButtonElement>('[data-empty-slot]');
    emptyBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.currentRoom) {
          void this.copyRoomCode();
        } else {
          this.inputRoomCode.focus();
        }
      });
    });
  }

  private renderSquadRail(): void {
    const dotEl = this.root.querySelector('#squad-rail-dot') as HTMLElement | null;
    if (this.currentRoom) {
      const online = this.currentRoom.players.filter((p) => p.online);
      const cap = this.currentRoom.settings.teamSize * 2;
      this.squadRailSummaryEl.textContent = `RAUM ${this.currentRoom.code} · ${online.length}/${cap}`;
      if (dotEl) dotEl.dataset.online = 'true';

      this.squadRailListEl.innerHTML = online
        .map((p) => {
          const c = CHARACTERS[p.character] ?? CHARACTERS.ryo;
          const teamHex = TEAM_DEFS[p.team].hex;
          const stateLabel =
            p.uid === this.currentRoom?.hostUid ? 'HOST' : p.ready ? 'BEREIT' : 'LOBBY';
          return `
            <div class="squad-rail-item" style="--rail-accent: ${teamHex}">
              <span class="squad-rail-avatar">${getRoleSvg(c.role)}</span>
              <div class="squad-rail-meta">
                <span class="squad-rail-name">${escapeHtml(p.name)}</span>
                <span class="squad-rail-sub">${escapeHtml(c.name)} · ${stateLabel}</span>
              </div>
            </div>
          `;
        })
        .join('');
      return;
    }

    const c = CHARACTERS[this.soloCharacter] ?? CHARACTERS.ryo;
    this.squadRailSummaryEl.textContent = this.localUid ? 'ONLINE · SOLO' : 'OFFLINE · SOLO';
    if (dotEl) dotEl.dataset.online = this.localUid ? 'true' : 'false';
    this.squadRailListEl.innerHTML = `
      <div class="squad-rail-item is-self" style="--rail-accent: ${c.accentHex}">
        <span class="squad-rail-avatar">${getRoleSvg(c.role)}</span>
        <div class="squad-rail-meta">
          <span class="squad-rail-name">${escapeHtml(this.getEffectiveLocalCallsign())}</span>
          <span class="squad-rail-sub">${escapeHtml(c.name)} · Einsatzbereit</span>
        </div>
      </div>
    `;
  }

  /**
   * TAB 2: EINSATZZIELE (4 Fortschritts-Rauten + 3 Einsatz-Aufträge + großes Lanze-Showcase)
   */
  private renderObjectivesPanel(): void {
    const snap = getObjectivesOverview();
    const finishes = getSelectedFinishes();
    const lanzeFinish = finishes.lanze ?? 'standard';
    const lanzeStats = WEAPONS.lanze;

    const diamondsHtml = snap.diamonds
      .map(
        (d) => `
          <div class="obj-diamond-node ${d.unlocked ? 'is-unlocked' : ''}">
            <span class="obj-diamond-shape" aria-hidden="true">${d.unlocked ? '◆' : '◇'}</span>
            <span class="obj-diamond-xp">${d.thresholdXp} EP</span>
          </div>
        `
      )
      .join('');

    const objectivesHtml = snap.objectives
      .map((obj) => {
        const pct = Math.round(obj.progress01 * 100);
        return `
          <div class="objective-item ${obj.completed ? 'is-done' : ''}">
            <div class="objective-item-head">
              <div>
                <div class="objective-item-title">${escapeHtml(obj.title)}</div>
                <div class="objective-item-desc">${escapeHtml(obj.description)}</div>
              </div>
              <div class="objective-item-numbers">
                <span class="objective-count">${obj.current} / ${obj.target}</span>
                <span class="objective-xp">+${obj.rewardXp} EP</span>
              </div>
            </div>
            <div class="objective-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="${obj.target}" aria-valuenow="${obj.current}" aria-label="${escapeHtml(obj.title)}">
              <div class="objective-bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      })
      .join('');

    this.objectivesPanelContentEl.innerHTML = `
      <div class="objectives-grid">
        <article class="client-surface-card objectives-left-card">
          <header class="surface-card-header">
            <div>
              <span class="surface-kicker">EINSATZ-FORTSCHRITT</span>
              <h2 class="surface-title">TÄGLICHE &amp; RUNDEN-ZIELE</h2>
            </div>
            <span class="surface-xp-badge">${snap.totalXp.toLocaleString('de-DE')} EP GESAMT</span>
          </header>

          <div class="obj-diamonds-track" aria-label="Meilenstein-Rauten (${snap.completedDiamonds} von 4 erreicht)">
            ${diamondsHtml}
          </div>

          <div class="objectives-list">
            ${objectivesHtml}
          </div>
        </article>

        <article class="client-surface-card objectives-showcase-card">
          <div class="showcase-kicker-row">
            <span class="showcase-tag">WAFFEN-FOKUS · STURMGEWEHR</span>
            <span class="showcase-price">◆ ${lanzeStats.price.toLocaleString('de-DE')} SPLITTER</span>
          </div>
          <h2 class="showcase-big-title">LANZE</h2>
          <p class="showcase-subtitle">
            Präzisions-Sturmgewehr mit 0,00° Erstschuss-Abweichung im Stand und sofortigem 150-Schaden-Kopftreffer auf bis zu 50 Meter.
          </p>

          <div class="showcase-weapon-stage">
            ${getWeaponSvg('lanze', lanzeFinish)}
          </div>

          <div class="showcase-metrics-grid">
            <div class="showcase-metric">
              <span class="metric-label">KOPFTREFFER</span>
              <span class="metric-value is-accent">${lanzeStats.headDamage}</span>
            </div>
            <div class="showcase-metric">
              <span class="metric-label">KÖRPERTREFFER</span>
              <span class="metric-value">${lanzeStats.bodyDamage}</span>
            </div>
            <div class="showcase-metric">
              <span class="metric-label">FEUERRATE</span>
              <span class="metric-value">${lanzeStats.fireRate.toLocaleString('de-DE')} / s</span>
            </div>
            <div class="showcase-metric">
              <span class="metric-label">MAGAZIN</span>
              <span class="metric-value">${lanzeStats.magSize} / ${lanzeStats.reserveAmmo}</span>
            </div>
          </div>

          <div class="showcase-actions-row">
            <button type="button" class="play-primary-cta is-cyan" data-action-test-range="true">
              IN ÜBUNGSANLAGE TESTEN
            </button>
            <button type="button" class="lobby-secondary-action" data-action-open-arsenal="true">
              IM ARSENAL ANPASSEN
            </button>
          </div>
        </article>
      </div>
    `;

    this.objectivesPanelContentEl
      .querySelector('[data-action-test-range]')
      ?.addEventListener('click', () => {
        this.callbacks.onStartOffline('uebungsanlage');
      });
    this.objectivesPanelContentEl
      .querySelector('[data-action-open-arsenal]')
      ?.addEventListener('click', () => {
        this.selectedArsenalWeapon = 'lanze';
        this.activateTab('arsenal', false);
      });
  }

  /**
   * TAB 3: SPEZIALISTEN (Links Rollen-Filter + Portraits, Mitte Groß-Portrait, Rechts [INFO] [Q] [E] [X])
   */
  private renderSpecialistsPanel(): void {
    const roles: readonly { id: RoleFilterId; label: string }[] = [
      { id: 'all', label: 'ALLE' },
      { id: 'Vorstoß', label: 'VORSTOSS' },
      { id: 'Aufklärer', label: 'AUFKLÄRER' },
      { id: 'Kontrolleur', label: 'KONTROLLEUR' },
      { id: 'Wächter', label: 'WÄCHTER' },
    ];

    const filteredChars =
      this.showcaseRoleFilter === 'all'
        ? CHARACTER_LIST
        : CHARACTER_LIST.filter((c) => c.role === this.showcaseRoleFilter);

    const activeSpec =
      CHARACTERS[this.showcaseCharacter] ?? filteredChars[0] ?? CHARACTERS.ryo;
    const equippedChar = this.getEffectiveLocalCharacter();

    const roleFilterHtml = roles
      .map((r) => {
        const active = r.id === this.showcaseRoleFilter;
        const icon = r.id === 'all' ? '<span class="role-all-dot">◆</span>' : getRoleSvg(r.id);
        return `
          <button
            type="button"
            class="spec-role-filter-btn ${active ? 'is-active' : ''}"
            data-role-filter="${r.id}"
            aria-pressed="${active ? 'true' : 'false'}"
            title="${r.label}"
          >
            <span class="spec-role-filter-icon">${icon}</span>
            <span class="spec-role-filter-label">${r.label}</span>
          </button>
        `;
      })
      .join('');

    const rosterCardsHtml = filteredChars
      .map((c) => {
        const selected = c.id === activeSpec.id;
        const isEquipped = c.id === equippedChar;
        return `
          <button
            type="button"
            class="spec-roster-tile ${selected ? 'is-selected' : ''}"
            data-spec-pick="${c.id}"
            style="--char-accent: ${c.accentHex}"
          >
            <div class="spec-roster-thumb">${getCharacterPortraitSvg(c.id)}</div>
            <div class="spec-roster-info">
              <span class="spec-roster-name">${escapeHtml(c.name.toUpperCase())}</span>
              <span class="spec-roster-role">${escapeHtml(c.role)}</span>
            </div>
            ${isEquipped ? '<span class="spec-equipped-pip">AKTIV</span>' : ''}
          </button>
        `;
      })
      .join('');

    const subTabs: readonly { id: SpecialistSubTabId; label: string }[] = [
      { id: 'info', label: 'INFO' },
      { id: 'q', label: 'Q' },
      { id: 'e', label: 'E' },
      { id: 'ult', label: 'X' },
    ];

    const subTabsHtml = subTabs
      .map((st) => {
        const sel = st.id === this.showcaseSubTab;
        const iconHtml =
          st.id === 'info'
            ? getRoleSvg(activeSpec.role)
            : getAbilitySvg(activeSpec.id, st.id);
        return `
          <button
            type="button"
            role="tab"
            class="spec-subtab-btn"
            aria-selected="${sel ? 'true' : 'false'}"
            data-spec-subtab="${st.id}"
          >
            <span class="spec-subtab-icon">${iconHtml}</span>
            <span class="spec-subtab-key">${st.label}</span>
          </button>
        `;
      })
      .join('');

    let detailBodyHtml = '';
    if (this.showcaseSubTab === 'info') {
      detailBodyHtml = `
        <div class="spec-detail-card">
          <div class="spec-detail-kicker">EINSATZPROFIL · ${escapeHtml(activeSpec.role.toUpperCase())}</div>
          <p class="spec-detail-desc">${escapeHtml(activeSpec.tagline)}</p>
          <div class="spec-overview-abilities">
            <div class="spec-mini-ab">
              <span class="spec-mini-ab-icon">${getAbilitySvg(activeSpec.id, 'q')}</span>
              <div>
                <strong>[Q] ${escapeHtml(activeSpec.abilities.q.name)}</strong>
                <span>${escapeHtml(activeSpec.abilities.q.summary)}</span>
              </div>
            </div>
            <div class="spec-mini-ab">
              <span class="spec-mini-ab-icon">${getAbilitySvg(activeSpec.id, 'e')}</span>
              <div>
                <strong>[E] ${escapeHtml(activeSpec.abilities.e.name)}</strong>
                <span>${escapeHtml(activeSpec.abilities.e.summary)}</span>
              </div>
            </div>
            <div class="spec-mini-ab">
              <span class="spec-mini-ab-icon">${getAbilitySvg(activeSpec.id, 'ult')}</span>
              <div>
                <strong>[X] ${escapeHtml(activeSpec.abilities.ult.name)}</strong>
                <span>${escapeHtml(activeSpec.abilities.ult.summary)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      const ab = activeSpec.abilities[this.showcaseSubTab];
      const costText =
        this.showcaseSubTab === 'ult'
          ? `${ab.ultPoints ?? 7} ULTIMATE-PUNKTE`
          : ab.freePerRound
            ? 'SIGNATUR · GRATIS JEDE RUNDE'
            : `◆ ${ab.costSplitter ?? 0} SPLITTER · MAX. ${ab.maxCharges ?? 1}`;
      detailBodyHtml = `
        <div class="spec-detail-card">
          <div class="spec-ab-focus-head">
            <span class="spec-ab-focus-icon">${getAbilitySvg(activeSpec.id, this.showcaseSubTab)}</span>
            <div>
              <span class="spec-detail-kicker">TASTE [${ab.key}] · ${costText}</span>
              <h3 class="spec-ab-focus-title">${escapeHtml(ab.name.toUpperCase())}</h3>
            </div>
          </div>
          <p class="spec-detail-desc">${escapeHtml(ab.summary)}</p>
        </div>
      `;
    }

    const isAlreadyEquipped = activeSpec.id === equippedChar;

    this.specialistsPanelContentEl.innerHTML = `
      <div class="specialists-showcase-grid" style="--spec-accent: ${activeSpec.accentHex}">
        <aside class="spec-left-pane">
          <div class="spec-role-filter-bar" role="toolbar" aria-label="Rollenfilter">
            ${roleFilterHtml}
          </div>
          <div class="spec-roster-list">
            ${rosterCardsHtml}
          </div>
        </aside>

        <div class="spec-center-stage">
          <div class="spec-backdrop-word" aria-hidden="true">${escapeHtml(activeSpec.name.toUpperCase())}</div>
          <div class="spec-hero-portrait">
            ${getCharacterPortraitSvg(activeSpec.id)}
          </div>
        </div>

        <aside class="spec-right-dossier">
          <div class="spec-role-diamond-row">
            <span class="spec-role-diamond">${getRoleSvg(activeSpec.role)}</span>
            <span class="spec-role-title">${escapeHtml(activeSpec.role.toUpperCase())}</span>
          </div>
          <h2 class="spec-big-name">${escapeHtml(activeSpec.name.toUpperCase())}</h2>

          <div class="spec-subtablist" role="tablist" aria-label="Fähigkeiten-Details">
            ${subTabsHtml}
          </div>

          ${detailBodyHtml}

          <button
            type="button"
            class="play-primary-cta ${isAlreadyEquipped ? 'is-cyan' : 'is-coral'} spec-equip-btn"
            data-equip-spec="${activeSpec.id}"
          >
            ${isAlreadyEquipped ? 'AKTIVER SPEZIALIST ✓' : `${escapeHtml(activeSpec.name.toUpperCase())} AUSWÄHLEN`}
          </button>
        </aside>
      </div>
    `;

    this.specialistsPanelContentEl
      .querySelectorAll<HTMLButtonElement>('[data-role-filter]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          this.showcaseRoleFilter = (btn.dataset.roleFilter as RoleFilterId) ?? 'all';
          const matches =
            this.showcaseRoleFilter === 'all'
              ? CHARACTER_LIST
              : CHARACTER_LIST.filter((c) => c.role === this.showcaseRoleFilter);
          if (matches.length > 0 && !matches.some((c) => c.id === this.showcaseCharacter)) {
            this.showcaseCharacter = matches[0].id;
          }
          this.renderSpecialistsPanel();
        });
      });

    this.specialistsPanelContentEl
      .querySelectorAll<HTMLButtonElement>('[data-spec-pick]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const cid = btn.dataset.specPick as CharacterId;
          if (cid && CHARACTERS[cid]) {
            this.showcaseCharacter = cid;
            this.renderSpecialistsPanel();
          }
        });
      });

    this.specialistsPanelContentEl
      .querySelectorAll<HTMLButtonElement>('[data-spec-subtab]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          this.showcaseSubTab = (btn.dataset.specSubtab as SpecialistSubTabId) ?? 'info';
          this.renderSpecialistsPanel();
        });
      });

    this.specialistsPanelContentEl
      .querySelector<HTMLButtonElement>('[data-equip-spec]')
      ?.addEventListener('click', () => {
        this.soloCharacter = activeSpec.id;
        this.callbacks.onOfflineCharacterChange?.(activeSpec.id);
        this.syncSelectedCharacterChips(activeSpec.id);
        this.renderPartyBanners();
        this.renderSquadRail();
        if (this.currentRoom) {
          void this.runLobbyAction(() => this.callbacks.onSelectCharacter(activeSpec.id));
        }
        this.renderSpecialistsPanel();
      });
  }

  /**
   * TAB 4: VERLAUF (Meistgespielte Spezialisten | Match-Verlauf | Taktische Einsatz-Wertung)
   */
  private renderHistoryPanel(): void {
    const summary = getCareerSummary();
    const history = getMatchHistory();

    const specRowsHtml = summary.specialistBreakdown
      .map((item) => {
        const c = CHARACTERS[item.character] ?? CHARACTERS.ryo;
        return `
          <div class="career-spec-row" style="--char-accent: ${c.accentHex}">
            <span class="career-spec-icon">${getRoleSvg(c.role)}</span>
            <div class="career-spec-meta">
              <span class="career-spec-name">${escapeHtml(c.name)}</span>
              <span class="career-spec-sub">${item.matches} Einsätze · ${item.wins} Siege</span>
            </div>
            <span class="career-spec-kills">${item.kills} K</span>
          </div>
        `;
      })
      .join('');

    const historyRowsHtml =
      history.length === 0
        ? `
          <div class="history-empty-state">
            <div class="history-empty-icon">${getKernSvg()}</div>
            <h3>NOCH KEINE ABGESCHLOSSENEN MATCHES</h3>
            <p>Bestreite ein Online-Kernbruch-Match oder schließe einen Lauf auf der Übungsanlage ab, um deinen Einsatz-Verlauf aufzuzeichnen.</p>
          </div>
        `
        : history
            .map((entry) => {
              const c = CHARACTERS[entry.character] ?? CHARACTERS.ryo;
              const mapDef = getMapDefinition(entry.mapId);
              const outcomeTone =
                entry.outcome === 'win'
                  ? 'win'
                  : entry.outcome === 'loss'
                    ? 'loss'
                    : 'neutral';
              const outcomeLabel =
                entry.outcome === 'win'
                  ? 'SIEG'
                  : entry.outcome === 'loss'
                    ? 'NIEDERLAGE'
                    : entry.outcome === 'training'
                      ? 'TRAINING'
                      : 'UNENTSCHIEDEN';
              return `
                <div class="history-match-row is-${outcomeTone}">
                  <div class="history-row-left">
                    <span class="history-spec-badge" style="--char-accent: ${c.accentHex}">
                      ${getRoleSvg(c.role)}
                    </span>
                    <div>
                      <div class="history-outcome-label">${outcomeLabel} · ${escapeHtml(c.name.toUpperCase())}</div>
                      <div class="history-map-meta">${escapeHtml(mapDef.name)} · ${formatTimestampShort(entry.timestampMs)}</div>
                    </div>
                  </div>
                  <div class="history-score-pill">${entry.scoreAlly} : ${entry.scoreEnemy}</div>
                  <div class="history-kda-box">
                    <span class="history-kda-label">K / T / A</span>
                    <span class="history-kda-val">${entry.kills} / ${entry.deaths} / ${entry.assists}</span>
                  </div>
                </div>
              `;
            })
            .join('');

    const rankPct = Math.round(summary.rankProgress01 * 100);

    this.historyPanelContentEl.innerHTML = `
      <div class="history-three-col">
        <article class="client-surface-card">
          <header class="surface-card-header">
            <div>
              <span class="surface-kicker">EINSATZ-STATISTIK</span>
              <h2 class="surface-title">MEISTGESPIELTE SPEZIALISTEN</h2>
            </div>
          </header>
          <div class="career-spec-list">
            ${specRowsHtml}
          </div>
        </article>

        <article class="client-surface-card history-center-card">
          <header class="surface-card-header">
            <div>
              <span class="surface-kicker">LETZTE EINSÄTZE</span>
              <h2 class="surface-title">MATCH-VERLAUF</h2>
            </div>
            <span class="surface-xp-badge">${summary.totalMatches} EINSÄTZE</span>
          </header>
          <div class="history-match-list">
            ${historyRowsHtml}
          </div>
        </article>

        <article class="client-surface-card">
          <header class="surface-card-header">
            <div>
              <span class="surface-kicker">KARRIERE-PROFIL</span>
              <h2 class="surface-title">TAKTISCHE EINSATZ-WERTUNG</h2>
            </div>
          </header>

          <div class="career-rank-crest">
            <div class="career-rank-emblem">${getKernSvg()}</div>
            <div class="career-rank-title">${escapeHtml(summary.rankTitle)}</div>
            <div class="career-rank-xp">${summary.totalXp.toLocaleString('de-DE')} EP</div>
            <div class="objective-bar-track">
              <div class="objective-bar-fill" style="width: ${rankPct}%"></div>
            </div>
          </div>

          <div class="career-kpi-grid">
            <div class="career-kpi">
              <span class="metric-label">SIEGQUOTE</span>
              <span class="metric-value is-accent">${summary.winRatePct}%</span>
            </div>
            <div class="career-kpi">
              <span class="metric-label">K/T-RATE</span>
              <span class="metric-value">${summary.kdRatio.toFixed(2)}</span>
            </div>
            <div class="career-kpi">
              <span class="metric-label">KOPFTREFFER</span>
              <span class="metric-value">${summary.totalHeadshots}</span>
            </div>
            <div class="career-kpi">
              <span class="metric-label">KERN-AKTIONEN</span>
              <span class="metric-value">${summary.totalKernActions}</span>
            </div>
          </div>
        </article>
      </div>
    `;
  }

  /**
   * TAB 5: ARSENAL (Mehrspaltiges Waffen-Raster + kostenlose Farbschema-Wahl + Spielerbanner)
   */
  private renderArsenalPanel(): void {
    const finishes = getSelectedFinishes();
    const career = getCareerSummary();
    const activeChar = CHARACTERS[this.getEffectiveLocalCharacter()] ?? CHARACTERS.ryo;

    const renderWeaponTile = (id: ArsenalWeaponId, labelOverride?: string): string => {
      const selected = this.selectedArsenalWeapon === id;
      const fin = finishes[id] ?? 'standard';
      const finDef = WEAPON_FINISHES.find((f) => f.id === fin) ?? WEAPON_FINISHES[0];
      const name =
        labelOverride ?? (id === 'knife' ? 'Taktik-Klinge' : WEAPONS[id].name);
      const meta =
        id === 'knife'
          ? 'STANDARD · NAHKAMPF'
          : WEAPONS[id].price === 0
            ? 'GRATIS · STARTWAFFE'
            : `◆ ${WEAPONS[id].price.toLocaleString('de-DE')}`;

      return `
        <button
          type="button"
          class="arsenal-weapon-tile ${selected ? 'is-selected' : ''}"
          data-arsenal-weapon="${id}"
        >
          <div class="arsenal-tile-svg">${getWeaponSvg(id, fin)}</div>
          <div class="arsenal-tile-foot">
            <span class="arsenal-tile-name">${escapeHtml(name.toUpperCase())}</span>
            <span class="arsenal-tile-meta">
              <span class="arsenal-finish-dot" style="background: ${finDef.accentHex}"></span>
              ${escapeHtml(meta)}
            </span>
          </div>
        </button>
      `;
    };

    const activeWeaponId = this.selectedArsenalWeapon;
    const activeFinish = finishes[activeWeaponId] ?? 'standard';
    const isKnife = activeWeaponId === 'knife';
    const wStats = isKnife ? null : WEAPONS[activeWeaponId];
    const inspectTitle = isKnife ? 'TAKTIK-KLINGE' : wStats!.name.toUpperCase();
    const inspectSub = isKnife
      ? 'NAHKAMPF · MAXIMALES LAUFTEMPO'
      : `${wStats!.category.toUpperCase()} · ${wStats!.automatic ? 'VOLLAUTOMATIK' : 'EINZELFEUER'}`;

    const finishButtonsHtml = WEAPON_FINISHES.map((f) => {
      const active = f.id === activeFinish;
      return `
        <button
          type="button"
          class="arsenal-finish-btn ${active ? 'is-active' : ''}"
          data-arsenal-finish="${f.id}"
          aria-pressed="${active ? 'true' : 'false'}"
        >
          <span class="finish-swatch-chip" style="background: linear-gradient(135deg, ${f.primaryHex} 45%, ${f.accentHex} 100%)"></span>
          <span class="finish-btn-copy">
            <span class="finish-btn-name">${escapeHtml(f.name)}</span>
            <span class="finish-btn-tag">FREI FREIGESCHALTET</span>
          </span>
        </button>
      `;
    }).join('');

    this.arsenalPanelContentEl.innerHTML = `
      <div class="arsenal-layout">
        <div class="arsenal-columns">
          <div class="arsenal-cat-col">
            <div class="arsenal-cat-group">
              <h3 class="arsenal-cat-title">SEKUNDÄRWAFFEN</h3>
              ${renderWeaponTile('funke')}
              ${renderWeaponTile('bolzer')}
            </div>
            <div class="arsenal-cat-group">
              <h3 class="arsenal-cat-title">NAHKAMPF</h3>
              ${renderWeaponTile('knife', 'Taktik-Klinge')}
            </div>
          </div>

          <div class="arsenal-cat-col">
            <div class="arsenal-cat-group">
              <h3 class="arsenal-cat-title">MASCHINENPISTOLEN</h3>
              ${renderWeaponTile('hornisse')}
            </div>
            <div class="arsenal-cat-group">
              <h3 class="arsenal-cat-title">SCHROTFLINTEN</h3>
              ${renderWeaponTile('brecher')}
            </div>
          </div>

          <div class="arsenal-cat-col">
            <div class="arsenal-cat-group">
              <h3 class="arsenal-cat-title">STURMGEWEHRE</h3>
              ${renderWeaponTile('lanze')}
            </div>
            <div class="arsenal-cat-group">
              <h3 class="arsenal-cat-title">PRÄZISIONSGEWEHRE</h3>
              ${renderWeaponTile('falke')}
            </div>
          </div>
        </div>

        <aside class="client-surface-card arsenal-inspector">
          <div class="surface-kicker">${escapeHtml(inspectSub)}</div>
          <h2 class="surface-title">${escapeHtml(inspectTitle)}</h2>

          <div class="arsenal-inspector-preview">
            ${getWeaponSvg(activeWeaponId, activeFinish)}
          </div>

          ${
            wStats
              ? `
            <div class="arsenal-stats-mini">
              <div><span>KOPF</span><strong>${wStats.headDamage}${wStats.pellets > 1 ? `×${wStats.pellets}` : ''}</strong></div>
              <div><span>KÖRPER</span><strong>${wStats.bodyDamage}${wStats.pellets > 1 ? `×${wStats.pellets}` : ''}</strong></div>
              <div><span>RATE</span><strong>${wStats.fireRate}/s</strong></div>
              <div><span>MAGAZIN</span><strong>${wStats.magSize}</strong></div>
            </div>
          `
              : `
            <div class="arsenal-stats-mini">
              <div><span>PRIMÄR</span><strong>50</strong></div>
              <div><span>SCHWER</span><strong>75 (150 RÜCKEN)</strong></div>
              <div><span>TEMPO</span><strong>100%</strong></div>
            </div>
          `
          }

          <div class="arsenal-finish-section">
            <div class="arsenal-finish-heading">FARBSCHEMA (ALLE KOSTENLOS ENTHALTEN)</div>
            <div class="arsenal-finish-grid">
              ${finishButtonsHtml}
            </div>
          </div>
        </aside>

        <aside class="arsenal-player-banner-card" style="--char-accent: ${activeChar.accentHex}">
          <div class="player-banner-kicker">SPIELERBANNER</div>
          <div class="player-banner-portrait">
            ${getCharacterPortraitSvg(activeChar.id)}
          </div>
          <div class="player-banner-footer">
            <span class="player-banner-role">${getRoleSvg(activeChar.role)}</span>
            <div class="player-banner-name">${escapeHtml(this.getEffectiveLocalCallsign())}</div>
            <div class="player-banner-rank">${escapeHtml(career.rankTitle)}</div>
          </div>
        </aside>
      </div>
    `;

    this.arsenalPanelContentEl
      .querySelectorAll<HTMLButtonElement>('[data-arsenal-weapon]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedArsenalWeapon =
            (btn.dataset.arsenalWeapon as ArsenalWeaponId) ?? 'lanze';
          this.renderArsenalPanel();
        });
      });

    this.arsenalPanelContentEl
      .querySelectorAll<HTMLButtonElement>('[data-arsenal-finish]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const fin = btn.dataset.arsenalFinish as WeaponFinishId;
          if (fin) {
            setWeaponFinish(this.selectedArsenalWeapon, fin);
            this.renderArsenalPanel();
            this.renderObjectivesPanel();
          }
        });
      });
  }

  private syncFieldAriaInvalid(input: HTMLInputElement): void {
    let invalid = false;
    try {
      invalid = input.matches(':user-invalid');
    } catch {
      invalid = !input.validity.valid;
    }
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    const errorId = input.dataset.error;
    if (!errorId) return;
    const rawTokens = (input.getAttribute('aria-describedby') || '').match(/\S+/g) ?? [];
    const ids = rawTokens.filter((id) => id && id !== errorId);
    if (invalid) ids.push(errorId);
    if (ids.length > 0) {
      input.setAttribute('aria-describedby', ids.join(' '));
    } else {
      input.removeAttribute('aria-describedby');
    }
  }

  private getValidatedPlayerName(): string | null {
    const name = this.inputPlayerName.value.trim().slice(0, 16);
    if (name.length < 1) {
      this.showLandingError('Bitte gib zuerst ein Rufzeichen (1–16 Zeichen) ein.');
      this.inputPlayerName.focus();
      return null;
    }
    this.inputPlayerName.value = name;
    this.callbacks.onPlayerNameChange(name);
    return name;
  }

  private async handleCreateRoom(): Promise<void> {
    if (this.busy) return;
    this.clearErrors();
    const name = this.getValidatedPlayerName();
    if (!name) return;

    this.setBusy(true, 'create');
    try {
      await this.callbacks.onCreateRoom(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Raum konnte nicht erstellt werden.';
      this.showLandingError(msg);
    } finally {
      this.setBusy(false);
    }
  }

  private async handleFindMatch(): Promise<void> {
    this.clearErrors();
    if (this.queueSearching) {
      try {
        await this.callbacks.onCancelQueue?.();
      } catch (err) {
        this.showLandingError(err instanceof Error ? err.message : 'Abbrechen fehlgeschlagen.');
      }
      return;
    }
    if (this.busy) return;
    const name = this.getValidatedPlayerName();
    if (!name || !this.callbacks.onFindMatch) return;
    const teamSize = Math.max(1, Math.min(5, Number(this.selectTeamSize.value) || 5));
    try {
      await this.callbacks.onFindMatch(name, teamSize);
    } catch (err) {
      this.setQueueState(false);
      this.showLandingError(err instanceof Error ? err.message : 'Warteschlange nicht verfügbar.');
    }
  }

  /**
   * Zeigt den Warteschlangen-Zustand im Fußbereich an.
   * @param searching true = Suche läuft (Button wird zu „ABBRECHEN“)
   * @param text Statuszeile, z. B. „Suche … 0:12 · 2 im lokalen Netz“
   */
  public setQueueState(searching: boolean, text?: string): void {
    this.queueSearching = searching;
    this.btnFindMatch.classList.toggle('is-searching', searching);
    this.btnFindMatch.textContent = searching ? 'SUCHE ABBRECHEN' : 'MATCH FINDEN';
    this.btnCreateRoom.disabled = searching || this.busy;
    this.btnJoinRoom.disabled = searching || this.busy;
    if (text) {
      this.footerStatusHintEl.textContent = text;
    } else if (!searching && this.activeView === 'landing') {
      this.footerStatusHintEl.textContent =
        'Bereit für Einsatz · Match finden, Raum erstellen oder mit Code beitreten.';
    }
  }

  private async handleJoinRoom(): Promise<void> {
    if (this.busy) return;
    this.clearErrors();
    const name = this.getValidatedPlayerName();
    if (!name) return;

    const code = this.inputRoomCode.value.toUpperCase().replace(/[\s-]+/g, '').trim();
    if (code.length !== 5) {
      this.showLandingError('Bitte gib einen 5-stelligen Raumcode ein (z. B. K7M4P).');
      this.inputRoomCode.focus();
      return;
    }

    this.setBusy(true, 'join');
    try {
      await this.callbacks.onJoinRoom(code, name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Beitritt fehlgeschlagen.';
      this.showLandingError(msg);
    } finally {
      this.setBusy(false);
    }
  }

  private async runLobbyAction(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.roomErrorEl.hidden = true;
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Aktion fehlgeschlagen.';
      this.roomErrorEl.textContent = msg;
      this.roomErrorEl.hidden = false;
    }
  }

  private async copyRoomCode(): Promise<void> {
    const text = (this.roomCodeEl.innerText || this.roomCodeEl.textContent || '').trim();
    if (!text || text === '-----') return;

    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = this.legacyCopyText(text);
    }

    if (this.copyTimer !== null) {
      window.clearTimeout(this.copyTimer);
    }

    this.btnCopyCode.removeAttribute('data-copied');
    this.btnCopyCode.removeAttribute('data-failed');

    let message = ok ? 'Kopiert!' : 'Fehler';
    if (message === this.lastCopyAnnouncement) {
      message += '\u00A0';
    }
    this.lastCopyAnnouncement = message;

    this.copyTipEl.textContent = '';
    this.btnCopyCode.setAttribute(ok ? 'data-copied' : 'data-failed', '');
    requestAnimationFrame(() => {
      this.copyTipEl.textContent = message;
    });

    this.copyTimer = window.setTimeout(() => {
      this.btnCopyCode.removeAttribute('data-copied');
      this.btnCopyCode.removeAttribute('data-failed');
      this.copyTipEl.textContent = '';
      this.copyTimer = null;
    }, 2000);
  }

  private legacyCopyText(text: string): boolean {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
    document.body.appendChild(field);
    field.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }

  private setBusy(busy: boolean, mode?: 'create' | 'join'): void {
    this.busy = busy;
    this.btnCreateRoom.disabled = busy || this.queueSearching;
    this.btnJoinRoom.disabled = busy || this.queueSearching;
    this.btnFindMatch.disabled = busy;
    if (busy && mode === 'create') {
      this.btnCreateRoom.textContent = 'ERSTELLE RAUM...';
    } else {
      this.btnCreateRoom.textContent = 'RAUM ERSTELLEN';
    }
    if (busy && mode === 'join') {
      this.btnJoinRoom.textContent = '...';
    } else {
      this.btnJoinRoom.textContent = 'BEITRETEN';
    }
  }

  public setAuthStatus(uid: string | null, errorMsg?: string): void {
    this.localUid = uid;
    if (uid) {
      this.authBadgeEl.dataset.state = 'online';
      this.authBadgeEl.textContent = `UID: ${uid.slice(0, 6).toUpperCase()}`;
      if (!this.inputPlayerName.value.trim()) {
        const fallback = `Agent-${uid.slice(0, 4).toUpperCase()}`;
        this.inputPlayerName.value = fallback;
        this.callbacks.onPlayerNameChange(fallback);
      }
    } else {
      this.authBadgeEl.dataset.state = 'offline';
      this.authBadgeEl.textContent = errorMsg ? 'Offline-Modus' : 'Offline';
      if (errorMsg) {
        this.authBadgeEl.title = errorMsg;
      }
    }
    this.renderPartyBanners();
    this.renderSquadRail();
  }

  public setPlayerNameInput(name: string): void {
    if (name && !this.inputPlayerName.value.trim()) {
      this.inputPlayerName.value = name;
      this.renderPartyBanners();
      this.renderSquadRail();
    }
  }

  public showLandingError(msg: string): void {
    this.landingErrorEl.textContent = msg;
    this.landingErrorEl.hidden = false;
  }

  public clearErrors(): void {
    this.landingErrorEl.hidden = true;
    this.roomErrorEl.hidden = true;
  }

  public showClosureNotice(reason: string): void {
    this.noticeTextEl.textContent = reason;
    this.noticeBannerEl.hidden = false;
  }

  public showLanding(): void {
    this.currentRoom = null;
    this.activeView = 'landing';
    this.visible = true;
    this.root.hidden = false;
    this.soloJoinBlockEl.hidden = false;
    this.roomActiveBlockEl.hidden = true;
    this.hostSettingsWrapEl.hidden = false;
    this.guestSettingsWrapEl.hidden = true;
    this.btnCreateRoom.hidden = false;
    this.btnFindMatch.hidden = false;
    this.btnToggleReady.hidden = true;
    this.btnStartMatch.hidden = true;
    this.footerStatusHintEl.textContent =
      'Bereit für Einsatz · Match finden, Raum erstellen oder mit Code beitreten.';
    this.clearErrors();
    this.refreshAllViews();
  }

  public hide(): void {
    this.closeModeDrawer();
    this.visible = false;
    this.root.hidden = true;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public getView(): 'landing' | 'lobby' {
    return this.activeView;
  }

  public syncRoom(room: LobbyRoomView | null): void {
    this.currentRoom = room;
    if (!room) {
      if (this.visible) {
        this.showLanding();
      }
      return;
    }

    if (room.status === 'lobby') {
      this.activeView = 'lobby';
      this.visible = true;
      this.root.hidden = false;
      this.activateTab('play', false);
      this.activatePlaySubView('room');
      this.soloJoinBlockEl.hidden = true;
      this.roomActiveBlockEl.hidden = false;
      this.btnCreateRoom.hidden = true;
      this.btnFindMatch.hidden = true;
      this.noticeBannerEl.hidden = true;
    }

    // Room code & settings
    this.roomCodeEl.textContent = room.code;
    const teamSize = room.settings.teamSize;
    const roundsToWin = room.settings.roundsToWin;
    const activeMapDef = getMapDefinition(room.settings.mapId);

    if (room.isHost) {
      this.hostSettingsWrapEl.hidden = false;
      this.guestSettingsWrapEl.hidden = true;
      this.selectTeamSize.value = String(teamSize);
      this.selectRoundsWin.value = String(roundsToWin);
      this.selectRoomMap.value = room.settings.mapId;
    } else {
      this.hostSettingsWrapEl.hidden = true;
      this.guestSettingsWrapEl.hidden = false;
      this.guestSettingsTextEl.textContent = `${teamSize}v${teamSize} · ${roundsToWin} Sieg-Runden · Karte: ${activeMapDef.name}`;
    }

    this.updateModePreviewCard();

    // Partition players into Team A & Team D
    const onlinePlayers = room.players.filter((p) => p.online);
    const teamAPlayers = room.players.filter((p) => p.team === 'A');
    const teamDPlayers = room.players.filter((p) => p.team === 'D');

    this.teamACountEl.textContent = `${teamAPlayers.filter((p) => p.online).length} / ${teamSize}`;
    this.teamDCountEl.textContent = `${teamDPlayers.filter((p) => p.online).length} / ${teamSize}`;

    const me = room.players.find((p) => p.uid === this.localUid);
    this.btnTeamA.disabled =
      me?.team === 'A' || teamAPlayers.filter((p) => p.online).length >= teamSize;
    this.btnTeamD.disabled =
      me?.team === 'D' || teamDPlayers.filter((p) => p.online).length >= teamSize;

    this.renderTeamSlots(this.teamASlotsEl, teamAPlayers, teamSize, room.hostUid, 'A');
    this.renderTeamSlots(this.teamDSlotsEl, teamDPlayers, teamSize, room.hostUid, 'D');

    const myChar: CharacterId = me?.character ?? this.soloCharacter;
    this.soloCharacter = myChar;
    this.syncSelectedCharacterChips(myChar);
    this.renderPartyBanners();
    this.renderSquadRail();

    // Footer Ready / Start controls
    const nonHostOnline = onlinePlayers.filter((p) => p.uid !== room.hostUid);
    const allGuestsReady = nonHostOnline.every((p) => p.ready);

    if (room.isHost) {
      this.btnToggleReady.hidden = true;
      this.btnStartMatch.hidden = false;
      this.btnStartMatch.disabled = !allGuestsReady;

      if (!allGuestsReady) {
        this.footerStatusHintEl.textContent =
          'Warte auf Bereit-Meldung aller verbundenen Mitspieler...';
      } else if (onlinePlayers.length === 1) {
        this.footerStatusHintEl.textContent = `Host bereit (${activeMapDef.name}) · Direktstart oder Raumcode ${room.code} teilen.`;
      } else {
        this.footerStatusHintEl.textContent = `Alle ${onlinePlayers.length} Spieler bereit · Match auf ${activeMapDef.name} startklar!`;
      }
    } else {
      this.btnStartMatch.hidden = true;
      this.btnToggleReady.hidden = false;
      const amReady = me?.ready ?? false;
      this.btnToggleReady.textContent = amReady ? 'NICHT BEREIT' : 'BEREIT';
      this.btnToggleReady.classList.toggle('is-ready-active', amReady);
      this.footerStatusHintEl.textContent = amReady
        ? `Bereit gemeldet (${activeMapDef.name}) · Warte auf Match-Start durch Host.`
        : `Wähle Team & Spezialist für ${activeMapDef.name} und klicke auf BEREIT.`;
    }
  }

  private renderTeamSlots(
    container: HTMLElement,
    players: LobbyPlayer[],
    teamSize: number,
    hostUid: string,
    teamId: TeamId
  ): void {
    container.innerHTML = '';
    const slotCount = Math.max(teamSize, players.length);
    const teamDef = TEAM_DEFS[teamId];

    for (let i = 0; i < slotCount; i += 1) {
      const p = players[i];
      const row = document.createElement('div');

      if (!p) {
        row.className = 'player-slot is-empty';
        row.innerHTML = `<span class="empty-slot-label">Freier ${teamDef.name}-Platz</span>`;
        container.appendChild(row);
        continue;
      }

      const isMe = p.uid === this.localUid;
      const isHost = p.uid === hostUid;
      const charDef = CHARACTERS[p.character] ?? CHARACTERS.ryo;

      row.className = `player-slot ${isMe ? 'is-self' : ''} ${!p.online ? 'is-offline' : ''}`;

      const leftEl = document.createElement('div');
      leftEl.className = 'slot-player-left';

      const dot = document.createElement('span');
      dot.className = `presence-dot ${p.online ? 'is-online' : 'is-offline'}`;
      leftEl.appendChild(dot);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'slot-player-name';
      nameSpan.textContent = p.name;
      leftEl.appendChild(nameSpan);

      if (isMe) {
        const selfBadge = document.createElement('span');
        selfBadge.className = 'slot-mini-tag is-self';
        selfBadge.textContent = 'DU';
        leftEl.appendChild(selfBadge);
      }
      if (isHost) {
        const hostBadge = document.createElement('span');
        hostBadge.className = 'slot-mini-tag is-host';
        hostBadge.textContent = 'HOST';
        leftEl.appendChild(hostBadge);
      }

      const rightEl = document.createElement('div');
      rightEl.className = 'slot-player-right';

      const charBadge = document.createElement('span');
      charBadge.className = 'slot-char-pill';
      charBadge.style.borderColor = charDef.accentHex;
      charBadge.textContent = charDef.name;
      rightEl.appendChild(charBadge);

      const readyBadge = document.createElement('span');
      if (!p.online) {
        readyBadge.className = 'slot-ready-badge is-wait';
        readyBadge.textContent = 'OFFLINE';
      } else if (isHost || p.ready) {
        readyBadge.className = 'slot-ready-badge is-ready';
        readyBadge.textContent = 'BEREIT';
      } else {
        readyBadge.className = 'slot-ready-badge is-wait';
        readyBadge.textContent = 'WARTET';
      }
      rightEl.appendChild(readyBadge);

      row.append(leftEl, rightEl);
      container.appendChild(row);
    }
  }

  public dispose(): void {
    if (this.copyTimer !== null) {
      window.clearTimeout(this.copyTimer);
    }
    this.closeModeDrawer();
    this.root.remove();
  }
}
