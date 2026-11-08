import {
  Vec3,
  Mat2,
  Mat3,
  add,
  sub,
  scale,
  dot,
  cross,
  norm,
  mulMatVec,
  singularValues2,
  det2,
  clamp,
  deg
} from './math';

export interface MechanismParams {
  w_base: number;
  h_base: number;
  x_base: number;
  l_crank: number;
  l_rod: number;
  w_foot: number;
  x_foot: number;
  z_foot: number;
}

export const DEFAULT_PARAMS: MechanismParams = {
  w_base: 0.07,
  h_base: 0.18,
  x_base: -0.04,
  l_crank: 0.045,
  l_rod: 0.165,
  w_foot: 0.06,
  x_foot: -0.03,
  z_foot: -0.02
};

export interface FootLoad {
  Fz: number;
  Fx: number;
  Fy: number;
  x_cop: number;
  y_cop: number;
  z_sole: number;
}

export const DEFAULT_LOAD: FootLoad = {
  Fz: 500,
  Fx: 0,
  Fy: 0,
  x_cop: 0.08,
  y_cop: 0,
  z_sole: -0.06
};

export interface MechanismGeometry {
  A1: Vec3;
  A2: Vec3;
  u1: Vec3;
  u2: Vec3;
  v1: Vec3;
  v2: Vec3;
  w1: Vec3;
  w2: Vec3;
  C1_P: Vec3;
  C2_P: Vec3;
}

/** Lever arms shorter than this are treated as a dead-centre singularity. */
export const DEAD_CENTRE_LEVER = 0.002;
/** Task Jacobian determinants below this are treated as architectural singularities. */
export const ARCHITECTURAL_DET = 1e-5;
/** Actuator Jacobian determinants below this are rejected numerically. */
export const SINGULAR_DET = 1e-6;

export type FKResult = {
  ok: boolean;
  pitch: number;
  roll: number;
  residual: number;
  iterations: number;
};

export type IKResult =
  | { ok: true; theta1: number; theta2: number; disc1: number; disc2: number }
  | { ok: false; disc1: number; disc2: number; failedChains: 1 | 2 | 'both' };

export interface StaticsFrame {
  pitch: number;
  roll: number;
  C1: Vec3;
  C2: Vec3;
  B1: Vec3;
  B2: Vec3;
  rod1: Vec3;
  rod2: Vec3;
  n1: Vec3;
  n2: Vec3;
  /** Normalised lever arm of each crank. */
  lever1: number;
  lever2: number;
  mu1Deg: number;
  mu2Deg: number;
  /** Crank tip velocity direction, per unit angular rate. */
  crankDir1: Vec3;
  crankDir2: Vec3;
}

export interface StaticsOk extends StaticsFrame {
  kind: 'ok';
  JTask: Mat2;
  JTheta: Mat2;
  detJTask: number;
  detJ: number;
  cond: number;
  tauPitch: number;
  tauRoll: number;
  tauM1: number;
  tauM2: number;
  fRod1: number;
  fRod2: number;
}

export interface StaticsSingular extends StaticsFrame {
  kind: 'singular';
  reason: 'dead-centre' | 'architecture';
  detJTask: number;
  cond: number;
}

export type Statics = StaticsOk | StaticsSingular;

function deriveGeometry(p: MechanismParams): MechanismGeometry {
  const A1: Vec3 = [p.x_base, p.w_base / 2, p.h_base];
  const A2: Vec3 = [p.x_base, -p.w_base / 2, p.h_base];
  const u1: Vec3 = [0, 1, 0];
  const u2: Vec3 = [0, 1, 0];
  const v1: Vec3 = [0, 0, -1];
  const v2: Vec3 = [0, 0, -1];
  const w1: Vec3 = cross(u1, v1);
  const w2: Vec3 = cross(u2, v2);
  const C1_P: Vec3 = [p.x_foot, p.w_foot / 2, p.z_foot];
  const C2_P: Vec3 = [p.x_foot, -p.w_foot / 2, p.z_foot];
  return { A1, A2, u1, u2, v1, v2, w1, w2, C1_P, C2_P };
}

/** Rotation Ry(pitch) * Rx(roll) in row-major form. */
export function rotationMatrix(pitch: number, roll: number): Mat3 {
  const ca = Math.cos(pitch);
  const sa = Math.sin(pitch);
  const cb = Math.cos(roll);
  const sb = Math.sin(roll);
  return [
    [ca, sa * sb, sa * cb],
    [0, cb, -sb],
    [-sa, ca * sb, ca * cb]
  ];
}

