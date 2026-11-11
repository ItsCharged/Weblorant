import { type Database, onValue, ref } from 'firebase/database';
import type {
  ClientInputPacket,
  ClientReliableMessage,
  NetGameEvent,
  NetSimConfig,
  TransportMetrics,
  TransportMode,
  WorldSnapshot,
} from '../core/types';
import { getFirebaseServices } from '../firebase/init';
import { AdaptivePeerTransport } from './AdaptivePeerTransport';
import {
  DEFAULT_NET_SIM,
  HOST_SNAPSHOT_HZ_P2P,
  HOST_SNAPSHOT_HZ_RELAY,
} from './config';
import { monotonicNowMs } from './NetTransport';
import {
  decodeClientMessage,
  decodeEvent,
  decodeInput,
  decodeSnapshot,
  encodeClientMessage,
  encodeEvent,
  encodeInput,
  encodeSnapshot,
  isClientMessageFrame,
} from './Protocol';
import { SimulatedTransport } from './SimulatedTransport';

export interface ClientNetworkOptions {
  roomCode: string;
  localUid: string;
  hostUid: string;
  db?: Database;
  initialNetSim?: Partial<NetSimConfig>;
}

/**
 * Client-side Star-Topology network endpoint managing the single adaptive
 * WebRTC + RTDB Relay link to `hostUid`.
 */
export class ClientNetwork {
  public readonly roomCode: string;
  public readonly localUid: string;
  public readonly hostUid: string;

  private readonly transport: SimulatedTransport;
  private readonly snapshotHandlers = new Set<(snap: WorldSnapshot) => void>();
  private readonly eventHandlers = new Set<(ev: NetGameEvent) => void>();
  private readonly modeHandlers = new Set<(mode: TransportMode) => void>();
  private readonly unsubs: Array<() => void> = [];
  private closed = false;

  constructor(options: ClientNetworkOptions) {
    this.roomCode = options.roomCode;
    this.localUid = options.localUid;
    this.hostUid = options.hostUid;

    const db = options.db ?? getFirebaseServices().db;
    const adaptive = new AdaptivePeerTransport({
      db,
      roomCode: options.roomCode,
      clientPeerUid: options.localUid,
      remoteUid: options.hostUid,
      isHost: false,
      forceRelay: Boolean(options.initialNetSim?.forceRelay),
    });

    this.transport = new SimulatedTransport(adaptive, options.initialNetSim);

    this.unsubs.push(
      this.transport.onState((raw) => {
        if (this.closed) return;
        const snap = decodeSnapshot(raw);
        if (!snap) return;
        for (const h of this.snapshotHandlers) {
          h(snap);
        }
      }),
    );

    this.unsubs.push(
      this.transport.onEvent((raw) => {
        if (this.closed) return;
        const ev = decodeEvent(raw);
        if (!ev) return;
        for (const h of this.eventHandlers) {
          h(ev);
        }
      }),
    );

    this.unsubs.push(
      this.transport.onModeChange((mode) => {
        if (this.closed) return;
        for (const h of this.modeHandlers) {
          h(mode);
        }
      }),
    );
  }

  public sendInput(pkt: ClientInputPacket): void {
    if (this.closed) return;
    this.transport.sendState(encodeInput(pkt));
  }

  public sendEvent(ev: NetGameEvent): void {
    if (this.closed) return;
    this.transport.sendEvent(encodeEvent(ev));
  }

  public sendClientMessage(msg: ClientReliableMessage): void {
    if (this.closed) return;
    this.transport.sendEvent(encodeClientMessage(msg));
  }

  public onSnapshot(handler: (snap: WorldSnapshot) => void): () => void {
    this.snapshotHandlers.add(handler);
    return () => {
      this.snapshotHandlers.delete(handler);
    };
  }

  public onEvent(handler: (ev: NetGameEvent) => void): () => void {
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

  public getMode(): TransportMode {
    return this.transport.getMode();
  }

  public getMetrics(): TransportMetrics {
    return this.transport.getMetrics();
  }

  public setNetSim(cfg: Partial<NetSimConfig>): void {
    this.transport.setSimConfig(cfg);
  }

  public getNetSim(): NetSimConfig {
    return this.transport.getSimConfig();
  }

  public getTransport(): SimulatedTransport {
    return this.transport;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;

    this.transport.close();
    this.snapshotHandlers.clear();
    this.eventHandlers.clear();
    this.modeHandlers.clear();
  }
}

interface HostPeerSlot {
  peerUid: string;
  transport: SimulatedTransport;
  unsubs: Array<() => void>;
  snapshotBudget: number;
  lastBroadcastMs: number;
}

export interface HostNetworkOptions {
  roomCode: string;
  hostUid: string;
  db?: Database;
  initialPeerUids?: ReadonlyArray<string>;
  autoWatchRoomPlayers?: boolean;
  initialNetSim?: Partial<NetSimConfig>;
}

/**
 * Host-side Star-Topology hub managing one AdaptivePeerTransport per remote client,
 * broadcasting snapshots at 20 Hz (`p2p`) / 10 Hz (`relay`) and reliable events.
 */
export class HostNetwork {
  public readonly roomCode: string;
  public readonly hostUid: string;

