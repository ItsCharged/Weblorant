import type { NetPlayerState, TeamId } from '../core/types';
import { CHARACTERS, TEAM_DEFS } from '../data/characters';

export interface MatchEndState {
  mode: 'ended' | 'scoreboard';
  localUid: string;
  localTeam: TeamId;
  isHost: boolean;
  roundNumber: number;
  roundsToWin: number;
  scoreA: number;
  scoreB: number;
  matchWinnerTeam?: TeamId;
  players: ReadonlyArray<NetPlayerState>;
}

export interface MatchEndCallbacks {
  onReturnToRoomLobby: () => void;
  onLeaveRoom: () => void;
}

export class MatchEndOverlay {
  private readonly root: HTMLElement;
  private readonly callbacks: MatchEndCallbacks;
  private visible = false;
  private currentMode: 'ended' | 'scoreboard' = 'ended';
  private renderedKey = '';

  private readonly kickerEl: HTMLElement;
  private readonly outcomeTitleEl: HTMLElement;
  private readonly scoreAEl: HTMLElement;
  private readonly scoreBEl: HTMLElement;
  private readonly captionEl: HTMLElement;
  private readonly tbodyEl: HTMLElement;
  private readonly footerEl: HTMLElement;
  private readonly hostReturnBtn: HTMLButtonElement;
  private readonly clientWaitHintEl: HTMLElement;

  constructor(container: HTMLElement, callbacks: MatchEndCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('section');
    this.root.id = 'match-end-overlay';
    this.root.className = 'shard-matchend-overlay';
    this.root.setAttribute('aria-labelledby', 'matchend-outcome-title');
    this.root.hidden = true;

    // Responsive semantic data table per modern-web-guidance `responsive-table`
    this.root.innerHTML = `
      <div class="matchend-shell">
        <header class="matchend-header">
          <div class="matchend-kicker" id="matchend-kicker">MATCH BEENDET</div>
          <h1 class="matchend-outcome" id="matchend-outcome-title">SIEG</h1>
          <div class="matchend-score-row">
            <div class="matchend-team-score is-a">
              <span class="team-score-label">ANGREIFER</span>
              <span class="team-score-num" id="matchend-score-a">7</span>
            </div>
            <span class="matchend-score-sep">:</span>
            <div class="matchend-team-score is-d">
              <span class="team-score-num" id="matchend-score-b">0</span>
              <span class="team-score-label">VERTEIDIGER</span>
            </div>
          </div>
        </header>

        <div
          tabindex="0"
          role="region"
          aria-labelledby="scoreboard-table-caption"
          class="table-wrapper matchend-table-wrapper"
        >
          <table class="matchend-table">
            <caption id="scoreboard-table-caption" class="matchend-caption">
              Einsatz-Statistik · Runde 1
            </caption>
            <thead>
              <tr>
                <th scope="col">Spieler</th>
                <th scope="col">Team</th>
                <th scope="col">Spezialist</th>
                <th scope="col">K / T / A</th>
                <th scope="col">Kerne gelegt</th>
                <th scope="col">Entschärft</th>
                <th scope="col">Splitter</th>
              </tr>
            </thead>
            <tbody id="matchend-tbody"></tbody>
          </table>
        </div>

        <footer class="matchend-footer" id="matchend-footer">
          <span class="matchend-wait-hint" id="matchend-wait-hint" hidden>
            Host kann das Team zurück in die Raum-Lobby führen…
          </span>
          <div class="matchend-actions">
            <button type="button" class="lobby-cta-btn is-cyan" id="btn-match-return-lobby">
              ZURÜCK IN DIE RAUM-LOBBY
            </button>
            <button type="button" class="lobby-cta-btn is-amber" id="btn-match-leave-room">
              RAUM VERLASSEN
            </button>
          </div>
        </footer>
      </div>
    `;

    container.appendChild(this.root);

    this.kickerEl = this.root.querySelector('#matchend-kicker') as HTMLElement;
    this.outcomeTitleEl = this.root.querySelector('#matchend-outcome-title') as HTMLElement;
    this.scoreAEl = this.root.querySelector('#matchend-score-a') as HTMLElement;
    this.scoreBEl = this.root.querySelector('#matchend-score-b') as HTMLElement;
    this.captionEl = this.root.querySelector('#scoreboard-table-caption') as HTMLElement;
    this.tbodyEl = this.root.querySelector('#matchend-tbody') as HTMLElement;
    this.footerEl = this.root.querySelector('#matchend-footer') as HTMLElement;
    this.hostReturnBtn = this.root.querySelector('#btn-match-return-lobby') as HTMLButtonElement;
    this.clientWaitHintEl = this.root.querySelector('#matchend-wait-hint') as HTMLElement;

    this.hostReturnBtn.addEventListener('click', () => {
      this.callbacks.onReturnToRoomLobby();
    });

    const leaveBtn = this.root.querySelector('#btn-match-leave-room') as HTMLButtonElement;
    leaveBtn.addEventListener('click', () => {
      this.callbacks.onLeaveRoom();
    });
  }