function solveChainIK(
  C: Vec3,
  A: Vec3,
  v: Vec3,
  w: Vec3,
  lCrank: number,
  lRod: number
): { ok: boolean; theta: number; disc: number } {
  const D = sub(C, A);
  const E = -2 * lCrank * dot(D, v);
  const F = -2 * lCrank * dot(D, w);
  const G = dot(D, D) + lCrank * lCrank - lRod * lRod;
  const disc = 4 * F * F - 4 * (G - E) * (G + E);
  if (disc < 0) return { ok: false, theta: 0, disc };

  const root = Math.sqrt(disc);
  const a = G - E;
  const b = 2 * F;
  const c = G + E;

  let t1: number;
  let t2: number;
  if (Math.abs(a) > 1e-9) {
    t1 = (-b + root) / (2 * a);
    t2 = (-b - root) / (2 * a);
  } else if (Math.abs(b) > 1e-9) {
    t1 = -c / b;
    t2 = t1;
  } else {
    return { ok: false, theta: 0, disc };
  }

  const theta1 = 2 * Math.atan(t1);
  const theta2 = 2 * Math.atan(t2);
  return { ok: true, theta: Math.abs(theta1) <= Math.abs(theta2) ? theta1 : theta2, disc };
}

/**
 * Closed-form inverse kinematics for the 2-RSS + 1-U ankle.
 * Branch selection keeps the crank closest to its zero position.
 */
export class AnkleMechanism {
  params: MechanismParams;
  geometry: MechanismGeometry;

  constructor(params: MechanismParams = DEFAULT_PARAMS) {
    this.params = { ...params };
    this.geometry = deriveGeometry(this.params);
  }

  setParams(patch: Partial<MechanismParams>): void {
    this.params = { ...this.params, ...patch };
    this.geometry = deriveGeometry(this.params);
  }

  platformPoints(pitch: number, roll: number): { C1: Vec3; C2: Vec3 } {
    const R = rotationMatrix(pitch, roll);
    return {
      C1: mulMatVec(R, this.geometry.C1_P),
      C2: mulMatVec(R, this.geometry.C2_P)
    };
  }

  crankTips(theta1: number, theta2: number): { B1: Vec3; B2: Vec3 } {
    const { A1, A2, u1, u2, v1, v2, w1, w2 } = this.geometry;
    const tip = (A: Vec3, v: Vec3, w: Vec3, theta: number): Vec3 =>
      add(A, add(scale(v, this.params.l_crank * Math.cos(theta)), scale(w, this.params.l_crank * Math.sin(theta))));
    return { B1: tip(A1, v1, w1, theta1), B2: tip(A2, v2, w2, theta2) };
  }

  /** Foot sole outline in platform coordinates. */
  footOutline(zSole: number): Vec3[] {
    return [
      [-0.07, -0.035, zSole],
      [-0.07, 0.035, zSole],
      [0.04, 0.038, zSole],
      [0.13, 0.025, zSole],
      [0.13, -0.025, zSole],
      [0.05, -0.035, zSole]
    ];
  }

  solveIK(pitch: number, roll: number): IKResult {
    const { C1, C2 } = this.platformPoints(pitch, roll);
    const { A1, A2, v1, v2, w1, w2 } = this.geometry;
    const p = this.params;
    const r1 = solveChainIK(C1, A1, v1, w1, p.l_crank, p.l_rod);
    const r2 = solveChainIK(C2, A2, v2, w2, p.l_crank, p.l_rod);

    if (r1.ok && r2.ok) {
      return { ok: true, theta1: r1.theta, theta2: r2.theta, disc1: r1.disc, disc2: r2.disc };
    }
    const failedChains = r1.ok ? 2 : r2.ok ? 1 : 'both';
    return { ok: false, disc1: r1.disc, disc2: r2.disc, failedChains };
  }

  /**
   * Newton-Raphson forward kinematics on the two rod-length residuals.
   * Reports convergence instead of assuming success.
   */
  solveFK(theta1: number, theta2: number, guessPitch = 0, guessRoll = 0): FKResult {
    const { B1, B2 } = this.crankTips(theta1, theta2);
    const lRodSq = this.params.l_rod * this.params.l_rod;
    let pitch = guessPitch;
    let roll = guessRoll;
    let iterations = 0;
    let residual = Infinity;

    for (let i = 0; i < 24; i++) {
      iterations = i + 1;
      const { C1, C2 } = this.platformPoints(pitch, roll);
      const f1 = dot(sub(C1, B1), sub(C1, B1)) - lRodSq;
      const f2 = dot(sub(C2, B2), sub(C2, B2)) - lRodSq;
      residual = Math.max(Math.abs(f1), Math.abs(f2));
      if (residual < 1e-10) return { ok: true, pitch, roll, residual, iterations };

      const eps = 1e-6;
      const plus = this.platformPoints(pitch + eps, roll);
      const minus = this.platformPoints(pitch - eps, roll);
      const dp1 = (dot(sub(plus.C1, B1), sub(plus.C1, B1)) - dot(sub(minus.C1, B1), sub(minus.C1, B1))) / (2 * eps);
      const dp2 = (dot(sub(plus.C2, B2), sub(plus.C2, B2)) - dot(sub(minus.C2, B2), sub(minus.C2, B2))) / (2 * eps);
      const rp = this.platformPoints(pitch, roll + eps);
      const rm = this.platformPoints(pitch, roll - eps);
      const dr1 = (dot(sub(rp.C1, B1), sub(rp.C1, B1)) - dot(sub(rm.C1, B1), sub(rm.C1, B1))) / (2 * eps);
      const dr2 = (dot(sub(rp.C2, B2), sub(rp.C2, B2)) - dot(sub(rm.C2, B2), sub(rm.C2, B2))) / (2 * eps);

      const det = dp1 * dr2 - dr1 * dp2;
      if (Math.abs(det) < 1e-12) break;
      const dPitch = (dr2 * f1 - dr1 * f2) / det;
      const dRoll = (-dp2 * f1 + dp1 * f2) / det;
      pitch = clamp(pitch - clamp(dPitch, -0.35, 0.35), -1.2, 1.2);
      roll = clamp(roll - clamp(dRoll, -0.35, 0.35), -1.2, 1.2);
    }

    return { ok: residual < 1e-8, pitch, roll, residual, iterations };
  }

