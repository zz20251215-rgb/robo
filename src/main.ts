import './styles/main.css';
import { Workbench } from './state/model';
import { SceneView } from './render/scene';
import { StructureView } from './render/structure';
import { WorkspacePad } from './render/pad';
import { Chart } from './render/chart';
import { Controls } from './ui/controls';
import { renderReadouts } from './ui/readouts';
import { GaitPlayer } from './ui/gait';
import { exportSession } from './ui/export';

const wb = new Workbench();

const mustCanvas = (selector: string): HTMLCanvasElement => {
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  if (!canvas) throw new Error(`Missing canvas: ${selector}`);
  return canvas;
};

let pending = false;
const schedule = (): void => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    render();
  });
};

const scene = new SceneView(mustCanvas('#scene'), schedule);
const structure = new StructureView(
  document.querySelector<SVGGElement>('#structure-art')!,
  document.getElementById('structure-note')!
);
const pad = new WorkspacePad(mustCanvas('#pad'), (pitch, roll) => wb.setPose(pitch, roll));

const chart = new Chart(mustCanvas('#chart-kinematics'), {
  unit: '°',
  series: [
    { key: 'theta1', label: 'θ₁', color: '#176d9f' },
    { key: 'theta2', label: 'θ₂', color: '#b84d19', dashed: true }
  ],
  output: document.getElementById('chart-kin-output')
});

const statics = new Chart(mustCanvas('#chart-statics'), {
  unit: ' Nm',
  series: [
    { key: 'tau1', label: 'τ₁', color: '#176d9f' },
    { key: 'tau2', label: 'τ₂', color: '#b84d19', dashed: true }
  ],
  includeZero: true,
  output: document.getElementById('chart-tau-output')
});

const transmission = new Chart(mustCanvas('#chart-transmission'), {
  unit: '°',
  series: [
    { key: 'mu1', label: 'μ₁', color: '#176d9f' },
    { key: 'mu2', label: 'μ₂', color: '#b84d19', dashed: true }
  ],
  band: { from: 45, to: 135, label: 'μ ≥ 45°' },
  output: document.getElementById('chart-mu-output')
});

const dexterity = new Chart(mustCanvas('#chart-dexterity'), {
  unit: '',
  series: [{ key: 'cond', label: 'κ', color: '#74539a' }],
  output: document.getElementById('chart-cond-output')
});

const charts = [chart, statics, transmission, dexterity];
const gait = new GaitPlayer(wb);

const controls = new Controls(wb, {
  onGait: () => gait.toggle(),
  onExport: () => exportSession(wb.state),
  onView: (view) => scene.setPreset(view)
});

function render(): void {
  const state = wb.state;
  scene.render(state);
  structure.render(state);
  pad.render(state);
  for (const item of charts) item.render(state);
  controls.sync(state);
  renderReadouts(state);
}

wb.subscribe(schedule);
scene.setPreset('iso');
render();
