import { describe, expect, it } from 'vitest';
import { JUMP_SPEED, GRAVITY } from '../src/core/Config';
import { MAP_LIST, TACTICAL_MAPS } from '../src/data/maps';
import { buildMapDetail } from '../src/data/maps/detail';

const MAX_JUMP_M = (JUMP_SPEED * JUMP_SPEED) / (2 * Math.abs(GRAVITY));

describe('Karten-Details & Set-Pieces', () => {
  it('erzeugt für jede Karte deterministische, kollisionsfreie Deko', () => {
    for (const map of MAP_LIST) {
      const a = buildMapDetail(map);
      const b = buildMapDetail(map);
      expect(a.blocks.length).toBeGreaterThan(80);
      expect(a.animated.length).toBeGreaterThan(0);
      expect(a.blocks.map((x) => x.pos)).toEqual(b.blocks.map((x) => x.pos));

      const all = [...a.blocks, ...a.animated.flatMap((p) => p.blocks)];
      for (const blk of all) {
        expect(blk.collider).toBe(false);
        for (const v of [blk.pos, blk.size]) {
          expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
        }
        expect(blk.size.x).toBeGreaterThan(0);
        expect(blk.size.y).toBeGreaterThan(0);
        expect(blk.size.z).toBeGreaterThan(0);
      }
    }
  });

  it('Kistentreppen sind Sprung für Sprung erreichbar und Set-Pieces lassen Zonen frei', () => {
    for (const map of TACTICAL_MAPS) {
      const pieces = map.blocks.filter((b) => b.id.includes('_sp_'));
      expect(pieces.length).toBe(14);

      for (const tag of ['site_a', 'site_b']) {
        const low = pieces.find((b) => b.id.endsWith(`${tag}_stair_low`))!;
        const high = pieces.find((b) => b.id.endsWith(`${tag}_stair_high`))!;
        const lowTop = low.pos.y + low.size.y / 2;
        const highTop = high.pos.y + high.size.y / 2;
        expect(lowTop).toBeLessThan(MAX_JUMP_M);
        expect(highTop - lowTop).toBeLessThan(MAX_JUMP_M);
        // letzte Stufe -> Plattform (Plattformhöhe = 1,5 × obere Stufe)
        expect(highTop * 1.5 - highTop).toBeLessThan(MAX_JUMP_M);
      }

      // Kein Set-Piece ragt in eine Zone (Spawn / Kern) hinein oder blockiert die Mittelachse
      for (const p of pieces) {
        expect(Math.abs(p.pos.x) - p.size.x / 2).toBeGreaterThan(3);
        for (const zn of map.zones) {
          const overlapX = Math.abs(p.pos.x - zn.center.x) < p.size.x / 2 + zn.size.x / 2 - 0.01;
          const overlapZ = Math.abs(p.pos.z - zn.center.z) < p.size.z / 2 + zn.size.z / 2 - 0.01;
          expect(overlapX && overlapZ).toBe(false);
        }
      }

      // Set-Pieces durchdringen keine vorhandenen Kollisions-Blöcke (achsparallel geprüft)
      const others = map.blocks.filter(
        (b) => !b.id.includes('_sp_') && b.collider !== false && !b.rotX && !b.rotY && !b.id.includes('floor'),
      );
      for (const p of pieces) {
        for (const o of others) {
          const hit =
            Math.abs(p.pos.x - o.pos.x) < (p.size.x + o.size.x) / 2 - 0.02 &&
            Math.abs(p.pos.y - o.pos.y) < (p.size.y + o.size.y) / 2 - 0.02 &&
            Math.abs(p.pos.z - o.pos.z) < (p.size.z + o.size.z) / 2 - 0.02;
          expect(hit, `${p.id} ∩ ${o.id}`).toBe(false);
        }
      }
    }
  });
});