  public isOpen(): boolean {
    return this.visible && this.currentMode === 'ended';
  }

  public hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.hidden = true;
    this.renderedKey = '';
  }

  public show(state: MatchEndState): void {
    this.visible = true;
    this.currentMode = state.mode;
    this.root.hidden = false;
    this.root.dataset.mode = state.mode;

    this.scoreAEl.textContent = `${state.scoreA}`;
    this.scoreBEl.textContent = `${state.scoreB}`;

    if (state.mode === 'ended') {
      const winner = state.matchWinnerTeam ?? (state.scoreA >= state.scoreB ? 'A' : 'D');
      const won = winner === state.localTeam;
      this.kickerEl.textContent = `MATCH BEENDET · ${TEAM_DEFS[winner].name.toUpperCase()} GEWINNEN`;
      this.outcomeTitleEl.textContent = won ? 'SIEG' : 'NIEDERLAGE';
      this.outcomeTitleEl.dataset.outcome = won ? 'win' : 'loss';
      this.captionEl.textContent = `Abschlussbericht · Nach ${state.roundNumber} Runden`;
      this.footerEl.hidden = false;
      this.hostReturnBtn.hidden = !state.isHost;
      this.clientWaitHintEl.hidden = state.isHost;
    } else {
      this.kickerEl.textContent = `LIVE-ÜBERSICHT [TAB] · ERSTER AUF ${state.roundsToWin}`;
      this.outcomeTitleEl.textContent = `RUNDE ${state.roundNumber}`;
      this.outcomeTitleEl.dataset.outcome = 'neutral';
      this.captionEl.textContent = `Aktive Spielerstatistik · Runde ${state.roundNumber}`;
      this.footerEl.hidden = true;
    }

    // Re-render rows only when stats change
    const sorted = [...state.players].sort((a, b) => {
      if (a.team !== b.team) return a.team === 'A' ? -1 : 1;
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    });

    const nextKey = sorted
      .map(
        (p) =>
          `${p.uid}:${p.team}:${p.character}:${p.kills}:${p.deaths}:${p.assists}:${p.plants}:${p.defuses}:${p.credits}:${p.alive}`
      )
      .join('|');

    if (this.renderedKey === nextKey) return;
    this.renderedKey = nextKey;

    this.tbodyEl.innerHTML = '';
    for (const p of sorted) {
      const tr = document.createElement('tr');
      tr.className = `matchend-row is-team-${p.team.toLowerCase()} ${
        p.uid === state.localUid ? 'is-self' : ''
      }`;

      const thName = document.createElement('th');
      thName.scope = 'row';
      thName.textContent = p.uid === state.localUid ? `${p.name} (Du)` : p.name;

      const tdTeam = document.createElement('td');
      tdTeam.textContent = TEAM_DEFS[p.team]?.name ?? p.team;
      tdTeam.dataset.team = p.team;

      const tdChar = document.createElement('td');
      tdChar.textContent = CHARACTERS[p.character]?.name ?? p.character;

      const tdKda = document.createElement('td');
      tdKda.className = 'is-mono';
      tdKda.textContent = `${p.kills} / ${p.deaths} / ${p.assists}`;

      const tdPlants = document.createElement('td');
      tdPlants.className = 'is-mono';
      tdPlants.textContent = `${p.plants}`;

      const tdDefuses = document.createElement('td');
      tdDefuses.className = 'is-mono';
      tdDefuses.textContent = `${p.defuses}`;

      const tdCredits = document.createElement('td');
      tdCredits.className = 'is-mono is-credits';
      tdCredits.textContent = `◆ ${Math.round(p.credits).toLocaleString('de-DE')}`;

      tr.append(thName, tdTeam, tdChar, tdKda, tdPlants, tdDefuses, tdCredits);
      this.tbodyEl.appendChild(tr);
    }
  }

  public dispose(): void {
    this.root.remove();
  }
}
