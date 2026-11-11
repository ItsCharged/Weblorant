import { beforeAll, describe, expect, it } from 'vitest';
import { LAG_COMP_MAX_REWIND_MS, SIM_DT } from '../src/core/Config';
import { aimDirectionFromAngles } from '../src/core/math';
import type { MapDefinition } from '../src/data/maps/types';
import { HostSimulation } from '../src/game/HostSimulation';
import { performPvpHitscan } from '../src/game/PlayerHitscan';
import { LagCompensation } from '../src/net/LagCompensation';
import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';

const FLAT_ARENA: MapDefinition = {
  id: 'hafenwerk',
  name: 'LagCompArena',
  subtitle: 'Lag Compensation Test Arena',
  bounds: { width: 128, depth: 128 },
  playerSpawn: { pos: { x: 0, y: 0.05, z: 52 }, yaw: 0 },
  blocks: [
    {
      id: 'floor',
      pos: { x: 0, y: -0.5, z: 0 },
      size: { x: 128, y: 1.0, z: 128 },
      color: 0x3b434d,
      material: 'asphalt',
    },
  ],
  zones: [],
  dummySpawns: [],
};

describe('Phase 4 – Authoritative Lag Compensation (1000ms History & Strict 200ms Anti-Cheat Clamp)', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('hits a moving target at 120ms rewind where an un-rewound (0ms) raycast misses', () => {
    const world = new PhysicsWorld(FLAT_ARENA);
    const lagComp = new LagCompensation();

    // Enemy sprints laterally along +X at 10 m/s across z = -15:
    // At t = 880 ms (120 ms ago): x = 0.0 (directly in shooter's crosshair!)
    // At t = 1000 ms (now):       x = 1.2 (well outside 0.34m body radius!)
    for (let t = 800; t <= 1000; t += 20) {
      const x = ((t - 880) / 1000) * 10.0;
      lagComp.recordFrame(t, [
        {
          uid: 'runner',
          team: 'D',
          alive: true,
          pos: { x, y: 0, z: -15 },
          stance: 'stand',
        },
      ]);
    }

    const shooterOrigin = { x: 0, y: 1.62, z: 5 };
    const headPitch = Math.atan2(1.56 - shooterOrigin.y, 20);
    const aimDir = aimDirectionFromAngles(0, headPitch);

    // 1. Un-rewound (0ms) at serverTime = 1000ms -> runner is at x = +1.2m -> MISS ('world' / 'none')
    const currentTargets = lagComp.getRewoundTargets(1000, 0);
    expect(currentTargets[0].pos.x).toBeCloseTo(1.2, 4);
    const missHit = performPvpHitscan(
      shooterOrigin,
      aimDir,
      150,
      world,
      currentTargets,
      'shooter',
      'A',
    );
    expect(missHit.targetUid).toBeUndefined();

    // 2. Rewound by 120ms (targetTime = 880ms) -> runner interpolated at x = 0.0m -> HEADSHOT HIT!
    const rewoundTargets = lagComp.getRewoundTargets(1000, 120);
    expect(rewoundTargets[0].pos.x).toBeCloseTo(0.0, 4);
    const rewoundHit = performPvpHitscan(
      shooterOrigin,
      aimDir,
      150,
      world,
      rewoundTargets,
      'shooter',
      'A',
    );
    expect(rewoundHit.targetUid).toBe('runner');
    expect(rewoundHit.hitZone).toBe('head');

    world.dispose();
  });

  it('strictly clamps requested 350ms rewind to 200ms (LAG_COMP_MAX_REWIND_MS)', () => {
    expect(LAG_COMP_MAX_REWIND_MS).toBe(200);

    const lagComp = new LagCompensation();
    // Target moves along +X at 10 m/s from t = 500ms (x = -5.0) to t = 1000ms (x = 0.0)
    // At t = 650ms (350ms ago): x = -3.5m
    // At t = 800ms (200ms ago): x = -2.0m
    for (let t = 500; t <= 1000; t += 50) {
      const x = ((t - 1000) / 1000) * 10.0;
      lagComp.recordFrame(t, [
        {
          uid: 'target',
          team: 'D',
          alive: true,
          pos: { x, y: 0, z: -10 },
          stance: 'stand',
        },
      ]);
    }

    expect(lagComp.getEffectiveRewindMs(350)).toBe(200);
    const clamped = lagComp.getRewoundTargets(1000, 350);
    expect(clamped).toHaveLength(1);
    // Clamped strictly to t = 1000 - 200 = 800ms -> x = -2.0m (NOT -3.5m!)
    expect(clamped[0].pos.x).toBeCloseTo(-2.0, 4);

    // Also verify end-to-end inside HostSimulation with a 600ms RTT peer (`600*0.5 + 100 = 400ms` -> clamped to `200ms`):
    const sim = new HostSimulation(
      FLAT_ARENA,
      [
        { uid: 'host', name: 'Host', team: 'A', character: 'ryo', ready: true, online: true },
        { uid: 'laggy', name: 'LaggyClient', team: 'A', character: 'brann', ready: true, online: true },
        { uid: 'enemy', name: 'Runner', team: 'D', character: 'tessa', ready: true, online: true },
      ],
      {
        hostUid: 'host',
        initialPhase: 'action',
        startingPrimaryWeapon: 'lanze',
        peerRttProvider: (uid) => (uid === 'laggy' ? 600 : 0),
      },
    );

    const laggy = sim.getPlayer('laggy')!;
    const enemy = sim.getPlayer('enemy')!;
    laggy.motor.teleport({ x: 0, y: 0, z: 10 });

    // Record enemy at x = -3.5 at t = 650ms (350ms ago) and x = 0.0 from t = 800ms..1000ms (200ms ago..now)
    sim.lagComp.clear();
    sim.lagComp.recordFrame(650, [
      { uid: 'enemy', team: 'D', alive: true, pos: { x: -3.5, y: 0, z: -10 }, stance: 'stand' },
    ]);
    sim.lagComp.recordFrame(800, [
      { uid: 'enemy', team: 'D', alive: true, pos: { x: 0, y: 0, z: -10 }, stance: 'stand' },
    ]);
    sim.lagComp.recordFrame(1000, [
      { uid: 'enemy', team: 'D', alive: true, pos: { x: 0, y: 0, z: -10 }, stance: 'stand' },
    ]);
    enemy.motor.teleport({ x: 0, y: 0, z: -10 });

    // Aiming at x = -3.5 (350ms ago) MUST miss because rewind clamps strictly at 200ms (t = 800ms, where enemy is at x = 0)!
    const spoofYaw = Math.atan2(3.5, 20);
    const bodyPitch = Math.atan2(1.0 - laggy.motor.getEyePos().y, Math.hypot(3.5, 20));
    sim.enqueueInput('laggy', {
      seq: 1,
      clientTimeMs: 650,
      forward: 0,
      right: 0,
      jump: false,
      crouch: false,
      walk: false,
      fire: true,
      ads: false,
      reload: false,
      yaw: spoofYaw,
      pitch: bodyPitch,
    });
    const evs = sim.step(SIM_DT, 1000);
    expect(evs.some((e) => e.type === 'damage')).toBe(false);
    expect(enemy.hp).toBe(100);

    sim.dispose();
  });
});
