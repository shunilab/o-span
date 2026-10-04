import { shuffle, type Rng } from './random';

export const MAIN_SET_SIZES = [3, 4, 5, 6, 7] as const;

export interface FormalPlan {
  /** 文字のみの練習（系列長）。 */
  lettersPractice: number[];
  /** 計算のみの練習の問題数。制限時間なし。 */
  mathPracticeCount: number;
  /** 計算＋文字の練習（系列長）。ここから制限時間がかかる。 */
  bothPractice: number[];
  /** 本番（系列長）。3〜7 を各 3 回、シャッフル。 */
  main: number[];
}

export function formalPlan(rng: Rng): FormalPlan {
  return {
    lettersPractice: shuffle(rng, [2, 2, 3, 3]),
    mathPracticeCount: 15,
    bothPractice: [2, 2, 2],
    main: shuffle(rng, Array.from({ length: 3 }, () => [...MAIN_SET_SIZES]).flat()),
  };
}

/** クイックモードの系列長。3〜7 を reps 回ずつ、シャッフル。 */
export function quickSetSizes(reps: 1 | 2 | 3, rng: Rng): number[] {
  return shuffle(rng, Array.from({ length: reps }, () => [...MAIN_SET_SIZES]).flat());
}
