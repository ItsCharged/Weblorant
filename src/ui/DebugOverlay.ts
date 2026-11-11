import type { MapId, NetSimConfig, PlayerStance, TransportMode, Vec3 } from '../core/types';

export interface DebugNetTelemetry {
  role: 'host' | 'client' | 'offline';
  transportMode: TransportMode;
  rttMs: number;
  packetLossPct: number;
  snapshotRateHz: number;
  reconcileErrorMm: number;
  interpolatedPlayers: number;
  netSim: NetSimConfig;
}

export interface DebugTelemetry {
  fps: number;
  simTickRate: number;
  measuredTicksPerSec: number;
  backendName: string;
  drawCalls?: number;
  mapId: MapId;
  pos: Vec3;
  speed: number;
  stance: PlayerStance;
  spreadDeg: number;
  recoilShotIndex: number;
  aliveDummies: number;
  totalDummies: number;
  net: DebugNetTelemetry;
}

export class DebugOverlay {
  private readonly el: HTMLElement;
  private visible = false;

  private readonly valFps: HTMLElement;
  private readonly valTick: HTMLElement;
  private readonly valPing: HTMLElement;
  private readonly valLoss: HTMLElement;
  private readonly valTransport: HTMLElement;
  private readonly valReconcile: HTMLElement;
  private readonly valInterp: HTMLElement;
  private readonly valNetSim: HTMLElement;
  private readonly valBackend: HTMLElement;
  private readonly valDrawCalls: HTMLElement;
  private readonly valMap: HTMLElement;
  private readonly valPos: HTMLElement;
  private readonly valSpeed: HTMLElement;
  private readonly valStance: HTMLElement;
  private readonly valSpread: HTMLElement;
  private readonly valRecoil: HTMLElement;
  private readonly valDummies: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('aside');
    this.el.id = 'debug-overlay';
    this.el.className = 'shard-debug-overlay';
    this.el.hidden = true;

    this.el.innerHTML = `
      <div class="debug-header">SHARDLINE // DIAGNOSE &amp; NETCODE [F3]</div>
      <div class="debug-row"><span class="debug-key">FPS</span><span class="debug-val" data-dbg="fps">0</span></div>
      <div class="debug-row"><span class="debug-key">SIM-TICKRATE</span><span class="debug-val" data-dbg="tick">30 Hz</span></div>
      <div class="debug-row"><span class="debug-key">PING (RTT)</span><span class="debug-val" data-dbg="ping">--</span></div>
      <div class="debug-row"><span class="debug-key">PAKETVERLUST</span><span class="debug-val" data-dbg="loss">0.0 %</span></div>
      <div class="debug-row"><span class="debug-key">TRANSPORT</span><span class="debug-val" data-dbg="transport">Offline</span></div>
      <div class="debug-row"><span class="debug-key">PREDICTION-KORR.</span><span class="debug-val" data-dbg="reconcile">0.0 mm</span></div>
      <div class="debug-row"><span class="debug-key">INTERPOL. SPIELER</span><span class="debug-val" data-dbg="interp">0</span></div>
      <div class="debug-row"><span class="debug-key">NETZ-SIMULATOR</span><span class="debug-val" data-dbg="netsim">Ideal (0 ms)</span></div>
      <div class="debug-sep"></div>
      <div class="debug-row"><span class="debug-key">RENDERER</span><span class="debug-val" data-dbg="backend">--</span></div>
      <div class="debug-row"><span class="debug-key">DRAW-CALLS</span><span class="debug-val" data-dbg="drawcalls">0</span></div>
      <div class="debug-row"><span class="debug-key">KARTE</span><span class="debug-val" data-dbg="map">--</span></div>
      <div class="debug-row"><span class="debug-key">POS (X,Y,Z)</span><span class="debug-val" data-dbg="pos">0, 0, 0</span></div>
      <div class="debug-row"><span class="debug-key">TEMPO</span><span class="debug-val" data-dbg="speed">0.00 m/s</span></div>
      <div class="debug-row"><span class="debug-key">HALTUNG</span><span class="debug-val" data-dbg="stance">STAND</span></div>
      <div class="debug-row"><span class="debug-key">STREUUNG</span><span class="debug-val" data-dbg="spread">0.00°</span></div>
      <div class="debug-row"><span class="debug-key">RÜCKSTOSS-IDX</span><span class="debug-val" data-dbg="recoil">0</span></div>
      <div class="debug-row"><span class="debug-key">AKTIVE ZIELE</span><span class="debug-val" data-dbg="dummies">0 / 0</span></div>
    `;

    container.appendChild(this.el);

    const q = (key: string): HTMLElement =>
      this.el.querySelector(`[data-dbg="${key}"]`) as HTMLElement;

