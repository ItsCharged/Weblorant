import type { TeamId } from '../core/types';

/**
 * SHARDLINE in-game chat overlay.
 *
 * - Bottom-left, above the vitals: a compact message log that fades out while idle.
 * - `Enter` opens the input line, `Tab` toggles `[ALLE]` / `[TEAM]`, `Enter` sends,
 *   `Escape` closes.
 * - While the input is open, a capture-phase key guard keeps every keystroke away from
 *   gameplay listeners (WASD / B / Q / E / X / 1-3 / Tab scoreboard), and mouse clicks
 *   cannot fire weapons.
 * - XSS-safe: every player-provided string is rendered with `textContent`, never `innerHTML`.
 */

export interface ChatOverlayCallbacks {
  /** Called with sanitized, non-empty text. */
  onSend: (text: string, teamOnly: boolean) => void;
  /** Whether `Enter` may open the chat right now (in-game, no menus open). */
  canOpen: () => boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface ChatLine {
  senderName: string;
  team: TeamId;
  text: string;
  teamOnly: boolean;
  isLocal: boolean;
}

interface LogEntry {
  el: HTMLElement;
  age: number;
}

const MAX_LOG_ENTRIES = 8;
const ENTRY_VISIBLE_SEC = 9;
const ENTRY_FADE_SEC = 1.2;
const MAX_INPUT_LENGTH = 140;

export function sanitizeChatInput(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_INPUT_LENGTH);
}

export class ChatOverlay {
  private readonly root: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly inputRow: HTMLElement;
  private readonly scopeBtn: HTMLButtonElement;
  private readonly inputEl: HTMLInputElement;
  private readonly callbacks: ChatOverlayCallbacks;
  private readonly entries: LogEntry[] = [];

  private openState = false;
  private teamOnly = false;
  private enabled = false;
  private localTeam: TeamId = 'A';

