import { AnkleMechanism } from '../core/mechanism';
import { PoseLevel } from '../core/assessment';
import { clamp } from '../core/math';
import { poseLevelAt } from '../core/workspace';
import { POSE_COLORS } from './palette';
import { POSE_LIMITS, WorkbenchState } from '../state/model';

const PAD = { left: 34, right: 12, top: 12, bottom: 22 };
const MAP_W = 110;
const MAP_H = 80;
const {
  pitchMin: PITCH_MIN, pitchMax: PITCH_MAX, rollMin: ROLL_MIN, rollMax: ROLL_MAX
} = POSE_LIMITS;

type Segment = [x1: number, y1: number, x2: number, y2: number];

interface MapCache {
  signature: string;
  canvas: HTMLCanvasElement;
  reachableEdge: Segment[];
  warningEdge: Segment[];
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
  private pointerId: number | null = null;
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
    const signature = JSON.stringify(state.params);
    if (this.cache?.signature !== signature) {
      this.cache = { signature, ...this.buildMap(state.mech) };
    }
    this.draw();
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  private bindPointer(): void {
    const c = this.canvas;
    const position = (event: PointerEvent): { x: number; y: number } => {
      const rect = c.getBoundingClientRect();
      return { x: event.clientX - rect.left - c.clientLeft, y: event.clientY - rect.top - c.clientTop };
    };
    const update = (x: number, y: number): void => {
      const pose = this.toPose(x, y);
      this.onPose(pose.pitchDeg, pose.rollDeg);
    };
    c.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.pointerId !== null) return;
      const { x, y } = position(event);
      if (!this.insidePlot(x, y)) return;
      this.pointerId = event.pointerId;
      this.hover = null;
      c.setPointerCapture(event.pointerId);
      c.classList.add('is-dragging');
      update(x, y);
    });
    c.addEventListener('pointermove', (event) => {
      const { x, y } = position(event);
      if (this.pointerId === event.pointerId) {
        update(x, y);
      } else if (this.pointerId === null) {
        this.hover = this.insidePlot(x, y) ? { x, y } : null;
        this.draw();
      }
    });
    const end = (event: PointerEvent): void => {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      c.classList.remove('is-dragging');
      this.draw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
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

  private insidePlot(x: number, y: number): boolean {
    const plot = this.plot();
    return x >= plot.x && x <= plot.x + plot.w && y >= plot.y && y <= plot.y + plot.h;
  }

  private toPose(x: number, y: number): { pitchDeg: number; rollDeg: number } {
    const plot = this.plot();
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

  private buildMap(mech: AnkleMechanism): Omit<MapCache, 'signature'> {
    const canvas = document.createElement('canvas');
    canvas.width = MAP_W;
    canvas.height = MAP_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    const palette = Object.fromEntries(Object.entries(POSE_COLORS).map(([level, { fill }]) => [
      level, Number.parseInt(fill.slice(1), 16)
    ]));
    const image = ctx.createImageData(MAP_W, MAP_H);
    const levels: PoseLevel[] = [];
    const reachableEdge: Segment[] = [];
    const warningEdge: Segment[] = [];
    const markEdge = (a: PoseLevel, b: PoseLevel, segment: Segment): void => {
      if (a === b) return;
      if (a === 'unreachable' || b === 'unreachable') reachableEdge.push(segment);
      else if (a === 'healthy' || b === 'healthy') warningEdge.push(segment);
    };
    for (let row = 0; row < MAP_H; row++) {
      const rollDeg = ROLL_MAX - ((row + 0.5) / MAP_H) * (ROLL_MAX - ROLL_MIN);
      for (let col = 0; col < MAP_W; col++) {
        const pitchDeg = PITCH_MIN + ((col + 0.5) / MAP_W) * (PITCH_MAX - PITCH_MIN);
        const level = poseLevelAt(mech, pitchDeg, rollDeg);
        const index = row * MAP_W + col;
        levels.push(level);
        if (col > 0) markEdge(level, levels[index - 1], [col, row, col, row + 1]);
        if (row > 0) markEdge(level, levels[index - MAP_W], [col, row, col + 1, row]);
        const color = palette[level];
        const offset = index * 4;
        image.data[offset] = color >> 16;
        image.data[offset + 1] = (color >> 8) & 255;
        image.data[offset + 2] = color & 255;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return { canvas, reachableEdge, warningEdge };
  }

  private draw(): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    const state = this.state;
    const cache = this.cache;
    if (!state || !cache) return;
    const plot = this.plot();

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cache.canvas, plot.x, plot.y, plot.w, plot.h);
    ctx.restore();

    ctx.strokeStyle = 'rgba(148,163,184,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);

    this.drawTicks(plot);
    this.drawBoundary(plot, cache.reachableEdge, POSE_COLORS.unreachable.ink);
    this.drawBoundary(plot, cache.warningEdge, POSE_COLORS.caution.ink);

    const cursor = this.projectPose(state.pitchDeg, state.rollDeg);
    ctx.strokeStyle = 'rgba(33,60,87,0.42)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cursor.x, plot.y);
    ctx.lineTo(cursor.x, plot.y + plot.h);
    ctx.moveTo(plot.x, cursor.y);
    ctx.lineTo(plot.x + plot.w, cursor.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = POSE_COLORS[state.level].ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (this.hover && this.pointerId === null) {
      const pose = this.toPose(this.hover.x, this.hover.y);
      const p = this.projectPose(pose.pitchDeg, pose.rollDeg);
      ctx.fillStyle = 'rgba(33,60,87,0.48)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      this.tag(`${pose.pitchDeg.toFixed(0)}° / ${pose.rollDeg.toFixed(0)}°`, p.x, p.y);
    }
  }

  private drawTicks(plot: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.ctx;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#465d76';
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

  private drawBoundary(
    plot: { x: number; y: number; w: number; h: number },
    segments: Segment[],
    color: string
  ): void {
    const ctx = this.ctx;
    const dx = plot.w / MAP_W;
    const dy = plot.h / MAP_H;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of segments) {
      ctx.moveTo(plot.x + x1 * dx, plot.y + y1 * dy);
      ctx.lineTo(plot.x + x2 * dx, plot.y + y2 * dy);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private tag(text: string, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    const w = ctx.measureText(text).width + 10;
    const bx = Math.min(this.width - w - 4, Math.max(4, x - w / 2));
    const by = Math.max(4, y - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath();
    ctx.roundRect(bx, by, w, 15, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1d344e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, by + 8);
  }
}
