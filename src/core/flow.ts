import { calibrate, computeTimeLimit, type Calibration } from './calibration';
import type { Clock } from './clock';
import { formalPlan, quickSetSizes } from './blocks';
import type { Rng } from './random';
import { scoreSession, type SessionScore } from './scoring';
import { TrialRunner, type TrialRecord, type TrialSpec, type TrialView } from './trial';

export type StageId = 'lettersPractice' | 'mathPractice' | 'bothPractice' | 'main' | 'quick';
/** 成績を残すセッションの種類。 */
export type Mode = 'quick' | 'formal';
/** setup は 1 つの練習だけを単独で行う（成績は残さず、練習の完了だけ保存する）。 */
export type FlowMode = Mode | 'setup';
/** Setup で単独に行える練習。 */
export type PracticeStep = 'mathPractice' | 'lettersPractice' | 'bothPractice';

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

/** 練習のブロックが 1 つ終わったときの通知。ここで保存すれば、途中でやめても終わった分は残る。 */
export interface StageDone {
  stage: StageId;
  /** 計算練習のときだけ。取れなかった（正答 0 件）なら null。 */
  calibration: Calibration | null;
  math: MathTally;
  letters: { correct: number; total: number };
  at: string;
}

export interface FlowResult {
  mode: FlowMode;
  /** setup のときの、行った練習の結果。それ以外は null。 */
  practice: StageDone | null;
  /** 得点の対象になった試行。 */
  trials: TrialRecord[];
  session: SessionScore;
  /** このセッションの計算の制限時間（ms）。 */
  timeLimit: number;
  /** このセッションで新しく取ったキャリブレーション。取っていなければ null。 */
  calibration: Calibration | null;
  at: string;
}

/** ブロック内の計算の累積成績。 */
export interface MathTally {
  correct: number;
  total: number;
}

/** 計算練習が終わったときのまとめ。timeLimit はこの練習から決まる本番の制限時間（ms）。 */
export interface PracticeSummary {
  timeLimit: number | null;
}

/** 想起の操作説明を出す最初の試行数（原著どおり 3）。 */
export const RECALL_HINT_TRIALS = 3;

export type FlowView =
  | { kind: 'intro'; stage: StageId }
  /** recallHint: 想起画面に操作説明を出すか（セッションの最初の 3 回だけ）。 */
  | { kind: 'trial'; stage: StageId; trial: TrialView; recallHint: boolean }
  /** math: このブロックの計算の累積成績（この試行を含む）。 */
  | { kind: 'feedback'; stage: StageId; record: TrialRecord; math: MathTally; summary: PracticeSummary | null }
  | { kind: 'done'; result: FlowResult };

export interface FlowOptions {
  mode: FlowMode;
  /** mode が setup のとき、行う練習。 */
  step?: PracticeStep;
  /** クイックモードの繰り返し数（系列長 3〜7 を各 reps 回）。 */
  reps: 1 | 2 | 3;
  /** 保存済みの制限時間（ms）。クイックと Setup の複合練習で使う。 */
  timeLimit: number | null;
  clock: Clock;
  rng: Rng;
  onChange: () => void;
  /** 練習のブロックが終わるたびに呼ばれる。 */
  onStageDone?: (done: StageDone) => void;
}

const MATH_PRACTICE = (n: number): TrialSpec[] =>
  Array.from({ length: n }, () => ({ setSize: 1, math: true, letters: false, timeLimit: null }));

const both = (sizes: number[], limit: number): TrialSpec[] =>
  sizes.map((setSize) => ({ setSize, math: true, letters: true, timeLimit: limit }));

const LETTERS_PRACTICE = (sizes: number[]): TrialSpec[] =>
  sizes.map((setSize) => ({ setSize, math: false, letters: true, timeLimit: null }));

