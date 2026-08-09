import { useState } from "react";
import { buildBackup, parseBackup } from "../storage/backup.js";
import {
  getAllBudgets,
  getAllCategories,
  getAllColumnMappings,
  getAllImports,
  getAllTransactions,
  getLearnedCategories,
  replaceAll,
} from "../storage/db.js";
/**
 * バックアップの書き出しと復元。
 *
 * IndexedDBは永続保証が無く、ブラウザのデータ削除やストレージ逼迫で消える。
 * 元のCSVを取っておいても、手動入力とカテゴリの修正は戻らない。
 * だからアプリ自身のデータを書き出せる経路が要る。
 *
 * 永続化の警告はここではなく `PersistenceBanner` が全画面に出す。この画面を
 * 見に来た人だけが知ればよい情報ではないため。
 */
export function BackupPanel({
  db,
  onRestored,
}: {
  db: IDBDatabase;
  onRestored: () => void;
}) {
  const [message, setMessage] = useState("");

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
    setMessage(`${backup.transactions.length}件を書き出しました。`);
  }

  async function importBackup(file: File) {
    try {
      // 先に中身を検証してから確認を出す。壊れたファイルなら、いま入っている
      // データに触れずに済ませたい。
      const backup = parseBackup(await file.text());

      // replaceAll は4ストアを全消しする。取り消せないので必ず確認を挟む。
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
      onRestored();
    } catch (error) {
      setMessage(`復元できませんでした: ${String(error)}`);
    }
  }

  return (
    <section>
      <h2 style={styles.h2}>バックアップ</h2>
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
      {message !== "" && <p>{message}</p>}
    </section>
  );
}

const styles = {
  h2: { fontSize: 15, margin: "0 0 8px" },
  note: { fontSize: 13, color: "var(--muted)", margin: "0 0 8px" },
  warn: { fontSize: 13, color: "var(--danger)", margin: "8px 0 0" },
  row: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" },
} as const;
