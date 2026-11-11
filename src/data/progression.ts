import type { CharacterId, MapId, WeaponId } from '../core/types';
import { isValidMapId } from '../core/types';
import { CHARACTER_IDS, DEFAULT_CHARACTER_ID, isValidCharacterId } from './characters';
import { WEAPON_IDS } from './weapons';

export const PROGRESSION_STORAGE_KEY = 'shardline.career.v1';
export const MAX_MATCH_HISTORY_ENTRIES = 25;

export type ArsenalWeaponId = WeaponId | 'knife';

export const ARSENAL_WEAPON_IDS: readonly ArsenalWeaponId[] = [...WEAPON_IDS, 'knife'];

export type WeaponFinishId = 'standard' | 'arktisch' | 'glutkern' | 'titan';

export const WEAPON_FINISH_IDS: readonly WeaponFinishId[] = [
  'standard',
  'arktisch',
  'glutkern',
  'titan',
];

export interface WeaponFinishDef {
  id: WeaponFinishId;
  name: string;
  subtitle: string;
  primaryHex: string;
  accentHex: string;
}

/**
 * All weapon color schemes in SHARDLINE are 100% free and unlocked from the start
 * (zero real-money currencies, zero paid cosmetics).
 */
export const WEAPON_FINISHES: readonly WeaponFinishDef[] = [
  {
    id: 'standard',
    name: 'Werk-Standard',
    subtitle: 'Matte Industriestahl-Brünierung mit Orangen-Markierung',
    primaryHex: '#dce5ef',
    accentHex: '#ff6b2b',
  },
  {
    id: 'arktisch',
    name: 'Arktisch-Frost',
    subtitle: 'Helles Kryowerk-Weiß mit Eisblau-Akzenten',
    primaryHex: '#e8f4fc',
    accentHex: '#38bdf8',
  },
  {
    id: 'glutkern',
    name: 'Glutkern',
    subtitle: 'Dunkler Gießerei-Stahl mit glühender Kupfer-Linie',
    primaryHex: '#f6d5c1',
    accentHex: '#f97316',
  },
  {
    id: 'titan',
    name: 'Titan-Schiefer',
    subtitle: 'Eloxiertes Schiefer-Titan mit Türkis-Leuchtkante',
    primaryHex: '#cbd5e1',
    accentHex: '#18d4c9',
  },
];

export function isValidWeaponFinishId(value: unknown): value is WeaponFinishId {
  return (
    value === 'standard' ||
    value === 'arktisch' ||
    value === 'glutkern' ||
    value === 'titan'
  );
}

export function isValidArsenalWeaponId(value: unknown): value is ArsenalWeaponId {
  return (
    typeof value === 'string' &&
    (ARSENAL_WEAPON_IDS as readonly string[]).includes(value)
  );
}

export type ObjectiveId = 'headshots' | 'eliminations' | 'rounds';

export interface DailyObjective {
  id: ObjectiveId;
  title: string;
  description: string;
  current: number;
  target: number;
  completed: boolean;
  progress01: number;
  rewardXp: number;
}

export interface ObjectiveDiamondNode {
  index: number;
  thresholdXp: number;
  unlocked: boolean;
}

export interface ObjectivesSnapshot {
  objectives: DailyObjective[];
  diamonds: ObjectiveDiamondNode[];
  completedDiamonds: number;
  totalXp: number;
}

export interface ProgressDelta {
  kills?: number;
  headshots?: number;
  rounds?: number;
  kernActions?: number;
}

export type MatchOutcome = 'win' | 'loss' | 'draw' | 'training';

export interface MatchHistoryEntry {
  id: string;
  timestampMs: number;
  mapId: MapId;
  mode: 'kernbruch' | 'training';
  character: CharacterId;
  outcome: MatchOutcome;
  won: boolean;
  scoreAlly: number;
  scoreEnemy: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  kernActions: number;
}

export interface MatchHistoryInput {
  id?: string;
  timestampMs?: number;
  mapId: MapId;
  mode?: 'kernbruch' | 'training';
  character: CharacterId;
  outcome?: MatchOutcome;
  won?: boolean;
  scoreAlly: number;
  scoreEnemy: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots?: number;
  kernActions?: number;
}

