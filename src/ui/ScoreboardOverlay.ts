import type { CharacterId, NetPlayerState, TeamId, TransportMode } from '../core/types';
import { CHARACTERS, TEAM_DEFS } from '../data/characters';
import { getArmorSvg, getRoleSvg, getWeaponSvg } from '../data/uiIcons';
import { WEAPONS } from '../data/weapons';

/**
 * SHARDLINE tactical `Tab` scoreboard.
 *
 * Shown only while `Tab` is held during gameplay (pointer lock stays engaged).
 * Two team tables (`VERBÜNDETE` / `GEGNER`) with specialist role, alive state,
 * current weapon + shield, ultimate progress, K / T / A, Splitter and ping.
 * All player-provided strings are written via `textContent` only.
 */

export interface ScoreboardRow {
  uid: string;
  name: string;
  team: TeamId;
  character: CharacterId;
  alive: boolean;
  weaponLabel: string;
  weaponSvgId: string | null;
  armor: number;
  armorMax: number;
  ultPoints: number;
  ultMax: number;
  kills: number;
  deaths: number;
  assists: number;
  credits: number;
  pingLabel: string;
  isSelf: boolean;
  hasKern?: boolean;
}

export interface ScoreboardState {
  title: string;
  subtitle: string;
  localTeam: TeamId;
  scoreAlly: number;
  scoreEnemy: number;
  allyLabel?: string;
  enemyLabel?: string;
  rows: ReadonlyArray<ScoreboardRow>;
}

const COLUMN_HEADERS = ['Spezialist / Spieler', 'Waffe', 'Ultimate', 'K / T / A', 'Splitter', 'Ping'];

export function formatPingLabel(
  isSelf: boolean,
  isHostPlayer: boolean,
  localIsHost: boolean,
  rttMs: number,
  transport: TransportMode
): string {
  if (isHostPlayer && localIsHost && isSelf) return '0 ms · HOST';
  const mode = transport === 'relay' ? 'RELAY' : transport === 'p2p' || transport === 'loopback' ? 'P2P' : '—';
  if (isSelf || isHostPlayer) {
    return `${Math.max(0, Math.round(rttMs))} ms · ${mode}`;
  }
  return mode;
}

export function rowFromNetPlayer(
  p: NetPlayerState,
  opts: { isSelf: boolean; pingLabel: string; ultMax: number }
): ScoreboardRow {
  const isKnife = p.activeSlot === 3;
  return {
    uid: p.uid,
    name: p.name,
    team: p.team,
    character: p.character,
    alive: p.alive,
    weaponLabel: isKnife ? 'Taktik-Klinge' : (WEAPONS[p.weaponId]?.name ?? p.weaponId),
    weaponSvgId: isKnife ? 'knife' : p.weaponId,
    armor: p.armor,
    armorMax: p.armorMax,
    ultPoints: p.abilities?.ultPoints ?? p.ultPoints,
    ultMax: p.abilities?.ultMax ?? opts.ultMax,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    credits: p.credits,
    pingLabel: opts.pingLabel,
    isSelf: opts.isSelf,
    hasKern: p.hasKern,
  };
}

export class ScoreboardOverlay {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly scoreAllyEl: HTMLElement;
  private readonly scoreEnemyEl: HTMLElement;
  private readonly allyLabelEl: HTMLElement;
  private readonly enemyLabelEl: HTMLElement;
  private readonly allyBody: HTMLTableSectionElement;
  private readonly enemyBody: HTMLTableSectionElement;
  private readonly enemySection: HTMLElement;
  private visible = false;
  private renderedKey = '';

