import { describe, expect, it } from 'vitest';
import { FakeClock } from './fakeClock';
import { Flow, type FlowOptions, type FlowView, type StageDone } from './flow';
import { seededRng } from './random';
import { LETTER_MS } from './trial';

function make(over: Partial<FlowOptions> = {}) {
  const clock = new FakeClock();
  const flow: Flow = new Flow({
    mode: 'quick',
    reps: 1,
    timeLimit: 3000,
    clock,
    rng: seededRng(11),
    onChange: () => {},
    ...over,
  });
  return { clock, flow };
}

/** 現在の trial を完全正答で進める。flow.view が trial の間、フィードバックまで進める。 */
function playTrial(flow: Flow, clock: FakeClock, rtMs = 1000): void {
  let guard = 0;
  while (flow.view.kind === 'trial' && guard++ < 200) {
    const v = flow.view.trial;
    if (v.kind === 'math') {
      clock.advance(rtMs);
      flow.solved();
    } else if (v.kind === 'judge') {
      // 正しく判定するため、提示が正しいかを知る必要があるが Flow は公開しない。
      // 判定結果は検証せず true で進める（正誤は別テストで確認）。
      flow.judge(true);
    } else if (v.kind === 'letter') {
      clock.advance(LETTER_MS);
    } else {
      flow.submit([]);
    }
  }
}

const kindOf = (v: FlowView): string => (v.kind === 'trial' ? `trial:${v.trial.kind}` : v.kind);

describe('Flow クイックモード（キャリブレーション済み）', () => {
  it('説明なしで即座に最初の計算が出る', () => {
    const { flow } = make();
    flow.start();
    expect(kindOf(flow.view)).toBe('trial:math');
  });

  it('5 試行（3〜7 を各 1 回）を終えると結果になる', () => {
    const { flow, clock } = make();
    flow.start();
    const sizes: number[] = [];
    for (let i = 0; i < 5; i++) {
      playTrial(flow, clock);
      expect(flow.view.kind).toBe('feedback');
      if (flow.view.kind === 'feedback') sizes.push(flow.view.record.spec.setSize);
      flow.next();
    }
    expect(sizes.sort()).toEqual([3, 4, 5, 6, 7]);
    expect(flow.view.kind).toBe('done');
    if (flow.view.kind === 'done') {
      expect(flow.view.result.mode).toBe('quick');
      expect(flow.view.result.session.maxScore).toBe(25);
      expect(flow.view.result.session.trials).toBe(5);
      expect(flow.view.result.calibration).toBeNull();
      expect(flow.view.result.timeLimit).toBe(3000);
    }
  });

  it('制限時間は保存済みの値が使われ、時間切れで判定画面へ進む（判定は選べる）', () => {
    const { flow, clock } = make({ timeLimit: 2000 });
    flow.start();
    // 何も押さずに 2 秒待つ → 強制的に判定画面へ
    clock.advance(1999);
    expect(kindOf(flow.view)).toBe('trial:math');
    clock.advance(1);
    expect(kindOf(flow.view)).toBe('trial:judge');
    flow.judge(true);
    expect(kindOf(flow.view)).toBe('trial:letter');
  });
});

describe('Flow 正式モード', () => {
  it('文字練習 → 計算練習 → 複合練習 → 本番 の順で、各ブロックの前に説明が出る', () => {
    const { flow, clock } = make({ mode: 'formal', timeLimit: null });
    flow.start();
    const stages: string[] = [];
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 500) {
      if (flow.view.kind === 'intro') {
        stages.push(flow.view.stage);
        flow.next();
      } else if (flow.view.kind === 'feedback') {
        flow.next();
      } else {
        playTrial(flow, clock, 1000);
      }
    }
    expect(stages).toEqual(['lettersPractice', 'mathPractice', 'bothPractice', 'main']);
    expect(flow.view.kind).toBe('done');
    if (flow.view.kind === 'done') {
      expect(flow.view.result.mode).toBe('formal');
      expect(flow.view.result.session.trials).toBe(15);
      expect(flow.view.result.session.maxScore).toBe(75);
    }
  });

  it('練習ブロックは得点に含まれない', () => {
    const { flow, clock } = make({ mode: 'formal', timeLimit: null });
    flow.start();
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 500) {
      if (flow.view.kind === 'intro' || flow.view.kind === 'feedback') flow.next();
      else playTrial(flow, clock, 1000);
    }
    if (flow.view.kind === 'done') {
      expect(flow.view.result.trials).toHaveLength(15);
      expect(flow.view.result.calibration?.problems).toBe(15);
    }
  });
});

