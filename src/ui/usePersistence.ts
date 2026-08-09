import { useEffect, useState } from "react";
import { requestPersistence, type PersistenceState } from "../storage/persistence.js";

// このファイルは src/ui/ 配下なので壁の外（useDatabase.ts と同じ）。
// 判定は requestPersistence（壁の中）にあり、ここは呼んで状態に載せるだけ。

/** 要求の結果。まだ返ってきていない間は null */
export function usePersistence(): PersistenceState | null {
  const [state, setState] = useState<PersistenceState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void requestPersistence(navigator.storage).then((result) => {
      if (!cancelled) {
        setState(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
