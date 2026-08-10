import { useRef, useState } from "react";
import { buildBackup, parseBackup } from "../storage/backup.js";
import {
  clearAllData,
  getAllBudgets,
  getAllCategories,
  getAllColumnMappings,
  getAllImports,
  getAllTransactions,
  getLearnedCategories,
  replaceAll,
} from "../storage/db.js";
import type { PersistenceState } from "../storage/persistence.js";
import type { Persistence } from "./usePersistence.js";

const PERSISTENCE_LABEL: Record<PersistenceState, string> = {
  persisted: "許可されています",
  denied: "許可されていません",
  unsupported: "この環境では要求できません",
};

/**
 * データの管理。バックアップの書き出し・復元、永続化の状態、全消去。
 *
 * IndexedDBは永続保証が無く、ブラウザのデータ削除やストレージ逼迫で消える。
 * 元のCSVを取っておいても、手動入力とカテゴリの修正は戻らない。
 * だからアプリ自身のデータを書き出せる経路が要る。
 *
 * 永続化の警告はここではなく `PersistenceBanner` が全画面に出す。ここに出すのは
 * 現在の状態と、断られたときの再要求。
 */
export function DataPanel({
  db,
  persistence,
  onRestored,
}: {
  db: IDBDatabase;
  persistence: Persistence;
  onRestored: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  /**
   * この画面を開いてから書き出したか。
   *
   * **全消去はこれが真になるまで押せない。** 消す直前に書き出させるための
   * 段差であって、「バックアップが存在する証明」ではない——書き出しを
   * 押したかどうかしか見ていないし、画面を再読み込みすれば消える。
   * それでも「消す前に一度も書き出していない」事故は塞げる。
   */
  const [exported, setExported] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const running = useRef(false);

  async function exportBackup() {
    const backup = buildBackup(
      {
        transactions: await getAllTransactions(db),
        imports: await getAllImports(db),
        columnMappings: await getAllColumnMappings(db),
        learnedCategories: await getLearnedCategories(db),
        categories: await getAllCategories(db),
        budgets: await getAllBudgets(db),
      },
      new Date().toISOString(),
    );

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kakeibo-backup-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setMessage(`${backup.transactions.length}件を書き出しました。`);
  }

  async function importBackup(file: File) {
    try {
      // 先に中身を検証してから確認を出す。壊れたファイルなら、いま入っている
      // データに触れずに済ませたい。
      const backup = parseBackup(await file.text());

      // replaceAll は全ストアを消す。取り消せないので必ず確認を挟む。
      const ok = window.confirm(
        `いま入っているデータをすべて削除して、${backup.transactions.length}件で置き換えます。\n` +
          `この操作は取り消せません。続けますか？`,
      );
      if (!ok) {
        setMessage("復元を中止しました。");
        return;
      }

      await replaceAll(db, backup);
      setMessage(`${backup.transactions.length}件を復元しました。`);
      await onRestored();
    } catch (error) {
      setMessage(`復元できませんでした: ${String(error)}`);
    }
  }

  async function clearAll() {
    if (running.current) {
      return;
    }
    running.current = true;
    try {
      await clearAllData(db);
      setConfirmingClear(false);
      setExported(false);
      setMessage("すべてのデータを削除しました。カテゴリは初期値に戻っています。");
      await onRestored();
    } catch (error) {
      setMessage(`削除できませんでした: ${String(error)}`);
    } finally {
      running.current = false;
    }
  }

  return (
    <section>
      <h2 style={styles.h2}>データ</h2>
      <p style={styles.note}>
        データはこのブラウザの中だけに保存されます。ブラウザのデータを消すと失われるので、
        ときどき書き出しておいてください。
      </p>

      <p style={styles.row}>
        <button type="button" onClick={() => void exportBackup()}>
          書き出す（JSON）
        </button>
        <label>
          復元：
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) {
                void importBackup(file);
              }
            }}
          />
        </label>
      </p>
      <p style={styles.warn}>復元すると、いま入っているデータは置き換わります。</p>
      {message !== "" && <p style={styles.message}>{message}</p>}

      <h3 style={styles.h3}>保存の永続化</h3>
      <p style={styles.row}>
        <span style={styles.state}>
          {persistence.state === null ? "確認中…" : PERSISTENCE_LABEL[persistence.state]}
        </span>
        {/*
          一度断られても固定ではない。ブラウザは訪問頻度やブックマークで判断を
          変えるので、要求し直す経路を残す。
        */}
        {persistence.state !== "persisted" && (
          <button type="button" onClick={() => void persistence.request()}>
            もう一度要求する
          </button>
        )}
      </p>
      <p style={styles.note}>
        許可されると、ストレージが逼迫してもブラウザの判断でこのデータが消されなくなります。
      </p>

      <h3 style={styles.h3}>すべて削除</h3>
      <p style={styles.note}>
        取引・取り込み履歴・学習したカテゴリをすべて消します。カテゴリは初期値に戻ります。
        <strong style={styles.strong}>取り消せません。</strong>
      </p>
      {/*
        書き出す前に消せないようにする。段差であって証明ではない（この画面を
        開いてから書き出しを押したか、しか見ていない）が、「一度も書き出さずに
        消す」事故はこれで塞がる。
      */}
      {!exported && (
        <p style={styles.blocked}>先にバックアップを書き出してください。</p>
      )}
      <p style={styles.row}>
        {confirmingClear ? (
          <>
            <span style={styles.confirmText}>本当にすべて削除しますか？</span>
            <button type="button" style={styles.danger} onClick={() => void clearAll()}>
              すべて削除する
            </button>
            <button type="button" onClick={() => setConfirmingClear(false)}>
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            style={exported ? styles.danger : undefined}
            disabled={!exported}
            onClick={() => setConfirmingClear(true)}
          >
            すべて削除
          </button>
        )}
      </p>
    </section>
  );
}

const styles = {
  h2: { fontSize: 15, margin: "0 0 8px" },
  h3: { fontSize: 14, margin: "24px 0 6px" },
  note: { fontSize: 13, color: "var(--muted)", margin: "0 0 8px" },
  warn: { fontSize: 13, color: "var(--danger)", margin: "8px 0 0" },
  message: { fontSize: 13, background: "var(--success)", padding: "6px 10px", borderRadius: 6 },
  row: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" },
  state: { fontSize: 13 },
  strong: { color: "var(--danger)" },
  blocked: { fontSize: 13, color: "var(--danger)", margin: "0 0 8px" },
  confirmText: { fontSize: 13, color: "var(--danger)", fontWeight: 650 },
  danger: {
    background: "var(--danger)",
    borderColor: "var(--danger)",
    color: "var(--accent-fg)",
    fontWeight: 650,
  },
} as const;