  constructor(container: HTMLElement, callbacks: ChatOverlayCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('section');
    this.root.id = 'hud-chat';
    this.root.className = 'shard-chat';
    this.root.setAttribute('aria-label', 'Einsatz-Chat');
    this.root.hidden = true;

    this.logEl = document.createElement('div');
    this.logEl.className = 'chat-log';
    this.logEl.setAttribute('role', 'log');
    this.logEl.setAttribute('aria-live', 'polite');

    this.inputRow = document.createElement('div');
    this.inputRow.className = 'chat-input-row';
    this.inputRow.hidden = true;

    this.scopeBtn = document.createElement('button');
    this.scopeBtn.type = 'button';
    this.scopeBtn.className = 'chat-scope-btn';
    this.scopeBtn.tabIndex = -1;
    this.scopeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.toggleScope();
    });

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.id = 'hud-chat-input';
    this.inputEl.className = 'chat-input';
    this.inputEl.maxLength = MAX_INPUT_LENGTH;
    this.inputEl.autocomplete = 'off';
    this.inputEl.spellcheck = false;
    this.inputEl.setAttribute('aria-label', 'Chat-Nachricht eingeben');
    this.inputEl.placeholder = 'Nachricht · [Tab] Kanal · [Enter] Senden · [Esc] Schließen';

    const hint = document.createElement('span');
    hint.className = 'chat-input-hint';
    hint.textContent = 'ENTER';

    this.inputRow.append(this.scopeBtn, this.inputEl, hint);
    this.root.append(this.logEl, this.inputRow);
    container.appendChild(this.root);

    this.syncScopeLabel();

    window.addEventListener('keydown', this.handleKeyCapture, true);
    window.addEventListener('mousedown', this.handleMouseCapture, true);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.hidden = !enabled;
    if (!enabled) {
      this.close();
    }
  }

  public setLocalTeam(team: TeamId): void {
    this.localTeam = team;
  }

  public isOpen(): boolean {
    return this.openState;
  }

  public open(teamOnly?: boolean): void {
    if (!this.enabled || this.openState) return;
    if (teamOnly !== undefined) this.teamOnly = teamOnly;
    this.openState = true;
    this.root.classList.add('is-open');
    this.inputRow.hidden = false;
    this.inputEl.value = '';
    this.syncScopeLabel();
    for (const entry of this.entries) {
      entry.el.style.opacity = '1';
    }
    // Defer focus so the opening Enter keystroke never lands in the field
    window.setTimeout(() => {
      if (this.openState) this.inputEl.focus({ preventScroll: true });
    }, 0);
    this.callbacks.onOpenChange?.(true);
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.remove('is-open');
    this.inputRow.hidden = true;
    this.inputEl.value = '';
    this.inputEl.blur();
    this.callbacks.onOpenChange?.(false);
  }

  private toggleScope(): void {
    this.teamOnly = !this.teamOnly;
    this.syncScopeLabel();
  }

  private syncScopeLabel(): void {
    this.scopeBtn.textContent = this.teamOnly ? '[TEAM]' : '[ALLE]';
    this.scopeBtn.dataset.scope = this.teamOnly ? 'team' : 'all';
    this.inputRow.dataset.scope = this.teamOnly ? 'team' : 'all';
  }

  private submit(): void {
    const text = sanitizeChatInput(this.inputEl.value);
    if (text.length > 0) {
      this.callbacks.onSend(text, this.teamOnly);
    }
    this.close();
  }

  private readonly handleKeyCapture = (e: KeyboardEvent): void => {
    if (!this.enabled) return;

    if (!this.openState) {
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && this.callbacks.canOpen()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.open();
      }
      return;
    }

    // Chat open: keep every keystroke away from gameplay listeners.
    // F3 debug overlay is still allowed through for diagnostics.
    if (e.code === 'F3') return;

    e.stopImmediatePropagation();

    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (!e.repeat) this.submit();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) this.toggleScope();
      return;
    }

    if (document.activeElement !== this.inputEl) {
      this.inputEl.focus({ preventScroll: true });
    }
  };

  private readonly handleMouseCapture = (e: MouseEvent): void => {
    if (!this.openState) return;
    if (e.target instanceof Node && this.root.contains(e.target)) return;
    // Clicking outside while typing never fires a weapon
    e.stopImmediatePropagation();
  };

  private pushEntry(el: HTMLElement): void {
    this.logEl.appendChild(el);
    this.entries.push({ el, age: 0 });
    while (this.entries.length > MAX_LOG_ENTRIES) {
      const oldest = this.entries.shift();
      oldest?.el.remove();
    }
  }

  public addMessage(line: ChatLine): void {
    const row = document.createElement('div');
    row.className = `chat-line${line.teamOnly ? ' is-team' : ''}${line.isLocal ? ' is-self' : ''}`;

    const scope = document.createElement('span');
    scope.className = 'chat-line-scope';
    scope.textContent = line.teamOnly ? '[TEAM]' : '[ALLE]';

    const name = document.createElement('span');
    name.className = 'chat-line-name';
    name.dataset.relation = line.team === this.localTeam ? 'ally' : 'enemy';
    name.textContent = `${line.senderName}:`;

    const text = document.createElement('span');
    text.className = 'chat-line-text';
    text.textContent = line.text;

    row.append(scope, name, text);
    this.pushEntry(row);
  }

  public addSystem(text: string, tone: 'info' | 'warn' = 'info'): void {
    const row = document.createElement('div');
    row.className = `chat-line is-system${tone === 'warn' ? ' is-warn' : ''}`;
    const tag = document.createElement('span');
    tag.className = 'chat-line-scope';
    tag.textContent = '[SYSTEM]';
    const body = document.createElement('span');
    body.className = 'chat-line-text';
    body.textContent = text;
    row.append(tag, body);
    this.pushEntry(row);
  }

  public clear(): void {
    for (const entry of this.entries) entry.el.remove();
    this.entries.length = 0;
  }

  public update(frameDt: number): void {
    if (!this.enabled) return;
    for (const entry of this.entries) {
      entry.age += frameDt;
      if (this.openState) continue;
      if (entry.age <= ENTRY_VISIBLE_SEC) {
        entry.el.style.opacity = '1';
      } else {
        const t = Math.min(1, (entry.age - ENTRY_VISIBLE_SEC) / ENTRY_FADE_SEC);
        entry.el.style.opacity = (1 - t).toFixed(2);
      }
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.handleKeyCapture, true);
    window.removeEventListener('mousedown', this.handleMouseCapture, true);
    this.root.remove();
  }
}
