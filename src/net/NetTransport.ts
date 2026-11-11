import type { TransportMetrics, TransportMode } from '../core/types';

export interface NetTransport {
  readonly peerUid: string;
  getMode(): TransportMode;
  getMetrics(): TransportMetrics;
  /** Unreliable / unordered semantics: frequent inputs & world snapshots. */
  sendState(payload: string): void;
  /** Reliable / ordered semantics: shots, damage confirmations, kills, respawns. */
  sendEvent(payload: string): void;
  onState(handler: (payload: string) => void): () => void;
  onEvent(handler: (payload: string) => void): () => void;
  onModeChange(handler: (mode: TransportMode) => void): () => void;
  close(): void;
}

export function monotonicNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface PendingPingSlot {
  pingId: number;
  sentAtMs: number;
  acked: boolean;
}

/**
 * Rolling 32-ping RTT (EWMA) and packet-loss + 1s packet-rate telemetry helper
 * shared by WebRtcTransport and RtdbRelayTransport.
 */
export class TelemetryTracker {
  private nextPingId = 1;
  private rttEwmaMs = 0;
  private hasRttSample = false;
  private readonly history: PendingPingSlot[] = [];
  private readonly txTimestamps: number[] = [];
  private readonly rxTimestamps: number[] = [];

  public createPing(nowMs = monotonicNowMs()): { pingId: number; t0: number } {
    const pingId = this.nextPingId++;
    this.history.push({ pingId, sentAtMs: nowMs, acked: false });
    if (this.history.length > 32) {
      this.history.shift();
    }
    return { pingId, t0: nowMs };
  }

  public recordPong(pingId: number, t0: number, nowMs = monotonicNowMs()): void {
    const sampleRtt = Math.max(0, nowMs - t0);
    if (!this.hasRttSample) {
      this.rttEwmaMs = sampleRtt;
      this.hasRttSample = true;
    } else {
      this.rttEwmaMs = this.rttEwmaMs * 0.75 + sampleRtt * 0.25;
    }

    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].pingId === pingId) {
        this.history[i].acked = true;
        break;
      }
    }
  }

  public recordTx(nowMs = monotonicNowMs()): void {
    this.txTimestamps.push(nowMs);
    this.pruneWindow(this.txTimestamps, nowMs);
  }

  public recordRx(nowMs = monotonicNowMs()): void {
    this.rxTimestamps.push(nowMs);
    this.pruneWindow(this.rxTimestamps, nowMs);
  }

  public snapshot(mode: TransportMode, nowMs = monotonicNowMs()): TransportMetrics {
    this.pruneWindow(this.txTimestamps, nowMs);
    this.pruneWindow(this.rxTimestamps, nowMs);

    // Count pings that have either been acked or waited > 2500ms without a pong
    let eligible = 0;
    let lost = 0;
    for (const slot of this.history) {
      if (slot.acked) {
        eligible++;
      } else if (nowMs - slot.sentAtMs > 2500) {
        eligible++;
        lost++;
      }
    }

    const packetLossPct = eligible > 0 ? Math.round((lost / eligible) * 1000) / 10 : 0;

    return {
      mode,
      rttMs: Math.round(this.rttEwmaMs * 10) / 10,
      packetLossPct,
      txPacketsPerSec: this.txTimestamps.length,
      rxPacketsPerSec: this.rxTimestamps.length,
    };
  }

  private pruneWindow(arr: number[], nowMs: number): void {
    const cutoff = nowMs - 1000;
    while (arr.length > 0 && arr[0] < cutoff) {
      arr.shift();
    }
  }
}
