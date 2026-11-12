import type {
  ActiveWorldEffect,
  KernSnapshot,
  MatchPhase,
  TeamId,
  Vec3,
} from '../core/types';
import type { MapBlock, MapDefinition } from '../data/maps/types';

/**
 * SHARDLINE 2D tactical minimap.
 *
 * Renders a static offscreen floor plan from a `MapDefinition` (floors, walls / cover,
 * Kern zones A & B, spawn barriers) once per map, then draws live markers on top every
 * frame: local player + view cone, allied team, Kern, world effects, and enemies ONLY
 * while they are revealed to the local team (or offline training targets).
 *
 * Orientation: north-up (−Z points up on the canvas), so the layout never spins.
 */

export interface MinimapMarker {
  uid: string;
  pos: Vec3;
  yaw?: number;
  alive: boolean;
  hasKern?: boolean;
}

export interface MinimapFrame {
  localPos: Vec3;
  localYaw: number;
  localTeam: TeamId;
  localAlive: boolean;
  localHasKern?: boolean;
  allies: ReadonlyArray<MinimapMarker>;
  /** Enemies already filtered to "revealed to local team" by the caller. */
  revealedEnemies: ReadonlyArray<MinimapMarker>;
  /** Offline training targets (always shown). */
  trainingTargets?: ReadonlyArray<MinimapMarker>;
  kern?: KernSnapshot | null;
  effects?: ReadonlyArray<ActiveWorldEffect>;
  phase?: MatchPhase | null;
  barriersActive?: boolean;
}

const CSS_SIZE = 208;
const PADDING = 8;

const COLOR_ALLY = '#18d4c9';
const COLOR_ENEMY = '#ff5847';
const COLOR_KERN = '#ffb03a';
const COLOR_SELF = '#ffffff';

