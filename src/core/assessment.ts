import { Statics } from './mechanism';

/** Transmission angle below which force transfer is flagged. */
export const MU_CAUTION_DEG = 42;
/** Condition number above which the pose is flagged. */
export const COND_CAUTION = 6;

export type PoseLevel = 'unreachable' | 'singular' | 'caution' | 'healthy';

export function classify(statics: Statics | null): PoseLevel {
  if (!statics) return 'unreachable';
  if (statics.kind === 'singular') return 'singular';
  if (statics.mu1Deg < MU_CAUTION_DEG || statics.mu2Deg < MU_CAUTION_DEG || statics.cond > COND_CAUTION) {
    return 'caution';
  }
  return 'healthy';
}

export const POSE_LEVEL_LABEL: Record<PoseLevel, string> = {
  unreachable: '超出工作空间',
  singular: '奇异位形',
  caution: '接近边界',
  healthy: '传动正常'
};
