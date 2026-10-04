import { realClock } from '../core/clock';
import {
  Flow,
  type FlowResult,
  type FlowView,
  type MathTally,
  type Mode,
  type PracticeSummary,
  type StageId,
} from '../core/flow';
import { LETTERS } from '../core/letters';
import { MAX_RECALL, type TrialRecord } from '../core/trial';
import { Store, requestPersistence, type SessionRecord } from '../storage/store';
import {
  INTRO,
  RECALL_HINT,
  dateTime,
  isLowAccuracy,
  mathAccuracyPct,
  mathErrorsText,
  pct,
  relativeDay,
  seconds,
} from './copy';
import { demoFor } from './demo';
import { button, h } from './dom';
import { mapKey, type KeyAction, type KeyContext } from './keys';

type Screen = 'home' | 'flow' | 'settings';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 左に項目名、右に値。warn なら値を警告色にする。 */
function kv(label: string, value: string, warn = false): HTMLElement {
  return h('div', { class: 'kv' }, h('span', { class: 'kv-label' }, label), h('span', { class: warn ? 'kv-value error' : 'kv-value' }, value));
}

export class App {
  private screen: Screen = 'home';
  private flow: Flow | null = null;
  private calibrationOnly = false;
  private saved = false;
  private saveError = false;
  private entered: string[] = [];

