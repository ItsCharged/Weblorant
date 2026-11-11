import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACTION_PHASE_SEC,
  BUY_PHASE_SEC,
  KERN_DEFUSE_SEC,
  KERN_FUSE_SEC,
  KERN_PLANT_SEC,
  POST_ROUND_SEC,
  SIM_DT,
  START_CREDITS,
  SUDDEN_DEATH_CREDITS,
} from '../src/core/Config';
import { HAFENWERK_MAP } from '../src/data/maps/hafenwerk';
import { WEAPONS } from '../src/data/weapons';
import { HostSimulation } from '../src/game/HostSimulation';
import { RoundManager, type RoundParticipantState } from '../src/game/RoundManager';
import {
  computeEffectiveWeaponSpreadDeg,
  FALKE_HIPFIRE_PENALTY_DEG,
} from '../src/game/WeaponLogic';
import { initRapier } from '../src/physics/PhysicsWorld';

function makeParticipant(
  uid: string,
  team: 'A' | 'D',
  z: number,
): RoundParticipantState {
  return {
    uid,
    team,
    character: team === 'A' ? 'ryo' : 'tessa',
    alive: true,
    pos: { x: 0, y: 0.05, z },
    grounded: true,
    horizontalSpeed: 0,
    holdKern: false,
    hp: 100,
    credits: START_CREDITS,
    primaryWeapon: null,
    secondaryWeapon: 'funke',
    activeSlot: 2,
    armor: 0,
    armorMax: 0,
    chargesQ: 0,
    chargesE: 1,
    kills: 0,
    deaths: 0,
    assists: 0,
    plants: 0,
    defuses: 0,
    ultPoints: 0,
  };
}

function advanceSeconds(
  rm: RoundManager,
  players: RoundParticipantState[],
  seconds: number,
  stepSec = 0.25,
): void {
  let rem = seconds;
  while (rem > 1e-6) {
    const dt = Math.min(stepSec, rem);
    rm.step(dt, players);
    rem -= dt;
  }
}

