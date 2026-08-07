import { useEffect, useState } from "react";
import { openDatabase } from "../storage/db.js";

// このファイルは src/ui/ 配下なので壁の外（vitest.config.ts / stryker.config.mjs で除外）。
// 拡張子が .ts なのは JSX を含まないため。判定や変換は書かず、
// openDatabase を呼んで結果を React の状態に載せるだけにしてある。

export type DatabaseState =
  | { status: "loading" }
  | { status: "ready"; db: IDBDatabase }
  | { status: "error"; message: string };

export function useDatabase(): DatabaseState {
  const [state, setState] = useState<DatabaseState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    openDatabase(indexedDB)
      .then((db) => {
        if (!cancelled) {
          setState({ status: "ready", db });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
