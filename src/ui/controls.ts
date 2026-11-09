import { FootLoad, MechanismParams } from '../core/mechanism';
import { Workbench, WorkbenchState, ViewPreset, POSE_LIMITS } from '../state/model';

export interface ControlHandlers {
  onGait(): void;
  onExport(): void;
  onView(view: ViewPreset): void;
}

const must = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

/** Binds declarative controls to workbench intents and mirrors state back. */
export class Controls {
  private readonly paramInputs: HTMLInputElement[];
  private readonly paramNumInputs: HTMLInputElement[];
  private readonly syncChains: HTMLInputElement | null;
  private readonly loadInputs: HTMLInputElement[];
  private readonly loadNumInputs: HTMLInputElement[];
  private readonly pitch: HTMLInputElement;
  private readonly roll: HTMLInputElement;
  private readonly theta1: HTMLInputElement;
  private readonly theta2: HTMLInputElement;
  private readonly fkRow: HTMLElement;
  private readonly gait: HTMLButtonElement;
  private readonly gaitText: HTMLElement;
  private readonly paramTabs: HTMLButtonElement[];
  private readonly paramSections: HTMLElement[];
  private readonly paramBadge: HTMLElement | null;
  private readonly btnParamPrev: HTMLButtonElement | null;
  private readonly btnParamNext: HTMLButtonElement | null;
  private currentParamTab: 'all' | 'chain1' | 'chain2' | 'base' = 'all';
  private static readonly TAB_ORDER = ['all', 'chain1', 'chain2', 'base'] as const;

