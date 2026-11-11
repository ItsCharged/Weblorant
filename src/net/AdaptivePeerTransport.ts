import type { Database } from 'firebase/database';
import type { TransportMetrics, TransportMode } from '../core/types';
import { WEBRTC_FALLBACK_TIMEOUT_MS } from './config';
import type { RelayControllableTransport } from './SimulatedTransport';
import { RtdbRelayTransport } from './RtdbRelayTransport';
import { WebRtcTransport } from './WebRtcTransport';

const CTRL_FORCE_RELAY_ON = '__SHARD_RELAY__:1';
const CTRL_FORCE_RELAY_OFF = '__SHARD_RELAY__:0';

export interface AdaptivePeerTransportOptions {
  db: Database;
  roomCode: string;
  /** Non-host client's UID used for `signaling/{clientPeerUid}` & `relay/{clientPeerUid}`. */
  clientPeerUid: string;
  /** Remote peer's UID (`hostUid` on Client, `clientPeerUid` on Host). */
  remoteUid: string;
  isHost: boolean;
  forceRelay?: boolean;
  fallbackTimeoutMs?: number;
}

/**
 * Adaptive transport combining primary WebRTC DataChannels (`p2p`) with automatic
 * 8-second fallback (and mid-match drop recovery) to Firebase RTDB Relay (`relay`).
 */
export class AdaptivePeerTransport implements RelayControllableTransport {
  public readonly peerUid: string;
  private readonly options: AdaptivePeerTransportOptions;
  private readonly webrtc: WebRtcTransport;
  private relay: RtdbRelayTransport | null = null;

  private mode: TransportMode = 'connecting';
  private localForceRelay: boolean;
  private remoteForceRelay = false;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private readonly pendingEventsWhileConnecting: string[] = [];
  private readonly stateHandlers = new Set<(payload: string) => void>();
  private readonly eventHandlers = new Set<(payload: string) => void>();
  private readonly modeHandlers = new Set<(mode: TransportMode) => void>();

  private readonly unsubs: Array<() => void> = [];

  constructor(options: AdaptivePeerTransportOptions) {
    this.options = options;
    this.peerUid = options.remoteUid;
    this.localForceRelay = Boolean(options.forceRelay);

    this.webrtc = new WebRtcTransport({
      db: options.db,
      roomCode: options.roomCode,
      clientPeerUid: options.clientPeerUid,
      remoteUid: options.remoteUid,
      isHost: options.isHost,
    });

    this.unsubs.push(
      this.webrtc.onState((payload) => {
        if (this.closed || this.mode !== 'p2p') return;
        for (const h of this.stateHandlers) {
          h(payload);
        }
      }),
    );

    this.unsubs.push(
      this.webrtc.onEvent((payload) => {
        if (this.closed) return;
        if (payload === CTRL_FORCE_RELAY_ON) {
          this.remoteForceRelay = true;
          this.ensureRelay();
          this.recomputeActiveMode();
          return;
        }
        if (payload === CTRL_FORCE_RELAY_OFF) {
          this.remoteForceRelay = false;
          this.recomputeActiveMode();
          return;
        }
        for (const h of this.eventHandlers) {
          h(payload);
        }
      }),
    );

    this.unsubs.push(
      this.webrtc.onModeChange((rtcMode) => {
        if (this.closed) return;
        if (rtcMode === 'p2p') {
          this.clearFallbackTimer();
          if (this.localForceRelay) {
            this.webrtc.sendEvent(CTRL_FORCE_RELAY_ON);
          }
          this.recomputeActiveMode();
        } else if (rtcMode === 'disconnected') {
          // If WebRTC failed or dropped mid-game, engage RTDB relay immediately
          this.clearFallbackTimer();
          this.ensureRelay();
          this.recomputeActiveMode();
        }
      }),
    );

    if (this.localForceRelay || !WebRtcTransport.isSupported()) {
      this.ensureRelay();
      this.recomputeActiveMode();
    } else {
      const timeoutMs = options.fallbackTimeoutMs ?? WEBRTC_FALLBACK_TIMEOUT_MS;
      this.fallbackTimer = setTimeout(() => {
        this.fallbackTimer = null;
        if (this.closed) return;
        if (this.webrtc.getMode() !== 'p2p') {
          this.ensureRelay();
          this.recomputeActiveMode();
        }
      }, timeoutMs);
    }
  }

