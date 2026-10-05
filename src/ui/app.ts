import { realClock } from '../core/clock';
import {
  Flow,
  type FlowMode,
  type FlowResult,
  type FlowView,
  type MathTally,
  type Mode,
  type PracticeStep,
  type PracticeSummary,
  type StageDone,
  type StageId,
} from '../core/flow';
import { LETTERS } from '../core/letters';
import { MAX_RECALL, type TrialRecord } from '../core/trial';
import { EMPTY_PRACTICE, Store, requestPersistence, type PracticeProgress, type SessionRecord } from '../storage/store';
import {
  INTRO,
  RECALL_HINT,
  SETUP_INTRO,
  SETUP_STEPS,
  dateTime,
  isLowAccuracy,
  mathAccuracyPct,
  pct,
  relativeDay,
  seconds,
  shortDate,
} from './copy';
import { demoFor } from './demo';
import { button, h } from './dom';
import { mapKey, type KeyAction, type KeyContext } from './keys';

type Screen = 'home' | 'setup' | 'flow' | 'settings';

/**
 * 画面が切り替わった直後の入力を無視する時間（ms）。
 * ボタンの位置を全画面で揃えているので、ダブルクリックや、時間切れで画面が切り替わる瞬間のクリックが、
 * 次の画面の同じ位置のボタン（Solved の次の True / False など）に当たってしまうのを防ぐ。
 */
export const INPUT_GUARD_MS = 350;

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 左に項目名、右に値。warn なら値を警告色にする。 */
function kv(label: string, value: string, warn = false): HTMLElement {
  return h('div', { class: 'kv' }, h('span', { class: 'kv-label' }, label), h('span', { class: warn ? 'kv-value error' : 'kv-value' }, value));
}

export class App {
  private screen: Screen = 'home';
  private flow: Flow | null = null;
  private flowMode: FlowMode = 'quick';
  private saved = false;
  private saveError = false;
  private entered: string[] = [];

