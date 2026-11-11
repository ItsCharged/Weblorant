import { beforeAll, describe, expect, it } from 'vitest';
import type { InputSnapshot } from '../src/core/types';
import { HAFENWERK_MAP, UEBUNGSANLAGE_MAP } from '../src/data/maps';
import type { MapDefinition } from '../src/data/maps/types';
import { WEAPONS } from '../src/data/weapons';
import { LocalSession } from '../src/game/LocalSession';
import { DUMMY_RESPAWN_TIME_SEC, DummyManager } from '../src/game/TargetDummy';
import { computeDamage, WeaponController } from '../src/game/WeaponLogic';
import { performHitscan } from '../src/physics/Hitscan';
import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';

function makeIdleInput(overrides: Partial<InputSnapshot> = {}): InputSnapshot {
  return {
    seq: 1,
    forward: 0,
    right: 0,
    jump: false,
    crouch: false,
    walk: false,
    fire: false,
    ads: false,
    reload: false,
    yaw: 0,
    pitch: 0,
    dt: 1 / 30,
    ...overrides,
  };
}

describe('WeaponLogic, TargetDummy & Physics Hitscan', () => {
  const lanze = WEAPONS.lanze;

  beforeAll(async () => {
    await initRapier();
  });

  it('computes exact Lanze damage (150 head / 40 body) and distance falloff on SMGs', () => {
    expect(computeDamage(lanze, 'head', 10)).toBe(150);
    expect(computeDamage(lanze, 'body', 10)).toBe(40);
    expect(computeDamage(lanze, 'head', 45)).toBe(150);
    expect(computeDamage(lanze, 'body', 45)).toBe(40);

    const hornisse = WEAPONS.hornisse;
    expect(computeDamage(hornisse, 'head', 10)).toBe(70);
    expect(computeDamage(hornisse, 'head', 40)).toBeLessThan(70);
  });

  it('enforces 9.5/s fire interval, 25-round mag depletion, and 2.2s reload restoration', () => {
    const ctrl = new WeaponController('lanze');
    expect(ctrl.ammoInMag).toBe(25);
    expect(ctrl.reserveAmmo).toBe(75);

    // Shot 1 fires immediately
    const first = ctrl.step(0.01, true, false);
    expect(first.fired).toBe(true);
    expect(ctrl.ammoInMag).toBe(24);

    // 1 / 9.5 = 0.105263s -> advancing 0.05s + 0.05s (0.10s total) must NOT fire yet
    expect(ctrl.step(0.05, true, false).fired).toBe(false);
    expect(ctrl.step(0.05, true, false).fired).toBe(false);

    // Advancing another 0.01s (0.11s >= 0.10526s) fires shot 2
    expect(ctrl.step(0.01, true, false).fired).toBe(true);
    expect(ctrl.ammoInMag).toBe(23);

    // Deplete the remaining 23 rounds in full-auto
    let firedCount = 2;
    for (let i = 0; i < 400 && ctrl.ammoInMag > 0; i += 1) {
      if (ctrl.step(0.02, true, false).fired) {
        firedCount += 1;
      }
    }
    expect(firedCount).toBe(25);
    expect(ctrl.ammoInMag).toBe(0);

    // Holding fire on empty magazine cannot fire a 26th round
    expect(ctrl.step(0.2, true, false).fired).toBe(false);
    expect(ctrl.ammoInMag).toBe(0);

    // Start reload (2.2s for Lanze)
    const relStart = ctrl.step(0.01, false, true);
    expect(relStart.reloadStarted).toBe(true);
    expect(ctrl.isReloading).toBe(true);

    // Cannot fire mid-reload (at 2.0s elapsed < 2.2s)
    expect(ctrl.step(2.0, true, false).fired).toBe(false);
    expect(ctrl.isReloading).toBe(true);

    // Completing reload at +0.25s restores 25 mag and deducts from reserve (75 -> 50)
    const relDone = ctrl.step(0.25, false, false);
    expect(relDone.reloadFinished).toBe(true);
    expect(ctrl.isReloading).toBe(false);
    expect(ctrl.ammoInMag).toBe(25);
    expect(ctrl.reserveAmmo).toBe(50);
  });

  it('requires trigger release between shots for semi-auto weapons (Funke)', () => {
    const ctrl = new WeaponController('funke');
    expect(ctrl.step(0.01, true, false).fired).toBe(true);
    // Holding trigger past cooldown (0.5s > 1/6s) must NOT fire semi-auto
    expect(ctrl.step(0.5, true, false).fired).toBe(false);
    // Release trigger then pull again -> fires
    ctrl.step(0.02, false, false);
    expect(ctrl.step(0.02, true, false).fired).toBe(true);
  });

  it('handles dummy armor (100 HP + 50 shield = 150) and 2.5s auto-respawn accurately', () => {
    const manager = new DummyManager([
      { id: 'd1', pos: { x: 0, y: 0, z: -10 }, yaw: 0 },
      { id: 'd2', pos: { x: 3, y: 0, z: -10 }, yaw: 0 },
    ]);
    manager.setArmorEnabled(true);

    // Dummy 1: 1 Lanze headshot (150) kills through 100 HP + 50 armor immediately
    const hs = manager.applyDamage('d1', 150, 'head');
    expect(hs.killed).toBe(true);
    expect(hs.remainingHp).toBe(0);
    expect(hs.remainingArmor).toBe(0);
    expect(manager.dummies[0].alive).toBe(false);

    // Dummy 2: 3 Lanze body shots (3 * 40 = 120) leave 0 armor and 30 HP; 4th kills
    const b1 = manager.applyDamage('d2', 40, 'body');
    expect(b1.killed).toBe(false);
    expect(b1.remainingArmor).toBe(10);
    expect(b1.remainingHp).toBe(100);

    const b2 = manager.applyDamage('d2', 40, 'body');
    expect(b2.killed).toBe(false);
    expect(b2.remainingArmor).toBe(0);
    expect(b2.remainingHp).toBe(70);

    const b3 = manager.applyDamage('d2', 40, 'body');
    expect(b3.killed).toBe(false);
    expect(b3.remainingArmor).toBe(0);
    expect(b3.remainingHp).toBe(30);
    expect(manager.dummies[1].alive).toBe(true);

    const b4 = manager.applyDamage('d2', 40, 'body');
    expect(b4.killed).toBe(true);
    expect(b4.remainingHp).toBe(0);
    expect(manager.dummies[1].alive).toBe(false);

    // Respawn timer: still dead at 2.4s, alive with full 100 HP + 50 armor after 2.5s
    manager.update(DUMMY_RESPAWN_TIME_SEC - 0.1);
    expect(manager.dummies[0].alive).toBe(false);

    manager.update(0.2);
    expect(manager.dummies[0].alive).toBe(true);
    expect(manager.dummies[0].hp).toBe(100);
    expect(manager.dummies[0].armor).toBe(50);
  });

  it('strictly blocks hitscan shots to dummies behind world cover walls', () => {
    const testMap: MapDefinition = {
      id: 'uebungsanlage',
      name: 'Test',
      subtitle: 'Test',
      bounds: { width: 20, depth: 20 },
      playerSpawn: { pos: { x: 0, y: 0, z: 5 }, yaw: 0 },
      blocks: [
        {
          id: 'floor',
          pos: { x: 0, y: -0.25, z: 0 },
          size: { x: 20, y: 0.5, z: 20 },
          color: 0xffffff,
          material: 'floor',
        },
        {
          id: 'cover_wall',
          pos: { x: -3, y: 1.0, z: -4 },
          size: { x: 2.0, y: 2.2, z: 0.4 },
          color: 0xffffff,
          material: 'concrete',
        },
      ],
      zones: [],
      dummySpawns: [
        { id: 'open_dummy', pos: { x: 3, y: 0, z: -8 }, yaw: Math.PI },
        { id: 'covered_dummy', pos: { x: -3, y: 0, z: -8 }, yaw: Math.PI },
      ],
    };

    const world = new PhysicsWorld(testMap);
    const dummies = new DummyManager(testMap.dummySpawns);

    // Unobstructed head shot at x = +3, y = 1.56
    const headHit = performHitscan(
      { x: 3, y: 1.56, z: 0 },
      { x: 0, y: 0, z: -1 },
      100,
      world,
      dummies.dummies,
    );
    expect(headHit.hitZone).toBe('head');
    expect(headHit.dummyId).toBe('open_dummy');

    // Unobstructed body shot at x = +3, y = 1.0
    const bodyHit = performHitscan(
      { x: 3, y: 1.0, z: 0 },
      { x: 0, y: 0, z: -1 },
      100,
      world,
      dummies.dummies,
    );
    expect(bodyHit.hitZone).toBe('body');
    expect(bodyHit.dummyId).toBe('open_dummy');

    // Obstructed shot toward covered_dummy at x = -3 hits cover_wall first!
    const blockedHit = performHitscan(
      { x: -3, y: 1.56, z: 0 },
      { x: 0, y: 0, z: -1 },
      100,
      world,
      dummies.dummies,
    );
    expect(blockedHit.hitZone).toBe('world');
    expect(blockedHit.dummyId).toBeUndefined();
    expect(blockedHit.distance).toBeLessThan(5);

    world.dispose();
  });

  it('runs LocalSession cleanly across Übungsanlage and Hafenwerk hot-switches', () => {
    const session = new LocalSession(UEBUNGSANLAGE_MAP, 42);
    expect(session.activeMapId).toBe('uebungsanlage');
    expect(session.getAliveDummyCount()).toBe(UEBUNGSANLAGE_MAP.dummySpawns.length);

    session.tick(makeIdleInput({ forward: 1 }));
    const interp = session.getInterpolatedEyePos(0.5);
    expect(Number.isFinite(interp.x)).toBe(true);
    expect(Number.isFinite(interp.y)).toBe(true);
    expect(Number.isFinite(interp.z)).toBe(true);

    session.loadMap(HAFENWERK_MAP);
    expect(session.activeMapId).toBe('hafenwerk');
    expect(session.getAliveDummyCount()).toBe(HAFENWERK_MAP.dummySpawns.length);

    session.tick(makeIdleInput({ forward: 1, right: 1 }));
    session.dispose();
  });
});