export interface SpecialistPlayCount {
  character: CharacterId;
  matches: number;
  wins: number;
  kills: number;
}

export interface CareerSummary {
  totalMatches: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalHeadshots: number;
  totalRounds: number;
  totalKernActions: number;
  kdRatio: number;
  kdaRatio: number;
  kdaLabel: string;
  topSpecialist: CharacterId;
  specialistBreakdown: SpecialistPlayCount[];
  rankTitle: string;
  rankTier: number;
  rankProgress01: number;
  totalXp: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface PersistedCareerStateV1 {
  version: 1;
  counters: {
    kills: number;
    headshots: number;
    rounds: number;
    kernActions: number;
  };
  finishes: Record<ArsenalWeaponId, WeaponFinishId>;
  history: MatchHistoryEntry[];
}

const OBJECTIVE_SPECS: readonly {
  id: ObjectiveId;
  title: string;
  description: string;
  target: number;
  rewardXp: number;
}[] = [
  {
    id: 'headshots',
    title: 'Kopftreffer landen',
    description: 'Erziele präzise Kopftreffer im Match oder auf der Übungsanlage.',
    target: 15,
    rewardXp: 400,
  },
  {
    id: 'eliminations',
    title: 'Ziele & Gegner ausschalten',
    description: 'Schalte Gegner im Kernbruch-Modus oder Trainingsziele aus.',
    target: 30,
    rewardXp: 450,
  },
  {
    id: 'rounds',
    title: 'Runden bestreiten',
    description: 'Schließe taktische Einsatzrunden oder Trainingsläufe ab.',
    target: 10,
    rewardXp: 500,
  },
];

const DIAMOND_THRESHOLDS_XP: readonly [number, number, number, number] = [
  250,
  600,
  1000,
  1450,
];

const RANK_LADDER: readonly { tier: number; title: string; minXp: number }[] = [
  { tier: 1, title: 'SPLITTER-RANG I', minXp: 0 },
  { tier: 2, title: 'SPLITTER-RANG II', minXp: 450 },
  { tier: 3, title: 'SPLITTER-RANG III', minXp: 1100 },
  { tier: 4, title: 'SPLITTER-RANG IV', minXp: 2000 },
  { tier: 5, title: 'KERN-KOMMANDANT', minXp: 3200 },
];

const memoryFallbackStore = new Map<string, string>();
let customStorageOverride: StorageLike | null = null;

function resolveStorage(): StorageLike {
  if (customStorageOverride) return customStorageOverride;
  try {
    const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function'
    ) {
      return candidate;
    }
  } catch {
    // Ignore restricted storage environments and fall back to memory map
  }
  return {
    getItem: (key: string) => memoryFallbackStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryFallbackStore.set(key, value);
    },
    removeItem: (key: string) => {
      memoryFallbackStore.delete(key);
    },
  };
}

function createDefaultFinishes(): Record<ArsenalWeaponId, WeaponFinishId> {
  return {
    funke: 'standard',
    bolzer: 'standard',
    hornisse: 'standard',
    brecher: 'standard',
    lanze: 'standard',
    falke: 'standard',
    knife: 'standard',
  };
}

function createDefaultState(): PersistedCareerStateV1 {
  return {
    version: 1,
    counters: {
      kills: 0,
      headshots: 0,
      rounds: 0,
      kernActions: 0,
    },
    finishes: createDefaultFinishes(),
    history: [],
  };
}

function sanitizeNonNegInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function sanitizeHistoryEntry(raw: unknown): MatchHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const mapId: MapId = isValidMapId(obj.mapId) ? obj.mapId : 'hafenwerk';
  const character: CharacterId = isValidCharacterId(obj.character)
    ? obj.character
    : DEFAULT_CHARACTER_ID;
  const mode = obj.mode === 'training' ? 'training' : 'kernbruch';
  const scoreAlly = sanitizeNonNegInt(obj.scoreAlly);
  const scoreEnemy = sanitizeNonNegInt(obj.scoreEnemy);
  const outcome: MatchOutcome =
    obj.outcome === 'win' ||
    obj.outcome === 'loss' ||
    obj.outcome === 'draw' ||
    obj.outcome === 'training'
      ? obj.outcome
      : obj.won === true
        ? 'win'
        : obj.won === false
          ? 'loss'
          : scoreAlly > scoreEnemy
            ? 'win'
            : scoreAlly < scoreEnemy
              ? 'loss'
              : 'draw';

  return {
    id: typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : `m_${Date.now()}`,
    timestampMs:
      typeof obj.timestampMs === 'number' && Number.isFinite(obj.timestampMs)
        ? obj.timestampMs
        : Date.now(),
    mapId,
    mode,
    character,
    outcome,
    won: outcome === 'win',
    scoreAlly,
    scoreEnemy,
    kills: sanitizeNonNegInt(obj.kills),
    deaths: sanitizeNonNegInt(obj.deaths),
    assists: sanitizeNonNegInt(obj.assists),
    headshots: sanitizeNonNegInt(obj.headshots),
    kernActions: sanitizeNonNegInt(obj.kernActions),
  };
}

function loadCareerState(): PersistedCareerStateV1 {
  const storage = resolveStorage();
  try {
    const raw = storage.getItem(PROGRESSION_STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return createDefaultState();

    const countersRaw =
      parsed.counters && typeof parsed.counters === 'object'
        ? (parsed.counters as Record<string, unknown>)
        : {};

    const finishes = createDefaultFinishes();
    if (parsed.finishes && typeof parsed.finishes === 'object') {
      const fRaw = parsed.finishes as Record<string, unknown>;
      for (const weaponId of ARSENAL_WEAPON_IDS) {
        const candidate = fRaw[weaponId];
        if (isValidWeaponFinishId(candidate)) {
          finishes[weaponId] = candidate;
        }
      }
    }

    const history: MatchHistoryEntry[] = [];
    if (Array.isArray(parsed.history)) {
      for (const item of parsed.history) {
        const clean = sanitizeHistoryEntry(item);
        if (clean) history.push(clean);
        if (history.length >= MAX_MATCH_HISTORY_ENTRIES) break;
      }
    }

    return {
      version: 1,
      counters: {
        kills: sanitizeNonNegInt(countersRaw.kills),
        headshots: sanitizeNonNegInt(countersRaw.headshots),
        rounds: sanitizeNonNegInt(countersRaw.rounds),
        kernActions: sanitizeNonNegInt(countersRaw.kernActions),
      },
      finishes,
      history,
    };
  } catch {
    return createDefaultState();
  }
}

function saveCareerState(state: PersistedCareerStateV1): void {
  const storage = resolveStorage();
  try {
    storage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota errors cleanly so gameplay is never interrupted
  }
}

function computeTotalXp(state: PersistedCareerStateV1): number {
  const baseActivityXp =
    state.counters.kills * 18 +
    state.counters.headshots * 14 +
    state.counters.rounds * 35 +
    state.counters.kernActions * 45 +
    state.history.filter((m) => m.won).length * 120;

  let bonusObjectiveXp = 0;
  if (state.counters.headshots >= 15) bonusObjectiveXp += 400;
  if (state.counters.kills >= 30) bonusObjectiveXp += 450;
  if (state.counters.rounds >= 10) bonusObjectiveXp += 500;

  return baseActivityXp + bonusObjectiveXp;
}

function buildObjectivesSnapshot(state: PersistedCareerStateV1): ObjectivesSnapshot {
  const counterByObj: Record<ObjectiveId, number> = {
    headshots: state.counters.headshots,
    eliminations: state.counters.kills,
    rounds: state.counters.rounds,
  };

  const objectives: DailyObjective[] = OBJECTIVE_SPECS.map((spec) => {
    const rawVal = counterByObj[spec.id];
    const current = Math.min(spec.target, rawVal);
    const completed = rawVal >= spec.target;
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      current,
      target: spec.target,
      completed,
      progress01: Math.min(1, current / spec.target),
      rewardXp: spec.rewardXp,
    };
  });

  const totalXp = computeTotalXp(state);
  const diamonds: ObjectiveDiamondNode[] = DIAMOND_THRESHOLDS_XP.map((thresholdXp, i) => ({
    index: i + 1,
    thresholdXp,
    unlocked: totalXp >= thresholdXp,
  }));
  const completedDiamonds = diamonds.filter((d) => d.unlocked).length;

  return {
    objectives,
    diamonds,
    completedDiamonds,
    totalXp,
  };
}