    this.valFps = q('fps');
    this.valTick = q('tick');
    this.valPing = q('ping');
    this.valLoss = q('loss');
    this.valTransport = q('transport');
    this.valReconcile = q('reconcile');
    this.valInterp = q('interp');
    this.valNetSim = q('netsim');
    this.valBackend = q('backend');
    this.valDrawCalls = q('drawcalls');
    this.valMap = q('map');
    this.valPos = q('pos');
    this.valSpeed = q('speed');
    this.valStance = q('stance');
    this.valSpread = q('spread');
    this.valRecoil = q('recoil');
    this.valDummies = q('dummies');
  }

  public toggle(force?: boolean): boolean {
    this.visible = force !== undefined ? force : !this.visible;
    this.el.hidden = !this.visible;
    return this.visible;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public update(data: DebugTelemetry): void {
    if (!this.visible) return;

    this.valFps.textContent = `${Math.round(data.fps)}`;

    const net = data.net;
    if (net.role === 'offline') {
      this.valTick.textContent = `${data.simTickRate} Hz (${Math.round(data.measuredTicksPerSec)}/s)`;
      this.valPing.textContent = '-- (Offline)';
      this.valLoss.textContent = '0.0 %';
      this.valTransport.textContent = 'Offline';
      this.valTransport.dataset.state = 'offline';
      this.valReconcile.textContent = '0.0 mm';
      this.valInterp.textContent = '0';
    } else {
      this.valTick.textContent = `${data.simTickRate} Hz · Snap ${net.snapshotRateHz} Hz`;
      this.valPing.textContent =
        net.role === 'host' && net.interpolatedPlayers === 0
          ? '0 ms (Host)'
          : net.role === 'host'
            ? `0 ms (Host · Peer ~${Math.round(net.rttMs)} ms)`
            : `${Math.round(net.rttMs)} ms`;
      this.valLoss.textContent = `${net.packetLossPct.toFixed(1)} %`;

      let transportLabel = 'Verbindet...';
      let transportState = 'warn';
      if (net.role === 'host') {
        if (net.transportMode === 'relay') {
          transportLabel = 'Host-Autorität (Relay 10 Hz)';
          transportState = 'warn';
        } else if (net.transportMode === 'p2p') {
          transportLabel = 'Host-Autorität (P2P 20 Hz)';
          transportState = 'good';
        } else {
          transportLabel = 'Host-Autorität';
          transportState = 'good';
        }
      } else {
        switch (net.transportMode) {
          case 'p2p':
            transportLabel = 'P2P (WebRTC)';
            transportState = 'good';
            break;
          case 'relay':
            transportLabel = 'Relay (RTDB 10 Hz)';
            transportState = 'warn';
            break;
          case 'loopback':
            transportLabel = 'Loopback';
            transportState = 'good';
            break;
          case 'connecting':
            transportLabel = 'Verbindet...';
            transportState = 'warn';
            break;
          case 'disconnected':
          default:
            transportLabel = 'Getrennt';
            transportState = 'warn';
            break;
        }
      }
      this.valTransport.textContent = transportLabel;
      this.valTransport.dataset.state = transportState;
      this.valReconcile.textContent = `${net.reconcileErrorMm.toFixed(1)} mm`;
      this.valInterp.textContent = `${net.interpolatedPlayers}`;
    }

    if (!net.netSim.enabled && !net.netSim.forceRelay) {
      this.valNetSim.textContent = 'Ideal (0 ms)';
      this.valNetSim.dataset.state = 'offline';
    } else {
      const parts: string[] = [];
      if (net.netSim.latencyMs > 0) parts.push(`+${Math.round(net.netSim.latencyMs)} ms`);
      if (net.netSim.packetLossPct > 0) parts.push(`${net.netSim.packetLossPct}% Loss`);
      if (net.netSim.forceRelay) parts.push('Relay erzwungen');
      this.valNetSim.textContent = parts.join(' · ') || 'Aktiv';
      this.valNetSim.dataset.state = 'warn';
    }

    this.valBackend.textContent = data.backendName;
    this.valDrawCalls.textContent = data.drawCalls !== undefined ? `${data.drawCalls}` : '--';
    this.valMap.textContent = data.mapId.toUpperCase();
    this.valPos.textContent = `${data.pos.x.toFixed(2)}, ${data.pos.y.toFixed(2)}, ${data.pos.z.toFixed(2)}`;
    this.valSpeed.textContent = `${data.speed.toFixed(2)} m/s`;
    this.valStance.textContent = data.stance.toUpperCase();
    this.valSpread.textContent = `${data.spreadDeg.toFixed(2)}°`;
    this.valRecoil.textContent = `${data.recoilShotIndex}`;
    this.valDummies.textContent = `${data.aliveDummies} / ${data.totalDummies}`;
  }

  public dispose(): void {
    this.el.remove();
  }
}
