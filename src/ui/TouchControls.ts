import './mobile.css';
import {
  clampMobileControlPosition,
  cloneDefaultMobileLayout,
  isTouchDevice,
  loadMobileLayout,
  MOBILE_CONTROL_IDS,
  saveMobileLayout,
} from '../core/Config';
import type { InputManager } from '../core/InputManager';
import type {
  MobileControlId,
  MobileControlsMode,
  MobileLayoutConfig,
} from '../core/types';

export interface TouchControlsCallbacks {
  onPauseMenu: () => void;
  onEditorOpen?: () => void;
  onEditorClose?: () => void;
}

interface ControlDescriptor {
  id: MobileControlId;
  label: string;
  editorName: string;
  className: string;
  kind: 'joystick' | 'hold' | 'tap';
  holdAction?: 'fire' | 'ads' | 'jump' | 'crouch' | 'reload' | 'kernInteract';
  tapAction?: 'abilityQ' | 'abilityE' | 'abilityUlt' | 'slot1' | 'slot2' | 'slot3' | 'buyMenu';
}

const CONTROL_DESCRIPTORS: readonly ControlDescriptor[] = [
  {
    id: 'joystick',
    label: '',
    editorName: 'BEWEGUNGS-STICK',
    className: 'touch-joystick-base',
    kind: 'joystick',
  },
  {
    id: 'fire',
    label: 'FEUER',
    editorName: 'FEUER',
    className: 'touch-btn is-fire',
    kind: 'hold',
    holdAction: 'fire',
  },
  {
    id: 'ads',
    label: 'ADS',
    editorName: 'VISIER (ADS)',
    className: 'touch-btn is-round is-ads',
    kind: 'hold',
    holdAction: 'ads',
  },
  {
    id: 'jump',
    label: 'SPRINGEN',
    editorName: 'SPRINGEN',
    className: 'touch-btn is-round',
    kind: 'hold',
    holdAction: 'jump',
  },
  {
    id: 'crouch',
    label: 'DUCKEN',
    editorName: 'DUCKEN',
    className: 'touch-btn is-round',
    kind: 'hold',
    holdAction: 'crouch',
  },
  {
    id: 'reload',
    label: 'NACHLADEN',
    editorName: 'NACHLADEN',
    className: 'touch-btn',
    kind: 'hold',
    holdAction: 'reload',
  },
  {
    id: 'abilityQ',
    label: 'Q',
    editorName: 'FÄHIGKEIT Q',
    className: 'touch-btn is-ability',
    kind: 'tap',
    tapAction: 'abilityQ',
  },
  {
    id: 'abilityE',
    label: 'E',
    editorName: 'FÄHIGKEIT E',
    className: 'touch-btn is-ability',
    kind: 'tap',
    tapAction: 'abilityE',
  },
  {
    id: 'abilityUlt',
    label: 'X',
    editorName: 'ULTIMATE X',
    className: 'touch-btn is-ability is-ult',
    kind: 'tap',
    tapAction: 'abilityUlt',
  },
  {
    id: 'slot1',
    label: '1',
    editorName: 'SLOT 1 (PRIMÄR)',
    className: 'touch-btn is-slot',
    kind: 'tap',
    tapAction: 'slot1',
  },
  {
    id: 'slot2',
    label: '2',
    editorName: 'SLOT 2 (PISTOLE)',
    className: 'touch-btn is-slot',
    kind: 'tap',
    tapAction: 'slot2',
  },
  {
    id: 'slot3',
    label: '3',
    editorName: 'SLOT 3 (KLINGE)',
    className: 'touch-btn is-slot',
    kind: 'tap',
    tapAction: 'slot3',
  },
  {
    id: 'kern',
    label: 'KERN',
    editorName: 'KERN INTERAKTION',
    className: 'touch-btn is-kern',
    kind: 'hold',
    holdAction: 'kernInteract',
  },
  {
    id: 'shop',
    label: 'SHOP',
    editorName: 'KAUFMENÜ',
    className: 'touch-btn is-utility',
    kind: 'tap',
    tapAction: 'buyMenu',
  },
  {
    id: 'pause',
    label: 'MENÜ',
    editorName: 'EINSATZ-MENÜ',
    className: 'touch-btn is-utility',
    kind: 'tap',
  },
];