/**
 * Returns the 3 tactical Einsatz-Aufträge (`Kopftreffer landen`, `Ziele & Gegner ausschalten`, `Runden bestreiten`).
 */
export function getObjectives(): DailyObjective[] {
  return buildObjectivesSnapshot(loadCareerState()).objectives;
}

/**
 * Returns the 4 diamond milestone nodes tracked alongside Einsatz-Aufträge.
 */
export function getObjectiveDiamonds(): ObjectiveDiamondNode[] {
  return buildObjectivesSnapshot(loadCareerState()).diamonds;
}

/**
 * Returns the combined objectives & 4-diamond progress snapshot.
 */
export function getObjectivesOverview(): ObjectivesSnapshot {
  return buildObjectivesSnapshot(loadCareerState());
}

/**
 * Increments persistent career/objective progress (`kills`, `headshots`, `rounds`, `kernActions`).
 */
export function recordProgress(delta: ProgressDelta): ObjectivesSnapshot {
  const state = loadCareerState();
  state.counters.kills += sanitizeNonNegInt(delta.kills);
  state.counters.headshots += sanitizeNonNegInt(delta.headshots);
  state.counters.rounds += sanitizeNonNegInt(delta.rounds);
  state.counters.kernActions += sanitizeNonNegInt(delta.kernActions);
  saveCareerState(state);
  return buildObjectivesSnapshot(state);
}

/**
 * Appends a completed match or training session to the newest-first Match-Verlauf list.
 */
