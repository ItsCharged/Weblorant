import type { NetSimConfig, TransportMetrics, TransportMode } from '../core/types';
import { DEFAULT_NET_SIM } from './config';
import { monotonicNowMs, type NetTransport } from './NetTransport';

export interface RelayControllableTransport extends NetTransport {
  setForceRelay?(force: boolean): void;
}

/**
 * Decorator around any NetTransport that injects configurable latency, jitter,
 * unreliable state packet loss, and forced RTDB relay mode for live QA testing.
 */
export class SimulatedTransport implements NetTransport {
  public readonly peerUid: string;
  private readonly inner: RelayControllableTransport;
  private config: NetSimConfig;
  private closed = false;

  private readonly stateHandlers = new Set<(payload: string) => void>();
  private readonly eventHandlers = new Set<(payload: string) => void>();
  private readonly modeHandlers = new Set<(mode: TransportMode) => void>();

  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private lastOutEventDeliverAt = 0;
  private lastInEventDeliverAt = 0;

  private unsubInnerState: (() => void) | null = null;
  private unsubInnerEvent: (() => void) | null = null;
  private unsubInnerMode: (() => void) | null = null;

  constructor(inner: RelayControllableTransport, initialConfig?: Partial<NetSimConfig>) {
    this.inner = inner;
    this.peerUid = inner.peerUid;
    this.config = { ...DEFAULT_NET_SIM, ...initialConfig };

    this.unsubInnerState = this.inner.onState((payload) => {
      this.handleIncomingState(payload);
    });
    this.unsubInnerEvent = this.inner.onEvent((payload) => {
      this.handleIncomingEvent(payload);
    });
    this.unsubInnerMode = this.inner.onModeChange((mode) => {
      for (const h of this.modeHandlers) {
        h(mode);
      }
    });

    if (this.config.forceRelay && this.inner.setForceRelay) {
      this.inner.setForceRelay(true);
    }
  }

  public setSimConfig(partial: Partial<NetSimConfig>): void {
    const next: NetSimConfig = {
      ...this.config,
      ...partial,
    };

    if (partial.enabled === undefined) {
      next.enabled =
        next.latencyMs > 0 ||
        next.jitterMs > 0 ||
        next.packetLossPct > 0 ||
        next.forceRelay;
    }

    next.latencyMs = Math.max(0, next.latencyMs);
    next.jitterMs = Math.max(0, next.jitterMs);
    next.packetLossPct = Math.min(100, Math.max(0, next.packetLossPct));

    this.config = next;

    if (this.inner.setForceRelay) {
      this.inner.setForceRelay(Boolean(next.enabled && next.forceRelay) || Boolean(partial.forceRelay && next.forceRelay));
    }
  }

  public getSimConfig(): NetSimConfig {
    return { ...this.config };
  }

  public getMode(): TransportMode {
    return this.inner.getMode();
  }

  public getMetrics(): TransportMetrics {
    const base = this.inner.getMetrics();
    if (!this.isDelayOrLossActive()) {
      return base;
    }

    const simLossRatio = this.config.packetLossPct / 100;
    const baseLossRatio = Math.min(1, Math.max(0, base.packetLossPct / 100));
    const combinedLossPct =
      Math.round((1 - (1 - baseLossRatio) * (1 - simLossRatio)) * 1000) / 10;

    return {
      ...base,
      rttMs: Math.round((base.rttMs + this.config.latencyMs) * 10) / 10,
      packetLossPct: combinedLossPct,
    };
  }

  public sendState(payload: string): void {
    if (this.closed) return;
    if (!this.isDelayOrLossActive()) {
      this.inner.sendState(payload);
      return;
    }

    if (this.shouldDropOneWayState()) {
      return;
    }

    const delayMs = this.computeOneWayDelayMs();
    if (delayMs <= 0) {
      this.inner.sendState(payload);
      return;
    }

    this.schedule(delayMs, () => {
      if (!this.closed) {
        this.inner.sendState(payload);
      }
    });
  }

