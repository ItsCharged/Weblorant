import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  type Unsubscribe,
  update,
} from 'firebase/database';
import type { TeamId } from '../core/types';
import { getIceServers } from '../net/config';
import {
  type MatchPlan,
  pickCoordinator,
  planMatch,
  type QueueEntry,
} from '../net/Matchmaking';
import { ensureAnonymousAuth } from './auth';
import { getFirebaseServices } from './init';

/**
 * Automatische Warteschlange über Firebase RTDB.
 *
 * Ablauf:
 *  1. Client misst Server-RTT und ermittelt einen gehashten Netzwerk-Schlüssel
 *     (öffentliche Adresse via STUN – gleiche Adresse ⇒ gleiches lokales Netz).
 *     Die IP selbst wird nie gespeichert, nur ein SHA-256-Hash.
 *  2. Eintrag unter `queue/{uid}` mit Heartbeat.
 *  3. Der älteste Wartende ist Koordinator: er plant das Match (`planMatch`) und
 *     schreibt `matches/{id}` + `queue/{uid}/matchId` für jeden Teilnehmer.
 *  4. Der geplante Host erstellt den Raum und trägt `roomCode` ein; alle anderen
 *     treten automatisch mit vorgegebenem Team bei.
 */

export type QueueStatus =
  | { state: 'idle' }
  | { state: 'probing' }
  | { state: 'searching'; waitingSec: number; queueSize: number; localPeers: number }
  | { state: 'matched'; plan: MatchRecord; isHost: boolean };

export interface MatchRecord {
  id: string;
  hostUid: string;
  teamSize: number;
  members: Record<string, TeamId>;
  localGroups: string[][];
  avgLatencyMs: number;
  partial: boolean;
  createdAt: number;
  roomCode?: string;
}

export interface MatchAssignment {
  match: MatchRecord;
  isHost: boolean;
  team: TeamId;
}

const HEARTBEAT_MS = 4000;
const COORDINATE_MS = 1500;
const LOCK_TTL_MS = 4000;
const ASSIGN_TIMEOUT_MS = 20_000;

interface RawQueueEntry {
  name?: unknown;
  netKey?: unknown;
  rttMs?: unknown;
  tzOffsetMin?: unknown;
  joinedAt?: unknown;
  lastSeen?: unknown;
  teamSize?: unknown;
  matchId?: unknown;
}

function parseQueue(raw: Record<string, RawQueueEntry> | null): QueueEntry[] {
  if (!raw) return [];
  const out: QueueEntry[] = [];
  for (const [uid, r] of Object.entries(raw)) {
    if (!r || typeof r !== 'object') continue;
    out.push({
      uid,
      name: typeof r.name === 'string' ? r.name : 'Spieler',
      netKey: typeof r.netKey === 'string' && r.netKey.length > 0 ? r.netKey : null,
      rttMs: typeof r.rttMs === 'number' ? r.rttMs : 120,
      tzOffsetMin: typeof r.tzOffsetMin === 'number' ? r.tzOffsetMin : 0,
      joinedAt: typeof r.joinedAt === 'number' ? r.joinedAt : 0,
      lastSeen: typeof r.lastSeen === 'number' ? r.lastSeen : 0,
      teamSize: typeof r.teamSize === 'number' ? r.teamSize : 5,
      matchId: typeof r.matchId === 'string' ? r.matchId : null,
    });
  }
  return out;
}