describe('Flow フィードバック', () => {
  it('計算練習は 1 問ごとにフィードバックを出し、累積の問題数が増えていく', () => {
    const { flow, clock } = make({ mode: 'setup', step: 'mathPractice', timeLimit: null });
    flow.start();
    flow.next();
    const totals: number[] = [];
    for (let i = 0; i < 3; i++) {
      clock.advance(1000);
      flow.solved();
      flow.judge(true);
      if (flow.view.kind === 'feedback') {
        totals.push(flow.view.math.total);
        expect(flow.view.math.correct).toBeLessThanOrEqual(flow.view.math.total);
      }
      flow.next();
    }
    expect(totals).toEqual([1, 2, 3]);
  });

  it('累積はブロックごとに数え直す（正式モードの複合練習と本番）', () => {
    const { flow, clock } = make({ mode: 'formal', timeLimit: null });
    flow.start();
    const lastTotal: Record<string, number> = {};
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 500) {
      if (flow.view.kind === 'intro') flow.next();
      else if (flow.view.kind === 'feedback') {
        lastTotal[flow.view.stage] = flow.view.math.total;
        flow.next();
      } else playTrial(flow, clock, 1000);
    }
    expect(lastTotal.bothPractice).toBe(6); // 2+2+2 問
    expect(lastTotal.main).toBe(75); // 3+4+5+6+7 を 3 回
    expect(lastTotal.mathPractice).toBe(15);
    expect(lastTotal.lettersPractice).toBe(0);
  });

  it('想起の操作説明は、セッションの最初の 3 回だけ出す', () => {
    const { flow, clock } = make();
    flow.start();
    const hints: boolean[] = [];
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 500) {
      const v = flow.view;
      if (v.kind === 'feedback') flow.next();
      else if (v.kind === 'trial' && v.trial.kind === 'recall') {
        hints.push(v.recallHint);
        flow.submit([]);
      } else if (v.kind === 'trial' && v.trial.kind === 'math') {
        clock.advance(500);
        flow.solved();
      } else if (v.kind === 'trial' && v.trial.kind === 'judge') flow.judge(true);
      else if (v.kind === 'trial') clock.advance(LETTER_MS);
    }
    expect(hints).toEqual([true, true, true, false, false]);
  });
});

describe('Flow Setup（練習を 1 つだけ単独で行う）', () => {
  /** 試行を最後まで進める（フィードバックは Next で送る）。 */
  function runToEnd(flow: Flow, clock: FakeClock, rt = 1500): void {
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 500) {
      const v = flow.view;
      if (v.kind === 'intro' || v.kind === 'feedback') flow.next();
      else if (v.kind === 'trial' && v.trial.kind === 'math') {
        clock.advance(rt);
        flow.solved();
      } else if (v.kind === 'trial' && v.trial.kind === 'judge') flow.judge(true);
      else if (v.kind === 'trial' && v.trial.kind === 'letter') clock.advance(LETTER_MS);
      else if (v.kind === 'trial') flow.submit([]);
    }
  }

  function setup(step: 'mathPractice' | 'lettersPractice' | 'bothPractice', timeLimit: number | null) {
    const done: StageDone[] = [];
    const { flow, clock } = make({ mode: 'setup', step, timeLimit, onStageDone: (d) => done.push(d) });
    return { flow, clock, done };
  }

  it('Math practice: 15 問 → 制限時間を保存 → 終了（成績は残さない）', () => {
    const { flow, clock, done } = setup('mathPractice', null);
    flow.start();
    expect(kindOf(flow.view)).toBe('intro');
    runToEnd(flow, clock, 1500);
    expect(done).toHaveLength(1);
    expect(done[0]?.stage).toBe('mathPractice');
    expect(done[0]?.calibration?.timeLimit).toBe(1500);
    expect(done[0]?.math.total).toBe(15);
    expect(flow.view.kind).toBe('done');
    if (flow.view.kind === 'done') {
      expect(flow.view.result.mode).toBe('setup');
      expect(flow.view.result.trials).toEqual([]);
      expect(flow.view.result.practice?.stage).toBe('mathPractice');
    }
  });

  it('Letters practice: 4 セット（計 10 文字）だけ行う。計算は出ない', () => {
    const { flow, clock, done } = setup('lettersPractice', null);
    flow.start();
    const kinds = new Set<string>();
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 500) {
      if (flow.view.kind === 'trial') kinds.add(flow.view.trial.kind);
      const v = flow.view;
      if (v.kind === 'intro' || v.kind === 'feedback') flow.next();
      else if (v.kind === 'trial' && v.trial.kind === 'letter') clock.advance(LETTER_MS);
      else if (v.kind === 'trial') flow.submit([]);
    }
    expect([...kinds].sort()).toEqual(['letter', 'recall']);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ stage: 'lettersPractice', calibration: null, letters: { correct: 0, total: 10 } });
  });

  it('Math + Letters practice: 保存済みの制限時間で 3 セット（計算 6 問）を行う', () => {
    const { flow, clock, done } = setup('bothPractice', 2000);
    flow.start();
    flow.next();
    clock.advance(1999);
    expect(kindOf(flow.view)).toBe('trial:math');
    clock.advance(1);
    expect(kindOf(flow.view)).toBe('trial:judge');
    flow.judge(true);
    runToEnd(flow, clock, 500);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ stage: 'bothPractice', calibration: null });
    expect(done[0]?.math.total).toBe(6);
  });

  it('途中でやめたら、終わっていない練習は通知されない', () => {
    const { flow, clock, done } = setup('mathPractice', null);
    flow.start();
    flow.next();
    for (let i = 0; i < 5; i++) {
      clock.advance(1000);
      flow.solved();
      flow.judge(true);
      flow.next();
    }
    flow.cancel();
    clock.advance(10_000);
    expect(done).toEqual([]);
  });
});