  private lastQuick: SessionRecord | null = null;
  private calibration: Awaited<ReturnType<Store['getCalibration']>> = null;
  private notice = '';
  private confirm: 'history' | 'calibration' | null = null;
  private persisted: boolean | null = null;
  private updateReady = false;
  /** 想起画面の入力表示を描き直す関数（画面ごとに差し替わる）。 */
  private recallDraw: (() => void) | null = null;

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
    [this.lastQuick, this.calibration] = await Promise.all([
      this.store.listSessions('quick').then((l) => l[0] ?? null),
      this.store.getCalibration(),
    ]);
    this.render();
  }

  private render(): void {
    const view =
      this.screen === 'home' ? this.renderHome() : this.screen === 'settings' ? this.renderSettings() : this.renderFlow();
    this.root.replaceChildren(view);
  }

  // ---------- ホーム ----------

  private renderHome(): HTMLElement {
    const last = this.lastQuick;
    const circle = h('button', { class: 'aperture aperture-start', type: 'button' }, 'Start');
    circle.dataset.key = 'Space';
    circle.onclick = () => this.startQuick();
    return h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'home-top' },
        last
          ? kv(`前回 ${relativeDay(last.at)}`, `${last.score.score} / ${last.score.maxScore}`)
          : h('p', { class: 'aux' }, 'まだ記録がありません'),
      ),
      h(
        'div',
        { class: 'home-middle' },
        circle,
        h(
          'p',
          { class: 'aux' },
          this.calibration ? `Time limit ${seconds(this.calibration.timeLimit)}` : '初回は計算練習から始まります（約2分）',
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        button('Formal test', 'btn', () => this.startFlow('formal')),
        button('Settings', 'btn', () => {
          this.notice = '';
          this.confirm = null;
          void this.showSettings();
        }),
      ),
    );
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

  // ---------- キーボード ----------

  private keyContext(): KeyContext | null {
    if (this.screen === 'home') return 'home';
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
    switch (action.type) {
      case 'primary': {
        if (this.screen === 'home') {
          this.startQuick();
          break;
        }
        const v = flow?.view;
        if (!flow || !v) break;
        if (v.kind === 'trial' && v.trial.kind === 'math') flow.solved();
        else if (v.kind === 'intro' || v.kind === 'feedback') flow.next();
        else if (v.kind === 'done') void this.showHome();
        break;
      }
      case 'quit':
        void this.showHome();
        break;
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

  private startFlow(mode: Mode, calibrationOnly = false): void {
    this.calibrationOnly = calibrationOnly;
    this.saved = false;
    this.saveError = false;
    this.entered = [];
    this.screen = 'flow';
    this.flow = new Flow({
      mode,
      reps: this.store.getSettings().reps,
      timeLimit: this.calibration?.timeLimit ?? null,
      calibrationOnly,
      clock: realClock,
      rng: Math.random,
      onChange: () => this.onFlowChange(),
    });
    this.flow.start();
  }

  private onFlowChange(): void {
    const flow = this.flow;
    if (!flow) return;
    if (flow.view.kind === 'trial' && flow.view.trial.kind === 'recall') this.entered = [];
    if (flow.view.kind === 'done' && !this.saved) {
      this.saved = true;
      void this.persist(flow.view.result);
    }
    this.render();
  }

  private async persist(r: FlowResult): Promise<void> {
    try {
      if (!this.calibrationOnly) {
        await this.store.addSession({
          mode: r.mode,
          at: r.at,
          timeLimit: r.timeLimit,
          score: r.session,
          trials: r.trials,
        });
      }
      if (r.calibration) {
        await this.store.setCalibration(r.calibration);
        this.calibration = r.calibration;
      }
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
      h('div', { class: 'actions' }, button('Start', 'btn btn-main', () => flow.next(), 'Space')),
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
          h('div', { class: 'actions' }, button('Solved', 'btn btn-main', () => flow.solved(), 'Space')),
        );
      case 'judge':
        return h(
          'main',
          { class: 'screen' },
          h('div', { class: 'stage' }, h('div', { class: 'answer' }, String(trial.shown))),
          h(
            'div',
            { class: 'actions' },
            button('True', 'btn', () => flow.judge(true), 'T'),
            button('False', 'btn', () => flow.judge(false), 'F'),
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
        button('Enter', 'btn btn-main', () => flow.submit(this.entered), 'Enter'),
      ),
    );
  }

  /** 画面の上にだけ置く中断リンク。下の操作ボタンの位置を画面ごとに変えないため。 */
  private quitBar(): HTMLElement {
    return h('div', { class: 'quit-bar' }, button('Quit', 'link', () => void this.showHome(), 'Esc'));
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
        h('div', { class: 'actions' }, button('Next', 'btn btn-main', () => flow.next(), 'Space')),
      );
    }
    if (record.spec.letters) rows.push(kv('Letters', `${s.lettersCorrect} / ${s.setSize}`));
    if (record.spec.math) {
      rows.push(kv('Math errors', mathErrorsText(s.speedErrors, s.accuracyErrors), s.speedErrors + s.accuracyErrors > 0));
      const p = mathAccuracyPct(math.correct, math.total);
      if (p !== null) rows.push(kv('Math accuracy', `${p}%`, isLowAccuracy(p)));
    }
    return h(
      'main',
      { class: 'screen' },
      this.quitBar(),
      h('div', { class: 'text' }, h('div', { class: 'kv-list' }, ...rows)),
      h('div', { class: 'actions' }, button('Next', 'btn btn-main', () => flow.next(), 'Space')),
    );
  }

  private renderDone(r: FlowResult): HTMLElement {
    const body: (HTMLElement | null)[] = [];
    if (this.calibrationOnly) {
      body.push(
        r.calibration ? h('h1', {}, 'Time limit updated') : h('h1', {}, 'Time limit not updated'),
        r.calibration
          ? h('div', { class: 'kv-list' }, kv('Math time limit', seconds(r.timeLimit)))
          : h('p', {}, '計算の正答がなかったため、更新していません。もう一度やり直してください。'),
      );
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
          kv('Speed errors', String(s.speedErrors), s.speedErrors > 0),
          kv('Accuracy errors', String(s.accuracyErrors), s.accuracyErrors > 0),
        ),
        r.calibration ? h('p', { class: 'muted' }, `Math time limit updated: ${seconds(r.timeLimit)}`) : null,
      );
    }
    if (this.saveError) body.push(h('p', { class: 'error' }, '保存できませんでした。この結果は残りません。'));
    return h(
      'main',
      { class: 'screen' },
      h('div', { class: 'text' }, ...body),
      h('div', { class: 'actions' }, button('Home', 'btn btn-main', () => void this.showHome(), 'Space')),
    );
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

    const dangerChip = (key: 'history' | 'calibration', label: string, run: () => Promise<void>) =>
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
            : h('p', { class: 'muted' }, '未設定。次のクイックの前に計算練習を行います。'),
          h('div', { class: 'row' }, button('Recalibrate', 'chip', () => this.startFlow('quick', true))),
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
            cal ? dangerChip('calibration', 'Reset time limit', () => this.store.clearCalibration()) : null,
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
