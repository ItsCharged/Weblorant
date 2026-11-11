import { beforeAll, describe, expect, it } from 'vitest';
import { POST_ROUND_SEC, SIM_DT } from '../src/core/Config';
import { aimDirectionFromAngles, vec3Len } from '../src/core/math';
import type {
  ClientInputPacket,
  InputSnapshot,
  NetGameEvent,
  WorldSnapshot,
} from '../src/core/types';
import type { MapBlock, MapDefinition } from '../src/data/maps/types';
import {
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT_COUNT,
  CHAT_RATE_LIMIT_WINDOW_MS,
  getEventRecipientUids,
  HostSimulation,
  sanitizeChatText,
} from '../src/game/HostSimulation';
import { INTERP_DELAY_MS, SnapshotInterpolator } from '../src/net/Interpolation';
import { ClientPrediction } from '../src/net/Prediction';
import {
  decodeClientMessage,
  decodeEvent,
  decodeInput,
  decodeSnapshot,
  encodeClientMessage,
  encodeEvent,
  encodeInput,
  encodeSnapshot,
} from '../src/net/Protocol';
import { CharacterMotor } from '../src/physics/CharacterMotor';
import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';

function createArenaMap(extraBlocks: MapBlock[] = []): MapDefinition {
  return {
    id: 'hafenwerk',
    name: 'TestArena',
    subtitle: 'PvP Test Arena',
    bounds: { width: 128, depth: 128 },
    playerSpawn: { pos: { x: 0, y: 0.05, z: 52 }, yaw: 0 },
    blocks: [
      {
        id: 'arena_floor',
        pos: { x: 0, y: -0.5, z: 0 },
        size: { x: 128, y: 1.0, z: 128 },
        color: 0x3b434d,
        material: 'asphalt',
      },
      ...extraBlocks,
    ],
    zones: [],
    dummySpawns: [],
  };
}

function makeClientInput(
  seq: number,
  overrides: Partial<ClientInputPacket> = {},
): ClientInputPacket {
  return {
    seq,
    clientTimeMs: 1000 + seq * 33,
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
    ...overrides,
  };
}

function toInputSnapshot(pkt: ClientInputPacket): InputSnapshot {
  return {
    seq: pkt.seq,
    forward: pkt.forward,
    right: pkt.right,
    jump: pkt.jump,
    crouch: pkt.crouch,
    walk: pkt.walk,
    fire: pkt.fire,
    ads: pkt.ads,
    reload: pkt.reload,
    yaw: pkt.yaw,
    pitch: pkt.pitch,
    dt: SIM_DT,
  };
}

