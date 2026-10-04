import type { Clock } from './clock';

/** テスト用。advance で時間を進め、期限の来たタイマーを順に実行する。 */
export class FakeClock implements Clock {
  private t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 0;

  now(): number {
    return this.t;
  }

  after(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, fn, id });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  }

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = due.at;
      due.fn();
    }
    this.t = target;
  }
}
