import { describe, expect, it } from 'vitest';
import { mulberry32, radToDeg } from '../src/core/math';
import { WEAPONS } from '../src/data/weapons';
import {
  applySpreadAndRecoilToAngles,
  computeSpreadRad,
  getRecoilAnglesRad,
  RECOIL_RECOVERY_DELAY_SEC,
  RecoilState,
} from '../src/game/Recoil';

describe('Recoil & Movement Spread (Lanze)', () => {
  const lanze = WEAPONS.lanze;

  it('guarantees exact 0 spread and 0 recoil offset on the 1st standing shot', () => {
    const recoil0 = getRecoilAnglesRad(lanze, 0);
    expect(recoil0.pitchRad).toBe(0);
    expect(recoil0.yawRad).toBe(0);

    const spread0 = computeSpreadRad(lanze, 'stand', 0, 0);
    expect(spread0).toBe(0);

    const rng = mulberry32(12345);
    const shot = applySpreadAndRecoilToAngles(
      0,
      0,
      recoil0.pitchRad,
      recoil0.yawRad,
      spread0,
      rng,
    );
    expect(shot.yaw).toBe(0);
    expect(shot.pitch).toBe(0);
    expect(shot.dir.x).toBe(0);
    expect(shot.dir.y).toBe(0);
    expect(shot.dir.z).toBe(-1);
  });

  it('climbs vertically on shots 1..8 and sways horizontally on shots 9+', () => {
    // Indices 0..7 correspond to shots 1..8: monotonic vertical pitch climb with minimal yaw drift
    let prevPitchDeg = -1;
    for (let i = 0; i < 8; i += 1) {
      const { pitchRad, yawRad } = getRecoilAnglesRad(lanze, i);
      const pitchDeg = radToDeg(pitchRad);
      const yawDeg = radToDeg(yawRad);

      expect(pitchDeg).toBeGreaterThan(prevPitchDeg);
      expect(Math.abs(yawDeg)).toBeLessThanOrEqual(0.2);
      prevPitchDeg = pitchDeg;
    }
    expect(prevPitchDeg).toBeGreaterThanOrEqual(7.0);

    // Indices 8..24 correspond to shots 9..25: horizontal oscillation (both positive right & negative left sway)
    let maxRightYawDeg = 0;
    let minLeftYawDeg = 0;
    for (let i = 8; i < 25; i += 1) {
      const { pitchRad, yawRad } = getRecoilAnglesRad(lanze, i);
      const pitchDeg = radToDeg(pitchRad);
      const yawDeg = radToDeg(yawRad);

      expect(pitchDeg).toBeGreaterThanOrEqual(7.5);
      if (yawDeg > maxRightYawDeg) maxRightYawDeg = yawDeg;
      if (yawDeg < minLeftYawDeg) minLeftYawDeg = yawDeg;
    }

    expect(maxRightYawDeg).toBeGreaterThan(2.5);
    expect(minLeftYawDeg).toBeLessThan(-2.5);
  });

  it('produces bit-identical 25-shot trajectories across two runs with the same seed', () => {
    const runSpray = (seed: number) => {
      const state = new RecoilState(seed, lanze);
      const results = [];
      for (let i = 0; i < 25; i += 1) {
        results.push(state.fireShot(lanze, 'stand', 2.0, 0.25, -0.05));
      }
      return results;
    };

    const runA = runSpray(0xc0ffee42);
    const runB = runSpray(0xc0ffee42);

    expect(runA).toEqual(runB);
    for (let i = 0; i < 25; i += 1) {
      expect(runA[i].yaw).toBe(runB[i].yaw);
      expect(runA[i].pitch).toBe(runB[i].pitch);
      expect(runA[i].dir.x).toBe(runB[i].dir.x);
      expect(runA[i].dir.y).toBe(runB[i].dir.y);
      expect(runA[i].dir.z).toBe(runB[i].dir.z);
    }
  });

  it('holds recoil during 0.12s delay and smoothly recovers back to 0 when firing stops', () => {
    const state = new RecoilState(99, lanze);
    for (let i = 0; i < 10; i += 1) {
      state.fireShot(lanze, 'stand', 0, 0, 0);
    }
    expect(state.shotIndex).toBe(10);
    expect(state.currentPitchRad).toBeGreaterThan(0);

    // Before 0.12s recovery delay: no decay yet
    state.update(RECOIL_RECOVERY_DELAY_SEC * 0.5, false, lanze);
    expect(state.shotIndex).toBe(10);

    // Past 0.12s: decays smoothly toward 0
    state.update(0.2, false, lanze);
    expect(state.shotIndex).toBeLessThan(10);
    expect(state.shotIndex).toBeGreaterThan(0);

    // Full pause recovers completely back to exact 0
    for (let step = 0; step < 60; step += 1) {
      state.update(1 / 30, false, lanze);
    }
    expect(state.shotIndex).toBe(0);
    expect(state.currentPitchRad).toBe(0);
    expect(state.currentYawRad).toBe(0);
  });

  it('enforces movement inaccuracy ordering: crouch <= stand < walk < run < air', () => {
    for (const shotIndex of [0, 4]) {
      const crouchSpread = computeSpreadRad(lanze, 'crouch', 0, shotIndex);
      const standSpread = computeSpreadRad(lanze, 'stand', 0, shotIndex);
      const walkSpread = computeSpreadRad(lanze, 'walk', 3.0, shotIndex);
      const runSpread = computeSpreadRad(lanze, 'stand', 5.6, shotIndex);
      const airSpread = computeSpreadRad(lanze, 'air', 5.6, shotIndex);

      expect(crouchSpread).toBeLessThanOrEqual(standSpread);
      expect(standSpread).toBeLessThan(walkSpread);
      expect(walkSpread).toBeLessThan(runSpread);
      expect(runSpread).toBeLessThan(airSpread);

      if (shotIndex > 0) {
        expect(crouchSpread).toBeLessThan(standSpread);
      }
    }
  });
});
