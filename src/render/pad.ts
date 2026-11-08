import { AnkleMechanism, FootLoad, Statics } from '../core/mechanism';
import { classify, PoseLevel } from '../core/assessment';
import { clamp, rad } from '../core/math';
import { WorkbenchState } from '../state/model';

const PAD = { left: 34, right: 12, top: 12, bottom: 22 };
const MAP_W = 50;
const MAP_H = 40;
const PITCH_MIN = -30;
const PITCH_MAX = 25;
const ROLL_MIN = -20;
const ROLL_MAX = 20;

const LEVEL_COLOR: Record<PoseLevel, [number, number, number, number]> = {
  unreachable: [46, 16, 27, 190],
  singular: [120, 32, 46, 210],
  caution: [120, 74, 14, 185],
  healthy: [14, 88, 72, 175]
};

interface MapCache {
  signature: string;
  image: ImageData;
}

/**
 * Click-and-drag pitch/roll pad with a cached workspace heat map.
 * The map only depends on geometry and load, so pose changes never rebuild it.
 */
export class WorkspacePad {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly onPose: (pitchDeg: number, rollDeg: number) => void;
  private cache: MapCache | null = null;
  private state: WorkbenchState | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dragging = false;
  private hover: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, onPose: (pitchDeg: number, rollDeg: number) => void) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.onPose = onPose;
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  render(state: WorkbenchState): void {
    this.state = state;
    this.draw();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  private bindPointer(): void {
    const c = this.canvas;
    const update = (event: PointerEvent): void => {
      const rect = c.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const pose = this.toPose(x, y);
      if (pose) this.onPose(pose.pitchDeg, pose.rollDeg);
    };
    c.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      c.setPointerCapture(event.pointerId);
      c.classList.add('is-dragging');
      update(event);
    });
    c.addEventListener('pointermove', (event) => {
      const rect = c.getBoundingClientRect();
      this.hover = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (this.dragging) update(event);
      else this.draw();
    });
    const end = (event: PointerEvent): void => {
      this.dragging = false;
      c.classList.remove('is-dragging');
      if (c.hasPointerCapture(event.pointerId)) c.releasePointerCapture(event.pointerId);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
  }

  private plot(): { x: number; y: number; w: number; h: number } {
    return {
      x: PAD.left,
      y: PAD.top,
      w: Math.max(10, this.width - PAD.left - PAD.right),
      h: Math.max(10, this.height - PAD.top - PAD.bottom)
    };
  }

  private toPose(x: number, y: number): { pitchDeg: number; rollDeg: number } | null {
    const plot = this.plot();
    if (x < plot.x - 6 || x > plot.x + plot.w + 6 || y < plot.y - 6 || y > plot.y + plot.h + 6) return null;
    const pitchDeg = PITCH_MIN + clamp((x - plot.x) / plot.w, 0, 1) * (PITCH_MAX - PITCH_MIN);
    const rollDeg = ROLL_MAX - clamp((y - plot.y) / plot.h, 0, 1) * (ROLL_MAX - ROLL_MIN);
    return { pitchDeg, rollDeg };
  }

  private projectPose(pitchDeg: number, rollDeg: number): { x: number; y: number } {
    const plot = this.plot();
    return {
      x: plot.x + ((pitchDeg - PITCH_MIN) / (PITCH_MAX - PITCH_MIN)) * plot.w,
      y: plot.y + ((ROLL_MAX - rollDeg) / (ROLL_MAX - ROLL_MIN)) * plot.h
    };
  }

  private buildMap(mech: AnkleMechanism, load: FootLoad): ImageData {
    const image = this.ctx.createImageData(MAP_W, MAP_H);
    for (let row = 0; row < MAP_H; row++) {
      const rollDeg = ROLL_MAX - ((row + 0.5) / MAP_H) * (ROLL_MAX - ROLL_MIN);
      for (let col = 0; col < MAP_W; col++) {
        const pitchDeg = PITCH_MIN + ((col + 0.5) / MAP_W) * (PITCH_MAX - PITCH_MIN);
        const pitch = rad(pitchDeg);
        const roll = rad(rollDeg);
        const ik = mech.solveIK(pitch, roll);
        let statics: Statics | null = null;
        if (ik.ok) statics = mech.statics(pitch, roll, ik.theta1, ik.theta2, load);
        const [r, g, b, a] = LEVEL_COLOR[classify(statics)];
        const offset = (row * MAP_W + col) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = a;
      }
    }
    return image;
  }

  private draw(): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    const state = this.state;
    if (!state) return;
    const plot = this.plot();

    const signature = `${JSON.stringify(state.params)}|${state.load.Fz}|${state.load.Fx}`;
    if (!this.cache || this.cache.signature !== signature) {
      this.cache = { signature, image: this.buildMap(state.mech, state.load) };
    }

    const off = document.createElement('canvas');
    off.width = MAP_W;
    off.height = MAP_H;
    off.getContext('2d')?.putImageData(this.cache.image, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, plot.x, plot.y, plot.w, plot.h);
    ctx.restore();

    ctx.strokeStyle = 'rgba(148,163,184,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);

    this.drawTicks(plot);
    this.drawContour(plot, state);

    const cursor = this.projectPose(state.pitchDeg, state.rollDeg);
    ctx.strokeStyle = 'rgba(232,238,247,0.35)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cursor.x, plot.y);
    ctx.lineTo(cursor.x, plot.y + plot.h);
    ctx.moveTo(plot.x, cursor.y);
    ctx.lineTo(plot.x + plot.w, cursor.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const dotColor =
      state.level === 'healthy'
        ? '#34d399'
        : state.level === 'caution'
          ? '#fbbf24'
          : state.level === 'singular'
            ? '#fb7185'
            : '#64748b';
    ctx.fillStyle = '#070b12';
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (this.hover && !this.dragging) {
      const hoverPose = this.toPose(this.hover.x, this.hover.y);
      if (hoverPose) {
        const p = this.projectPose(hoverPose.pitchDeg, hoverPose.rollDeg);
        ctx.fillStyle = 'rgba(232,238,247,0.45)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        this.tag(`${hoverPose.pitchDeg.toFixed(0)}° / ${hoverPose.rollDeg.toFixed(0)}°`, p.x, p.y);
      }
    }
  }

  private drawTicks(plot: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.ctx;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(148,163,184,0.65)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let pitch = PITCH_MIN; pitch <= PITCH_MAX; pitch += 5) {
      const x = plot.x + ((pitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN)) * plot.w;
      ctx.fillText(`${pitch}`, x, plot.y + plot.h + 5);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let roll = ROLL_MIN; roll <= ROLL_MAX; roll += 5) {
      const y = plot.y + ((ROLL_MAX - roll) / (ROLL_MAX - ROLL_MIN)) * plot.h;
      ctx.fillText(`${roll}`, plot.x - 6, y);
    }
  }

  private drawContour(plot: { x: number; y: number; w: number; h: number }, state: WorkbenchState): void {
    if (!state.reach) return;
    const xFor = (pitch: number): number => plot.x + ((pitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN)) * plot.w;
    const min = Math.max(PITCH_MIN, state.reach.min);
    const max = Math.min(PITCH_MAX, state.reach.max);
    if (min > max) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(56,189,248,0.35)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(xFor(min), plot.y);
    ctx.lineTo(xFor(min), plot.y + plot.h);
    ctx.moveTo(xFor(max), plot.y);
    ctx.lineTo(xFor(max), plot.y + plot.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(56,189,248,0.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`可达 ${min.toFixed(0)}…${max.toFixed(0)}°`, (xFor(min) + xFor(max)) / 2, plot.y - 3);
  }

  private tag(text: string, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    const w = ctx.measureText(text).width + 10;
    const bx = Math.min(this.width - w - 4, Math.max(4, x - w / 2));
    const by = Math.max(4, y - 20);
    ctx.fillStyle = 'rgba(7,11,18,0.88)';
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath();
    ctx.roundRect(bx, by, w, 15, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, by + 8);
  }
}
