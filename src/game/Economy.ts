import {
  KILL_CREDITS,
  LOSS_STREAK_CREDITS,
  MAX_CREDITS,
  PLANT_BONUS_CREDITS,
  START_CREDITS,
  SUDDEN_DEATH_CREDITS,
  WIN_CREDITS,
} from '../core/Config';
import { clamp, vec3Clone } from '../core/math';
import type {
  ArmorTierId,
  BuyItemType,
  CharacterId,
  LoadoutSlot,
  MatchPhase,
  TeamId,
  Vec3,
  WeaponId,
} from '../core/types';
import { CHARACTERS } from '../data/characters';
import type { MapZone } from '../data/maps/types';
import { ARMOR_TIERS, WEAPON_IDS, WEAPONS } from '../data/weapons';

export const SPAWN_BUY_MIN_ABS_Z = 34.5;
export const SPAWN_BUY_ZONE_MARGIN_M = 12.0;

export const SECONDARY_WEAPON_IDS: readonly WeaponId[] = ['funke', 'bolzer'];
export const PRIMARY_WEAPON_IDS: readonly WeaponId[] = [
  'hornisse',
  'brecher',
  'lanze',
  'falke',
];

export type BuyRejectReason =
  | 'not_buy_phase'
  | 'dead'
  | 'outside_spawn'
  | 'invalid_item'
  | 'already_owned'
  | 'insufficient_credits';

export interface BuyValidationResult {
  ok: boolean;
  reason?: BuyRejectReason;
  credits: number;
  weaponId?: WeaponId;
  armor?: number;
  armorMax?: number;
  chargesQ?: number;
  chargesE?: number;
}

export interface PlayerEconomyLoadout {
  uid: string;
  team: TeamId;
  character: CharacterId;
  alive: boolean;
  pos: Vec3;
  credits: number;
  primaryWeapon: WeaponId | null;
  secondaryWeapon: WeaponId;
  activeSlot: LoadoutSlot;
  armor: number;
  armorMax: number;
  chargesQ: number;
  chargesE: number;
}

export type TeamLossStreaks = Record<TeamId, number>;

export function isValidWeaponId(value: string): value is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(value);
}

export function isSecondaryWeapon(weaponId: WeaponId): boolean {
  return weaponId === 'funke' || weaponId === 'bolzer';
}

export function isPrimaryWeapon(weaponId: WeaponId): boolean {
  return (
    weaponId === 'hornisse' ||
    weaponId === 'brecher' ||
    weaponId === 'lanze' ||
    weaponId === 'falke'
  );
}

export function clampCredits(amount: number): number {
  return clamp(Math.round(amount), 0, MAX_CREDITS);
}

/**
 * Checks whether a player is standing inside their team's Spawn Courtyard Buy Zone.
 * When map `zones` are provided, validates against the team's `spawn_attacker` / `spawn_defender`
 * zone bounds (`±12 m` courtyard margin); falls back to `SPAWN_BUY_MIN_ABS_Z = 34.5` otherwise.
 */
export function isInTeamSpawnBuyZone(
  team: TeamId,
  pos: Vec3,
  zones?: ReadonlyArray<MapZone>,
): boolean {
  if (zones && zones.length > 0) {
    const targetType = team === 'A' ? 'spawn_attacker' : 'spawn_defender';
    const spawnZone = zones.find((z) => z.type === targetType);
    if (spawnZone) {
      const halfX = Math.max(0, spawnZone.size.x * 0.5) + SPAWN_BUY_ZONE_MARGIN_M;
      const halfZ = Math.max(0, spawnZone.size.z * 0.5) + SPAWN_BUY_ZONE_MARGIN_M;
      return (
        Math.abs(pos.x - spawnZone.center.x) <= halfX &&
        Math.abs(pos.z - spawnZone.center.z) <= halfZ
      );
    }
  }

  if (team === 'A') {
    return pos.z >= SPAWN_BUY_MIN_ABS_Z;
  }
  return pos.z <= -SPAWN_BUY_MIN_ABS_Z;
}

export function getFreeAbilityECharges(character: CharacterId): number {
  const def = CHARACTERS[character];
  return def.abilities.e.freePerRound ? (def.abilities.e.maxCharges ?? 1) : 0;
}

/**
 * Refills free per-round signature abilities (`ryo` E = 1, `tessa` E = 1) while preserving
 * any unspent paid charges.
 */
export function refillFreeSignatureAbilities(
  players: Iterable<Pick<PlayerEconomyLoadout, 'character' | 'chargesE'>>,
): void {
  for (const p of players) {
    const freeE = getFreeAbilityECharges(p.character);
    if (freeE > 0) {
      p.chargesE = Math.max(p.chargesE, freeE);
    }
  }
}

