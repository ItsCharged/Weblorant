import { beforeAll, describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/core/Config';
import { vec3Dist } from '../src/core/math';
import type { CharacterId, LobbyPlayer } from '../src/core/types';
import { HAFENWERK_MAP } from '../src/data/maps/hafenwerk';
import type { MapDefinition } from '../src/data/maps/types';
import { UEBUNGSANLAGE_MAP } from '../src/data/maps/uebungsanlage';
import { WEAPONS } from '../src/data/weapons';
import {
  ABILITY_SLOW_MULTIPLIER,
  BRANN_DARK_RING_DURATION_SEC,
  BRANN_EMBER_DURATION_SEC,
  BRANN_SMOKE_DURATION_SEC,
  BRANN_SMOKE_MAX_RANGE_M,
  computeAbilityRecoilMultiplier,
  computeAbilitySpeedMultiplier,
  RYO_UEBERLAST_DURATION_SEC,
  RYO_UEBERLAST_RECOIL_MULT,
  RYO_UEBERLAST_SPEED_MULT,
  TESSA_BASTION_DURATION_SEC,
  TESSA_SHIELD_DURATION_SEC,
  TESSA_SHIELD_HP,
} from '../src/game/AbilitySystem';
import {
  applyNextRoundCarryoverLoadouts,
  createInitialPlayerEconomy,
  processBuyRequest,
  resetEconomyForHalftime,
} from '../src/game/Economy';
import { HostSimulation } from '../src/game/HostSimulation';
import { LocalSession } from '../src/game/LocalSession';
import { getRecoilAnglesRad } from '../src/game/Recoil';
import { initRapier } from '../src/physics/PhysicsWorld';

const FLAT_ARENA_MAP: MapDefinition = {
  ...HAFENWERK_MAP,
  name: 'Testarena',
  blocks: [
    {
      id: 'arena_floor',
      pos: { x: 0, y: -0.5, z: 0 },
      size: { x: 220, y: 1, z: 220 },
      color: 0x2b3445,
      material: 'concrete',
    },
  ],
};

function makeLobbyPlayer(
  uid: string,
  team: 'A' | 'D',
  character: CharacterId,
): LobbyPlayer {
  return {
    uid,
    name: uid,
    team,
    character,
    ready: true,
    online: true,
  };
}

describe('Phase 5 – Specialist Abilities, Economy Charge Purchases & Host Validation', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('1. validates Economy ability charge buying (150/250/200/100/200), max charge caps, and free per-round refills', () => {
    const ryo = createInitialPlayerEconomy('p_ryo', 'A', 'ryo');
    ryo.credits = 1000;
    // Ryo starts with free E = 1, Q = 0
    expect(ryo.chargesQ).toBe(0);
    expect(ryo.chargesE).toBe(1);
    expect(processBuyRequest(ryo, 'buy', 'ability_e', 'e')).toMatchObject({
      ok: false,
      reason: 'already_owned',
    });

    // Ryo Q Gleitschritt costs 150, maxCharges = 2
    expect(processBuyRequest(ryo, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: true,
      credits: 850,
      chargesQ: 1,
    });
    expect(processBuyRequest(ryo, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: true,
      credits: 700,
      chargesQ: 2,
    });
    expect(processBuyRequest(ryo, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: false,
      reason: 'already_owned',
    });

    // Mira Q Echo-Puls (250, max 1) & E Störsender (200, max 1)
    const mira = createInitialPlayerEconomy('p_mira', 'A', 'mira');
    mira.credits = 500;
    expect(mira.chargesQ).toBe(0);
    expect(mira.chargesE).toBe(0);
    expect(processBuyRequest(mira, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: true,
      credits: 250,
      chargesQ: 1,
    });
    expect(processBuyRequest(mira, 'buy', 'ability_e', 'e')).toMatchObject({
      ok: true,
      credits: 50,
      chargesE: 1,
    });

    // Brann Q Nebelkuppel (100, max 2) & E Glutfeld (200, max 1)
    const brann = createInitialPlayerEconomy('p_brann', 'D', 'brann');
    brann.credits = 450;
    expect(processBuyRequest(brann, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: true,
      credits: 350,
      chargesQ: 1,
    });
    expect(processBuyRequest(brann, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: true,
      credits: 250,
      chargesQ: 2,
    });
    expect(processBuyRequest(brann, 'buy', 'ability_e', 'e')).toMatchObject({
      ok: true,
      credits: 50,
      chargesE: 1,
    });

    // Tessa Q Magnetanker (200, max 2) & free E Schildpfosten (max 1)
    const tessa = createInitialPlayerEconomy('p_tessa', 'D', 'tessa');
    tessa.credits = 500;
    expect(tessa.chargesE).toBe(1);
    expect(processBuyRequest(tessa, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: true,
      credits: 300,
      chargesQ: 1,
    });
    expect(processBuyRequest(tessa, 'buy', 'ability_q', 'q')).toMatchObject({
      ok: true,
      credits: 100,
      chargesQ: 2,
    });

    // Spend free E abilities on Ryo & Tessa and spend 1 Q on Ryo -> next round refills free E and keeps unspent Q
    ryo.chargesQ = 1;
    ryo.chargesE = 0;
    tessa.chargesE = 0;
    applyNextRoundCarryoverLoadouts([ryo, tessa]);
    expect(ryo.chargesQ).toBe(1);
    expect(ryo.chargesE).toBe(1);
    expect(tessa.chargesQ).toBe(2);
    expect(tessa.chargesE).toBe(1);

    // Halftime resets paid charges to 0 while keeping free signature E = 1
    const streaks = { A: 2, D: 1 };
    resetEconomyForHalftime([ryo, mira, brann, tessa], streaks);
    expect(ryo.chargesQ).toBe(0);
    expect(ryo.chargesE).toBe(1);
    expect(mira.chargesQ).toBe(0);
    expect(mira.chargesE).toBe(0);
    expect(tessa.chargesQ).toBe(0);
    expect(tessa.chargesE).toBe(1);
  });

  it('2. simulates Ryo Kade: Q Gleitschritt dash + 0.3s weapon lockout, E Adrenalin 1.65x reload, and X Überlast (6 pts, +25% speed, -30% recoil for 8s)', () => {
    const sim = new HostSimulation(
      FLAT_ARENA_MAP,
      [makeLobbyPlayer('ryo_1', 'A', 'ryo'), makeLobbyPlayer('foe_1', 'D', 'mira')],
      { initialPhase: 'action', startingPrimaryWeapon: 'lanze' },
    );

    const ryo = sim.getPlayer('ryo_1')!;
    ryo.motor.teleport({ x: 0, y: 0.05, z: 20 });
    ryo.yaw = 0; // looking along -Z
    ryo.chargesQ = 1;

    const startZ = ryo.pos.z;
    const castQ = sim.handleClientMessage('ryo_1', {
      type: 'ability_use',
      slot: 'q',
      yaw: 0,
      pitch: 0,
    });
    expect(castQ.some((e) => e.type === 'ability_cast' && e.abilityName === 'Gleitschritt')).toBe(
      true,
    );
    expect(sim.abilitySystem.getPlayerAbilityState(ryo).weaponLockoutSec).toBeCloseTo(0.3, 3);

    // Try firing during 0.30s lockout while stepping 7 ticks (~0.233s) -> dash moves forward ~8.5m, 0 shots fired
    let seq = 1;
    let tMs = 1000;
    const initialAmmo = ryo.inventory.activeGun!.ammoInMag;
    for (let i = 0; i < 7; i += 1) {
      sim.enqueueInput('ryo_1', {
        seq: seq++,
        clientTimeMs: tMs,
        forward: 0,
        right: 0,
        jump: false,
        crouch: false,
        walk: false,
        fire: true,
        ads: false,
        reload: false,
        yaw: 0,
        pitch: 0,
      });
      sim.step(SIM_DT, tMs);
      tMs += 33;
    }

    const dashedDistance = startZ - ryo.pos.z;
    expect(dashedDistance).toBeGreaterThan(7.5);
    expect(dashedDistance).toBeLessThan(9.2);
    expect(ryo.inventory.activeGun!.ammoInMag).toBe(initialAmmo);

    // Step past 0.30s lockout -> weapon can fire again
    for (let i = 0; i < 4; i += 1) {
      sim.enqueueInput('ryo_1', {
        seq: seq++,
        clientTimeMs: tMs,
        forward: 0,
        right: 0,
        jump: false,
        crouch: false,
        walk: false,
        fire: true,
        ads: false,
        reload: false,
        yaw: 0,
        pitch: 0,
      });
      sim.step(SIM_DT, tMs);
      tMs += 33;
    }
    expect(ryo.inventory.activeGun!.ammoInMag).toBeLessThan(initialAmmo);

    // E Adrenalin: 1.65x reload speed completes 2.5s Lanze reload in < 1.65s
    const castE = sim.handleClientMessage('ryo_1', {
      type: 'ability_use',
      slot: 'e',
      yaw: 0,
      pitch: 0,
    });
    expect(castE.some((e) => e.type === 'ability_cast' && e.abilityName === 'Adrenalin')).toBe(
      true,
    );
    ryo.inventory.activeGun!.startReload();
    for (let i = 0; i < 48; i += 1) {
      sim.step(SIM_DT, tMs);
      tMs += 33;
    }
    // 48 * (1/30) = 1.60s < 2.50s normal reload, yet reload already finished!
    expect(ryo.inventory.activeGun!.isReloading).toBe(false);
    expect(ryo.inventory.activeGun!.ammoInMag).toBe(WEAPONS.lanze.magSize);

    // X Überlast: requires 6 ult points (rejected at 5)
    ryo.ultPoints = 5;
    expect(
      sim.handleClientMessage('ryo_1', {
        type: 'ability_use',
        slot: 'x',
        yaw: 0,
        pitch: 0,
      }),
    ).toHaveLength(0);

    ryo.ultPoints = 6;
    const castX = sim.handleClientMessage('ryo_1', {
      type: 'ability_use',
      slot: 'x',
      yaw: 0,
      pitch: 0,
    });
    expect(castX.some((e) => e.type === 'ability_cast' && e.abilityName === 'Überlast')).toBe(
      true,
    );
    expect(ryo.ultPoints).toBe(0);

    const ultState = sim.abilitySystem.getPlayerAbilityState(ryo);
    expect(ultState.activeBuff).toBe('ueberlast');
    expect(ultState.buffRemainingSec).toBeCloseTo(RYO_UEBERLAST_DURATION_SEC, 3);
    expect(computeAbilitySpeedMultiplier(ultState)).toBeCloseTo(RYO_UEBERLAST_SPEED_MULT, 5);
    expect(computeAbilityRecoilMultiplier(ultState)).toBeCloseTo(RYO_UEBERLAST_RECOIL_MULT, 5);

    const rawShot4 = getRecoilAnglesRad(WEAPONS.lanze, 4);
    expect(rawShot4.pitchRad * computeAbilityRecoilMultiplier(ultState)).toBeCloseTo(
      rawShot4.pitchRad * 0.7,
      6,
    );

    sim.dispose();
  });

  it('3. simulates Mira Solen: Q Echo-Puls marks within 12m (not 16m) for 2s, E Störsender slows 40% for 3s, X Weitblick (7 pts) reveals all for 3s', () => {
    const sim = new HostSimulation(
      FLAT_ARENA_MAP,
      [
        makeLobbyPlayer('mira_1', 'A', 'mira'),
        makeLobbyPlayer('enemy_near', 'D', 'ryo'),
        makeLobbyPlayer('enemy_far', 'D', 'brann'),
      ],
      { initialPhase: 'action' },
    );

    const mira = sim.getPlayer('mira_1')!;
    const enemyNear = sim.getPlayer('enemy_near')!;
    const enemyFar = sim.getPlayer('enemy_far')!;

    mira.motor.teleport({ x: 0, y: 0.05, z: 20 });
    enemyNear.motor.teleport({ x: 8, y: 0.05, z: 0 }); // 8m from (0,0,0) -> <= 12m
    enemyFar.motor.teleport({ x: 16, y: 0.05, z: 0 }); // 16m from (0,0,0) -> > 12m

    mira.chargesQ = 1;
    mira.chargesE = 1;

    // Cast Q Echo-Puls landing at (0, 0, 0)
    const castQ = sim.handleClientMessage('mira_1', {
      type: 'ability_use',
      slot: 'q',
      yaw: 0,
      pitch: 0,
      targetPos: { x: 0, y: 0, z: 0 },
    });
    expect(castQ.some((e) => e.type === 'ability_cast' && e.abilityName === 'Echo-Puls')).toBe(
      true,
    );

    const nearState = sim.abilitySystem.getPlayerAbilityState(enemyNear);
    const farState = sim.abilitySystem.getPlayerAbilityState(enemyFar);
    expect(nearState.revealedSec).toBeCloseTo(2.0, 2);
    expect(nearState.revealedToTeam).toBe('A');
    expect(farState.revealedSec).toBe(0);
    expect(farState.revealedToTeam).toBeNull();

    // Advance 2.1s -> reveal expires cleanly
    sim.step(2.1, 2000);
    expect(sim.abilitySystem.getPlayerAbilityState(enemyNear).revealedSec).toBe(0);

    // Cast E Störsender at enemyNear's position -> slows by 40% (0.60x) for 3.0s
    const castE = sim.handleClientMessage('mira_1', {
      type: 'ability_use',
      slot: 'e',
      yaw: 0,
      pitch: 0,
      targetPos: { x: 8, y: 0, z: 0 },
    });
    expect(castE.some((e) => e.type === 'ability_cast' && e.abilityName === 'Störsender')).toBe(
      true,
    );
    const slowedState = sim.abilitySystem.getPlayerAbilityState(enemyNear);
    expect(slowedState.slowedSec).toBeCloseTo(3.0, 2);
    expect(computeAbilitySpeedMultiplier(slowedState)).toBeCloseTo(ABILITY_SLOW_MULTIPLIER, 5);

    // X Weitblick requires 7 ult points and reveals ALL alive enemies on the map for 3.0s
    mira.ultPoints = 6;
    expect(
      sim.handleClientMessage('mira_1', {
        type: 'ability_use',
        slot: 'x',
        yaw: 0,
        pitch: 0,
      }),
    ).toHaveLength(0);

    mira.ultPoints = 7;
    const castX = sim.handleClientMessage('mira_1', {
      type: 'ability_use',
      slot: 'x',
      yaw: 0,
      pitch: 0,
    });
    expect(castX.some((e) => e.type === 'ability_cast' && e.abilityName === 'Weitblick')).toBe(
      true,
    );
    expect(sim.abilitySystem.getPlayerAbilityState(enemyNear).revealedSec).toBeCloseTo(3.0, 2);
    expect(sim.abilitySystem.getPlayerAbilityState(enemyFar).revealedSec).toBeCloseTo(3.0, 2);
    expect(sim.abilitySystem.getPlayerAbilityState(enemyFar).revealedToTeam).toBe('A');

    sim.dispose();
  });

  it('4. simulates Brann Okafor: Q Nebelkuppel clamps <= 30m for 12s, E Glutfeld deals 25 dmg/s (100 over 4s), X Dunkelzone lasts 15s', () => {
    const sim = new HostSimulation(
      FLAT_ARENA_MAP,
      [makeLobbyPlayer('brann_1', 'A', 'brann'), makeLobbyPlayer('victim_1', 'D', 'ryo')],
      { initialPhase: 'action' },
    );

    const brann = sim.getPlayer('brann_1')!;
    const victim = sim.getPlayer('victim_1')!;
    brann.motor.teleport({ x: 0, y: 0.05, z: 30 });
    victim.motor.teleport({ x: 0, y: 0.05, z: 15 });

    brann.chargesQ = 1;
    brann.chargesE = 1;
    brann.ultPoints = 7;

    // Request smoke 75m away -> strictly clamped to <= 30.0m from Brann, duration 12.0s
    sim.handleClientMessage('brann_1', {
      type: 'ability_use',
      slot: 'q',
      yaw: 0,
      pitch: 0,
      targetPos: { x: 0, y: 0, z: -45 },
    });
    const smoke = sim.abilitySystem.getEffects().find((e) => e.kind === 'smoke_dome');
    expect(smoke).toBeDefined();
    expect(smoke!.remainingSec).toBeCloseTo(BRANN_SMOKE_DURATION_SEC, 3);
    expect(vec3Dist(smoke!.pos, brann.pos)).toBeLessThanOrEqual(BRANN_SMOKE_MAX_RANGE_M + 1e-3);

    // X Dunkelzone (7 pts) -> hollow smoke ring lasting 15.0s
    sim.handleClientMessage('brann_1', {
      type: 'ability_use',
      slot: 'x',
      yaw: 0,
      pitch: 0,
      targetPos: { x: 0, y: 0, z: 5 },
    });
    const ring = sim.abilitySystem.getEffects().find((e) => e.kind === 'dark_ring');
    expect(ring).toBeDefined();
    expect(ring!.remainingSec).toBeCloseTo(BRANN_DARK_RING_DURATION_SEC, 3);
    expect(ring!.radius).toBeCloseTo(9.5, 2);
    expect(ring!.innerRadius).toBeCloseTo(7.1, 2);

    // E Glutfeld at victim's feet -> 25 dmg/s over 4.0s = 100 total damage (eliminates 100 HP victim & credits Brann!)
    const startCredits = brann.credits;
    const startUlt = brann.ultPoints;
    sim.handleClientMessage('brann_1', {
      type: 'ability_use',
      slot: 'e',
      yaw: 0,
      pitch: 0,
      targetPos: { x: 0, y: 0, z: 15 },
    });
    const ember = sim.abilitySystem.getEffects().find((e) => e.kind === 'ember_field');
    expect(ember).toBeDefined();
    expect(ember!.remainingSec).toBeCloseTo(BRANN_EMBER_DURATION_SEC, 3);

    // After 2.0s (60 ticks at 30Hz): victim took ~50 damage (alive with ~50 HP)
    let nowMs = 3000;
    for (let i = 0; i < 60; i += 1) {
      sim.step(SIM_DT, nowMs);
      nowMs += 33;
    }
    expect(victim.hp).toBe(50);
    expect(victim.alive).toBe(true);

    // Remaining 2.0s (60 ticks): total 100 damage -> victim eliminated, Brann gets kill + 200 Splitter + 1 Ult
    for (let i = 0; i < 60; i += 1) {
      sim.step(SIM_DT, nowMs);
      nowMs += 33;
    }
    expect(victim.hp).toBe(0);
    expect(victim.alive).toBe(false);
    expect(brann.kills).toBe(1);
    expect(brann.ultPoints).toBe(startUlt + 1);
    expect(brann.credits).toBeGreaterThanOrEqual(startCredits + 200);

    sim.dispose();
  });

  it('5. simulates Tessa Vahl: Q Magnetanker proximity slow+mark, E Schildpfosten 400 HP physical barrier, and X Bollwerk 50% damage reduction', () => {
    const sim = new HostSimulation(
      FLAT_ARENA_MAP,
      [
        makeLobbyPlayer('tessa_1', 'D', 'tessa'),
        makeLobbyPlayer('ally_1', 'D', 'mira'),
        makeLobbyPlayer('attacker_1', 'A', 'ryo'),
      ],
      { initialPhase: 'action', startingPrimaryWeapon: 'lanze' },
    );

    const tessa = sim.getPlayer('tessa_1')!;
    const ally = sim.getPlayer('ally_1')!;
    const attacker = sim.getPlayer('attacker_1')!;

    tessa.motor.teleport({ x: 0, y: 0.05, z: -10 });
    tessa.yaw = Math.PI; // looking toward +Z (toward attacker)
    ally.motor.teleport({ x: 3.0, y: 0.05, z: -10 }); // 3m from Tessa (inside 7.5m Bollwerk)
    attacker.motor.teleport({ x: 0, y: 0.05, z: 6 });
    attacker.yaw = 0; // looking toward -Z (toward Tessa)
    attacker.motor.syncWorldQueries();
    tessa.motor.syncWorldQueries();
    ally.motor.syncWorldQueries();

    // 5a. Q Magnetanker placed at (0, 0, -2): arms after 0.6s, triggers when attacker enters <= 3.8m
    tessa.chargesQ = 1;
    sim.handleClientMessage('tessa_1', {
      type: 'ability_use',
      slot: 'q',
      yaw: Math.PI,
      pitch: 0,
      targetPos: { x: 0, y: 0, z: -2 },
    });
    const mine = sim.abilitySystem.getEffects().find((e) => e.kind === 'magnet_mine');
    expect(mine).toBeDefined();
    expect(mine!.armed).toBe(false);

    // Arm the mine (0.7s) while attacker is at z = +6 (8m away -> > 3.8m)
    sim.step(0.7, 1000);
    expect(sim.abilitySystem.getEffects().find((e) => e.kind === 'magnet_mine')?.armed).toBe(true);

    // Move attacker within 3.8m of (0, 0, -2) -> triggers slow + mark for 2.5s
    attacker.motor.teleport({ x: 0, y: 0.05, z: 1.2 });
    const triggerStepEvents = sim.step(SIM_DT, 1100);
    expect(
      triggerStepEvents.some(
        (e) => e.type === 'effect_event' && e.kind === 'magnet_mine' && e.action === 'triggered',
      ),
    ).toBe(true);
    const attackerDebuff = sim.abilitySystem.getPlayerAbilityState(attacker);
    expect(attackerDebuff.slowedSec).toBeCloseTo(2.5, 2);
    expect(attackerDebuff.revealedSec).toBeCloseTo(2.5, 2);
    expect(attackerDebuff.revealedToTeam).toBe('D');

    // 5b. E Schildpfosten: 400 HP physical barrier 2.4m ahead of Tessa for 20s; absorbs 10 Lanze body shots (10 * 40 = 400)
    tessa.chargesE = 1;
    tessa.motor.teleport({ x: 0, y: 0.05, z: -10 });
    tessa.yaw = Math.PI; // barrier spawns at z ≈ -7.6, height 1.15m
    sim.handleClientMessage('tessa_1', {
      type: 'ability_use',
      slot: 'e',
      yaw: Math.PI,
      pitch: 0,
    });

    const shield = sim.abilitySystem.getEffects().find((e) => e.kind === 'shield_post');
    expect(shield).toBeDefined();
    expect(shield!.hp).toBe(TESSA_SHIELD_HP);
    expect(shield!.remainingSec).toBeCloseTo(TESSA_SHIELD_DURATION_SEC, 2);

    // Crouch Tessa behind the waist-high barrier so shots at y = 0.85m hit the barrier instead of Tessa!
    attacker.motor.teleport({ x: 0, y: 0.05, z: 0 });
    attacker.motor.syncWorldQueries();
    // Attacker eye is at y ≈ 1.67; pitch slightly downward (-0.11 rad) so ray crosses z = -7.6 at y ≈ 0.83 (< 1.15m barrier top)
    let seq = 1;
    let clockMs = 2000;
    let destroyedEventSeen = false;

    for (let shot = 0; shot < 10; shot += 1) {
      // Advance 4 ticks between shots to clear Lanze fire interval (1 / 9.5s ≈ 0.105s) and reset recoil
      for (let idle = 0; idle < 8; idle += 1) {
        sim.step(SIM_DT, clockMs);
        clockMs += 33;
      }
      attacker.recoil.reset();
      sim.enqueueInput('attacker_1', {
        seq: seq++,
        clientTimeMs: clockMs,
        forward: 0,
        right: 0,
        jump: false,
        crouch: false,
        walk: false,
        fire: true,
        ads: false,
        reload: false,
        yaw: 0,
        pitch: -0.11,
      });
      const shotEvents = sim.step(SIM_DT, clockMs);
      clockMs += 33;
      if (
        shotEvents.some(
          (e) => e.type === 'effect_event' && e.kind === 'shield_post' && e.action === 'destroyed',
        )
      ) {
        destroyedEventSeen = true;
      }
    }

    expect(tessa.hp).toBe(100);
    expect(destroyedEventSeen).toBe(true);
    expect(sim.abilitySystem.getEffects().find((e) => e.kind === 'shield_post')).toBeUndefined();

    // 5c. X Bollwerk (7 pts): halves incoming damage (50%) for allies inside 7.5m for 6.0s
    tessa.ultPoints = 7;
    sim.handleClientMessage('tessa_1', {
      type: 'ability_use',
      slot: 'x',
      yaw: Math.PI,
      pitch: 0,
    });
    const bastion = sim.abilitySystem.getEffects().find((e) => e.kind === 'bastion_zone');
    expect(bastion).toBeDefined();
    expect(bastion!.remainingSec).toBeCloseTo(TESSA_BASTION_DURATION_SEC, 2);
    expect(sim.abilitySystem.getPlayerAbilityState(tessa).bastionProtected).toBe(true);
    expect(sim.abilitySystem.getPlayerAbilityState(ally).bastionProtected).toBe(true);

    // Shoot Tessa once in the body with Lanze (40 raw body damage -> reduced by 50% to 20 damage!)
    for (let idle = 0; idle < 8; idle += 1) {
      sim.step(0.02, clockMs);
      clockMs += 20;
    }
    attacker.recoil.reset();
    attacker.inventory.activeGun!.refillAmmo();
    // Aim straight at Tessa's torso (attacker at z = 0, Tessa at z = -10, pitch = -0.06 -> y ≈ 1.07)
    sim.enqueueInput('attacker_1', {
      seq: seq++,
      clientTimeMs: clockMs,
      forward: 0,
      right: 0,
      jump: false,
      crouch: false,
      walk: false,
      fire: true,
      ads: false,
      reload: false,
      yaw: 0,
      pitch: -0.06,
    });
    sim.step(SIM_DT, clockMs);
    expect(tessa.hp).toBe(80); // 100 - (40 * 0.5) = 80!

    sim.dispose();
  });

  it('6. supports Offline LocalSession Specialist switching and infinite ability testing on Übungsanlage', () => {
    const local = new LocalSession(UEBUNGSANLAGE_MAP);
    expect(local.characterId).toBe('ryo');
    expect(local.castAbility('q')).toBe(true);

    local.setCharacter('tessa');
    expect(local.characterId).toBe('tessa');
    expect(local.getAbilityState().ultMax).toBe(7);
    expect(local.castAbility('e')).toBe(true);
    expect(local.getActiveEffects().some((e) => e.kind === 'shield_post')).toBe(true);

    local.setCharacter('brann');
    expect(local.getActiveEffects()).toHaveLength(0);
    expect(local.castAbility('q')).toBe(true);
    expect(local.getActiveEffects().some((e) => e.kind === 'smoke_dome')).toBe(true);

    local.dispose();
  });
});
