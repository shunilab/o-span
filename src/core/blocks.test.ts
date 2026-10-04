import { describe, expect, it } from 'vitest';
import { formalPlan, quickSetSizes } from './blocks';
import { seededRng } from './random';

const count = (xs: number[]) => {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

describe('formalPlan', () => {
  const plan = formalPlan(seededRng(3));

  it('練習ブロックの構成', () => {
    // 元実装と同じ固定順（入れ替えない）
    expect(plan.lettersPractice).toEqual([2, 2, 3, 3]);
    expect(plan.mathPracticeCount).toBe(15);
    expect(plan.bothPractice).toEqual([2, 2, 2]);
  });

  it('本番は 3〜7 を各 3 回、計 15 試行', () => {
    expect(plan.main).toHaveLength(15);
    const c = count(plan.main);
    for (const n of [3, 4, 5, 6, 7]) expect(c.get(n)).toBe(3);
  });

  it('本番の満点は 75 点', () => {
    expect(plan.main.reduce((a, b) => a + b, 0)).toBe(75);
  });
});

describe('quickSetSizes', () => {
  it('reps に応じて 3〜7 を各 reps 回', () => {
    for (const reps of [1, 2, 3] as const) {
      const sizes = quickSetSizes(reps, seededRng(4));
      expect(sizes).toHaveLength(5 * reps);
      const c = count(sizes);
      for (const n of [3, 4, 5, 6, 7]) expect(c.get(n)).toBe(reps);
    }
  });

  it('既定の 1 回分は満点 25 点', () => {
    expect(quickSetSizes(1, seededRng(5)).reduce((a, b) => a + b, 0)).toBe(25);
  });
});
