import { useState } from "react";
import { negateExpense, sumAll, sumByMonth } from "../aggregate/period.js";
import { isCategorizable, UNCATEGORIZED, type LearnedCategories } from "../category/classify.js";
import { colorOf } from "../category/color.js";
import { expenseCategories } from "../category/manage.js";
import type { TransactionSource } from "../domain/transaction.js";
import {
  NO_QUERY,
  queryTransactions,
  type TransactionKind,
  type TransactionQuery,
} from "../list/query.js";
import { PER_PAGE, clampPage, pageCount, pageRange, pageSlice } from "../list/paginate.js";
import { deleteTransaction } from "../storage/db.js";
import type { CategoryRecord, StoredTransaction } from "../storage/schema.js";
import { CategoryDot } from "./CategoryDot.js";
import { TransactionEditor } from "./TransactionEditor.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

const SOURCE_LABEL = {
  card: "カード",
  bank: "銀行",
  cash: "現金",
} as const;

const KIND_LABEL: Record<TransactionKind, string> = {
  expense: "支出",
  income: "収入",
};

interface Props {
  db: IDBDatabase;
  transactions: StoredTransaction[];
  /** 絞り込みに出すカテゴリ。並び順はマスタのもの */
  categories: readonly string[];
  /** 色を引くためのマスタ。並び順は `categories` 側を正とする */
  master: readonly CategoryRecord[];
  learned: LearnedCategories;
  /** 摘要ごとに覚える。同じ摘要の取引はまとめて動く */
  onCategoryChange: (description: string, category: string) => void;
  /** 1件の編集・削除のあとに呼ぶ。一覧を読み直す */
  onChanged: () => void;
}

