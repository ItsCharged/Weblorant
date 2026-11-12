import { describe, expect, it } from 'vitest';
import {
  clampMobileControlPosition,
  cloneDefaultMobileLayout,
  DEFAULT_MOBILE_LAYOUT,
  DEFAULT_SETTINGS,
  mergeMobileLayout,
  MOBILE_CONTROL_IDS,
} from '../src/core/Config';

describe('Mobile Touch Controls & Layout Configuration', () => {
  it('defines default positions for every mobile control within valid screen bounds', () => {
    expect(DEFAULT_SETTINGS.mobileControls).toBe('auto');
    expect(MOBILE_CONTROL_IDS.length).toBeGreaterThanOrEqual(15);

    for (const id of MOBILE_CONTROL_IDS) {
      const pos = DEFAULT_MOBILE_LAYOUT[id];
      expect(pos).toBeDefined();
      expect(pos.xPct).toBeGreaterThanOrEqual(4);
      expect(pos.xPct).toBeLessThanOrEqual(96);
      expect(pos.yPct).toBeGreaterThanOrEqual(6);
      expect(pos.yPct).toBeLessThanOrEqual(94);
      expect(pos.scale).toBeGreaterThanOrEqual(0.6);
      expect(pos.scale).toBeLessThanOrEqual(1.6);
      expect(pos.opacity).toBeGreaterThanOrEqual(0.25);
      expect(pos.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range coordinates, scale, and opacity safely', () => {
    const clamped = clampMobileControlPosition({
      xPct: -50,
      yPct: 180,
      scale: 4.5,
      opacity: 0.01,
    });
    expect(clamped.xPct).toBe(4);
    expect(clamped.yPct).toBe(94);
    expect(clamped.scale).toBe(1.6);
    expect(clamped.opacity).toBe(0.25);
  });

  it('merges partial saved mobile layouts without losing missing controls', () => {
    const merged = mergeMobileLayout({
      fire: { xPct: 82, yPct: 68, scale: 1.35, opacity: 0.9 },
      joystick: { xPct: 15, yPct: 70 },
    });

    expect(merged.fire).toEqual({ xPct: 82, yPct: 68, scale: 1.35, opacity: 0.9 });
    expect(merged.joystick.xPct).toBe(15);
    expect(merged.joystick.yPct).toBe(70);
    expect(merged.joystick.scale).toBe(DEFAULT_MOBILE_LAYOUT.joystick.scale);
    expect(merged.jump).toEqual(DEFAULT_MOBILE_LAYOUT.jump);
  });

  it('clones default mobile layout without mutating the source constant', () => {
    const copy = cloneDefaultMobileLayout();
    copy.fire.xPct = 50;
    expect(DEFAULT_MOBILE_LAYOUT.fire.xPct).not.toBe(50);
  });
});
