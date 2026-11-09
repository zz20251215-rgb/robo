import {
  AnkleMechanism,
  ChainParams,
  cloneParams,
  DEFAULT_LOAD,
  INITIAL_PARAMS,
  FootLoad,
  IKResult,
  MechanismParams,
  Statics
} from '../core/mechanism';
import { computeCurves, CurveSeries, reachablePitchRange } from '../core/curves';
import { classify, PoseLevel } from '../core/assessment';
import { clamp, deg, rad } from '../core/math';
import { Store } from './store';

export type InputMode = 'ik' | 'fk';
export type AngleMode = 'abs' | 'rel';
export type ViewPreset = 'iso' | 'side' | 'front' | 'top';

export interface CameraPose {
  yaw: number;
  pitch: number;
  dist: number;
  projection: 'perspective' | 'ortho';
}

export const VIEW_PRESETS: Record<ViewPreset, CameraPose> = {
  iso: { yaw: -0.75, pitch: 0.35, dist: 0.58, projection: 'perspective' },
  side: { yaw: -Math.PI / 2, pitch: 0, dist: 0.55, projection: 'ortho' },
  front: { yaw: 0, pitch: 0, dist: 0.55, projection: 'ortho' },
  top: { yaw: 0, pitch: Math.PI / 2, dist: 0.6, projection: 'ortho' }
};

export const POSE_LIMITS = {
  pitchMin: -30,
  pitchMax: 25,
  rollMin: -20,
  rollMax: 20,
  motorMin: -45,
  motorMax: 90
};

export type ChainField = 'baseX' | 'baseY' | 'baseZ' | 'crank' | 'rod' | 'anchorX' | 'anchorY';
export type SharedField = 'anchorHeight';

const mirrorChain = (c: ChainParams): ChainParams => ({
  base: [c.base[0], -c.base[1], c.base[2]],
  crank: c.crank,
  rod: c.rod,
  anchor: [c.anchor[0], -c.anchor[1], c.anchor[2]]
});

function withField(c: ChainParams, field: ChainField, value: number): ChainParams {
  switch (field) {
    case 'baseX':
      return { ...c, base: [value, c.base[1], c.base[2]] };
    case 'baseY':
      return { ...c, base: [c.base[0], value, c.base[2]] };
    case 'baseZ':
      return { ...c, base: [c.base[0], c.base[1], value] };
    case 'crank':
      return { ...c, crank: value };
    case 'rod':
      return { ...c, rod: value };
    case 'anchorX':
      return { ...c, anchor: [value, c.anchor[1], c.anchor[2]] };
    case 'anchorY':
      return { ...c, anchor: [c.anchor[0], value, c.anchor[2]] };
  }
}

export function readChainField(c: ChainParams, field: ChainField): number {
  switch (field) {
    case 'baseX':
      return c.base[0];
    case 'baseY':
      return c.base[1];
    case 'baseZ':
      return c.base[2];
    case 'crank':
      return c.crank;
    case 'rod':
      return c.rod;
    case 'anchorX':
      return c.anchor[0];
    case 'anchorY':
      return c.anchor[1];
  }
}

export interface WorkbenchState {
  mech: AnkleMechanism;
  params: MechanismParams;
  load: FootLoad;
  pitchDeg: number;
  rollDeg: number;
  theta1Deg: number;
  theta2Deg: number;
  neutralTheta1Deg: number;
  neutralTheta2Deg: number;
  linkedChains: boolean;
  inputMode: InputMode;
  angleMode: AngleMode;
  showFrames: boolean;
  showMotorAxes: boolean;
  walking: boolean;
  view: ViewPreset;
  ik: IKResult | null;
  statics: Statics | null;
  level: PoseLevel;
  reachable: boolean;
  fkResidual: number | null;
  fkConverged: boolean;
  reach: { min: number; max: number } | null;
  curves: CurveSeries;
}

const initialState = (): WorkbenchState => ({
  mech: new AnkleMechanism(INITIAL_PARAMS),
  params: cloneParams(INITIAL_PARAMS),
  load: { ...DEFAULT_LOAD },
  pitchDeg: 0,
  rollDeg: 0,
  theta1Deg: 0,
  theta2Deg: 0,
  neutralTheta1Deg: 0,
  neutralTheta2Deg: 0,
  linkedChains: false,
  inputMode: 'ik',
  angleMode: 'abs',
  showFrames: true,
  showMotorAxes: true,
  walking: false,
  view: 'iso',
  ik: null,
  statics: null,
  level: 'healthy',
  reachable: true,
  fkResidual: null,
  fkConverged: true,
  reach: null,
  curves: {
    theta1: [],
    theta2: [],
    tau1: [],
    tau2: [],
    mu1: [],
    mu2: [],
    cond: []
  }
});

/**
 * Owns the mechanism and all derived pose data. UI components only read the
 * snapshot and call intent methods; no component recomputes kinematics itself.
 */
export class Workbench {
  private store = new Store<WorkbenchState>(initialState());
  /** Last valid motor angles, kept when the requested pose is unreachable. */
  private theta = { t1: 0, t2: 0 };

  get mech(): AnkleMechanism {
    return this.store.get().mech;
  }

  constructor() {
    this.recompute();
  }

  get state(): WorkbenchState {
    return this.store.get();
  }

  subscribe(listener: (state: WorkbenchState) => void): () => void {
    return this.store.subscribe(listener);
  }

  setPose(pitchDeg: number, rollDeg: number): void {
    this.store.update({
      pitchDeg: clamp(pitchDeg, POSE_LIMITS.pitchMin, POSE_LIMITS.pitchMax),
      rollDeg: clamp(rollDeg, POSE_LIMITS.rollMin, POSE_LIMITS.rollMax),
      inputMode: 'ik',
      walking: false
    });
    this.recompute();
  }