function stagePlans(opts: FlowOptions): StagePlan[] {
  const plan = formalPlan(opts.rng);
  const lettersPractice: StagePlan = {
    id: 'lettersPractice',
    intro: true,
    feedback: true,
    scored: false,
    specs: () => LETTERS_PRACTICE(plan.lettersPractice),
  };
  const mathPractice: StagePlan = {
    id: 'mathPractice',
    intro: true,
    feedback: true,
    scored: false,
    specs: () => MATH_PRACTICE(plan.mathPracticeCount),
  };
  const bothPractice: StagePlan = {
    id: 'bothPractice',
    intro: true,
    feedback: true,
    scored: false,
    specs: (limit) => both(plan.bothPractice, limit),
  };

  if (opts.mode === 'setup') {
    const step = opts.step ?? 'mathPractice';
    return [step === 'lettersPractice' ? lettersPractice : step === 'bothPractice' ? bothPractice : mathPractice];
  }
  if (opts.mode === 'formal') {
    // 原著の順: 文字 → 計算 → 複合 → 本番
    return [
      lettersPractice,
      mathPractice,
      bothPractice,
      { id: 'main', intro: true, feedback: true, scored: true, specs: (limit) => both(plan.main, limit) },
    ];
  }
  // クイックは練習済み（Setup 完了）が前提。本番だけを行う
  const sizes = quickSetSizes(opts.reps, opts.rng);
  return [{ id: 'quick', intro: false, feedback: true, scored: true, specs: (limit) => both(sizes, limit) }];
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
  private stageMath: MathTally = { correct: 0, total: 0 };
  private stageLetters = { correct: 0, total: 0 };
  private lastStageDone: StageDone | null = null;
  private recallTrials = 0;
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
    this.stageMath = { correct: 0, total: 0 };
    this.stageLetters = { correct: 0, total: 0 };
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
          this.setView({
            kind: 'trial',
            stage: stage.id,
            trial: runner.view,
            recallHint: this.recallTrials < RECALL_HINT_TRIALS,
          });
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
    if (record.spec.letters) {
      this.recallTrials++;
      this.stageLetters.correct += record.score.lettersCorrect;
      this.stageLetters.total += record.score.setSize;
    }
    this.stageMath.total += record.math.length;
    this.stageMath.correct += record.math.filter((m) => m.result === 'correct').length;
    // 計算練習の最後の 1 問には、制限時間も添えたまとめを出す
    const summary =
      stage.id === 'mathPractice' && this.trialIndex === this.specs.length - 1
        ? { timeLimit: computeTimeLimit(this.practiceRts()) }
        : null;
    if (stage.feedback || summary) {
      this.setView({ kind: 'feedback', stage: stage.id, record, math: { ...this.stageMath }, summary });
    } else this.advance();
  }

  private advance(): void {
    this.trialIndex++;
    if (this.trialIndex < this.specs.length) {
      this.startTrial();
      return;
    }
    if (this.stage.id === 'mathPractice') this.finishCalibration();
    this.finishStage();
    this.stageIndex++;
    if (this.stageIndex < this.stages.length) this.enterStage();
    else this.finish();
  }

  /** ブロックが 1 つ終わった。ここで通知して、呼び出し側が保存する。 */
  private finishStage(): void {
    const done: StageDone = {
      stage: this.stage.id,
      calibration: this.stage.id === 'mathPractice' ? this.newCalibration : null,
      math: { ...this.stageMath },
      letters: { ...this.stageLetters },
      at: new Date().toISOString(),
    };
    this.lastStageDone = done;
    // 本番（成績は結果画面のあとで保存）とクイックは、練習の完了ではないので通知しない
    if (this.stage.id !== 'main' && this.stage.id !== 'quick') this.opts.onStageDone?.(done);
  }

  /** 計算練習で正答した試行の反応時間から、本番の制限時間を決める。 */
  private finishCalibration(): void {
    const cal = calibrate(this.practiceRts(), this.mathPracticeRecords.length, new Date());
    this.newCalibration = cal;
    this.timeLimit = cal?.timeLimit ?? FALLBACK_TIME_LIMIT;
  }

  /** 計算練習で正答した試行の反応時間（ms）。 */
  private practiceRts(): number[] {
    return this.mathPracticeRecords.flatMap((r) =>
      r.math.flatMap((m) => (m.result === 'correct' && m.rt !== null ? [m.rt] : [])),
    );
  }

  private finish(): void {
    const result: FlowResult = {
      mode: this.opts.mode,
      practice: this.opts.mode === 'setup' ? this.lastStageDone : null,
      trials: this.scored,
      session: scoreSession(
        this.scored.map((r) => ({
          presented: r.presented,
          recalled: r.recalled,
          math: r.math.map((m) => m.result),
          timedOut: r.math.map((m) => m.timedOut),
        })),
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