  /**
   * Jacobian and static force mapping at a pose.
   * Singular configurations return a discriminated `singular` result instead of
   * partially-filled frames, so callers cannot read undefined torques.
   */
  statics(pitch: number, roll: number, theta1: number, theta2: number, load: FootLoad = DEFAULT_LOAD): Statics {
    const { A1, A2, u1, u2 } = this.geometry;
    const { C1, C2 } = this.platformPoints(pitch, roll);
    const { B1, B2 } = this.crankTips(theta1, theta2);

    const rod1 = sub(C1, B1);
    const rod2 = sub(C2, B2);
    const len1 = norm(rod1);
    const len2 = norm(rod2);
    const n1 = len1 > 0 ? scale(rod1, 1 / len1) : rod1;
    const n2 = len2 > 0 ? scale(rod2, 1 / len2) : rod2;

    const ca = Math.cos(pitch);
    const sa = Math.sin(pitch);
    // Columns map (pitch rate, roll rate) onto the platform angular velocity.
    const colPitch: Vec3 = [0, 1, 0];
    const colRoll: Vec3 = [ca, 0, -sa];

    const arm1 = cross(C1, n1);
    const arm2 = cross(C2, n2);
    const JTask: Mat2 = [
      [dot(arm1, colPitch), dot(arm1, colRoll)],
      [dot(arm2, colPitch), dot(arm2, colRoll)]
    ];

    const crankDir1 = cross(u1, sub(B1, A1));
    const crankDir2 = cross(u2, sub(B2, A2));
    const lever1 = dot(n1, crankDir1);
    const lever2 = dot(n2, crankDir2);
    const mu1Deg = deg(Math.acos(clamp(Math.abs(lever1) / Math.max(norm(crankDir1), 1e-12), 0, 1)));
    const mu2Deg = deg(Math.acos(clamp(Math.abs(lever2) / Math.max(norm(crankDir2), 1e-12), 0, 1)));
    const detJTask = det2(JTask);

    const frame: StaticsFrame = {
      pitch,
      roll,
      C1,
      C2,
      B1,
      B2,
      rod1,
      rod2,
      n1,
      n2,
      lever1,
      lever2,
      mu1Deg,
      mu2Deg,
      crankDir1,
      crankDir2
    };

    if (Math.abs(lever1) < DEAD_CENTRE_LEVER || Math.abs(lever2) < DEAD_CENTRE_LEVER) {
      return { ...frame, kind: 'singular', reason: 'dead-centre', detJTask, cond: 999 };
    }

    const JTheta: Mat2 = [
      [JTask[0][0] / lever1, JTask[0][1] / lever1],
      [JTask[1][0] / lever2, JTask[1][1] / lever2]
    ];
    const detJ = det2(JTheta);

    if (Math.abs(detJTask) < ARCHITECTURAL_DET || Math.abs(detJ) < SINGULAR_DET) {
      return { ...frame, kind: 'singular', reason: 'architecture', detJTask, cond: 999 };
    }

    const [sigma1, sigma2] = singularValues2(JTheta);
    const cond = sigma2 < 1e-6 ? 999 : sigma1 / sigma2;

    const force: Vec3 = [load.Fx, load.Fy, load.Fz];
    const rCop: Vec3 = [load.x_cop, load.y_cop, load.z_sole];
    const moment: Vec3 = cross(rCop, force);
    const tauPitch = dot(moment, colPitch);
    const tauRoll = dot(moment, colRoll);

    const invDet = 1 / detJ;
    const JInvT: Mat2 = [
      [JTheta[1][1] * invDet, -JTheta[1][0] * invDet],
      [-JTheta[0][1] * invDet, JTheta[0][0] * invDet]
    ];
    const tauM1 = JInvT[0][0] * tauPitch + JInvT[0][1] * tauRoll;
    const tauM2 = JInvT[1][0] * tauPitch + JInvT[1][1] * tauRoll;

    return {
      ...frame,
      kind: 'ok',
      JTask,
      JTheta,
      detJTask,
      detJ,
      cond,
      tauPitch,
      tauRoll,
      tauM1,
      tauM2,
      fRod1: tauM1 / lever1,
      fRod2: tauM2 / lever2
    };
  }

  /** Motor angles at the neutral (foot-flat) pose. */
  neutralAngles(): { theta1: number; theta2: number } {
    const ik = this.solveIK(0, 0);
    return ik.ok ? { theta1: ik.theta1, theta2: ik.theta2 } : { theta1: 0, theta2: 0 };
  }
}
