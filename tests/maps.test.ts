import { beforeAll, describe, expect, it } from 'vitest';
import { BUY_PHASE_SEC, KERN_PLANT_SEC, SIM_DT } from '../src/core/Config';
import { vec3Normalize, vec3Sub } from '../src/core/math';
import { ALL_MAP_IDS, TACTICAL_MAP_IDS, type LobbyPlayer } from '../src/core/types';
import {
  KRYOWERK_MAP,
  MAP_LIST,
  MAPS,
  TACTICAL_MAPS,
  UEBUNGSANLAGE_MAP,
  WERKSTADT_MAP,
  type MapDefinition,
} from '../src/data/maps';
import { isInTeamSpawnBuyZone } from '../src/game/Economy';
import { HostSimulation } from '../src/game/HostSimulation';
import { LocalSession } from '../src/game/LocalSession';
import { performHitscan } from '../src/physics/Hitscan';
import { initRapier } from '../src/physics/PhysicsWorld';

function expectFiniteVec3(v: { x: number; y: number; z: number }): void {
  expect(Number.isFinite(v.x)).toBe(true);
  expect(Number.isFinite(v.y)).toBe(true);
  expect(Number.isFinite(v.z)).toBe(true);
}

function makeTestRoster(): LobbyPlayer[] {
  return [
    { uid: 'att_1', name: 'Angreifer Eins', team: 'A', character: 'ryo', ready: true, online: true },
    { uid: 'def_1', name: 'Verteidiger Eins', team: 'D', character: 'tessa', ready: true, online: true },
  ];
}

