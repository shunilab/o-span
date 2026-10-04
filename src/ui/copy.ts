import type { StageId } from '../core/flow';

export interface IntroCopy {
  title: string;
  body: string[];
}

/** 課題の用語は英語、説明文は日本語。 */
export const INTRO: Record<StageId, IntroCopy> = {
  lettersPractice: {
    title: 'Letters practice',
    body: ['文字が1つずつ出ます。順番に覚えて、最後に出てきた順に選んでください。'],
  },
  mathPractice: {
    title: 'Math practice',
    body: [
      '式が出ます。解けたら Solved を押し、次に出る数字が答えと合っているかを True / False で答えます。',
      'この練習の速さをもとに、本番の制限時間が決まります。ふだんの速さで進めてください。',
    ],
  },
  bothPractice: {
    title: 'Math + Letters practice',
    body: [
      '式を解くたびに、文字が一瞬出ます。これを繰り返し、最後に文字を出てきた順に選びます。',
      'ここから計算に制限時間があります。過ぎると次へ進み、計算ミスになります。',
    ],
  },
  main: {
    title: 'Test',
    body: ['練習と同じ形で15セット行います。計算の正確さも、文字の記憶も、どちらも崩さないようにしてください。'],
  },
  quick: { title: '', body: [] },
};

export const RECALL_HINT = '出てきた順に選びます。分からない位置は「?」を押します。';

/** 計算の正答率がこの値（%）を下回ったら警告色にする。原著の除外基準。 */
export const MATH_ACCURACY_FLOOR = 85;

export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  return `${days}日前`;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** 例: 10/4 18:30 */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${two(d.getMinutes())}`;
}

/** 例: 10/4 */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const pct = (ratio: number): number => Math.round(ratio * 100);

/** 計算正答率（%）。問題が 0 件なら null。 */
export function mathAccuracyPct(correct: number, total: number): number | null {
  return total === 0 ? null : Math.round((correct / total) * 100);
}

export const isLowAccuracy = (p: number | null): boolean => p !== null && p < MATH_ACCURACY_FLOOR;

/** 計算ミスの表示。時間切れがあれば内訳を添える。例: `1（speed 1）` */
export function mathErrorsText(speed: number, accuracy: number): string {
  const total = speed + accuracy;
  return speed > 0 ? `${total}（speed ${speed}）` : String(total);
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
