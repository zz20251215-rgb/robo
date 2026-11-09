import { Vec3 } from '../core/math';
import { rotationMatrix } from '../core/mechanism';
import { CameraPose, VIEW_PRESETS, ViewPreset, WorkbenchState } from '../state/model';

const COLOR = {
  structure: '#8aa0bd',
  structureDim: 'rgba(138,160,189,0.4)',
  motor1: '#38bdf8',
  motor2: '#fbbf24',
  platform: '#cbd5e1',
  ground: 'rgba(120,145,175,0.10)',
  groundAxis: 'rgba(120,145,175,0.22)',
  force: '#34d399',
  label: '#94a3b8',
  frameX: '#f87171',
  frameY: '#4ade80',
  frameZ: '#60a5fa'
};

interface Screen {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

/**
 * Hand-rolled 3D ball-and-stick renderer for one mechanism pose.
 * Orthographic-ish perspective identical to the original projection, with a
 * quieter palette and depth-cued line widths.
 */
export class SceneView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cam: CameraPose = { ...VIEW_PRESETS.iso };
  private pan = { x: 0, y: -0.06 };
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private frame: WorkbenchState | null = null;
  private onRender: (() => void) | null = null;
  private isOrtho = false;

  constructor(canvas: HTMLCanvasElement, onRender?: () => void) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.onRender = onRender ?? null;
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setPreset(view: ViewPreset): void {
    this.cam = { ...VIEW_PRESETS[view] };
    this.pan = { x: 0, y: view === 'top' ? 0 : -0.06 };
    this.isOrtho = view !== 'iso';
    this.requestRender();
  }

  render(state: WorkbenchState): void {
    this.frame = state;
    this.draw();
  }