export function recordMatchHistory(input: MatchHistoryInput): MatchHistoryEntry {
  const state = loadCareerState();
  const scoreAlly = sanitizeNonNegInt(input.scoreAlly);
  const scoreEnemy = sanitizeNonNegInt(input.scoreEnemy);
  const mode = input.mode === 'training' ? 'training' : 'kernbruch';
  const outcome: MatchOutcome =
    input.outcome ??
    (input.won === true
      ? 'win'
      : input.won === false
        ? 'loss'
        : mode === 'training'
          ? 'training'
          : scoreAlly > scoreEnemy
            ? 'win'
            : scoreAlly < scoreEnemy
              ? 'loss'
              : 'draw');

  const entry: MatchHistoryEntry = {
    id:
      input.id && input.id.length > 0
        ? input.id
        : `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestampMs:
      typeof input.timestampMs === 'number' && Number.isFinite(input.timestampMs)
        ? input.timestampMs
        : Date.now(),
    mapId: isValidMapId(input.mapId) ? input.mapId : 'hafenwerk',
    mode,
    character: isValidCharacterId(input.character) ? input.character : DEFAULT_CHARACTER_ID,
    outcome,
    won: outcome === 'win',
    scoreAlly,
    scoreEnemy,
    kills: sanitizeNonNegInt(input.kills),
    deaths: sanitizeNonNegInt(input.deaths),
    assists: sanitizeNonNegInt(input.assists),
    headshots: sanitizeNonNegInt(input.headshots),
    kernActions: sanitizeNonNegInt(input.kernActions),
  };

  state.history.unshift(entry);
  if (state.history.length > MAX_MATCH_HISTORY_ENTRIES) {
    state.history.length = MAX_MATCH_HISTORY_ENTRIES;
  }
  saveCareerState(state);
  return entry;
}

/**
 * Returns all persisted Match-Verlauf entries ordered newest-first.
 */
export function getMatchHistory(): MatchHistoryEntry[] {
  return loadCareerState().history;
}

/**
 * Computes aggregated career metrics (top specialist, win rate, K/D/A, tactical rank tier).
 */
export function getCareerSummary(): CareerSummary {
  const state = loadCareerState();
  const history = state.history;
  const competitiveMatches = history.filter((m) => m.mode === 'kernbruch');
  const wins = competitiveMatches.filter((m) => m.outcome === 'win').length;
  const losses = competitiveMatches.filter((m) => m.outcome === 'loss').length;
  const winRatePct =
    competitiveMatches.length > 0
      ? Math.round((wins / competitiveMatches.length) * 100)
      : 0;

  let histKills = 0;
  let histDeaths = 0;
  let histAssists = 0;
  const byChar = new Map<CharacterId, SpecialistPlayCount>();
  for (const cid of CHARACTER_IDS) {
    byChar.set(cid, { character: cid, matches: 0, wins: 0, kills: 0 });
  }

  for (const m of history) {
    histKills += m.kills;
    histDeaths += m.deaths;
    histAssists += m.assists;
    const bucket = byChar.get(m.character);
    if (bucket) {
      bucket.matches += 1;
      if (m.won) bucket.wins += 1;
      bucket.kills += m.kills;
    }
  }

  const totalKills = Math.max(state.counters.kills, histKills);
  const totalDeaths = histDeaths;
  const totalAssists = histAssists;
  const denom = Math.max(1, totalDeaths);
  const kdRatio = Math.round((totalKills / denom) * 100) / 100;
  const kdaRatio = Math.round(((totalKills + totalAssists) / denom) * 100) / 100;

  const specialistBreakdown = Array.from(byChar.values()).sort(
    (a, b) => b.matches - a.matches || b.wins - a.wins || b.kills - a.kills,
  );
  const topSpecialist: CharacterId =
    specialistBreakdown[0] && specialistBreakdown[0].matches > 0
      ? specialistBreakdown[0].character
      : DEFAULT_CHARACTER_ID;

  const totalXp = computeTotalXp(state);
  let activeRankIndex = 0;
  for (let i = 0; i < RANK_LADDER.length; i += 1) {
    if (totalXp >= RANK_LADDER[i].minXp) {
      activeRankIndex = i;
    }
  }
  const currentRank = RANK_LADDER[activeRankIndex];
  const nextRank = RANK_LADDER[activeRankIndex + 1];
  const rankProgress01 = nextRank
    ? Math.min(
        1,
        Math.max(0, (totalXp - currentRank.minXp) / (nextRank.minXp - currentRank.minXp)),
      )
    : 1;

  return {
    totalMatches: history.length,
    wins,
    losses,
    winRatePct,
    totalKills,
    totalDeaths,
    totalAssists,
    totalHeadshots: state.counters.headshots,
    totalRounds: state.counters.rounds,
    totalKernActions: state.counters.kernActions,
    kdRatio,
    kdaRatio,
    kdaLabel: `${totalKills} / ${totalDeaths} / ${totalAssists}`,
    topSpecialist,
    specialistBreakdown,
    rankTitle: currentRank.title,
    rankTier: currentRank.tier,
    rankProgress01,
    totalXp,
  };
}

/**
 * Returns the currently selected free weapon finishes for all 6 weapons + tactical knife.
 */
export function getSelectedFinishes(): Record<ArsenalWeaponId, WeaponFinishId> {
  return { ...loadCareerState().finishes };
}

/**
 * Selects a free weapon finish (`standard` | `arktisch` | `glutkern` | `titan`) for an arsenal weapon.
 */
export function setWeaponFinish(
  weaponId: ArsenalWeaponId,
  finish: WeaponFinishId,
): Record<ArsenalWeaponId, WeaponFinishId> {
  const state = loadCareerState();
  if (isValidArsenalWeaponId(weaponId) && isValidWeaponFinishId(finish)) {
    state.finishes[weaponId] = finish;
    saveCareerState(state);
  }
  return { ...state.finishes };
}

/**
 * Clears persisted career state (used by unit tests or profile reset).
 */
export function resetProgressionState(): void {
  const storage = resolveStorage();
  try {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(PROGRESSION_STORAGE_KEY);
    } else {
      storage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(createDefaultState()));
    }
  } catch {
    // Ignore storage reset failure
  }
  memoryFallbackStore.delete(PROGRESSION_STORAGE_KEY);
}

/**
 * Overrides the backing key-value store (useful for deterministic unit tests).
 */
export function setProgressionStorageForTests(storage: StorageLike | null): void {
  customStorageOverride = storage;
}