describe('Phase 3 & 4 – Wire Protocol, Client Prediction, Entity Interpolation & Host Anti-Cheat', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('encodes & decodes inputs, snapshots, events, and reliable client messages cleanly', () => {
    const rawInput: ClientInputPacket = {
      seq: 42,
      clientTimeMs: 12345.678,
      forward: 1,
      right: -1,
      jump: true,
      crouch: false,
      walk: true,
      fire: true,
      ads: false,
      reload: false,
      holdKern: true,
      equipSlot: 2,
      weaponSlot: 'lanze',
      yaw: -1.23456,
      pitch: 0.34567,
    };

    const decodedInput = decodeInput(encodeInput(rawInput));
    expect(decodedInput).not.toBeNull();
    expect(decodedInput!.seq).toBe(42);
    expect(decodedInput!.forward).toBe(1);
    expect(decodedInput!.right).toBe(-1);
    expect(decodedInput!.jump).toBe(true);
    expect(decodedInput!.walk).toBe(true);
    expect(decodedInput!.fire).toBe(true);
    expect(decodedInput!.holdKern).toBe(true);
    expect(decodedInput!.equipSlot).toBe(2);
    expect(decodedInput!.weaponSlot).toBe('lanze');
    expect(decodedInput!.yaw).toBe(-1.235);
    expect(decodedInput!.pitch).toBe(0.346);

    const rawSnapshot: WorldSnapshot = {
      tick: 120,
      serverTimeMs: 5000.129,
      players: [
        {
          uid: 'host-u1',
          name: 'RyoHost',
          team: 'A',
          character: 'ryo',
          pos: { x: 12.3456, y: 0.054, z: -23.9876 },
          vel: { x: 5.599, y: 0, z: -1.234 },
          yaw: 2.3456,
          pitch: -0.1234,
          stance: 'stand',
          hp: 60,
          armor: 25,
          armorMax: 50,
          alive: true,
          weaponId: 'lanze',
          primaryWeapon: 'lanze',
          secondaryWeapon: 'funke',
          activeSlot: 1,
          ammoInMag: 19,
          isReloading: false,
          hasKern: true,
          credits: 3400,
          kills: 3,
          deaths: 1,
          assists: 2,
          plants: 1,
          defuses: 0,
          ultPoints: 4,
          lastAckSeq: 41,
        },
      ],
    };

    const decodedSnap = decodeSnapshot(encodeSnapshot(rawSnapshot));
    expect(decodedSnap).not.toBeNull();
    expect(decodedSnap!.tick).toBe(120);
    expect(decodedSnap!.players).toHaveLength(1);
    const p = decodedSnap!.players[0];
    expect(p.pos).toEqual({ x: 12.35, y: 0.05, z: -23.99 });
    expect(p.vel).toEqual({ x: 5.6, y: 0, z: -1.23 });
    expect(p.yaw).toBe(2.346);
    expect(p.pitch).toBe(-0.123);
    expect(p.hp).toBe(60);
    expect(p.armor).toBe(25);
    expect(p.armorMax).toBe(50);
    expect(p.weaponId).toBe('lanze');
    expect(p.primaryWeapon).toBe('lanze');
    expect(p.secondaryWeapon).toBe('funke');
    expect(p.activeSlot).toBe(1);
    expect(p.hasKern).toBe(true);
    expect(p.credits).toBe(3400);
    expect(p.lastAckSeq).toBe(41);

    const dmgEv = decodeEvent(
      encodeEvent({
        type: 'damage',
        attackerUid: 'host-u1',
        victimUid: 'guest-u2',
        damage: 150,
        hitZone: 'head',
        hpAfter: 0,
        armorAfter: 0,
        killed: true,
        weaponId: 'lanze',
      }),
    );
    expect(dmgEv).toEqual({
      type: 'damage',
      attackerUid: 'host-u1',
      victimUid: 'guest-u2',
      damage: 150,
      hitZone: 'head',
      hpAfter: 0,
      armorAfter: 0,
      killed: true,
      weaponId: 'lanze',
    });

    const buyMsg = decodeClientMessage(
      encodeClientMessage({ type: 'buy_request', itemType: 'weapon', itemId: 'lanze' }),
    );
    expect(buyMsg).toEqual({ type: 'buy_request', itemType: 'weapon', itemId: 'lanze' });
  });

  it('reconciles ClientPrediction with 0 error on matching path, smooth decay on 0.3m drift, and hard snap >= 1.5m', () => {
    const arena = createArenaMap();
    const clientWorld = new PhysicsWorld(arena);
    const clientMotor = new CharacterMotor(clientWorld, { x: 0, y: 0.05, z: 52 });
    const hostSim = new HostSimulation(
      arena,
      [{ uid: 'c1', name: 'ClientOne', team: 'A', character: 'ryo', ready: true, online: true }],
      { initialPhase: 'action' },
    );

    const prediction = new ClientPrediction();

    const sent: ClientInputPacket[] = [];
    for (let seq = 1; seq <= 6; seq += 1) {
      const pkt = makeClientInput(seq, { forward: 1 });
      sent.push(pkt);
      const snapIn = toInputSnapshot(pkt);
      clientMotor.step(snapIn);
      clientWorld.step();
      prediction.recordInput(snapIn, clientMotor.feetPos);
    }

    for (let i = 0; i < 3; i += 1) {
      hostSim.enqueueInput('c1', sent[i]);
      hostSim.step(SIM_DT, 1000 + i * 33);
    }

    const snapAck3 = hostSim.buildSnapshot(1100);
    const authPlayer3 = snapAck3.players[0];
    expect(authPlayer3.lastAckSeq).toBe(3);

    const exactRes = prediction.reconcile(authPlayer3, clientMotor);
    expect(exactRes.replayedCount).toBe(3);
    expect(exactRes.errorM).toBeLessThan(1e-4);
    expect(exactRes.snapped).toBe(false);
    expect(vec3Len(prediction.renderErrorOffset)).toBe(0);

    const driftedAuth = {
      ...authPlayer3,
      lastAckSeq: 6,
      pos: {
        x: clientMotor.feetPos.x + 0.3,
        y: clientMotor.feetPos.y,
        z: clientMotor.feetPos.z,
      },
    };
    const driftRes = prediction.reconcile(driftedAuth, clientMotor);
    expect(driftRes.snapped).toBe(false);
    expect(driftRes.errorM).toBeCloseTo(0.3, 2);
    const initialOffsetLen = vec3Len(prediction.renderErrorOffset);
    expect(initialOffsetLen).toBeCloseTo(0.3, 2);

    prediction.decayErrorOffset(1 / 60);
    expect(vec3Len(prediction.renderErrorOffset)).toBeLessThan(initialOffsetLen);
    expect(vec3Len(prediction.renderErrorOffset)).toBeGreaterThan(0);

    const teleportAuth = {
      ...driftedAuth,
      pos: {
        x: clientMotor.feetPos.x - 2.5,
        y: clientMotor.feetPos.y,
        z: clientMotor.feetPos.z,
      },
    };
    const snapRes = prediction.reconcile(teleportAuth, clientMotor);
    expect(snapRes.snapped).toBe(true);
    expect(vec3Len(prediction.renderErrorOffset)).toBe(0);

    clientMotor.dispose();
    clientWorld.dispose();
    hostSim.dispose();
  });

  it('interpolates remote entities at -100ms delay with shortest-angle yaw wraparound across +-PI', () => {
    const interp = new SnapshotInterpolator();

    const makeRemoteSnap = (tick: number, serverTimeMs: number, x: number, yaw: number): WorldSnapshot => ({
      tick,
      serverTimeMs,
      players: [
        {
          uid: 'remote-1',
          name: 'MiraEnemy',
          team: 'D',
          character: 'mira',
          pos: { x, y: 0.05, z: -10 },
          vel: { x: 4.0, y: 0, z: 0 },
          yaw,
          pitch: 0,
          stance: 'stand',
          hp: 100,
          armor: 0,
          armorMax: 0,
          alive: true,
          weaponId: 'lanze',
          primaryWeapon: 'lanze',
          secondaryWeapon: 'funke',
          activeSlot: 1,
          ammoInMag: 25,
          isReloading: false,
          hasKern: false,
          credits: 800,
          kills: 0,
          deaths: 0,
          assists: 0,
          plants: 0,
          defuses: 0,
          ultPoints: 0,
          lastAckSeq: tick,
        },
      ],
    });

    interp.pushSnapshot(makeRemoteSnap(1, 1000, 0.0, 3.10));
    interp.pushSnapshot(makeRemoteSnap(2, 1050, 2.0, -3.10));

    expect(INTERP_DELAY_MS).toBe(100);
    const mid = interp.sampleRemotePlayers('local-me', 1125);
    expect(mid).toHaveLength(1);
    expect(mid[0].pos.x).toBeCloseTo(1.0, 4);
    expect(Math.abs(mid[0].yaw)).toBeGreaterThan(3.05);

    const extrap = interp.sampleRemotePlayers('local-me', 1400);
    expect(extrap[0].pos.x).toBeCloseTo(2.4, 4);
  });

  it('validates PvP hits on HostSimulation (150 head / 40 body, no mid-round respawn, fire-rate limit, 0-ammo & wall occlusion)', () => {
    const openArena = createArenaMap();
    const sim = new HostSimulation(
      openArena,
      [
        { uid: 'attacker', name: 'Alpha', team: 'A', character: 'ryo', ready: true, online: true },
        { uid: 'defender', name: 'Bravo', team: 'D', character: 'tessa', ready: true, online: true },
      ],
      { initialPhase: 'action', startingPrimaryWeapon: 'lanze' },
    );

    const attacker = sim.getPlayer('attacker')!;
    const defender = sim.getPlayer('defender')!;

    attacker.motor.teleport({ x: 0, y: 0, z: 10 });
    defender.motor.teleport({ x: 0, y: 0, z: -10 });

    const dyBody = 1.0 - attacker.motor.getEyePos().y;
    const bodyPitch = Math.atan2(dyBody, 20);
    expect(aimDirectionFromAngles(0, bodyPitch).z).toBeLessThan(0);

    sim.enqueueInput('attacker', makeClientInput(1, { fire: true, yaw: 0, pitch: bodyPitch }));
    const evBody = sim.step(SIM_DT, 2000);
    const bodyDmgEv = evBody.find((e) => e.type === 'damage');
    expect(bodyDmgEv).toBeDefined();
    if (bodyDmgEv?.type === 'damage') {
      expect(bodyDmgEv.damage).toBe(40);
      expect(bodyDmgEv.hitZone).toBe('body');
      expect(bodyDmgEv.hpAfter).toBe(60);
      expect(bodyDmgEv.killed).toBe(false);
    }

    for (let i = 0; i < 15; i += 1) {
      sim.enqueueInput('attacker', makeClientInput(2 + i, { fire: false, yaw: 0, pitch: 0 }));
      sim.step(SIM_DT, 2033 + i * 33);
    }

    // Headshot deals 150 damage -> kills defender -> round enters post_round (4.5s) with NO mid-round respawn
    const dyHead = 1.56 - attacker.motor.getEyePos().y;
    const headPitch = Math.atan2(dyHead, 20);
    sim.enqueueInput('attacker', makeClientInput(20, { fire: true, yaw: 0, pitch: headPitch }));
    const evHead = sim.step(SIM_DT, 2600);
    const headDmgEv = evHead.find((e) => e.type === 'damage');
    expect(headDmgEv).toBeDefined();
    if (headDmgEv?.type === 'damage') {
      expect(headDmgEv.damage).toBe(150);
      expect(headDmgEv.hitZone).toBe('head');
      expect(headDmgEv.killed).toBe(true);
    }
    expect(defender.alive).toBe(false);
    expect(attacker.kills).toBe(1);
    expect(defender.deaths).toBe(1);
    expect(sim.roundManager.phase).toBe('post_round');

    // Still dead at 3.5s into post_round (< 4.5s), then respawns cleanly when Round 2 starts!
    const preNextRoundSteps = Math.floor(3.5 / SIM_DT);
    for (let i = 0; i < preNextRoundSteps; i += 1) {
      sim.step(SIM_DT, 2700 + i * 33);
    }
    expect(defender.alive).toBe(false);

    let respawnEventSeen = false;
    const postSteps = Math.ceil((POST_ROUND_SEC - 3.4) / SIM_DT) + 3;
    for (let i = 0; i < postSteps; i += 1) {
      const evs = sim.step(SIM_DT, 4000 + i * 33);
      if (evs.some((e) => e.type === 'respawn' && e.uid === 'defender')) {
        respawnEventSeen = true;
      }
    }
    expect(respawnEventSeen).toBe(true);
    expect(defender.alive).toBe(true);
    expect(defender.hp).toBe(100);

    // Advance Round 2 past buy phase into action for fire-rate & 0-ammo anti-cheat checks
    sim.roundManager.phase = 'action';
    sim.physicsWorld.setSpawnBarriersActive(false);
    attacker.inventory.grantWeapon('lanze', true);
    attacker.recoil.setWeapon(attacker.weapon.weapon);

    let shotsFiredInOneSecond = 0;
    for (let i = 0; i < 30; i += 1) {
      sim.enqueueInput('attacker', makeClientInput(100 + i, { fire: true, yaw: 0, pitch: 0.2 }));
      const evs = sim.step(SIM_DT, 7000 + i * 33);
      shotsFiredInOneSecond += evs.filter((e) => e.type === 'shot' && e.shooterUid === 'attacker').length;
    }
    expect(shotsFiredInOneSecond).toBeLessThanOrEqual(10);
    expect(shotsFiredInOneSecond).toBeGreaterThanOrEqual(7);

    // 0-ammo anti-cheat: firing with 0 rounds in magazine deals 0 damage
    defender.motor.teleport({ x: 0, y: 0, z: -10 });
    defender.hp = 100;
    attacker.weapon.ammoInMag = 0;
    attacker.weapon.fireCooldown = 0;
    attacker.recoil.reset();
    sim.enqueueInput('attacker', makeClientInput(200, { fire: true, reload: false, yaw: 0, pitch: headPitch }));
    const evEmpty = sim.step(SIM_DT, 8500);
    expect(evEmpty.some((e) => e.type === 'shot')).toBe(false);
    expect(evEmpty.some((e) => e.type === 'damage')).toBe(false);
    expect(defender.hp).toBe(100);

    sim.dispose();

    // Wall occlusion anti-cheat: solid wall strictly blocks shots to enemy behind cover
    const walledArena = createArenaMap([
      {
        id: 'mid_wall',
        pos: { x: 0, y: 1.5, z: 0 },
        size: { x: 8, y: 4, z: 0.6 },
        color: 0x94a3b8,
        material: 'concrete',
      },
    ]);
    const walledSim = new HostSimulation(
      walledArena,
      [
        { uid: 'attacker', name: 'Alpha', team: 'A', character: 'ryo', ready: true, online: true },
        { uid: 'defender', name: 'Bravo', team: 'D', character: 'tessa', ready: true, online: true },
      ],
      { initialPhase: 'action', startingPrimaryWeapon: 'lanze' },
    );
    walledSim.getPlayer('attacker')!.motor.teleport({ x: 0, y: 0, z: 10 });
    walledSim.getPlayer('defender')!.motor.teleport({ x: 0, y: 0, z: -10 });

    walledSim.enqueueInput('attacker', makeClientInput(1, { fire: true, yaw: 0, pitch: headPitch }));
    const blockedEvs = walledSim.step(SIM_DT, 1000);
    const shotEv = blockedEvs.find((e) => e.type === 'shot');
    expect(shotEv).toBeDefined();
    if (shotEv?.type === 'shot') {
      expect(shotEv.hitZone).toBe('world');
      expect(shotEv.targetUid).toBeUndefined();
    }
    expect(blockedEvs.some((e) => e.type === 'damage')).toBe(false);
    expect(walledSim.getPlayer('defender')!.hp).toBe(100);

    walledSim.dispose();
  });
});

