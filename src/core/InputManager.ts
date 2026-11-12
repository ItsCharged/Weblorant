import { DEFAULT_KEYBINDS, DEFAULT_SETTINGS, MOUSE_RAD_PER_COUNT, PITCH_LIMIT } from './Config';
import { clamp } from './math';
import type { AbilitySlot, InputSnapshot, KeybindMap, LoadoutSlot } from './types';

export interface InputManagerOptions {
  sensitivity?: number;
  keybinds?: KeybindMap;
  lockOnCanvasClick?: boolean;
  onDebugToggle?: () => void;
  onShopToggle?: () => void;
  onWeaponSlot?: (slot: number, code: string) => void;
  onPointerLockChange?: (locked: boolean) => void;
  onSpectatorCycle?: (dir: 1 | -1) => void;
  onAbilityKey?: (slot: AbilitySlot) => void;
  onScoreboardToggle?: (held: boolean) => void;
  /** Mausrad (oder konfigurierte Zoom-Taste) bei gehaltenem Rechtsklick: nächste Zoomstufe. */
  onZoomCycle?: (dir: 1 | -1) => void;
  onAbilityInfoToggle?: () => void;
  onSpecialistSelectToggle?: () => void;
  onMapSwitchOffline?: () => void;
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly heldKeys = new Set<string>();

  private sensitivity: number;
  private keybinds: KeybindMap;
  private readonly lockOnCanvasClick: boolean;

  private yaw = 0;
  private pitch = 0;
  private seq = 0;

  private mouseLeftHeld = false;
  private mouseRightHeld = false;

  private jumpLatched = false;
  private fireLatched = false;
  private reloadLatched = false;
  private equipSlotLatched: LoadoutSlot | undefined = undefined;

  private spectatorMode: boolean | null = null;
  private scoreboardHeld = false;
  private kernInteractAvailable = false;

  public onDebugToggle?: () => void;
  public onShopToggle?: () => void;
  public onWeaponSlot?: (slot: number, code: string) => void;
  public onPointerLockChange?: (locked: boolean) => void;
  public onSpectatorCycle?: (dir: 1 | -1) => void;
  public onAbilityKey?: (slot: AbilitySlot) => void;
  public onScoreboardToggle?: (held: boolean) => void;
  public onZoomCycle?: (dir: 1 | -1) => void;
  public onAbilityInfoToggle?: () => void;
  public onSpecialistSelectToggle?: () => void;
  public onMapSwitchOffline?: () => void;

