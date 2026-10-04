import { describe, expect, it } from 'vitest';
import { FakeClock } from './fakeClock';
import { Flow, type FlowOptions, type FlowView } from './flow';
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

  it('制限時間は保存済みの値が使われ、時間切れは speed error になる', () => {
    const { flow, clock } = make({ timeLimit: 2000 });
    flow.start();
    // 何も押さずに 2 秒待つ → 時間切れで文字へ
    clock.advance(2000);
    expect(kindOf(flow.view)).toBe('trial:letter');
  });
});

describe('Flow クイックモード（キャリブレーションなし）', () => {
  it('計算練習 15 問 → まとめ → 本番の説明 → 本番', () => {
    const { flow, clock } = make({ timeLimit: null });
    flow.start();
    expect(kindOf(flow.view)).toBe('intro');
    if (flow.view.kind === 'intro') expect(flow.view.stage).toBe('mathPractice');
    flow.next();
    // 計算練習は元実装どおり、1 問ごとにフィードバックを出し、Next で次へ進む
    for (let i = 0; i < 15; i++) {
      expect(kindOf(flow.view)).toBe('trial:math');
      if (flow.view.kind === 'trial') expect(flow.view.stage).toBe('mathPractice');
      clock.advance(1500);
      flow.solved();
      flow.judge(true);
      expect(flow.view.kind).toBe('feedback');
      if (i < 14) {
        if (flow.view.kind === 'feedback') expect(flow.view.summary).toBeNull();
        flow.next();
      }
    }
    // 最後の 1 問のフィードバックには、制限時間を添えたまとめが付く
    expect(flow.view.kind).toBe('feedback');
    if (flow.view.kind === 'feedback') {
      expect(flow.view.summary).not.toBeNull();
      expect(flow.view.math.total).toBe(15);
      // 反応時間はすべて 1500ms（SD 0）なので、制限時間も 1500ms
      expect(flow.view.summary?.timeLimit).toBe(1500);
    }
    flow.next();
    // 複合課題に切り替わる前に説明を出す（突然始めない）
    expect(kindOf(flow.view)).toBe('intro');
    if (flow.view.kind === 'intro') expect(flow.view.stage).toBe('quick');
    flow.next();
    expect(kindOf(flow.view)).toBe('trial:math');
    if (flow.view.kind === 'trial') expect(flow.view.stage).toBe('quick');
    clock.advance(1499);
    expect(kindOf(flow.view)).toBe('trial:math');
    clock.advance(1);
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
    const { flow, clock } = make({ timeLimit: null });
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

describe('Flow キャリブレーションのみ', () => {
  it('計算練習 15 問だけ行い、制限時間を取って終わる（得点なし）', () => {
    const { flow, clock } = make({ calibrationOnly: true, timeLimit: 9999 });
    flow.start();
    expect(kindOf(flow.view)).toBe('intro');
    flow.next();
    for (let i = 0; i < 15; i++) {
      clock.advance(1500);
      flow.solved();
      flow.judge(true);
      flow.next();
    }
    expect(flow.view.kind).toBe('done');
    if (flow.view.kind === 'done') {
      expect(flow.view.result.trials).toEqual([]);
      expect(flow.view.result.calibration?.timeLimit).toBe(1500);
      expect(flow.view.result.timeLimit).toBe(1500);
    }
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