  private lastQuick: SessionRecord | null = null;
  private calibration: Awaited<ReturnType<Store['getCalibration']>> = null;
  private notice = '';
  private confirm: 'history' | 'setup' | null = null;
  private practice: PracticeProgress = { ...EMPTY_PRACTICE };
  private persisted: boolean | null = null;
  private updateReady = false;
  /** 想起画面の入力表示を描き直す関数（画面ごとに差し替わる）。 */
  private recallDraw: (() => void) | null = null;
  /** 課題の画面が最後に切り替わった時刻。 */
  private viewAt = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: Store,
  ) {}

  async start(): Promise<void> {
    void requestPersistence().then((ok) => {
      this.persisted = ok;
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    await this.showHome();
  }

  /** 新しい版を受け取った。課題の最中は再読み込みせず、ホームに戻ったときに反映する。 */
  onUpdateReady(): void {
    this.updateReady = true;
    if (this.screen === 'home') location.reload();
  }

  private async showHome(): Promise<void> {
    if (this.updateReady) {
      location.reload();
      return;
    }
    this.flow?.cancel();
    this.flow = null;
    this.screen = 'home';
    await this.loadProgress();
    this.render();
  }

  private async loadProgress(): Promise<void> {
    [this.lastQuick, this.calibration, this.practice] = await Promise.all([
      this.store.listSessions('quick').then((l) => l[0] ?? null),
      this.store.getCalibration(),
      this.store.getPractice(),
    ]);
  }

  /** Setup（計算・文字・複合の練習）がすべて済んでいるか。済んでいないと Start は使えない。 */
  private isReady(): boolean {
    return this.calibration !== null && this.practice.letters !== null && this.practice.both !== null;
  }

  private setupDoneCount(): number {
    return [this.calibration, this.practice.letters, this.practice.both].filter((v) => v !== null).length;
  }

  private render(): void {
    const view =
      this.screen === 'home'
        ? this.renderHome()
        : this.screen === 'setup'
          ? this.renderSetup()
          : this.screen === 'settings'
            ? this.renderSettings()
            : this.renderFlow();
    this.root.replaceChildren(view);
  }

  // ---------- ホーム ----------

  private renderHome(): HTMLElement {
    const last = this.lastQuick;
    const ready = this.isReady();
    // 未完のときは、塗りのない輪郭だけの円（閉じた絞り）にして、琥珀は Setup の小さな円に移す
    const circle = h(
      'button',
      { class: ready ? 'aperture aperture-start' : 'aperture aperture-start locked', type: 'button' },
      'Start',
    );
    circle.setAttribute('aria-disabled', String(!ready));
    circle.dataset.key = 'Space';
    circle.onclick = () => this.pressStart();
    const satellite = h(
      'button',
      { class: ready ? 'satellite' : 'satellite lit', type: 'button', onclick: () => void this.showSetup() },
      h('span', { class: 'satellite-label' }, 'Setup'),
      ready ? null : h('span', { class: 'satellite-count' }, `${this.setupDoneCount()} / 3`),
    );
    return h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'home-top' },
        h('p', { class: 'aux' }, last ? `前回 ${relativeDay(last.at)}　${last.score.score} / ${last.score.maxScore}` : 'まだ記録がありません'),
        button('Settings', 'link', () => {
          this.notice = '';
          this.confirm = null;
          void this.showSettings();
        }),
      ),
      h(
        'div',
        { class: 'home-middle' },
        h('div', { class: 'home-stage' }, circle, satellite),
        h(
          'p',
          { class: 'aux home-caption' },
          ready && this.calibration ? `Time limit ${seconds(this.calibration.timeLimit)}` : 'Start は Setup が済むと使えます',
        ),
      ),
      h('div', { class: 'actions' }, button('Formal test', 'btn', () => this.startFlow('formal'))),
    );
  }

  /** ホームの Start（クリックでもキーでも）。Setup が未完なら、始めずに Setup の円で案内する。 */
  private pressStart(): void {
    if (this.isReady()) this.startQuick();
    else this.nudgeSetup();
  }

  /** 押した操作への答えとして、Setup の円と案内文を 1 回だけ強調する。ポップアップは出さない。 */
  private nudgeSetup(): void {
    const targets = this.root.querySelectorAll<HTMLElement>('.satellite, .home-caption');
    targets.forEach((el) => {
      el.classList.remove('nudge');
      void el.offsetWidth; // アニメーションを先頭から再生し直す
      el.classList.add('nudge');
    });
    setTimeout(() => targets.forEach((el) => el.classList.remove('nudge')), 1200);
  }

  /** ホームの Start（クリックでもキーでも）。円が広がってから始める。 */
  private startQuick(): void {
    const circle = this.root.querySelector<HTMLElement>('.aperture-start');
    if (circle?.classList.contains('expanding')) return;
    const go = () => this.startFlow('quick');
    if (!circle || reducedMotion()) {
      go();
      return;
    }
    circle.classList.add('expanding');
    setTimeout(go, 300);
  }

  // ---------- Setup ----------

  private async showSetup(): Promise<void> {
    if (this.updateReady) {
      location.reload();
      return;
    }
    this.flow?.cancel();
    this.flow = null;
    this.screen = 'setup';
    await this.loadProgress();
    this.render();
  }

  /** Setup の各ステップ。計算練習で決まる制限時間を使うので、複合練習は計算練習のあとから。 */
  private setupSteps(): { step: PracticeStep; at: string | null; locked: boolean }[] {
    const hasLimit = this.calibration !== null;
    return [
      { step: 'mathPractice', at: this.calibration?.at ?? null, locked: false },
      { step: 'lettersPractice', at: this.practice.letters, locked: false },
      { step: 'bothPractice', at: this.practice.both, locked: !hasLimit },
    ];
  }

  private renderSetup(): HTMLElement {
    const steps = this.setupSteps();
    const next = steps.find((s) => s.at === null && !s.locked)?.step ?? null;
    const rows = steps.map((s, i) => {
      const copy = SETUP_STEPS[s.step];
      const status = s.at ? `Done ${shortDate(s.at)}` : s.locked ? 'Needs 1' : 'Not yet';
      const row = h(
        'button',
        { class: `step${s.at ? ' done' : ''}${next === s.step ? ' next' : ''}${s.locked ? ' locked' : ''}`, type: 'button' },
        h('span', { class: 'step-n' }, s.at ? '✓' : String(i + 1)),
        h('span', { class: 'step-body' }, h('span', { class: 'step-title' }, copy.title), h('span', { class: 'step-sub' }, copy.sub)),
        h('span', { class: 'step-status' }, status),
      );
      row.setAttribute('aria-disabled', String(s.locked));
      if (!s.locked) row.dataset.key = String(i + 1);
      row.onclick = () => {
        if (!s.locked) this.startFlow('setup', s.step);
      };
      return row;
    });
    return h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'text' },
        h('h1', {}, 'Setup'),
        h('p', {}, this.isReady() ? SETUP_INTRO.done : SETUP_INTRO.todo),
        h('div', { class: 'steps' }, ...rows),
      ),
      h('div', { class: 'actions' }, button('Back', 'btn', () => void this.showHome(), 'Esc')),
    );
  }

  /** 練習・本番の中断や終了のあと、元の画面に戻る。Setup の練習なら Setup、それ以外はホーム。 */
  private leaveFlow(): void {
    if (this.flowMode === 'setup') void this.showSetup();
    else void this.showHome();
  }

  // ---------- キーボード ----------

  private keyContext(): KeyContext | null {
    if (this.screen === 'home') return 'home';
    if (this.screen === 'setup') return 'setup';
    if (this.screen === 'settings') return 'settings';
    const v = this.flow?.view;
    if (!v) return null;
    switch (v.kind) {
      case 'intro':
        return 'intro';
      case 'feedback':
        return 'feedback';
      case 'done':
        return 'done';
      case 'trial':
        return v.trial.kind;
    }
  }

  private onKey(e: KeyboardEvent): void {
    // 押しっぱなしで画面が飛ばないよう repeat は無視。ブラウザのショートカットも邪魔しない
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const ctx = this.keyContext();
    if (!ctx) return;
    const action = mapKey(ctx, e.key);
    if (!action) return;
    e.preventDefault();
    // クリックしたボタンにフォーカスが残っていると、Enter でそのボタンが再び押されてしまう
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.apply(action);
  }

  private apply(action: KeyAction): void {
    const flow = this.flow;
    // 課題の進行を動かす操作は、画面が切り替わった直後は無視する（Esc や文字入力は対象外）
    const advancing = action.type === 'primary' || action.type === 'true' || action.type === 'false' || action.type === 'submit';
    if (advancing && this.screen === 'flow' && this.guarded()) return;
    switch (action.type) {
      case 'primary': {
        if (this.screen === 'home') {
          this.pressStart();
          break;
        }
        const v = flow?.view;
        if (!flow || !v) break;
        if (v.kind === 'trial' && v.trial.kind === 'math') flow.solved();
        else if (v.kind === 'intro' || v.kind === 'feedback') flow.next();
        else if (v.kind === 'done') this.leaveFlow();
        break;
      }
      case 'quit':
        if (this.screen === 'flow') this.leaveFlow();
        else void this.showHome();
        break;
      case 'step': {
        const s = this.setupSteps()[action.n - 1];
        if (s && !s.locked) this.startFlow('setup', s.step);
        break;
      }
      case 'true':
        flow?.judge(true);
        break;
      case 'false':
        flow?.judge(false);
        break;
      case 'letter':
        this.addLetter(action.letter);
        break;
      case 'blank':
        this.addLetter('?');
        break;
      case 'clear':
        this.clearLetter();
        break;
      case 'submit':
        flow?.submit(this.entered);
        break;
    }
  }

  /** ボタンから課題を進める操作。画面が切り替わった直後なら無視する。 */
  private act(fn: () => void): void {
    if (!this.guarded()) fn();
  }

  /** 画面が切り替わった直後なら true。その間の操作は受け付けない。 */
  private guarded(): boolean {
    return performance.now() - this.viewAt < INPUT_GUARD_MS;
  }

  private addLetter(c: string): void {
    if (this.entered.length >= MAX_RECALL) return;
    this.entered.push(c);
    this.recallDraw?.();
  }

  private clearLetter(): void {
    this.entered.pop();
    this.recallDraw?.();
  }

  // ---------- セッション ----------

  private startFlow(mode: FlowMode, step?: PracticeStep): void {
    this.flowMode = mode;
    this.saved = false;
    this.saveError = false;
    this.entered = [];
    this.screen = 'flow';
    this.flow = new Flow({
      mode,
      step,
      reps: this.store.getSettings().reps,
      timeLimit: this.calibration?.timeLimit ?? null,
      clock: realClock,
      rng: Math.random,
      onChange: () => this.onFlowChange(),
      onStageDone: (done) => void this.persistStage(done),
    });
    this.flow.start();
  }

  private onFlowChange(): void {
    const flow = this.flow;
    if (!flow) return;
    if (flow.view.kind === 'trial' && flow.view.trial.kind === 'recall') this.entered = [];
    this.viewAt = performance.now();
    if (flow.view.kind === 'done' && !this.saved) {
      this.saved = true;
      void this.persistSession(flow.view.result);
    }
    this.render();
  }

  /** 練習が 1 つ終わった時点で保存する。1 項目 1 件の上書きなので、やり直しても重複しない。 */
  private async persistStage(done: StageDone): Promise<void> {
    try {
      if (done.stage === 'mathPractice' && done.calibration) {
        this.calibration = done.calibration;
        await this.store.setCalibration(done.calibration);
      } else if (done.stage === 'lettersPractice') {
        this.practice = { ...this.practice, letters: done.at };
        await this.store.markPractice('letters', done.at);
      } else if (done.stage === 'bothPractice') {
        this.practice = { ...this.practice, both: done.at };
        await this.store.markPractice('both', done.at);
      }
    } catch {
      this.saveError = true;
      this.render();
    }
  }

  /** 本番の成績を保存する（Setup の練習は persistStage で保存済み）。 */
  private async persistSession(r: FlowResult): Promise<void> {
    if (r.mode === 'setup') return;
    try {
      await this.store.addSession({
        mode: r.mode,
        at: r.at,
        timeLimit: r.timeLimit,
        score: r.session,
        trials: r.trials,
      });
    } catch {
      this.saveError = true;
      this.render();
    }
  }

  private renderFlow(): HTMLElement {
    const flow = this.flow;
    if (!flow) return h('main', { class: 'screen' });
    const v: FlowView = flow.view;
    switch (v.kind) {
      case 'intro':
        return this.renderIntro(flow, v.stage);
      case 'trial':
        return this.renderTrial(flow, v);
      case 'feedback':
        return this.renderFeedback(flow, v.record, v.math, v.summary);
      case 'done':
        return this.renderDone(v.result);
    }
  }

  private renderIntro(flow: Flow, stage: StageId): HTMLElement {
    const copy = INTRO[stage];
    const demo = demoFor(stage);
    return h(
      'main',
      { class: 'screen' },
      this.quitBar(),
      h('div', { class: 'text' }, h('h1', {}, copy.title), demo, ...copy.body.map((t) => h('p', {}, t))),
      h('div', { class: 'actions' }, button('Start', 'btn btn-main', () => this.act(() => flow.next()), 'Space')),
    );
  }

  private renderTrial(flow: Flow, v: Extract<FlowView, { kind: 'trial' }>): HTMLElement {
    const trial = v.trial;
    switch (trial.kind) {
      case 'math':
        return h(
          'main',
          { class: 'screen' },
          h('div', { class: 'stage' }, h('div', { class: 'formula' }, trial.text)),
          h('div', { class: 'actions' }, button('Solved', 'btn btn-main', () => this.act(() => flow.solved()), 'Space')),
        );
      case 'judge':
        return h(
          'main',
          { class: 'screen' },
          h('div', { class: 'stage' }, h('div', { class: 'answer' }, String(trial.shown))),
          h(
            'div',
            { class: 'actions' },
            button('True', 'btn', () => this.act(() => flow.judge(true)), 'T'),
            button('False', 'btn', () => this.act(() => flow.judge(false)), 'F'),
          ),
        );
      case 'letter':
        return h(
          'main',
          { class: 'screen' },
          h('div', { class: 'stage' }, h('div', { class: 'aperture' }, h('span', { class: 'aperture-letter' }, trial.letter))),
        );
      case 'recall':
        return this.renderRecall(flow, v.recallHint);
    }
  }

  private renderRecall(flow: Flow, hint: boolean): HTMLElement {
    const entered = h('div', { class: 'entered', ariaLabel: '入力した文字' });
    const draw = () => entered.replaceChildren(...this.entered.map((c) => h('span', {}, c)));
    draw();
    this.recallDraw = draw;
    return h(
      'main',
      { class: 'screen' },
      h('p', { class: 'aux recall-hint' }, hint ? RECALL_HINT : ''),
      h('div', { class: 'stage' }, entered),
      h('div', { class: 'grid' }, ...LETTERS.map((c) => button(c, 'key', () => this.addLetter(c)))),
      h(
        'div',
        { class: 'actions' },
        button('?', 'btn', () => this.addLetter('?')),
        button('Clear', 'btn', () => this.clearLetter(), '⌫'),
        button('Enter', 'btn btn-main', () => this.act(() => flow.submit(this.entered)), 'Enter'),
      ),
    );
  }

  /** 画面の上にだけ置く中断リンク。下の操作ボタンの位置を画面ごとに変えないため。 */
  private quitBar(): HTMLElement {
    return h('div', { class: 'quit-bar' }, button('Quit', 'link', () => this.leaveFlow(), 'Esc'));
  }

  private renderFeedback(flow: Flow, record: TrialRecord, math: MathTally, summary: PracticeSummary | null): HTMLElement {
    const s = record.score;
    const rows: HTMLElement[] = [];
    if (summary) {
      // 計算練習のまとめ（15 問が終わったところで 1 回だけ）
      const p = mathAccuracyPct(math.correct, math.total);
      if (p !== null) rows.push(kv('Math accuracy', `${p}%`, isLowAccuracy(p)));
      rows.push(kv('Math errors', `${math.total - math.correct} / ${math.total}`, math.correct < math.total));
      rows.push(kv('Math time limit', summary.timeLimit === null ? '—' : seconds(summary.timeLimit)));
      return h(
        'main',
        { class: 'screen' },
        this.quitBar(),
        h('div', { class: 'text' }, h('div', { class: 'kv-list' }, ...rows)),
        h('div', { class: 'actions' }, button('Next', 'btn btn-main', () => this.act(() => flow.next()), 'Space')),
      );
    }
    if (record.spec.letters) rows.push(kv('Letters', `${s.lettersCorrect} / ${s.setSize}`));
    if (record.spec.math) {
      rows.push(kv('Math errors', String(s.mathErrors), s.mathErrors > 0));
      // 時間切れは誤りではないので、警告色にせず参考として出す
      if (s.timeouts > 0) rows.push(kv('Timed out', String(s.timeouts)));
      const p = mathAccuracyPct(math.correct, math.total);
      if (p !== null) rows.push(kv('Math accuracy', `${p}%`, isLowAccuracy(p)));
    }
    return h(
      'main',
      { class: 'screen' },
      this.quitBar(),
      h('div', { class: 'text' }, h('div', { class: 'kv-list' }, ...rows)),
      h('div', { class: 'actions' }, button('Next', 'btn btn-main', () => this.act(() => flow.next()), 'Space')),
    );
  }

  private renderDone(r: FlowResult): HTMLElement {
    const body: (HTMLElement | null)[] = [];
    if (r.mode === 'setup' && r.practice) {
      body.push(...this.setupDoneBody(r.practice));
    } else {
      const s = r.session;
      const p = pct(s.mathAccuracy);
      body.push(
        h('div', { class: 'big' }, `${s.score} / ${s.maxScore}`),
        h('p', { class: 'muted result-caption' }, 'O-Span'),
        h(
          'div',
          { class: 'kv-list' },
          kv('Math accuracy', `${p}%`, isLowAccuracy(p)),
          kv('Letter recall', `${pct(s.letterAccuracy)}%`),
          kv('Perfect sets', `${s.perfectTrials} / ${s.trials}`),
          kv('Math errors', String(s.mathErrors), s.mathErrors > 0),
          kv('Timed out', String(s.timeouts)),
        ),
        r.calibration ? h('p', { class: 'muted' }, `Math time limit updated: ${seconds(r.timeLimit)}`) : null,
      );
    }
    if (this.saveError) body.push(h('p', { class: 'error' }, '保存できませんでした。この結果は残りません。'));
    return h(
      'main',
      { class: 'screen' },
      h('div', { class: 'text' }, ...body),
      h(
        'div',
        { class: 'actions' },
        button(r.mode === 'setup' ? 'Setup' : 'Home', 'btn btn-main', () => this.act(() => this.leaveFlow()), 'Space'),
      ),
    );
  }

  /** Setup の練習が終わったときの画面。保存した内容を見せる。 */
  private setupDoneBody(done: StageDone): HTMLElement[] {
    const title = SETUP_STEPS[done.stage as PracticeStep]?.title ?? '';
    const rows: HTMLElement[] = [];
    const math = mathAccuracyPct(done.math.correct, done.math.total);
    if (done.stage === 'mathPractice') {
      if (!done.calibration) {
        return [
          h('h1', {}, 'Not saved'),
          h('p', {}, '計算の正答がなかったため、制限時間を決められませんでした。もう一度行ってください。'),
        ];
      }
      if (math !== null) rows.push(kv('Math accuracy', `${math}%`, isLowAccuracy(math)));
      rows.push(kv('Math time limit', seconds(done.calibration.timeLimit)));
    } else {
      if (done.stage === 'bothPractice' && math !== null) rows.push(kv('Math accuracy', `${math}%`, isLowAccuracy(math)));
      rows.push(kv('Letters', `${done.letters.correct} / ${done.letters.total}`));
    }
    return [h('h1', {}, 'Saved'), h('p', { class: 'muted' }, title), h('div', { class: 'kv-list' }, ...rows)];
  }

  // ---------- 設定 ----------

  private async showSettings(): Promise<void> {
    this.flow?.cancel();
    this.screen = 'settings';
    this.calibration = await this.store.getCalibration();
    this.render();
  }

  private renderSettings(): HTMLElement {
    const settings = this.store.getSettings();
    const reps = ([1, 2, 3] as const).map((n) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          pressed: settings.reps === n,
          onclick: () => {
            this.store.setSettings({ ...settings, reps: n });
            this.render();
          },
        },
        `${n * 5} sets`,
      ),
    );
    const cal = this.calibration;
    const file = h('input', { type: 'file', accept: 'application/json,.json' });
    file.hidden = true;
    file.onchange = () => void this.importFile(file);

    const sessionsEl = h('div', {}, h('p', { class: 'muted' }, '読み込み中…'));
    void this.store.listSessions().then((all) => {
      const list = (mode: Mode, label: string) => {
        const items = all.filter((s) => s.mode === mode);
        return h(
          'div',
          { class: 'history' },
          h('p', { class: 'muted' }, `${label}（${items.length}回）`),
          ...items.slice(0, 5).map((s) => kv(dateTime(s.at), `${s.score.score} / ${s.score.maxScore}`)),
        );
      };
      sessionsEl.replaceChildren(list('quick', 'Quick'), list('formal', 'Formal'));
    });

    const dangerChip = (key: 'history' | 'setup', label: string, run: () => Promise<void>) =>
      h(
        'button',
        {
          class: 'chip danger',
          type: 'button',
          onclick: () => {
            if (this.confirm !== key) {
              this.confirm = key;
              this.render();
              return;
            }
            this.confirm = null;
            void run().then(() => this.showSettings());
          },
        },
        this.confirm === key ? 'Tap again' : label,
      );

    return h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'settings scroll' },
        h('section', {}, h('h2', {}, 'Quick session'), h('div', { class: 'row' }, ...reps)),
        h(
          'section',
          {},
          h('h2', {}, 'Math time limit'),
          cal
            ? h(
                'div',
                { class: 'kv-list' },
                kv('Limit', seconds(cal.timeLimit)),
                kv('Mean', seconds(cal.mean)),
                kv('SD', seconds(cal.sd)),
                kv('Measured', dateTime(cal.at)),
              )
            : h('p', { class: 'muted' }, '未設定です。Setup の Math practice で決まります。'),
          h('p', { class: 'muted' }, '取り直すときは、Setup から Math practice をやり直します。'),
        ),
        h('section', {}, h('h2', {}, 'History'), sessionsEl),
        h(
          'section',
          {},
          h('h2', {}, 'Data'),
          h('p', { class: 'muted' }, 'この端末の中だけに保存しています。書き出しておくと、端末を変えても引き継げます。'),
          h(
            'div',
            { class: 'row' },
            button('Export', 'chip', () => void this.exportFile()),
            button('Import', 'chip', () => file.click()),
          ),
          file,
          this.notice ? h('p', { class: 'muted' }, this.notice) : null,
          this.persisted === false
            ? h('p', { class: 'muted' }, 'ホーム画面に追加して使うと、保存したデータが消えにくくなります。')
            : null,
        ),
        h(
          'section',
          {},
          h('h2', {}, 'Keyboard'),
          h(
            'p',
            { class: 'muted' },
            'Space / Enter で Solved と Next。T（←）が True、F（→）が False。想起は文字キーで入力し、? で空欄、Backspace で Clear、Enter で決定。Esc で Quit。',
          ),
        ),
        h(
          'section',
          { class: 'danger-zone' },
          h('h2', {}, 'Reset'),
          h(
            'div',
            { class: 'row' },
            dangerChip('setup', 'Reset setup', async () => {
              await this.store.clearCalibration();
              await this.store.clearPractice();
            }),
            dangerChip('history', 'Delete history', () => this.store.clearSessions()),
          ),
        ),
        h(
          'section',
          {},
          h(
            'p',
            { class: 'aux' },
            `Version ${__APP_VERSION__}`,
          ),
          h(
            'p',
            { class: 'aux' },
            '課題は Unsworth, Heitz, Schrock & Engle (2005) の Automated Operation Span を参考に、PsyToolkit（Gijsbert Stoet 教授）の実装を調べて独自に作ったものです。非商用の個人利用です。',
          ),
        ),
      ),
      h('div', { class: 'actions' }, button('Back', 'btn', () => void this.showHome(), 'Esc')),
    );
  }

  private async exportFile(): Promise<void> {
    const data = await this.store.exportAll();
    const name = `o-span-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const { sessions } = await this.store.importAll(JSON.parse(await f.text()));
      this.notice = `読み込みました（成績 ${sessions}件）。`;
    } catch (e) {
      this.notice = `読み込めませんでした: ${(e as Error).message}`;
    }
    await this.showSettings();
  }
}
