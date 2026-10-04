import { describe, expect, it } from 'vitest';
import { LETTERS, sampleLetters } from './letters';
import { seededRng } from './random';

describe('sampleLetters', () => {
  it('重複なしで、12 文字の中から n 個選ぶ', () => {
    const rng = seededRng(2);
    for (let n = 2; n <= 7; n++) {
      for (let k = 0; k < 200; k++) {
        const s = sampleLetters(n, rng);
        expect(s).toHaveLength(n);
        expect(new Set(s).size).toBe(n);
        for (const ch of s) expect(LETTERS).toContain(ch);
      }
    }
  });

  it('12 文字は F H J K L N P Q R S T Y', () => {
    expect(LETTERS.join(' ')).toBe('F H J K L N P Q R S T Y');
  });
});
