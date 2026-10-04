import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Calibration } from '../core/calibration';
import type { SessionRecord } from './store';
import { Store, parseExport } from './store';

let n = 0;
const memory = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

const cal: Calibration = { timeLimit: 3000, mean: 2000, sd: 400, n: 14, problems: 15, at: '2026-10-04T00:00:00.000Z' };
const session = (mode: 'quick' | 'formal', at: string, score = 10): Omit<SessionRecord, 'id'> => ({
  mode,
  at,
  timeLimit: 3000,
  score: {
    score,
    maxScore: 25,
    trials: 5,
    perfectTrials: 2,
    perfectRate: 0.4,
    mathAccuracy: 0.95,
    letterAccuracy: 0.9,
    speedErrors: 0,
    accuracyErrors: 1,
  },
  trials: [],
});

let store: Store;
beforeEach(() => {
  store = new Store(`test-${n++}`, memory());
});

describe('Store 成績', () => {
  it('追加した成績を新しい順に取り出せ、モード別に絞れる', async () => {
    await store.addSession(session('quick', '2026-10-01T00:00:00.000Z', 8));
    await store.addSession(session('formal', '2026-10-02T00:00:00.000Z', 45));
    await store.addSession(session('quick', '2026-10-03T00:00:00.000Z', 12));
    expect((await store.listSessions()).map((s) => s.score.score)).toEqual([12, 45, 8]);
    expect((await store.listSessions('quick')).map((s) => s.score.score)).toEqual([12, 8]);
    expect((await store.listSessions('formal')).map((s) => s.score.score)).toEqual([45]);
  });

  it('履歴を削除できる', async () => {
    await store.addSession(session('quick', '2026-10-01T00:00:00.000Z'));
    await store.clearSessions();
    expect(await store.listSessions()).toEqual([]);
  });
});

describe('Store キャリブレーション', () => {
  it('保存・取得・リセット', async () => {
    expect(await store.getCalibration()).toBeNull();
    await store.setCalibration(cal);
    expect(await store.getCalibration()).toEqual(cal);
    await store.clearCalibration();
    expect(await store.getCalibration()).toBeNull();
  });
});

describe('Store 練習の完了', () => {
  it('最初は何も済んでいない', async () => {
    expect(await store.getPractice()).toEqual({ letters: null, both: null });
  });

  it('終えた練習を保存でき、別の練習を保存しても消えない', async () => {
    await store.markPractice('letters', '2026-10-04T10:00:00.000Z');
    await store.markPractice('both', '2026-10-04T10:05:00.000Z');
    expect(await store.getPractice()).toEqual({ letters: '2026-10-04T10:00:00.000Z', both: '2026-10-04T10:05:00.000Z' });
  });

  it('やり直すと上書きされ、重複しない', async () => {
    await store.markPractice('letters', '2026-10-04T10:00:00.000Z');
    await store.markPractice('letters', '2026-10-05T09:00:00.000Z');
    expect(await store.getPractice()).toEqual({ letters: '2026-10-05T09:00:00.000Z', both: null });
  });

  it('リセットできる', async () => {
    await store.markPractice('letters', '2026-10-04T10:00:00.000Z');
    await store.clearPractice();
    expect(await store.getPractice()).toEqual({ letters: null, both: null });
  });
});

describe('Store 設定', () => {
  it('既定値と保存', () => {
    expect(store.getSettings()).toEqual({ reps: 1 });
    store.setSettings({ reps: 3 });
    expect(store.getSettings()).toEqual({ reps: 3 });
  });

  it('壊れた値は既定値に戻す', () => {
    const bad = new Store(`test-${n++}`, { getItem: () => '{oops', setItem: () => {} });
    expect(bad.getSettings()).toEqual({ reps: 1 });
  });
});

describe('書き出し・読み込み', () => {
  it('書き出した内容を別の Store に読み込める', async () => {
    await store.addSession(session('quick', '2026-10-01T00:00:00.000Z', 8));
    await store.addSession(session('formal', '2026-10-02T00:00:00.000Z', 45));
    await store.setCalibration(cal);
    await store.markPractice('letters', '2026-10-04T10:00:00.000Z');
    store.setSettings({ reps: 2 });
    const json = JSON.parse(JSON.stringify(await store.exportAll()));

    const other = new Store(`test-${n++}`, memory());
    await other.addSession(session('quick', '2020-01-01T00:00:00.000Z', 1)); // 読み込みで置き換わる
    expect(await other.importAll(json)).toEqual({ sessions: 2 });
    expect((await other.listSessions()).map((s) => s.score.score)).toEqual([45, 8]);
    expect(await other.getCalibration()).toEqual(cal);
    expect(await other.getPractice()).toEqual({ letters: '2026-10-04T10:00:00.000Z', both: null });
    expect(other.getSettings()).toEqual({ reps: 2 });
  });

  it('形式が違うファイルは何も変えずに拒否する', async () => {
    await store.addSession(session('quick', '2026-10-01T00:00:00.000Z', 8));
    await expect(store.importAll({ app: 'other' })).rejects.toThrow();
    await expect(store.importAll({ app: 'o-span', version: 2 })).rejects.toThrow();
    await expect(store.importAll({ app: 'o-span', version: 1, sessions: [{}], calibration: null })).rejects.toThrow();
    expect(await store.listSessions()).toHaveLength(1);
  });

  it('parseExport: 設定や練習の記録が欠けた古い書き出しも既定値で読める', () => {
    const d = parseExport({ app: 'o-span', version: 1, sessions: [], calibration: null });
    expect(d.settings).toEqual({ reps: 1 });
    expect(d.practice).toEqual({ letters: null, both: null });
  });
});
