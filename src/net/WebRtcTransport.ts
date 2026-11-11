import type { Database } from 'firebase/database';
import type { TransportMetrics, TransportMode } from '../core/types';
import { getIceServers, PING_INTERVAL_MS } from './config';
import { monotonicNowMs, type NetTransport, TelemetryTracker } from './NetTransport';
import {
  decodeControlFrame,
  encodePing,
  encodePong,
  peekStateFrameTag,
} from './Protocol';
import { createSignalingSessionId, PeerSignalingChannel } from './Signaling';

const MAX_STATE_BUFFERED_BYTES = 65_536;

export interface WebRtcTransportOptions {
  db: Database;
  roomCode: string;
  /** Always the non-host client's UID (identifies `signaling/{peerUid}`). */
  clientPeerUid: string;
  /** On the Client this equals `hostUid`; on the Host this equals `clientPeerUid`. */
  remoteUid: string;
  isHost: boolean;
}

/**
 * WebRTC Star-Topology peer link with two negotiated DataChannels:
 * - id 0 ('state'): unordered, unreliable (`ordered: false, maxRetransmits: 0`)
 * - id 1 ('events'): ordered, reliable (`ordered: true`)
 */
export class WebRtcTransport implements NetTransport {
  public readonly peerUid: string;
  private readonly isHost: boolean;
  private readonly signaling: PeerSignalingChannel;
  private readonly telemetry = new TelemetryTracker();

  private mode: TransportMode = 'connecting';
  private closed = false;

  private pc: RTCPeerConnection | null = null;
  private stateChannel: RTCDataChannel | null = null;
  private eventsChannel: RTCDataChannel | null = null;

  private activeSessionId: string | null = null;
  private remoteDescriptionReady = false;
  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  private readonly pendingOutEvents: string[] = [];

  private readonly unsubSignaling: Array<() => void> = [];
  private unsubCandidateStream: (() => void) | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  private readonly stateHandlers = new Set<(payload: string) => void>();
  private readonly eventHandlers = new Set<(payload: string) => void>();
  private readonly modeHandlers = new Set<(mode: TransportMode) => void>();

  constructor(options: WebRtcTransportOptions) {
    this.peerUid = options.remoteUid;
    this.isHost = options.isHost;
    this.signaling = new PeerSignalingChannel(
      options.db,
      options.roomCode,
      options.clientPeerUid,
    );

    if (typeof RTCPeerConnection === 'undefined') {
      this.setMode('disconnected');
      return;
    }

    this.pingInterval = setInterval(() => {
      this.sendHeartbeatPing();
    }, PING_INTERVAL_MS);

    if (this.isHost) {
      this.startHostResponder();
    } else {
      void this.startClientInitiator(options.clientPeerUid);
    }
  }

  public static isSupported(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  }

  public getMode(): TransportMode {
    return this.mode;
  }

  public getMetrics(): TransportMetrics {
    return this.telemetry.snapshot(this.mode);
  }

  public sendState(payload: string): void {
    if (this.closed) return;
    if (!this.stateChannel || this.stateChannel.readyState !== 'open') {
      return;
    }
    if (this.stateChannel.bufferedAmount > MAX_STATE_BUFFERED_BYTES) {
      return;
    }
    try {
      this.stateChannel.send(payload);
      this.telemetry.recordTx();
    } catch {
      // Ignore transient RTCDataChannel send errors on close/reset
    }
  }