  constructor(container: HTMLElement) {
    this.root = document.createElement('section');
    this.root.id = 'tab-scoreboard';
    this.root.className = 'shard-tab-scoreboard';
    this.root.setAttribute('aria-labelledby', 'tab-scoreboard-title');
    this.root.hidden = true;

    const shell = document.createElement('div');
    shell.className = 'tabsb-shell';

    const header = document.createElement('header');
    header.className = 'tabsb-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'tabsb-title-wrap';
    this.titleEl = document.createElement('h2');
    this.titleEl.id = 'tab-scoreboard-title';
    this.titleEl.className = 'tabsb-title';
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'tabsb-subtitle';
    titleWrap.append(this.titleEl, this.subtitleEl);

    const scoreWrap = document.createElement('div');
    scoreWrap.className = 'tabsb-score';
    this.scoreAllyEl = document.createElement('span');
    this.scoreAllyEl.className = 'tabsb-score-num is-ally';
    const sep = document.createElement('span');
    sep.className = 'tabsb-score-sep';
    sep.textContent = ':';
    this.scoreEnemyEl = document.createElement('span');
    this.scoreEnemyEl.className = 'tabsb-score-num is-enemy';
    scoreWrap.append(this.scoreAllyEl, sep, this.scoreEnemyEl);

    const hint = document.createElement('span');
    hint.className = 'tabsb-hint';
    hint.textContent = '[TAB] HALTEN';

    header.append(titleWrap, scoreWrap, hint);

    const makeSection = (side: 'ally' | 'enemy'): { section: HTMLElement; label: HTMLElement; body: HTMLTableSectionElement } => {
      const section = document.createElement('div');
      section.className = `tabsb-team is-${side}`;
      const label = document.createElement('div');
      label.className = 'tabsb-team-label';
      const table = document.createElement('table');
      table.className = 'tabsb-table';
      const thead = document.createElement('thead');
      const tr = document.createElement('tr');
      for (const h of COLUMN_HEADERS) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = h;
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      const body = document.createElement('tbody');
      table.append(thead, body);
      section.append(label, table);
      return { section, label, body };
    };

    const ally = makeSection('ally');
    const enemy = makeSection('enemy');
    this.allyLabelEl = ally.label;
    this.enemyLabelEl = enemy.label;
    this.allyBody = ally.body;
    this.enemyBody = enemy.body;
    this.enemySection = enemy.section;

    shell.append(header, ally.section, enemy.section);
    this.root.appendChild(shell);
    container.appendChild(this.root);
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.hidden = true;
  }

  public show(state: ScoreboardState): void {
    if (!this.visible) {
      this.visible = true;
      this.root.hidden = false;
      this.renderedKey = '';
    }

    this.titleEl.textContent = state.title;
    this.subtitleEl.textContent = state.subtitle;
    this.scoreAllyEl.textContent = `${state.scoreAlly}`;
    this.scoreEnemyEl.textContent = `${state.scoreEnemy}`;
    this.allyLabelEl.textContent = state.allyLabel ?? `VERBÜNDETE · ${TEAM_DEFS[state.localTeam].name.toUpperCase()}`;
    const enemyTeam: TeamId = state.localTeam === 'A' ? 'D' : 'A';
    this.enemyLabelEl.textContent = state.enemyLabel ?? `GEGNER · ${TEAM_DEFS[enemyTeam].name.toUpperCase()}`;

    const key = state.rows
      .map(
        (r) =>
          `${r.uid}|${r.name}|${r.team}|${r.character}|${r.alive ? 1 : 0}|${r.weaponLabel}|${Math.round(r.armor)}|${r.ultPoints}/${r.ultMax}|${r.kills}/${r.deaths}/${r.assists}|${Math.round(r.credits)}|${r.pingLabel}|${r.hasKern ? 1 : 0}`
      )
      .join(';');
    if (key === this.renderedKey) return;
    this.renderedKey = key;

    const sortRows = (a: ScoreboardRow, b: ScoreboardRow): number =>
      b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name);

    const allies = state.rows.filter((r) => r.team === state.localTeam).sort(sortRows);
    const enemies = state.rows.filter((r) => r.team !== state.localTeam).sort(sortRows);

