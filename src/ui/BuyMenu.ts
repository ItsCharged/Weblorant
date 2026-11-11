import { LOSS_STREAK_CREDITS, MAX_CREDITS, RUN_SPEED } from '../core/Config';
import type {
  ArmorTierId,
  BuyItemType,
  CharacterId,
  LoadoutSlot,
  MatchPhase,
  TeamId,
  WeaponId,
} from '../core/types';
import { CHARACTERS, TEAM_DEFS } from '../data/characters';
import { getSelectedFinishes } from '../data/progression';
import {
  getAbilitySvg,
  getArmorSvg,
  getRoleSvg,
  getWeaponSvg,
} from '../data/uiIcons';
import { ARMOR_TIERS, WEAPONS, type WeaponStats } from '../data/weapons';
import { computeDamage } from '../game/WeaponLogic';

export interface BuyMenuState {
  playerName: string;
  team: TeamId;
  character: CharacterId;
  credits: number;
  primaryWeapon: WeaponId | null;
  secondaryWeapon: WeaponId;
  activeSlot: LoadoutSlot;
  armor: number;
  armorMax: number;
  hasKern: boolean;
  qCharges?: number;
  qMax?: number;
  eCharges?: number;
  eMax?: number;
  ultPoints: number;
  ultMax?: number;
  phase: MatchPhase;
  phaseRemainingSec: number;
  canBuyNow: boolean;
  cannotBuyReason?: string;
}

export interface BuyMenuCallbacks {
  onBuyRequest: (itemType: BuyItemType, itemId: string) => void;
  onClose: () => void;
  onTeamCallout?: (intent: 'buy' | 'save', message: string) => void;
}

type InspectTarget =
  | { kind: 'weapon'; id: WeaponId }
  | { kind: 'armor'; id: Exclude<ArmorTierId, 'none'> }
  | { kind: 'ability'; key: 'q' | 'e' | 'ult' };

function formatSplitter(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('de-DE');
}

export class BuyMenu {
  private readonly root: HTMLElement;
  private readonly callbacks: BuyMenuCallbacks;
  private openState = false;
  private currentCharacter: CharacterId | null = null;
  private inspectTarget: InspectTarget = { kind: 'weapon', id: 'lanze' };
  private latestState: BuyMenuState | null = null;
  private statusToastTimer = 0;
  private activeCallout: 'buy' | 'save' | null = null;
  private lastEquipSignature = '';

  // Topbar & Left Player Column (`buy-col-player`) refs
  private readonly playerNameEl: HTMLElement;
  private readonly specialistBadgeEl: HTMLElement;
  private readonly teamBadgeEl: HTMLElement;
  private readonly kernCarrierBadgeEl: HTMLElement;
  private readonly loadoutShieldSvgEl: HTMLElement;
  private readonly loadoutShieldValEl: HTMLElement;
  private readonly loadoutSecSvgEl: HTMLElement;
  private readonly loadoutSecValEl: HTMLElement;
  private readonly loadoutPriSvgEl: HTMLElement;
  private readonly loadoutPriValEl: HTMLElement;
  private readonly phasePillEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly creditsValEl: HTMLElement;
  private readonly nextMinValEl: HTMLElement;
  private readonly calloutBuyBtn: HTMLButtonElement;
  private readonly calloutSaveBtn: HTMLButtonElement;

  // Center Grid & Ability Row (`buy-col-grid` + `FÄHIGKEITEN`)
  private readonly weaponBtns = new Map<WeaponId, HTMLButtonElement>();
  private readonly armorBtns = new Map<Exclude<ArmorTierId, 'none'>, HTMLButtonElement>();
  private readonly abilityBtns = new Map<'q' | 'e' | 'ult', HTMLButtonElement>();
  private readonly abilitiesRowEl: HTMLElement;

  // Right Inspector Column (`DETAILS`)
  private readonly detailCategoryEl: HTMLElement;
  private readonly detailTitleEl: HTMLElement;
  private readonly detailPriceEl: HTMLElement;
  private readonly detailPreviewEl: HTMLElement;
  private readonly detailBodyEl: HTMLElement;

  constructor(container: HTMLElement, callbacks: BuyMenuCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.id = 'buy-menu-overlay';
    this.root.className = 'shard-buy-overlay';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'buy-menu-title');
    this.root.hidden = true;

