import { useCallback, useEffect, useState } from "react";
import { getAllTransactions, getLearnedCategories, putTransactions, setLearnedCategory } from "../storage/db.js";
import type { LearnedCategories } from "../category/classify.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import { reclassifyTransactions } from "../category/reclassify.js";
import type { StoredTransaction } from "../storage/schema.js";
import { useDatabase } from "./useDatabase.js";
import { usePersistence } from "./usePersistence.js";
import { ImportScreen } from "./ImportScreen.js";
import { CashEntryScreen } from "./CashEntryScreen.js";
import { TransactionList } from "./TransactionList.js";
import { SummaryScreen } from "./SummaryScreen.js";
import { BackupPanel } from "./BackupPanel.js";

type Tab = "summary" | "list" | "import" | "cash";

export function App() {
  const database = useDatabase();
  const persistence = usePersistence();
  const [tab, setTab] = useState<Tab>("summary");
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);
  const [learned, setLearned] = useState<LearnedCategories>({});

  const db = database.status === "ready" ? database.db : null;

  // 読み込みのたびに分類し直す。ルールは後から増えるので、取り込み時に決めた
  // カテゴリを固定すると過去の取引が未分類のまま取り残される。
  // reclassify は冪等なので、書き戻した後にもう一度走らせても変化ゼロで止まる。
  const reload = useCallback(async () => {
    if (db === null) {
      return;
    }
    const [rows, learnedNow] = await Promise.all([
      getAllTransactions(db),
      getLearnedCategories(db),
    ]);
    setLearned(learnedNow);

    const changed = reclassifyTransactions(rows, DEFAULT_CATEGORY_RULES, learnedNow);
    if (changed.length === 0) {
      setTransactions(rows);
      return;
    }
    await putTransactions(db, changed);
    setTransactions(await getAllTransactions(db));
  }, [db]);

  // learned をここで読まない。画面が持っている古いマップを基に書き戻すと、
  // 2件を続けて直したときに1件目が消える。単一キーの更新に任せる。
  const changeCategory = useCallback(
    async (description: string, category: string) => {
      if (db === null) {
        return;
      }
      await setLearnedCategory(db, description, category);
      await reload();
    },
    [db, reload],
  );

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
          onClick={() => setTab("summary")}
          style={tab === "summary" ? styles.tabActive : styles.tab}
        >
          集計
        </button>
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
        <button
          type="button"
          onClick={() => setTab("cash")}
          style={tab === "cash" ? styles.tabActive : styles.tab}
        >
          現金入力
        </button>
      </nav>

      {tab === "summary" && <SummaryScreen transactions={transactions} />}
      {tab === "list" && (
        <TransactionList
          transactions={transactions}
          onCategoryChange={(description, category) => void changeCategory(description, category)}
        />
      )}
      {tab === "import" && (
        <ImportScreen
          db={database.db}
          existing={transactions}
          learned={learned}
          onImported={reload}
        />
      )}
      {tab === "cash" && (
        <CashEntryScreen db={database.db} learned={learned} onSaved={reload} />
      )}

      <BackupPanel db={database.db} persistence={persistence} onRestored={reload} />
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
