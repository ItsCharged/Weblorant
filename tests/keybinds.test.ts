import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  findKeybindConflicts,
  formatKeyCodeLabel,
  KEYBIND_ACTIONS,
  KEYBIND_ACTION_META,
  mergeKeybinds,
  type KeybindMap,
} from '../src/core/Config';

describe('Keybind Configuration & Conflict Resolution', () => {
  it('DEFAULT_KEYBINDS assigns every keybind action with zero conflicts', () => {
    for (const action of KEYBIND_ACTIONS) {
      expect(DEFAULT_KEYBINDS[action]).toBeDefined();
      expect(typeof DEFAULT_KEYBINDS[action]).toBe('string');
      expect(DEFAULT_KEYBINDS[action].trim().length).toBeGreaterThan(0);
    }

    const conflicts = findKeybindConflicts(DEFAULT_KEYBINDS);
    expect(conflicts).toHaveLength(0);
  });

  it('detects duplicate key assignments accurately with findKeybindConflicts', () => {
    const conflictingKeybinds: KeybindMap = {
      ...DEFAULT_KEYBINDS,
      moveForward: 'KeyW',
      jump: 'KeyW', // Conflict on KeyW
      reload: 'Space',
      kernInteract: 'Space', // Conflict on Space
    };

    const conflicts = findKeybindConflicts(conflictingKeybinds);
    expect(conflicts.length).toBe(2);

    const keyWConflict = conflicts.find((c) => c.code === 'KeyW');
    expect(keyWConflict).toBeDefined();
    expect(keyWConflict?.actions).toContain('moveForward');
    expect(keyWConflict?.actions).toContain('jump');

    const spaceConflict = conflicts.find((c) => c.code === 'Space');
    expect(spaceConflict).toBeDefined();
    expect(spaceConflict?.actions).toContain('reload');
    expect(spaceConflict?.actions).toContain('kernInteract');
  });

  it('ignores empty or whitespace-only bindings when checking conflicts', () => {
    const emptyBindings: KeybindMap = {
      ...DEFAULT_KEYBINDS,
      moveForward: '',
      jump: '   ',
    };
    const conflicts = findKeybindConflicts(emptyBindings);
    expect(conflicts).toHaveLength(0);
  });

  it('formats standard alphanumeric, numpad, and special keys into clean German tactical labels', () => {
    expect(formatKeyCodeLabel('KeyW')).toBe('W');
    expect(formatKeyCodeLabel('KeyR')).toBe('R');
    expect(formatKeyCodeLabel('Digit1')).toBe('1');
    expect(formatKeyCodeLabel('Digit4')).toBe('4');
    expect(formatKeyCodeLabel('Numpad5')).toBe('NUM 5');
    expect(formatKeyCodeLabel('Space')).toBe('LEERTASTE');
    expect(formatKeyCodeLabel('ShiftLeft')).toBe('UMSCHALT L');
    expect(formatKeyCodeLabel('ControlLeft')).toBe('STRG L');
    expect(formatKeyCodeLabel('Tab')).toBe('TAB');
    expect(formatKeyCodeLabel('Enter')).toBe('EINGABE');
    expect(formatKeyCodeLabel('Escape')).toBe('ESC');
    expect(formatKeyCodeLabel('ArrowUp')).toBe('PFEIL ↑');

    // Edge cases
    expect(formatKeyCodeLabel('')).toBe('—');
    expect(formatKeyCodeLabel('   ')).toBe('—');
  });

  it('merges partial keybind overrides on top of defaults safely', () => {
    const custom = mergeKeybinds({
      jump: 'KeyM',
      moveForward: 'KeyI',
    });

    expect(custom.jump).toBe('KeyM');
    expect(custom.moveForward).toBe('KeyI');
    expect(custom.reload).toBe(DEFAULT_KEYBINDS.reload);

    // Rejects null / non-string invalid overrides
    const fallback = mergeKeybinds(null);
    expect(fallback).toEqual(DEFAULT_KEYBINDS);
  });

  it('KEYBIND_ACTION_META covers all KEYBIND_ACTIONS with valid descriptions and categories', () => {
    expect(KEYBIND_ACTION_META.length).toBe(KEYBIND_ACTIONS.length);
    const metaActions = new Set(KEYBIND_ACTION_META.map((m) => m.action));
    for (const action of KEYBIND_ACTIONS) {
      expect(metaActions.has(action)).toBe(true);
    }
  });
});