describe('Phase 4 – Kernbruch Round State Machine, 50% Defuse Checkpoint, Halftime Swap, Sudden Death & Weapons', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('transitions 25s Buy -> 100s Action, blocks spawn exit during Buy Phase, and completes 4s Plant -> 40s Detonation', () => {
    expect(BUY_PHASE_SEC).toBe(25);
    expect(ACTION_PHASE_SEC).toBe(100);
    expect(KERN_PLANT_SEC).toBe(4.0);
    expect(KERN_FUSE_SEC).toBe(40.0);

    // Verify physical spawn barrier blocks movement past z = +35.5 during Buy Phase on Hafenwerk
    const sim = new HostSimulation(HAFENWERK_MAP, [
      { uid: 'a1', name: 'Angreifer', team: 'A', character: 'ryo', ready: true, online: true },
      { uid: 'd1', name: 'Verteidiger', team: 'D', character: 'tessa', ready: true, online: true },
    ]);
    const a1 = sim.getPlayer('a1')!;
    a1.motor.teleport({ x: 0, y: 0.05, z: 37.2 });
    expect(sim.roundManager.phase).toBe('buy');
    expect(sim.roundManager.barriersActive).toBe(true);

    for (let i = 1; i <= 30; i += 1) {
      sim.enqueueInput('a1', {
        seq: i,
        clientTimeMs: i * 33,
        forward: 1,
        right: 0,
        jump: false,
        crouch: false,
        walk: false,
        fire: false,
        ads: false,
        reload: false,
        yaw: 0, // facing -Z toward Mid
        pitch: 0,
      });
      sim.step(SIM_DT, i * 33);
    }
    // Blocked solidly north of z = 35.5!
    expect(a1.motor.feetPos.z).toBeGreaterThan(35.5);
    sim.dispose();

    // Pure RoundManager 25s Buy -> 100s Action -> 4s Plant at Zone A (-36, 0, -14) -> 40s Detonation
    const pA = makeParticipant('a1', 'A', 52);
    const pD = makeParticipant('d1', 'D', -52);
    const rm = new RoundManager({ roundsToWin: 7, zones: HAFENWERK_MAP.zones });
    rm.startMatch([pA, pD]);

    expect(rm.phase).toBe('buy');
    expect(rm.barriersActive).toBe(true);
    expect(rm.kern.carrierUid).toBe('a1');

    advanceSeconds(rm, [pA, pD], 25.0);
    expect(rm.phase).toBe('action');
    expect(rm.barriersActive).toBe(false);
    expect(rm.phaseRemainingSec).toBeCloseTo(100, 1);

    // Move carrier into Kern-Zone A and hold Kern for 4.0s
    pA.pos = { x: -36, y: 0, z: -14 };
    pA.holdKern = true;
    advanceSeconds(rm, [pA, pD], 2.0);
    expect(rm.kern.status).toBe('planting');
    expect(rm.kern.getProgress01()).toBeCloseTo(0.5, 2);

    advanceSeconds(rm, [pA, pD], 2.05);
    expect(rm.phase).toBe('planted');
    expect(rm.kern.status).toBe('planted');
    expect(pA.plants).toBe(1);
    expect(rm.phaseRemainingSec).toBeCloseTo(40.0, 1);

    // Let 40.0s fuse expire -> Kern detonates, Attackers win!
    advanceSeconds(rm, [pA, pD], 40.1);
    expect(rm.phase).toBe('post_round');
    expect(rm.winnerTeam).toBe('A');
    expect(rm.winReason).toBe('kern_detonated');
    expect(rm.scoreA).toBe(1);
    expect(rm.scoreB).toBe(0);
  });

  it('persists the 50% (3.5s) Kern defuse checkpoint when interrupted and completes in remaining 3.5s', () => {
    expect(KERN_DEFUSE_SEC).toBe(7.0);

    const pA = makeParticipant('a1', 'A', -36);
    const pD = makeParticipant('d1', 'D', -52);
    const rm = new RoundManager({ roundsToWin: 7, zones: HAFENWERK_MAP.zones });
    rm.startMatch([pA, pD]);

    advanceSeconds(rm, [pA, pD], 25.0);
    pA.pos = { x: -36, y: 0, z: -14 };
    pA.holdKern = true;
    advanceSeconds(rm, [pA, pD], 4.05);
    pA.holdKern = false;
    expect(rm.phase).toBe('planted');

    // Defender approaches within 2.2m of planted Kern
    pD.pos = { x: -35.2, y: 0, z: -14 };

    // 1. Defuse for 2.0s (< 3.5s), then let go -> resets back to 0!
    pD.holdKern = true;
    advanceSeconds(rm, [pD, pA], 2.0);
    expect(rm.kern.halfDefused).toBe(false);
    pD.holdKern = false;
    rm.step(0.1, [pA, pD]);
    expect(rm.kern.status).toBe('planted');
    expect(rm.kern.defuseTimerSec).toBe(0);
    expect(rm.kern.getProgress01()).toBe(0);

    // 2. Defuse for 3.75s (>= 3.5s) -> latches 50% checkpoint! Letting go resets to 3.5s (0.5 progress), NOT 0!
    pD.holdKern = true;
    advanceSeconds(rm, [pA, pD], 3.75);
    expect(rm.kern.halfDefused).toBe(true);

    pD.holdKern = false;
    rm.step(0.1, [pA, pD]);
    expect(rm.kern.status).toBe('planted');
    expect(rm.kern.halfDefused).toBe(true);
    expect(rm.kern.defuseTimerSec).toBeCloseTo(3.5, 3);
    expect(rm.kern.getProgress01()).toBeCloseTo(0.5, 3);

    // 3. Re-engage for remaining 3.5s -> completes full 7.0s defuse -> Defenders win!
    pD.holdKern = true;
    advanceSeconds(rm, [pA, pD], 3.55);
    expect(rm.phase).toBe('post_round');
    expect(rm.winnerTeam).toBe('D');
    expect(rm.winReason).toBe('kern_defused');
    expect(pD.defuses).toBe(1);
  });

  it('handles pre-plant vs post-plant team eliminations accurately (post-plant dead Attackers do NOT end round early)', () => {
    const pA = makeParticipant('a1', 'A', -36);
    const pD = makeParticipant('d1', 'D', -52);
    const rm = new RoundManager({ roundsToWin: 7, zones: HAFENWERK_MAP.zones });
    rm.startMatch([pA, pD]);
    advanceSeconds(rm, [pA, pD], 25.0);

    // Plant Kern first
    pA.pos = { x: -36, y: 0, z: -14 };
    pA.holdKern = true;
    advanceSeconds(rm, [pA, pD], 4.05);
    expect(rm.phase).toBe('planted');

    // All Attackers eliminated AFTER plant -> round MUST continue!
    pA.alive = false;
    rm.step(0.25, [pA, pD]);
    expect(rm.phase).toBe('planted');

    // Now if all Defenders die during 'planted' -> Attackers immediately win ('defenders_eliminated')!
    pD.alive = false;
    rm.step(0.25, [pA, pD]);
    expect(rm.phase).toBe('post_round');
    expect(rm.winnerTeam).toBe('A');
    expect(rm.winReason).toBe('defenders_eliminated');
  });

  it('performs Halftime Side Swap after 6 rounds (economy reset to 800), triggers 6:6 Sudden Death (5000 Splitter), and ends match at 7 wins', () => {
    const p1 = makeParticipant('u1', 'A', 52);
    const p2 = makeParticipant('u2', 'D', -52);
    const players = [p1, p2];
    const rm = new RoundManager({ roundsToWin: 7, zones: HAFENWERK_MAP.zones });
    rm.startMatch(players);

    const winCurrentRoundByEliminating = (victim: RoundParticipantState): void => {
      advanceSeconds(rm, players, BUY_PHASE_SEC + 0.1);
      expect(rm.phase).toBe('action');
      victim.alive = false;
      rm.step(0.1, players);
      expect(rm.phase).toBe('post_round');
      advanceSeconds(rm, players, POST_ROUND_SEC + 0.1);
    };

    // Play 6 rounds: u1's team ('A') wins 4, u2's team ('D') wins 2 -> score 4 : 2 before swap
    winCurrentRoundByEliminating(p2); // R1 -> 1:0
    winCurrentRoundByEliminating(p2); // R2 -> 2:0
    winCurrentRoundByEliminating(p2); // R3 -> 3:0
    winCurrentRoundByEliminating(p2); // R4 -> 4:0
    winCurrentRoundByEliminating(p1); // R5 -> 4:1
    p1.primaryWeapon = 'lanze';
    p2.primaryWeapon = 'falke';
    winCurrentRoundByEliminating(p1); // R6 -> 4:2 -> advances to R7 (Halftime Swap!)

    expect(rm.roundNumber).toBe(7);
    expect(rm.sidesSwapped).toBe(true);
    // Teams flipped & scores swapped so u1's group (now 'D') keeps 4 and u2's group (now 'A') keeps 2!
    expect(p1.team).toBe('D');
    expect(p2.team).toBe('A');
    expect(rm.scoreA).toBe(2);
    expect(rm.scoreB).toBe(4);
    expect(p1.credits).toBe(START_CREDITS);
    expect(p2.credits).toBe(START_CREDITS);
    expect(p1.primaryWeapon).toBeNull();
    expect(p2.primaryWeapon).toBeNull();

    // Push score from 2:4 to 6:6 (Sudden Death at Round 13):
    // u2 ('A') wins 4 rounds -> 6:4; u1 ('D') wins 2 rounds -> 6:6!
    winCurrentRoundByEliminating(p1); // R7 -> 3:4
    winCurrentRoundByEliminating(p1); // R8 -> 4:4
    winCurrentRoundByEliminating(p1); // R9 -> 5:4
    winCurrentRoundByEliminating(p1); // R10 -> 6:4
    winCurrentRoundByEliminating(p2); // R11 -> 6:5
    winCurrentRoundByEliminating(p2); // R12 -> 6:6 -> Sudden Death!

    expect(rm.roundNumber).toBe(13);
    expect(rm.scoreA).toBe(6);
    expect(rm.scoreB).toBe(6);
    expect(rm.isSuddenDeath).toBe(true);
    expect(p1.credits).toBe(SUDDEN_DEATH_CREDITS);
    expect(p2.credits).toBe(SUDDEN_DEATH_CREDITS);

    // Round 13 decider: u2 ('A') eliminates u1 ('D') -> 7:6 -> Match Ended!
    advanceSeconds(rm, players, BUY_PHASE_SEC + 0.1);
    p1.alive = false;
    rm.step(0.1, players);
    expect(rm.matchWinnerTeam).toBe('A');
    advanceSeconds(rm, players, POST_ROUND_SEC + 0.1);
    expect(rm.phase).toBe('ended');
    expect(rm.scoreA).toBe(7);
    expect(rm.scoreB).toBe(6);
    expect(rm.matchWinnerTeam).toBe('A');
  });

  it('enforces Falke 0° ADS first-shot spread vs +2.8° hipfire penalty and Brecher 8-pellet summed shotgun damage', () => {
    const falke = WEAPONS.falke;
    expect(computeEffectiveWeaponSpreadDeg(falke, 'stand', 0, 0, true)).toBe(0);
    expect(computeEffectiveWeaponSpreadDeg(falke, 'stand', 0, 0, false)).toBeCloseTo(
      FALKE_HIPFIRE_PENALTY_DEG,
      5,
    );

    const sim = new HostSimulation(
      HAFENWERK_MAP,
      [
        { uid: 'a1', name: 'Shotgunner', team: 'A', character: 'ryo', ready: true, online: true },
        { uid: 'd1', name: 'Target', team: 'D', character: 'tessa', ready: true, online: true },
      ],
      { initialPhase: 'action', startingPrimaryWeapon: 'brecher' },
    );

    const a1 = sim.getPlayer('a1')!;
    const d1 = sim.getPlayer('d1')!;
    // Point-blank 2.5m chest blast -> all 8 pellets fire in 1 trigger pull and sum into 1 damage event!
    a1.motor.teleport({ x: 0, y: 0, z: 48 });
    d1.motor.teleport({ x: 0, y: 0, z: 45.5 });
    const chestPitch = Math.atan2(1.05 - a1.motor.getEyePos().y, 2.5);

    sim.enqueueInput('a1', {
      seq: 1,
      clientTimeMs: 1000,
      forward: 0,
      right: 0,
      jump: false,
      crouch: false,
      walk: false,
      fire: true,
      ads: false,
      reload: false,
      yaw: 0,
      pitch: chestPitch,
    });
    const evs = sim.step(SIM_DT, 1000);
    const shotRays = evs.filter((e) => e.type === 'shot');
    const dmgEvents = evs.filter((e) => e.type === 'damage');

    expect(shotRays).toHaveLength(8);
    expect(dmgEvents).toHaveLength(1);
    if (dmgEvents[0]?.type === 'damage') {
      expect(dmgEvents[0].damage).toBeGreaterThanOrEqual(72);
    }

    sim.dispose();
  });
});
