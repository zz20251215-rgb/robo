import { add, cross, dot, mulMatVec, rad, scale, Vec3 } from '../core/math';
import { FOOTPLATE_THICKNESS, roundFootOutline } from './footplate';
import { rotationMatrix } from '../core/mechanism';
import { WorkbenchState } from '../state/model';

const screenX: Vec3 = [0.76, -0.91, 0];
const screenUp: Vec3 = [0.28, 0.22, 1];
const towardViewer = cross(screenX, screenUp);
const project = (point: Vec3): [number, number] => [
  158 + 510 * dot(screenX, point),
  181 - 510 * dot(screenUp, point)
];

const coord = (point: Vec3): string => project(point).map((v) => v.toFixed(2)).join(',');
const part = 'var(--part, #dbe5ee)';
const top = 'var(--part-top, #eef4f8)';
const side = 'var(--part-side, #afc4d6)';
const origin: Vec3 = [0, 0, 0];

function polygon(points: Vec3[], fill: string, stroke = 'currentColor'): string {
  return `<polygon points="${points.map(coord).join(' ')}" fill="${fill}" stroke="${stroke}"/>`;
}

function solid(base: Vec3[], cap: Vec3[], smooth = false): string {
  const walls = base.map((p, i) => {
    const j = (i + 1) % base.length;
    return polygon([p, base[j], cap[j], cap[i]], smooth || i % 2 === 0 ? side : part, smooth ? side : 'currentColor');
  });
  return walls.join('') + polygon(cap, top);
}

function box([x, y, z]: Vec3, dx: number, dy: number, dz: number): string {
  const base: Vec3[] = [[x, y, z], [x + dx, y, z], [x + dx, y + dy, z], [x, y + dy, z]];
  return solid(base, base.map(([px, py, pz]) => [px, py, pz + dz]));
}

function line(a: Vec3, b: Vec3, attrs = ''): string {
  return `<polyline points="${coord(a)} ${coord(b)}" fill="none" ${attrs}/>`;
}

function pin(point: Vec3, r: number, fill = top): string {
  const [x, y] = project(point);
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
}

function motor(
  center: Vec3, axis: Vec3, radial: Vec3, tangent: Vec3, housingSide: number
): string {
  const nearAngle = Math.atan2(dot(tangent, towardViewer), dot(radial, towardViewer));
  const cylinder = (start: number, end: number, radius: number): string => {
    const towardPositiveAxis = dot(axis, towardViewer) > 0;
    const near = towardPositiveAxis ? Math.max(start, end) : Math.min(start, end);
    const far = start + end - near;
    const ring = (station: number, steps: number, sweep: number): Vec3[] => {
      const face = add(center, scale(axis, station));
      return Array.from({ length: steps + 1 }, (_, i) => {
        const angle = nearAngle - Math.PI / 2 + sweep * i / steps;
        const offset = add(scale(radial, Math.cos(angle)), scale(tangent, Math.sin(angle)));
        return add(face, scale(offset, radius));
      });
    };
    const nearArc = ring(near, 16, Math.PI);
    const farArc = ring(far, 16, Math.PI);
    return polygon([...farArc, ...nearArc.reverse()], side) +
      polygon(ring(near, 32, 2 * Math.PI), top);
  };
  const housing = cylinder(0.01 * housingSide, 0.046 * housingSide, 0.019);
  const shaft = cylinder(0, 0.01 * housingSide, 0.0045);
  return dot(axis, towardViewer) * housingSide > 0 ? shaft + housing : housing + shaft;
}

function tag(point: Vec3, label: string, x: number, y: number): string {
  return `<polyline points="${coord(point)} ${x},${y} ${x + 15},${y}" fill="none" stroke-width=".7"/>
    <text x="${x + 19}" y="${y + 3.5}" fill="currentColor" stroke="none">${label}</text>`;
}

function link(a: Vec3, b: Vec3, width: number, fill: string): string {
  return line(a, b, `stroke-width="${width + 2}"`) +
    line(a, b, `stroke-width="${width}" stroke="${fill}"`);
}

/** Renders a projected assembly from the same joint centers as the ball-and-stick view. */
export class StructureView {
  private signature = '';

  constructor(
    private readonly art: SVGGElement,
    private readonly note: HTMLElement
  ) {}

