import { LETTERS } from '../core/letters';

/** いまどの画面か（キーの意味は画面ごとに違う）。 */
export type KeyContext = 'home' | 'intro' | 'math' | 'judge' | 'letter' | 'recall' | 'feedback' | 'done' | 'settings';

export type KeyAction =
  /** 画面の主ボタン（Start / Solved / Next / Home）。 */
  | { type: 'primary' }
  | { type: 'quit' }
  | { type: 'true' }
  | { type: 'false' }
  | { type: 'letter'; letter: string }
  | { type: 'blank' }
  | { type: 'clear' }
  | { type: 'submit' };

const PRIMARY = new Set(['Enter', ' ']);

/**
 * 画面とキーから動作を決める。何も起きないキーは null。
 * 文字を表示している間（letter）は、誤入力を避けるため何も受け付けない。
 */
export function mapKey(ctx: KeyContext, key: string): KeyAction | null {
  switch (ctx) {
    case 'home':
    case 'math':
    case 'done':
      return PRIMARY.has(key) ? { type: 'primary' } : null;
    case 'intro':
    case 'feedback':
      if (PRIMARY.has(key)) return { type: 'primary' };
      return key === 'Escape' ? { type: 'quit' } : null;
    case 'judge':
      if (key === 't' || key === 'T' || key === 'ArrowLeft') return { type: 'true' };
      if (key === 'f' || key === 'F' || key === 'ArrowRight') return { type: 'false' };
      return null;
    case 'recall': {
      if (key === 'Enter') return { type: 'submit' };
      if (key === 'Backspace' || key === 'Delete') return { type: 'clear' };
      if (key === '?' || key === '/') return { type: 'blank' };
      const upper = key.length === 1 ? key.toUpperCase() : '';
      return (LETTERS as readonly string[]).includes(upper) ? { type: 'letter', letter: upper } : null;
    }
    case 'settings':
      return key === 'Escape' ? { type: 'quit' } : null;
    case 'letter':
      return null;
  }
}