  public sendEvent(payload: string): void {
    if (this.closed) return;
    if (this.eventsChannel && this.eventsChannel.readyState === 'open') {
      try {
        this.eventsChannel.send(payload);
        this.telemetry.recordTx();
        return;
      } catch {
        // Queue below if channel transitioning
      }
    }
    if (this.pendingOutEvents.length < 64) {
      this.pendingOutEvents.push(payload);
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

    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.unsubCandidateStream?.();
    this.unsubCandidateStream = null;

    for (const unsub of this.unsubSignaling) {
      unsub();
    }
    this.unsubSignaling.length = 0;

    this.teardownPeerConnection();
    this.setMode('disconnected');

    if (!this.isHost) {
      void this.signaling.clearAll().catch(() => {});
    }

    this.stateHandlers.clear();
    this.eventHandlers.clear();
    this.modeHandlers.clear();
  }

  private async startClientInitiator(ownUid: string): Promise<void> {
    try {
      await this.signaling.clearAll().catch(() => {});
      if (this.closed) return;

      const sessionId = createSignalingSessionId(ownUid);
      this.activeSessionId = sessionId;
      this.remoteDescriptionReady = false;
      this.pendingRemoteCandidates = [];

      const pc = this.createConfiguredPeerConnection(sessionId);

      this.unsubSignaling.push(
        this.signaling.onHostCandidate((msg) => {
          if (this.closed || msg.sessionId !== this.activeSessionId) return;
          this.enqueueOrApplyIceCandidate(msg.candidate);
        }),
      );

      this.unsubSignaling.push(
        this.signaling.onAnswer((ans) => {
          if (this.closed || ans.sessionId !== this.activeSessionId || !this.pc) return;
          if (this.pc.signalingState !== 'have-local-offer') return;
          void this.applyRemoteAnswer(ans.sdp);
        }),
      );

      const offer = await pc.createOffer();
      if (this.closed || this.pc !== pc || !offer.sdp) return;
      await pc.setLocalDescription(offer);
      if (this.closed || this.pc !== pc) return;

      await this.signaling.writeOffer(sessionId, offer.sdp);
    } catch {
      if (!this.closed) {
        this.setMode('disconnected');
      }
    }
  }

  private startHostResponder(): void {
    this.unsubSignaling.push(
      this.signaling.onOffer((offer) => {
        if (this.closed) return;
        if (offer.sessionId === this.activeSessionId) return;
        void this.handleIncomingClientOffer(offer.sessionId, offer.sdp);
      }),
    );
  }

  private async handleIncomingClientOffer(sessionId: string, sdp: string): Promise<void> {
    try {
      this.unsubCandidateStream?.();
      this.unsubCandidateStream = null;
      this.teardownPeerConnection();

      this.activeSessionId = sessionId;
      this.remoteDescriptionReady = false;
      this.pendingRemoteCandidates = [];
      if (this.mode !== 'connecting') {
        this.setMode('connecting');
      }

      await this.signaling.clearHostCandidates().catch(() => {});
      if (this.closed || this.activeSessionId !== sessionId) return;

      const pc = this.createConfiguredPeerConnection(sessionId);

      this.unsubCandidateStream = this.signaling.onPeerCandidate((msg) => {
        if (this.closed || msg.sessionId !== this.activeSessionId) return;
        this.enqueueOrApplyIceCandidate(msg.candidate);
      });

      await pc.setRemoteDescription({ type: 'offer', sdp });
      if (this.closed || this.pc !== pc) return;
      this.remoteDescriptionReady = true;
      await this.flushPendingIceCandidates();

      const answer = await pc.createAnswer();
      if (this.closed || this.pc !== pc || !answer.sdp) return;
      await pc.setLocalDescription(answer);
      if (this.closed || this.pc !== pc) return;

      await this.signaling.writeAnswer(sessionId, answer.sdp);
    } catch {
      if (!this.closed) {
        this.setMode('disconnected');
      }
    }
  }

  private async applyRemoteAnswer(sdp: string): Promise<void> {
    if (!this.pc || this.closed) return;
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
      if (this.closed || !this.pc) return;
      this.remoteDescriptionReady = true;
      await this.flushPendingIceCandidates();
    } catch {
      if (!this.closed) {
        this.setMode('disconnected');
      }
    }
  }