  render(state: WorkbenchState): void {
    const { mech, params, pitchDeg, rollDeg, theta1Deg, theta2Deg, reachable, fkConverged, load } = state;
    const signature = JSON.stringify([params, pitchDeg, rollDeg, theta1Deg, theta2Deg, reachable, fkConverged, load.z_sole]);
    if (signature === this.signature) return;
    this.signature = signature;

    const pitch = rad(pitchDeg);
    const roll = rad(rollDeg);
    const rotation = rotationMatrix(pitch, roll);
    const { A1, A2, u1, u2, v1, v2, w1, w2, C1_P } = mech.geometry;
    const { B1, B2 } = mech.crankTips(rad(theta1Deg), rad(theta2Deg));
    const { C1, C2 } = mech.platformPoints(pitch, roll);
    const shankHeight = Math.max(A1[2], A2[2]) + 0.035;
    const sole = roundFootOutline(mech.footOutline(load.z_sole));
    const platform = solid(
      sole.map((p) => mulMatVec(rotation, p)),
      sole.map(([x, y, z]) => mulMatVec(rotation, [x, y, z + FOOTPLATE_THICKNESS])),
      true
    );
    const crossbar = link(C1, C2, 7, side) + link(
      mulMatVec(rotation, [C1_P[0], 0, C1_P[2]]),
      mulMatVec(rotation, [C1_P[0], 0, load.z_sole + FOOTPLATE_THICKNESS]),
      8, part
    );
    const shank = box([-0.014, -0.014, 0.013], 0.028, 0.028, shankHeight - 0.013);
    const lowerYoke = link(origin, mulMatVec(rotation, [0, 0, load.z_sole + FOOTPLATE_THICKNESS]), 9, side);
    const universal = link([0, -0.018, 0], [0, 0.018, 0], 5, part) +
      link(mulMatVec(rotation, [-0.015, 0, 0]), mulMatVec(rotation, [0.015, 0, 0]), 5, top) +
      pin(origin, 4, side);
    const chain = (
      a: Vec3, b: Vec3, c: Vec3, axis: Vec3, radial: Vec3, tangent: Vec3,
      housingSide: number, color: string
    ): string => {
      const bracketHeight = a[2] + 0.016;
      const mount: Vec3 = [0, 0, bracketHeight];
      const elbow: Vec3 = [a[0], 0, bracketHeight];
      const housingMount = add(add(a, [0, 0, 0.016]), scale(axis, 0.024 * housingSide));
      const rod = reachable ? link(b, c, 4, color) : line(b, c, 'stroke-dasharray="4 4"');
      return link(mount, elbow, 9, side) + link(elbow, housingMount, 9, part) +
        motor(a, axis, radial, tangent, housingSide) +
        link(a, b, 9, color) + rod + pin(a, 4, top) + pin(b, 5, top) + pin(c, 5, top);
    };
    const axisLine = (a: Vec3, axis: Vec3, housingSide: number): string => line(
      add(a, scale(axis, -0.019 * housingSide)),
      add(a, scale(axis, 0.055 * housingSide)),
      'stroke-dasharray="5 2 1 2" stroke-width="1"'
    );
    const labelY = Math.max(15, Math.min(project(A1)[1], project(A2)[1]) - 13);

    this.art.innerHTML = `<g stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round">
      <ellipse cx="154" cy="213" rx="75" ry="9" fill="currentColor" opacity=".06" stroke="none"/>
      ${platform}${lowerYoke}${crossbar}
      ${chain(A1, B1, C1, u1, v1, w1, 1, 'color-mix(in srgb, var(--chain-1) 55%, white)')}
      ${shank}${universal}
      ${chain(A2, B2, C2, u2, v2, w2, -1, 'color-mix(in srgb, var(--chain-2) 55%, white)')}
      ${axisLine(A1, u1, 1)}${axisLine(A2, u2, -1)}
      <g font-family="ui-monospace, monospace" font-size="11" font-weight="600">
        ${tag(A1, 'A₁', 49, labelY)}
        ${tag(A2, 'A₂', 234, labelY + 14)}
        ${tag(B1, 'B₁', 43, Math.min(140, project(B1)[1] + 8))}
        ${tag(B2, 'B₂', 239, Math.min(153, project(B2)[1] + 8))}
        ${tag(C1, 'C₁', 47, 204)}
        ${tag(C2, 'C₂', 239, 205)}
        ${tag(origin, 'U', 239, 175)}
      </g>
    </g>`;
    this.note.dataset.invalid = String(!reachable);
    this.note.textContent = reachable
      ? '点划线为电机轴线（平行 Y）· 壳体外形为示意'
      : fkConverged
        ? '当前位形无装配解 · 虚线为未闭合支链'
        : '正运动学未收敛 · 虚线为未确认支链';
  }
}
