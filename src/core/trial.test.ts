import { describe, expect, it } from 'vitest';
import { FakeClock } from './fakeClock';
import { seededRng } from './random';
import { JUDGE_LIMIT_MS, LETTER_MS, TrialRunner, type TrialRecord, type TrialSpec } from './trial';

function setup(spec: TrialSpec) {
  const clock = new FakeClock();
  const views: string[] = [];
  let record: TrialRecord | null = null;
  const runner = new TrialRunner(spec, {
    clock,
    rng: seededRng(7),
    onView: () => views.push(runner.view.kind),
    onDone: (r) => (record = r),
  });
  return { clock, runner, views, record: () => record };
}

/** 現在の問題に正しく答える。 */
function solveCorrectly(runner: TrialRunner): void {
  runner.solved();
  runner.judge(runner.currentProblem?.isTrue ?? false);
}

describe('TrialRunner（計算＋文字）', () => {
  const spec: TrialSpec = { setSize: 3, math: true, letters: true, timeLimit: 3000 };

  it('計算 → 判定 → 文字(800ms) を 3 回繰り返し、想起で終わる', () => {
    const { clock, runner, views, record } = setup(spec);
    runner.start();
    for (let i = 0; i < 3; i++) {
      expect(runner.view.kind).toBe('math');
      clock.advance(1200);
      runner.solved();
      expect(runner.view.kind).toBe('judge');
      runner.judge(true);
      expect(runner.view.kind).toBe('letter');
      clock.advance(LETTER_MS - 1);
      expect(runner.view.kind).toBe('letter');
      clock.advance(1);
    }
    expect(runner.view.kind).toBe('recall');
    expect(views.filter((v) => v === 'letter')).toHaveLength(3);
    runner.submit(['?', '?', '?']);
    expect(record()?.score.lettersCorrect).toBe(0);
    expect(record()?.math.map((m) => m.rt)).toEqual([1200, 1200, 1200]);
  });

  it('制限時間を過ぎると、強制的に判定画面へ進む（元実装と同じ）', () => {
    const { clock, runner } = setup(spec);
    runner.start();
    clock.advance(2999);
    expect(runner.view.kind).toBe('math');
    clock.advance(1);
    expect(runner.view.kind).toBe('judge');
    // 時間切れ後の Solved は無視される
    runner.solved();
    expect(runner.view.kind).toBe('judge');
  });

  it('時間切れのあとも判定は選べる。判定が合っていれば正答で、誤りにならない', () => {
    const { clock, runner, record } = setup({ ...spec, setSize: 1 });
    runner.start();
    clock.advance(3000); // 時間切れ → 判定画面
    expect(runner.view.kind).toBe('judge');
    runner.judge(runner.currentProblem?.isTrue ?? false); // 正しく判定
    expect(runner.view.kind).toBe('letter');
    clock.advance(LETTER_MS);
    runner.submit(runner.presented);
    const r = record();
    expect(r?.math[0]).toMatchObject({ result: 'correct', rt: null, timedOut: true });
    expect(r?.score).toMatchObject({ mathErrors: 0, timeouts: 1, perfect: true });
  });

  it('時間切れのあとに判定を間違えたら、その判定ミスが誤りになる', () => {
    const { clock, runner, record } = setup({ ...spec, setSize: 1 });
    runner.start();
    clock.advance(3000);
    runner.judge(!(runner.currentProblem?.isTrue ?? false)); // 間違った判定
    clock.advance(LETTER_MS);
    runner.submit(runner.presented);
    expect(record()?.score).toMatchObject({ mathErrors: 1, timeouts: 1, perfect: false });
  });

  it('判定を 60 秒放置すると不正解になって先へ進む（元実装と同じ）', () => {
    const { clock, runner, record } = setup({ ...spec, setSize: 1 });
    runner.start();
    clock.advance(1000);
    runner.solved();
    clock.advance(JUDGE_LIMIT_MS - 1);
    expect(runner.view.kind).toBe('judge');
    clock.advance(1);
    expect(runner.view.kind).toBe('letter');
    clock.advance(LETTER_MS);
    runner.submit(runner.presented);
    expect(record()?.math[0]).toMatchObject({ result: 'wrong', timedOut: false });
  });

  it('「解けた」を押すと制限時間のタイマーが止まる', () => {
    const { clock, runner } = setup(spec);
    runner.start();
    clock.advance(1000);
    runner.solved();
    clock.advance(10_000);
    expect(runner.view.kind).toBe('judge');
  });

  it('計算を全部正しく判定し、文字も全部合っていれば完全正答', () => {
    const { clock, runner, record } = setup(spec);
    runner.start();
    for (let i = 0; i < 3; i++) {
      clock.advance(500);
      solveCorrectly(runner);
      clock.advance(LETTER_MS);
    }
    runner.submit(runner.presented);
    expect(record()?.score).toMatchObject({ mathCorrect: 3, lettersCorrect: 3, perfect: true });
  });

  it('判定を間違えると計算の誤りになる', () => {
    const { clock, runner, record } = setup({ ...spec, setSize: 1 });
    runner.start();
    clock.advance(500);
    runner.solved();
    runner.judge(!(runner.currentProblem?.isTrue ?? false));
    clock.advance(LETTER_MS);
    runner.submit(runner.presented);
    expect(record()?.score).toMatchObject({ mathErrors: 1, timeouts: 0, perfect: false });
  });

  it('想起は 7 文字までで切り捨てる', () => {
    const { clock, runner, record } = setup({ setSize: 2, math: false, letters: true, timeLimit: null });
    runner.start();
    clock.advance(LETTER_MS * 2);
    runner.submit(['F', 'H', 'J', 'K', 'L', 'N', 'P', 'Q', 'R']);
    expect(record()?.recalled).toHaveLength(7);
  });

  it('終了後の操作は無視される', () => {
    const { clock, runner, record } = setup({ setSize: 2, math: false, letters: true, timeLimit: null });
    runner.start();
    clock.advance(LETTER_MS * 2);
    runner.submit(['F', 'H']);
    const first = record();
    runner.submit(['X']);
    expect(record()).toBe(first);
  });

  it('cancel するとタイマーが止まり、以後 onView が呼ばれない', () => {
    const { clock, runner, views } = setup(spec);
    runner.start();
    runner.cancel();
    const n = views.length;
    clock.advance(10_000);
    expect(views).toHaveLength(n);
  });
});

describe('TrialRunner（文字のみ／計算のみ）', () => {
  it('文字のみ: 計算を出さず文字を順に表示し、想起で終わる', () => {
    const { clock, runner, views } = setup({ setSize: 3, math: false, letters: true, timeLimit: null });
    runner.start();
    clock.advance(LETTER_MS * 3);
    expect(views).toEqual(['letter', 'letter', 'letter', 'recall']);
  });

  it('計算のみ: 1 問で終わり、制限時間はない', () => {
    const { clock, runner, record } = setup({ setSize: 1, math: true, letters: false, timeLimit: null });
    runner.start();
    clock.advance(60_000);
    expect(runner.view.kind).toBe('math');
    runner.solved();
    runner.judge(true);
    expect(record()?.math).toHaveLength(1);
    expect(record()?.math[0]?.rt).toBe(60_000);
    expect(record()?.presented).toEqual([]);
  });
});