    this.root.innerHTML = `
      <div class="buy-shell">
        <header class="buy-header buy-topbar">
          <div class="buy-topbar-left">
            <h1 class="buy-player-title" id="buy-menu-title">AUSRÜSTUNGS-ARSENAL</h1>
            <div class="buy-phase-pill" id="buy-phase-pill">KAUFPHASE AKTIV</div>
          </div>

          <div class="buy-status-center">
            <div class="buy-toast" id="buy-toast" role="status" aria-live="polite"></div>
          </div>

          <div class="buy-topbar-right">
            <button type="button" class="buy-close-btn" id="btn-close-buymenu">
              SCHLIESSEN [B / ESC]
            </button>
          </div>
        </header>

        <div class="buy-main-layout buy-six-zone-layout">
          <aside class="buy-col-player" aria-label="Spieler-Ausrüstung und Splitter">
            <div class="buy-loadout-card" id="buy-loadout-card">
              <div class="buy-loadout-ident">
                <div class="buy-ident-row">
                  <span class="buy-team-tag" id="buy-team-tag">ANGREIFER</span>
                  <span class="buy-kern-pill" id="buy-kern-pill" hidden>◆ KERN-TRÄGER</span>
                </div>
                <span class="buy-player-name" id="buy-player-name">Agent</span>
                <div class="buy-specialist-tag" id="buy-specialist-tag"></div>
              </div>

              <div class="buy-equipped-strip" aria-label="Aktuelle 3-Slot Ausrüstung">
                <div class="buy-equipped-slot is-shield">
                  <div class="eq-slot-svg" id="buy-eq-shield-svg"></div>
                  <span class="eq-slot-label">SCHILD</span>
                  <span class="eq-slot-val" id="buy-eq-shield">Kein Schild (0)</span>
                </div>
                <div class="buy-equipped-slot is-secondary">
                  <div class="eq-slot-svg" id="buy-eq-sec-svg"></div>
                  <span class="eq-slot-label">[2] SEKUNDÄR</span>
                  <span class="eq-slot-val" id="buy-eq-sec">Funke</span>
                </div>
                <div class="buy-equipped-slot is-primary">
                  <div class="eq-slot-svg" id="buy-eq-pri-svg"></div>
                  <span class="eq-slot-label">[1] PRIMÄR</span>
                  <span class="eq-slot-val" id="buy-eq-pri">Leer</span>
                </div>
              </div>
            </div>

            <div class="buy-economy-card">
              <div class="buy-credits-main">
                <span class="buy-credits-caption">VERFÜGBARE SPLITTER</span>
                <span class="buy-credits-val" id="buy-credits-val">◆ 800</span>
              </div>
              <div class="buy-credits-next" id="buy-credits-next">MIN. NÄCHSTE RUNDE: ◆ 2.600</div>

              <div class="buy-callout-group" role="group" aria-label="Team-Kurzrufe">
                <button type="button" class="buy-callout-btn" id="btn-callout-buy" aria-pressed="false">
                  KAUFEN WIR
                </button>
                <button type="button" class="buy-callout-btn" id="btn-callout-save" aria-pressed="false">
                  SPAREN WIR
                </button>
              </div>
            </div>
          </aside>

          <div class="buy-grid-area">
            <div class="buy-col-grid buy-columns-grid">
              <section class="buy-col" aria-label="Sekundärwaffen">
                <h2 class="buy-col-heading">SEKUNDÄRWAFFEN</h2>
                <div class="buy-col-stack" data-col="secondary"></div>
              </section>

              <div class="buy-col buy-col-dual">
                <section class="buy-subcol" aria-label="Maschinenpistolen">
                  <h2 class="buy-col-heading">MASCHINENPISTOLEN</h2>
                  <div class="buy-col-stack" data-col="smg"></div>
                </section>
                <section class="buy-subcol" aria-label="Schrotflinten">
                  <h2 class="buy-col-heading">SCHROTFLINTEN</h2>
                  <div class="buy-col-stack" data-col="shotgun"></div>
                </section>
              </div>

              <div class="buy-col buy-col-dual">
                <section class="buy-subcol" aria-label="Sturmgewehre">
                  <h2 class="buy-col-heading">STURMGEWEHRE</h2>
                  <div class="buy-col-stack" data-col="assault"></div>
                </section>
                <section class="buy-subcol" aria-label="Präzisionsgewehre">
                  <h2 class="buy-col-heading">PRÄZISIONSGEWEHRE</h2>
                  <div class="buy-col-stack" data-col="sniper"></div>
                </section>
              </div>

              <section class="buy-col" aria-label="Verteidigung">
                <h2 class="buy-col-heading">VERTEIDIGUNG</h2>
                <div class="buy-col-stack" data-col="armor"></div>
              </section>
            </div>

            <section class="buy-abilities-section" aria-label="Fähigkeiten">
              <h2 class="buy-col-heading" id="buy-abilities-heading">FÄHIGKEITEN</h2>
              <div class="buy-abilities-row" id="buy-abilities-row"></div>
            </section>
          </div>

          <aside class="buy-detail-panel buy-col-details" id="buy-detail-panel" aria-label="Gegenstands-Details">
            <div class="buy-detail-head">
              <span class="buy-detail-heading-tag">DETAILS</span>
              <span class="buy-detail-cat" id="buy-detail-cat">STURMGEWEHR</span>
            </div>
            <h3 class="buy-detail-title" id="buy-detail-title">LANZE</h3>
            <div class="buy-detail-price" id="buy-detail-price">◆ 2.900</div>
            <div class="buy-detail-svg-preview" id="buy-detail-svg"></div>
            <div class="buy-detail-body" id="buy-detail-body"></div>
          </aside>
        </div>
      </div>
    `;

