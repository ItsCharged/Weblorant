export class LoadingScreen {
  private readonly root: HTMLElement | null;
  private readonly barFillEl: HTMLElement | null;
  private readonly statusEl: HTMLElement | null;
  private readonly percentEl: HTMLElement | null;
  private hideTimer: number | null = null;

  constructor() {
    this.root = document.getElementById('loading-screen');
    this.barFillEl = document.getElementById('loading-bar-fill');
    this.statusEl = document.getElementById('loading-status');
    this.percentEl = document.getElementById('loading-percent');
  }

  public setProgress(percent: number, statusText?: string): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (this.barFillEl) {
      this.barFillEl.style.width = `${clamped}%`;
    }
    if (this.percentEl) {
      this.percentEl.textContent = `${clamped}%`;
    }
    if (statusText && this.statusEl) {
      this.statusEl.textContent = statusText;
    }
  }

  public show(statusText = 'WIRD GELADEN...'): void {
    if (!this.root) return;
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.root.hidden = false;
    this.root.classList.remove('is-hiding');
    this.setProgress(15, statusText);
  }

  public hide(): void {
    if (!this.root) return;
    this.setProgress(100, 'BEREIT');
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
    }
    this.hideTimer = window.setTimeout(() => {
      if (!this.root) return;
      this.root.classList.add('is-hiding');
      this.hideTimer = window.setTimeout(() => {
        if (this.root) {
          this.root.hidden = true;
        }
        this.hideTimer = null;
      }, 280);
    }, 120);
  }
}
