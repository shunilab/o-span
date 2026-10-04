import { describe, expect, it } from 'vitest';
import { computeTimeLimit } from './calibration';

describe('computeTimeLimit', () => {
  it('平均 + 2.5 × 母標準偏差を丸める', () => {
    // 平均 3000、母分散 (1000²+0+1000²)/3 = 666666.67、SD ≈ 816.50
    expect(computeTimeLimit([2000, 3000, 4000])).toBe(Math.round(3000 + 2.5 * Math.sqrt(2_000_000 / 3)));
    expect(computeTimeLimit([2000, 3000, 4000])).toBe(5041);
  });

  it('値が 1 つなら SD は 0 で、その値になる', () => {
    expect(computeTimeLimit([1800])).toBe(1800);
  });

  it('正答が 0 件なら null', () => {
    expect(computeTimeLimit([])).toBeNull();
  });
});