    container.appendChild(this.root);

    this.playerNameEl = this.root.querySelector('#buy-player-name') as HTMLElement;
    this.specialistBadgeEl = this.root.querySelector('#buy-specialist-tag') as HTMLElement;
    this.teamBadgeEl = this.root.querySelector('#buy-team-tag') as HTMLElement;
    this.kernCarrierBadgeEl = this.root.querySelector('#buy-kern-pill') as HTMLElement;
    this.loadoutShieldSvgEl = this.root.querySelector('#buy-eq-shield-svg') as HTMLElement;
    this.loadoutShieldValEl = this.root.querySelector('#buy-eq-shield') as HTMLElement;
    this.loadoutSecSvgEl = this.root.querySelector('#buy-eq-sec-svg') as HTMLElement;
    this.loadoutSecValEl = this.root.querySelector('#buy-eq-sec') as HTMLElement;
    this.loadoutPriSvgEl = this.root.querySelector('#buy-eq-pri-svg') as HTMLElement;
    this.loadoutPriValEl = this.root.querySelector('#buy-eq-pri') as HTMLElement;
    this.phasePillEl = this.root.querySelector('#buy-phase-pill') as HTMLElement;
    this.toastEl = this.root.querySelector('#buy-toast') as HTMLElement;
    this.creditsValEl = this.root.querySelector('#buy-credits-val') as HTMLElement;
    this.nextMinValEl = this.root.querySelector('#buy-credits-next') as HTMLElement;
    this.calloutBuyBtn = this.root.querySelector('#btn-callout-buy') as HTMLButtonElement;
    this.calloutSaveBtn = this.root.querySelector('#btn-callout-save') as HTMLButtonElement;
    this.abilitiesRowEl = this.root.querySelector('#buy-abilities-row') as HTMLElement;

    this.detailCategoryEl = this.root.querySelector('#buy-detail-cat') as HTMLElement;
    this.detailTitleEl = this.root.querySelector('#buy-detail-title') as HTMLElement;
    this.detailPriceEl = this.root.querySelector('#buy-detail-price') as HTMLElement;
    this.detailPreviewEl = this.root.querySelector('#buy-detail-svg') as HTMLElement;
    this.detailBodyEl = this.root.querySelector('#buy-detail-body') as HTMLElement;

