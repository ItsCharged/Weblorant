import { describe, expect, it } from 'vitest';
import {
  assignTeams,
  clusterByNetwork,
  estimateLatencyMs,
  LAN_LATENCY_MS,
  pickBestHost,
  pickCoordinator,
  planMatch,
  type QueueEntry,
} from '../src/net/Matchmaking';

const NOW = 1_000_000;

function entry(uid: string, over: Partial<QueueEntry> = {}): QueueEntry {
  return {
    uid,
    name: uid,
    netKey: null,
    rttMs: 40,
    tzOffsetMin: -60,
    joinedAt: NOW - 1000,
    lastSeen: NOW,
    teamSize: 5,
    ...over,
  };
}

describe('Matchmaking – Latenzschätzung', () => {
  it('gleiches Netzwerk ergibt LAN-Latenz', () => {
    const a = entry('a', { netKey: 'lan1' });
    const b = entry('b', { netKey: 'lan1' });
    expect(estimateLatencyMs(a, b)).toBe(LAN_LATENCY_MS);
  });

  it('weit entfernte Zeitzonen sind teurer', () => {
    const berlin = entry('a', { tzOffsetMin: -60 });
    const lisbon = entry('b', { tzOffsetMin: 0 });
    const nyc = entry('c', { tzOffsetMin: 300 });
    expect(estimateLatencyMs(berlin, nyc)).toBeGreaterThan(estimateLatencyMs(berlin, lisbon));
  });
});

describe('Matchmaking – lokale Gruppen', () => {
  it('fasst Spieler mit gleichem netKey zusammen, größte Gruppe zuerst', () => {
    const clusters = clusterByNetwork([
      entry('w1'),
      entry('l1', { netKey: 'home' }),
      entry('l2', { netKey: 'home' }),
      entry('l3', { netKey: 'home' }),
    ]);
    expect(clusters[0].map((e) => e.uid).sort()).toEqual(['l1', 'l2', 'l3']);
    expect(clusters).toHaveLength(2);
  });

  it('wählt einen Host innerhalb der größten lokalen Gruppe', () => {
    const { host } = pickBestHost([
      entry('web1', { rttMs: 20 }),
      entry('l1', { netKey: 'home' }),
      entry('l2', { netKey: 'home' }),
      entry('l3', { netKey: 'home' }),
    ]);
    expect(['l1', 'l2', 'l3']).toContain(host.uid);
  });

  it('hält lokale Gruppen im selben Team', () => {
    const lan = [entry('l1', { netKey: 'x' }), entry('l2', { netKey: 'x' })];
    const web = [[entry('w1')], [entry('w2')]];
    const members = assignTeams([lan, ...web], 2);
    const teamOf = (uid: string) => members.find((m) => m.uid === uid)?.team;
    expect(teamOf('l1')).toBe(teamOf('l2'));
    expect(members.filter((m) => m.team === 'A')).toHaveLength(2);
    expect(members.filter((m) => m.team === 'D')).toHaveLength(2);
  });
});

describe('Matchmaking – Planung', () => {
  it('volles Match startet sofort und nimmt die lokale Gruppe komplett mit', () => {
    const entries = [
      entry('l1', { netKey: 'home' }),
      entry('l2', { netKey: 'home' }),
      entry('l3', { netKey: 'home' }),
      entry('w1', { tzOffsetMin: -60 }),
      entry('w2', { tzOffsetMin: -60 }),
      entry('w3', { tzOffsetMin: -60 }),
      entry('far', { tzOffsetMin: 480, rttMs: 300 }),
    ].map((e) => ({ ...e, teamSize: 3 }));
    const plan = planMatch(entries, NOW, 3);
    expect(plan).not.toBeNull();
    const uids = plan!.members.map((m) => m.uid);
    expect(uids).toHaveLength(6);
    expect(uids).toEqual(expect.arrayContaining(['l1', 'l2', 'l3']));
    // weit entfernter Spieler wird zugunsten naher Auffüller nicht gewählt
    expect(uids).not.toContain('far');
    expect(['l1', 'l2', 'l3']).toContain(plan!.hostUid);
    expect(plan!.localGroups).toHaveLength(1);
    expect(plan!.partial).toBe(false);
  });

  it('wartet bei unvollständigen Teams, startet nach Wartezeit aber trotzdem', () => {
    const entries = [entry('w1'), entry('w2'), entry('w3')];
    expect(planMatch(entries, NOW, 5)).toBeNull();
    const later = planMatch(entries, NOW + 30_000, 5, { staleAfterMs: 60_000 });
    expect(later).not.toBeNull();
    expect(later!.partial).toBe(true);
    expect(later!.teamSize).toBe(2);
    expect(later!.members).toHaveLength(3);
  });

  it('rein lokale Gruppe startet nach kurzer Wartezeit alleine', () => {
    const entries = [entry('l1', { netKey: 'lan' }), entry('l2', { netKey: 'lan' })];
    expect(planMatch(entries, NOW, 5)).toBeNull();
    const plan = planMatch(entries, NOW + 10_000, 5, { staleAfterMs: 60_000 });
    expect(plan).not.toBeNull();
    expect(plan!.avgLatencyMs).toBe(LAN_LATENCY_MS);
  });

  it('ignoriert veraltete, bereits zugewiesene und andere Teamgrößen', () => {
    const entries = [
      entry('a'),
      entry('stale', { lastSeen: NOW - 60_000 }),
      entry('taken', { matchId: 'm1' }),
      entry('other', { teamSize: 3 }),
    ];
    expect(planMatch(entries, NOW + 40_000, 5, { staleAfterMs: 60_000 })).toBeNull();
  });

  it('Koordinator ist der älteste aktive Eintrag', () => {
    const entries = [entry('young', { joinedAt: NOW }), entry('old', { joinedAt: NOW - 5000 })];
    expect(pickCoordinator(entries, NOW, 5)).toBe('old');
  });
});
