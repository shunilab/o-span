import { BLANK } from './letters';

/**
 * 計算 1 問の結果。判定（True / False）の正否だけで決まる。
 * 制限時間を過ぎても判定画面に進み、判定が合っていれば correct（元実装 = PsyToolkit と同じ）。
 */
export type MathResult = 'correct' | 'wrong';

export interface TrialInput {
  presented: readonly string[];
  recalled: readonly string[];
  math: readonly MathResult[];
  /** 各問で制限時間を過ぎたか。誤りには数えず、参考として記録する。 */
  timedOut?: readonly boolean[];
}

export interface TrialScore {
  setSize: number;
  lettersCorrect: number;
  mathCorrect: number;
  mathTotal: number;
  /** 計算の誤り（判定ミス）の数。 */
  mathErrors: number;
  /** 制限時間を過ぎた問題の数。誤りには数えない。 */
  timeouts: number;
  /** 計算の誤りが 0 かつ全文字が正しい位置で想起できた。 */
  perfect: boolean;
}

export function scoreTrial(trial: TrialInput): TrialScore {
  const { presented, recalled, math } = trial;
  const setSize = presented.length;
  let lettersCorrect = 0;
  for (let i = 0; i < setSize; i++) {
    const r = recalled[i];
    if (r !== undefined && r !== BLANK && r === presented[i]) lettersCorrect++;
  }
  const mathCorrect = math.filter((m) => m === 'correct').length;
  const mathErrors = math.filter((m) => m === 'wrong').length;
  const timeouts = (trial.timedOut ?? []).filter(Boolean).length;
  return {
    setSize,
    lettersCorrect,
    mathCorrect,
    mathTotal: math.length,
    mathErrors,
    timeouts,
    perfect: lettersCorrect === setSize && mathErrors === 0,
  };
}

export interface SessionScore {
  /** absolute スコア: 完全正答した試行の系列長の合計。 */
  score: number;
  /** そのセッションの満点（全試行の系列長の合計）。 */
  maxScore: number;
  trials: number;
  perfectTrials: number;
  /** 完全正答した試行の割合（0〜1）。 */
  perfectRate: number;
  /** 計算の正答率（0〜1）。 */
  mathAccuracy: number;
  /** 文字単位の正答率（0〜1）。 */
  letterAccuracy: number;
  mathErrors: number;
  timeouts: number;
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

export function scoreSession(trials: readonly TrialInput[]): SessionScore {
  const scores = trials.map(scoreTrial);
  const sum = (f: (s: TrialScore) => number): number => scores.reduce((t, s) => t + f(s), 0);
  const perfectTrials = scores.filter((s) => s.perfect).length;
  return {
    score: sum((s) => (s.perfect ? s.setSize : 0)),
    maxScore: sum((s) => s.setSize),
    trials: scores.length,
    perfectTrials,
    perfectRate: ratio(perfectTrials, scores.length),
    mathAccuracy: ratio(sum((s) => s.mathCorrect), sum((s) => s.mathTotal)),
    letterAccuracy: ratio(sum((s) => s.lettersCorrect), sum((s) => s.setSize)),
    mathErrors: sum((s) => s.mathErrors),
    timeouts: sum((s) => s.timeouts),
  };
}