export function createInitialPlayerEconomy(
  uid: string,
  team: TeamId,
  character: CharacterId,
  pos: Vec3 = { x: 0, y: 0.05, z: team === 'A' ? 52 : -52 },
): PlayerEconomyLoadout {
  return {
    uid,
    team,
    character,
    alive: true,
    pos: vec3Clone(pos),
    credits: START_CREDITS,
    primaryWeapon: null,
    secondaryWeapon: 'funke',
    activeSlot: 2,
    armor: 0,
    armorMax: 0,
    chargesQ: 0,
    chargesE: getFreeAbilityECharges(character),
  };
}

/**
 * Returns loss bonus Splitter for `consecutiveLosses` (`1` -> `1800`, `2` -> `2300`, `>= 3` -> `2800`).
 */
export function getLossBonusForStreak(consecutiveLosses: number): number {
  const idx = clamp(Math.max(1, Math.floor(consecutiveLosses)) - 1, 0, LOSS_STREAK_CREDITS.length - 1);
  return LOSS_STREAK_CREDITS[idx];
}

export function getNextRoundMinCredits(
  currentCredits: number,
  currentTeamConsecutiveLosses: number,
): number {
  return clampCredits(
    currentCredits + getLossBonusForStreak(currentTeamConsecutiveLosses + 1),
  );
}

/**
 * Awards `+200` Splitter immediately on kill (capped at `9000`).
 */
export function awardKillCredits(player: { credits: number }): number {
  player.credits = clampCredits(player.credits + KILL_CREDITS);
  return player.credits;
}

/**
 * Settles round-end Splitter rewards and updates consecutive team loss streaks:
 * - Winning team: `+2800` Splitter, consecutive loss streak resets to `0`.
 * - Losing team: `+1800` (1st loss), `+2300` (2nd consecutive), `+2800` (3rd+ consecutive).
 * - Kern planted bonus: `+300` for EVERY Attacker (`team === 'A'`), even if Attackers lose the round.
 * - All Splitter balances strictly capped at `9000`.
 */
export function settleRoundCredits(
  players: Iterable<PlayerEconomyLoadout>,
  winnerTeam: TeamId,
  kernWasPlanted: boolean,
  lossStreaks: TeamLossStreaks,
): void {
  const loserTeam: TeamId = winnerTeam === 'A' ? 'D' : 'A';
  lossStreaks[winnerTeam] = 0;
  lossStreaks[loserTeam] = (lossStreaks[loserTeam] ?? 0) + 1;

  const loserReward = getLossBonusForStreak(lossStreaks[loserTeam]);

  for (const p of players) {
    const roundReward = p.team === winnerTeam ? WIN_CREDITS : loserReward;
    const plantBonus = kernWasPlanted && p.team === 'A' ? PLANT_BONUS_CREDITS : 0;
    p.credits = clampCredits(p.credits + roundReward + plantBonus);
  }
}

/**
 * Applies survivor carryover vs death reset when preparing the next normal round:
 * - Survivors (`alive === true`): keep `primaryWeapon`, `secondaryWeapon`, and remaining `armor`/`armorMax`.
 * - Eliminated players (`!alive`): lose `primaryWeapon` (`null`), reset `secondaryWeapon = 'funke'`, `armor = 0`, `armorMax = 0`.
 */
export function applyNextRoundCarryoverLoadouts(
  players: Iterable<PlayerEconomyLoadout>,
): void {
  for (const p of players) {
    if (p.alive) {
      p.activeSlot = p.primaryWeapon ? 1 : 2;
    } else {
      p.primaryWeapon = null;
      p.secondaryWeapon = 'funke';
      p.armor = 0;
      p.armorMax = 0;
      p.activeSlot = 2;
    }
    const freeE = getFreeAbilityECharges(p.character);
    if (freeE > 0) {
      p.chargesE = Math.max(p.chargesE, freeE);
    }
  }
}

/**
 * Resets all players and loss streaks for Halftime Side Swap (`800` Splitter, `funke`, `0` armor).
 */
export function resetEconomyForHalftime(
  players: Iterable<PlayerEconomyLoadout>,
  lossStreaks: TeamLossStreaks,
): void {
  lossStreaks.A = 0;
  lossStreaks.D = 0;
  for (const p of players) {
    p.credits = START_CREDITS;
    p.primaryWeapon = null;
    p.secondaryWeapon = 'funke';
    p.armor = 0;
    p.armorMax = 0;
    p.activeSlot = 2;
    p.chargesQ = 0;
    p.chargesE = getFreeAbilityECharges(p.character);
  }
}

/**
 * Resets all players and loss streaks for Sudden Death (`5000` Splitter, `funke`, `0` armor).
 */
