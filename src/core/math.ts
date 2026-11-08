export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];
export type Mat2 = [[number, number], [number, number]];
/** 3x2 matrix, column-major access is done explicitly at the call site. */
export type Mat32 = [[number, number], [number, number], [number, number]];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];

export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export const unit = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};

/** Row-major matrix times column vector. */
export const mulMatVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
];

export const det2 = (m: Mat2): number => m[0][0] * m[1][1] - m[0][1] * m[1][0];

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const deg = (rad: number): number => (rad * 180) / Math.PI;

export const rad = (degree: number): number => (degree * Math.PI) / 180;

/** Singular values of a 2x2 matrix, descending. */
export function singularValues2(m: Mat2): [number, number] {
  const [a, b] = m[0];
  const [c, d] = m[1];
  const sumSq = a * a + b * b + c * c + d * d;
  const disc = Math.sqrt(Math.max(0, (a * a + b * b - c * c - d * d) ** 2 + 4 * (a * c + b * d) ** 2));
  const s1 = Math.sqrt(0.5 * (sumSq + disc));
  const s2 = Math.sqrt(Math.max(0, 0.5 * (sumSq - disc)));
  return [s1, s2];
}
