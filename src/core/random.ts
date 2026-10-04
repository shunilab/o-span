/** 0 以上 1 未満の乱数を返す関数。テストではシード付きのものを渡す。 */
export type Rng = () => number;

/** min 以上 max 以下の整数を一様に返す。 */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[randInt(rng, 0, items.length - 1)];
  if (item === undefined) throw new Error('pick: empty array');
  return item;
}

/** Fisher–Yates。元の配列は変更しない。 */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** 重複なしで n 個選ぶ。 */
export function sample<T>(rng: Rng, items: readonly T[], n: number): T[] {
  if (n > items.length) throw new RangeError('sample: n exceeds length');
  return shuffle(rng, items).slice(0, n);
}

/** テスト用の再現可能な乱数（mulberry32）。 */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
