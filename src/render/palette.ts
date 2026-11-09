import type { PoseLevel } from '../core/assessment';

export const CHAIN_COLORS = ['#176d9f', '#b84d19'] as const;

export const POSE_COLORS: Record<PoseLevel, { fill: string; ink: string }> = {
  healthy: { fill: '#b9dec9', ink: '#16754e' },
  caution: { fill: '#f1d3a0', ink: '#86500a' },
  singular: { fill: '#efb9c4', ink: '#a92e45' },
  unreachable: { fill: '#dce1e8', ink: '#516076' }
};
