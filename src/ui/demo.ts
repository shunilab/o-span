import type { StageId } from '../core/flow';
import { h } from './dom';

/** 導入画面の見本。実際の画面を縮めた絵で、1 セットの流れを見せる。 */
function frame(caption: string, ...content: (Node | string)[]): HTMLElement {
  return h(
    'figure',
    { class: 'demo-item' },
    h('div', { class: 'demo-frame' }, ...content),
    h('figcaption', {}, caption),
  );
}

const formula = () => frame('解く', h('span', { class: 'demo-formula' }, '(8 ÷ 2) − 1'), h('span', { class: 'demo-btn demo-btn-main' }, 'Solved'));
const judge = () =>
  frame('判定', h('span', { class: 'demo-number' }, '3'), h('span', { class: 'demo-btns' }, h('span', { class: 'demo-btn' }, 'True'), h('span', { class: 'demo-btn' }, 'False')));
const letter = (ch: string) => frame('覚える', h('span', { class: 'demo-circle' }, ch));
const recall = () =>
  frame('選ぶ', h('span', { class: 'demo-number' }, 'K R'), h('span', { class: 'demo-btn demo-btn-main' }, 'Enter'));
const sep = () => h('span', { class: 'demo-sep', ariaHidden: 'true' }, '›');

export function demoFor(stage: StageId): HTMLElement | null {
  let items: HTMLElement[];
  switch (stage) {
    case 'lettersPractice':
      items = [letter('K'), letter('R'), recall()];
      break;
    case 'mathPractice':
      items = [formula(), judge()];
      break;
    case 'bothPractice':
    case 'main':
      items = [formula(), judge(), letter('K'), recall()];
      break;
    default:
      return null;
  }
  const row = h('div', { class: 'demo', role: 'img', ariaLabel: '1セットの流れの見本' });
  items.forEach((it, i) => {
    if (i > 0) row.append(sep());
    row.append(it);
  });
  return row;
}