export class TouchControls {
  private readonly input: InputManager;
  private readonly callbacks: TouchControlsCallbacks;

  private readonly root: HTMLElement;
  private readonly lookZoneEl: HTMLElement;
  private readonly controlEls = new Map<MobileControlId, HTMLElement>();
  private readonly joystickBaseEl: HTMLElement;
  private readonly joystickKnobEl: HTMLElement;

  // Layout Editor Toolbar
  private readonly editorToolbarEl: HTMLElement;
  private readonly editorSelectedLabelEl: HTMLElement;
  private readonly scaleSliderEl: HTMLInputElement;
  private readonly scaleReadoutEl: HTMLElement;
  private readonly opacitySliderEl: HTMLInputElement;
  private readonly opacityReadoutEl: HTMLElement;

  private mode: MobileControlsMode;
  private layout: MobileLayoutConfig;
  private gameplayActive = false;
  private overlayBlocking = false;
  private editorOpen = false;
  private selectedControlId: MobileControlId = 'fire';

  // Multi-touch active pointer tracking
  private lookPointerId: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;

  private joystickPointerId: number | null = null;
  private readonly activeButtonPointers = new Map<number, ControlDescriptor>();

  // Editor drag state
  private dragPointerId: number | null = null;
  private dragControlId: MobileControlId | null = null;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private dragStartXPct = 50;
  private dragStartYPct = 50;

  constructor(
    container: HTMLElement,
    input: InputManager,
    initialMode: MobileControlsMode,
    callbacks: TouchControlsCallbacks
  ) {
    this.input = input;
    this.callbacks = callbacks;
    this.mode = initialMode;
    this.layout = loadMobileLayout();

    this.root = document.createElement('div');
    this.root.className = 'touch-controls-root';
    this.root.hidden = true;

    this.lookZoneEl = document.createElement('div');
    this.lookZoneEl.className = 'touch-look-zone';
    this.root.appendChild(this.lookZoneEl);

    // Build Joystick & Action Buttons
    let jBase: HTMLElement | null = null;
    let jKnob: HTMLElement | null = null;

    for (const desc of CONTROL_DESCRIPTORS) {
      if (desc.kind === 'joystick') {
        const base = document.createElement('div');
        base.className = `touch-ctrl ${desc.className}`;
        base.dataset.controlId = desc.id;
        base.innerHTML = '<div class="touch-joystick-cross"></div><div class="touch-joystick-knob"></div>';
        this.root.appendChild(base);
        this.controlEls.set(desc.id, base);
        jBase = base;
        jKnob = base.querySelector('.touch-joystick-knob') as HTMLElement;
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `touch-ctrl ${desc.className}`;
        btn.dataset.controlId = desc.id;
        btn.textContent = desc.label;
        this.root.appendChild(btn);
        this.controlEls.set(desc.id, btn);
      }
    }

    this.joystickBaseEl = jBase!;
    this.joystickKnobEl = jKnob!;

    // Build Interactive Layout Editor Toolbar
    this.editorToolbarEl = document.createElement('div');
    this.editorToolbarEl.className = 'mobile-editor-toolbar';
    this.editorToolbarEl.hidden = true;
    this.editorToolbarEl.innerHTML = `
      <span class="mobile-editor-title" id="mobile-editor-selected">AUSGEWÄHLT: FEUER</span>
      <label class="mobile-editor-slider-group">
        <span>Größe</span>
        <input type="range" id="mobile-editor-scale" min="0.60" max="1.60" step="0.05" value="1.00" />
        <span class="mobile-editor-readout" id="mobile-editor-scale-val">1.00×</span>
      </label>
      <label class="mobile-editor-slider-group">
        <span>Deckkraft</span>
        <input type="range" id="mobile-editor-opacity" min="0.25" max="1.00" step="0.05" value="0.80" />
        <span class="mobile-editor-readout" id="mobile-editor-opacity-val">80%</span>
      </label>
      <div class="mobile-editor-actions">
        <button type="button" class="mobile-editor-btn is-danger" id="mobile-editor-reset">ZURÜCKSETZEN</button>
        <button type="button" class="mobile-editor-btn is-primary" id="mobile-editor-save">SPEICHERN &amp; SCHLIESSEN</button>
      </div>
    `;
    this.root.appendChild(this.editorToolbarEl);

    this.editorSelectedLabelEl = this.editorToolbarEl.querySelector(
      '#mobile-editor-selected'
    ) as HTMLElement;
    this.scaleSliderEl = this.editorToolbarEl.querySelector(
      '#mobile-editor-scale'
    ) as HTMLInputElement;
    this.scaleReadoutEl = this.editorToolbarEl.querySelector(
      '#mobile-editor-scale-val'
    ) as HTMLElement;
    this.opacitySliderEl = this.editorToolbarEl.querySelector(
      '#mobile-editor-opacity'
    ) as HTMLInputElement;
    this.opacityReadoutEl = this.editorToolbarEl.querySelector(
      '#mobile-editor-opacity-val'
    ) as HTMLElement;

    container.appendChild(this.root);

    this.bindEvents();
    this.applyAllPositions();
    this.syncInputTouchMode();
    this.updateVisibility();
  }

