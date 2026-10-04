/** 制限時間の係数。原著（Unsworth et al., 2005）は 2.5 SD（PsyToolkit は 2 SD）。 */
export const TIME_LIMIT_SD = 2.5;

/**
 * 計算練習で正答した試行の反応時間（ms）から、本番の制限時間（ms）を求める。
 * 制限時間 = round(平均 + 2.5 × 母標準偏差)。正答が 1 件もなければ null。
 */
export function computeTimeLimit(correctRts: readonly number[]): number | null {
  const n = correctRts.length;
  if (n === 0) return null;
  const mean = correctRts.reduce((s, x) => s + x, 0) / n;
  const variance = correctRts.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return Math.round(mean + TIME_LIMIT_SD * Math.sqrt(variance));
}

export interface Calibration {
  /** 本番の計算の制限時間（ms）。 */
  timeLimit: number;
  mean: number;
  sd: number;
  /** 平均・SD の計算に使った正答の数。 */
  n: number;
  /** 計算練習の問題数（正答率の分母）。 */
  problems: number;
  /** 実施日時（ISO 8601）。 */
  at: string;
}

/** 計算練習の結果からキャリブレーションを作る。正答が 0 件なら null。 */
export function calibrate(
  correctRts: readonly number[],
  problems: number,
  at: Date,
): Calibration | null {
  const timeLimit = computeTimeLimit(correctRts);
  if (timeLimit === null) return null;
  const n = correctRts.length;
  const mean = correctRts.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(correctRts.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return { timeLimit, mean, sd, n, problems, at: at.toISOString() };
}
