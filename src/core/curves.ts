import { AnkleMechanism, FootLoad, Statics, DEFAULT_LOAD } from './mechanism';

export interface CurvePoint {
  pitchDeg: number;
  value: number | null;
}

export interface CurveSeries {
  theta1: CurvePoint[];
  theta2: CurvePoint[];
  tau1: CurvePoint[];
  tau2: CurvePoint[];
  mu1: CurvePoint[];
  mu2: CurvePoint[];
  cond: CurvePoint[];
}

export const CURVE_KEYS = ['theta1', 'theta2', 'tau1', 'tau2', 'mu1', 'mu2', 'cond'] as const;

export interface CurveOptions {
  roll: number;
  load?: FootLoad;
  angleMode?: 'abs' | 'rel';
  fromDeg?: number;
  toDeg?: number;
  stepDeg?: number;
}

const DEG = Math.PI / 180;

/**
 * Sweeps foot pitch and records motor angles, torques, transmission angles and
 * the actuator Jacobian condition number. Unreachable and singular poses are
 * emitted as null samples so charts break the line instead of interpolating.
 */
export function computeCurves(mech: AnkleMechanism, options: CurveOptions): CurveSeries {
  const { roll, load = DEFAULT_LOAD, angleMode = 'abs', fromDeg = -30, toDeg = 25, stepDeg = 1 } = options;
  const neutral = mech.neutralAngles();
  const series: CurveSeries = {
    theta1: [],
    theta2: [],
    tau1: [],
    tau2: [],
    mu1: [],
    mu2: [],
    cond: []
  };

  const shift1 = (theta: number): number => (angleMode === 'rel' ? theta - neutral.theta1 : theta);
  const shift2 = (theta: number): number => (angleMode === 'rel' ? theta - neutral.theta2 : theta);

  for (let pitchDeg = fromDeg; pitchDeg <= toDeg + 1e-9; pitchDeg += stepDeg) {
    const pitch = pitchDeg * DEG;
    const ik = mech.solveIK(pitch, roll);
    const point = (value: number | null): CurvePoint => ({ pitchDeg, value });

    if (!ik.ok) {
      series.theta1.push(point(null));
      series.theta2.push(point(null));
      series.tau1.push(point(null));
      series.tau2.push(point(null));
      series.mu1.push(point(null));
      series.mu2.push(point(null));
      series.cond.push(point(null));
      continue;
    }

    const statics = mech.statics(pitch, roll, ik.theta1, ik.theta2, load);
    const singular = statics.kind === 'singular';

    series.theta1.push(point(singular ? null : shift1(ik.theta1) / DEG));
    series.theta2.push(point(singular ? null : shift2(ik.theta2) / DEG));
    series.mu1.push(point(singular ? null : statics.mu1Deg));
    series.mu2.push(point(singular ? null : statics.mu2Deg));
    series.tau1.push(point(statics.kind === 'singular' ? null : statics.tauM1));
    series.tau2.push(point(statics.kind === 'singular' ? null : statics.tauM2));
    series.cond.push(point(statics.kind === 'singular' ? 100 : statics.cond));
  }

  return series;
}
