import { CURVE_KEYS, CurveSeries } from '../core/curves';
import { WorkbenchState } from '../state/model';

function compactSeries(series: CurveSeries): Record<string, Array<[number, number | null]>> {
  const result: Record<string, Array<[number, number | null]>> = {};
  for (const key of CURVE_KEYS) {
    result[key] = series[key].map((point) => [point.pitchDeg, point.value]);
  }
  return result;
}

/** Downloads the current mechanism, load case and curves as a JSON snapshot. */
export function exportSession(state: WorkbenchState): void {
  const statics = state.statics;
  const payload = {
    schema: 'ankle-workbench/v2',
    exportedAt: new Date().toISOString(),
    mechanism: '2-RSS+1-U',
    params: state.params,
    load: state.load,
    pose: {
      inputMode: state.inputMode,
      angleMode: state.angleMode,
      pitchDeg: state.pitchDeg,
      rollDeg: state.rollDeg,
      theta1Deg: state.theta1Deg,
      theta2Deg: state.theta2Deg,
      neutralThetaDeg: state.neutralThetaDeg
    },
    statics:
      statics === null
        ? null
        : statics.kind === 'ok'
          ? {
              kind: 'ok',
              mu1Deg: statics.mu1Deg,
              mu2Deg: statics.mu2Deg,
              cond: statics.cond,
              detJ: statics.detJ,
              tauM1: statics.tauM1,
              tauM2: statics.tauM2,
              fRod1: statics.fRod1,
              fRod2: statics.fRod2
            }
          : { kind: 'singular', reason: statics.reason, mu1Deg: statics.mu1Deg, mu2Deg: statics.mu2Deg },
    curves: {
      domain: 'pitchDeg',
      rollDeg: state.rollDeg,
      series: compactSeries(state.curves)
    }
  };

  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  link.href = url;
  link.download = `ankle-workbench-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
