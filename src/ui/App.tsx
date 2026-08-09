import { useCallback, useEffect, useState } from "react";
import {
  getAllCategories,
  getAllTransactions,
  getLearnedCategories,
  putTransactions,
  setLearnedCategory,
} from "../storage/db.js";
import type { LearnedCategories } from "../category/classify.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import { categoryNames } from "../category/default-categories.js";
import { reclassifyTransactions } from "../category/reclassify.js";
import type { StoredTransaction } from "../storage/schema.js";
import { useDatabase } from "./useDatabase.js";
import { usePersistence } from "./usePersistence.js";
import { AppShell, type NavItem } from "./AppShell.js";
import { PersistenceBanner } from "./PersistenceBanner.js";
import { ImportScreen } from "./ImportScreen.js";
import { CashEntryScreen } from "./CashEntryScreen.js";
import { CalendarScreen } from "./CalendarScreen.js";
import { TransactionList } from "./TransactionList.js";
import { SummaryScreen } from "./SummaryScreen.js";
import { BackupPanel } from "./BackupPanel.js";

/**
 * 画面。ホームとカレンダーはまだ無い（段階6・段階2で足す）。
 * 順番はサイドバーの並びと同じ。
 */
type Tab = "report" | "list" | "cash" | "calendar" | "import" | "settings";

const TITLES: Record<Tab, string> = {
  report: "レポート",
  list: "取引一覧",
  cash: "取引を入力",
  calendar: "カレンダー",
  import: "取り込み",
  settings: "設定",
};

export function App() {
  const database = useDatabase();
  const persistence = usePersistence();
  const [tab, setTab] = useState<Tab>("report");
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);
  const [learned, setLearned] = useState<LearnedCategories>({});
  const [categories, setCategories] = useState<string[]>([]);

  const db = database.status === "ready" ? database.db : null;

  // 読み込みのたびに分類し直す。ルールは後から増えるので、取り込み時に決めた
  // カテゴリを固定すると過去の取引が未分類のまま取り残される。
  // reclassify は冪等なので、書き戻した後にもう一度走らせても変化ゼロで止まる。
  const reload = useCallback(async () => {
    if (db === null) {
      return;
    }
    const [rows, learnedNow, categoryRecords] = await Promise.all([
      getAllTransactions(db),
      getLearnedCategories(db),
      getAllCategories(db),
    ]);
    setLearned(learnedNow);
    setCategories(categoryNames(categoryRecords));

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
    return <p style={styles.plain}>読み込み中…</p>;
  }
  if (database.status === "error") {
    return <p style={styles.plain}>データベースを開けませんでした: {database.message}</p>;
  }

  const items: NavItem[] = [
    { id: "report", label: "レポート" },
    { id: "list", label: "取引一覧", count: transactions.length },
    { id: "cash", label: "取引を入力" },
    { id: "calendar", label: "カレンダー" },
    { id: "import", label: "取り込み", separatorBefore: true },
    { id: "settings", label: "設定" },
  ];

  return (
    <AppShell
      items={items}
      active={tab}
      onSelect={(id) => setTab(id as Tab)}
      title={TITLES[tab]}
      banner={<PersistenceBanner state={persistence} />}
    >
      {tab === "report" && <SummaryScreen transactions={transactions} />}
      {tab === "list" && (
        <TransactionList
          transactions={transactions}
          onCategoryChange={(description, category) => void changeCategory(description, category)}
        />
      )}
      {tab === "cash" && (
        <CashEntryScreen db={database.db} learned={learned} onSaved={reload} />
      )}
      {tab === "calendar" && (
        <CalendarScreen transactions={transactions} categories={categories} />
      )}
      {tab === "import" && (
        <ImportScreen
          db={database.db}
          existing={transactions}
          learned={learned}
          onImported={reload}
        />
      )}
      {tab === "settings" && <BackupPanel db={database.db} onRestored={reload} />}
    </AppShell>
  );
}

const styles = {
  plain: { padding: 24 },
} as const;
