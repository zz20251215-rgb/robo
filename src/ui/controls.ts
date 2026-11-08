import { FootLoad, MechanismParams } from '../core/mechanism';
import { Workbench, WorkbenchState, ViewPreset } from '../state/model';

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
  private readonly loadInputs: HTMLInputElement[];
  private readonly pitch: HTMLInputElement;
  private readonly roll: HTMLInputElement;
  private readonly theta1: HTMLInputElement;
  private readonly theta2: HTMLInputElement;
  private readonly fkRow: HTMLElement;
  private readonly gait: HTMLButtonElement;
  private readonly gaitText: HTMLElement;

  constructor(
    private readonly wb: Workbench,
    private readonly handlers: ControlHandlers
  ) {
    this.paramInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-param]')];
    this.loadInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-load]')];
    this.pitch = must('#slider-pitch');
    this.roll = must('#slider-roll');
    this.theta1 = must('#slider-theta1');
    this.theta2 = must('#slider-theta2');
    this.fkRow = must('#fk-controls');
    this.gait = must('#btn-gait');
    this.gaitText = must('#gait-text');
    this.bind();
  }

  sync(state: WorkbenchState): void {
    for (const input of this.paramInputs) {
      const key = input.dataset.param as keyof MechanismParams;
      const mm = Math.round(state.params[key] * 1000);
      if (input.value !== String(mm)) input.value = String(mm);
      const output = document.querySelector<HTMLElement>(`[data-param-value="${key}"]`);
      if (output) output.textContent = `${mm}`;
    }
    for (const input of this.loadInputs) {
      const key = input.dataset.load as keyof FootLoad;
      const scale = Number(input.dataset.scale ?? '1');
      const value = Math.round(state.load[key] * scale);
      if (input.value !== String(value)) input.value = String(value);
      const output = document.querySelector<HTMLElement>(`[data-load-value="${key}"]`);
      if (output) output.textContent = `${value}`;
    }

    setValue(this.pitch, state.pitchDeg);
    setValue(this.roll, state.rollDeg);
    setValue(this.theta1, state.theta1Deg);
    setValue(this.theta2, state.theta2Deg);

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

  private bind(): void {
    for (const input of this.paramInputs) {
      input.addEventListener('input', () => {
        const key = input.dataset.param as keyof MechanismParams;
        this.wb.setParams({ [key]: Number(input.value) / 1000 } as Partial<MechanismParams>);
      });
    }
    for (const input of this.loadInputs) {
      const key = input.dataset.load as keyof FootLoad;
      const scale = Number(input.dataset.scale ?? '1');
      input.addEventListener('input', () => {
        this.wb.setLoad({ [key]: Number(input.value) / scale } as Partial<FootLoad>);
      });
    }

    this.pitch.addEventListener('input', () => this.wb.setPose(Number(this.pitch.value), this.wb.state.rollDeg));
    this.roll.addEventListener('input', () => this.wb.setPose(this.wb.state.pitchDeg, Number(this.roll.value)));
    this.theta1.addEventListener('input', () => this.wb.setMotorAngles(Number(this.theta1.value), this.wb.state.theta2Deg));
    this.theta2.addEventListener('input', () => this.wb.setMotorAngles(this.wb.state.theta1Deg, Number(this.theta2.value)));

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
  }
}

function setValue(input: HTMLInputElement, value: number): void {
  const text = value.toFixed(1);
  if (input.value !== text) input.value = text;
}