  private createConfiguredPeerConnection(sessionId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    this.pc = pc;

    const stateDc = pc.createDataChannel('state', {
      ordered: false,
      maxRetransmits: 0,
      negotiated: true,
      id: 0,
    });
    const eventsDc = pc.createDataChannel('events', {
      ordered: true,
      negotiated: true,
      id: 1,
    });

    this.stateChannel = stateDc;
    this.eventsChannel = eventsDc;

    const checkChannelsReady = () => {
      if (this.closed || this.pc !== pc) return;
      if (
        this.stateChannel?.readyState === 'open' &&
        this.eventsChannel?.readyState === 'open'
      ) {
        this.setMode('p2p');
        this.flushPendingOutEvents();
        this.sendHeartbeatPing();
      }
    };

    const handleChannelClosed = () => {
      if (this.closed || this.pc !== pc) return;
      if (this.mode === 'p2p') {
        this.setMode('disconnected');
      }
    };

    stateDc.onopen = checkChannelsReady;
    eventsDc.onopen = checkChannelsReady;
    stateDc.onclose = handleChannelClosed;
    eventsDc.onclose = handleChannelClosed;
    stateDc.onerror = handleChannelClosed;
    eventsDc.onerror = handleChannelClosed;

    stateDc.onmessage = (ev) => {
      if (this.closed || typeof ev.data !== 'string') return;
      this.handleIncomingStateFrame(ev.data);
    };

    eventsDc.onmessage = (ev) => {
      if (this.closed || typeof ev.data !== 'string') return;
      this.telemetry.recordRx();
      for (const h of this.eventHandlers) {
        h(ev.data);
      }
    };

    pc.onicecandidate = (ev) => {
      if (this.closed || this.activeSessionId !== sessionId || !ev.candidate) {
        return;
      }
      const init = ev.candidate.toJSON();
      if (this.isHost) {
        void this.signaling.pushHostCandidate(sessionId, init).catch(() => {});
      } else {
        void this.signaling.pushPeerCandidate(sessionId, init).catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.closed || this.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        this.setMode('disconnected');
      }
    };

    return pc;
  }

  private handleIncomingStateFrame(raw: string): void {
    const tag = peekStateFrameTag(raw);
    if (tag === 'p' || tag === 'q') {
      const ctrl = decodeControlFrame(raw);
      if (!ctrl) return;
      if (ctrl.kind === 'ping') {
        if (this.stateChannel?.readyState === 'open') {
          try {
            this.stateChannel.send(encodePong(ctrl.pingId, ctrl.t0));
          } catch {
            // Ignore transient channel error
          }
        }
      } else {
        this.telemetry.recordPong(ctrl.pingId, ctrl.t0, monotonicNowMs());
      }
      return;
    }

    this.telemetry.recordRx();
    for (const h of this.stateHandlers) {
      h(raw);
    }
  }

  private sendHeartbeatPing(): void {
    if (this.closed || this.mode !== 'p2p') return;
    if (!this.stateChannel || this.stateChannel.readyState !== 'open') return;
    const { pingId, t0 } = this.telemetry.createPing();
    try {
      this.stateChannel.send(encodePing(pingId, t0));
    } catch {
      // Ignore transient error
    }
  }

  private flushPendingOutEvents(): void {
    if (!this.eventsChannel || this.eventsChannel.readyState !== 'open') return;
    while (this.pendingOutEvents.length > 0) {
      const msg = this.pendingOutEvents.shift()!;
      try {
        this.eventsChannel.send(msg);
        this.telemetry.recordTx();
      } catch {
        this.pendingOutEvents.unshift(msg);
        break;
      }
    }
  }

  private enqueueOrApplyIceCandidate(candidate: RTCIceCandidateInit): void {
    if (!this.remoteDescriptionReady || !this.pc) {
      this.pendingRemoteCandidates.push(candidate);
      return;
    }
    void this.pc.addIceCandidate(candidate).catch(() => {});
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.pc || !this.remoteDescriptionReady) return;
    const batch = this.pendingRemoteCandidates.splice(0, this.pendingRemoteCandidates.length);
    for (const cand of batch) {
      if (this.closed || !this.pc) return;
      await this.pc.addIceCandidate(cand).catch(() => {});
    }
  }

  private teardownPeerConnection(): void {
    if (this.stateChannel) {
      this.stateChannel.onopen = null;
      this.stateChannel.onclose = null;
      this.stateChannel.onerror = null;
      this.stateChannel.onmessage = null;
      try {
        this.stateChannel.close();
      } catch {
        // Ignore
      }
      this.stateChannel = null;
    }
    if (this.eventsChannel) {
      this.eventsChannel.onopen = null;
      this.eventsChannel.onclose = null;
      this.eventsChannel.onerror = null;
      this.eventsChannel.onmessage = null;
      try {
        this.eventsChannel.close();
      } catch {
        // Ignore
      }
      this.eventsChannel = null;
    }
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        // Ignore
      }
      this.pc = null;
    }
  }

  private setMode(next: TransportMode): void {
    if (this.mode === next) return;
    this.mode = next;
    for (const h of this.modeHandlers) {
      h(next);
    }
  }
}
