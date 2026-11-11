import type { CharacterId, TeamId } from '../core/types';

export type RoleArchetype = 'Vorstoß' | 'Aufklärer' | 'Kontrolleur' | 'Wächter';

export interface AbilitySlotDef {
  key: 'Q' | 'E' | 'X';
  name: string;
  maxCharges?: number;
  costSplitter?: number;
  ultPoints?: number;
  freePerRound?: boolean;
  summary: string;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  role: RoleArchetype;
  accentHex: string;
  accentColor: number;
  tagline: string;
  abilities: {
    q: AbilitySlotDef;
    e: AbilitySlotDef;
    ult: AbilitySlotDef;
  };
}

export interface TeamDef {
  id: TeamId;
  name: string;
  shortName: string;
  hex: string;
  color: number;
}

export const DEFAULT_CHARACTER_ID: CharacterId = 'ryo';

export const CHARACTER_IDS: readonly CharacterId[] = ['ryo', 'mira', 'brann', 'tessa'];

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  ryo: {
    id: 'ryo',
    name: 'Ryo Kade',
    role: 'Vorstoß',
    accentHex: '#ff6b2b',
    accentColor: 0xff6b2b,
    tagline: 'Schneller Durchbruch an vorderster Linie mit kinetischem Schub.',
    abilities: {
      q: {
        key: 'Q',
        name: 'Gleitschritt',
        maxCharges: 2,
        costSplitter: 150,
        summary: 'Kurzer Sprint-Dash in Laufrichtung, 0,3 s keine Waffe.',
      },
      e: {
        key: 'E',
        name: 'Adrenalin',
        maxCharges: 1,
        costSplitter: 0,
        freePerRound: true,
        summary: '4 s schnelleres Nachladen und Waffenwechsel.',
      },
      ult: {
        key: 'X',
        name: 'Überlast',
        ultPoints: 6,
        summary: '8 s erhöhte Bewegungsgeschwindigkeit, Rückstoß -30 %.',
      },
    },
  },
  mira: {
    id: 'mira',
    name: 'Mira Solen',
    role: 'Aufklärer',
    accentHex: '#38bdf8',
    accentColor: 0x38bdf8,
    tagline: 'Präzise Ortung feindlicher Rotationen durch Akustik- und Impulssensorik.',
    abilities: {
      q: {
        key: 'Q',
        name: 'Echo-Puls',
        maxCharges: 1,
        costSplitter: 250,
        summary: 'Werfbarer Sensor, markiert Gegner im Radius 12 m für 2 s.',
      },
      e: {
        key: 'E',
        name: 'Störsender',
        maxCharges: 1,
        costSplitter: 200,
        summary: 'Granate, verlangsamt Gegner im Bereich 3 s um 40 %.',
      },
      ult: {
        key: 'X',
        name: 'Weitblick',
        ultPoints: 7,
        summary: 'Enthüllt alle Gegner auf der Minimap für 3 s.',
      },
    },
  },
  brann: {
    id: 'brann',
    name: 'Brann Okafor',
    role: 'Kontrolleur',
    accentHex: '#f59e0b',
    accentColor: 0xf59e0b,
    tagline: 'Sperrt Sichtachsen und Engpässe mit dichtem Industrienebel und Thermik.',
    abilities: {
      q: {
        key: 'Q',
        name: 'Nebelkuppel',
        maxCharges: 2,
        costSplitter: 100,
        summary: 'Platziert eine undurchsichtige Rauchkugel (12 s) an anvisierter Stelle (max. 30 m).',
      },
      e: {
        key: 'E',
        name: 'Glutfeld',
        maxCharges: 1,
        costSplitter: 200,
        summary: 'Bodenbereich, 25 Schaden/s für 4 s.',
      },
      ult: {
        key: 'X',
        name: 'Dunkelzone',
        ultPoints: 7,
        summary: 'Großer Rauchring um einen Punkt für 15 s.',
      },
    },
  },
  tessa: {
    id: 'tessa',
    name: 'Tessa Vahl',
    role: 'Wächter',
    accentHex: '#18d4c9',
    accentColor: 0x18d4c9,
    tagline: 'Sichert Flanken und Kern-Zonen durch modulare Barrieren und Ankerfelder.',
    abilities: {
      q: {
        key: 'Q',
        name: 'Magnetanker',
        maxCharges: 2,
        costSplitter: 200,
        summary: 'Annäherungsmine, markiert und verlangsamt Gegner.',
      },
      e: {
        key: 'E',
        name: 'Schildpfosten',
        maxCharges: 1,
        costSplitter: 0,
        freePerRound: true,
        summary: 'Hüfthohe Barriere (400 HP) für 20 s.',
      },
      ult: {
        key: 'X',
        name: 'Bollwerk',
        ultPoints: 7,
        summary: 'Zone, in der Verbündete 6 s lang 50 % weniger Schaden nehmen.',
      },
    },
  },
};

export const CHARACTER_LIST: readonly CharacterDef[] = CHARACTER_IDS.map((id) => CHARACTERS[id]);

export const TEAM_DEFS: Record<TeamId, TeamDef> = {
  A: {
    id: 'A',
    name: 'Angreifer',
    shortName: 'ANG',
    hex: '#ff6b2b',
    color: 0xff6b2b,
  },
  D: {
    id: 'D',
    name: 'Verteidiger',
    shortName: 'VTD',
    hex: '#18d4c9',
    color: 0x18d4c9,
  },
};

export function getCharacterDef(id: CharacterId): CharacterDef {
  return CHARACTERS[id];
}

export function isValidCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && (CHARACTER_IDS as readonly string[]).includes(value);
}