  public sendEvent(payload: string): void {
    if (this.closed) return;
    if (!this.isDelayOrLossActive() || (this.config.latencyMs <= 0 && this.config.jitterMs <= 0)) {
      this.inner.sendEvent(payload);
      return;
    }

    const now = monotonicNowMs();
    const rawTarget = now + this.computeOneWayDelayMs();
    const orderedTarget = Math.max(this.lastOutEventDeliverAt, rawTarget);
    this.lastOutEventDeliverAt = orderedTarget;

    const delayMs = Math.max(0, orderedTarget - now);
    if (delayMs <= 0) {
      this.inner.sendEvent(payload);
      return;
    }

    this.schedule(delayMs, () => {
      if (!this.closed) {
        this.inner.sendEvent(payload);
      }
    });
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

    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();

    this.unsubInnerState?.();
    this.unsubInnerEvent?.();
    this.unsubInnerMode?.();
    this.unsubInnerState = null;
    this.unsubInnerEvent = null;
    this.unsubInnerMode = null;

    this.stateHandlers.clear();
    this.eventHandlers.clear();
    this.modeHandlers.clear();

    this.inner.close();
  }

  private handleIncomingState(payload: string): void {
    if (this.closed) return;
    if (!this.isDelayOrLossActive()) {
      this.emitState(payload);
      return;
    }

    if (this.shouldDropOneWayState()) {
      return;
    }

    const delayMs = this.computeOneWayDelayMs();
    if (delayMs <= 0) {
      this.emitState(payload);
      return;
    }

    this.schedule(delayMs, () => {
      if (!this.closed) {
        this.emitState(payload);
      }
    });
  }

  private handleIncomingEvent(payload: string): void {
    if (this.closed) return;
    if (!this.isDelayOrLossActive() || (this.config.latencyMs <= 0 && this.config.jitterMs <= 0)) {
      this.emitEvent(payload);
      return;
    }

    const now = monotonicNowMs();
    const rawTarget = now + this.computeOneWayDelayMs();
    const orderedTarget = Math.max(this.lastInEventDeliverAt, rawTarget);
    this.lastInEventDeliverAt = orderedTarget;

    const delayMs = Math.max(0, orderedTarget - now);
    if (delayMs <= 0) {
      this.emitEvent(payload);
      return;
    }

    this.schedule(delayMs, () => {
      if (!this.closed) {
        this.emitEvent(payload);
      }
    });
  }

  private emitState(payload: string): void {
    for (const h of this.stateHandlers) {
      h(payload);
    }
  }

  private emitEvent(payload: string): void {
    for (const h of this.eventHandlers) {
      h(payload);
    }
  }

  private isDelayOrLossActive(): boolean {
    return (
      this.config.enabled &&
      (this.config.latencyMs > 0 || this.config.jitterMs > 0 || this.config.packetLossPct > 0)
    );
  }

  private shouldDropOneWayState(): boolean {
    if (this.config.packetLossPct <= 0) return false;
    if (this.config.packetLossPct >= 100) return true;
    const roundTripSurvival = 1 - this.config.packetLossPct / 100;
    const oneWayDropProb = 1 - Math.sqrt(roundTripSurvival);
    return Math.random() < oneWayDropProb;
  }

  private computeOneWayDelayMs(): number {
    const halfRtt = this.config.latencyMs * 0.5;
    const jitter =
      this.config.jitterMs > 0 ? (Math.random() * 2 - 1) * this.config.jitterMs : 0;
    return Math.max(0, Math.round(halfRtt + jitter));
  }

  private schedule(delayMs: number, fn: () => void): void {
    const handle = setTimeout(() => {
      this.pendingTimers.delete(handle);
      fn();
    }, delayMs);
    this.pendingTimers.add(handle);
  }
}
