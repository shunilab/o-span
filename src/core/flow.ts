import { calibrate, type Calibration } from './calibration';
import type { Clock } from './clock';
import { formalPlan, quickSetSizes } from './blocks';
import type { Rng } from './random';
import { scoreSession, type SessionScore } from './scoring';
import { TrialRunner, type TrialRecord, type TrialSpec, type TrialView } from './trial';

export type StageId = 'lettersPractice' | 'mathPractice' | 'bothPractice' | 'main' | 'quick';
export type Mode = 'quick' | 'formal';

/** キャリブレーションが取れなかったとき（正答 0 件）の制限時間（ms）。 */
export const FALLBACK_TIME_LIMIT = 6000;

interface StagePlan {
  id: StageId;
  /** 始める前に説明画面を出すか。 */
  intro: boolean;
  specs: (timeLimit: number) => TrialSpec[];
  /** 試行ごとのフィードバックを出すか。 */
  feedback: boolean;
  /** 得点の対象か。 */
  scored: boolean;
}

export interface FlowResult {
  mode: Mode;
  /** 得点の対象になった試行。 */
  trials: TrialRecord[];
  session: SessionScore;
  /** このセッションの計算の制限時間（ms）。 */
  timeLimit: number;
  /** このセッションで新しく取ったキャリブレーション。取っていなければ null。 */
  calibration: Calibration | null;
  at: string;
}

export type FlowView =
  | { kind: 'intro'; stage: StageId }
  | { kind: 'trial'; stage: StageId; trial: TrialView }
  | { kind: 'feedback'; stage: StageId; record: TrialRecord }
  | { kind: 'done'; result: FlowResult };

export interface FlowOptions {
  mode: Mode;
  /** クイックモードの繰り返し数（系列長 3〜7 を各 reps 回）。 */
  reps: 1 | 2 | 3;
  /** 保存済みの制限時間（ms）。null ならクイックでも計算練習から始める。 */
  timeLimit: number | null;
  /** true なら計算練習だけ行い、制限時間（キャリブレーション）を取り直して終わる。 */
  calibrationOnly?: boolean;
  clock: Clock;
  rng: Rng;
  onChange: () => void;
}

const MATH_PRACTICE = (n: number): TrialSpec[] =>
  Array.from({ length: n }, () => ({ setSize: 1, math: true, letters: false, timeLimit: null }));

const both = (sizes: number[], limit: number): TrialSpec[] =>
  sizes.map((setSize) => ({ setSize, math: true, letters: true, timeLimit: limit }));

function stagePlans(opts: FlowOptions): StagePlan[] {
  if (opts.calibrationOnly) {
    return [{ id: 'mathPractice', intro: true, feedback: false, scored: false, specs: () => MATH_PRACTICE(15) }];
  }
  if (opts.mode === 'formal') {
    const plan = formalPlan(opts.rng);
    return [
      {
        id: 'lettersPractice',
        intro: true,
        feedback: true,
        scored: false,
        specs: () =>
          plan.lettersPractice.map((setSize) => ({ setSize, math: false, letters: true, timeLimit: null })),
      },
      { id: 'mathPractice', intro: true, feedback: false, scored: false, specs: () => MATH_PRACTICE(plan.mathPracticeCount) },
      { id: 'bothPractice', intro: true, feedback: true, scored: false, specs: (limit) => both(plan.bothPractice, limit) },
      { id: 'main', intro: true, feedback: true, scored: true, specs: (limit) => both(plan.main, limit) },
    ];
  }
  const stages: StagePlan[] = [];
  if (opts.timeLimit === null) {
    stages.push({ id: 'mathPractice', intro: true, feedback: false, scored: false, specs: () => MATH_PRACTICE(15) });
  }
  const sizes = quickSetSizes(opts.reps, opts.rng);
  stages.push({ id: 'quick', intro: false, feedback: true, scored: true, specs: (limit) => both(sizes, limit) });
  return stages;
}

