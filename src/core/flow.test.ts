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
  it('計算練習 15 問 → 制限時間を保存 → 本番', () => {
    const { flow, clock } = make({ timeLimit: null });
    flow.start();
    expect(kindOf(flow.view)).toBe('intro');
    if (flow.view.kind === 'intro') expect(flow.view.stage).toBe('mathPractice');
    flow.next();
    // 計算練習 15 問 = 「解けた」と「正しい」を 15 回ずつ（フィードバックなし）
    for (let i = 0; i < 15; i++) {
      expect(kindOf(flow.view)).toBe('trial:math');
      if (flow.view.kind === 'trial') expect(flow.view.stage).toBe('mathPractice');
      clock.advance(1500);
      flow.solved();
      flow.judge(true);
    }
    // 計算練習にはフィードバックがなく、そのまま本番の最初の計算に入る
    expect(kindOf(flow.view)).toBe('trial:math');
    if (flow.view.kind === 'trial') expect(flow.view.stage).toBe('quick');
    // 制限時間は 正答の反応時間(1500ms 固定、SD 0)＝1500ms 付近。正答がなければ fallback
    clock.advance(1499);
    // 練習で judge(true) を押しただけなので正答は約半数。n が少なくても rt は同じ 1500
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