  private readonly db: Database;
  private readonly peers = new Map<string, HostPeerSlot>();
  private netSimConfig: NetSimConfig;
  private unsubPlayersWatch: (() => void) | null = null;
  private closed = false;

  private readonly inputHandlers = new Set<
    (peerUid: string, pkt: ClientInputPacket) => void
  >();
  private readonly eventHandlers = new Set<
    (peerUid: string, ev: NetGameEvent) => void
  >();
  private readonly clientMessageHandlers = new Set<
    (peerUid: string, msg: ClientReliableMessage) => void
  >();
  private readonly peerModeHandlers = new Set<
    (peerUid: string, mode: TransportMode) => void
  >();

  constructor(options: HostNetworkOptions) {
    this.roomCode = options.roomCode;
    this.hostUid = options.hostUid;
    this.db = options.db ?? getFirebaseServices().db;
    this.netSimConfig = { ...DEFAULT_NET_SIM, ...options.initialNetSim };

    if (options.initialPeerUids) {
      this.syncPeers(options.initialPeerUids);
    }

    if (options.autoWatchRoomPlayers !== false) {
      const playersRef = ref(this.db, `rooms/${this.roomCode}/players`);
      this.unsubPlayersWatch = onValue(playersRef, (snap) => {
        if (this.closed) return;
        const val = snap.val() as Record<string, { online?: boolean }> | null;
        if (!val) {
          this.syncPeers([]);
          return;
        }
        const activePeers: string[] = [];
        for (const [uid, pData] of Object.entries(val)) {
          if (uid !== this.hostUid && pData && pData.online !== false) {
            activePeers.push(uid);
          }
        }
        this.syncPeers(activePeers);
      });
    }
  }

  /**
   * Ensures an AdaptivePeerTransport exists for every active non-host UID in `peerUids`
   * and closes transports for peers that have left.
   */
  public syncPeers(peerUids: ReadonlyArray<string>): void {
    if (this.closed) return;
    const desired = new Set<string>();
    for (const uid of peerUids) {
      if (uid && uid !== this.hostUid) {
        desired.add(uid);
      }
    }

    for (const existingUid of Array.from(this.peers.keys())) {
      if (!desired.has(existingUid)) {
        this.removePeer(existingUid);
      }
    }

    for (const uid of desired) {
      if (!this.peers.has(uid)) {
        this.addPeer(uid);
      }
    }
  }

  public addPeer(peerUid: string): void {
    if (this.closed || !peerUid || peerUid === this.hostUid || this.peers.has(peerUid)) {
      return;
    }

    const adaptive = new AdaptivePeerTransport({
      db: this.db,
      roomCode: this.roomCode,
      clientPeerUid: peerUid,
      remoteUid: peerUid,
      isHost: true,
      forceRelay: Boolean(this.netSimConfig.enabled && this.netSimConfig.forceRelay),
    });

    const simTransport = new SimulatedTransport(adaptive, this.netSimConfig);
    const unsubs: Array<() => void> = [];

    unsubs.push(
      simTransport.onState((raw) => {
        if (this.closed) return;
        const pkt = decodeInput(raw);
        if (!pkt) return;
        for (const h of this.inputHandlers) {
          h(peerUid, pkt);
        }
      }),
    );

    unsubs.push(
      simTransport.onEvent((raw) => {
        if (this.closed) return;
        if (isClientMessageFrame(raw)) {
          const msg = decodeClientMessage(raw);
          if (!msg) return;
          for (const h of this.clientMessageHandlers) {
            h(peerUid, msg);
          }
          return;
        }
        const ev = decodeEvent(raw);
        if (!ev) return;
        for (const h of this.eventHandlers) {
          h(peerUid, ev);
        }
      }),
    );

    unsubs.push(
      simTransport.onModeChange((mode) => {
        if (this.closed) return;
        for (const h of this.peerModeHandlers) {
          h(peerUid, mode);
        }
      }),
    );

    this.peers.set(peerUid, {
      peerUid,
      transport: simTransport,
      unsubs,
      snapshotBudget: 1,
      lastBroadcastMs: monotonicNowMs(),
    });
  }

