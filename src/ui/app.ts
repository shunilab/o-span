import { Flow, type FlowResult, type FlowView, type Mode } from '../core/flow';
import { realClock } from '../core/clock';
import { MAX_RECALL } from '../core/trial';
import { LETTERS } from '../core/letters';
import { Store, requestPersistence, type SessionRecord } from '../storage/store';
import { button, h } from './dom';
import { INTRO, mathErrorsText, pct, relativeDay, shortDate } from './copy';

type Screen = 'home' | 'flow' | 'settings';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  constructor(
    private readonly root: HTMLElement,
    private readonly store: Store,
  ) {}

  async start(): Promise<void> {
    void requestPersistence().then((ok) => {
      this.persisted = ok;
    });
    await this.showHome();
  }

  private async showHome(): Promise<void> {
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
    const circle = h('button', { class: 'aperture aperture-start', type: 'button', ariaLabel: '開始' }, '開始');
    circle.onclick = () => {
      if (circle.classList.contains('expanding')) return;
      const go = () => this.startFlow('quick');
      if (reducedMotion()) {
        go();
        return;
      }
      circle.classList.add('expanding');
      setTimeout(go, 300);
    };
    return h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'home-top' },
        h(
          'p',
          { class: 'aux' },
          last
            ? `前回 ${relativeDay(last.at)}　${last.score.score} / ${last.score.maxScore}点`
            : 'まだ記録がありません',
        ),
      ),
      h(
        'div',
        { class: 'home-middle' },
        circle,
        this.calibration ? null : h('p', { class: 'aux' }, '初回は計算練習から始まります（約2分）'),
      ),
      h(
        'div',
        { class: 'home-bottom' },
        button('正式測定', 'link', () => this.startFlow('formal')),
        button('設定', 'link', () => {
          this.notice = '';
          this.confirm = null;
          void this.showSettings();
        }),
      ),
    );
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
        return this.renderTrial(flow, v.trial);
      case 'feedback':
        return this.renderFeedback(flow, v);
      case 'done':
        return this.renderDone(v.result);
    }
  }

  private renderIntro(flow: Flow, stage: keyof typeof INTRO): HTMLElement {
    const copy = INTRO[stage];
    return h(
      'main',
      { class: 'screen' },
      h('div', { class: 'text' }, h('h1', {}, copy.title), ...copy.body.map((t) => h('p', {}, t))),
      h('div', { class: 'actions' }, button('始める', 'btn btn-main', () => flow.next())),
      h('div', {}, button('やめる', 'link', () => void this.showHome())),
    );
  }

  private renderTrial(flow: Flow, trial: Extract<FlowView, { kind: 'trial' }>['trial']): HTMLElement {
    switch (trial.kind) {
      case 'math':
        return h(
          'main',
          { class: 'screen' },
          h('div', { class: 'stage' }, h('div', { class: 'formula' }, trial.text)),
          h('div', { class: 'actions' }, button('解けた', 'btn', () => flow.solved())),
        );
      case 'judge':
        return h(
          'main',
          { class: 'screen' },
          h('div', { class: 'stage' }, h('div', { class: 'answer' }, String(trial.shown))),
          h(
            'div',
            { class: 'actions' },
            button('正しい', 'btn', () => flow.judge(true)),
            button('違う', 'btn', () => flow.judge(false)),
          ),
        );
      case 'letter':
        return h(
          'main',
          { class: 'screen' },
          h('div', { class: 'stage' }, h('div', { class: 'aperture' }, h('span', { class: 'aperture-letter' }, trial.letter))),
        );
      case 'recall':
        return this.renderRecall(flow);
    }
  }

  private renderRecall(flow: Flow): HTMLElement {
    const entered = h('div', { class: 'entered', ariaLabel: '入力した文字' });
    const draw = () => entered.replaceChildren(...this.entered.map((c) => h('span', {}, c)));
    draw();
    const add = (c: string) => {
      if (this.entered.length >= MAX_RECALL) return;
      this.entered.push(c);
      draw();
    };
    const grid = h('div', { class: 'grid' }, ...LETTERS.map((c) => button(c, 'key', () => add(c))));
    return h(
      'main',
      { class: 'screen' },
      entered,
      h('div', { class: 'recall-space' }),
      grid,
      h(
        'div',
        { class: 'actions' },
        button('空欄', 'btn', () => add('?')),
        button('消す', 'btn', () => {
          this.entered.pop();
          draw();
        }),
        button('決定', 'btn btn-main', () => flow.submit(this.entered)),
      ),
    );
  }

  private renderFeedback(flow: Flow, v: Extract<FlowView, { kind: 'feedback' }>): HTMLElement {
    const s = v.record.score;
    const lines = [h('p', {}, `${s.setSize}文字中${s.lettersCorrect}文字正解`)];
    if (v.record.spec.math) {
      const errs = s.speedErrors + s.accuracyErrors;
      lines.push(h('p', { class: errs > 0 ? 'error' : 'muted' }, mathErrorsText(s.speedErrors, s.accuracyErrors)));
    }
    return h(
      'main',
      { class: 'screen' },
      h('div', { class: 'text' }, ...lines),
      h('div', { class: 'actions' }, button('次へ', 'btn btn-main', () => flow.next())),
      h('div', {}, button('やめる', 'link', () => void this.showHome())),
    );
  }

  private renderDone(r: FlowResult): HTMLElement {
    const body: (HTMLElement | null)[] = [];
    if (this.calibrationOnly) {
      body.push(
        r.calibration
          ? h('h1', {}, '制限時間を更新しました')
          : h('h1', {}, '制限時間を取れませんでした'),
        r.calibration
          ? h('p', {}, `計算の制限時間は ${(r.timeLimit / 1000).toFixed(1)} 秒です。`)
          : h('p', {}, '計算の正答がなかったため、更新していません。もう一度やり直してください。'),
      );
    } else {
      const s = r.session;
      const errs = s.speedErrors + s.accuracyErrors;
      body.push(
        h('div', { class: 'big' }, `${s.score} / ${s.maxScore}点`),
        h('p', {}, `完全正答 ${s.perfectTrials} / ${s.trials}回`),
        h('p', {}, `計算の正答率 ${pct(s.mathAccuracy)}%`),
        h('p', {}, `文字の正答率 ${pct(s.letterAccuracy)}%`),
        errs > 0 ? h('p', { class: 'error' }, mathErrorsText(s.speedErrors, s.accuracyErrors)) : null,
        r.calibration
          ? h('p', { class: 'muted' }, `計算の制限時間を ${(r.timeLimit / 1000).toFixed(1)} 秒に更新しました。`)
          : null,
      );
    }
    if (this.saveError) body.push(h('p', { class: 'error' }, '保存できませんでした。この結果は残りません。'));
    return h(
      'main',
      { class: 'screen' },
      h('div', { class: 'text' }, ...body),
      h('div', { class: 'actions' }, button('ホームへ', 'btn btn-main', () => void this.showHome())),
    );
  }

  // ---------- 設定 ----------

  private async showSettings(): Promise<void> {
    this.flow?.cancel();
    this.screen = 'settings';
    [this.calibration] = await Promise.all([this.store.getCalibration()]);
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
        `${n * 5}回`,
      ),
    );
    const cal = this.calibration;
    const file = h('input', { type: 'file', accept: 'application/json,.json' });
    file.hidden = true;
    file.onchange = () => void this.importFile(file);

    const sessionsEl = h('div', {}, h('p', { class: 'muted' }, '読み込み中…'));
    void this.store.listSessions().then((all) => {
      const recent = (mode: Mode) => all.filter((s) => s.mode === mode).slice(0, 5);
      const list = (mode: Mode, label: string) => {
        const items = recent(mode);
        return h(
          'div',
          {},
          h('p', { class: 'muted' }, `${label}（全${all.filter((s) => s.mode === mode).length}回）`),
          items.length
            ? h(
                'ul',
                { class: 'history' },
                ...items.map((s) => h('li', {}, h('span', {}, shortDate(s.at)), h('span', {}, `${s.score.score} / ${s.score.maxScore}点`))),
              )
            : null,
        );
      };
      sessionsEl.replaceChildren(list('quick', 'クイック'), list('formal', '正式'));
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
        this.confirm === key ? 'もう一度押して実行' : label,
      );

    return h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'settings scroll' },
        h('section', {}, h('h2', {}, 'クイックの長さ'), h('div', { class: 'row' }, ...reps)),
        h(
          'section',
          {},
          h('h2', {}, '計算の制限時間'),
          h('p', {}, cal ? `${(cal.timeLimit / 1000).toFixed(1)} 秒（${shortDate(cal.at)} に計測）` : '未設定'),
          h(
            'div',
            { class: 'row' },
            button('やり直す', 'chip', () => this.startFlow('quick', true)),
            cal ? dangerChip('calibration', 'リセット', () => this.store.clearCalibration()) : null,
          ),
        ),
        h('section', {}, h('h2', {}, '成績'), sessionsEl, h('div', { class: 'row' }, dangerChip('history', '履歴を削除', () => this.store.clearSessions()))),
        h(
          'section',
          {},
          h('h2', {}, 'データ'),
          h('p', { class: 'muted' }, 'この端末の中だけに保存しています。書き出しておくと、端末を変えても引き継げます。'),
          h(
            'div',
            { class: 'row' },
            button('書き出す', 'chip', () => void this.exportFile()),
            button('読み込む', 'chip', () => file.click()),
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
          h(
            'p',
            { class: 'aux' },
            '課題は Unsworth, Heitz, Schrock & Engle (2005) の Automated Operation Span を参考に、PsyToolkit（Gijsbert Stoet 教授）の実装を調べて独自に作ったものです。非商用の個人利用です。',
          ),
        ),
      ),
      h('div', {}, button('戻る', 'link', () => void this.showHome())),
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