describe('Phase 8 – In-Game Chat: Wire Roundtrip, Host Sanitization, Spam Rate-Limit & Team-Only Isolation', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('roundtrips chat NetGameEvents and ClientReliableMessages through the wire protocol', () => {
    const chatEv: NetGameEvent = {
      type: 'chat',
      uid: 'u-alpha',
      senderName: 'Alpha',
      team: 'A',
      text: 'Rotation nach B, Nebel auf Kranlager!',
      teamOnly: true,
      timestampMs: 1234567,
    };
    expect(decodeEvent(encodeEvent(chatEv))).toEqual(chatEv);

    const allChatEv: NetGameEvent = { ...chatEv, team: 'D', teamOnly: false, text: 'gg' };
    expect(decodeEvent(encodeEvent(allChatEv))).toEqual(allChatEv);

    const teamMsg = decodeClientMessage(
      encodeClientMessage({ type: 'chat', text: 'Kern liegt Mitte', teamOnly: true }),
    );
    expect(teamMsg).toEqual({ type: 'chat', text: 'Kern liegt Mitte', teamOnly: true });

    const allMsg = decodeClientMessage(
      encodeClientMessage({ type: 'chat', text: 'Viel Glück', teamOnly: false }),
    );
    expect(allMsg).toMatchObject({ type: 'chat', text: 'Viel Glück', teamOnly: false });
  });

  it('sanitizes chat text (control chars, whitespace, 140-char cap) and rejects empty messages on the Host', () => {
    expect(sanitizeChatText('  hallo\u0000\u0007 welt\r\n\t ')).toBe('hallo welt');
    expect(sanitizeChatText('\u0000\u0001  \n')).toBe('');
    expect(sanitizeChatText(42)).toBe('');
    expect(sanitizeChatText('x'.repeat(500))).toHaveLength(CHAT_MAX_LENGTH);

    const sim = new HostSimulation(createArenaMap(), [
      { uid: 'a1', name: 'Alpha', team: 'A', character: 'ryo', ready: true, online: true },
      { uid: 'd1', name: 'Bravo', team: 'D', character: 'tessa', ready: true, online: true },
    ]);

    const evs = sim.handleClientMessage('a1', {
      type: 'chat',
      text: '  Push\u0000 A  jetzt  ',
      teamOnly: false,
    });
    expect(evs).toHaveLength(1);
    const ev = evs[0];
    expect(ev.type).toBe('chat');
    if (ev.type === 'chat') {
      expect(ev.uid).toBe('a1');
      expect(ev.senderName).toBe('Alpha');
      expect(ev.team).toBe('A');
      expect(ev.text).toBe('Push A jetzt');
      expect(ev.teamOnly).toBe(false);
      expect(Number.isFinite(ev.timestampMs)).toBe(true);
    }

    expect(sim.handleClientMessage('a1', { type: 'chat', text: '   \u0000  ' })).toHaveLength(0);
    expect(sim.handleChatMessage('ghost', 'hallo', false)).toBeNull();

    const longEv = sim.handleChatMessage('d1', 'y'.repeat(300), false, 50_000);
    expect(longEv?.type === 'chat' ? longEv.text.length : 0).toBe(CHAT_MAX_LENGTH);

    sim.dispose();
  });

  it('rate-limits chat spam to max 4 messages per 3 seconds per player', () => {
    const sim = new HostSimulation(createArenaMap(), [
      { uid: 'a1', name: 'Alpha', team: 'A', character: 'ryo', ready: true, online: true },
      { uid: 'a2', name: 'Charlie', team: 'A', character: 'mira', ready: true, online: true },
    ]);

    const t0 = 100_000;
    for (let i = 0; i < CHAT_RATE_LIMIT_COUNT; i += 1) {
      expect(sim.handleChatMessage('a1', `nachricht ${i}`, false, t0 + i * 100)).not.toBeNull();
    }
    // 5th message inside the 3s window is rejected
    expect(sim.handleChatMessage('a1', 'spam', false, t0 + 500)).toBeNull();
    expect(sim.handleChatMessage('a1', 'spam', false, t0 + 2900)).toBeNull();

    // Rate limit is tracked per player
    expect(sim.handleChatMessage('a2', 'ich darf', false, t0 + 600)).not.toBeNull();

    // Once the oldest message leaves the 3s window, one new slot opens up
    expect(sim.handleChatMessage('a1', 'wieder da', false, t0 + CHAT_RATE_LIMIT_WINDOW_MS)).not.toBeNull();
    expect(sim.handleChatMessage('a1', 'zu schnell', false, t0 + CHAT_RATE_LIMIT_WINDOW_MS + 10)).toBeNull();

    sim.dispose();
  });

  it('delivers team-only chat exclusively to the sender team and all-chat to everyone', () => {
    const roster = [
      { uid: 'a1', team: 'A' as const },
      { uid: 'a2', team: 'A' as const },
      { uid: 'd1', team: 'D' as const },
      { uid: 'd2', team: 'D' as const },
    ];
    const base = {
      type: 'chat' as const,
      uid: 'a1',
      senderName: 'Alpha',
      team: 'A' as const,
      text: 'Flanke links',
      timestampMs: 1,
    };

    expect(getEventRecipientUids({ ...base, teamOnly: true }, roster).sort()).toEqual(['a1', 'a2']);
    expect(getEventRecipientUids({ ...base, teamOnly: false }, roster).sort()).toEqual([
      'a1',
      'a2',
      'd1',
      'd2',
    ]);
    expect(
      getEventRecipientUids({ ...base, uid: 'd2', team: 'D', teamOnly: true }, roster).sort(),
    ).toEqual(['d1', 'd2']);

    // Non-chat events always go to everyone
    expect(
      getEventRecipientUids({ type: 'footstep', uid: 'a1', pos: { x: 0, y: 0, z: 0 } }, roster),
    ).toHaveLength(4);

    // HostSimulation.getEventRecipients respects live (possibly side-swapped) teams
    const sim = new HostSimulation(createArenaMap(), [
      { uid: 'a1', name: 'Alpha', team: 'A', character: 'ryo', ready: true, online: true },
      { uid: 'd1', name: 'Bravo', team: 'D', character: 'tessa', ready: true, online: true },
      { uid: 'd2', name: 'Delta', team: 'D', character: 'brann', ready: true, online: true },
    ]);
    const teamEv = sim.handleChatMessage('d1', 'Halte B', true, 5000)!;
    expect(sim.getEventRecipients(teamEv).sort()).toEqual(['d1', 'd2']);
    sim.dispose();
  });
});