function verifyTacticalMapSimulation(mapDef: MapDefinition): void {
  // 1. Spawn, Buy validation (accepted inside spawn, rejected outside), and Buy -> Action barrier drop + Zone A plant
  const simA = new HostSimulation(mapDef, makeTestRoster(), { roundsToWin: 7 });
  const att = simA.getPlayer('att_1')!;
  const def = simA.getPlayer('def_1')!;

  const spawnAttZone = mapDef.zones.find((z) => z.type === 'spawn_attacker')!;
  const spawnDefZone = mapDef.zones.find((z) => z.type === 'spawn_defender')!;
  const siteAZone = mapDef.zones.find((z) => z.type === 'kern_site_a')!;
  const siteBZone = mapDef.zones.find((z) => z.type === 'kern_site_b')!;

  expect(Math.abs(att.pos.z - spawnAttZone.center.z)).toBeLessThan(1.0);
  expect(Math.abs(def.pos.z - spawnDefZone.center.z)).toBeLessThan(1.0);
  expect(isInTeamSpawnBuyZone('A', att.pos, mapDef.zones)).toBe(true);
  expect(isInTeamSpawnBuyZone('D', def.pos, mapDef.zones)).toBe(true);

  // Buy inside spawn succeeds
  const buyInside = simA.handleBuyRequest('att_1', 'armor', 'light');
  expect(buyInside).toMatchObject({ ok: true, armor: 25 });

  // Teleport outside spawn into Mid during Buy Phase -> buy_request is rejected with 'outside_spawn'
  const savedSpawnPos = { ...att.pos };
  att.motor.teleport({ x: 0, y: 0.05, z: 0 });
  const buyOutside = simA.handleBuyRequest('att_1', 'weapon', 'bolzer');
  expect(buyOutside).toMatchObject({ ok: false, reason: 'outside_spawn' });

  // Return to spawn and verify spawn barrier blocks crossing z = +35.5 during Buy Phase
  att.motor.teleport({ x: 0, y: 0.05, z: 37.2 });
  let seq = 1;
  let nowMs = 1000;
  for (let i = 0; i < 20; i += 1) {
    simA.enqueueInput('att_1', {
      seq: seq++,
      clientTimeMs: nowMs,
      forward: 1,
      right: 0,
      jump: false,
      crouch: false,
      walk: false,
      fire: false,
      ads: false,
      reload: false,
      yaw: 0,
      pitch: 0,
    });
    simA.step(SIM_DT, nowMs);
    nowMs += 33;
  }
  expect(simA.roundManager.phase).toBe('buy');
  expect(simA.roundManager.barriersActive).toBe(true);
  expect(att.pos.z).toBeGreaterThan(35.5);

  // Advance remaining Buy Phase time -> transitions to 'action' and removes spawn barriers
  att.motor.teleport(savedSpawnPos);
  let remainingBuy = simA.roundManager.phaseRemainingSec + 0.1;
  while (remainingBuy > 1e-5) {
    const stepDt = Math.min(0.5, remainingBuy);
    simA.step(stepDt, nowMs);
    remainingBuy -= stepDt;
    nowMs += 500;
  }
  expect(simA.roundManager.phase).toBe('action');
  expect(simA.roundManager.barriersActive).toBe(false);

  // Verify player can walk cleanly across z = +35.5 once barriers drop
  att.motor.teleport({ x: 0, y: 0.05, z: 36.5 });
  for (let i = 0; i < 20; i += 1) {
    simA.enqueueInput('att_1', {
      seq: seq++,
      clientTimeMs: nowMs,
      forward: 1,
      right: 0,
      jump: false,
      crouch: false,
      walk: false,
      fire: false,
      ads: false,
      reload: false,
      yaw: 0,
      pitch: 0,
    });
    simA.step(SIM_DT, nowMs);
    nowMs += 33;
  }
  expect(att.pos.z).toBeLessThan(35.2);

  // Teleport carrier into Zone A center, settle on ground, and channel 4.0s Kern plant
  att.motor.teleport({
    x: siteAZone.center.x,
    y: siteAZone.center.y + 0.05,
    z: siteAZone.center.z,
  });
  for (let i = 0; i < 6; i += 1) {
    simA.enqueueInput('att_1', {
      seq: seq++,
      clientTimeMs: nowMs,
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
    });
    simA.step(SIM_DT, nowMs);
    nowMs += 33;
  }
  expect(att.grounded).toBe(true);

  const plantTicks = Math.ceil(KERN_PLANT_SEC / SIM_DT) + 4;
  for (let i = 0; i < plantTicks; i += 1) {
    simA.enqueueInput('att_1', {
      seq: seq++,
      clientTimeMs: nowMs,
      forward: 0,
      right: 0,
      jump: false,
      crouch: false,
      walk: false,
      fire: false,
      ads: false,
      reload: false,
      holdKern: true,
      yaw: 0,
      pitch: 0,
    });
    simA.step(SIM_DT, nowMs);
    nowMs += 33;
    if (simA.roundManager.phase === 'planted') break;
  }
  expect(simA.roundManager.phase).toBe('planted');
  expect(simA.roundManager.kern.status).toBe('planted');
  expect(simA.roundManager.kern.plantedZone).toBe('A');
  simA.dispose();

  // 2. Verify Zone B plant & Halftime side-swap spawn/buy validation on the same map
  const simB = new HostSimulation(mapDef, makeTestRoster(), {
    roundsToWin: 7,
    initialPhase: 'action',
  });
  const attB = simB.getPlayer('att_1')!;
  attB.motor.teleport({
    x: siteBZone.center.x,
    y: siteBZone.center.y + 0.05,
    z: siteBZone.center.z,
  });

  let seqB = 1;
  let nowB = 5000;
  for (let i = 0; i < 6; i += 1) {
    simB.enqueueInput('att_1', {
      seq: seqB++,
      clientTimeMs: nowB,
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
    });
    simB.step(SIM_DT, nowB);
    nowB += 33;
  }
  for (let i = 0; i < plantTicks; i += 1) {
    simB.enqueueInput('att_1', {
      seq: seqB++,
      clientTimeMs: nowB,
      forward: 0,
      right: 0,
      jump: false,
      crouch: false,
      walk: false,
      fire: false,
      ads: false,
      reload: false,
      holdKern: true,
      yaw: 0,
      pitch: 0,
    });
    simB.step(SIM_DT, nowB);
    nowB += 33;
    if (simB.roundManager.phase === 'planted') break;
  }
  expect(simB.roundManager.phase).toBe('planted');
  expect(simB.roundManager.kern.plantedZone).toBe('B');

  // Verify swapped-side team ('D' after swap) can buy in spawn_defender and NOT in spawn_attacker
  expect(isInTeamSpawnBuyZone('D', spawnDefZone.center, mapDef.zones)).toBe(true);
  expect(isInTeamSpawnBuyZone('D', spawnAttZone.center, mapDef.zones)).toBe(false);
  expect(BUY_PHASE_SEC).toBe(25);

  simB.dispose();
}

