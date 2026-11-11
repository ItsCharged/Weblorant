import { describe, expect, it } from 'vitest';
import {
  KILL_CREDITS,
  LOSS_STREAK_CREDITS,
  MAX_CREDITS,
  PLANT_BONUS_CREDITS,
  START_CREDITS,
  WIN_CREDITS,
} from '../src/core/Config';
import {
  applyNextRoundCarryoverLoadouts,
  awardKillCredits,
  createInitialPlayerEconomy,
  processBuyRequest,
  settleRoundCredits,
  type TeamLossStreaks,
} from '../src/game/Economy';

describe('Phase 4 – Splitter Economy, Loss Streaks, Carryover & Host Buy Validation', () => {
  it('starts at 800 Splitter and awards +2800 on win while progressing +1800/+2300/+2800 loss streak & resetting on win', () => {
    expect(START_CREDITS).toBe(800);
    expect(WIN_CREDITS).toBe(2800);
    expect(LOSS_STREAK_CREDITS).toEqual([1800, 2300, 2800]);

    const attacker = createInitialPlayerEconomy('a1', 'A', 'ryo');
    const defender = createInitialPlayerEconomy('d1', 'D', 'tessa');
    expect(attacker.credits).toBe(800);
    expect(defender.credits).toBe(800);

    const streaks: TeamLossStreaks = { A: 0, D: 0 };

    // Round 1: Defenders win (no plant) -> D gets +2800 (3600), A 1st loss gets +1800 (2600)
    settleRoundCredits([attacker, defender], 'D', false, streaks);
    expect(defender.credits).toBe(3600);
    expect(attacker.credits).toBe(2600);
    expect(streaks.A).toBe(1);
    expect(streaks.D).toBe(0);

    // Round 2: Defenders win again -> A 2nd consecutive loss gets +2300 (4900)
    settleRoundCredits([attacker, defender], 'D', false, streaks);
    expect(attacker.credits).toBe(4900);
    expect(streaks.A).toBe(2);

    // Round 3: Defenders win 3rd in a row -> A 3rd consecutive loss gets +2800 (7700)
    settleRoundCredits([attacker, defender], 'D', false, streaks);
    expect(attacker.credits).toBe(7700);
    expect(streaks.A).toBe(3);

    // Round 4: Attackers win -> A streak resets to 0, D starts 1st loss (+1800)
    attacker.credits = 1000;
    defender.credits = 1000;
    settleRoundCredits([attacker, defender], 'A', false, streaks);
    expect(streaks.A).toBe(0);
    expect(streaks.D).toBe(1);
    expect(attacker.credits).toBe(3800);
    expect(defender.credits).toBe(2800);
  });

  it('awards +200 per kill, +300 team plant bonus to all Attackers even on round loss, and caps strictly at 9000', () => {
    expect(KILL_CREDITS).toBe(200);
    expect(PLANT_BONUS_CREDITS).toBe(300);
    expect(MAX_CREDITS).toBe(9000);

    const a1 = createInitialPlayerEconomy('a1', 'A', 'ryo');
    const a2 = createInitialPlayerEconomy('a2', 'A', 'brann');
    const d1 = createInitialPlayerEconomy('d1', 'D', 'tessa');

    // Kill reward +200 -> 1000
    awardKillCredits(a1);
    expect(a1.credits).toBe(1000);

    // Attackers plant the Kern, then Defenders defuse & win the round:
    // Both Attackers receive 1st loss (+1800) PLUS +300 plant bonus (+2100 total)!
    const streaks: TeamLossStreaks = { A: 0, D: 0 };
    settleRoundCredits([a1, a2, d1], 'D', true, streaks);
    expect(a1.credits).toBe(1000 + 1800 + 300);
    expect(a2.credits).toBe(800 + 1800 + 300);
    expect(d1.credits).toBe(800 + 2800);

    // Cap enforcement at 9000 Splitter
    a1.credits = 8900;
    awardKillCredits(a1);
    expect(a1.credits).toBe(9000);
    settleRoundCredits([a1], 'A', true, streaks);
    expect(a1.credits).toBe(9000);
  });

  it('carries over weapons & remaining shield for survivors while resetting eliminated players to Funke + 0 shield', () => {
    const survivor = createInitialPlayerEconomy('s1', 'A', 'ryo');
    survivor.primaryWeapon = 'lanze';
    survivor.secondaryWeapon = 'bolzer';
    survivor.armor = 34;
    survivor.armorMax = 50;
    survivor.alive = true;

    const eliminated = createInitialPlayerEconomy('e1', 'D', 'mira');
    eliminated.primaryWeapon = 'falke';
    eliminated.secondaryWeapon = 'bolzer';
    eliminated.armor = 0;
    eliminated.armorMax = 50;
    eliminated.alive = false;

    applyNextRoundCarryoverLoadouts([survivor, eliminated]);

    expect(survivor.primaryWeapon).toBe('lanze');
    expect(survivor.secondaryWeapon).toBe('bolzer');
    expect(survivor.armor).toBe(34);
    expect(survivor.armorMax).toBe(50);
    expect(survivor.activeSlot).toBe(1);

    expect(eliminated.primaryWeapon).toBeNull();
    expect(eliminated.secondaryWeapon).toBe('funke');
    expect(eliminated.armor).toBe(0);
    expect(eliminated.armorMax).toBe(0);
    expect(eliminated.activeSlot).toBe(2);
  });

  it('enforces authoritative buy validation (buy phase, team spawn zone, prices, and duplicate ownership)', () => {
    const attacker = createInitialPlayerEconomy('a1', 'A', 'ryo', { x: 0, y: 0.05, z: 52 });
    attacker.credits = 5000;

    // 1. Rejects outside 'buy' phase
    const inAction = processBuyRequest(attacker, 'action', 'weapon', 'lanze');
    expect(inAction.ok).toBe(false);
    expect(inAction.reason).toBe('not_buy_phase');
    expect(attacker.primaryWeapon).toBeNull();

    // 2. Rejects when outside Attacker Spawn Zone (z < 34.5)
    attacker.pos = { x: 0, y: 0.05, z: 10 };
    const outsideSpawn = processBuyRequest(attacker, 'buy', 'weapon', 'lanze');
    expect(outsideSpawn.ok).toBe(false);
    expect(outsideSpawn.reason).toBe('outside_spawn');

    // 3. Valid buy inside South Spawn (z = 52): Lanze (2900) + Heavy Shield (1000) + Bolzer (500)
    attacker.pos = { x: 0, y: 0.05, z: 52 };
    const buyLanze = processBuyRequest(attacker, 'buy', 'weapon', 'lanze');
    expect(buyLanze.ok).toBe(true);
    expect(attacker.primaryWeapon).toBe('lanze');
    expect(attacker.activeSlot).toBe(1);
    expect(attacker.credits).toBe(2100);

    // Rejects re-buying identical weapon
    const duplicate = processBuyRequest(attacker, 'buy', 'weapon', 'lanze');
    expect(duplicate.ok).toBe(false);
    expect(duplicate.reason).toBe('already_owned');

    const buyHeavy = processBuyRequest(attacker, 'buy', 'armor', 'heavy');
    expect(buyHeavy.ok).toBe(true);
    expect(attacker.armor).toBe(50);
    expect(attacker.armorMax).toBe(50);
    expect(attacker.credits).toBe(1100);

    // Rejects Falke (4500) due to insufficient Splitter (1100 < 4500)
    const tooExpensive = processBuyRequest(attacker, 'buy', 'weapon', 'falke');
    expect(tooExpensive.ok).toBe(false);
    expect(tooExpensive.reason).toBe('insufficient_credits');

    const buyBolzer = processBuyRequest(attacker, 'buy', 'weapon', 'bolzer');
    expect(buyBolzer.ok).toBe(true);
    expect(attacker.secondaryWeapon).toBe('bolzer');
    expect(attacker.credits).toBe(600);
  });
});
