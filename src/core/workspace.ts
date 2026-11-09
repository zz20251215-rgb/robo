import { classify, PoseLevel } from './assessment';
import { rad } from './math';
import { AnkleMechanism } from './mechanism';

export interface AngleInterval {
  min: number;
  max: number;
}

export interface WorkspaceSlice {
  reachable: AngleInterval[];
  healthy: AngleInterval[];
}

/** The diagnostic thresholds depend on mechanism geometry and pose, rather than applied force. */
export function poseLevelAt(mech: AnkleMechanism, pitchDeg: number, rollDeg: number): PoseLevel {
  const pitch = rad(pitchDeg);
  const roll = rad(rollDeg);
  const ik = mech.solveIK(pitch, roll);
  return classify(ik.ok ? mech.statics(pitch, roll, ik.theta1, ik.theta2) : null);
}

/** Find each contiguous interval in a slice, refining sampled transitions by bisection. */
export function scanWorkspaceSlice(
  levelAt: (angle: number) => PoseLevel,
  min: number,
  max: number
): WorkspaceSlice {
  const reachable: AngleInterval[] = [];
  const healthy: AngleInterval[] = [];
  const steps = Math.max(1, Math.ceil((max - min) / 0.25));
  const tracks = [
    { includes: (level: PoseLevel) => level !== 'unreachable', intervals: reachable, start: null as number | null },
    { includes: (level: PoseLevel) => level === 'healthy', intervals: healthy, start: null as number | null }
  ];

  let previousAngle = min;
  let previousLevel = levelAt(min);
  for (const track of tracks) if (track.includes(previousLevel)) track.start = min;

  for (let i = 1; i <= steps; i++) {
    const angle = min + (max - min) * i / steps;
    const level = levelAt(angle);
    for (const track of tracks) {
      const before = track.includes(previousLevel);
      const after = track.includes(level);
      if (before === after) continue;
      let low = previousAngle;
      let high = angle;
      for (let j = 0; j < 10; j++) {
        const mid = (low + high) / 2;
        if (track.includes(levelAt(mid)) === before) low = mid;
        else high = mid;
      }
      if (after) track.start = high;
      else {
        track.intervals.push({ min: track.start ?? min, max: low });
        track.start = null;
      }
    }
    previousAngle = angle;
    previousLevel = level;
  }
  for (const track of tracks) {
    if (track.start !== null) track.intervals.push({ min: track.start, max });
  }

  return { reachable, healthy };
}