/** セッション全体（説明 → 各ブロックの試行 → フィードバック → 結果）の進行を管理する。 */
export class Flow {
  view: FlowView;

  private readonly stages: StagePlan[];
  private stageIndex = 0;
  private specs: TrialSpec[] = [];
  private trialIndex = 0;
  private runner: TrialRunner | null = null;
  private timeLimit: number;
  private newCalibration: Calibration | null = null;
  private readonly scored: TrialRecord[] = [];
  private mathPracticeRecords: TrialRecord[] = [];
  private cancelled = false;

  constructor(private readonly opts: FlowOptions) {
    this.stages = stagePlans(opts);
    this.timeLimit = opts.timeLimit ?? FALLBACK_TIME_LIMIT;
    this.view = { kind: 'intro', stage: this.stage.id };
  }

  private get stage(): StagePlan {
    return this.stages[this.stageIndex] as StagePlan;
  }

  start(): void {
    this.enterStage();
  }

  cancel(): void {
    this.cancelled = true;
    this.runner?.cancel();
  }

  /** 説明画面・フィードバック画面から先へ進む。 */
  next(): void {
    if (this.cancelled) return;
    if (this.view.kind === 'intro') this.startTrial();
    else if (this.view.kind === 'feedback') this.advance();
  }

  solved(): void {
    this.runner?.solved();
  }

  judge(saidTrue: boolean): void {
    this.runner?.judge(saidTrue);
  }

  submit(recalled: readonly string[]): void {
    this.runner?.submit(recalled);
  }

  private enterStage(): void {
    this.specs = this.stage.specs(this.timeLimit);
    this.trialIndex = 0;
    if (this.stage.intro) {
      this.setView({ kind: 'intro', stage: this.stage.id });
    } else {
      this.startTrial();
    }
  }

  private startTrial(): void {
    const spec = this.specs[this.trialIndex] as TrialSpec;
    const stage = this.stage;
    const runner = new TrialRunner(spec, {
      clock: this.opts.clock,
      rng: this.opts.rng,
      onView: () => {
        if (this.runner === runner && !this.cancelled) {
          this.setView({ kind: 'trial', stage: stage.id, trial: runner.view });
        }
      },
      onDone: (record) => this.onTrialDone(stage, record),
    });
    this.runner = runner;
    runner.start();
  }

  private onTrialDone(stage: StagePlan, record: TrialRecord): void {
    if (this.cancelled) return;
    if (stage.scored) this.scored.push(record);
    if (stage.id === 'mathPractice') this.mathPracticeRecords.push(record);
    if (stage.feedback) this.setView({ kind: 'feedback', stage: stage.id, record });
    else this.advance();
  }

  private advance(): void {
    this.trialIndex++;
    if (this.trialIndex < this.specs.length) {
      this.startTrial();
      return;
    }
    if (this.stage.id === 'mathPractice') this.finishCalibration();
    this.stageIndex++;
    if (this.stageIndex < this.stages.length) this.enterStage();
    else this.finish();
  }

  /** 計算練習で正答した試行の反応時間から、本番の制限時間を決める。 */
  private finishCalibration(): void {
    const rts = this.mathPracticeRecords.flatMap((r) =>
      r.math.flatMap((m) => (m.result === 'correct' && m.rt !== null ? [m.rt] : [])),
    );
    const cal = calibrate(rts, this.mathPracticeRecords.length, new Date());
    this.newCalibration = cal;
    this.timeLimit = cal?.timeLimit ?? FALLBACK_TIME_LIMIT;
  }

  private finish(): void {
    const result: FlowResult = {
      mode: this.opts.mode,
      trials: this.scored,
      session: scoreSession(
        this.scored.map((r) => ({ presented: r.presented, recalled: r.recalled, math: r.math.map((m) => m.result) })),
      ),
      timeLimit: this.timeLimit,
      calibration: this.newCalibration,
      at: new Date().toISOString(),
    };
    this.setView({ kind: 'done', result });
  }

  private setView(view: FlowView): void {
    this.view = view;
    this.opts.onChange();
  }
}
