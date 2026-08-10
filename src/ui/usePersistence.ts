import { useCallback, useEffect, useState } from "react";
import { requestPersistence, type PersistenceState } from "../storage/persistence.js";

// このファイルは src/ui/ 配下なので壁の外（useDatabase.ts と同じ）。
// 判定は requestPersistence（壁の中）にあり、ここは呼んで状態に載せるだけ。

export interface Persistence {
  /** 要求の結果。まだ返ってきていない間は null */
  state: PersistenceState | null;
  /**
   * もう一度要求する。設定画面のボタンから呼ぶ。
   *
   * `persist()` は既に許可済みなら true を返すので、状態の読み直しも兼ねる。
   * ブラウザは使用状況（訪問頻度・ブックマーク）で判断を変えるので、
   * 一度断られた状態は固定ではない——**再要求の経路が無いと、断られた人は
   * 永久に断られたままになる。**
   */
  request: () => Promise<void>;
}

export function usePersistence(): Persistence {
  const [state, setState] = useState<PersistenceState | null>(null);

  const request = useCallback(async () => {
    try {
      setState(await requestPersistence(navigator.storage));
    } catch {
      // 失敗したときに null のままにしない。警告は「null 以外かつ persisted 以外」で
      // 出るので、null で固まると**データが揮発し得る状態で何も伝わらない**。
      // 要求が通ったと確認できない以上、警告が出る側に倒す。
      setState("unsupported");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    requestPersistence(navigator.storage)
      .then((result) => {
        if (!cancelled) {
          setState(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState("unsupported");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, request };
}