  public removePeer(peerUid: string): void {
    const slot = this.peers.get(peerUid);
    if (!slot) return;
    this.peers.delete(peerUid);
    for (const unsub of slot.unsubs) {
      unsub();
    }
    slot.transport.close();
  }

  /**
   * Broadcasts `WorldSnapshot` using fractional rate accumulators so 30 Hz simulation ticks
   * emit exact 20 Hz snapshots to `'p2p'` peers and 10 Hz snapshots to `'relay'` peers.
   */
  public broadcastSnapshot(snap: WorldSnapshot, nowMs = monotonicNowMs()): void {
    if (this.closed || this.peers.size === 0) return;

    let encoded: string | null = null;
    for (const slot of this.peers.values()) {
      const mode = slot.transport.getMode();
      if (mode !== 'p2p' && mode !== 'relay') {
        slot.lastBroadcastMs = nowMs;
        continue;
      }

      const dtSec = Math.min(0.25, Math.max(0, (nowMs - slot.lastBroadcastMs) / 1000));
      slot.lastBroadcastMs = nowMs;

      const targetHz = mode === 'p2p' ? HOST_SNAPSHOT_HZ_P2P : HOST_SNAPSHOT_HZ_RELAY;
      slot.snapshotBudget = Math.min(2, slot.snapshotBudget + dtSec * targetHz);

      if (slot.snapshotBudget >= 0.999) {
        slot.snapshotBudget -= 1;
        if (encoded === null) {
          encoded = encodeSnapshot(snap);
        }
        slot.transport.sendState(encoded);
      }
    }
  }

  public broadcastEvent(ev: NetGameEvent): void {
    if (this.closed || this.peers.size === 0) return;
    const encoded = encodeEvent(ev);
    for (const slot of this.peers.values()) {
      slot.transport.sendEvent(encoded);
    }
  }

  public sendEventToPeer(peerUid: string, ev: NetGameEvent): void {
    if (this.closed) return;
    const slot = this.peers.get(peerUid);
    if (!slot) return;
    slot.transport.sendEvent(encodeEvent(ev));
  }

  public onClientInput(
    handler: (peerUid: string, pkt: ClientInputPacket) => void,
  ): () => void {
    this.inputHandlers.add(handler);
    return () => {
      this.inputHandlers.delete(handler);
    };
  }

  public onClientEvent(
    handler: (peerUid: string, ev: NetGameEvent) => void,
  ): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  public onClientMessage(
    handler: (peerUid: string, msg: ClientReliableMessage) => void,
  ): () => void {
    this.clientMessageHandlers.add(handler);
    return () => {
      this.clientMessageHandlers.delete(handler);
    };
  }

  public onPeerModeChange(
    handler: (peerUid: string, mode: TransportMode) => void,
  ): () => void {
    this.peerModeHandlers.add(handler);
    return () => {
      this.peerModeHandlers.delete(handler);
    };
  }

  public getPeerUids(): string[] {
    return Array.from(this.peers.keys());
  }

  public getPeerMode(peerUid: string): TransportMode {
    return this.peers.get(peerUid)?.transport.getMode() ?? 'disconnected';
  }

  public getPeerMetrics(peerUid: string): TransportMetrics | null {
    return this.peers.get(peerUid)?.transport.getMetrics() ?? null;
  }

  public getPeerRttMs(peerUid: string): number {
    return this.peers.get(peerUid)?.transport.getMetrics().rttMs ?? 0;
  }

  public getMode(): TransportMode {
    if (this.closed) return 'disconnected';
    if (this.peers.size === 0) return 'loopback';

    let hasP2p = false;
    let hasRelay = false;
    let hasConnecting = false;
    for (const slot of this.peers.values()) {
      const m = slot.transport.getMode();
      if (m === 'p2p') hasP2p = true;
      else if (m === 'relay') hasRelay = true;
      else if (m === 'connecting') hasConnecting = true;
    }

    if (hasRelay && !hasP2p) return 'relay';
    if (hasP2p) return 'p2p';
    if (hasConnecting) return 'connecting';
    return 'disconnected';
  }

