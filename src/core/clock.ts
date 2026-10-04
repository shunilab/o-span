export interface Clock {
  now(): number;
  /** ms 後に fn を呼ぶ。戻り値で取り消せる。 */
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fn) => {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
};
