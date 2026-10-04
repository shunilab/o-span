import { describe, expect, it } from 'vitest';
import { LETTERS } from '../core/letters';
import { mapKey, type KeyContext } from './keys';

describe('mapKey', () => {
  it('ホーム・計算・結果: Space と Enter が主ボタン', () => {
    for (const ctx of ['home', 'math', 'done'] as KeyContext[]) {
      expect(mapKey(ctx, ' ')).toEqual({ type: 'primary' });
      expect(mapKey(ctx, 'Enter')).toEqual({ type: 'primary' });
      expect(mapKey(ctx, 'a')).toBeNull();
      expect(mapKey(ctx, 'Escape')).toBeNull();
    }
  });

  it('説明・フィードバック: Space / Enter で進み、Esc で Quit', () => {
    for (const ctx of ['intro', 'feedback'] as KeyContext[]) {
      expect(mapKey(ctx, ' ')).toEqual({ type: 'primary' });
      expect(mapKey(ctx, 'Enter')).toEqual({ type: 'primary' });
      expect(mapKey(ctx, 'Escape')).toEqual({ type: 'quit' });
    }
  });

  it('判定: T / ← が True、F / → が False（大文字小文字どちらも）', () => {
    for (const k of ['t', 'T', 'ArrowLeft']) expect(mapKey('judge', k)).toEqual({ type: 'true' });
    for (const k of ['f', 'F', 'ArrowRight']) expect(mapKey('judge', k)).toEqual({ type: 'false' });
    // 判定画面で Space / Enter は無視する（誤って判定しない）
    expect(mapKey('judge', ' ')).toBeNull();
    expect(mapKey('judge', 'Enter')).toBeNull();
  });

  it('文字の表示中は何も受け付けない', () => {
    for (const k of ['Enter', ' ', 'f', 'F', 'Escape', 'Backspace', '?', 'ArrowLeft']) {
      expect(mapKey('letter', k)).toBeNull();
    }
  });

  it('想起: 12 文字は大文字小文字どちらでも入力できる', () => {
    for (const c of LETTERS) {
      expect(mapKey('recall', c)).toEqual({ type: 'letter', letter: c });
      expect(mapKey('recall', c.toLowerCase())).toEqual({ type: 'letter', letter: c });
    }
  });

  it('想起: 出ない文字（A, B, 数字など）は無視する', () => {
    for (const k of ['a', 'B', 'X', 'Z', '1', 'Tab', 'Shift', 'ArrowLeft', 'Escape', ' ']) {
      expect(mapKey('recall', k)).toBeNull();
    }
  });

  it('想起: ? と / が空欄、Backspace / Delete が Clear、Enter が決定', () => {
    expect(mapKey('recall', '?')).toEqual({ type: 'blank' });
    expect(mapKey('recall', '/')).toEqual({ type: 'blank' });
    expect(mapKey('recall', 'Backspace')).toEqual({ type: 'clear' });
    expect(mapKey('recall', 'Delete')).toEqual({ type: 'clear' });
    expect(mapKey('recall', 'Enter')).toEqual({ type: 'submit' });
  });

  it('Setup: 1 / 2 / 3 でその練習を始め、Esc で戻る', () => {
    expect(mapKey('setup', '1')).toEqual({ type: 'step', n: 1 });
    expect(mapKey('setup', '2')).toEqual({ type: 'step', n: 2 });
    expect(mapKey('setup', '3')).toEqual({ type: 'step', n: 3 });
    expect(mapKey('setup', 'Escape')).toEqual({ type: 'quit' });
    expect(mapKey('setup', '4')).toBeNull();
    expect(mapKey('setup', ' ')).toBeNull();
  });

  it('設定: Esc で戻る', () => {
    expect(mapKey('settings', 'Escape')).toEqual({ type: 'quit' });
    expect(mapKey('settings', 'Enter')).toBeNull();
  });
});