  public getMetrics(): TransportMetrics {
    if (this.peers.size === 0) {
      return {
        mode: this.closed ? 'disconnected' : 'loopback',
        rttMs: this.netSimConfig.enabled ? this.netSimConfig.latencyMs : 0,
        packetLossPct: this.netSimConfig.enabled ? this.netSimConfig.packetLossPct : 0,
        txPacketsPerSec: 0,
        rxPacketsPerSec: 0,
      };
    }

    let rttSum = 0;
    let lossSum = 0;
    let activeCount = 0;
    let txSum = 0;
    let rxSum = 0;

    for (const slot of this.peers.values()) {
      const m = slot.transport.getMetrics();
      txSum += m.txPacketsPerSec;
      rxSum += m.rxPacketsPerSec;
      if (m.mode === 'p2p' || m.mode === 'relay') {
        rttSum += m.rttMs;
        lossSum += m.packetLossPct;
        activeCount++;
      }
    }

    return {
      mode: this.getMode(),
      rttMs: activeCount > 0 ? Math.round((rttSum / activeCount) * 10) / 10 : 0,
      packetLossPct:
        activeCount > 0 ? Math.round((lossSum / activeCount) * 10) / 10 : 0,
      txPacketsPerSec: txSum,
      rxPacketsPerSec: rxSum,
    };
  }

  public setNetSim(cfg: Partial<NetSimConfig>): void {
    const merged: NetSimConfig = {
      ...this.netSimConfig,
      ...cfg,
    };
    if (cfg.enabled === undefined) {
      merged.enabled =
        merged.latencyMs > 0 ||
        merged.jitterMs > 0 ||
        merged.packetLossPct > 0 ||
        merged.forceRelay;
    }
    this.netSimConfig = merged;

    for (const slot of this.peers.values()) {
      slot.transport.setSimConfig(cfg);
    }
  }

  public getNetSim(): NetSimConfig {
    return { ...this.netSimConfig };
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    this.unsubPlayersWatch?.();
    this.unsubPlayersWatch = null;

    for (const peerUid of Array.from(this.peers.keys())) {
      this.removePeer(peerUid);
    }

    this.inputHandlers.clear();
    this.eventHandlers.clear();
    this.clientMessageHandlers.clear();
    this.peerModeHandlers.clear();
  }
}

export interface StarNetworkConfig {
  role: 'host' | 'client';
  roomCode: string;
  localUid: string;
  hostUid: string;
  db?: Database;
  initialPeerUids?: ReadonlyArray<string>;
  autoWatchRoomPlayers?: boolean;
  initialNetSim?: Partial<NetSimConfig>;
}

/**
 * Unified Star-Topology room network facade wrapping `HostNetwork` or `ClientNetwork`.
 */
export class StarNetwork {
  public readonly role: 'host' | 'client';
  public readonly host: HostNetwork | null;
  public readonly client: ClientNetwork | null;

  constructor(config: StarNetworkConfig) {
    this.role = config.role;
    if (config.role === 'host') {
      this.host = new HostNetwork({
        roomCode: config.roomCode,
        hostUid: config.hostUid,
        db: config.db,
        initialPeerUids: config.initialPeerUids,
        autoWatchRoomPlayers: config.autoWatchRoomPlayers,
        initialNetSim: config.initialNetSim,
      });
      this.client = null;
    } else {
      this.client = new ClientNetwork({
        roomCode: config.roomCode,
        localUid: config.localUid,
        hostUid: config.hostUid,
        db: config.db,
        initialNetSim: config.initialNetSim,
      });
      this.host = null;
    }
  }

  public static createHost(options: HostNetworkOptions): HostNetwork {
    return new HostNetwork(options);
  }

  public static createClient(options: ClientNetworkOptions): ClientNetwork {
    return new ClientNetwork(options);
  }

  public sendClientMessage(msg: ClientReliableMessage): void {
    this.client?.sendClientMessage(msg);
  }

  public onClientMessage(
    handler: (peerUid: string, msg: ClientReliableMessage) => void,
  ): () => void {
    return this.host ? this.host.onClientMessage(handler) : () => {};
  }

  public getPeerRttMs(peerUid: string): number {
    return this.host ? this.host.getPeerRttMs(peerUid) : 0;
  }

  public getMode(): TransportMode {
    return this.host ? this.host.getMode() : this.client!.getMode();
  }

  public getMetrics(): TransportMetrics {
    return this.host ? this.host.getMetrics() : this.client!.getMetrics();
  }

  public setNetSim(cfg: Partial<NetSimConfig>): void {
    if (this.host) this.host.setNetSim(cfg);
    else this.client?.setNetSim(cfg);
  }

  public getNetSim(): NetSimConfig {
    return this.host ? this.host.getNetSim() : this.client!.getNetSim();
  }

  public syncPeers(peerUids: ReadonlyArray<string>): void {
    this.host?.syncPeers(peerUids);
  }

  public close(): void {
    this.host?.close();
    this.client?.close();
  }
}