  public isTouchControlsEnabled(): boolean {
    if (this.mode === 'on') return true;
    if (this.mode === 'off') return false;
    return isTouchDevice();
  }

  public setMode(mode: MobileControlsMode): void {
    this.mode = mode;
    this.syncInputTouchMode();
    this.updateVisibility();
  }

  public getMode(): MobileControlsMode {
    return this.mode;
  }

  public setGameplayState(gameplayActive: boolean, overlayBlocking: boolean): void {
    if (this.gameplayActive === gameplayActive && this.overlayBlocking === overlayBlocking) {
      return;
    }
    this.gameplayActive = gameplayActive;
    this.overlayBlocking = overlayBlocking;
    this.updateVisibility();
  }

  public isEditorOpen(): boolean {
    return this.editorOpen;
  }

  public openLayoutEditor(): void {
    if (this.editorOpen) return;
    this.clearActiveGameplayPointers();
    this.editorOpen = true;
    this.root.classList.add('is-editor-mode');
    this.editorToolbarEl.hidden = false;
    this.selectEditorControl(this.selectedControlId);
    this.updateVisibility();
    this.callbacks.onEditorOpen?.();
  }

  public closeLayoutEditor(save = true): void {
    if (!this.editorOpen) return;
    if (save) {
      saveMobileLayout(this.layout);
    }
    this.dragPointerId = null;
    this.dragControlId = null;
    this.editorOpen = false;
    this.root.classList.remove('is-editor-mode');
    this.editorToolbarEl.hidden = true;
    for (const el of this.controlEls.values()) {
      el.classList.remove('is-selected');
    }
    this.updateVisibility();
    this.callbacks.onEditorClose?.();
  }

  public dispose(): void {
    this.clearActiveGameplayPointers();
    this.root.remove();
  }

  private syncInputTouchMode(): void {
    this.input.setTouchMode(this.isTouchControlsEnabled());
  }

  private updateVisibility(): void {
    const shouldShow =
      this.editorOpen ||
      (this.gameplayActive && !this.overlayBlocking && this.isTouchControlsEnabled());

    this.root.hidden = !shouldShow;
    if (!shouldShow && !this.editorOpen) {
      this.clearActiveGameplayPointers();
    }
  }

  private applyControlPosition(id: MobileControlId): void {
    const el = this.controlEls.get(id);
    if (!el) return;
    const pos = this.layout[id];
    el.style.left = `${pos.xPct.toFixed(2)}%`;
    el.style.top = `${pos.yPct.toFixed(2)}%`;
    el.style.setProperty('--ctrl-scale', pos.scale.toFixed(2));
    el.style.setProperty('--ctrl-opacity', pos.opacity.toFixed(2));
  }

