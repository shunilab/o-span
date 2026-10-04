import type { Clock } from './clock';
import { sampleLetters } from './letters';
import { generateProblem, type MathProblem } from './math';
import type { Rng } from './random';
import { scoreTrial, type MathResult, type TrialScore } from './scoring';

/** 文字を表示する時間（ms）。原著どおり 800。 */
export const LETTER_MS = 800;
/** 想起で入力できる最大文字数（原著どおり 7）。 */
export const MAX_RECALL = 7;

export interface TrialSpec {
  /** 計算の問題数／文字の数（計算のみの試行では 1）。 */
  setSize: number;
  math: boolean;
  letters: boolean;
  /** 計算の制限時間（ms）。null なら無制限。 */
  timeLimit: number | null;
}

export type TrialView =
  | { kind: 'math'; text: string }
  | { kind: 'judge'; shown: number }
  | { kind: 'letter'; letter: string }
  | { kind: 'recall' };

export interface MathRecord {
  result: MathResult;
  /** 式を表示してから「解けた」を押すまでの時間（ms）。時間切れなら null。 */
  rt: number | null;
}

export interface TrialRecord {
  spec: TrialSpec;
  presented: string[];
  recalled: string[];
  math: MathRecord[];
  /** 想起画面を出してから決定するまでの時間（ms）。 */
  recallMs: number | null;
  score: TrialScore;
}

interface Deps {
  clock: Clock;
  rng: Rng;
  onView: () => void;
  onDone: (record: TrialRecord) => void;
}

/** 1 試行（計算 → 判定 → 文字 を系列長だけ繰り返し、最後に想起）の進行を管理する。 */
export class TrialRunner {
  view: TrialView = { kind: 'recall' };

  /** 提示する文字（テスト用に公開。UI は使わない）。 */
  readonly presented: string[];
  private readonly math: MathRecord[] = [];
  private index = 0;
  private problem: MathProblem | null = null;

  /** 現在の問題（テスト用に公開。UI は使わない）。 */
  get currentProblem(): MathProblem | null {
    return this.problem;
  }

  private shownAt = 0;
  private recallAt = 0;
  private cancelTimer: (() => void) | null = null;
  private finished = false;

  constructor(
    private readonly spec: TrialSpec,
    private readonly deps: Deps,
  ) {
    this.presented = spec.letters ? sampleLetters(spec.setSize, deps.rng) : [];
  }

  start(): void {
    this.beginItem();
  }

  cancel(): void {
    this.finished = true;
    this.clearTimer();
  }

  /** 「解けた」。計算画面でのみ有効。 */
  solved(): void {
    if (this.finished || this.view.kind !== 'math' || !this.problem) return;
    this.clearTimer();
    this.math.push({ result: 'wrong', rt: this.deps.clock.now() - this.shownAt });
    this.setView({ kind: 'judge', shown: this.problem.shown });
  }

  /** True / False の判定。判定画面でのみ有効。 */
  judge(saidTrue: boolean): void {
    if (this.finished || this.view.kind !== 'judge' || !this.problem) return;
    const last = this.math[this.math.length - 1];
    if (last) last.result = saidTrue === this.problem.isTrue ? 'correct' : 'wrong';
    this.afterMath();
  }

  /** 想起の決定。想起画面でのみ有効。 */
  submit(recalled: readonly string[]): void {
    if (this.finished || this.view.kind !== 'recall') return;
    this.finish(recalled.slice(0, MAX_RECALL), this.deps.clock.now() - this.recallAt);
  }

  private beginItem(): void {
    if (this.spec.math) {
      this.problem = generateProblem(this.deps.rng);
      this.shownAt = this.deps.clock.now();
      this.setView({ kind: 'math', text: this.problem.text });
      if (this.spec.timeLimit !== null) {
        this.cancelTimer = this.deps.clock.after(this.spec.timeLimit, () => this.timeout());
      }
    } else {
      this.afterMath();
    }
  }

  /** 制限時間切れ。誤り（speed error）として数え、判定を飛ばして先へ進む。 */
  private timeout(): void {
    if (this.finished || this.view.kind !== 'math') return;
    this.cancelTimer = null;
    this.math.push({ result: 'timeout', rt: null });
    this.afterMath();
  }

  private afterMath(): void {
    if (this.spec.letters) {
      const letter = this.presented[this.index] as string;
      this.setView({ kind: 'letter', letter });
      this.cancelTimer = this.deps.clock.after(LETTER_MS, () => this.afterLetter());
    } else {
      this.nextItem();
    }
  }

  private afterLetter(): void {
    this.cancelTimer = null;
    if (this.finished) return;
    this.nextItem();
  }

  private nextItem(): void {
    this.index++;
    if (this.index < this.spec.setSize) {
      this.beginItem();
    } else if (this.spec.letters) {
      this.recallAt = this.deps.clock.now();
      this.setView({ kind: 'recall' });
    } else {
      this.finish([], null);
    }
  }

  private finish(recalled: string[], recallMs: number | null): void {
    this.finished = true;
    const score = scoreTrial({
      presented: this.presented,
      recalled,
      math: this.math.map((m) => m.result),
    });
    this.deps.onDone({
      spec: this.spec,
      presented: this.presented,
      recalled,
      math: this.math,
      recallMs,
      score,
    });
  }

  private setView(view: TrialView): void {
    this.view = view;
    this.deps.onView();
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