export function resetEconomyForSuddenDeath(
  players: Iterable<PlayerEconomyLoadout>,
  lossStreaks: TeamLossStreaks,
): void {
  lossStreaks.A = 0;
  lossStreaks.D = 0;
  for (const p of players) {
    p.credits = SUDDEN_DEATH_CREDITS;
    p.primaryWeapon = null;
    p.secondaryWeapon = 'funke';
    p.armor = 0;
    p.armorMax = 0;
    p.activeSlot = 2;
    p.chargesQ = 0;
    p.chargesE = getFreeAbilityECharges(p.character);
  }
}

/**
 * Authoritative Host validation and execution of a `buy_request`.
 * Pure TypeScript — zero 3D engine or DOM imports.
 */
export function processBuyRequest(
  player: PlayerEconomyLoadout,
  phase: MatchPhase,
  itemType: BuyItemType,
  itemId: string,
  zones?: ReadonlyArray<MapZone>,
): BuyValidationResult {
  if (phase !== 'buy') {
    return {
      ok: false,
      reason: 'not_buy_phase',
      credits: player.credits,
      armor: player.armor,
      armorMax: player.armorMax,
    };
  }

  if (!player.alive) {
    return {
      ok: false,
      reason: 'dead',
      credits: player.credits,
      armor: player.armor,
      armorMax: player.armorMax,
    };
  }

  if (!isInTeamSpawnBuyZone(player.team, player.pos, zones)) {
    return {
      ok: false,
      reason: 'outside_spawn',
      credits: player.credits,
      armor: player.armor,
      armorMax: player.armorMax,
    };
  }

  if (itemType === 'weapon') {
    if (!isValidWeaponId(itemId)) {
      return {
        ok: false,
        reason: 'invalid_item',
        credits: player.credits,
      };
    }

    const stats = WEAPONS[itemId];
    const isSec = isSecondaryWeapon(itemId);
    if (isSec && player.secondaryWeapon === itemId) {
      return {
        ok: false,
        reason: 'already_owned',
        credits: player.credits,
      };
    }
    if (!isSec && player.primaryWeapon === itemId) {
      return {
        ok: false,
        reason: 'already_owned',
        credits: player.credits,
      };
    }

    if (player.credits < stats.price) {
      return {
        ok: false,
        reason: 'insufficient_credits',
        credits: player.credits,
      };
    }

    player.credits = clampCredits(player.credits - stats.price);
    if (isSec) {
      player.secondaryWeapon = itemId;
      if (!player.primaryWeapon) {
        player.activeSlot = 2;
      }
    } else {
      player.primaryWeapon = itemId;
      player.activeSlot = 1;
    }

    return {
      ok: true,
      credits: player.credits,
      weaponId: itemId,
      armor: player.armor,
      armorMax: player.armorMax,
    };
  }

  if (itemType === 'armor') {
    if (itemId !== 'light' && itemId !== 'heavy') {
      return {
        ok: false,
        reason: 'invalid_item',
        credits: player.credits,
      };
    }

    const tier = ARMOR_TIERS[itemId as ArmorTierId];
    if (player.armor >= tier.armor && player.armorMax >= tier.armor) {
      return {
        ok: false,
        reason: 'already_owned',
        credits: player.credits,
        armor: player.armor,
        armorMax: player.armorMax,
      };
    }

    if (player.credits < tier.price) {
      return {
        ok: false,
        reason: 'insufficient_credits',
        credits: player.credits,
        armor: player.armor,
        armorMax: player.armorMax,
      };
    }

    player.credits = clampCredits(player.credits - tier.price);
    player.armor = tier.armor;
    player.armorMax = tier.armor;

    return {
      ok: true,
      credits: player.credits,
      armor: player.armor,
      armorMax: player.armorMax,
      chargesQ: player.chargesQ,
      chargesE: player.chargesE,
    };
  }

  if (itemType === 'ability_q' || itemType === 'ability_e') {
    const charDef = CHARACTERS[player.character];
    const slotDef = itemType === 'ability_q' ? charDef.abilities.q : charDef.abilities.e;
    const maxCharges = slotDef.maxCharges ?? 1;
    const cost = slotDef.costSplitter ?? 0;
    const currentCharges = itemType === 'ability_q' ? player.chargesQ : player.chargesE;

    if (currentCharges >= maxCharges) {
      return {
        ok: false,
        reason: 'already_owned',
        credits: player.credits,
      };
    }

    if (player.credits < cost) {
      return {
        ok: false,
        reason: 'insufficient_credits',
        credits: player.credits,
      };
    }

    player.credits = clampCredits(player.credits - cost);
    if (itemType === 'ability_q') {
      player.chargesQ += 1;
    } else {
      player.chargesE += 1;
    }

    return {
      ok: true,
      credits: player.credits,
      armor: player.armor,
      armorMax: player.armorMax,
      chargesQ: player.chargesQ,
      chargesE: player.chargesE,
    };
  }

  return {
    ok: false,
    reason: 'invalid_item',
    credits: player.credits,
  };
}