  private applyAllPositions(): void {
    for (const id of MOBILE_CONTROL_IDS) {
      this.applyControlPosition(id);
    }
  }

  private selectEditorControl(id: MobileControlId): void {
    this.selectedControlId = id;
    for (const [ctrlId, el] of this.controlEls.entries()) {
      el.classList.toggle('is-selected', ctrlId === id);
    }
    const desc = CONTROL_DESCRIPTORS.find((d) => d.id === id);
    this.editorSelectedLabelEl.textContent = `AUSGEWÄHLT: ${desc?.editorName ?? id.toUpperCase()}`;

    const pos = this.layout[id];
    this.scaleSliderEl.value = pos.scale.toFixed(2);
    this.scaleReadoutEl.textContent = `${pos.scale.toFixed(2)}×`;
    this.opacitySliderEl.value = pos.opacity.toFixed(2);
    this.opacityReadoutEl.textContent = `${Math.round(pos.opacity * 100)}%`;
  }

  private clearActiveGameplayPointers(): void {
    this.lookPointerId = null;
    this.joystickPointerId = null;
    this.joystickBaseEl.classList.remove('is-active');
    this.joystickKnobEl.style.transform = 'translate3d(0, 0, 0)';
    this.input.setTouchMove(0, 0);

    for (const desc of this.activeButtonPointers.values()) {
      const el = this.controlEls.get(desc.id);
      el?.classList.remove('is-active');
      if (desc.kind === 'hold' && desc.holdAction) {
        this.input.setTouchAction(desc.holdAction, false);
      }
    }
    this.activeButtonPointers.clear();
  }

  private updateJoystickFromPointer(clientX: number, clientY: number): void {
    const rect = this.joystickBaseEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = Math.max(24, rect.width * 0.38);

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    this.joystickKnobEl.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;

    let normX = dx / maxRadius;
    let normZ = -dy / maxRadius;
    const mag = Math.hypot(normX, normZ);
    if (mag < 0.12) {
      normX = 0;
      normZ = 0;
    }
    this.input.setTouchMove(normX, normZ);
  }

