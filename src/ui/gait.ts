import { Workbench } from '../state/model';

/**
 * Deterministic gait preview: phase-driven pitch/roll trajectory with a
 * stance-phase vertical force and heel-to-toe centre of pressure sweep.
 */
export class GaitPlayer {
  private raf: number | null = null;
  private start = 0;
  private readonly speed = 2.1;

  constructor(private readonly wb: Workbench) {}

  toggle(): void {
    if (this.raf !== null) {
      this.stop();
      return;
    }
    this.start = performance.now();
    this.wb.setWalking(true);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.wb.state.walking) this.wb.setWalking(false);
  }

  private tick = (now: number): void => {
    if (this.raf === null) return;
    if (!this.wb.state.walking) {
      this.raf = null;
      return;
    }
    const phase = ((now - this.start) / 1000) * this.speed;
    const pitch = 12 * Math.sin(phase) - 5 * Math.cos(2 * phase);
    const roll = 4 * Math.sin(0.5 * phase);
    const force = Math.max(0, 500 + 250 * Math.sin(Math.PI * Math.sin(phase)));
    const cop = 0.08 + 0.08 * Math.cos(phase);
    this.wb.applyPose(pitch, roll, { Fz: force, x_cop: cop });
    this.raf = requestAnimationFrame(this.tick);
  };
}
