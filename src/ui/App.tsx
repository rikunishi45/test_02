import { useCallback, useEffect, useState } from "react";
import { getAllTransactions } from "../storage/db.js";
import type { StoredTransaction } from "../storage/schema.js";
import { useDatabase } from "./useDatabase.js";
import { ImportScreen } from "./ImportScreen.js";
import { TransactionList } from "./TransactionList.js";
import { BackupPanel } from "./BackupPanel.js";

type Tab = "list" | "import";

export function App() {
  const database = useDatabase();
  const [tab, setTab] = useState<Tab>("list");
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);

  const db = database.status === "ready" ? database.db : null;

  const reload = useCallback(async () => {
    if (db === null) {
      return;
    }
    setTransactions(await getAllTransactions(db));
  }, [db]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (database.status === "loading") {
    return <main style={styles.main}>読み込み中…</main>;
  }
  if (database.status === "error") {
    return <main style={styles.main}>データベースを開けませんでした: {database.message}</main>;
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>家計簿</h1>

      <nav style={styles.nav}>
        <button
          type="button"
          onClick={() => setTab("list")}
          style={tab === "list" ? styles.tabActive : styles.tab}
        >
          一覧（{transactions.length}件）
        </button>
        <button
          type="button"
          onClick={() => setTab("import")}
          style={tab === "import" ? styles.tabActive : styles.tab}
        >
          CSV取り込み
        </button>
      </nav>

      {tab === "list" ? (
        <TransactionList transactions={transactions} />
      ) : (
        <ImportScreen db={database.db} existing={transactions} onImported={reload} />
      )}

      <BackupPanel db={database.db} onRestored={reload} />
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 960,
    margin: "0 auto",
    padding: 24,
  },
  title: { fontSize: 20, margin: "0 0 16px" },
  nav: { display: "flex", gap: 8, marginBottom: 16 },
  tab: { padding: "6px 14px", borderRadius: 6 },
  tabActive: {
    padding: "6px 14px",
    borderRadius: 6,
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
  },
} as const;
