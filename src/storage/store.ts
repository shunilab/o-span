import type { Calibration } from '../core/calibration';
import type { Mode } from '../core/flow';
import type { SessionScore } from '../core/scoring';
import type { TrialRecord } from '../core/trial';

/** 1 回のセッションの保存形式。正式とクイックは mode で系列を分ける。 */
export interface SessionRecord {
  id?: number;
  mode: Mode;
  /** 終了日時（ISO 8601）。 */
  at: string;
  timeLimit: number;
  score: SessionScore;
  trials: TrialRecord[];
}

export interface Settings {
  /** クイックモードの繰り返し数（系列長 3〜7 を各 reps 回）。 */
  reps: 1 | 2 | 3;
}

export const DEFAULT_SETTINGS: Settings = { reps: 1 };

export interface ExportData {
  app: 'o-span';
  version: 1;
  exportedAt: string;
  calibration: Calibration | null;
  settings: Settings;
  sessions: SessionRecord[];
}

const SESSIONS = 'sessions';
const META = 'meta';
const CALIBRATION_KEY = 'calibration';

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** IndexedDB（成績・キャリブレーション）と localStorage（設定）への保存。 */
export class Store {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName = 'o-span',
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage(),
  ) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(SESSIONS, { keyPath: 'id', autoIncrement: true });
        db.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async addSession(record: Omit<SessionRecord, 'id'>): Promise<number> {
    const db = await this.db();
    const tx = db.transaction(SESSIONS, 'readwrite');
    const id = (await wrap(tx.objectStore(SESSIONS).add(record))) as number;
    await done(tx);
    return id;
  }

  /** 新しい順。mode を指定するとその系列だけ。 */
  async listSessions(mode?: Mode): Promise<SessionRecord[]> {
    const db = await this.db();
    const all = (await wrap(db.transaction(SESSIONS).objectStore(SESSIONS).getAll())) as SessionRecord[];
    return all
      .filter((s) => mode === undefined || s.mode === mode)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (b.id ?? 0) - (a.id ?? 0)));
  }

  async clearSessions(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(SESSIONS, 'readwrite');
    tx.objectStore(SESSIONS).clear();
    await done(tx);
  }

  async getCalibration(): Promise<Calibration | null> {
    const db = await this.db();
    const v = (await wrap(db.transaction(META).objectStore(META).get(CALIBRATION_KEY))) as Calibration | undefined;
    return v ?? null;
  }

  async setCalibration(c: Calibration): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(c, CALIBRATION_KEY);
    await done(tx);
  }

  async clearCalibration(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).delete(CALIBRATION_KEY);
    await done(tx);
  }

  getSettings(): Settings {
    try {
      const raw = this.storage?.getItem('o-span:settings');
      if (raw) return normalizeSettings(JSON.parse(raw));
    } catch {
      // 保存領域が使えない・壊れている場合は既定値で動く
    }
    return { ...DEFAULT_SETTINGS };
  }

  setSettings(s: Settings): void {
    try {
      this.storage?.setItem('o-span:settings', JSON.stringify(s));
    } catch {
      // 保存できなくても動作は続ける
    }
  }

  async exportAll(now = new Date()): Promise<ExportData> {
    return {
      app: 'o-span',
      version: 1,
      exportedAt: now.toISOString(),
      calibration: await this.getCalibration(),
      settings: this.getSettings(),
      sessions: await this.listSessions(),
    };
  }

  /** 書き出した JSON で、成績・キャリブレーション・設定を置き換える。形式が違えば何も変えずに例外を投げる。 */
  async importAll(data: unknown): Promise<{ sessions: number }> {
    const d = parseExport(data);
    await this.clearSessions();
    for (const s of d.sessions) {
      const { id: _id, ...rest } = s;
      await this.addSession(rest);
    }
    if (d.calibration) await this.setCalibration(d.calibration);
    else await this.clearCalibration();
    this.setSettings(d.settings);
    return { sessions: d.sessions.length };
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeSettings(v: unknown): Settings {
  const reps = (v as { reps?: unknown } | null)?.reps;
  return { reps: reps === 2 || reps === 3 ? reps : 1 };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isCalibration(v: unknown): v is Calibration {
  return isObj(v) && isNum(v.timeLimit) && isNum(v.mean) && isNum(v.sd) && isNum(v.n) && isNum(v.problems) && typeof v.at === 'string';
}

function isSession(v: unknown): v is SessionRecord {
  return (
    isObj(v) &&
    (v.mode === 'quick' || v.mode === 'formal') &&
    typeof v.at === 'string' &&
    isNum(v.timeLimit) &&
    isObj(v.score) &&
    isNum(v.score.score) &&
    isNum(v.score.maxScore) &&
    Array.isArray(v.trials)
  );
}

export function parseExport(data: unknown): ExportData {
  if (!isObj(data) || data.app !== 'o-span') throw new Error('O-Span の書き出しファイルではありません');
  if (data.version !== 1) throw new Error('対応していないバージョンです');
  if (!Array.isArray(data.sessions) || !data.sessions.every(isSession)) throw new Error('成績の形式が正しくありません');
  if (data.calibration !== null && !isCalibration(data.calibration)) throw new Error('キャリブレーションの形式が正しくありません');
  return {
    app: 'o-span',
    version: 1,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    calibration: data.calibration,
    settings: normalizeSettings(data.settings),
    sessions: data.sessions,
  };
}

/** 端末のストレージが勝手に消されないよう、永続化を要求する。 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