/** Ermittelt die öffentliche Adresse über STUN und gibt nur einen Hash zurück. */
export async function detectNetworkKey(timeoutMs = 2500): Promise<string | null> {
  if (typeof RTCPeerConnection === 'undefined') return null;
  const stunOnly = getIceServers().filter((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => u.startsWith('stun:'));
  });
  const pc = new RTCPeerConnection({ iceServers: stunOnly });
  const addresses = new Set<string>();
  try {
    pc.createDataChannel('netprobe');
    const done = new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, timeoutMs);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          window.clearTimeout(timer);
          resolve();
          return;
        }
        const parts = ev.candidate.candidate.split(' ');
        const typIdx = parts.indexOf('typ');
        if (typIdx > 0 && parts[typIdx + 1] === 'srflx' && parts[4]) {
          addresses.add(parts[4]);
        }
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } catch {
    return null;
  } finally {
    pc.close();
  }

  // IPv4 bevorzugen (NAT ⇒ ganze LAN teilt eine Adresse); IPv6 auf /64-Präfix kürzen.
  const list = [...addresses];
  const v4 = list.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  let key: string | null = null;
  if (v4) key = `v4:${v4}`;
  else {
    const v6 = list.find((a) => a.includes(':'));
    if (v6) key = `v6:${v6.split(':').slice(0, 4).join(':')}`;
  }
  if (!key) return null;

  const bytes = new TextEncoder().encode(`shardline-lan|${key}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class MatchmakingService {
  private uid: string | null = null;
  private teamSize = 5;
  private joinedAt = 0;
  private netKey: string | null = null;
  private queueUnsub: Unsubscribe | null = null;
  private matchUnsub: Unsubscribe | null = null;
  private heartbeatTimer: number | null = null;
  private coordinateTimer: number | null = null;
  private latestQueue: QueueEntry[] = [];
  private active = false;
  private assignedMatchId: string | null = null;
  private serverOffsetMs = 0;
  private assignTimeout: number | null = null;

  public onStatus: (status: QueueStatus) => void = () => {};
  public onAssignment: (assignment: MatchAssignment) => void = () => {};

  public isSearching(): boolean {
    return this.active;
  }

  public getNetKey(): string | null {
    return this.netKey;
  }

  public async start(playerName: string, teamSize: number): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.assignedMatchId = null;
    this.teamSize = Math.max(1, Math.min(5, Math.round(teamSize)));
    this.onStatus({ state: 'probing' });

    const { uid } = await ensureAnonymousAuth();
    this.uid = uid;
    const { db } = getFirebaseServices();

    const offsetSnap = await get(ref(db, '.info/serverTimeOffset')).catch(() => null);
    this.serverOffsetMs = typeof offsetSnap?.val() === 'number' ? (offsetSnap.val() as number) : 0;

    const [netKey, rttMs] = await Promise.all([detectNetworkKey(), this.measureRtt(uid)]);
    if (!this.active) return;
    this.netKey = netKey;
    this.joinedAt = this.now();

    const entryRef = ref(db, `queue/${uid}`);
    await onDisconnect(entryRef).remove();
    await set(entryRef, {
      name: playerName.slice(0, 16) || 'Spieler',
      netKey: netKey ?? '',
      rttMs: Math.round(rttMs),
      tzOffsetMin: new Date().getTimezoneOffset(),
      joinedAt: this.joinedAt,
      lastSeen: this.joinedAt,
      teamSize: this.teamSize,
    });

    this.queueUnsub = onValue(ref(db, 'queue'), (snap) => {
      this.latestQueue = parseQueue(snap.val() as Record<string, RawQueueEntry> | null);
      const self = this.latestQueue.find((e) => e.uid === uid);
      if (self?.matchId && self.matchId !== this.assignedMatchId) {
        this.followMatch(self.matchId);
      }
      this.emitSearching();
    });

    this.heartbeatTimer = window.setInterval(() => {
      void update(entryRef, { lastSeen: this.now() }).catch(() => {});
      this.emitSearching();
    }, HEARTBEAT_MS);

    this.coordinateTimer = window.setInterval(() => {
      void this.coordinate();
    }, COORDINATE_MS);
  }

  public async cancel(): Promise<void> {
    const wasActive = this.active;
    this.active = false;
    this.stopTimers();
    if (this.queueUnsub) {
      this.queueUnsub();
      this.queueUnsub = null;
    }
    if (this.matchUnsub) {
      this.matchUnsub();
      this.matchUnsub = null;
    }
    if (wasActive && this.uid) {
      const { db } = getFirebaseServices();
      const entryRef = ref(db, `queue/${this.uid}`);
      await onDisconnect(entryRef).cancel().catch(() => {});
      await remove(entryRef).catch(() => {});
    }
    this.assignedMatchId = null;
    this.onStatus({ state: 'idle' });
  }

  /** Vom Host aufgerufen, sobald der Raum für das Match erstellt wurde. */
  public async publishRoomCode(matchId: string, roomCode: string): Promise<void> {
    const { db } = getFirebaseServices();
    await set(ref(db, `matches/${matchId}/roomCode`), roomCode);
  }

  private now(): number {
    return Date.now() + this.serverOffsetMs;
  }

  private async measureRtt(uid: string): Promise<number> {
    const { db } = getFirebaseServices();
    const probeRef = ref(db, `rttProbe/${uid}`);
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try {
        // Schreibvorgang wird erst nach Server-Bestätigung aufgelöst ⇒ volle RTT
        await set(probeRef, Date.now());
        samples.push(performance.now() - t0);
      } catch {
        break;
      }
    }
    await remove(probeRef).catch(() => {});
    return samples.length > 0 ? Math.min(...samples) : 120;
  }

  private emitSearching(): void {
    if (!this.active || this.assignedMatchId) return;
    const now = this.now();
    const live = this.latestQueue.filter(
      (e) => !e.matchId && e.teamSize === this.teamSize && now - e.lastSeen <= 15_000,
    );
    const localPeers = this.netKey
      ? live.filter((e) => e.uid !== this.uid && e.netKey === this.netKey).length
      : 0;
    this.onStatus({
      state: 'searching',
      waitingSec: Math.max(0, Math.floor((now - this.joinedAt) / 1000)),
      queueSize: live.length,
      localPeers,
    });
  }

  private async coordinate(): Promise<void> {
    if (!this.active || !this.uid || this.assignedMatchId) return;
    const now = this.now();
    const coordinator = pickCoordinator(this.latestQueue, now, this.teamSize);
    if (coordinator !== this.uid) return;

    const plan = planMatch(this.latestQueue, now, this.teamSize);
    if (!plan) return;

    const { db } = getFirebaseServices();
    // Kurzer Lock gegen doppelte Planung, falls zwei Clients kurz uneinig sind
    const lock = await runTransaction(ref(db, `mmLock/t${this.teamSize}`), (cur) => {
      if (cur && typeof cur.until === 'number' && cur.until > now && cur.uid !== this.uid) {
        return undefined;
      }
      return { uid: this.uid, until: now + LOCK_TTL_MS };
    }).catch(() => null);
    if (!lock?.committed) return;

    await this.commitPlan(plan, now);
  }

  private async commitPlan(plan: MatchPlan, now: number): Promise<void> {
    const { db } = getFirebaseServices();
    const matchId = `m${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const record: Omit<MatchRecord, 'id'> = {
      hostUid: plan.hostUid,
      teamSize: plan.teamSize,
      members: Object.fromEntries(plan.members.map((m) => [m.uid, m.team])),
      localGroups: plan.localGroups,
      avgLatencyMs: Math.round(plan.avgLatencyMs),
      partial: plan.partial,
      createdAt: now,
    };
    await set(ref(db, `matches/${matchId}`), record);

    // Jeden Teilnehmer per Transaktion zuweisen (nur falls noch frei)
    for (const m of plan.members) {
      await runTransaction(ref(db, `queue/${m.uid}/matchId`), (cur) =>
        cur ? undefined : matchId,
      ).catch(() => null);
    }
  }

  private followMatch(matchId: string): void {
    if (!this.uid) return;
    this.assignedMatchId = matchId;
    this.stopTimers();
    const { db } = getFirebaseServices();
    if (this.matchUnsub) this.matchUnsub();
    let announced = false;
    let delivered = false;
    // Falls der Host abspringt: nach Timeout zurück in die Warteschlange
    this.assignTimeout = window.setTimeout(() => {
      if (!delivered && this.assignedMatchId === matchId) {
        void this.requeue();
      }
    }, ASSIGN_TIMEOUT_MS);
    this.matchUnsub = onValue(ref(db, `matches/${matchId}`), (snap) => {
      const raw = snap.val() as Omit<MatchRecord, 'id'> | null;
      if (!raw || !this.uid) return;
      const match: MatchRecord = { ...raw, id: matchId, localGroups: raw.localGroups ?? [] };
      const team = match.members?.[this.uid];
      if (!team) return;
      const isHost = match.hostUid === this.uid;
      if (!announced) {
        announced = true;
        this.onStatus({ state: 'matched', plan: match, isHost });
      }
      // Host erstellt sofort; Mitglieder warten auf den Raumcode
      if (!delivered && (isHost || match.roomCode)) {
        delivered = true;
        if (this.assignTimeout !== null) {
          window.clearTimeout(this.assignTimeout);
          this.assignTimeout = null;
        }
        this.onAssignment({ match, isHost, team });
        void this.finishQueue();
      }
    });
  }

  private async requeue(): Promise<void> {
    if (!this.uid) return;
    if (this.matchUnsub) {
      this.matchUnsub();
      this.matchUnsub = null;
    }
    this.assignedMatchId = null;
    const { db } = getFirebaseServices();
    const entryRef = ref(db, `queue/${this.uid}`);
    await update(entryRef, { matchId: null, lastSeen: this.now() }).catch(() => {});
    this.heartbeatTimer = window.setInterval(() => {
      void update(entryRef, { lastSeen: this.now() }).catch(() => {});
      this.emitSearching();
    }, HEARTBEAT_MS);
    this.coordinateTimer = window.setInterval(() => {
      void this.coordinate();
    }, COORDINATE_MS);
    this.emitSearching();
  }

  private async finishQueue(): Promise<void> {
    if (this.matchUnsub) {
      this.matchUnsub();
      this.matchUnsub = null;
    }
    this.active = false;
    if (this.queueUnsub) {
      this.queueUnsub();
      this.queueUnsub = null;
    }
    if (this.uid) {
      const { db } = getFirebaseServices();
      const entryRef = ref(db, `queue/${this.uid}`);
      await onDisconnect(entryRef).cancel().catch(() => {});
      await remove(entryRef).catch(() => {});
    }
  }

  private stopTimers(): void {
    if (this.assignTimeout !== null) {
      window.clearTimeout(this.assignTimeout);
      this.assignTimeout = null;
    }
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.coordinateTimer !== null) {
      window.clearInterval(this.coordinateTimer);
      this.coordinateTimer = null;
    }
  }
}