describe('Flow 正式モードの区切りごとの保存通知', () => {
  it('練習が 1 つ終わるたびに通知し、本番では通知しない（文字 → 計算 → 複合）', () => {
    const done: StageDone[] = [];
    const { flow, clock } = make({ mode: 'formal', timeLimit: null, onStageDone: (d) => done.push(d) });
    flow.start();
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 800) {
      const v = flow.view;
      if (v.kind === 'intro' || v.kind === 'feedback') flow.next();
      else if (v.kind === 'trial' && v.trial.kind === 'math') {
        clock.advance(1000);
        flow.solved();
      } else if (v.kind === 'trial' && v.trial.kind === 'judge') flow.judge(true);
      else if (v.kind === 'trial' && v.trial.kind === 'letter') clock.advance(LETTER_MS);
      else if (v.kind === 'trial') flow.submit([]);
    }
    expect(done.map((d) => d.stage)).toEqual(['lettersPractice', 'mathPractice', 'bothPractice']);
    expect(done[1]?.calibration).not.toBeNull();
  });

  it('途中でやめても、終わった練習は通知済み（保存される）', () => {
    const done: StageDone[] = [];
    const { flow, clock } = make({ mode: 'formal', timeLimit: null, onStageDone: (d) => done.push(d) });
    flow.start();
    let guard = 0;
    // 文字練習が終わって、計算練習の説明に着くまで進める
    while (!(flow.view.kind === 'intro' && flow.view.stage === 'mathPractice') && guard++ < 200) {
      const v = flow.view;
      if (v.kind === 'intro' || v.kind === 'feedback') flow.next();
      else if (v.kind === 'trial' && v.trial.kind === 'letter') clock.advance(LETTER_MS);
      else if (v.kind === 'trial') flow.submit([]);
    }
    flow.cancel();
    expect(done.map((d) => d.stage)).toEqual(['lettersPractice']);
  });

  it('クイックは練習を行わず、通知もない', () => {
    const done: StageDone[] = [];
    const { flow, clock } = make({ timeLimit: 3000, onStageDone: (d) => done.push(d) });
    flow.start();
    expect(kindOf(flow.view)).toBe('trial:math');
    let guard = 0;
    while (flow.view.kind !== 'done' && guard++ < 800) {
      const v = flow.view;
      if (v.kind === 'feedback') flow.next();
      else if (v.kind === 'trial' && v.trial.kind === 'math') {
        clock.advance(500);
        flow.solved();
      } else if (v.kind === 'trial' && v.trial.kind === 'judge') flow.judge(true);
      else if (v.kind === 'trial' && v.trial.kind === 'letter') clock.advance(LETTER_MS);
      else if (v.kind === 'trial') flow.submit([]);
    }
    expect(done).toEqual([]);
  });
});

describe('Flow cancel', () => {
  it('cancel 後はタイマーが進んでも画面が変わらない', () => {
    const { flow, clock } = make();
    flow.start();
    flow.cancel();
    const before = kindOf(flow.view);
    clock.advance(10_000);
    expect(kindOf(flow.view)).toBe(before);
  });
});