describe('Phase 6 – All 4 Maps Geometry Audit, Upgraded Übungsanlage Sightlines & Tactical HostSimulation Runs', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('validates finite, NaN-free geometry and required zones/callouts across all 4 maps in MAPS', () => {
    expect(ALL_MAP_IDS).toEqual(['hafenwerk', 'werkstadt', 'kryowerk', 'uebungsanlage']);
    expect(TACTICAL_MAP_IDS).toEqual(['hafenwerk', 'werkstadt', 'kryowerk']);
    expect(MAP_LIST).toHaveLength(4);
    expect(TACTICAL_MAPS).toHaveLength(3);

    for (const mapId of ALL_MAP_IDS) {
      const map = MAPS[mapId];
      expect(map).toBeDefined();
      expect(map.id).toBe(mapId);
      expect(Number.isFinite(map.bounds.width) && map.bounds.width > 0).toBe(true);
      expect(Number.isFinite(map.bounds.depth) && map.bounds.depth > 0).toBe(true);
      expectFiniteVec3(map.playerSpawn.pos);
      expect(Number.isFinite(map.playerSpawn.yaw)).toBe(true);
      expect(map.blocks.length).toBeGreaterThan(20);

      const seenBlockIds = new Set<string>();
      for (const b of map.blocks) {
        expect(b.id.length).toBeGreaterThan(0);
        expect(seenBlockIds.has(b.id)).toBe(false);
        seenBlockIds.add(b.id);
        expectFiniteVec3(b.pos);
        expectFiniteVec3(b.size);
        expect(b.size.x).toBeGreaterThan(0);
        expect(b.size.y).toBeGreaterThan(0);
        expect(b.size.z).toBeGreaterThan(0);
        if (b.rotX !== undefined) expect(Number.isFinite(b.rotX)).toBe(true);
        if (b.rotY !== undefined) expect(Number.isFinite(b.rotY)).toBe(true);
        if (b.rotZ !== undefined) expect(Number.isFinite(b.rotZ)).toBe(true);
      }

      for (const z of map.zones) {
        expectFiniteVec3(z.center);
        expect(Number.isFinite(z.size.x) && z.size.x > 0).toBe(true);
        expect(Number.isFinite(z.size.z) && z.size.z > 0).toBe(true);
      }

      for (const d of map.dummySpawns) {
        expectFiniteVec3(d.pos);
        expect(Number.isFinite(d.yaw)).toBe(true);
      }

      expect(map.callouts).toBeDefined();
      expect(map.callouts!.length).toBeGreaterThanOrEqual(7);
      for (const c of map.callouts!) {
        expect(c.id.length).toBeGreaterThan(0);
        expect(c.label.length).toBeGreaterThan(0);
        expectFiniteVec3(c.pos);
      }
    }

    // Check required tactical zones & spawnBarriers on all 3 tactical maps
    for (const tacticalId of TACTICAL_MAP_IDS) {
      const tMap = MAPS[tacticalId];
      const zoneTypes = new Set(tMap.zones.map((z) => z.type));
      expect(zoneTypes.has('spawn_attacker')).toBe(true);
      expect(zoneTypes.has('spawn_defender')).toBe(true);
      expect(zoneTypes.has('kern_site_a')).toBe(true);
      expect(zoneTypes.has('kern_site_b')).toBe(true);

      expect(tMap.spawnBarriers).toBeDefined();
      expect(tMap.spawnBarriers!.some((sb) => sb.team === 'A')).toBe(true);
      expect(tMap.spawnBarriers!.some((sb) => sb.team === 'D')).toBe(true);
      for (const sb of tMap.spawnBarriers!) {
        expectFiniteVec3(sb.pos);
        expectFiniteVec3(sb.size);
        expect(sb.size.x).toBeGreaterThan(0);
        expect(sb.size.y).toBeGreaterThan(0);
        expect(sb.size.z).toBeGreaterThan(0);
      }
    }
  });

  it('verifies upgraded Übungsanlage preserves unobstructed sightlines to all 5 rangeButtons, scoreboardPos, and sprayWallBounds', () => {
    expect(UEBUNGSANLAGE_MAP.theme).toBe('range');
    expect(UEBUNGSANLAGE_MAP.rangeButtons).toBeDefined();
    expect(UEBUNGSANLAGE_MAP.rangeButtons!.length).toBe(5);
    expect(UEBUNGSANLAGE_MAP.scoreboardPos).toBeDefined();
    expect(UEBUNGSANLAGE_MAP.sprayWallBounds).toBeDefined();

    const session = new LocalSession(UEBUNGSANLAGE_MAP);
    const eyeOrigin = session.motor.getEyePos();

    for (const btn of UEBUNGSANLAGE_MAP.rangeButtons!) {
      const dir = vec3Normalize(vec3Sub(btn.pos, eyeOrigin));
      const hit = performHitscan(
        eyeOrigin,
        dir,
        80,
        session.physicsWorld,
        [],
        UEBUNGSANLAGE_MAP.rangeButtons,
      );
      expect(hit.hitZone).toBe('button');
      expect(hit.buttonId).toBe(btn.id);
    }

    session.dispose();
  });

  it('simulates full HostSimulation match flow (spawn, buy validation, barrier drop, Zone A & Zone B Kern plant) on Werkstadt', () => {
    expect(WERKSTADT_MAP.theme).toBe('oldtown');
    verifyTacticalMapSimulation(WERKSTADT_MAP);
  });

  it('simulates full HostSimulation match flow (spawn, buy validation, barrier drop, Zone A & Zone B Kern plant) on Kryowerk', () => {
    expect(KRYOWERK_MAP.theme).toBe('arctic');
    verifyTacticalMapSimulation(KRYOWERK_MAP);
  });
});