  public setForceRelay(force: boolean): void {
    if (this.closed || this.localForceRelay === force) return;
    this.localForceRelay = force;

    if (force) {
      this.ensureRelay();
      if (this.webrtc.getMode() === 'p2p') {
        this.webrtc.sendEvent(CTRL_FORCE_RELAY_ON);
      }
    } else if (this.webrtc.getMode() === 'p2p') {
      this.webrtc.sendEvent(CTRL_FORCE_RELAY_OFF);
    }

    this.recomputeActiveMode();
  }

  public getMode(): TransportMode {
    return this.mode;
  }

  public getMetrics(): TransportMetrics {
    if (this.mode === 'p2p') {
      return this.webrtc.getMetrics();
    }
    if (this.mode === 'relay' && this.relay) {
      return this.relay.getMetrics();
    }
    return {
      mode: this.mode,
      rttMs: 0,
      packetLossPct: 0,
      txPacketsPerSec: 0,
      rxPacketsPerSec: 0,
    };
  }

  public sendState(payload: string): void {
    if (this.closed) return;
    if (this.mode === 'p2p') {
      this.webrtc.sendState(payload);
    } else if (this.mode === 'relay' && this.relay) {
      this.relay.sendState(payload);
    }
  }

  public sendEvent(payload: string): void {
    if (this.closed) return;
    if (this.mode === 'p2p') {
      this.webrtc.sendEvent(payload);
      return;
    }
    if (this.mode === 'relay' && this.relay) {
      this.relay.sendEvent(payload);
      return;
    }
    if (this.pendingEventsWhileConnecting.length < 32) {
      this.pendingEventsWhileConnecting.push(payload);
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

    this.clearFallbackTimer();

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;

    this.webrtc.close();
    if (this.relay) {
      this.relay.close();
      this.relay = null;
    }

    this.setMode('disconnected');
    this.stateHandlers.clear();
    this.eventHandlers.clear();
    this.modeHandlers.clear();
    this.pendingEventsWhileConnecting.length = 0;
  }

  private ensureRelay(): RtdbRelayTransport {
    if (!this.relay) {
      this.relay = new RtdbRelayTransport({
        db: this.options.db,
        roomCode: this.options.roomCode,
        clientPeerUid: this.options.clientPeerUid,
        remoteUid: this.options.remoteUid,
        isHost: this.options.isHost,
      });

      this.unsubs.push(
        this.relay.onState((payload) => {
          if (this.closed || this.mode !== 'relay') return;
          for (const h of this.stateHandlers) {
            h(payload);
          }
        }),
      );

      this.unsubs.push(
        this.relay.onEvent((payload) => {
          if (this.closed) return;
          for (const h of this.eventHandlers) {
            h(payload);
          }
        }),
      );
    }
    return this.relay;
  }

  private recomputeActiveMode(): void {
    if (this.closed) return;

    const forceAny = this.localForceRelay || this.remoteForceRelay;
    let nextMode: TransportMode;

    if (!forceAny && this.webrtc.getMode() === 'p2p') {
      nextMode = 'p2p';
      this.relay?.setPaused(true);
    } else if (this.relay) {
      nextMode = 'relay';
      this.relay.setPaused(false);
    } else {
      nextMode = 'connecting';
    }

    this.setMode(nextMode);

    if ((nextMode === 'p2p' || nextMode === 'relay') && this.pendingEventsWhileConnecting.length > 0) {
      const queued = this.pendingEventsWhileConnecting.splice(
        0,
        this.pendingEventsWhileConnecting.length,
      );
      for (const msg of queued) {
        this.sendEvent(msg);
      }
    }
  }

  private clearFallbackTimer(): void {
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
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
