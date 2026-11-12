import { afterEach, describe, expect, it, vi } from 'vitest';
import { Minimap } from '../src/ui/Minimap';
import type { MapDefinition } from '../src/data/maps/types';

function createMockCanvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };
}

function stubMinimalDom(dpr = 2) {
  const makeEl = (tag: string) => {
    const el: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      className: '',
      id: '',
      hidden: false,
      textContent: '',
      style: {},
      width: 0,
      height: 0,
      children: [] as unknown[],
      setAttribute: vi.fn(),
      append: vi.fn((...nodes: unknown[]) => {
        (el.children as unknown[]).push(...nodes);
      }),
      appendChild: vi.fn((node: unknown) => {
        (el.children as unknown[]).push(node);
      }),
      remove: vi.fn(),
      getContext: tag === 'canvas' ? vi.fn(() => createMockCanvasContext()) : undefined,
    };
    return el;
  };

  vi.stubGlobal('window', { devicePixelRatio: dpr });
  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) => makeEl(tag)),
  });

  return makeEl('div') as unknown as HTMLElement;
}

const TEST_MAP: MapDefinition = {
  id: 'hafenwerk',
  name: 'Testanlage',
  subtitle: 'Unit Test Map',
  bounds: { width: 80, depth: 80 },
  blocks: [
    { id: 'floor-1', pos: { x: 0, y: -0.5, z: 0 }, size: { x: 80, y: 1, z: 80 }, color: 0x223344, material: 'floor' },
    { id: 'wall-1', pos: { x: 0, y: 1.5, z: 0 }, size: { x: 4, y: 3, z: 4 }, color: 0x556677, material: 'concrete' },
  ],
  zones: [
    { id: 'site-a', type: 'kern_site_a', label: 'A', color: 0xff6b2b, center: { x: -18, y: 0, z: -12 }, size: { x: 10, z: 10 } },
    { id: 'site-b', type: 'kern_site_b', label: 'B', color: 0x18d4c9, center: { x: 18, y: 0, z: 12 }, size: { x: 10, z: 10 } },
  ],
  playerSpawn: { pos: { x: -20, y: 1, z: 25 }, yaw: 0 },
  dummySpawns: [{ id: 'd1', pos: { x: 20, y: 1, z: -25 }, yaw: Math.PI }],
  callouts: [{ id: 'mid', label: 'MITTE', pos: { x: 0, y: 0, z: 0 } }],
};

describe('Minimap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manages tactical pings with addPing, fade-out expiration, and clearPings', () => {
    const container = stubMinimalDom(2);
    const minimap = new Minimap(container);
    minimap.setMap(TEST_MAP);
    minimap.setVisible(true);

    const id1 = minimap.addPing(-18, -12, 'danger', undefined, 2.0, 'A');
    const id2 = minimap.addPing(5, 5, 'assist', '#18d4c9', 4.0);
    expect(id1).toBeLessThan(id2);
    expect(minimap.getActivePings()).toHaveLength(2);

    const frame = {
      localPos: { x: 0, y: 1, z: 10 },
      localYaw: 0.2,
      localTeam: 'A' as const,
      localAlive: true,
      allies: [
        { uid: 'ally-1', pos: { x: -6, y: 1, z: 4 }, yaw: 1.1, alive: true },
        { uid: 'ally-2', pos: { x: 8, y: 1, z: -4 }, yaw: -0.5, alive: false },
      ],
      revealedEnemies: [{ uid: 'enemy-1', pos: { x: 12, y: 1, z: -14 }, yaw: 2.0, alive: true }],
    };

    minimap.update(frame, 1.5);
    expect(minimap.getActivePings()).toHaveLength(2);

    // After another 1.0s (total 2.5s), id1 (duration 2.0s) should expire while id2 remains
    minimap.update(frame, 1.0);
    expect(minimap.getActivePings()).toHaveLength(1);
    expect(minimap.getActivePings()[0].id).toBe(id2);

    minimap.clearPings();
    expect(minimap.getActivePings()).toHaveLength(0);
    minimap.dispose();
  });

  it('handles DPR changes and external frame pings without throwing', () => {
    const container = stubMinimalDom(1);
    const minimap = new Minimap(container);
    minimap.setMap(TEST_MAP);
    minimap.setVisible(true);
    expect(minimap.isActive()).toBe(true);

    (window as unknown as { devicePixelRatio: number }).devicePixelRatio = 2;

    expect(() =>
      minimap.update(
        {
          localPos: { x: 0, y: 1, z: 0 },
          localYaw: 0,
          localTeam: 'A',
          localAlive: false,
          allies: [],
          revealedEnemies: [],
          pings: [{ x: 10, z: -10, type: 'defend', progress01: 0.5, label: 'B' }],
        },
        0.016
      )
    ).not.toThrow();
  });
});
