import { POSE_LEVEL_LABEL } from '../core/assessment';
import { WorkbenchState } from '../state/model';

const $ = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: #${id}`);
  return element;
};

const signed = (value: number, digits = 1): string => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

/** Compact numeric label that avoids "e+0" noise for everyday magnitudes. */
const sci = (value: number): string => {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 0.001 && abs < 10000) return value.toFixed(3);
  const [mantissa, exponent] = value.toExponential(2).split('e');
  return `${mantissa}e${Number(exponent)}`;
};

function levelCopy(state: WorkbenchState): { title: string; advice: string } {
  if (!state.reachable) {
    return {
      title: '超出工作空间',
      advice: '该俯仰 / 横滚组合无逆解，机构无法装配到目标位姿。请退回可达区域。'
    };
  }
  const statics = state.statics;
  if (!statics) return { title: '等待计算', advice: '' };
  if (statics.kind === 'singular') {
    return statics.reason === 'dead-centre'
      ? {
          title: '第 Ⅰ 类奇异 · 曲柄死点',
          advice: '连杆与曲柄共线，力臂趋近于零。禁止在此位形附近输出力矩，否则电机电流与杆力会发散。'
        }
      : {
          title: '第 Ⅱ 类奇异 · 雅可比降秩',
          advice: '机构在该位形丢失一个运动自由度，逆解不稳定。需调整几何参数或限制工作空间。'
        };
  }
  if (state.fkResidual !== null && !state.fkConverged) {
    return { title: '正运动学未收敛', advice: '当前电机角组合超出装配空间，请减小驱动角度。' };
  }
  if (statics.mu1Deg < 42 || statics.mu2Deg < 42) {
    return {
      title: '传力角预警',
      advice: '传力角已低于 42°，摩擦与加工误差可能引起卡滞，建议收窄俯仰行程或增加曲柄长度。'
    };
  }
  if (statics.cond > 6) {
    return {
      title: '条件数偏高',
      advice: '雅可比矩阵接近病态，末端速度与力矩的误差会被放大，建议避开该区域。'
    };
  }
  return {
    title: '传动正常',
    advice: '两套曲柄连杆远离死点，速度雅可比满秩，可稳定输出双向平衡力矩。'
  };
}

/** Writes every textual readout for the current snapshot. */
export function renderReadouts(state: WorkbenchState): void {
  const statics = state.statics;
  const okStatics = statics && statics.kind === 'ok' ? statics : null;
  const thetaOffset = state.angleMode === 'rel' ? state.neutralThetaDeg : 0;

  $('m-theta1').textContent = `${signed(state.theta1Deg - thetaOffset)}°`;
  $('m-theta2').textContent = `${signed(state.theta2Deg - thetaOffset)}°`;
  $('m-tau1').textContent = okStatics ? `${signed(okStatics.tauM1)} Nm` : '—';
  $('m-tau2').textContent = okStatics ? `${signed(okStatics.tauM2)} Nm` : '—';
  const mu = statics ? Math.min(statics.mu1Deg, statics.mu2Deg) : null;
  $('m-mu').textContent = mu !== null ? `${mu.toFixed(1)}°` : '—';
  const cond = okStatics ? okStatics.cond : statics?.cond ?? null;
  $('m-cond').textContent = cond !== null && cond < 999 ? cond.toFixed(2) : '—';

  const pill = $('health-pill');
  pill.dataset.level = state.level;
  $('health-text').textContent = state.walking ? '步态演示' : POSE_LEVEL_LABEL[state.level];
  $('diagnostics').dataset.level = state.level;

  $('pose-readout').textContent = `Pitch ${signed(state.pitchDeg)}°   Roll ${signed(state.rollDeg)}°`;
  $('out-pitch').textContent = `${signed(state.pitchDeg)}°`;
  $('out-roll').textContent = `${signed(state.rollDeg)}°`;
  $('out-theta1').textContent = `${signed(state.theta1Deg)}°`;
  $('out-theta2').textContent = `${signed(state.theta2Deg)}°`;

  $('fk-status').textContent =
    state.inputMode === 'fk'
      ? state.fkConverged
        ? `残差 ${state.fkResidual?.toExponential(1) ?? '—'}`
        : '未收敛'
      : '';

  const copy = levelCopy(state);
  $('diag-title').textContent = copy.title;
  $('diag-advice').textContent = copy.advice;
  const details = $('diag-details');
  details.replaceChildren();
  if (statics) {
    const rows: Array<[string, string]> = [
      ['κ', okStatics ? okStatics.cond.toFixed(3) : '∞'],
      ['μ₁ / μ₂', `${statics.mu1Deg.toFixed(1)}° / ${statics.mu2Deg.toFixed(1)}°`],
      ['力臂 h₁ / h₂', `${(statics.lever1 * 1000).toFixed(1)} / ${(statics.lever2 * 1000).toFixed(1)} mm`],
      ['杆力 F₁ / F₂', okStatics ? `${okStatics.fRod1.toFixed(0)} / ${okStatics.fRod2.toFixed(0)} N` : '—']
    ];
    for (const [key, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      details.append(dt, dd);
    }
  }
  $('diag-meta').textContent = statics ? `det Jθ ${statics.kind === 'ok' ? sci(statics.detJ) : '0'}` : '';

  const len1 = statics ? statics.rod1[0] ** 2 + statics.rod1[1] ** 2 + statics.rod1[2] ** 2 : null;
  const len2 = statics ? statics.rod2[0] ** 2 + statics.rod2[1] ** 2 + statics.rod2[2] ** 2 : null;
  $('rod-lengths').textContent =
    len1 !== null && len2 !== null
      ? `连杆实长 ${(Math.sqrt(len1) * 1000).toFixed(2)} / ${(Math.sqrt(len2) * 1000).toFixed(2)} mm · 设计 ${(state.params.l_rod * 1000).toFixed(1)} mm`
      : '连杆实长 —';

  $('chart-load-caption').textContent = `Fz ${state.load.Fz.toFixed(0)} N · CoP ${(state.load.x_cop * 1000).toFixed(0)} mm · Roll ${state.rollDeg.toFixed(1)}°`;
}