    this.renderBody(this.allyBody, allies);
    this.renderBody(this.enemyBody, enemies);
    this.enemySection.hidden = enemies.length === 0;
  }

  private renderBody(body: HTMLTableSectionElement, rows: ReadonlyArray<ScoreboardRow>): void {
    body.textContent = '';
    for (const r of rows) {
      const c = CHARACTERS[r.character] ?? CHARACTERS.ryo;
      const tr = document.createElement('tr');
      tr.className = `tabsb-row${r.isSelf ? ' is-self' : ''}${r.alive ? '' : ' is-dead'}`;
      tr.style.setProperty('--char-accent', c.accentHex);

      // Specialist + name
      const thName = document.createElement('th');
      thName.scope = 'row';
      const nameWrap = document.createElement('div');
      nameWrap.className = 'tabsb-name-cell';
      const roleIcon = document.createElement('span');
      roleIcon.className = 'tabsb-role-icon';
      roleIcon.innerHTML = getRoleSvg(c.role); // static, code-generated SVG only
      const nameCol = document.createElement('div');
      nameCol.className = 'tabsb-name-col';
      const nameEl = document.createElement('span');
      nameEl.className = 'tabsb-player-name';
      nameEl.textContent = r.isSelf ? `${r.name} (Du)` : r.name;
      const subEl = document.createElement('span');
      subEl.className = 'tabsb-player-sub';
      subEl.textContent = `${c.name.toUpperCase()} · ${r.alive ? 'AKTIV' : 'AUSGESCHALTET'}${r.hasKern ? ' · ◆ KERN' : ''}`;
      nameCol.append(nameEl, subEl);
      nameWrap.append(roleIcon, nameCol);
      thName.appendChild(nameWrap);

      // Weapon + shield
      const tdWeapon = document.createElement('td');
      const weaponWrap = document.createElement('div');
      weaponWrap.className = 'tabsb-weapon-cell';
      const wSvg = document.createElement('span');
      wSvg.className = 'tabsb-weapon-svg';
      if (r.weaponSvgId) {
        wSvg.innerHTML = getWeaponSvg(r.weaponSvgId as Parameters<typeof getWeaponSvg>[0]);
      }
      const shieldSvg = document.createElement('span');
      shieldSvg.className = 'tabsb-shield-svg';
      const tier = r.armor > 25 ? 'heavy' : r.armor > 0 ? 'light' : 'none';
      shieldSvg.innerHTML = getArmorSvg(tier);
      shieldSvg.dataset.tier = tier;
      const wLabel = document.createElement('span');
      wLabel.className = 'tabsb-weapon-label';
      wLabel.textContent = r.weaponLabel.toUpperCase();
      weaponWrap.append(wSvg, shieldSvg, wLabel);
      tdWeapon.appendChild(weaponWrap);

      // Ultimate
      const tdUlt = document.createElement('td');
      tdUlt.className = 'is-mono';
      const ultReady = r.ultMax > 0 && r.ultPoints >= r.ultMax;
      tdUlt.textContent = ultReady ? 'BEREIT' : `◆ ${r.ultPoints}/${r.ultMax}`;
      if (ultReady) tdUlt.classList.add('is-ult-ready');

      const tdKda = document.createElement('td');
      tdKda.className = 'is-mono is-kda';
      tdKda.textContent = `${r.kills} / ${r.deaths} / ${r.assists}`;

      const tdCredits = document.createElement('td');
      tdCredits.className = 'is-mono is-credits';
      tdCredits.textContent = `◆ ${Math.round(r.credits).toLocaleString('de-DE')}`;

      const tdPing = document.createElement('td');
      tdPing.className = 'is-mono is-ping';
      tdPing.textContent = r.pingLabel;

      tr.append(thName, tdWeapon, tdUlt, tdKda, tdCredits, tdPing);
      body.appendChild(tr);
    }
  }

  public dispose(): void {
    this.root.remove();
  }
}