export function TransactionList({
  db,
  transactions,
  categories,
  master,
  learned,
  onCategoryChange,
  onChanged,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [query, setQuery] = useState<TransactionQuery>(NO_QUERY);
  const [requestedPage, setRequestedPage] = useState(1);

  if (transactions.length === 0) {
    return <p>取引がありません。CSV取り込みから始めてください。</p>;
  }

  async function remove(id: string) {
    try {
      await deleteTransaction(db, id);
      setConfirming(null);
      onChanged();
    } catch (error) {
      setFailure(`削除できませんでした: ${String(error)}`);
    }
  }

  function narrow(patch: Partial<TransactionQuery>) {
    setQuery((current) => ({ ...current, ...patch }));
    // 条件を変えたら先頭に戻す。3ページ目を見たまま絞り込むと、clampPage が
    // 最後のページに寄せる——結果の先頭が見えないので、意図的に1に戻す。
    setRequestedPage(1);
    setEditing(null);
    setConfirming(null);
  }

  // 絞り込み・並べ替え・ページ送り・合計はすべて壁の中。ここは呼んで並べるだけ。
  const found = queryTransactions(transactions, query);
  const page = clampPage(requestedPage, found.length, PER_PAGE);
  const sorted = pageSlice(found, page, PER_PAGE);
  const totals = sumAll(found);
  const range = pageRange(found.length, page, PER_PAGE);
  const pages = pageCount(found.length, PER_PAGE);
  // 月の選択肢はデータから作る。取引の無い月を並べても選ぶ意味が無い。
  const months = sumByMonth(transactions)
    .map((total) => total.period)
    .reverse();

  return (
    <>
      {failure !== "" && <p style={styles.failure}>{failure}</p>}

      <div style={styles.filters}>
        <input
          type="search"
          aria-label="検索"
          placeholder="摘要・メモを検索"
          style={styles.search}
          value={query.text}
          onChange={(e) => narrow({ text: e.target.value })}
        />
        <select
          aria-label="月で絞り込む"
          value={query.month ?? ""}
          onChange={(e) => narrow({ month: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">すべての月</option>
          {months.map((month) => (
            <option key={month} value={month}>
              {month}
            </option>
          ))}
        </select>
        <select
          aria-label="カテゴリで絞り込む"
          value={query.category ?? ""}
          onChange={(e) => narrow({ category: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">すべてのカテゴリ</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          aria-label="支払い方法で絞り込む"
          value={query.source ?? ""}
          onChange={(e) =>
            narrow({ source: e.target.value === "" ? null : (e.target.value as TransactionSource) })
          }
        >
          <option value="">すべての支払い方法</option>
          {(Object.keys(SOURCE_LABEL) as TransactionSource[]).map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABEL[source]}
            </option>
          ))}
        </select>
        <select
          aria-label="種別で絞り込む"
          value={query.kind ?? ""}
          onChange={(e) =>
            narrow({ kind: e.target.value === "" ? null : (e.target.value as TransactionKind) })
          }
        >
          <option value="">支出と収入</option>
          {(Object.keys(KIND_LABEL) as TransactionKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        {query !== NO_QUERY && (
          <button type="button" style={styles.small} onClick={() => narrow(NO_QUERY)}>
            条件を消す
          </button>
        )}
      </div>

      {/* 合計は絞り込んだ集合そのものから出す。表に並んでいる行と食い違わない */}
      <p style={styles.summary}>
        <span style={styles.count}>{found.length} 件</span>
        <span style={styles.total}>支出 {YEN.format(negateExpense(totals.expenseYen))}</span>
        <span style={styles.income}>収入 {YEN.format(totals.incomeYen)}</span>
        {found.length > 0 && (
          <span style={styles.range}>
            {range.first}〜{range.last} 件目を表示
          </span>
        )}
      </p>

      {found.length === 0 ? (
        <p>条件に合う取引がありません。</p>
      ) : (
        <>
      {/*
        折り返さない列（日付・元・金額・操作）を入れたぶん、狭い幅では表が
        入りきらない。はみ出す方向に流すと操作の列に手が届かなくなるので、
        表だけを横に送れるようにする。
      */}
      <div style={styles.scroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>日付</th>
            <th style={styles.th}>摘要</th>
            <th style={styles.th}>カテゴリ</th>
            <th style={styles.th}>元</th>
            <th style={{ ...styles.th, textAlign: "right" }}>金額</th>
            <th style={styles.th} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) =>
            editing === t.id ? (
              <tr key={t.id}>
                <td style={styles.editorCell} colSpan={6}>
                  <TransactionEditor
                    db={db}
                    transaction={t}
                    learned={learned}
                    onSaved={() => {
                      setEditing(null);
                      onChanged();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </td>
              </tr>
            ) : (
              <tr key={t.id}>
                <td style={styles.tdNoWrap}>{t.date}</td>
                <td style={styles.td}>
                  {t.description}
                  {t.memo !== "" && <span style={styles.memo}>{t.memo}</span>}
                </td>
                {/*
                  編集欄を出すのは支出だけ。判定は壁の中（isCategorizable）にあり、
                  ここで符号を見て書き直さない。学習のキーは摘要だけで符号を持たないので、
                  収入のカテゴリを直せると同じ摘要の支出まで動く。
                */}
                <td style={styles.td}>
                  <span style={styles.categoryCell}>
                    <CategoryDot color={colorOf(master, t.category)} />
                    {isCategorizable(t) ? (
                      <select
                        value={t.category}
                        onChange={(e) => onCategoryChange(t.description, e.target.value)}
                        style={
                          t.category === UNCATEGORIZED ? styles.selectUncategorized : styles.select
                        }
                      >
                        {/*
                          選択肢はマスタから作る。ルールの定数（CATEGORIES）から
                          作ると、名前を変えたあとに存在しないカテゴリを選べる。
                        */}
                        {expenseCategories(categories).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={styles.fixedCategory}>{t.category}</span>
                    )}
                  </span>
                </td>
                <td style={styles.tdNoWrap}>{SOURCE_LABEL[t.source]}</td>
                <td
                  style={{
                    ...styles.tdNoWrap,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {YEN.format(t.amountYen)}
                </td>
                <td style={styles.tdNoWrap}>
                  {/*
                    削除は取り消せない（AGENTS.md 6）。1クリックでは消さず、
                    その場で確認に変える。押し間違いと確認を同じ場所で見せるため、
                    ダイアログではなく行の中に出す。
                  */}
                  {confirming === t.id ? (
                    <>
                      <span style={styles.confirmText}>削除しますか？</span>
                      <button type="button" style={styles.danger} onClick={() => void remove(t.id)}>
                        削除する
                      </button>
                      <button type="button" style={styles.small} onClick={() => setConfirming(null)}>
                        やめる
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        style={styles.small}
                        onClick={() => {
                          setConfirming(null);
                          setEditing(t.id);
                        }}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        style={styles.small}
                        onClick={() => {
                          setEditing(null);
                          setConfirming(t.id);
                        }}
                      >
                        削除
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      </div>

      {pages > 1 && (
        <p style={styles.pager}>
          <button
            type="button"
            style={styles.small}
            disabled={page <= 1}
            onClick={() => setRequestedPage(page - 1)}
          >
            前へ
          </button>
          <span style={styles.pageLabel}>
            {page} / {pages}
          </span>
          <button
            type="button"
            style={styles.small}
            disabled={page >= pages}
            onClick={() => setRequestedPage(page + 1)}
          >
            次へ
          </button>
        </p>
      )}
        </>
      )}
    </>
  );
}

const styles = {
  scroll: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    borderBottom: "2px solid var(--line)",
    padding: "6px 8px",
    fontWeight: 600,
  },
  td: { borderBottom: "1px solid var(--line)", padding: "6px 8px" },
  // 色の点と選択欄を1行に保つ。列が狭いと点だけが上の行に置き去りになる。
  categoryCell: { display: "inline-flex", alignItems: "center" },
  // 日付・元・金額・操作は折り返さない。折り返すと「カード」が縦に1文字ずつ並ぶ。
  tdNoWrap: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    whiteSpace: "nowrap",
  },
  editorCell: { borderBottom: "1px solid var(--accent)", padding: 0 },
  memo: { marginLeft: 8, fontSize: 12, color: "var(--faint)" },
  select: { fontSize: 13, padding: "2px 4px" },
  fixedCategory: { fontSize: 13, color: "var(--muted)" },
  // 未分類は目で拾えるようにする。ルールを足す対象がここに集まる。
  selectUncategorized: {
    fontSize: 13,
    padding: "2px 4px",
    background: "var(--error)",
  },
  small: { fontSize: 12, padding: "2px 8px", marginLeft: 4, color: "var(--muted)" },
  danger: {
    fontSize: 12,
    padding: "2px 8px",
    marginLeft: 4,
    background: "var(--danger)",
    borderColor: "var(--danger)",
    color: "var(--accent-fg)",
    fontWeight: 650,
  },
  confirmText: { fontSize: 12, color: "var(--danger)" },
  failure: { background: "var(--error)", padding: "8px 12px", borderRadius: 6 },
  filters: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 },
  search: { flex: "1 1 200px", minWidth: 160 },
  summary: {
    display: "flex",
    gap: 16,
    alignItems: "baseline",
    flexWrap: "wrap",
    margin: "0 0 12px",
    fontSize: 13,
    color: "var(--muted)",
  },
  count: { color: "var(--fg)", fontWeight: 650, fontVariantNumeric: "tabular-nums" },
  total: { color: "var(--fg)", fontVariantNumeric: "tabular-nums" },
  income: { color: "var(--income)", fontVariantNumeric: "tabular-nums" },
  range: { marginLeft: "auto", color: "var(--faint)", fontVariantNumeric: "tabular-nums" },
  pager: { display: "flex", gap: 10, alignItems: "center", justifyContent: "center", marginTop: 14 },
  pageLabel: { fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums" },
} as const;
