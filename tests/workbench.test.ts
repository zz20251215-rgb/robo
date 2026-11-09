import { expect, it } from 'vitest';
import { Workbench } from '../src/state/model';
import { poseLevelAt, scanWorkspaceSlice } from '../src/core/workspace';

it('stops a pad drag at the reachable edge and resumes when it moves inward', () => {
  const workbench = new Workbench();
  workbench.setPadPose(-30, 0);

  const edge = workbench.state.pitchDeg;
  expect(workbench.state.reachable).toBe(true);
  expect(edge).toBeGreaterThan(-21);
  expect(edge).toBeLessThan(-20);

  workbench.setPadPose(-30, 0);
  expect(workbench.state.pitchDeg).toBeCloseTo(edge, 3);
  workbench.setPadPose(-10, 0);
  expect(workbench.state.pitchDeg).toBe(-10);

  workbench.setPose(-30, 0);
  expect(workbench.state.reachable).toBe(false);
  workbench.setPadPose(0, 0);
  expect(workbench.state.reachable).toBe(true);
});

it('reports separate reachable and normal intervals for a geometry-dependent workspace slice', () => {
  const workbench = new Workbench();
  const slice = () => scanWorkspaceSlice((pitch) => poseLevelAt(workbench.mech, pitch, 0), -30, 25);
  const baseline = slice();
  expect(baseline.reachable[0].min).toBeCloseTo(-20.4, 0);
  expect(baseline.reachable[0].max).toBe(25);
  expect(baseline.healthy[0].max).toBeLessThan(baseline.reachable[0].max);

  workbench.setParams({ l_crank1: 0.055, l_crank2: 0.055 });
  expect(slice()).not.toEqual(baseline);
});

it('does not bridge disconnected or empty workspace intervals', () => {
  const slice = scanWorkspaceSlice((angle) => {
    if (angle < -2 || angle > 2) return 'healthy';
    if (angle < -1 || angle > 1) return 'caution';
    return 'unreachable';
  }, -4, 4);

  expect(slice.reachable).toHaveLength(2);
  expect(slice.healthy).toHaveLength(2);
  expect(slice.reachable[0].max).toBeCloseTo(-1, 3);
  expect(slice.reachable[1].min).toBeCloseTo(1, 3);
  expect(scanWorkspaceSlice(() => 'unreachable', -4, 4)).toEqual({ reachable: [], healthy: [] });
});
