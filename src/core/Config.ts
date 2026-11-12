import type { GameSettings, KeybindAction, KeybindMap } from './types';
export type { GameSettings, KeybindAction, KeybindMap };

export const SIM_TICK_RATE = 30;
export const SIM_DT = 1 / 30;

export const PLAYER_RADIUS = 0.38;
export const STAND_HEIGHT = 1.78;
export const CROUCH_HEIGHT = 1.22;
export const STAND_EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.08;

export const RUN_SPEED = 5.6;
export const WALK_SPEED = 3.0;
export const CROUCH_SPEED = 2.4;
export const JUMP_SPEED = 7.2;
export const GRAVITY = -22.0;

export const PITCH_LIMIT = 1.52;
export const MOUSE_RAD_PER_COUNT = 0.0022;

export const BUY_PHASE_SEC = 25;
export const ACTION_PHASE_SEC = 100;
export const KERN_PLANT_SEC = 4.0;
export const KERN_FUSE_SEC = 40.0;
export const KERN_DEFUSE_SEC = 7.0;
export const KERN_DEFUSE_CHECKPOINT = 0.5;
export const POST_ROUND_SEC = 4.5;

export const START_CREDITS = 800;
export const MAX_CREDITS = 9000;
export const WIN_CREDITS = 2800;
export const LOSS_STREAK_CREDITS = [1800, 2300, 2800] as const;
export const KILL_CREDITS = 200;
export const PLANT_BONUS_CREDITS = 300;
export const SUDDEN_DEATH_CREDITS = 5000;

export const KNIFE_RUN_SPEED = 6.15;

export const LAG_COMP_HISTORY_MS = 1000;
export const LAG_COMP_MAX_REWIND_MS = 200;

export const SPAWN_BARRIER_Z = 35.5;

export const KEYBINDS_STORAGE_KEY = 'shardline.keybinds';

export const KEYBIND_ACTIONS: readonly KeybindAction[] = [
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'jump',
  'walk',
  'crouch',
  'reload',
  'slot1',
  'slot2',
  'slot3',
  'kernInteract',
  'abilityQ',
  'abilityE',
  'abilityUlt',
  'zoomCycle',
  'buyMenu',
  'scoreboard',
  'abilityInfo',
  'specialistSelect',
  'debugOverlay',
  'mapSwitchOffline',
] as const;

export const DEFAULT_KEYBINDS: KeybindMap = {
  moveForward: 'KeyW',
  moveBack: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  walk: 'ShiftLeft',
  crouch: 'ControlLeft',
  reload: 'KeyR',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  kernInteract: 'Digit4',
  abilityQ: 'KeyQ',
  abilityE: 'KeyE',
  abilityUlt: 'KeyX',
  zoomCycle: 'KeyZ',
  buyMenu: 'KeyB',
  scoreboard: 'Tab',
  abilityInfo: 'F1',
  specialistSelect: 'F2',
  debugOverlay: 'F3',
  mapSwitchOffline: 'KeyM',
};

export type KeybindCategory = 'movement' | 'combat' | 'abilities' | 'menus';

export interface KeybindActionMeta {
  action: KeybindAction;
  label: string;
  description: string;
  category: KeybindCategory;
}

export const KEYBIND_ACTION_META: readonly KeybindActionMeta[] = [
  { action: 'moveForward', label: 'Vorwärts bewegen', description: 'In Blickrichtung laufen', category: 'movement' },
  { action: 'moveBack', label: 'Rückwärts bewegen', description: 'Zurückweichen', category: 'movement' },
  { action: 'moveLeft', label: 'Nach links strafen', description: 'Seitwärts nach links bewegen', category: 'movement' },
  { action: 'moveRight', label: 'Nach rechts strafen', description: 'Seitwärts nach rechts bewegen', category: 'movement' },
  { action: 'jump', label: 'Springen', description: 'Hindernisse überwinden', category: 'movement' },
  { action: 'walk', label: 'Schleichen (Gehen)', description: 'Lautloses Bewegen mit höherer Präzision', category: 'movement' },
  { action: 'crouch', label: 'Ducken', description: 'Niedrige Haltung & reduzierte Rückstoßstreuung', category: 'movement' },
  { action: 'slot1', label: 'Primärwaffe (Slot 1)', description: 'Gewehr / MP / Schrotflinte ausrüsten', category: 'combat' },
  { action: 'slot2', label: 'Sekundärwaffe (Slot 2)', description: 'Pistole (Funke / Bolzer) ausrüsten', category: 'combat' },
  { action: 'slot3', label: 'Taktik-Klinge (Slot 3)', description: 'Nahkampfklinge für maximales Lauftempo', category: 'combat' },
  { action: 'reload', label: 'Waffe nachladen', description: 'Aktuelles Magazin nachladen', category: 'combat' },
  { action: 'zoomCycle', label: 'Visier-Zoomstufe wechseln', description: 'Bei gehaltenem Rechtsklick Zoom umschalten', category: 'combat' },
  { action: 'abilityQ', label: 'Taktische Fähigkeit [Q]', description: 'Erste Spezialisten-Fähigkeit aktivieren', category: 'abilities' },
  { action: 'abilityE', label: 'Signatur-Fähigkeit [E]', description: 'Zweite Spezialisten-Fähigkeit aktivieren', category: 'abilities' },
  { action: 'abilityUlt', label: 'Ultimate-Fähigkeit [X]', description: 'Ultimative Fähigkeit aktivieren', category: 'abilities' },
  { action: 'kernInteract', label: 'Kern platzieren / entschärfen', description: 'Gedrückt halten, um Kern zu legen oder zu entschärfen', category: 'abilities' },
  { action: 'buyMenu', label: 'Ausrüstungs-Arsenal (Kaufmenü)', description: 'Waffen, Schilde & Fähigkeiten kaufen', category: 'menus' },
  { action: 'scoreboard', label: 'Taktik-Übersicht (Scoreboard)', description: 'Gedrückt halten für Team- & Rundenstatistik', category: 'menus' },
  { action: 'abilityInfo', label: 'Fähigkeits-Referenz einblenden', description: 'Kompakte Übersicht des aktiven Spezialisten', category: 'menus' },
  { action: 'specialistSelect', label: 'Spezialist wechseln (Training)', description: 'Schnellwahl im Offline-Training öffnen', category: 'menus' },
  { action: 'mapSwitchOffline', label: 'Karte wechseln (Training)', description: 'Zwischen allen 4 Karten im Offline-Modus wechseln', category: 'menus' },
  { action: 'debugOverlay', label: 'System- & Netcode-Telemetrie', description: 'FPS, Tickrate, RTT & Paketverlust anzeigen', category: 'menus' },
];

