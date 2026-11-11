import { SIM_DT, SIM_TICK_RATE } from './Config';

export type TickCallback = (dt: number, tickCount: number) => void;
export type RenderCallback = (alpha: number, frameDt: number) => void;

export class GameLoop {
  private readonly tickFn: TickCallback;
  private readonly renderFn: RenderCallback;

  private running = false;
  private rafId: number | null = null;
  private lastTimeMs = 0;
  private accumulator = 0;
  private _tickCount = 0;

  private _fps = 60;
  private _ticksPerSecond = SIM_TICK_RATE;
  private metricElapsed = 0;
  private metricFrames = 0;
  private metricTicks = 0;

  constructor(tickFn: TickCallback, renderFn: RenderCallback) {
    this.tickFn = tickFn;
    this.renderFn = renderFn;
  }

  get fps(): number {
    return this._fps;
  }

  get ticksPerSecond(): number {
    return this._ticksPerSecond;
  }

  get tickCount(): number {
    return this._tickCount;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = performance.now();
    this.accumulator = 0;
    this.metricElapsed = 0;
    this.metricFrames = 0;
    this.metricTicks = 0;
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private readonly onFrame = (nowMs: number): void => {
    if (!this.running) return;

    const rawDt = (nowMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = nowMs;

    const frameDt = Math.min(Math.max(rawDt, 0), 0.25);
    this.accumulator += frameDt;

    while (this.accumulator >= SIM_DT) {
      this._tickCount += 1;
      this.tickFn(SIM_DT, this._tickCount);
      this.accumulator -= SIM_DT;
      this.metricTicks += 1;
    }

    const alpha = this.accumulator / SIM_DT;
    this.renderFn(alpha, frameDt);

    this.metricFrames += 1;
    this.metricElapsed += frameDt;

    if (this.metricElapsed >= 0.5) {
      this._fps = Math.round(this.metricFrames / this.metricElapsed);
      this._ticksPerSecond = Math.round(this.metricTicks / this.metricElapsed);
      this.metricElapsed = 0;
      this.metricFrames = 0;
      this.metricTicks = 0;
    }

    if (this.running) {
      this.rafId = requestAnimationFrame(this.onFrame);
    }
  };
}
