import { BLANK } from './letters';

/** 計算 1 問の結果。timeout は制限時間切れ（原著の speed error）、wrong は判定ミス（accuracy error）。 */
export type MathResult = 'correct' | 'wrong' | 'timeout';

export interface TrialInput {
  presented: readonly string[];
  recalled: readonly string[];
  math: readonly MathResult[];
}

export interface TrialScore {
  setSize: number;
  lettersCorrect: number;
  mathCorrect: number;
  mathTotal: number;
  speedErrors: number;
  accuracyErrors: number;
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
  const speedErrors = math.filter((m) => m === 'timeout').length;
  const accuracyErrors = math.filter((m) => m === 'wrong').length;
  return {
    setSize,
    lettersCorrect,
    mathCorrect,
    mathTotal: math.length,
    speedErrors,
    accuracyErrors,
    perfect: lettersCorrect === setSize && speedErrors + accuracyErrors === 0,
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
  speedErrors: number;
  accuracyErrors: number;
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
    speedErrors: sum((s) => s.speedErrors),
    accuracyErrors: sum((s) => s.accuracyErrors),
  };
}
