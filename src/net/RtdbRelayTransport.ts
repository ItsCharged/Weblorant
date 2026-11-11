import { type Database, onValue, ref, remove, set } from 'firebase/database';
import type { TransportMetrics, TransportMode } from '../core/types';
import {
  CLIENT_INPUT_HZ_RELAY,
  HOST_SNAPSHOT_HZ_RELAY,
  PING_INTERVAL_MS,
} from './config';
import { monotonicNowMs, type NetTransport, TelemetryTracker } from './NetTransport';

const MAX_EVENT_RING_SIZE = 16;
const EVENT_COALESCE_MS = 16;

interface RelayStateEnvelope {
  sid: string;
  s: number;
  t: number;
  d: string;
}

interface RelayEventItem {
  id: number;
  d: string;
}

interface RelayEventEnvelope {
  sid: string;
  t: number;
  items: RelayEventItem[];
}

interface RelayPingEnvelope {
  sid: string;
  id: number;
  t0: number;
}

export interface RtdbRelayTransportOptions {
  db: Database;
  roomCode: string;
  /** Non-host client's UID identifying `rooms/{code}/relay/{clientPeerUid}`. */
  clientPeerUid: string;
  /** On Client equals `hostUid`; on Host equals `clientPeerUid`. */
  remoteUid: string;
  isHost: boolean;
}

/**
 * 10 Hz throttled Firebase Realtime Database Relay fallback transport
 * operating under `rooms/{code}/relay/{clientPeerUid}`.
 */
export class RtdbRelayTransport implements NetTransport {
  public readonly peerUid: string;
  private readonly db: Database;
  private readonly basePath: string;
  private readonly isHost: boolean;
  private readonly minStateIntervalMs: number;
  private readonly instanceSid: string;
  private readonly activatedWallMs: number;
  private readonly telemetry = new TelemetryTracker();

  private mode: TransportMode = 'relay';
  private paused = false;
  private closed = false;

  // Outgoing state throttling
  private txStateSeq = 0;
  private lastStateSentAtMs = 0;
  private pendingStatePayload: string | null = null;
  private stateFlushTimer: ReturnType<typeof setTimeout> | null = null;

  // Incoming state deduplication
  private lastRxStateSid = '';
  private lastRxStateSeq = 0;

  // Outgoing reliable event rolling ring
  private txEventId = 0;
  private readonly recentOutEvents: RelayEventItem[] = [];
  private eventFlushTimer: ReturnType<typeof setTimeout> | null = null;

  // Incoming reliable event cursor
  private lastRxEventSid = '';
  private lastRxEventId = 0;

  // Ping / Pong
  private lastSeenRemotePingKey = '';
  private lastSeenPongKey = '';
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  private readonly unsubs: Array<() => void> = [];
  private readonly stateHandlers = new Set<(payload: string) => void>();
  private readonly eventHandlers = new Set<(payload: string) => void>();
  private readonly modeHandlers = new Set<(mode: TransportMode) => void>();

