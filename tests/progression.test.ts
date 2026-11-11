import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CHARACTERS, type RoleArchetype } from '../src/data/characters';
import {
  ARSENAL_WEAPON_IDS,
  getCareerSummary,
  getMatchHistory,
  getObjectiveDiamonds,
  getObjectives,
  getObjectivesOverview,
  getSelectedFinishes,
  MAX_MATCH_HISTORY_ENTRIES,
  PROGRESSION_STORAGE_KEY,
  recordMatchHistory,
  recordProgress,
  resetProgressionState,
  setProgressionStorageForTests,
  setWeaponFinish,
  type StorageLike,
  WEAPON_FINISH_IDS,
  WEAPON_FINISHES,
} from '../src/data/progression';
import {
  getAbilitySvg,
  getArmorSvg,
  getCharacterPortraitSvg,
  getKernSvg,
  getRoleSvg,
  getWeaponSvg,
} from '../src/data/uiIcons';

function createMemoryStorage(): { storage: StorageLike; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return { storage, map };
}

describe('Phase 7 Procedural UI Icons (uiIcons.ts)', () => {
  it('generates crisp valid SVG silhouettes for all 6 weapons, tactical knife, and finishes', () => {
    for (const weaponId of ARSENAL_WEAPON_IDS) {
      for (const finishId of WEAPON_FINISH_IDS) {
        const svg = getWeaponSvg(weaponId, finishId);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg).toContain(`data-weapon="${weaponId}"`);
        expect(svg).toContain('<path');
        if (finishId !== 'standard') {
          const def = WEAPON_FINISHES.find((f) => f.id === finishId)!;
          expect(svg).toContain(def.accentHex);
        }
      }
    }
  });

  it('generates distinct hexagonal shield SVGs for none, light (25), and heavy (50)', () => {
    const noneSvg = getArmorSvg('none');
    const lightSvg = getArmorSvg('light');
    const heavySvg = getArmorSvg('heavy');

    expect(noneSvg).toContain('<svg');
    expect(noneSvg).toContain('>0<');
    expect(lightSvg).toContain('data-armor="light"');
    expect(lightSvg).toContain('>25<');
    expect(heavySvg).toContain('data-armor="heavy"');
    expect(heavySvg).toContain('>50<');
  });

  it('generates valid vector icons for all 12 specialist abilities, roles, Kern, and portraits', () => {
    for (const charId of CHARACTER_IDS) {
      for (const slot of ['q', 'e', 'ult', 'x'] as const) {
        const svg = getAbilitySvg(charId, slot);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg.length).toBeGreaterThan(80);
      }
      expect(getAbilitySvg(charId, 'ult')).toBe(getAbilitySvg(charId, 'x'));
    }

    const roles: RoleArchetype[] = ['Vorstoß', 'Aufklärer', 'Kontrolleur', 'Wächter'];
    for (const role of roles) {
      const roleSvg = getRoleSvg(role);
      expect(roleSvg.startsWith('<svg')).toBe(true);
      expect(roleSvg.endsWith('</svg>')).toBe(true);
    }

    expect(getKernSvg()).toContain('<svg');

    // Verify all 4 portraits have collision-free <defs> IDs when mounted side-by-side
    const seenIds = new Set<string>();
    for (const charId of CHARACTER_IDS) {
      const portrait = getCharacterPortraitSvg(charId);
      expect(portrait.startsWith('<svg')).toBe(true);
      expect(portrait).toContain(CHARACTERS[charId].accentHex);

      const idMatches = portrait.matchAll(/\bid="([^"]+)"/g);
      let foundAtLeastOne = false;
      for (const m of idMatches) {
        foundAtLeastOne = true;
        expect(seenIds.has(m[1])).toBe(false);
        seenIds.add(m[1]);
      }
      expect(foundAtLeastOne).toBe(true);
    }
  });
});

