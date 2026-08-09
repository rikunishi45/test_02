import { useEffect, useState } from "react";
import { requestPersistence, type PersistenceState } from "../storage/persistence.js";

// このファイルは src/ui/ 配下なので壁の外（useDatabase.ts と同じ）。
// 判定は requestPersistence（壁の中）にあり、ここは呼んで状態に載せるだけ。

/** 要求の結果。まだ返ってきていない間は null */
export function usePersistence(): PersistenceState | null {
  const [state, setState] = useState<PersistenceState | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestPersistence(navigator.storage)
      .then((result) => {
        if (!cancelled) {
          setState(result);
        }
      })
      // 失敗したときに null のままにしない。警告は「null 以外かつ persisted 以外」で
      // 出るので、null で固まると**データが揮発し得る状態で何も伝わらない**。
      // 要求が通ったと確認できない以上、警告が出る側に倒す。
      .catch(() => {
        if (!cancelled) {
          setState("unsupported");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
