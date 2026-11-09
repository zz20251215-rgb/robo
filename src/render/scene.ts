import { add, mulMatVec, norm, rad, scale, sub, Vec3 } from '../core/math';
import { FOOTPLATE_THICKNESS, roundFootOutline } from './footplate';
import { CHAIN_COLORS } from './palette';
import { FootLoad, rotationMatrix } from '../core/mechanism';
import { CameraPose, VIEW_PRESETS, ViewPreset, WorkbenchState } from '../state/model';

const COLOR = {
  structure: '#8aa0bd',
  motor1: CHAIN_COLORS[0],
  motor2: CHAIN_COLORS[1],
  platform: '#8298b1',
  ground: 'rgba(120,145,175,0.10)',
  groundAxis: 'rgba(120,145,175,0.22)',
  force: '#16754e',
  label: '#516780',
  frameX: '#bb3b35',
  frameY: '#16754e',
  frameZ: '#285f9a'
};

interface Point {
  x: number;
  y: number;
}

interface Screen extends Point {
  scale: number;
}

interface Annotation {
  point: Vec3;
  text: string;
  color: string;
}

interface LabelBox extends Point {
  width: number;
  height: number;
}

const ORIGIN: Vec3 = [0, 0, 0];

/** Draws the ball-and-stick model and screen-space annotations for one pose. */
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

  private cameraSpace([x, y, z]: Vec3): Vec3 {
    const { yaw, pitch } = this.cam;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const depth = x * sy + y * cy;
    return [x * cy - y * sy, depth * cp - z * sp, depth * sp + z * cp];
  }

  private project(point: Vec3): Screen {
    const [x, depth, z] = this.cameraSpace(point);
    const { dist } = this.cam;
    const camZ = Math.max(0.08, depth + dist);
    const fov = Math.min(this.width * 1.25, this.height) * 1.22;
    const scale = this.isOrtho ? fov / dist : fov / camZ;
    return {
      x: this.width / 2 + (x + this.pan.x) * scale,
      y: this.height / 2 - (z + this.pan.y) * scale,
      scale
    };
  }

  private draw(): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    const state = this.frame;
    if (!state) return;

    const { mech, load } = state;
    const theta1 = rad(state.theta1Deg);
    const theta2 = rad(state.theta2Deg);
    const { A1, A2, u1, u2, v1, v2, w1, w2 } = mech.geometry;
    const { B1, B2 } = mech.crankTips(theta1, theta2);
    const { C1, C2 } = mech.platformPoints(rad(state.pitchDeg), rad(state.rollDeg));
    const annotations: Annotation[] = [];

    this.drawGrid(load.z_sole);
    this.drawBase(A1, A2, rad(state.pitchDeg));
    this.drawPlatform(C1, C2, load.z_sole);

    this.link(A1, B1, COLOR.motor1, 3.2);
    this.link(A2, B2, COLOR.motor2, 3.2);
    ctx.save();
    if (!state.reachable) ctx.setLineDash([4, 4]);
    this.link(B1, C1, COLOR.motor1, 2.6);
    this.link(B2, C2, COLOR.motor2, 2.6);
    ctx.restore();

    if (state.showMotorAxes) {
      this.drawMotorAxis(A1, u1, v1, w1, theta1, norm(sub(B1, A1)), COLOR.motor1);
      this.drawMotorAxis(A2, u2, v2, w2, theta2, norm(sub(B2, A2)), COLOR.motor2);
    }

    for (const [a, b, c, suffix, color] of [
      [A1, B1, C1, '₁', COLOR.motor1],
      [A2, B2, C2, '₂', COLOR.motor2]
    ] as const) {
      this.joint(a, color, 4.5);
      this.joint(b, color, 5);
      this.joint(c, color, 4.5);
      if (state.showJointLabels) {
        annotations.push({ point: a, text: `A${suffix}`, color });
        annotations.push({ point: b, text: `B${suffix}`, color });
        annotations.push({ point: c, text: `C${suffix}`, color });
      }
    }
    if (state.showJointLabels) annotations.push({ point: ORIGIN, text: 'U', color: COLOR.label });
    this.drawForce(load, annotations);
    const reserved = state.showFrames ? [this.drawOrientation()] : [];
    this.drawAnnotations(annotations, reserved);
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
    ctx.fillStyle = '#fff';
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
    for (let index = -7; index <= 8; index++) {
      const value = index * 0.045;
      const major = index === 0;
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

  private drawBase(A1: Vec3, A2: Vec3, pitch: number): void {
    const h = Math.max(A1[2], A2[2]);

    // Central pillar / shank (小腿主支撑柱)
    this.link([0, 0, h], [0, 0, 0], 'rgba(148,163,184,0.55)', 5);
    this.joint([0, 0, 0], '#516780', 6);
    this.joint([0, 0, h], '#516780', 5);

    // The fixed Y axis carries pitch. The roll axis follows that rotation.
    const ctx = this.ctx;
    const rollAxis = mulMatVec(rotationMatrix(pitch, 0), [0.021, 0, 0]);
    ctx.strokeStyle = 'rgba(148,163,184,0.7)';
    ctx.lineWidth = 1.6;
    this.strokePath([scale(rollAxis, -1), rollAxis]);
    this.strokePath([[0, -0.021, 0], [0, 0.021, 0]]);

    ctx.strokeStyle = 'rgba(148,163,184,0.6)';
    ctx.lineWidth = 1.4;
    for (const a of [A1, A2]) {
      this.strokePath([[0, 0, a[2]], [a[0], 0, a[2]], a]);
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
    const rotation = rotationMatrix(rad(state.pitchDeg), rad(state.rollDeg));
    const outline = roundFootOutline(state.mech.footOutline(zSole));
    const bottom = outline.map((point) => mulMatVec(rotation, point));
    const top = outline.map((point) => mulMatVec(rotation, add(point, [0, 0, FOOTPLATE_THICKNESS])));
    const ctx = this.ctx;

    ctx.fillStyle = '#c9d5e0';
    for (const [i, point] of bottom.entries()) {
      const next = (i + 1) % bottom.length;
      this.fillPath([point, bottom[next], top[next], top[i]]);
    }

    const topFacesViewer = this.cameraSpace(mulMatVec(rotation, [0, 0, 1]))[1] < 0;
    const face = topFacesViewer ? top : bottom;
    ctx.fillStyle = '#f1f5f8';
    this.fillPath(face);
    ctx.strokeStyle = '#70859b';
    ctx.lineWidth = 1;
    this.strokePath([...face, face[0]]);

    this.strokePath([[0, 0, 0], C1]);
    this.strokePath([[0, 0, 0], C2]);
    this.link(C1, C2, COLOR.platform, 3);
  }

  private drawMotorAxis(
    center: Vec3, axis: Vec3, zero: Vec3, tangent: Vec3, theta: number, crankLength: number, color: string
  ): void {
    const ctx = this.ctx;
    const radius = crankLength * 1.32;
    const at = (angle: number): Vec3 => add(center, add(
      scale(zero, radius * Math.cos(angle)),
      scale(tangent, radius * Math.sin(angle))
    ));

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.label;
    ctx.setLineDash([5, 3, 1, 3]);
    this.strokePath([add(center, scale(axis, -0.039)), add(center, scale(axis, 0.039))]);
    ctx.setLineDash([2, 3]);
    ctx.globalAlpha = 0.55;
    this.strokePath([center, at(0)]);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    this.strokePath(Array.from({ length: 17 }, (_, i) => at(theta * i / 16)));
    ctx.restore();
  }

  private arrow(from: Point, to: Point, color: string, width: number): void {
    const ctx = this.ctx;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    ctx.fillStyle = color;
    if (length < 3) {
      ctx.beginPath();
      ctx.arc(from.x, from.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const size = Math.min(7, length * 0.4);
    const ux = dx / length;
    const uy = dy / length;
    const head = { x: to.x - ux * size, y: to.y - uy * size };
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(head.x - uy * size * 0.46, head.y + ux * size * 0.46);
    ctx.lineTo(head.x + uy * size * 0.46, head.y - ux * size * 0.46);
    ctx.closePath();
    ctx.fill();
  }

  private drawOrientation(): LabelBox {
    const ctx = this.ctx;
    const box = { x: this.width - 100, y: 8, width: 92, height: 98 };
    const center = { x: box.x + 46, y: box.y + 43 };
    const axes: Array<[Vec3, string, string]> = [
      [[1, 0, 0], COLOR.frameX, 'X'],
      [[0, 1, 0], COLOR.frameY, 'Y'],
      [[0, 0, 1], COLOR.frameZ, 'Z']
    ];

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = '#e0e4e9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let axial: { color: string; text: string } | undefined;
    for (const [axis, color, label] of axes) {
      const [x, depth, z] = this.cameraSpace(axis);
      const length = Math.hypot(x, z);
      if (length < 0.24) {
        axial = { color, text: `${label} ${depth < 0 ? '⊙' : '⊗'}` };
        continue;
      }
      const tip = { x: center.x + 24 * x, y: center.y - 24 * z };
      this.arrow(center, tip, color, 1.5);
      ctx.fillStyle = color;
      ctx.fillText(label, tip.x + 8 * x / length, tip.y - 8 * z / length);
    }
    if (axial) {
      ctx.fillStyle = axial.color;
      ctx.fillText(axial.text, center.x, box.y + 72);
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = COLOR.label;
    ctx.fillText('机架轴向', center.x, box.y + 86);
    return box;
  }

  private drawForce(load: FootLoad, annotations: Annotation[]): void {
    if (load.Fz <= 0.5) return;
    const base: Vec3 = [load.x_cop, load.y_cop, load.z_sole];
    const tip = add(base, [0, 0, Math.min(0.14, load.Fz * 0.00018)]);
    const ctx = this.ctx;
    this.arrow(this.project(base), this.project(tip), COLOR.force, 2);
    annotations.push({ point: tip, text: `Fz ${Math.round(load.Fz)} N`, color: COLOR.force });
    const p = this.project(base);
    ctx.fillStyle = COLOR.force;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    annotations.push({ point: base, text: 'CoP', color: COLOR.force });
  }

  private drawAnnotations(annotations: Annotation[], reserved: LabelBox[]): void {
    const ctx = this.ctx;
    const projected = annotations.map((label) => ({ ...label, anchor: this.project(label.point) }));
    const anchors: LabelBox[] = projected.map(({ anchor }) => ({
      x: anchor.x - 6, y: anchor.y - 6, width: 12, height: 12
    }));
    const occupied = [...reserved, ...anchors];
    const placed: Array<{ anchor: Screen; text: string; color: string; box: LabelBox }> = [];
    ctx.font = '600 11px ui-monospace, "PingFang SC", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const label of projected) {
      const { anchor, color } = label;
      if (anchor.x < 0 || anchor.y < 0 || anchor.x > this.width || anchor.y > this.height) continue;
      const merged = projected.filter((other) =>
        other.text[0] === label.text[0] && /^[ABC][₁₂]$/.test(other.text) &&
        Math.hypot(other.anchor.x - anchor.x, other.anchor.y - anchor.y) < 5
      );
      if (merged.length > 1 && merged[0] !== label) continue;
      const text = merged.length > 1 ? merged.map((item) => item.text).join('/') : label.text;
      const width = Math.ceil(ctx.measureText(text).width) + 10;
      const height = 18;
      const sign = anchor.x < this.width / 2 ? -1 : 1;
      const offsets = [[sign, -0.55], [sign, 0.55], [-sign, -0.55], [-sign, 0.55], [0, -1], [0, 1]];
      const candidates = [10, 24, 42].flatMap((distance) => offsets.map(([dx, dy]) => ({
        x: anchor.x + dx * (distance + width / 2) - width / 2,
        y: anchor.y + dy * (distance + height / 2) - height / 2,
        width,
        height
      })));
      const box = candidates.find((b) =>
        b.x >= 4 && b.y >= 4 && b.x + width <= this.width - 4 && b.y + height <= this.height - 4 &&
        occupied.every((o) =>
          b.x + width + 3 <= o.x || b.x >= o.x + o.width + 3 ||
          b.y + height + 3 <= o.y || b.y >= o.y + o.height + 3
        )
      );
      if (!box) continue;
      occupied.push(box);
      placed.push({ anchor, text, color: merged.length > 1 ? COLOR.label : color, box });
    }

    for (const { anchor, box, color } of placed) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.48;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(box.x + box.width / 2, box.y + box.height / 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const { box, text, color } of placed) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#dbe2ea';
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.width, box.height, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2 + 0.5);
    }
  }
}
