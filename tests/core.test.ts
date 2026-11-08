import { describe, expect, it } from 'vitest';
import reference from './fixtures/legacy-reference.json';
import { AnkleMechanism, DEFAULT_LOAD } from '../src/core/mechanism';
import { computeCurves } from '../src/core/curves';

const DEG = Math.PI / 180;
const mech = new AnkleMechanism();

/**
 * The legacy model divides the transmission-angle cosine by (|v| + 1e-9),
 * which biases mu by a few micro-degrees. Every other quantity is compared
 * down to floating-point noise.
 */
describe('numerical parity with the pre-refactor model', () => {
  it('neutral motor angle', () => {
    expect(mech.neutralAngles().theta1 / DEG).toBeCloseTo(reference.neutralThetaDeg, 9);
  });

  for (const pose of reference.poses) {
    it(`pose pitch ${pose.pitchDeg} roll ${pose.rollDeg}`, () => {
      const ik = mech.solveIK(pose.pitchDeg * DEG, pose.rollDeg * DEG);
      expect(ik.ok).toBe(pose.ikOk);
      if (!ik.ok || !pose.ikOk) return;

      expect(ik.theta1 / DEG).toBeCloseTo(pose.theta1Deg as number, 8);
      expect(ik.theta2 / DEG).toBeCloseTo(pose.theta2Deg as number, 8);

      const statics = mech.statics(pose.pitchDeg * DEG, pose.rollDeg * DEG, ik.theta1, ik.theta2, DEFAULT_LOAD);
      expect(statics.kind === 'singular').toBe(pose.singular);
      expect(statics.mu1Deg).toBeCloseTo(pose.mu1Deg as number, 5);
      expect(statics.mu2Deg).toBeCloseTo(pose.mu2Deg as number, 5);
      if (statics.kind === 'ok') {
        expect(statics.cond).toBeCloseTo(pose.cond as number, 7);
        expect(statics.tauM1).toBeCloseTo(pose.tauM1 as number, 7);
        expect(statics.tauM2).toBeCloseTo(pose.tauM2 as number, 7);
        expect(statics.fRod1).toBeCloseTo(pose.fRod1 as number, 6);
        expect(statics.fRod2).toBeCloseTo(pose.fRod2 as number, 6);
      }
    });
  }

  it('round-trips inverse and forward kinematics', () => {
    for (const row of reference.fk) {
      const ik = mech.solveIK(row.pitchDeg * DEG, row.rollDeg * DEG);
      expect(ik.ok).toBe(true);
      if (!ik.ok) continue;
      const fk = mech.solveFK(ik.theta1, ik.theta2, 0, 0);
      expect(fk.ok).toBe(true);
      expect(fk.pitch / DEG).toBeCloseTo(row.fkPitchDeg, 6);
      expect(fk.roll / DEG).toBeCloseTo(row.fkRollDeg, 6);
    }
  });

  it('reproduces the analytical curve sweep', () => {
    const curves = computeCurves(mech, { roll: 0, load: DEFAULT_LOAD });
    expect(curves.theta1).toHaveLength(reference.curve.length);
    reference.curve.forEach((expected, index) => {
      const theta = curves.theta1[index];
      const tau = curves.tau1[index];
      const mu = curves.mu1[index];
      const cond = curves.cond[index];
      expect(theta.pitchDeg).toBe(expected.pitchDeg);
      if (expected.theta1Deg === null) {
        expect(theta.value).toBeNull();
        expect(tau.value).toBeNull();
        expect(mu.value).toBeNull();
        expect(cond.value).toBe(expected.cond === 100 ? 100 : null);
      } else {
        expect(theta.value as number).toBeCloseTo(expected.theta1Deg, 7);
        expect(tau.value as number).toBeCloseTo(expected.tauM1 as number, 7);
        expect(mu.value as number).toBeCloseTo(expected.mu1Deg as number, 5);
        expect(cond.value as number).toBeCloseTo(expected.cond as number, 7);
      }
    });
  });
});
