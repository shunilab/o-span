import { pick, randInt, type Rng } from './random';

export interface MathProblem {
  a: number;
  op1: '×' | '÷';
  b: number;
  op2: '+' | '−';
  c: number;
  /** 式の正解（1〜9）。 */
  answer: number;
  /** 画面に出す答えの候補（1〜10）。 */
  shown: number;
  /** shown が正解と一致するか。 */
  isTrue: boolean;
  /** 例: `(6 × 2) − 3 = ?` */
  text: string;
}

const A_VALUES = [2, 4, 6, 8, 10] as const;
const B_VALUES = [1, 2] as const;

function evaluate(a: number, op1: '×' | '÷', b: number, op2: '+' | '−', c: number): number {
  const first = op1 === '×' ? a * b : a / b;
  return op2 === '+' ? first + c : first - c;
}

/**
 * `(a op1 b) op2 c` の問題を作る。答えが 1〜9 に収まるまで作り直す。
 * 元実装（PsyToolkit）は a の選び方が両端に偏るが、ここでは一様にする。
 */
export function generateProblem(rng: Rng): MathProblem {
  for (;;) {
    const a = pick(rng, A_VALUES);
    const op1 = pick(rng, ['×', '÷'] as const);
    const b = pick(rng, B_VALUES);
    const op2 = pick(rng, ['+', '−'] as const);
    const c = randInt(rng, 1, 5);
    const answer = evaluate(a, op1, b, op2, c);
    if (answer < 1 || answer > 9) continue;

    const isTrue = rng() < 0.5;
    let shown = answer;
    if (!isTrue) {
      const others = Array.from({ length: 10 }, (_, i) => i + 1).filter((n) => n !== answer);
      shown = pick(rng, others);
    }
    return { a, op1, b, op2, c, answer, shown, isTrue, text: `(${a} ${op1} ${b}) ${op2} ${c} = ?` };
  }
}
