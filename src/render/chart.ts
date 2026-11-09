import { CurvePoint, CurveSeries } from '../core/curves';
import { WorkbenchState } from '../state/model';

export interface SeriesSpec {
  key: keyof CurveSeries;
  label: string;
  color: string;
  dashed?: boolean;
}

export interface ChartSpec {
  unit: string;
  series: SeriesSpec[];
  band?: { from: number; to: number; label: string };
  includeZero?: boolean;
  output?: HTMLElement | null;
}

const X_MIN = -30;
const X_MAX = 25;
const PAD = { left: 42, right: 14, top: 28, bottom: 24 };

const GRID = 'rgba(63,91,120,0.16)';
const AXIS_TEXT = '#52667d';

function format(value: number, unit: string): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${unit}`;
}

/** Rounds a raw interval up to the nearest 1/2/2.5/5 × 10ⁿ step. */
function niceStep(raw: number): number {
  const exponent = Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const base = 10 ** exponent;
  const ratio = raw / base;
  const factor = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 2.5 : ratio <= 5 ? 5 : 10;
  return factor * base;
}

function tickLabel(value: number, step: number): string {
  const decimals = step >= 1 ? (Number.isInteger(step) ? 0 : 1) : Math.min(3, Math.ceil(-Math.log10(step)));
  return value.toFixed(decimals);
}

/** Canvas line chart with a fixed pitch domain, hover readout and safe band. */
export class Chart {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly spec: ChartSpec;
  private state: WorkbenchState | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private hoverPitch: number | null = null;

  constructor(canvas: HTMLCanvasElement, spec: ChartSpec) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.spec = spec;
    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      const plot = this.plot();
      const x = event.clientX - rect.left;
      if (x < plot.x || x > plot.x + plot.w) {
        this.hoverPitch = null;
      } else {
        this.hoverPitch = X_MIN + ((x - plot.x) / plot.w) * (X_MAX - X_MIN);
      }
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverPitch = null;
      this.draw();
    });
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

  private plot(): { x: number; y: number; w: number; h: number } {
    return {
      x: PAD.left,
      y: PAD.top,
      w: Math.max(10, this.width - PAD.left - PAD.right),
      h: Math.max(10, this.height - PAD.top - PAD.bottom)
    };
  }

  private draw(): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    const state = this.state;
    if (!state) return;

    const series = this.spec.series.map((spec) => ({ spec, points: state.curves[spec.key] }));
    const values: number[] = [];
    for (const { points } of series) {
      for (const point of points) if (point.value !== null) values.push(point.value);
    }
    if (this.spec.band) values.push(this.spec.band.from);
    if (this.spec.includeZero) values.push(0);
    if (values.length === 0) return;

    let yMin = Math.min(...values);
    let yMax = Math.max(...values);
    if (yMax - yMin < 1e-6) {
      yMin -= 1;
      yMax += 1;
    }
    const margin = (yMax - yMin) * 0.1;
    yMin -= margin;
    yMax += margin;

    const plot = this.plot();
    const xFor = (pitch: number): number => plot.x + ((pitch - X_MIN) / (X_MAX - X_MIN)) * plot.w;
    const yFor = (value: number): number => plot.y + plot.h - ((value - yMin) / (yMax - yMin)) * plot.h;

    if (this.spec.band) {
      const top = Math.max(yMin, Math.min(this.spec.band.to, yMax));
      const bottom = Math.max(yMin, Math.min(this.spec.band.from, yMax));
      if (top > bottom) {
        ctx.fillStyle = 'rgba(52,211,153,0.055)';
        ctx.fillRect(plot.x, yFor(top), plot.w, yFor(bottom) - yFor(top));
        ctx.strokeStyle = 'rgba(52,211,153,0.18)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plot.x, yFor(bottom));
        ctx.lineTo(plot.x + plot.w, yFor(bottom));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '9px ui-monospace, Consolas, monospace';
        ctx.fillStyle = '#16754e';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(this.spec.band.label, plot.x + plot.w - 4, yFor(bottom) - 3);
      }
    }

    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    const step = niceStep((yMax - yMin) / 4);
    ctx.lineWidth = 1;
    for (let value = Math.ceil(yMin / step) * step; value <= yMax + step * 1e-3; value += step) {
      const y = yFor(value);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      ctx.fillStyle = AXIS_TEXT;
      ctx.textAlign = 'right';
      ctx.fillText(tickLabel(value, step), plot.x - 7, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let pitch = X_MIN; pitch <= X_MAX; pitch += 10) {
      const x = xFor(pitch);
      ctx.strokeStyle = 'rgba(63,91,120,0.10)';
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.fillStyle = AXIS_TEXT;
      ctx.fillText(`${pitch}°`, x, plot.y + plot.h + 6);
    }

    if (this.spec.includeZero && yMin < 0 && yMax > 0) {
      ctx.strokeStyle = 'rgba(148,163,184,0.28)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(plot.x, yFor(0));
      ctx.lineTo(plot.x + plot.w, yFor(0));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    for (const { spec, points } of series) {
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(spec.dashed ? [5, 4] : []);
      ctx.beginPath();
      let started = false;
      for (const point of points) {
        if (point.value === null) {
          started = false;
          continue;
        }
        const x = xFor(point.pitchDeg);
        const y = yFor(point.value);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    const markerPitch = this.hoverPitch ?? state.pitchDeg;
    if (markerPitch >= X_MIN && markerPitch <= X_MAX) {
      const x = xFor(markerPitch);
      ctx.strokeStyle = this.hoverPitch === null ? 'rgba(49,75,103,0.35)' : 'rgba(49,75,103,0.58)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const { spec, points } of series) {
        const point = nearest(points, markerPitch);
        if (!point || point.value === null) continue;
        const y = yFor(point.value);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = spec.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    this.drawLegend(series.map((s) => s.spec), plot);
    this.updateOutput(series, markerPitch);
  }

  private drawLegend(specs: SeriesSpec[], plot: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.ctx;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let x = plot.x;
    const y = 11;
    for (const spec of specs) {
      ctx.fillStyle = spec.color;
      ctx.beginPath();
      ctx.arc(x + 3, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#52667d';
      ctx.fillText(spec.label, x + 11, y + 0.5);
      x += 11 + ctx.measureText(spec.label).width + 14;
    }
  }

  private updateOutput(series: Array<{ spec: SeriesSpec; points: CurvePoint[] }>, pitch: number): void {
    const output = this.spec.output;
    if (!output) return;
    const parts: string[] = [];
    for (const { spec, points } of series) {
      const point = nearest(points, pitch);
      parts.push(`${spec.label} ${point && point.value !== null ? format(point.value, this.spec.unit) : '—'}`);
    }
    output.textContent = `${pitch.toFixed(0)}° · ${parts.join('  ')}`;
  }
}

function nearest(points: CurvePoint[], pitch: number): CurvePoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDistance = Math.abs(best.pitchDeg - pitch);
  for (const point of points) {
    const distance = Math.abs(point.pitchDeg - pitch);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}
