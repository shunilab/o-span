import { describe, expect, it } from 'vitest';
import { generateProblem } from './math';
import { seededRng } from './random';

describe('generateProblem', () => {
  const rng = seededRng(1);
  const problems = Array.from({ length: 5000 }, () => generateProblem(rng));

  it('答えは 1〜9、提示値は 1〜10 に収まる', () => {
    for (const p of problems) {
      expect(p.answer).toBeGreaterThanOrEqual(1);
      expect(p.answer).toBeLessThanOrEqual(9);
      expect(Number.isInteger(p.answer)).toBe(true);
      expect(p.shown).toBeGreaterThanOrEqual(1);
      expect(p.shown).toBeLessThanOrEqual(10);
    }
  });

  it('isTrue は shown と answer の一致と対応する', () => {
    for (const p of problems) expect(p.isTrue).toBe(p.shown === p.answer);
  });

  it('正しい答えと誤った答えが約半々で出る', () => {
    const trueRate = problems.filter((p) => p.isTrue).length / problems.length;
    expect(trueRate).toBeGreaterThan(0.45);
    expect(trueRate).toBeLessThan(0.55);
  });

  it('式の文字列が (a op1 b) op2 c = ? の形式', () => {
    for (const p of problems) expect(p.text).toBe(`(${p.a} ${p.op1} ${p.b}) ${p.op2} ${p.c} = ?`);
    expect(problems.every((p) => /^\(\d+ [×÷] [12]\) [+−] [1-5] = \?$/.test(p.text))).toBe(true);
  });

  it('a は 2,4,6,8,10 がほぼ一様に出る', () => {
    const counts = new Map<number, number>();
    for (const p of problems) counts.set(p.a, (counts.get(p.a) ?? 0) + 1);
    expect([...counts.keys()].sort((x, y) => x - y)).toEqual([2, 4, 6, 8, 10]);
    // 答えの範囲による棄却があるので完全には一様でないが、両端が極端に少なくはならない
    for (const n of counts.values()) expect(n).toBeGreaterThan(problems.length * 0.1);
  });
});