  /** Single update for gait playback: pose and ground reaction force together. */
  applyPose(pitchDeg: number, rollDeg: number, load: Partial<FootLoad>): void {
    this.store.update({
      pitchDeg: clamp(pitchDeg, POSE_LIMITS.pitchMin, POSE_LIMITS.pitchMax),
      rollDeg: clamp(rollDeg, POSE_LIMITS.rollMin, POSE_LIMITS.rollMax),
      load: { ...this.state.load, ...load },
      inputMode: 'ik'
    });
    this.recompute();
  }

  setMotorAngles(theta1Deg: number, theta2Deg: number): void {
    this.store.update({
      theta1Deg: clamp(theta1Deg, POSE_LIMITS.motorMin, POSE_LIMITS.motorMax),
      theta2Deg: clamp(theta2Deg, POSE_LIMITS.motorMin, POSE_LIMITS.motorMax),
      inputMode: 'fk',
      walking: false
    });
    this.recompute();
  }

  /** Edits one dimension of one chain, mirroring to the other when linked. */
  setChainParam(chain: 'A' | 'B', field: ChainField, value: number): void {
    const params = cloneParams(this.state.params);
    const key = chain === 'A' ? 'chainA' : 'chainB';
    const other = chain === 'A' ? 'chainB' : 'chainA';
    params[key] = withField(params[key], field, value);
    if (this.state.linkedChains) params[other] = mirrorChain(params[key]);
    this.applyParams(params);
  }

  /** Rod anchors share the foot-plate top surface. */
  setSharedParam(field: SharedField, value: number): void {
    const params = cloneParams(this.state.params);
    if (field === 'anchorHeight') {
      params.chainA.anchor[2] = value;
      params.chainB.anchor[2] = value;
    }
    this.applyParams(params);
  }

  /** Linking copies chain A onto B as a mirror image; turning it off leaves both. */
  setLinkChains(linked: boolean): void {
    if (linked === this.state.linkedChains) return;
    const params = cloneParams(this.state.params);
    if (linked) params.chainB = mirrorChain(params.chainA);
    this.mech.setParams(params);
    this.store.update({ linkedChains: linked, params: cloneParams(this.mech.params) });
    this.recompute();
  }

  private applyParams(params: MechanismParams): void {
    this.mech.setParams(params);
    this.store.update({ params: cloneParams(this.mech.params) });
    this.recompute();
  }

  setLoad(patch: Partial<FootLoad>): void {
    this.store.update({ load: { ...this.state.load, ...patch } });
    this.recompute();
  }

  setMode(mode: InputMode): void {
    if (mode === this.state.inputMode) return;
    if (mode === 'fk') {
      const s = this.state;
      this.store.update({
        inputMode: 'fk',
        theta1Deg: s.theta1Deg,
        theta2Deg: s.theta2Deg
      });
    } else {
      this.store.update({ inputMode: 'ik' });
    }
    this.recompute();
  }

  setAngleMode(mode: AngleMode): void {
    this.store.update({ angleMode: mode });
    this.recompute();
  }

  setView(view: ViewPreset): void {
    this.store.update({ view });
  }

  setWalking(walking: boolean): void {
    this.store.update({ walking });
  }

  toggleFrames(): void {
    this.store.update({ showFrames: !this.state.showFrames });
  }

  toggleMotorAxes(): void {
    this.store.update({ showMotorAxes: !this.state.showMotorAxes });
  }

  resetPose(): void {
    this.store.update({ pitchDeg: 0, rollDeg: 0, walking: false });
    this.recompute();
  }

  resetParams(): void {
    this.applyParams(INITIAL_PARAMS);
  }

  private recompute(): void {
    const state = this.state;
    const pitch = rad(state.pitchDeg);
    const roll = rad(state.rollDeg);
    let theta1 = rad(state.theta1Deg);
    let theta2 = rad(state.theta2Deg);
    let ik: IKResult | null = null;
    let fkResidual: number | null = null;
    let fkConverged = true;
    let pitchDeg = state.pitchDeg;
    let rollDeg = state.rollDeg;

    if (state.inputMode === 'ik') {
      ik = this.mech.solveIK(pitch, roll);
      if (ik.ok) {
        theta1 = ik.theta1;
        theta2 = ik.theta2;
        this.theta = { t1: theta1, t2: theta2 };
      } else {
        theta1 = this.theta.t1;
        theta2 = this.theta.t2;
      }
    } else {
      const fk = this.mech.solveFK(theta1, theta2, pitch, roll);
      fkResidual = fk.residual;
      fkConverged = fk.ok;
      if (fk.ok) {
        pitchDeg = deg(fk.pitch);
        rollDeg = deg(fk.roll);
        ik = this.mech.solveIK(fk.pitch, fk.roll);
        this.theta = { t1: theta1, t2: theta2 };
      }
    }

    const reachable = ik?.ok ?? false;
    const statics = reachable ? this.mech.statics(rad(pitchDeg), rad(rollDeg), theta1, theta2, state.load) : null;
    const neutral = this.mech.neutralAngles();
    const curves = computeCurves(this.mech, {
      roll: rad(rollDeg),
      load: state.load,
      angleMode: state.angleMode
    });

    this.store.set({
      ...state,
      pitchDeg,
      rollDeg,
      theta1Deg: deg(theta1),
      theta2Deg: deg(theta2),
      neutralTheta1Deg: deg(neutral.theta1),
      neutralTheta2Deg: deg(neutral.theta2),
      ik,
      statics,
      level: classify(statics),
      reachable,
      fkResidual,
      fkConverged,
      reach: reachablePitchRange(this.mech, rad(rollDeg)),
      curves
    });
  }
}
