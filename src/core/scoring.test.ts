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

  it('時間切れは誤りではない。判定が合っていれば完全正答になる（元実装と同じ）', () => {
    const s = scoreTrial({
      presented: ['F', 'H', 'J'],
      recalled: ['F', 'H', 'J'],
      math: ['correct', 'correct', 'correct'],
      timedOut: [false, true, false],
    });
    expect(s).toMatchObject({ lettersCorrect: 3, mathErrors: 0, timeouts: 1, perfect: true });
  });

  it('時間切れのあとに判定を間違えたら、その判定ミスだけが誤りになる', () => {
    const s = scoreTrial({
      presented: ['F', 'H', 'J'],
      recalled: ['F', 'H', 'J'],
      math: ['correct', 'wrong', 'correct'],
      timedOut: [false, true, false],
    });
    expect(s).toMatchObject({ mathErrors: 1, timeouts: 1, perfect: false });
  });

  it('判定ミスは計算の誤りとして数える', () => {
    const s = scoreTrial({
      presented: ['F', 'H'],
      recalled: ['F', 'H'],
      math: ['wrong', 'correct'],
    });
    expect(s).toMatchObject({ mathErrors: 1, timeouts: 0, mathCorrect: 1, mathTotal: 2, perfect: false });
  });
});

describe('scoreSession', () => {
  const trials: TrialInput[] = [
    { presented: ['F', 'H', 'J'], recalled: ['F', 'H', 'J'], math: ok(3) }, // 完全正答 3 点
    { presented: ['K', 'L', 'N', 'P'], recalled: ['K', 'L', 'N', 'Q'], math: ok(4) }, // 文字 3/4
    { presented: ['Q', 'R', 'S', 'T', 'Y'], recalled: ['Q', 'R', 'S', 'T', 'Y'], math: ['correct', 'correct', 'correct', 'correct', 'wrong'], timedOut: [false, true, false, false, false] }, // 文字 5/5、計算 4/5（時間切れ 1 は誤りではない）
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
    expect(s.mathAccuracy).toBeCloseTo(17 / 18);
    expect(s.mathErrors).toBe(1);
    expect(s.timeouts).toBe(1);
  });

  it('試行が 0 件でも割り算で壊れない', () => {
    expect(scoreSession([])).toMatchObject({ score: 0, maxScore: 0, perfectRate: 0, mathAccuracy: 0, letterAccuracy: 0 });
  });
});

/**
 * 元実装（PsyToolkit AOSPAN のデモに埋め込まれた JS）の採点規則を、そのまま書き起こした照合用の実装。
 *  - 計算: 判定の正否だけで決まる（Gb に 1 / 0 を積む）。時間切れは見ない
 *  - 文字: 位置ごとに Jb[i] === Hb[i] を数える（? は 13 番で、どの文字とも一致しない）
 *  - 満点の試行: M === 0（計算の誤り 0）かつ I === H（全文字正解）のとき、vb += H
 *  - 計算の正答率: Z（問題ごとの 1 / 0）の平均、文字の正答率: Lb（文字位置ごとの 1 / 0）の平均
 */
function originalScoring(trials: { presented: string[]; recalled: string[]; judgeCorrect: boolean[] }[]) {
  let vb = 0;
  const Z: number[] = [];
  const Lb: number[] = [];
  let maxScore = 0;
  for (const t of trials) {
    const H = t.presented.length;
    const Gb: number[] = t.judgeCorrect.map((c) => (c ? 1 : 0));
    const V = Gb.reduce((a, b) => a + b, 0);
    const M = H - V;
    let I = 0;
    for (let i = 0; i < H; i++) {
      const hit = t.recalled[i] !== undefined && t.recalled[i] !== '?' && t.recalled[i] === t.presented[i];
      Lb.push(hit ? 1 : 0);
      if (hit) I += 1;
    }
    Z.push(...Gb);
    if (M === 0 && I === H) vb += H;
    maxScore += H;
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { score: vb, maxScore, mathAccuracy: mean(Z), letterAccuracy: mean(Lb) };
}

describe('元実装の採点規則との照合', () => {
  const LET = ['F', 'H', 'J', 'K', 'L', 'N', 'P', 'Q', 'R', 'S', 'T', 'Y'];
  // 再現できる簡易な乱数
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  it('ランダムな 200 セッションで、点数・計算の正答率・文字の正答率が一致する', () => {
    for (let n = 0; n < 200; n++) {
      const raw = [3, 4, 5, 6, 7, 3, 4, 5].map((size) => {
        const presented = Array.from({ length: size }, () => LET[Math.floor(rnd() * LET.length)] as string);
        // 想起: 正しい文字・誤った文字・? をランダムに混ぜ、長さも変える
        const recalled = presented.map((c) => {
          const x = rnd();
          return x < 0.7 ? c : x < 0.85 ? '?' : (LET[Math.floor(rnd() * LET.length)] as string);
        });
        if (rnd() < 0.2) recalled.length = Math.max(0, recalled.length - 1);
        const judgeCorrect = presented.map(() => rnd() < 0.9);
        return { presented, recalled, judgeCorrect };
      });
      const expected = originalScoring(raw);
      const actual = scoreSession(
        raw.map((t) => ({
          presented: t.presented,
          recalled: t.recalled,
          math: t.judgeCorrect.map((c) => (c ? ('correct' as const) : ('wrong' as const))),
          // 時間切れはランダムに混ぜるが、採点には影響しない
          timedOut: t.judgeCorrect.map(() => rnd() < 0.3),
        })),
      );
      expect(actual.score).toBe(expected.score);
      expect(actual.maxScore).toBe(expected.maxScore);
      expect(actual.mathAccuracy).toBeCloseTo(expected.mathAccuracy, 10);
      expect(actual.letterAccuracy).toBeCloseTo(expected.letterAccuracy, 10);
    }
  });
});