describe('Phase 7 Career, Objectives & Free Finishes (progression.ts)', () => {
  let backingMap: Map<string, string>;

  beforeEach(() => {
    const mem = createMemoryStorage();
    backingMap = mem.map;
    setProgressionStorageForTests(mem.storage);
    resetProgressionState();
  });

  it('tracks Einsatzziele progress, caps targets, and unlocks all 4 milestone diamonds', () => {
    const initial = getObjectivesOverview();
    expect(initial.objectives).toHaveLength(3);
    expect(initial.diamonds).toHaveLength(4);
    expect(initial.completedDiamonds).toBe(0);
    expect(initial.objectives.every((o) => o.current === 0 && !o.completed)).toBe(true);

    // Partial progress
    recordProgress({ headshots: 8, kills: 12, rounds: 4, kernActions: 2 });
    const midObjs = getObjectives();
    expect(midObjs.find((o) => o.id === 'headshots')?.current).toBe(8);
    expect(midObjs.find((o) => o.id === 'eliminations')?.current).toBe(12);
    expect(midObjs.find((o) => o.id === 'rounds')?.current).toBe(4);
    expect(backingMap.has(PROGRESSION_STORAGE_KEY)).toBe(true);

    // Complete all 3 objectives (15 headshots, 30 kills, 10 rounds)
    const done = recordProgress({ headshots: 10, kills: 25, rounds: 8 });
    expect(done.objectives.every((o) => o.completed && o.progress01 === 1)).toBe(true);
    expect(done.objectives.find((o) => o.id === 'headshots')?.current).toBe(15);
    expect(done.objectives.find((o) => o.id === 'eliminations')?.current).toBe(30);
    expect(done.objectives.find((o) => o.id === 'rounds')?.current).toBe(10);

    const diamonds = getObjectiveDiamonds();
    expect(diamonds.every((d) => d.unlocked)).toBe(true);
    expect(done.completedDiamonds).toBe(4);
  });

  it('records newest-first Match-Verlauf entries, caps history, and computes CareerSummary', () => {
    recordMatchHistory({
      id: 'm1',
      mapId: 'hafenwerk',
      mode: 'kernbruch',
      character: 'mira',
      scoreAlly: 7,
      scoreEnemy: 4,
      kills: 14,
      deaths: 6,
      assists: 5,
      headshots: 6,
      kernActions: 2,
    });
    recordMatchHistory({
      id: 'm2',
      mapId: 'werkstadt',
      mode: 'kernbruch',
      character: 'mira',
      scoreAlly: 5,
      scoreEnemy: 7,
      kills: 10,
      deaths: 8,
      assists: 3,
    });
    recordMatchHistory({
      id: 'm3',
      mapId: 'kryowerk',
      mode: 'kernbruch',
      character: 'tessa',
      scoreAlly: 7,
      scoreEnemy: 2,
      kills: 16,
      deaths: 4,
      assists: 7,
    });

    const history = getMatchHistory();
    expect(history).toHaveLength(3);
    expect(history[0].id).toBe('m3');
    expect(history[0].won).toBe(true);
    expect(history[1].id).toBe('m2');
    expect(history[1].won).toBe(false);

    recordProgress({ kills: 40, headshots: 15, rounds: 20, kernActions: 4 });
    const summary = getCareerSummary();
    expect(summary.wins).toBe(2);
    expect(summary.losses).toBe(1);
    expect(summary.winRatePct).toBe(67);
    expect(summary.topSpecialist).toBe('mira');
    expect(summary.rankTier).toBeGreaterThanOrEqual(2);
    expect(summary.kdaLabel).toBe('40 / 18 / 15');

    // Cap at MAX_MATCH_HISTORY_ENTRIES (25)
    for (let i = 0; i < 30; i += 1) {
      recordMatchHistory({
        mapId: 'hafenwerk',
        character: 'ryo',
        scoreAlly: 7,
        scoreEnemy: 5,
        kills: 5,
        deaths: 5,
        assists: 1,
      });
    }
    expect(getMatchHistory()).toHaveLength(MAX_MATCH_HISTORY_ENTRIES);
  });

  it('persists 100% free weapon finishes across all weapons + knife and handles missing storage', () => {
    const defaults = getSelectedFinishes();
    expect(defaults.lanze).toBe('standard');
    expect(defaults.knife).toBe('standard');

    setWeaponFinish('lanze', 'titan');
    setWeaponFinish('falke', 'arktisch');
    setWeaponFinish('knife', 'glutkern');

    const updated = getSelectedFinishes();
    expect(updated.lanze).toBe('titan');
    expect(updated.falke).toBe('arktisch');
    expect(updated.knife).toBe('glutkern');

    // Verify graceful fallback when custom storage is cleared
    setProgressionStorageForTests(null);
    expect(() => getObjectives()).not.toThrow();
  });
});
