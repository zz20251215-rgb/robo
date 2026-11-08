import { describe, expect, it } from 'vitest';
import reference from './fixtures/legacy-reference.json';
import { AnkleMechanism, ChainParams, DEFAULT_LOAD, DEFAULT_PARAMS, MechanismParams } from '../src/core/mechanism';
import { computeCurves } from '../src/core/curves';
import { Workbench } from '../src/state/model';

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

const mirror = (c: ChainParams): ChainParams => ({
  base: [c.base[0], -c.base[1], c.base[2]],
  crank: c.crank,
  rod: c.rod,
  anchor: [c.anchor[0], -c.anchor[1], c.anchor[2]]
});

/** Chain B is deliberately different in every dimension. */
const ASYMMETRIC: MechanismParams = {
  chainA: DEFAULT_PARAMS.chainA,
  chainB: {
    base: [-0.035, -0.03, 0.18],
    crank: 0.052,
    rod: 0.175,
    anchor: [-0.036, -0.026, -0.02]
  }
};

describe('independent chains', () => {
  const asym = new AnkleMechanism(ASYMMETRIC);

  it('gives each chain its own neutral angle and IK branch', () => {
    const neutral = asym.neutralAngles();
    expect(Math.abs(neutral.theta1 - neutral.theta2)).toBeGreaterThan(0.002);

    const ik = asym.solveIK(10 * DEG, 3 * DEG);
    const referenceIk = mech.solveIK(10 * DEG, 3 * DEG);
    expect(ik.ok && referenceIk.ok).toBe(true);
    if (!ik.ok || !referenceIk.ok) return;
    expect(ik.theta1).toBeCloseTo(referenceIk.theta1, 12);
    expect(Math.abs(ik.theta2 - referenceIk.theta2)).toBeGreaterThan(1e-4);
  });

  it('round-trips FK with unequal crank and rod lengths', () => {
    for (const [pitchDeg, rollDeg] of [
      [10, 3],
      [0, 0],
      [-12, -6]
    ]) {
      const ik = asym.solveIK(pitchDeg * DEG, rollDeg * DEG);
      expect(ik.ok).toBe(true);
      if (!ik.ok) continue;
      const fk = asym.solveFK(ik.theta1, ik.theta2);
      expect(fk.ok).toBe(true);
      expect(fk.pitch / DEG).toBeCloseTo(pitchDeg, 7);
      expect(fk.roll / DEG).toBeCloseTo(rollDeg, 7);
    }
  });

  it('matches the analytic Jacobian against finite differences', () => {
    const pitch = 5 * DEG;
    const roll = 0;
    const ik = asym.solveIK(pitch, roll);
    expect(ik.ok).toBe(true);
    if (!ik.ok) return;
    const statics = asym.statics(pitch, roll, ik.theta1, ik.theta2);
    expect(statics.kind).toBe('ok');
    if (statics.kind !== 'ok') return;

    const h = 1e-6;
    const pitchPlus = asym.solveIK(pitch + h, roll);
    const pitchMinus = asym.solveIK(pitch - h, roll);
    const rollPlus = asym.solveIK(pitch, roll + h);
    const rollMinus = asym.solveIK(pitch, roll - h);
    expect(pitchPlus.ok && pitchMinus.ok && rollPlus.ok && rollMinus.ok).toBe(true);
    if (!pitchPlus.ok || !pitchMinus.ok || !rollPlus.ok || !rollMinus.ok) return;

    const numeric = [
      [(pitchPlus.theta1 - pitchMinus.theta1) / (2 * h), (rollPlus.theta1 - rollMinus.theta1) / (2 * h)],
      [(pitchPlus.theta2 - pitchMinus.theta2) / (2 * h), (rollPlus.theta2 - rollMinus.theta2) / (2 * h)]
    ];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        expect(statics.JTheta[row][col]).toBeCloseTo(numeric[row][col], 5);
      }
    }
  });

  it('is unchanged when both chains are mirrored and swapped', () => {
    const mirrored = new AnkleMechanism({ chainA: mirror(ASYMMETRIC.chainB), chainB: mirror(ASYMMETRIC.chainA) });
    const pitch = 8 * DEG;
    const ikA = asym.solveIK(pitch, 0);
    const ikB = mirrored.solveIK(pitch, 0);
    expect(ikA.ok && ikB.ok).toBe(true);
    if (!ikA.ok || !ikB.ok) return;

    const a = asym.statics(pitch, 0, ikA.theta1, ikA.theta2);
    const b = mirrored.statics(pitch, 0, ikB.theta1, ikB.theta2);
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    if (a.kind !== 'ok' || b.kind !== 'ok') return;
    expect(a.mu1Deg).toBeCloseTo(b.mu2Deg, 9);
    expect(a.mu2Deg).toBeCloseTo(b.mu1Deg, 9);
    expect(a.tauM1).toBeCloseTo(b.tauM2, 9);
    expect(a.cond).toBeCloseTo(b.cond, 10);
    expect(a.fRod1).toBeCloseTo(b.fRod2, 7);
  });
});

describe('workbench parameter isolation', () => {
  it('starts from mirrored chains with the B motor mounted lower', () => {
    const wb = new Workbench();
    const { chainA, chainB } = wb.state.params;
    expect(chainA.base[2] - chainB.base[2]).toBeCloseTo(0.005, 12);
    expect(chainA.base[1]).toBeCloseTo(-chainB.base[1], 12);
    expect(chainA.anchor[1]).toBeCloseTo(-chainB.anchor[1], 12);
    expect(chainA.crank).toBe(chainB.crank);
    expect(wb.state.level).not.toBe('unreachable');
  });

  it('edits one chain without touching the other', () => {
    const wb = new Workbench();
    const before = wb.state.params.chainB.crank;
    wb.setChainParam('A', 'crank', 0.05);
    expect(wb.state.params.chainA.crank).toBe(0.05);
    expect(wb.state.params.chainB.crank).toBe(before);
  });

  it('mirrors every field when linking is enabled', () => {
    const wb = new Workbench();
    wb.setLinkChains(true);
    wb.setChainParam('A', 'crank', 0.05);
    wb.setChainParam('A', 'baseY', 0.042);
    wb.setChainParam('A', 'anchorY', 0.026);
    wb.setChainParam('A', 'baseX', -0.03);
    expect(wb.state.params.chainB.crank).toBe(0.05);
    expect(wb.state.params.chainB.base[1]).toBeCloseTo(-0.042, 12);
    expect(wb.state.params.chainB.anchor[1]).toBeCloseTo(-0.026, 12);
    expect(wb.state.params.chainB.base[0]).toBe(-0.03);
  });

  it('keeps a shared height on both chains', () => {
    const wb = new Workbench();
    wb.setSharedParam('anchorHeight', -0.015);
    expect(wb.state.params.chainA.anchor[2]).toBe(-0.015);
    expect(wb.state.params.chainB.anchor[2]).toBe(-0.015);
  });
});