  private requestRender(): void {
    this.onRender?.();
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
    c.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      c.setPointerCapture(event.pointerId);
      c.classList.add('is-dragging');
    });
    c.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.cam.yaw -= dx * 0.009;
      this.cam.pitch = Math.min(1.45, Math.max(-1.45, this.cam.pitch + dy * 0.007));
      this.isOrtho = false;
      this.draw();
    });
    const end = (event: PointerEvent): void => {
      this.dragging = false;
      c.classList.remove('is-dragging');
      if (c.hasPointerCapture(event.pointerId)) c.releasePointerCapture(event.pointerId);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.cam.dist = Math.min(1.5, Math.max(0.3, this.cam.dist * Math.exp(event.deltaY * 0.0012)));
        this.draw();
      },
      { passive: false }
    );
  }

  private project(point: Vec3): Screen {
    const { yaw, pitch, dist } = this.cam;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x1 = point[0] * cy - point[1] * sy;
    const y1 = point[0] * sy + point[1] * cy;
    const z1 = point[2];
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const y2 = y1 * cp - z1 * sp;
    const z2 = y1 * sp + z1 * cp;
    const camZ = Math.max(0.08, y2 + dist);
    const fov = Math.min(this.width, this.height) * 0.78;
    const scale = this.isOrtho ? fov / dist : fov / camZ;
    return {
      x: this.width / 2 + (x1 + this.pan.x) * scale,
      y: this.height / 2 - (z2 + this.pan.y) * scale,
      depth: camZ,
      scale
    };
  }

  private draw(): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, 'rgba(14,21,33,0.55)');
    background.addColorStop(1, 'rgba(7,11,18,0.1)');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const state = this.frame;
    if (!state) return;

    const { mech, load } = state;
    const theta1 = (state.theta1Deg * Math.PI) / 180;
    const theta2 = (state.theta2Deg * Math.PI) / 180;
    const { A1, A2 } = mech.geometry;
    const { B1, B2 } = mech.crankTips(theta1, theta2);
    const { C1, C2 } = mech.platformPoints((state.pitchDeg * Math.PI) / 180, (state.rollDeg * Math.PI) / 180);

    this.drawGrid(load.z_sole);
    this.drawBase(A1, A2);

    this.link(A1, B1, COLOR.motor1, 3.2);
    this.link(A2, B2, COLOR.motor2, 3.2);
    this.joint(B1, COLOR.motor1, 5);
    this.joint(B2, COLOR.motor2, 5);

    this.link(B1, C1, COLOR.motor1, 2.6);
    this.link(B2, C2, COLOR.motor2, 2.6);

    this.drawPlatform(C1, C2, load.z_sole);

    this.joint(C1, COLOR.motor1, 4.5);
    this.joint(C2, COLOR.motor2, 4.5);
    this.joint(A1, COLOR.structure, 4);
    this.joint(A2, COLOR.structure, 4);

    if (state.showMotorAxes) {
      this.drawMotorAxis(A1, B1, theta1, COLOR.motor1);
      this.drawMotorAxis(A2, B2, theta2, COLOR.motor2);
    }
    if (state.showFrames) this.drawFrames(load.z_sole);

    this.drawForce(load, state.statics);
    this.drawLabels(state, A1, A2, B1, B2, C1, C2);
  }

  private link(a: Vec3, b: Vec3, color: string, width: number): void {
    const p = this.project(a);
    const q = this.project(b);
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, (width * p.scale) / 520);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  private joint(point: Vec3, color: string, radius: number): void {
    const p = this.project(point);
    const r = Math.max(2, (radius * p.scale) / 520);
    const ctx = this.ctx;
    ctx.fillStyle = '#0b1220';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawGrid(z: number): void {
    const ctx = this.ctx;
    const min = -0.34;
    const max = 0.36;
    for (let value = min; value <= max + 1e-9; value += 0.045) {
      const major = Math.abs(value) < 1e-6;
      ctx.strokeStyle = major ? COLOR.groundAxis : COLOR.ground;
      ctx.lineWidth = 1;
      this.strokePath([[value, min, z], [value, max, z]]);
      this.strokePath([[min, value, z], [max, value, z]]);
    }
  }

  private strokePath(points: Vec3[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((point, index) => {
      const p = this.project(point);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  private drawBase(A1: Vec3, A2: Vec3): void {
    const h = Math.max(A1[2], A2[2]);

    // Central pillar / shank (小腿主支撑柱)
    this.link([0, 0, h], [0, 0, 0], 'rgba(148,163,184,0.55)', 5);
    this.joint([0, 0, 0], '#94a3b8', 6);
    this.joint([0, 0, h], '#94a3b8', 5);

    // Universal joint U (虎克铰十字轴)
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(148,163,184,0.7)';
    ctx.lineWidth = 1.6;
    this.strokePath([[-0.028, 0, 0], [0.028, 0, 0]]);
    this.strokePath([[0, -0.028, 0], [0, 0.028, 0]]);

    // Motor mounting brackets connecting central shank to motor stations A1 and A2
    for (const A of [A1, A2]) {
      const ctx2 = this.ctx;
      ctx2.strokeStyle = 'rgba(148,163,184,0.6)';
      ctx2.lineWidth = 1.4;
      const half = 0.026;
      // Motor rotation pivot axis
      this.strokePath([[A[0], A[1] - half, A[2]], [A[0], A[1] + half, A[2]]]);
      // Fixed bracket from central pillar to motor station A
      this.strokePath([[0, 0, A[2]], [A[0], 0, A[2]], A]);
    }
  }

  private fillPath(points: Vec3[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((point, index) => {
      const p = this.project(point);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();
  }

  private drawPlatform(C1: Vec3, C2: Vec3, zSole: number): void {
    const state = this.frame;
    if (!state) return;
    const R = rotationMatrix((state.pitchDeg * Math.PI) / 180, (state.rollDeg * Math.PI) / 180);
    const outlineLocal = state.mech.footOutline(zSole);
    const outline = outlineLocal.map((p): Vec3 => [
      R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2],
      R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2],
      R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]
    ]);

    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(56,189,248,0.055)';
    this.fillPath(outline);
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.lineWidth = 1.3;
    this.strokePath([...outline, outline[0]]);

    this.strokePath([[0, 0, 0], C1]);
    this.strokePath([[0, 0, 0], C2]);
    this.link(C1, C2, COLOR.platform, 3);
  }

  private drawMotorAxis(A: Vec3, B: Vec3, theta: number, color: string): void {
    const { mech } = this.frame as WorkbenchState;
    const axis: Vec3 = [0, 1, 0];
    const half = 0.055;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(148,163,184,0.42)';
    ctx.lineWidth = 1;
    this.strokePath([[A[0], A[1] - half, A[2]], [A[0], A[1] + half, A[2]]]);
    ctx.setLineDash([]);

    const lc =
      color === COLOR.motor1
        ? (mech.params.l_crank1 ?? mech.params.l_crank ?? 0.045)
        : (mech.params.l_crank2 ?? mech.params.l_crank ?? 0.045);
    const r = lc * 1.42;
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    this.strokePath([A, [A[0], A[1], A[2] - r]]);

    ctx.beginPath();
    let start: Screen | null = null;
    for (let step = 0; step <= 24; step++) {
      const t = (theta * step) / 24;
      const p = this.project([A[0] - r * Math.sin(t), A[1], A[2] - r * Math.cos(t)]);
      if (step === 0) {
        ctx.moveTo(p.x, p.y);
        start = p;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const end = this.project([A[0] - r * Math.sin(theta), A[1], A[2] - r * Math.cos(theta)]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(end.x, end.y, 2.6, 0, Math.PI * 2);
    ctx.fill();

    if (start && Math.abs(theta) > 0.05) {
      const mid = this.project([A[0] - r * 1.08 * Math.sin(theta / 2), A[1], A[2] - r * 1.08 * Math.cos(theta / 2)]);
      this.badge(`${((theta * 180) / Math.PI).toFixed(1)}°`, mid.x, mid.y, color);
    }
    ctx.restore();
  }

  private badge(text: string, x: number, y: number, color: string): void {
    const ctx = this.ctx;
    ctx.font = '10px ui-monospace, "Cascadia Mono", Consolas, monospace';
    const padding = 4;
    const w = ctx.measureText(text).width + padding * 2;
    ctx.fillStyle = 'rgba(7,11,18,0.82)';
    ctx.strokeStyle = 'rgba(56,189,248,0.25)';
    ctx.lineWidth = 1;
    this.roundRect(x - w / 2, y - 16, w, 15, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - 8.2);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawFrames(zSole: number): void {
    const size = 0.062;
    const origin: Vec3 = [0, 0, zSole];
    const axes: Array<[Vec3, string, string]> = [
      [[origin[0] + size, 0, zSole], COLOR.frameX, 'X'],
      [[0, origin[1] + size, zSole], COLOR.frameY, 'Y'],
      [[0, 0, zSole + size], COLOR.frameZ, 'Z']
    ];
    const ctx = this.ctx;
    for (const [tip, color, label] of axes) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      this.strokePath([origin, tip]);
      const p = this.project(tip);
      ctx.font = '9px ui-monospace, Consolas, monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p.x + 3, p.y);
    }
  }

  private drawForce(load: { Fz: number; Fx: number; x_cop: number; y_cop: number; z_sole: number }, statics: WorkbenchState['statics']): void {
    if (load.Fz <= 0.5) return;
    const base: Vec3 = [load.x_cop, load.y_cop, load.z_sole];
    const length = Math.min(0.14, load.Fz * 0.00018);
    const tip: Vec3 = [base[0], base[1], base[2] + length];
    const p = this.project(base);
    const q = this.project(tip);
    const ctx = this.ctx;
    ctx.strokeStyle = COLOR.force;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();

    const angle = Math.atan2(q.y - p.y, q.x - p.x);
    ctx.fillStyle = COLOR.force;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.lineTo(q.x - 7 * Math.cos(angle - 0.4), q.y - 7 * Math.sin(angle - 0.4));
    ctx.lineTo(q.x - 7 * Math.cos(angle + 0.4), q.y - 7 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();

    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(52,211,153,0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.round(load.Fz)} N`, q.x + 6, q.y - 2);

    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(52,211,153,0.85)';
    ctx.fill();

    if (statics && statics.kind === 'ok') {
      const moment = this.project([base[0], base[1], base[2]]);
      ctx.font = '9px ui-sans-serif, system-ui';
      ctx.fillStyle = 'rgba(148,163,184,0.75)';
      ctx.fillText('CoP', moment.x + 5, moment.y + 12);
    }
  }

  private drawLabels(
    state: WorkbenchState,
    A1: Vec3,
    A2: Vec3,
    B1: Vec3,
    B2: Vec3,
    C1: Vec3,
    C2: Vec3
  ): void {
    const ctx = this.ctx;
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(148,163,184,0.85)';

    const pA1 = this.project(A1);
    const pA2 = this.project(A2);
    if (Math.hypot(pA1.x - pA2.x, pA1.y - pA2.y) < 3) {
      ctx.fillText('A₁/A₂', pA1.x + 7, pA1.y - 7);
    } else {
      ctx.fillText('A₁', pA1.x + 7, pA1.y - 7);
      ctx.fillText('A₂', pA2.x + 7, pA2.y - 7);
    }

    const pC1 = this.project(C1);
    const pC2 = this.project(C2);
    if (Math.hypot(pC1.x - pC2.x, pC1.y - pC2.y) < 3) {
      ctx.fillText('C₁/C₂', pC1.x + 7, pC1.y - 7);
    } else {
      ctx.fillText('C₁', pC1.x + 7, pC1.y - 7);
      ctx.fillText('C₂', pC2.x + 7, pC2.y - 7);
    }

    if (state.showMotorAxes) {
      const b1 = this.project(B1);
      const b2 = this.project(B2);
      if (Math.hypot(b1.x - b2.x, b1.y - b2.y) < 3) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('B₁', b1.x + 7, b1.y + 8);
        const w = ctx.measureText('B₁').width;
        ctx.fillStyle = 'rgba(148,163,184,0.85)';
        ctx.fillText('/', b1.x + 7 + w, b1.y + 8);
        const wSlash = ctx.measureText('/').width;
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('B₂', b1.x + 7 + w + wSlash, b1.y + 8);
      } else {
        ctx.fillStyle = 'rgba(56,189,248,0.9)';
        ctx.fillText('B₁', b1.x + 7, b1.y + 8);
        ctx.fillStyle = 'rgba(251,191,36,0.9)';
        ctx.fillText('B₂', b2.x + 7, b2.y + 8);
      }
    }
  }
}
