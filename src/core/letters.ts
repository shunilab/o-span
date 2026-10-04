import { sample, type Rng } from './random';

export const LETTERS = ['F', 'H', 'J', 'K', 'L', 'N', 'P', 'Q', 'R', 'S', 'T', 'Y'] as const;

/** 想起画面で「分からない位置」に入れる記号。常に不正解として扱う。 */
export const BLANK = '?';

/** 重複なしで n 文字を選ぶ。 */
export function sampleLetters(n: number, rng: Rng): string[] {
  return sample(rng, LETTERS, n);
}
