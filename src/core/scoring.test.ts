import { describe, expect, it } from 'vitest';
import { scoreSession, scoreTrial, type TrialInput } from './scoring';

const ok = (n: number) => Array.from({ length: n }, () => 'correct' as const);

describe('scoreTrial', () => {
  it('全問正解なら完全正答', () => {
    const s = scoreTrial({ presented: ['F', 'H', 'J'], recalled: ['F', 'H', 'J'], math: ok(3) });
    expect(s).toMatchObject({ setSize: 3, lettersCorrect: 3, mathCorrect: 3, perfect: true });
  });

  it('1 文字違うと完全正答にならず、他の文字は数える', () => {
    const s = scoreTrial({ presented: ['F', 'H', 'J'], recalled: ['F', 'K', 'J'], math: ok(3) });
    expect(s.lettersCorrect).toBe(2);
    expect(s.perfect).toBe(false);
  });

  it('順序が違うと位置が合わない文字は正解にならない', () => {
    const s = scoreTrial({ presented: ['F', 'H', 'J'], recalled: ['H', 'F', 'J'], math: ok(3) });
    expect(s.lettersCorrect).toBe(1);
  });

  it('? は常に不正解', () => {
    const s = scoreTrial({ presented: ['F', 'H', 'J'], recalled: ['F', '?', 'J'], math: ok(3) });
    expect(s.lettersCorrect).toBe(2);
    expect(s.perfect).toBe(false);
  });

  it('入力が足りない位置は不正解', () => {
    const s = scoreTrial({ presented: ['F', 'H', 'J'], recalled: ['F'], math: ok(3) });
    expect(s.lettersCorrect).toBe(1);
  });

  it('文字が全部合っていても、計算の時間切れがあれば完全正答にならない（speed error）', () => {
    const s = scoreTrial({
      presented: ['F', 'H', 'J'],
      recalled: ['F', 'H', 'J'],
      math: ['correct', 'timeout', 'correct'],
    });
    expect(s).toMatchObject({ lettersCorrect: 3, speedErrors: 1, accuracyErrors: 0, perfect: false });
  });

  it('判定ミスは accuracy error として数える', () => {
    const s = scoreTrial({
      presented: ['F', 'H'],
      recalled: ['F', 'H'],
      math: ['wrong', 'correct'],
    });
    expect(s).toMatchObject({ speedErrors: 0, accuracyErrors: 1, mathCorrect: 1, mathTotal: 2, perfect: false });
  });
});

describe('scoreSession', () => {
  const trials: TrialInput[] = [
    { presented: ['F', 'H', 'J'], recalled: ['F', 'H', 'J'], math: ok(3) }, // 完全正答 3 点
    { presented: ['K', 'L', 'N', 'P'], recalled: ['K', 'L', 'N', 'Q'], math: ok(4) }, // 文字 3/4
    { presented: ['Q', 'R', 'S', 'T', 'Y'], recalled: ['Q', 'R', 'S', 'T', 'Y'], math: ['correct', 'timeout', 'correct', 'correct', 'wrong'] }, // 文字 5/5、計算 3/5
    { presented: ['F', 'H', 'J', 'K', 'L', 'N'], recalled: ['F', 'H', 'J', 'K', 'L', 'N'], math: ok(6) }, // 完全正答 6 点
  ];

  it('各値を集計する', () => {
    const s = scoreSession(trials);
    expect(s.score).toBe(9);
    expect(s.maxScore).toBe(18);
    expect(s.trials).toBe(4);
    expect(s.perfectTrials).toBe(2);
    expect(s.perfectRate).toBe(0.5);
    expect(s.letterAccuracy).toBeCloseTo(17 / 18);
    expect(s.mathAccuracy).toBeCloseTo(16 / 18);
    expect(s.speedErrors).toBe(1);
    expect(s.accuracyErrors).toBe(1);
  });

  it('試行が 0 件でも割り算で壊れない', () => {
    expect(scoreSession([])).toMatchObject({ score: 0, maxScore: 0, perfectRate: 0, mathAccuracy: 0, letterAccuracy: 0 });
  });
});