  constructor(options: RtdbRelayTransportOptions) {
    this.peerUid = options.remoteUid;
    this.db = options.db;
    this.isHost = options.isHost;
    this.basePath = `rooms/${options.roomCode}/relay/${options.clientPeerUid}`;
    this.minStateIntervalMs = Math.round(
      1000 / (options.isHost ? HOST_SNAPSHOT_HZ_RELAY : CLIENT_INPUT_HZ_RELAY),
    );
    this.instanceSid = `${options.isHost ? 'h' : 'c'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.activatedWallMs = Date.now();

    this.attachListeners();

    this.pingInterval = setInterval(() => {
      if (!this.paused && !this.closed) {
        this.sendPing();
      }
    }, PING_INTERVAL_MS);
    this.sendPing();
  }

  public getMode(): TransportMode {
    return this.mode;
  }

  public getMetrics(): TransportMetrics {
    return this.telemetry.snapshot(this.mode);
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public sendState(payload: string): void {
    if (this.closed || this.paused) return;

    const now = monotonicNowMs();
    const elapsed = now - this.lastStateSentAtMs;
    if (elapsed >= this.minStateIntervalMs && this.stateFlushTimer === null) {
      this.writeStateNow(payload, now);
      return;
    }

    this.pendingStatePayload = payload;
    if (this.stateFlushTimer === null) {
      const waitMs = Math.max(8, Math.round(this.minStateIntervalMs - elapsed));
      this.stateFlushTimer = setTimeout(() => {
        this.stateFlushTimer = null;
        if (this.closed || this.paused || this.pendingStatePayload === null) return;
        const latest = this.pendingStatePayload;
        this.pendingStatePayload = null;
        this.writeStateNow(latest, monotonicNowMs());
      }, waitMs);
    }
  }

  public sendEvent(payload: string): void {
    if (this.closed) return;

    this.recentOutEvents.push({
      id: ++this.txEventId,
      d: payload,
    });
    if (this.recentOutEvents.length > MAX_EVENT_RING_SIZE) {
      this.recentOutEvents.splice(0, this.recentOutEvents.length - MAX_EVENT_RING_SIZE);
    }

    if (this.eventFlushTimer === null) {
      this.eventFlushTimer = setTimeout(() => {
        this.eventFlushTimer = null;
        if (this.closed) return;
        this.writeEventsNow();
      }, EVENT_COALESCE_MS);
    }
  }

  public onState(handler: (payload: string) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  public onEvent(handler: (payload: string) => void): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  public onModeChange(handler: (mode: TransportMode) => void): () => void {
    this.modeHandlers.add(handler);
    return () => {
      this.modeHandlers.delete(handler);
    };
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.stateFlushTimer !== null) {
      clearTimeout(this.stateFlushTimer);
      this.stateFlushTimer = null;
    }
    if (this.eventFlushTimer !== null) {
      clearTimeout(this.eventFlushTimer);
      this.eventFlushTimer = null;
    }
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;

    this.mode = 'disconnected';
    for (const h of this.modeHandlers) {
      h('disconnected');
    }

    if (!this.isHost) {
      void remove(ref(this.db, this.basePath)).catch(() => {});
    }

    this.stateHandlers.clear();
    this.eventHandlers.clear();
    this.modeHandlers.clear();
  }

  private attachListeners(): void {
    const stateInPath = this.isHost
      ? `${this.basePath}/inputs`
      : `${this.basePath}/snapshot`;
    const eventsInPath = this.isHost
      ? `${this.basePath}/eventsFromPeer`
      : `${this.basePath}/eventsFromHost`;
    const pingInPath = this.isHost
      ? `${this.basePath}/pingFromPeer`
      : `${this.basePath}/pingFromHost`;
    const pongOutPath = this.isHost
      ? `${this.basePath}/pongFromHost`
      : `${this.basePath}/pongFromPeer`;
    const pongInPath = this.isHost
      ? `${this.basePath}/pongFromPeer`
      : `${this.basePath}/pongFromHost`;

    this.unsubs.push(
      onValue(ref(this.db, stateInPath), (snap) => {
        if (this.closed || this.paused) return;
        const val = snap.val() as Partial<RelayStateEnvelope> | null;
        if (
          !val ||
          typeof val.sid !== 'string' ||
          typeof val.s !== 'number' ||
          typeof val.t !== 'number' ||
          typeof val.d !== 'string'
        ) {
          return;
        }
        if (val.t < this.activatedWallMs - 2500) {
          return;
        }
        if (val.sid !== this.lastRxStateSid) {
          this.lastRxStateSid = val.sid;
          this.lastRxStateSeq = 0;
        }
        if (val.s <= this.lastRxStateSeq) {
          return;
        }
        this.lastRxStateSeq = val.s;
        this.telemetry.recordRx();
        for (const h of this.stateHandlers) {
          h(val.d);
        }
      }),
    );

    this.unsubs.push(
      onValue(ref(this.db, eventsInPath), (snap) => {
        if (this.closed) return;
        const val = snap.val() as Partial<RelayEventEnvelope> | null;
        if (
          !val ||
          typeof val.sid !== 'string' ||
          typeof val.t !== 'number' ||
          !Array.isArray(val.items)
        ) {
          return;
        }
        if (val.t < this.activatedWallMs - 2500) {
          this.lastRxEventSid = val.sid;
          let maxOld = 0;
          for (const it of val.items) {
            if (it && typeof it.id === 'number' && it.id > maxOld) {
              maxOld = it.id;
            }
          }
          this.lastRxEventId = maxOld;
          return;
        }

        if (val.sid !== this.lastRxEventSid) {
          this.lastRxEventSid = val.sid;
          this.lastRxEventId = 0;
        }

        for (const item of val.items) {
          if (
            !item ||
            typeof item.id !== 'number' ||
            typeof item.d !== 'string' ||
            item.id <= this.lastRxEventId
          ) {
            continue;
          }
          this.lastRxEventId = item.id;
          this.telemetry.recordRx();
          for (const h of this.eventHandlers) {
            h(item.d);
          }
        }
      }),
    );

    this.unsubs.push(
      onValue(ref(this.db, pingInPath), (snap) => {
        if (this.closed || this.paused) return;
        const val = snap.val() as Partial<RelayPingEnvelope> | null;
        if (
          !val ||
          typeof val.sid !== 'string' ||
          typeof val.id !== 'number' ||
          typeof val.t0 !== 'number'
        ) {
          return;
        }
        const key = `${val.sid}:${val.id}`;
        if (key === this.lastSeenRemotePingKey) return;
        this.lastSeenRemotePingKey = key;

        const pong: RelayPingEnvelope = {
          sid: val.sid,
          id: val.id,
          t0: val.t0,
        };
        void set(ref(this.db, pongOutPath), pong).catch(() => {});
      }),
    );

    this.unsubs.push(
      onValue(ref(this.db, pongInPath), (snap) => {
        if (this.closed || this.paused) return;
        const val = snap.val() as Partial<RelayPingEnvelope> | null;
        if (
          !val ||
          val.sid !== this.instanceSid ||
          typeof val.id !== 'number' ||
          typeof val.t0 !== 'number'
        ) {
          return;
        }
        const key = `${val.sid}:${val.id}`;
        if (key === this.lastSeenPongKey) return;
        this.lastSeenPongKey = key;
        this.telemetry.recordPong(val.id, val.t0, monotonicNowMs());
      }),
    );
  }

  private writeStateNow(payload: string, nowMono: number): void {
    this.lastStateSentAtMs = nowMono;
    const stateOutPath = this.isHost
      ? `${this.basePath}/snapshot`
      : `${this.basePath}/inputs`;
    const envelope: RelayStateEnvelope = {
      sid: this.instanceSid,
      s: ++this.txStateSeq,
      t: Date.now(),
      d: payload,
    };
    this.telemetry.recordTx(nowMono);
    void set(ref(this.db, stateOutPath), envelope).catch(() => {});
  }

  private writeEventsNow(): void {
    const eventsOutPath = this.isHost
      ? `${this.basePath}/eventsFromHost`
      : `${this.basePath}/eventsFromPeer`;
    const envelope: RelayEventEnvelope = {
      sid: this.instanceSid,
      t: Date.now(),
      items: this.recentOutEvents.slice(),
    };
    this.telemetry.recordTx();
    void set(ref(this.db, eventsOutPath), envelope).catch(() => {});
  }

  private sendPing(): void {
    const pingOutPath = this.isHost
      ? `${this.basePath}/pingFromHost`
      : `${this.basePath}/pingFromPeer`;
    const { pingId, t0 } = this.telemetry.createPing();
    const envelope: RelayPingEnvelope = {
      sid: this.instanceSid,
      id: pingId,
      t0,
    };
    void set(ref(this.db, pingOutPath), envelope).catch(() => {});
  }
}
