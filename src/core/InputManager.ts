import { DEFAULT_SETTINGS, MOUSE_RAD_PER_COUNT, PITCH_LIMIT } from './Config';
import { clamp } from './math';
import type { AbilitySlot, InputSnapshot, LoadoutSlot } from './types';

const KERN_TAP_ABILITY_MAX_MS = 180;

export interface InputManagerOptions {
  sensitivity?: number;
  lockOnCanvasClick?: boolean;
  onDebugToggle?: () => void;
  onShopToggle?: () => void;
  onWeaponSlot?: (slot: number, code: string) => void;
  onPointerLockChange?: (locked: boolean) => void;
  onSpectatorCycle?: (dir: 1 | -1) => void;
  onAbilityKey?: (slot: AbilitySlot) => void;
  onScoreboardToggle?: (held: boolean) => void;
  /** Mausrad (oder Taste Z) bei gehaltenem Rechtsklick: nächste Zoomstufe. */
  onZoomCycle?: (dir: 1 | -1) => void;
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly heldKeys = new Set<string>();

  private sensitivity: number;
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
  private keyEDownAtMs: number | null = null;

  public onDebugToggle?: () => void;
  public onShopToggle?: () => void;
  public onWeaponSlot?: (slot: number, code: string) => void;
  public onPointerLockChange?: (locked: boolean) => void;
  public onSpectatorCycle?: (dir: 1 | -1) => void;
  public onAbilityKey?: (slot: AbilitySlot) => void;
  public onScoreboardToggle?: (held: boolean) => void;
  public onZoomCycle?: (dir: 1 | -1) => void;

  constructor(canvas: HTMLCanvasElement, options: InputManagerOptions = {}) {
    this.canvas = canvas;
    this.sensitivity = options.sensitivity ?? DEFAULT_SETTINGS.sensitivity;
    this.lockOnCanvasClick = options.lockOnCanvasClick ?? true;

    this.onDebugToggle = options.onDebugToggle;
    this.onShopToggle = options.onShopToggle;
    this.onWeaponSlot = options.onWeaponSlot;
    this.onPointerLockChange = options.onPointerLockChange;
    this.onSpectatorCycle = options.onSpectatorCycle;
    this.onAbilityKey = options.onAbilityKey;
    this.onScoreboardToggle = options.onScoreboardToggle;
    this.onZoomCycle = options.onZoomCycle;

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
    if (!available) {
      this.keyEDownAtMs = null;
    }
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

    const moveForward = (this.heldKeys.has('KeyW') ? 1 : 0) - (this.heldKeys.has('KeyS') ? 1 : 0);
    const moveRight = (this.heldKeys.has('KeyD') ? 1 : 0) - (this.heldKeys.has('KeyA') ? 1 : 0);

    const crouch =
      this.heldKeys.has('ControlLeft') ||
      this.heldKeys.has('ControlRight') ||
      this.heldKeys.has('KeyC');

    const walk = this.heldKeys.has('ShiftLeft') || this.heldKeys.has('ShiftRight');

    const jump = this.heldKeys.has('Space') || this.jumpLatched;
    const fire = this.mouseLeftHeld || this.fireLatched;
    const reload = this.heldKeys.has('KeyR') || this.reloadLatched;
    const ads = this.mouseRightHeld;
    const holdKern =
      this.heldKeys.has('Digit4') ||
      (this.kernInteractAvailable && this.heldKeys.has('KeyE'));
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
    this.keyEDownAtMs = null;
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
    if (e.code === 'F3') {
      e.preventDefault();
      if (!e.repeat) {
        this.onDebugToggle?.();
      }
      return;
    }

    const tag = (e.target as HTMLElement | null)?.tagName;
    const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.code === 'KeyB' && !e.repeat && !isFormField) {
      this.onShopToggle?.();
    }

    if (
      !e.repeat &&
      !isFormField &&
      (e.code === 'Digit1' ||
        e.code === 'Digit2' ||
        e.code === 'Digit3' ||
        e.code === 'Digit4' ||
        e.code === 'Digit5' ||
        e.code === 'Digit6')
    ) {
      const slot = Number(e.code.slice(5));
      if (slot >= 1 && slot <= 3 && this.isPointerLocked()) {
        this.equipSlotLatched = slot as LoadoutSlot;
      }
      this.onWeaponSlot?.(slot, e.code);
    }

    if (!this.isPointerLocked()) return;

    if (e.code === 'Tab') {
      e.preventDefault();
      if (!this.scoreboardHeld) {
        this.scoreboardHeld = true;
        this.onScoreboardToggle?.(true);
      }
      return;
    }

    if (!e.repeat && !isFormField) {
      if (e.code === 'KeyQ') {
        this.onAbilityKey?.('q');
      } else if (e.code === 'KeyE') {
        if (this.kernInteractAvailable) {
          this.keyEDownAtMs = performance.now();
        } else {
          this.keyEDownAtMs = null;
          this.onAbilityKey?.('e');
        }
      } else if (e.code === 'KeyX') {
        this.onAbilityKey?.('x');
      } else if (e.code === 'KeyZ' && this.mouseRightHeld) {
        this.onZoomCycle?.(1);
      }
    }

    if (
      e.code === 'Space' ||
      e.code === 'ControlLeft' ||
      e.code === 'ControlRight' ||
      e.code === 'ShiftLeft' ||
      e.code === 'ShiftRight'
    ) {
      e.preventDefault();
    }

    this.heldKeys.add(e.code);
    if (!e.repeat) {
      if (e.code === 'Space') this.jumpLatched = true;
      if (e.code === 'KeyR') this.reloadLatched = true;
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
    if (e.code === 'Tab' && this.scoreboardHeld) {
      this.scoreboardHeld = false;
      this.onScoreboardToggle?.(false);
    }
    if (e.code === 'KeyE' && this.keyEDownAtMs !== null) {
      const elapsedMs = performance.now() - this.keyEDownAtMs;
      this.keyEDownAtMs = null;
      if (elapsedMs < KERN_TAP_ABILITY_MAX_MS && this.isPointerLocked()) {
        this.onAbilityKey?.('e');
      }
    }
  };
}