    this.buildWeaponAndArmorCards();
    this.bindGlobalKeys();
    this.renderInspectDetails();
  }

  private buildWeaponAndArmorCards(): void {
    const colSecondary = this.root.querySelector('[data-col="secondary"]') as HTMLElement;
    const colSmg = this.root.querySelector('[data-col="smg"]') as HTMLElement;
    const colShotgun = this.root.querySelector('[data-col="shotgun"]') as HTMLElement;
    const colAssault = this.root.querySelector('[data-col="assault"]') as HTMLElement;
    const colSniper = this.root.querySelector('[data-col="sniper"]') as HTMLElement;
    const colArmor = this.root.querySelector('[data-col="armor"]') as HTMLElement;
    const finishes = getSelectedFinishes();

    const addWeaponCard = (parent: HTMLElement, wId: WeaponId): void => {
      const w = WEAPONS[wId];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `buy-weapon-${wId}`;
      btn.className = 'buy-item-card is-weapon-card';
      btn.dataset.weapon = wId;

      const priceText = w.price === 0 ? 'GRATIS' : `◆ ${formatSplitter(w.price)}`;

      btn.innerHTML = `
        <div class="buy-card-top">
          <span class="buy-card-badge" data-badge></span>
        </div>
        <div class="buy-card-svg-wrap buy-card-silhouette" data-sil="${wId}">
          ${getWeaponSvg(wId, finishes[wId])}
        </div>
        <div class="buy-card-footer">
          <span class="buy-card-price">${priceText}</span>
          <span class="buy-card-name">${w.name}</span>
        </div>
      `;

      const setInspect = (): void => {
        this.inspectTarget = { kind: 'weapon', id: wId };
        this.renderInspectDetails();
      };
      btn.addEventListener('mouseenter', setInspect);
      btn.addEventListener('focus', setInspect);
      btn.addEventListener('click', () => {
        setInspect();
        this.callbacks.onBuyRequest('weapon', wId);
      });

      parent.appendChild(btn);
      this.weaponBtns.set(wId, btn);
    };

    addWeaponCard(colSecondary, 'funke');
    addWeaponCard(colSecondary, 'bolzer');
    addWeaponCard(colSmg, 'hornisse');
    addWeaponCard(colShotgun, 'brecher');
    addWeaponCard(colAssault, 'lanze');
    addWeaponCard(colSniper, 'falke');

    const armorIds: Array<Exclude<ArmorTierId, 'none'>> = ['light', 'heavy'];
    for (const aId of armorIds) {
      const tier = ARMOR_TIERS[aId];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `buy-armor-${aId}`;
      btn.className = 'buy-item-card is-armor-card';
      btn.dataset.armor = aId;

      btn.innerHTML = `
        <div class="buy-card-top">
          <span class="buy-card-badge" data-badge></span>
        </div>
        <div class="buy-card-svg-wrap buy-card-shield-glyph" data-tier="${aId}">
          ${getArmorSvg(aId)}
        </div>
        <div class="buy-card-footer">
          <span class="buy-card-price">◆ ${formatSplitter(tier.price)}</span>
          <span class="buy-card-name">${tier.name}</span>
        </div>
      `;

      const setInspect = (): void => {
        this.inspectTarget = { kind: 'armor', id: aId };
        this.renderInspectDetails();
      };
      btn.addEventListener('mouseenter', setInspect);
      btn.addEventListener('focus', setInspect);
      btn.addEventListener('click', () => {
        setInspect();
        this.callbacks.onBuyRequest('armor', aId);
      });

      colArmor.appendChild(btn);
      this.armorBtns.set(aId, btn);
    }
  }

  private refreshWeaponCardFinishes(): void {
    const finishes = getSelectedFinishes();
    for (const [wId, btn] of this.weaponBtns.entries()) {
      const wrap = btn.querySelector('.buy-card-svg-wrap');
      if (wrap) {
        wrap.innerHTML = getWeaponSvg(wId, finishes[wId]);
      }
    }
  }

  private bindGlobalKeys(): void {
    const closeBtn = this.root.querySelector('#btn-close-buymenu') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => {
      this.close();
      this.callbacks.onClose();
    });

    const triggerCallout = (intent: 'buy' | 'save'): void => {
      this.activeCallout = this.activeCallout === intent ? null : intent;
      this.calloutBuyBtn.setAttribute(
        'aria-pressed',
        this.activeCallout === 'buy' ? 'true' : 'false',
      );
      this.calloutSaveBtn.setAttribute(
        'aria-pressed',
        this.activeCallout === 'save' ? 'true' : 'false',
      );
      if (this.activeCallout) {
        const msg =
          intent === 'buy'
            ? 'Team-Kurzruf: KAUFEN WIR diese Runde!'
            : 'Team-Kurzruf: SPAREN WIR für die nächste Runde!';
        this.showPurchaseFeedback(true, msg);
        this.callbacks.onTeamCallout?.(intent, msg);
      }
    };

    this.calloutBuyBtn.addEventListener('click', () => triggerCallout('buy'));
    this.calloutSaveBtn.addEventListener('click', () => triggerCallout('save'));

    this.root.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.root) {
        this.close();
        this.callbacks.onClose();
      }
    });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.openState) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        this.callbacks.onClose();
      }
    });
  }

  public isOpen(): boolean {
    return this.openState;
  }

  public open(): void {
    this.openState = true;
    this.lastEquipSignature = '';
    this.refreshWeaponCardFinishes();
    this.root.hidden = false;
    this.renderInspectDetails();
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.hidden = true;
  }

  public toggle(): boolean {
    if (this.openState) {
      this.close();
      this.callbacks.onClose();
      return false;
    }
    this.open();
    return true;
  }

  public showPurchaseFeedback(ok: boolean, text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.dataset.tone = ok ? 'ok' : 'err';
    this.statusToastTimer = 2.4;
  }

  public update(state: BuyMenuState, frameDt: number): void {
    this.latestState = state;

    if (this.statusToastTimer > 0) {
      this.statusToastTimer = Math.max(0, this.statusToastTimer - frameDt);
      if (this.statusToastTimer <= 0) {
        this.toastEl.textContent = '';
        delete this.toastEl.dataset.tone;
      }
    }

    if (!this.openState) return;

    const teamDef = TEAM_DEFS[state.team];
    const charDef = CHARACTERS[state.character] ?? CHARACTERS.ryo;
    this.teamBadgeEl.textContent = teamDef.name.toUpperCase();
    this.teamBadgeEl.dataset.team = state.team;
    this.playerNameEl.textContent = state.playerName;
    this.kernCarrierBadgeEl.hidden = !state.hasKern;

    const shieldTier: 'none' | 'light' | 'heavy' =
      state.armor > 0 ? (state.armorMax >= 50 ? 'heavy' : 'light') : 'none';
    const finishes = getSelectedFinishes();
    const equipSig = `${state.character}|${shieldTier}|${Math.round(state.armor)}|${state.armorMax}|${state.secondaryWeapon}:${finishes[state.secondaryWeapon]}|${state.primaryWeapon ?? 'none'}:${state.primaryWeapon ? finishes[state.primaryWeapon] : ''}`;

    if (this.lastEquipSignature !== equipSig) {
      this.lastEquipSignature = equipSig;
      this.specialistBadgeEl.innerHTML = `<span class="buy-role-icon">${getRoleSvg(charDef.role)}</span><span>${charDef.name.toUpperCase()} · ${charDef.role.toUpperCase()}</span>`;
      this.loadoutShieldSvgEl.innerHTML = getArmorSvg(shieldTier);
      this.loadoutSecSvgEl.innerHTML = getWeaponSvg(
        state.secondaryWeapon,
        finishes[state.secondaryWeapon],
      );
      this.loadoutPriSvgEl.innerHTML = state.primaryWeapon
        ? getWeaponSvg(state.primaryWeapon, finishes[state.primaryWeapon])
        : `<span class="eq-empty-dash">—</span>`;
    }

    if (state.armor > 0) {
      const shieldTitle = state.armorMax >= 50 ? 'Schwer' : 'Leicht';
      this.loadoutShieldValEl.textContent = `${shieldTitle} (${Math.round(state.armor)}/${state.armorMax})`;
    } else {
      this.loadoutShieldValEl.textContent = 'Kein Schild (0)';
    }
    this.loadoutSecValEl.textContent = WEAPONS[state.secondaryWeapon]?.name ?? 'Funke';
    this.loadoutPriValEl.textContent = state.primaryWeapon
      ? WEAPONS[state.primaryWeapon].name
      : 'Keine Primärwaffe';

    // Buy phase banner
    if (state.canBuyNow) {
      const rem = Math.max(0, Math.ceil(state.phaseRemainingSec));
      this.phasePillEl.dataset.state = 'open';
      this.phasePillEl.textContent = `KAUFPHASE AKTIV · ${rem}s`;
    } else {
      this.phasePillEl.dataset.state = 'locked';
      this.phasePillEl.textContent =
        state.cannotBuyReason || 'NUR IN KAUFPHASE IM SPAWN KAUFBAR';
    }

    // Economy numbers
    this.creditsValEl.textContent = `◆ ${formatSplitter(state.credits)}`;
    const nextMin = Math.min(MAX_CREDITS, state.credits + LOSS_STREAK_CREDITS[0]);
    this.nextMinValEl.textContent = `MIN. NÄCHSTE RUNDE: ◆ ${formatSplitter(nextMin)}`;

    // Update Weapon Cards
    for (const [wId, btn] of this.weaponBtns.entries()) {
      const w = WEAPONS[wId];
      const isOwned = state.primaryWeapon === wId || state.secondaryWeapon === wId;
      const isActiveEquipped =
        (state.activeSlot === 1 && state.primaryWeapon === wId) ||
        (state.activeSlot === 2 && state.secondaryWeapon === wId);
      const canAfford = state.credits >= w.price;

      btn.classList.toggle('is-owned', isOwned);
      btn.classList.toggle('is-equipped', isActiveEquipped);
      btn.classList.toggle('is-unaffordable', !isOwned && !canAfford);
      btn.dataset.owned = isOwned ? 'true' : 'false';
      btn.disabled = !state.canBuyNow || isOwned || !canAfford;

      const badge = btn.querySelector('[data-badge]') as HTMLElement;
      badge.textContent = isOwned
        ? 'IM BESITZ'
        : !canAfford
          ? 'ZU TEUER'
          : '';
    }

    // Update Armor Cards
    for (const [aId, btn] of this.armorBtns.entries()) {
      const tier = ARMOR_TIERS[aId];
      const isOwned = state.armor >= tier.armor && state.armorMax === tier.armor;
      const canAfford = state.credits >= tier.price;

      btn.classList.toggle('is-owned', isOwned);
      btn.classList.toggle('is-equipped', isOwned);
      btn.classList.toggle('is-unaffordable', !isOwned && !canAfford);
      btn.dataset.owned = isOwned ? 'true' : 'false';
      btn.disabled = !state.canBuyNow || isOwned || !canAfford;

      const badge = btn.querySelector('[data-badge]') as HTMLElement;
      badge.textContent = isOwned ? 'IM BESITZ' : !canAfford ? 'ZU TEUER' : '';
    }

    // Render Specialist Ability Cards if character changed, then sync live charges & affordability
    if (this.currentCharacter !== state.character) {
      this.currentCharacter = state.character;
      this.renderSpecialistAbilities(state.character);
    }
    this.syncSpecialistAbilitiesState(state);

    this.renderInspectDetails();
  }

  private renderSpecialistAbilities(characterId: CharacterId): void {
    const c = CHARACTERS[characterId] ?? CHARACTERS.ryo;
    const heading = this.root.querySelector('#buy-abilities-heading') as HTMLElement;
    heading.textContent = `FÄHIGKEITEN · ${c.name.toUpperCase()}`;

    this.abilitiesRowEl.innerHTML = '';
    this.abilityBtns.clear();

    const slots: Array<{ key: 'q' | 'e' | 'ult'; buyType?: BuyItemType }> = [
      { key: 'q', buyType: 'ability_q' },
      { key: 'e', buyType: 'ability_e' },
      { key: 'ult' },
    ];

    for (const item of slots) {
      const def = c.abilities[item.key];
      const card = document.createElement('button');
      card.type = 'button';
      card.id = `buy-ability-${item.key}`;
      card.className = `buy-ability-card ${item.key === 'ult' ? 'is-ult-readonly' : ''}`;
      card.style.setProperty('--char-accent', c.accentHex);

      card.innerHTML = `
        <div class="buy-ab-top">
          <span class="buy-ab-key">[${def.key}]</span>
          <span class="buy-ab-pips" data-ab-pips></span>
          <span class="buy-ab-status" data-ab-status></span>
        </div>
        <div class="buy-ab-svg-wrap">
          ${getAbilitySvg(characterId, item.key)}
        </div>
        <div class="buy-ab-footer">
          <span class="buy-ab-cost" data-ab-cost></span>
          <span class="buy-ab-name">${def.name}</span>
        </div>
      `;

      const setInspect = (): void => {
        this.inspectTarget = { kind: 'ability', key: item.key };
        this.renderInspectDetails();
      };
      card.addEventListener('mouseenter', setInspect);
      card.addEventListener('focus', setInspect);
      card.addEventListener('click', () => {
        setInspect();
        if (item.buyType && !def.freePerRound) {
          this.callbacks.onBuyRequest(item.buyType, item.key);
        }
      });

      this.abilitiesRowEl.appendChild(card);
      this.abilityBtns.set(item.key, card);
    }
  }

  private syncSpecialistAbilitiesState(state: BuyMenuState): void {
    const c = CHARACTERS[state.character] ?? CHARACTERS.ryo;

    const formatPips = (filled: number, total: number): string => {
      const safeTotal = Math.max(1, Math.min(8, total));
      const safeFilled = Math.max(0, Math.min(safeTotal, filled));
      const dots: string[] = [];
      for (let i = 0; i < safeTotal; i += 1) {
        dots.push(i < safeFilled ? '◆' : '◇');
      }
      return `${dots.join(' ')} (${safeFilled}/${safeTotal})`;
    };

    const qDef = c.abilities.q;
    const qMax = state.qMax ?? qDef.maxCharges ?? 1;
    const qCharges = state.qCharges ?? 0;
    const qCost = qDef.costSplitter ?? 0;
    const qCard = this.abilityBtns.get('q');
    if (qCard) {
      const isFull = qCharges >= qMax;
      const canAfford = state.credits >= qCost;
      (qCard.querySelector('[data-ab-cost]') as HTMLElement).textContent = qDef.freePerRound
        ? 'SIGNATUR'
        : isFull
          ? 'VOLL'
          : `◆ ${formatSplitter(qCost)}`;
      (qCard.querySelector('[data-ab-pips]') as HTMLElement).textContent = formatPips(
        qCharges,
        qMax,
      );
      (qCard.querySelector('[data-ab-status]') as HTMLElement).textContent = isFull
        ? 'VOLL'
        : !canAfford
          ? 'ZU TEUER'
          : state.canBuyNow
            ? 'KAUFBAR'
            : '';
      qCard.classList.toggle('is-owned', isFull);
      qCard.classList.toggle('is-unaffordable', !isFull && !canAfford);
      qCard.disabled = !state.canBuyNow || Boolean(qDef.freePerRound) || isFull || !canAfford;
    }

    const eDef = c.abilities.e;
    const eMax = state.eMax ?? eDef.maxCharges ?? 1;
    const eCharges = state.eCharges ?? (eDef.freePerRound ? 1 : 0);
    const eCost = eDef.costSplitter ?? 0;
    const eCard = this.abilityBtns.get('e');
    if (eCard) {
      const isFull = eCharges >= eMax;
      const canAfford = eDef.freePerRound || state.credits >= eCost;
      (eCard.querySelector('[data-ab-cost]') as HTMLElement).textContent = eDef.freePerRound
        ? 'SIGNATUR'
        : isFull
          ? 'VOLL'
          : `◆ ${formatSplitter(eCost)}`;
      (eCard.querySelector('[data-ab-pips]') as HTMLElement).textContent = formatPips(
        eCharges,
        eMax,
      );
      (eCard.querySelector('[data-ab-status]') as HTMLElement).textContent = eDef.freePerRound
        ? 'SIGNATUR'
        : isFull
          ? 'VOLL'
          : !canAfford
            ? 'ZU TEUER'
            : state.canBuyNow
              ? 'KAUFBAR'
              : '';
      eCard.classList.toggle('is-owned', isFull);
      eCard.classList.toggle('is-unaffordable', !isFull && !canAfford);
      eCard.disabled = !state.canBuyNow || Boolean(eDef.freePerRound) || isFull || !canAfford;
    }

    const ultDef = c.abilities.ult;
    const ultMax = state.ultMax ?? ultDef.ultPoints ?? 7;
    const ultPts = Math.min(ultMax, Math.max(0, state.ultPoints));
    const ultCard = this.abilityBtns.get('ult');
    if (ultCard) {
      const ready = ultPts >= ultMax;
      (ultCard.querySelector('[data-ab-cost]') as HTMLElement).textContent = ready
        ? 'BEREIT [X]'
        : `${ultPts} / ${ultMax} ULT-PKT.`;
      (ultCard.querySelector('[data-ab-pips]') as HTMLElement).textContent = formatPips(
        ultPts,
        ultMax,
      );
      (ultCard.querySelector('[data-ab-status]') as HTMLElement).textContent = ready
        ? 'BEREIT [X]'
        : 'ULTIMATE';
      ultCard.classList.toggle('is-owned', ready);
      ultCard.disabled = true;
    }
  }

  private renderInspectDetails(): void {
    const finishes = getSelectedFinishes();

    if (this.inspectTarget.kind === 'weapon') {
      const wId = this.inspectTarget.id;
      const w: WeaponStats = WEAPONS[wId];
      this.detailCategoryEl.textContent = w.category.toUpperCase();
      this.detailTitleEl.textContent = w.name.toUpperCase();
      this.detailPriceEl.textContent =
        w.price === 0 ? 'GRATIS · STANDARD' : `◆ ${formatSplitter(w.price)}`;
      this.detailPreviewEl.innerHTML = getWeaponSvg(wId, finishes[wId]);

      const fireMode = w.automatic ? 'Vollautomatik' : 'Einzelfeuer';
      const zoomLabel = w.scope.zoomLevels.map((z) => `${z}×`).join(' / ');
      const zoomText =
        w.scope.type === 'sniper'
          ? `Präzisionsoptik ${zoomLabel} (Rechtsklick, Mausrad wechselt)`
          : w.scope.type === 'holo'
            ? `Holo-Visier ${zoomLabel} (Rechtsklick)`
            : w.scope.type === 'reflex'
              ? `Leuchtpunkt ${zoomLabel} (Rechtsklick)`
              : 'Kimme & Korn (kein Zoom)';
      const prefix = w.pellets > 1 ? `${w.pellets}× ` : '';

      const headClose = computeDamage(w, 'head', 10);
      const bodyClose = computeDamage(w, 'body', 10);
      const legsClose = Math.round(bodyClose * 0.85);

      const headFar = computeDamage(w, 'head', 35);
      const bodyFar = computeDamage(w, 'body', 35);
      const legsFar = Math.round(bodyFar * 0.85);

      this.detailBodyEl.innerHTML = `
        <div class="detail-stat-grid">
          <div class="detail-stat-row"><span>Feuermodus</span><strong>${fireMode}</strong></div>
          <div class="detail-stat-row"><span>Feuerrate</span><strong>${w.fireRate.toLocaleString('de-DE')} /Sek.</strong></div>
          <div class="detail-stat-row"><span>Laufgeschwindigkeit</span><strong>${RUN_SPEED.toLocaleString('de-DE', { minimumFractionDigits: 2 })} m/s</strong></div>
          <div class="detail-stat-row"><span>Nachladezeit</span><strong>${w.reloadTimeSec.toLocaleString('de-DE', { minimumFractionDigits: 1 })} s</strong></div>
          <div class="detail-stat-row"><span>Magazin</span><strong>${w.magSize} / ${w.reserveAmmo}</strong></div>
          <div class="detail-stat-row"><span>Visierung</span><strong>${zoomText}</strong></div>
        </div>

        <table class="buy-damage-table" aria-label="Distanzschaden">
          <thead>
            <tr>
              <th scope="col">ZONE</th>
              <th scope="col">0–20m</th>
              <th scope="col">20–50m</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Kopf</th>
              <td class="is-head-dmg">${prefix}${headClose}</td>
              <td class="is-head-dmg">${prefix}${headFar}</td>
            </tr>
            <tr>
              <th scope="row">Körper</th>
              <td>${prefix}${bodyClose}</td>
              <td>${prefix}${bodyFar}</td>
            </tr>
            <tr>
              <th scope="row">Beine</th>
              <td>${prefix}${legsClose}</td>
              <td>${prefix}${legsFar}</td>
            </tr>
          </tbody>
        </table>
      `;
      return;
    }

    if (this.inspectTarget.kind === 'armor') {
      const aId = this.inspectTarget.id;
      const tier = ARMOR_TIERS[aId];
      this.detailCategoryEl.textContent = 'VERTEIDIGUNG';
      this.detailTitleEl.textContent = tier.name.toUpperCase();
      this.detailPriceEl.textContent = `◆ ${formatSplitter(tier.price)}`;
      this.detailPreviewEl.innerHTML = getArmorSvg(aId);
      this.detailBodyEl.innerHTML = `
        <div class="detail-stat-grid">
          <div class="detail-stat-row"><span>Schild-Kapazität</span><strong>+${tier.armor} Schild</strong></div>
          <div class="detail-stat-row"><span>Effektive Gesamt-TP</span><strong>${100 + tier.armor} TP</strong></div>
          <div class="detail-stat-row"><span>Übernahme</span><strong>Bleibt bei Überleben erhalten</strong></div>
        </div>
      `;
      return;
    }

    const charId = this.latestState?.character ?? 'ryo';
    const c = CHARACTERS[charId] ?? CHARACTERS.ryo;
    const ab = c.abilities[this.inspectTarget.key];
    this.detailCategoryEl.textContent = `${c.name.toUpperCase()} · [${ab.key}]`;
    this.detailTitleEl.textContent = ab.name.toUpperCase();
    this.detailPriceEl.textContent =
      this.inspectTarget.key === 'ult'
        ? `${ab.ultPoints ?? 7} ULT-PUNKTE`
        : ab.freePerRound
          ? 'SIGNATUR · GRATIS'
          : `◆ ${formatSplitter(ab.costSplitter ?? 0)}`;
    this.detailPreviewEl.innerHTML = getAbilitySvg(charId, this.inspectTarget.key);
    this.detailBodyEl.innerHTML = `
      <p class="detail-ability-text">${ab.summary}</p>
      <div class="detail-stat-grid">
        <div class="detail-stat-row"><span>Spezialist</span><strong>${c.name} (${c.role})</strong></div>
        <div class="detail-stat-row"><span>Max. Ladungen</span><strong>${ab.maxCharges ?? 1}</strong></div>
      </div>
    `;
  }

  public dispose(): void {
    this.root.remove();
  }
}
