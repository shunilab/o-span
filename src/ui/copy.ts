import type { StageId } from '../core/flow';

export interface IntroCopy {
  title: string;
  body: string[];
}

export const INTRO: Record<StageId, IntroCopy> = {
  lettersPractice: {
    title: '文字の練習',
    body: ['文字が1つずつ出ます。', '順番に覚えて、最後に出てきた順に選んでください。'],
  },
  mathPractice: {
    title: '計算の練習',
    body: [
      '計算式が出ます。解けたら「解けた」を押し、次に出る数字が答えと合っているかを選んでください。',
      'この練習の速さをもとに、本番の制限時間が決まります。ふだんの速さで進めてください。',
    ],
  },
  bothPractice: {
    title: '計算と文字',
    body: [
      '計算を解くたびに、文字が一瞬出ます。これを繰り返し、最後に文字を出てきた順に選びます。',
      'ここから計算に制限時間があります。過ぎると次へ進み、計算ミスになります。',
    ],
  },
  main: {
    title: '本番',
    body: ['練習と同じ形で15回行います。計算の正確さも、文字の記憶も、どちらも崩さないようにしてください。'],
  },
  quick: { title: '', body: [] },
};

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

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const pct = (ratio: number): number => Math.round(ratio * 100);

/** 計算ミスの文言。時間切れがあれば内訳を添える。 */
export function mathErrorsText(speed: number, accuracy: number): string {
  const total = speed + accuracy;
  return speed > 0 ? `計算ミス ${total}（時間切れ ${speed}）` : `計算ミス ${total}`;
}