  private bindEvents(): void {
    // Prevent native context menu on long-press
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    // Look / Aim Swipe Zone
    this.lookZoneEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.editorOpen || this.lookPointerId !== null) return;
      e.preventDefault();
      this.lookPointerId = e.pointerId;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
      try {
        this.lookZoneEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture is unsupported
      }
    });

    this.lookZoneEl.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.editorOpen || e.pointerId !== this.lookPointerId) return;
      e.preventDefault();
      const dx = e.clientX - this.lastLookX;
      const dy = e.clientY - this.lastLookY;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
      this.input.addTouchLookDelta(dx, dy);
    });

    const releaseLook = (e: PointerEvent): void => {
      if (e.pointerId !== this.lookPointerId) return;
      this.lookPointerId = null;
    };
    this.lookZoneEl.addEventListener('pointerup', releaseLook);
    this.lookZoneEl.addEventListener('pointercancel', releaseLook);

    // Individual Control Events (both Gameplay & Layout Editor Drag)
    for (const desc of CONTROL_DESCRIPTORS) {
      const el = this.controlEls.get(desc.id);
      if (!el) continue;

      el.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (this.editorOpen) {
          this.selectEditorControl(desc.id);
          this.dragPointerId = e.pointerId;
          this.dragControlId = desc.id;
          this.dragStartClientX = e.clientX;
          this.dragStartClientY = e.clientY;
          this.dragStartXPct = this.layout[desc.id].xPct;
          this.dragStartYPct = this.layout[desc.id].yPct;
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            // Ignore
          }
          return;
        }

        // Gameplay mode
        if (desc.kind === 'joystick') {
          if (this.joystickPointerId !== null) return;
          this.joystickPointerId = e.pointerId;
          this.joystickBaseEl.classList.add('is-active');
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            // Ignore
          }
          this.updateJoystickFromPointer(e.clientX, e.clientY);
          return;
        }

        this.activeButtonPointers.set(e.pointerId, desc);
        el.classList.add('is-active');
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Ignore
        }

        if (desc.kind === 'hold' && desc.holdAction) {
          this.input.setTouchAction(desc.holdAction, true);
        } else if (desc.kind === 'tap') {
          if (desc.id === 'pause') {
            this.callbacks.onPauseMenu();
          } else if (desc.tapAction) {
            this.input.triggerTouchKeyAction(desc.tapAction);
          }
        }
      });

      el.addEventListener('pointermove', (e: PointerEvent) => {
        if (this.editorOpen) {
          if (e.pointerId !== this.dragPointerId || this.dragControlId !== desc.id) return;
          e.preventDefault();
          const vw = Math.max(1, window.innerWidth);
          const vh = Math.max(1, window.innerHeight);
          const dxPct = ((e.clientX - this.dragStartClientX) / vw) * 100;
          const dyPct = ((e.clientY - this.dragStartClientY) / vh) * 100;

          this.layout[desc.id] = clampMobileControlPosition({
            ...this.layout[desc.id],
            xPct: this.dragStartXPct + dxPct,
            yPct: this.dragStartYPct + dyPct,
          });
          this.applyControlPosition(desc.id);
          return;
        }

        if (desc.kind === 'joystick' && e.pointerId === this.joystickPointerId) {
          e.preventDefault();
          this.updateJoystickFromPointer(e.clientX, e.clientY);
        }
      });

      const releaseCtrl = (e: PointerEvent): void => {
        if (this.editorOpen) {
          if (e.pointerId === this.dragPointerId && this.dragControlId === desc.id) {
            this.dragPointerId = null;
            this.dragControlId = null;
          }
          return;
        }

        if (desc.kind === 'joystick' && e.pointerId === this.joystickPointerId) {
          this.joystickPointerId = null;
          this.joystickBaseEl.classList.remove('is-active');
          this.joystickKnobEl.style.transform = 'translate3d(0, 0, 0)';
          this.input.setTouchMove(0, 0);
          return;
        }

        const activeDesc = this.activeButtonPointers.get(e.pointerId);
        if (activeDesc && activeDesc.id === desc.id) {
          this.activeButtonPointers.delete(e.pointerId);
          el.classList.remove('is-active');
          if (desc.kind === 'hold' && desc.holdAction) {
            this.input.setTouchAction(desc.holdAction, false);
          }
        }
      };

      el.addEventListener('pointerup', releaseCtrl);
      el.addEventListener('pointercancel', releaseCtrl);
    }

    // Editor Toolbar Sliders & Buttons
    this.scaleSliderEl.addEventListener('input', () => {
      const val = Number(this.scaleSliderEl.value);
      const id = this.selectedControlId;
      this.layout[id] = clampMobileControlPosition({
        ...this.layout[id],
        scale: val,
      });
      this.scaleReadoutEl.textContent = `${this.layout[id].scale.toFixed(2)}×`;
      this.applyControlPosition(id);
    });

    this.opacitySliderEl.addEventListener('input', () => {
      const val = Number(this.opacitySliderEl.value);
      const id = this.selectedControlId;
      this.layout[id] = clampMobileControlPosition({
        ...this.layout[id],
        opacity: val,
      });
      this.opacityReadoutEl.textContent = `${Math.round(this.layout[id].opacity * 100)}%`;
      this.applyControlPosition(id);
    });

    const resetBtn = this.editorToolbarEl.querySelector('#mobile-editor-reset') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => {
      this.layout = cloneDefaultMobileLayout();
      this.applyAllPositions();
      this.selectEditorControl(this.selectedControlId);
    });

    const saveBtn = this.editorToolbarEl.querySelector('#mobile-editor-save') as HTMLButtonElement;
    saveBtn.addEventListener('click', () => {
      this.closeLayoutEditor(true);
    });
  }
}