export interface KeybindConflict {
  code: string;
  actions: KeybindAction[];
}

/**
 * Checks a `KeybindMap` for duplicate key assignments and returns all conflicts
 * where two or more actions are bound to the same physical key code.
 */
export function findKeybindConflicts(keybinds: KeybindMap): KeybindConflict[] {
  const byCode = new Map<string, KeybindAction[]>();
  for (const action of KEYBIND_ACTIONS) {
    const raw = keybinds[action];
    if (!raw || typeof raw !== 'string') continue;
    const code = raw.trim();
    if (!code) continue;
    const list = byCode.get(code);
    if (list) {
      list.push(action);
    } else {
      byCode.set(code, [action]);
    }
  }
  const conflicts: KeybindConflict[] = [];
  for (const [code, actions] of byCode.entries()) {
    if (actions.length > 1) {
      conflicts.push({ code, actions });
    }
  }
  return conflicts;
}

/**
 * Formats a DOM `KeyboardEvent.code` into a clean, readable German tactical UI keycap label.
 */
export function formatKeyCodeLabel(code: string): string {
  if (!code || typeof code !== 'string') return '—';
  const trimmed = code.trim();
  if (!trimmed) return '—';
  if (trimmed.startsWith('Key') && trimmed.length === 4) {
    return trimmed.slice(3).toUpperCase();
  }
  if (trimmed.startsWith('Digit') && trimmed.length === 6) {
    return trimmed.slice(5);
  }
  if (trimmed.startsWith('Numpad')) {
    return `NUM ${trimmed.slice(6).toUpperCase()}`;
  }
  const SPECIAL_LABELS: Record<string, string> = {
    Space: 'LEERTASTE',
    ShiftLeft: 'UMSCHALT L',
    ShiftRight: 'UMSCHALT R',
    ControlLeft: 'STRG L',
    ControlRight: 'STRG R',
    AltLeft: 'ALT L',
    AltRight: 'ALT R',
    Tab: 'TAB',
    Enter: 'EINGABE',
    Backspace: 'RÜCKTASTE',
    CapsLock: 'FESTSTELL',
    Escape: 'ESC',
    ArrowUp: 'PFEIL ↑',
    ArrowDown: 'PFEIL ↓',
    ArrowLeft: 'PFEIL ←',
    ArrowRight: 'PFEIL →',
    Backquote: '^',
    Minus: 'ß / -',
    Equal: '´ / =',
    BracketLeft: 'Ü / [',
    BracketRight: '+ / ]',
    Semicolon: 'Ö / ;',
    Quote: 'Ä / \'',
    Backslash: '# / \\',
    Comma: ',',
    Period: '.',
    Slash: '-',
  };
  return SPECIAL_LABELS[trimmed] ?? trimmed.toUpperCase();
}

export function mergeKeybinds(partial?: Partial<Record<string, unknown>> | null): KeybindMap {
  const merged: KeybindMap = { ...DEFAULT_KEYBINDS };
  if (!partial || typeof partial !== 'object') return merged;
  for (const action of KEYBIND_ACTIONS) {
    const val = partial[action];
    if (typeof val === 'string' && val.trim().length > 0) {
      merged[action] = val.trim();
    }
  }
  return merged;
}

export function loadSavedKeybinds(): KeybindMap {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(KEYBINDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
        return mergeKeybinds(parsed);
      }
    }
  } catch {
    // Fallback to defaults if localStorage is unavailable or corrupt
  }
  return { ...DEFAULT_KEYBINDS };
}

export function saveKeybinds(keybinds: KeybindMap): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(KEYBINDS_STORAGE_KEY, JSON.stringify(keybinds));
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: 'high',
  sensitivity: 1.0,
  fov: 90,
  volume: 0.7,
  crosshair: {
    color: '#18d4c9',
    size: 8,
    thickness: 2,
    gap: 4,
    dynamicSpread: true,
  },
  keybinds: { ...DEFAULT_KEYBINDS },
};