export class Minimap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly baseCanvas: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly mapLabelEl: HTMLElement;

  private mapDef: MapDefinition | null = null;
  private dpr = 1;
  private scale = 1; // px per meter (CSS px)
  private originX = 0;
  private originZ = 0;
  private visible = false;
  private pulseT = 0;
  private lastBarriersActive: boolean | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'shard-minimap';
    this.root.id = 'hud-minimap';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.mapLabelEl = document.createElement('div');
    this.mapLabelEl.className = 'minimap-label';
    this.mapLabelEl.textContent = 'KARTE';

    const northTag = document.createElement('span');
    northTag.className = 'minimap-north';
    northTag.textContent = 'N';

    this.root.append(this.canvas, northTag, this.mapLabelEl);
    container.appendChild(this.root);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Minimap: 2D canvas context unavailable.');
    this.ctx = ctx;

    this.baseCanvas = document.createElement('canvas');
    const baseCtx = this.baseCanvas.getContext('2d');
    if (!baseCtx) throw new Error('Minimap: offscreen 2D canvas context unavailable.');
    this.baseCtx = baseCtx;

    this.resizeBacking();
  }

  public isActive(): boolean {
    return this.visible && this.mapDef !== null;
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.hidden = !visible;
  }

  public setMap(mapDef: MapDefinition): void {
    if (this.mapDef && this.mapDef.id === mapDef.id) return;
    this.mapDef = mapDef;
    this.mapLabelEl.textContent = mapDef.name.toUpperCase();
    this.lastBarriersActive = null;
    this.computeProjection();
    this.renderBase(true);
  }

  public resize(): void {
    this.resizeBacking();
    this.computeProjection();
    this.renderBase(true, this.lastBarriersActive ?? false);
  }

  private resizeBacking(): void {
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const px = Math.round(CSS_SIZE * this.dpr);
    this.canvas.width = px;
    this.canvas.height = px;
    this.canvas.style.width = `${CSS_SIZE}px`;
    this.canvas.style.height = `${CSS_SIZE}px`;
    this.baseCanvas.width = px;
    this.baseCanvas.height = px;
  }

  private computeProjection(): void {
    if (!this.mapDef) return;
    const w = Math.max(10, this.mapDef.bounds.width);
    const d = Math.max(10, this.mapDef.bounds.depth);
    const usable = CSS_SIZE - PADDING * 2;
    this.scale = usable / Math.max(w, d);
    this.originX = 0;
    this.originZ = 0;
  }

  /** World (x,z) -> canvas CSS px. North-up: −Z is up. */
  private toScreenX(x: number): number {
    return CSS_SIZE / 2 + (x - this.originX) * this.scale;
  }

  private toScreenY(z: number): number {
    return CSS_SIZE / 2 + (z - this.originZ) * this.scale;
  }

  private isInsideBounds(b: MapBlock): boolean {
    if (!this.mapDef) return false;
    const hw = this.mapDef.bounds.width / 2 + 2;
    const hd = this.mapDef.bounds.depth / 2 + 2;
    return Math.abs(b.pos.x) <= hw && Math.abs(b.pos.z) <= hd;
  }

  private drawBlockFootprint(ctx: CanvasRenderingContext2D, b: MapBlock): void {
    const cx = this.toScreenX(b.pos.x);
    const cy = this.toScreenY(b.pos.z);
    const w = b.size.x * this.scale;
    const h = b.size.z * this.scale;
    ctx.save();
    ctx.translate(cx, cy);
    // Map rotY (counter-clockwise around +Y looking down) onto canvas (y-down) rotation
    if (b.rotY) ctx.rotate(-b.rotY);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private renderBase(force = false, barriersActive = false): void {
    if (!this.mapDef) return;
    if (!force && this.lastBarriersActive === barriersActive) return;
    this.lastBarriersActive = barriersActive;

    const ctx = this.baseCtx;
    const map = this.mapDef;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, CSS_SIZE, CSS_SIZE);

    // Background panel
    ctx.fillStyle = 'rgba(8, 13, 20, 0.86)';
    ctx.fillRect(0, 0, CSS_SIZE, CSS_SIZE);

    // Playable area outline
    const halfW = (map.bounds.width / 2) * this.scale;
    const halfD = (map.bounds.depth / 2) * this.scale;
    ctx.fillStyle = 'rgba(38, 54, 70, 0.55)';
    ctx.fillRect(CSS_SIZE / 2 - halfW, CSS_SIZE / 2 - halfD, halfW * 2, halfD * 2);

    // Floors / walkable surfaces (low blocks), then walls & cover sorted by top height
    const blocks = map.blocks.filter((b) => this.isInsideBounds(b));
    const floors: MapBlock[] = [];
    const solids: MapBlock[] = [];
    for (const b of blocks) {
      const top = b.pos.y + b.size.y / 2;
      const isFloorMat = b.material === 'floor' || b.material === 'asphalt' || b.material === 'water_dock';
      if (isFloorMat || top <= 0.35) {
        floors.push(b);
      } else if (b.collider !== false) {
        solids.push(b);
      }
    }

    for (const b of floors) {
      // Skip the giant ground slab outline so internal floor tints remain readable
      if (b.size.x >= map.bounds.width * 0.9 && b.size.z >= map.bounds.depth * 0.9) continue;
      ctx.fillStyle = b.material === 'water_dock' ? 'rgba(30, 90, 120, 0.55)' : 'rgba(60, 80, 98, 0.5)';
      this.drawBlockFootprint(ctx, b);
    }

    solids.sort((a, b) => a.pos.y + a.size.y / 2 - (b.pos.y + b.size.y / 2));
    for (const b of solids) {
      const top = b.pos.y + b.size.y / 2;
      // Taller geometry renders lighter so cover heights read at a glance
      const t = Math.max(0, Math.min(1, top / 6));
      const light = Math.round(118 + t * 92);
      ctx.fillStyle = `rgb(${light - 22}, ${light - 8}, ${light + 6})`;
      this.drawBlockFootprint(ctx, b);
    }

    // Kern zones A & B
    for (const z of map.zones) {
      if (z.type !== 'kern_site_a' && z.type !== 'kern_site_b') continue;
      const isA = z.type === 'kern_site_a';
      const x0 = this.toScreenX(z.center.x - z.size.x / 2);
      const y0 = this.toScreenY(z.center.z - z.size.z / 2);
      const w = z.size.x * this.scale;
      const h = z.size.z * this.scale;
      ctx.fillStyle = isA ? 'rgba(255, 107, 43, 0.2)' : 'rgba(24, 212, 201, 0.2)';
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = isA ? '#ff6b2b' : '#18d4c9';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      ctx.fillStyle = isA ? '#ffb08e' : '#9ffaf3';
      ctx.font = '900 13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isA ? 'A' : 'B', this.toScreenX(z.center.x), this.toScreenY(z.center.z));
    }

    // Spawn zones (subtle)
    for (const z of map.zones) {
      if (z.type !== 'spawn_attacker' && z.type !== 'spawn_defender') continue;
      const x0 = this.toScreenX(z.center.x - z.size.x / 2);
      const y0 = this.toScreenY(z.center.z - z.size.z / 2);
      ctx.strokeStyle =
        z.type === 'spawn_attacker' ? 'rgba(255, 107, 43, 0.45)' : 'rgba(24, 212, 201, 0.45)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, z.size.x * this.scale - 1, z.size.z * this.scale - 1);
      ctx.setLineDash([]);
    }

    // Spawn barriers during buy phase
    if (barriersActive && map.spawnBarriers) {
      for (const sb of map.spawnBarriers) {
        ctx.fillStyle = sb.team === 'A' ? 'rgba(255, 107, 43, 0.85)' : 'rgba(24, 212, 201, 0.85)';
        const x0 = this.toScreenX(sb.pos.x - sb.size.x / 2);
        const y0 = this.toScreenY(sb.pos.z - sb.size.z / 2);
        ctx.fillRect(x0, y0, Math.max(1.5, sb.size.x * this.scale), Math.max(1.5, sb.size.z * this.scale));
      }
    }

    // Callout labels
    if (map.callouts) {
      ctx.fillStyle = 'rgba(214, 229, 244, 0.55)';
      ctx.font = '700 7px "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of map.callouts) {
        ctx.fillText(c.label.toUpperCase(), this.toScreenX(c.pos.x), this.toScreenY(c.pos.z));
      }
    }

    // Frame
    ctx.strokeStyle = 'rgba(145, 175, 205, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CSS_SIZE - 1, CSS_SIZE - 1);
  }

  private drawDot(
    ctx: CanvasRenderingContext2D,
    pos: Vec3,
    color: string,
    radius: number,
    yaw?: number
  ): void {
    const x = this.toScreenX(pos.x);
    const y = this.toScreenY(pos.z);
    if (yaw !== undefined) {
      // Forward = (-sin yaw, -cos yaw) in world XZ -> same mapping on north-up canvas
      const fx = -Math.sin(yaw);
      const fy = -Math.cos(yaw);
      ctx.beginPath();
      ctx.moveTo(x + fx * (radius + 4), y + fy * (radius + 4));
      ctx.lineTo(x - fy * radius * 0.9, y + fx * radius * 0.9);
      ctx.lineTo(x + fy * radius * 0.9, y - fx * radius * 0.9);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(5, 9, 14, 0.9)';
    ctx.stroke();
  }

  private drawKernGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(5, 9, 14, 0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawEffects(ctx: CanvasRenderingContext2D, effects: ReadonlyArray<ActiveWorldEffect>, localTeam: TeamId): void {
    for (const fx of effects) {
      const x = this.toScreenX(fx.pos.x);
      const y = this.toScreenY(fx.pos.z);
      const r = Math.max(2, fx.radius * this.scale);
      const allied = fx.team === localTeam;
      switch (fx.kind) {
        case 'smoke_dome':
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(176, 196, 214, 0.42)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(230, 240, 250, 0.7)';
          ctx.lineWidth = 1;
          ctx.stroke();
          break;
        case 'dark_ring':
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(40, 20, 64, 0.55)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(170, 120, 255, 0.75)';
          ctx.stroke();
          break;
        case 'echo_sensor':
        case 'global_reveal': {
          if (!allied) break;
          const pulse = 0.5 + 0.5 * Math.sin(this.pulseT * 5);
          ctx.beginPath();
          ctx.arc(x, y, r * (0.8 + pulse * 0.2), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(24, 212, 201, ${0.35 + pulse * 0.4})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          break;
        }
        case 'ember_field':
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 107, 43, 0.3)';
          ctx.fill();
          break;
        case 'magnet_mine':
        case 'shield_post':
        case 'bastion_zone':
          if (!allied) break;
          ctx.beginPath();
          ctx.rect(x - 2.5, y - 2.5, 5, 5);
          ctx.fillStyle = COLOR_ALLY;
          ctx.fill();
          if (fx.kind === 'bastion_zone') {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(24, 212, 201, 0.55)';
            ctx.stroke();
          }
          break;
        default:
          break;
      }
    }
  }

  public update(frame: MinimapFrame, frameDt: number): void {
    if (!this.visible || !this.mapDef) return;
    this.pulseT += frameDt;

    const barriersActive = Boolean(frame.barriersActive && frame.phase === 'buy');
    this.renderBase(false, barriersActive);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.baseCanvas, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Clip to frame
    ctx.save();
    ctx.beginPath();
    ctx.rect(1, 1, CSS_SIZE - 2, CSS_SIZE - 2);
    ctx.clip();

    if (frame.effects && frame.effects.length > 0) {
      this.drawEffects(ctx, frame.effects, frame.localTeam);
    }

    // Kern (dropped / planted / being planted / defused) — carried Kern shown on carrier
    const kern = frame.kern;
    if (kern && kern.status !== 'carried' && kern.status !== 'detonated') {
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseT * (kern.status === 'planted' || kern.status === 'defusing' ? 9 : 4));
      const kx = this.toScreenX(kern.pos.x);
      const ky = this.toScreenY(kern.pos.z);
      ctx.beginPath();
      ctx.arc(kx, ky, 6 + pulse * 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 88, 71, ${0.18 + pulse * 0.22})`;
      ctx.fill();
      this.drawKernGlyph(ctx, kx, ky, 4.5, kern.status === 'planted' || kern.status === 'defusing' ? COLOR_ENEMY : COLOR_KERN);
    }

    // Training targets (offline)
    if (frame.trainingTargets) {
      for (const t of frame.trainingTargets) {
        if (!t.alive) continue;
        this.drawDot(ctx, t.pos, 'rgba(255, 88, 71, 0.9)', 2.6);
      }
    }

    // Revealed enemies
    for (const e of frame.revealedEnemies) {
      if (!e.alive) continue;
      this.drawDot(ctx, e.pos, COLOR_ENEMY, 3.4, e.yaw);
    }

    // Allies
    for (const a of frame.allies) {
      if (!a.alive) {
        const x = this.toScreenX(a.pos.x);
        const y = this.toScreenY(a.pos.z);
        ctx.strokeStyle = 'rgba(24, 212, 201, 0.6)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3);
        ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3);
        ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
        continue;
      }
      this.drawDot(ctx, a.pos, COLOR_ALLY, 3.4, a.yaw);
      if (a.hasKern) {
        this.drawKernGlyph(ctx, this.toScreenX(a.pos.x) + 5, this.toScreenY(a.pos.z) - 5, 2.8, COLOR_KERN);
      }
    }

    // Local player view cone + marker
    const lx = this.toScreenX(frame.localPos.x);
    const ly = this.toScreenY(frame.localPos.z);
    const fx = -Math.sin(frame.localYaw);
    const fy = -Math.cos(frame.localYaw);
    const coneLen = 26;
    const half = 0.62;
    const ang = Math.atan2(fy, fx);
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, coneLen);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.arc(lx, ly, coneLen, ang - half, ang + half);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    this.drawDot(ctx, frame.localPos, frame.localAlive ? COLOR_SELF : 'rgba(255,255,255,0.4)', 3.8, frame.localYaw);
    if (frame.localHasKern) {
      this.drawKernGlyph(ctx, lx + 6, ly - 6, 3, COLOR_KERN);
    }

    ctx.restore();
  }

  public dispose(): void {
    this.root.remove();
  }
}