  constructor(canvas: HTMLCanvasElement, options: InputManagerOptions = {}) {
    this.canvas = canvas;
    this.sensitivity = options.sensitivity ?? DEFAULT_SETTINGS.sensitivity;
    this.keybinds = { ...(options.keybinds ?? DEFAULT_KEYBINDS) };
    this.lockOnCanvasClick = options.lockOnCanvasClick ?? true;

    this.onDebugToggle = options.onDebugToggle;
    this.onShopToggle = options.onShopToggle;
    this.onWeaponSlot = options.onWeaponSlot;
    this.onPointerLockChange = options.onPointerLockChange;
    this.onSpectatorCycle = options.onSpectatorCycle;
    this.onAbilityKey = options.onAbilityKey;
    this.onScoreboardToggle = options.onScoreboardToggle;
    this.onZoomCycle = options.onZoomCycle;
    this.onAbilityInfoToggle = options.onAbilityInfoToggle;
    this.onSpecialistSelectToggle = options.onSpecialistSelectToggle;
    this.onMapSwitchOffline = options.onMapSwitchOffline;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    this.canvas.addEventListener('click', this.handleCanvasClick);
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (this.isPointerLocked()) return;
    try {
      const maybePromise = (
        this.canvas.requestPointerLock as unknown as (options?: {
          unadjustedMovement?: boolean;
        }) => Promise<void> | void
      )({ unadjustedMovement: true });

      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          try {
            const fallback = this.canvas.requestPointerLock() as unknown as Promise<void> | void;
            if (fallback && typeof fallback.catch === 'function') {
              fallback.catch(() => {});
            }
          } catch {
            // Ignore when browser blocks fallback outside active user gesture
          }
        });
      }
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        // Ignore when browser blocks pointer lock outside active user gesture
      }
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.resetHeldInputs();
  }

  setSensitivity(sensitivity: number): void {
    this.sensitivity = Math.max(0.01, sensitivity);
  }

  getSensitivity(): number {
    return this.sensitivity;
  }

  setKeybinds(nextKeybinds: KeybindMap): void {
    this.keybinds = { ...nextKeybinds };
    this.resetHeldInputs();
  }

  getKeybinds(): KeybindMap {
    return { ...this.keybinds };
  }

  setSpectatorMode(active: boolean): void {
    this.spectatorMode = active;
    if (active) {
      this.mouseLeftHeld = false;
      this.mouseRightHeld = false;
      this.fireLatched = false;
    }
  }

  isSpectatorMode(): boolean {
    return this.spectatorMode === true;
  }

  setKernInteractAvailable(available: boolean): void {
    this.kernInteractAvailable = available;
  }

  isKernInteractAvailable(): boolean {
    return this.kernInteractAvailable;
  }

  setAngles(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  getAngles(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  sampleInput(dt: number): InputSnapshot {
    this.seq += 1;

    if (!this.isPointerLocked()) {
      this.jumpLatched = false;
      this.fireLatched = false;
      this.reloadLatched = false;
      this.equipSlotLatched = undefined;
      return {
        seq: this.seq,
        forward: 0,
        right: 0,
        jump: false,
        crouch: false,
        walk: false,
        fire: false,
        ads: false,
        reload: false,
        holdKern: false,
        equipSlot: undefined,
        yaw: this.yaw,
        pitch: this.pitch,
        dt,
      };
    }

    const kb = this.keybinds;
    const moveForward =
      (this.heldKeys.has(kb.moveForward) ? 1 : 0) - (this.heldKeys.has(kb.moveBack) ? 1 : 0);
    const moveRight =
      (this.heldKeys.has(kb.moveRight) ? 1 : 0) - (this.heldKeys.has(kb.moveLeft) ? 1 : 0);

    const crouch = this.heldKeys.has(kb.crouch);
    const walk = this.heldKeys.has(kb.walk);

    const jump = this.heldKeys.has(kb.jump) || this.jumpLatched;
    const fire = this.mouseLeftHeld || this.fireLatched;
    const reload = this.heldKeys.has(kb.reload) || this.reloadLatched;
    const ads = this.mouseRightHeld;
    const holdKern = this.heldKeys.has(kb.kernInteract);
    const equipSlot = this.equipSlotLatched;

    this.jumpLatched = false;
    this.fireLatched = false;
    this.reloadLatched = false;
    this.equipSlotLatched = undefined;

    return {
      seq: this.seq,
      forward: moveForward,
      right: moveRight,
      jump,
      crouch,
      walk,
      fire,
      ads,
      reload,
      holdKern,
      equipSlot,
      yaw: this.yaw,
      pitch: this.pitch,
      dt,
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('click', this.handleCanvasClick);
    this.resetHeldInputs();
  }

  private resetHeldInputs(): void {
    this.heldKeys.clear();
    this.mouseLeftHeld = false;
    this.mouseRightHeld = false;
    this.jumpLatched = false;
    this.fireLatched = false;
    this.reloadLatched = false;
    this.equipSlotLatched = undefined;
    if (this.scoreboardHeld) {
      this.scoreboardHeld = false;
      this.onScoreboardToggle?.(false);
    }
  }

  private readonly handleCanvasClick = (): void => {
    if (this.lockOnCanvasClick && !this.isPointerLocked()) {
      this.requestLock();
    }
  };

  private readonly handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = this.isPointerLocked();
    if (!locked) {
      this.resetHeldInputs();
    }
    this.onPointerLockChange?.(locked);
  };

  private readonly handleBlur = (): void => {
    this.resetHeldInputs();
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.isPointerLocked()) return;
    const scale = this.sensitivity * MOUSE_RAD_PER_COUNT;
    this.yaw -= e.movementX * scale;
    this.pitch = clamp(this.pitch - e.movementY * scale, -PITCH_LIMIT, PITCH_LIMIT);
  };

  private readonly handleMouseDown = (e: MouseEvent): void => {
    if (!this.isPointerLocked()) return;
    if (this.spectatorMode === true) {
      if (e.button === 0) {
        this.onSpectatorCycle?.(1);
      } else if (e.button === 2) {
        this.onSpectatorCycle?.(-1);
      }
      return;
    }

    if (e.button === 0) {
      this.mouseLeftHeld = true;
      this.fireLatched = true;
      if (this.spectatorMode === null) {
        this.onSpectatorCycle?.(1);
      }
    } else if (e.button === 2) {
      this.mouseRightHeld = true;
      if (this.spectatorMode === null) {
        this.onSpectatorCycle?.(-1);
      }
    }
  };

  private readonly handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseLeftHeld = false;
    } else if (e.button === 2) {
      this.mouseRightHeld = false;
    }
  };

  private readonly handleWheel = (e: WheelEvent): void => {
    if (!this.isPointerLocked() || !this.mouseRightHeld || this.spectatorMode === true) return;
    if (Math.abs(e.deltaY) < 1) return;
    this.onZoomCycle?.(e.deltaY < 0 ? 1 : -1);
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.dataset?.keybindCapture === 'true') {
      return;
    }

    const kb = this.keybinds;

    if (e.code === kb.debugOverlay) {
      e.preventDefault();
      if (!e.repeat) {
        this.onDebugToggle?.();
      }
      return;
    }

    const tag = targetEl?.tagName;
    const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (!e.repeat && !isFormField) {
      if (e.code === kb.abilityInfo) {
        e.preventDefault();
        this.onAbilityInfoToggle?.();
        return;
      }
      if (e.code === kb.specialistSelect) {
        e.preventDefault();
        this.onSpecialistSelectToggle?.();
        return;
      }
      if (e.code === kb.mapSwitchOffline) {
        this.onMapSwitchOffline?.();
      }
      if (e.code === kb.buyMenu) {
        this.onShopToggle?.();
      }
    }

    if (!e.repeat && !isFormField) {
      let matchedSlot: LoadoutSlot | null = null;
      if (e.code === kb.slot1) matchedSlot = 1;
      else if (e.code === kb.slot2) matchedSlot = 2;
      else if (e.code === kb.slot3) matchedSlot = 3;

      if (matchedSlot !== null) {
        if (this.isPointerLocked()) {
          this.equipSlotLatched = matchedSlot;
        }
        this.onWeaponSlot?.(matchedSlot, e.code);
      }
    }

    if (!this.isPointerLocked()) return;

    if (e.code === kb.scoreboard) {
      e.preventDefault();
      if (!this.scoreboardHeld) {
        this.scoreboardHeld = true;
        this.onScoreboardToggle?.(true);
      }
      return;
    }

    if (!e.repeat && !isFormField) {
      if (e.code === kb.abilityQ) {
        this.onAbilityKey?.('q');
      } else if (e.code === kb.abilityE) {
        this.onAbilityKey?.('e');
      } else if (e.code === kb.abilityUlt) {
        this.onAbilityKey?.('x');
      } else if (e.code === kb.zoomCycle && this.mouseRightHeld) {
        this.onZoomCycle?.(1);
      }
    }

    if (
      e.code === kb.jump ||
      e.code === kb.crouch ||
      e.code === kb.walk ||
      e.code === 'Space' ||
      e.code === 'Tab'
    ) {
      e.preventDefault();
    }

    this.heldKeys.add(e.code);
    if (!e.repeat) {
      if (e.code === kb.jump) this.jumpLatched = true;
      if (e.code === kb.reload) this.reloadLatched = true;
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
    if (e.code === this.keybinds.scoreboard && this.scoreboardHeld) {
      this.scoreboardHeld = false;
      this.onScoreboardToggle?.(false);
    }
  };
}