  constructor(
    private readonly wb: Workbench,
    private readonly handlers: ControlHandlers
  ) {
    this.paramInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-param]')];
    this.paramNumInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-param-num]')];
    this.syncChains = document.querySelector<HTMLInputElement>('#sync-chains');
    this.loadInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-load]')];
    this.loadNumInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-load-num]')];
    this.pitch = must('#slider-pitch');
    this.roll = must('#slider-roll');
    this.theta1 = must('#slider-theta1');
    this.theta2 = must('#slider-theta2');
    this.fkRow = must('#fk-controls');
    this.gait = must('#btn-gait');
    this.gaitText = must('#gait-text');
    this.paramTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-param-tab]')];
    this.paramSections = [...document.querySelectorAll<HTMLElement>('[data-tab-section]')];
    this.paramBadge = document.querySelector<HTMLElement>('#param-page-badge');
    this.btnParamPrev = document.querySelector<HTMLButtonElement>('#btn-param-prev');
    this.btnParamNext = document.querySelector<HTMLButtonElement>('#btn-param-next');
    this.bind();
  }

  sync(state: WorkbenchState): void {
    for (const input of this.paramInputs) {
      const key = input.dataset.param as keyof MechanismParams;
      const raw = state.params[key];
      if (raw === undefined) continue;
      const mm = Math.round(raw * 10000) / 10;
      const text = Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
      if (input.value !== text) input.value = text;
      updateSliderTrack(input);
      const output = document.querySelector<HTMLElement>(`[data-param-value="${key}"]`);
      if (output) output.textContent = text;
    }
    for (const numInput of this.paramNumInputs) {
      const key = numInput.dataset.paramNum as keyof MechanismParams;
      const raw = state.params[key];
      if (raw === undefined) continue;
      const mm = Math.round(raw * 10000) / 10;
      const text = Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
      if (numInput.value !== text && document.activeElement !== numInput) {
        numInput.value = text;
      }
    }
    for (const input of this.loadInputs) {
      const key = input.dataset.load as keyof FootLoad;
      const scale = Number(input.dataset.scale ?? '1');
      const value = Math.round(state.load[key] * scale);
      if (input.value !== String(value)) input.value = String(value);
      updateSliderTrack(input);
      const output = document.querySelector<HTMLElement>(`[data-load-value="${key}"]`);
      if (output) output.textContent = `${value}`;
    }
    for (const numInput of this.loadNumInputs) {
      const key = numInput.dataset.loadNum as keyof FootLoad;
      const scale = Number(numInput.dataset.scale ?? '1');
      const value = Math.round(state.load[key] * scale);
      if (numInput.value !== String(value) && document.activeElement !== numInput) {
        numInput.value = String(value);
      }
    }

    const offset1 = state.angleMode === 'rel' ? (state.neutralTheta1Deg ?? state.neutralThetaDeg) : 0;
    const offset2 = state.angleMode === 'rel' ? (state.neutralTheta2Deg ?? state.neutralThetaDeg) : 0;

    setValue(this.pitch, state.pitchDeg);
    setValue(this.roll, state.rollDeg);

    const min1 = POSE_LIMITS.motorMin - offset1;
    const max1 = POSE_LIMITS.motorMax - offset1;
    const min2 = POSE_LIMITS.motorMin - offset2;
    const max2 = POSE_LIMITS.motorMax - offset2;

    this.theta1.min = min1.toFixed(1);
    this.theta1.max = max1.toFixed(1);
    this.theta2.min = min2.toFixed(1);
    this.theta2.max = max2.toFixed(1);

    setValue(this.theta1, state.theta1Deg - offset1);
    setValue(this.theta2, state.theta2Deg - offset2);

    const fk = state.inputMode === 'fk';
    this.fkRow.hidden = !fk;
    this.pitch.disabled = fk;
    this.roll.disabled = fk;
    this.theta1.disabled = !fk;
    this.theta2.disabled = !fk;

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.inputMode));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-angle]')) {
      button.setAttribute('aria-pressed', String(button.dataset.angle === state.angleMode));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    }
    must('#btn-toggle-frames').setAttribute('aria-pressed', String(state.showFrames));
    must('#btn-toggle-motor-axes').setAttribute('aria-pressed', String(state.showMotorAxes));
    this.gait.setAttribute('aria-pressed', String(state.walking));
    this.gaitText.textContent = state.walking ? '暂停演示' : '步态演示';
  }

  private handleParamChange(key: keyof MechanismParams, valMm: number): void {
    const patch: Partial<MechanismParams> = { [key]: valMm / 1000 };
    const sync = this.syncChains?.checked ?? false;
    if (sync) {
      if (key === 'l_crank1') patch.l_crank2 = valMm / 1000;
      else if (key === 'l_crank2') patch.l_crank1 = valMm / 1000;
      else if (key === 'l_rod1') patch.l_rod2 = valMm / 1000;
      else if (key === 'l_rod2') patch.l_rod1 = valMm / 1000;
      else if (key === 'h_base1') patch.h_base2 = valMm / 1000;
      else if (key === 'h_base2') patch.h_base1 = valMm / 1000;
    }
    this.wb.setParams(patch);
  }

  private bind(): void {
    for (const slider of document.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      updateSliderTrack(slider);
      slider.addEventListener('input', () => updateSliderTrack(slider));
    }

    for (const input of this.paramInputs) {
      input.addEventListener('input', () => {
        const key = input.dataset.param as keyof MechanismParams;
        this.handleParamChange(key, Number(input.value));
      });
    }
    for (const numInput of this.paramNumInputs) {
      const onNumChange = (): void => {
        const key = numInput.dataset.paramNum as keyof MechanismParams;
        const min = Number(numInput.min || -9999);
        const max = Number(numInput.max || 9999);
        let val = Number(numInput.value);
        if (isNaN(val)) return;
        val = Math.min(max, Math.max(min, val));
        numInput.value = String(val);
        this.handleParamChange(key, val);
      };
      numInput.addEventListener('change', onNumChange);
      numInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          onNumChange();
          numInput.blur();
        }
      });
    }
    for (const input of this.loadInputs) {
      const key = input.dataset.load as keyof FootLoad;
      const scale = Number(input.dataset.scale ?? '1');
      input.addEventListener('input', () => {
        this.wb.setLoad({ [key]: Number(input.value) / scale } as Partial<FootLoad>);
      });
    }
    for (const numInput of this.loadNumInputs) {
      const onNumChange = (): void => {
        const key = numInput.dataset.loadNum as keyof FootLoad;
        const scale = Number(numInput.dataset.scale ?? '1');
        const min = Number(numInput.min || -9999);
        const max = Number(numInput.max || 9999);
        let val = Number(numInput.value);
        if (isNaN(val)) return;
        val = Math.min(max, Math.max(min, val));
        numInput.value = String(val);
        this.wb.setLoad({ [key]: val / scale } as Partial<FootLoad>);
      };
      numInput.addEventListener('change', onNumChange);
      numInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          onNumChange();
          numInput.blur();
        }
      });
    }

    this.pitch.addEventListener('input', () => this.wb.setPose(Number(this.pitch.value), this.wb.state.rollDeg));
    this.roll.addEventListener('input', () => this.wb.setPose(this.wb.state.pitchDeg, Number(this.roll.value)));
    this.theta1.addEventListener('input', () => {
      const offset1 = this.wb.state.angleMode === 'rel' ? (this.wb.state.neutralTheta1Deg ?? this.wb.state.neutralThetaDeg) : 0;
      const absTheta1 = Number(this.theta1.value) + offset1;
      this.wb.setMotorAngles(absTheta1, this.wb.state.theta2Deg);
    });
    this.theta2.addEventListener('input', () => {
      const offset2 = this.wb.state.angleMode === 'rel' ? (this.wb.state.neutralTheta2Deg ?? this.wb.state.neutralThetaDeg) : 0;
      const absTheta2 = Number(this.theta2.value) + offset2;
      this.wb.setMotorAngles(this.wb.state.theta1Deg, absTheta2);
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.addEventListener('click', () => this.wb.setMode(button.dataset.mode === 'fk' ? 'fk' : 'ik'));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-angle]')) {
      button.addEventListener('click', () => this.wb.setAngleMode(button.dataset.angle === 'rel' ? 'rel' : 'abs'));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      button.addEventListener('click', () => {
        const view = (button.dataset.view ?? 'iso') as ViewPreset;
        this.wb.setView(view);
        this.handlers.onView(view);
      });
    }

    must('#btn-toggle-frames').addEventListener('click', () => this.wb.toggleFrames());
    must('#btn-toggle-motor-axes').addEventListener('click', () => this.wb.toggleMotorAxes());
    must('#btn-reset-pose').addEventListener('click', () => this.wb.resetPose());
    must('#btn-reset-params').addEventListener('click', () => this.wb.resetParams());
    this.gait.addEventListener('click', () => this.handlers.onGait());
    must('#btn-export').addEventListener('click', () => this.handlers.onExport());

    for (const tabBtn of this.paramTabs) {
      tabBtn.addEventListener('click', () => {
        const tab = (tabBtn.dataset.paramTab ?? 'all') as 'all' | 'chain1' | 'chain2' | 'base';
        this.setParamTab(tab);
      });
    }
    this.btnParamPrev?.addEventListener('click', () => this.cycleParamTab(-1));
    this.btnParamNext?.addEventListener('click', () => this.cycleParamTab(1));

    for (const dock of document.querySelectorAll<HTMLElement>('.stage-dock, .stage-dock-right')) {
      dock.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    }

    const toggleBtn = document.querySelector<HTMLButtonElement>('#btn-toggle-params');
    const toggle = document.querySelector<HTMLElement>('#stage-params-toggle');
    const dock = document.querySelector<HTMLElement>('#stage-params');
    if (dock) {
      const onToggle = (): void => {
        const isCollapsed = dock.classList.toggle('collapsed');
        toggle?.setAttribute('aria-expanded', String(!isCollapsed));
        toggleBtn?.setAttribute('aria-pressed', String(!isCollapsed));
      };
      toggle?.addEventListener('click', onToggle);
      toggle?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      });
      toggleBtn?.addEventListener('click', onToggle);
    }

    for (const presetBtn of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
      presetBtn.addEventListener('click', () => {
        const key = presetBtn.dataset.preset;
        const presets: Record<string, Partial<MechanismParams>> = {
          standard: {
            l_crank1: 0.045,
            l_crank2: 0.045,
            l_rod1: 0.165,
            l_rod2: 0.165,
            h_base1: 0.180,
            h_base2: 0.180,
            w_base: 0.070,
            x_base: -0.040,
            w_foot: 0.060,
            x_foot: -0.030,
            z_foot: -0.020,
          },
          torque: {
            l_crank1: 0.055,
            l_crank2: 0.055,
            l_rod1: 0.175,
            l_rod2: 0.175,
            h_base1: 0.190,
            h_base2: 0.190,
            w_base: 0.070,
            x_base: -0.040,
            w_foot: 0.060,
            x_foot: -0.030,
            z_foot: -0.020,
          },
          speed: {
            l_crank1: 0.035,
            l_crank2: 0.035,
            l_rod1: 0.155,
            l_rod2: 0.155,
            h_base1: 0.175,
            h_base2: 0.175,
            w_base: 0.070,
            x_base: -0.040,
            w_foot: 0.060,
            x_foot: -0.030,
            z_foot: -0.020,
          },
        };
        if (key && presets[key]) {
          this.wb.setParams(presets[key]);
        }
      });
    }

    for (const poseBtn of document.querySelectorAll<HTMLButtonElement>('[data-pose-p]')) {
      poseBtn.addEventListener('click', () => {
        const p = Number(poseBtn.dataset.poseP);
        const r = Number(poseBtn.dataset.poseR);
        this.wb.setPose(p, r);
      });
    }

    const resetPoseCard = document.querySelector<HTMLButtonElement>('#btn-reset-pose-card');
    if (resetPoseCard) {
      resetPoseCard.addEventListener('click', () => this.wb.resetPose());
    }
  }

  setParamTab(tab: 'all' | 'chain1' | 'chain2' | 'base'): void {
    this.currentParamTab = tab;
    for (const btn of this.paramTabs) {
      btn.setAttribute('aria-pressed', String(btn.dataset.paramTab === tab));
    }
    for (const sec of this.paramSections) {
      const target = sec.dataset.tabSection;
      sec.hidden = tab !== 'all' && target !== tab;
    }
    if (this.paramBadge) {
      const titles: Record<string, string> = {
        all: '全部 (可上下滚动)',
        chain1: '1/3 · 支链 1 (左侧)',
        chain2: '2/3 · 支链 2 (右侧)',
        base: '3/3 · 机架与足端',
      };
      this.paramBadge.textContent = titles[tab] ?? '全部';
    }
  }

  private cycleParamTab(direction: 1 | -1): void {
    const list = Controls.TAB_ORDER;
    const curIdx = list.indexOf(this.currentParamTab);
    const nextIdx = (curIdx + direction + list.length) % list.length;
    this.setParamTab(list[nextIdx]);
  }
}

export function updateSliderTrack(input: HTMLInputElement): void {
  const min = Number(input.min !== '' ? input.min : '0');
  const max = Number(input.max !== '' ? input.max : '100');
  const val = Number(input.value !== '' ? input.value : '0');
  const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 50;
  input.style.setProperty('--pct', `${pct.toFixed(2)}%`);
}

function setValue(input: HTMLInputElement, value: number): void {
  const text = value.toFixed(1);
  if (input.value !== text) input.value = text;
  updateSliderTrack(input);
}
