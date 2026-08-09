import { useState } from "react";
import { isCategorizable, UNCATEGORIZED, type LearnedCategories } from "../category/classify.js";
import { CATEGORIES } from "../category/default-rules.js";
import { deleteTransaction } from "../storage/db.js";
import type { StoredTransaction } from "../storage/schema.js";
import { TransactionEditor } from "./TransactionEditor.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

const SOURCE_LABEL = {
  card: "カード",
  bank: "銀行",
  cash: "現金",
} as const;

interface Props {
  db: IDBDatabase;
  transactions: StoredTransaction[];
  learned: LearnedCategories;
  /** 摘要ごとに覚える。同じ摘要の取引はまとめて動く */
  onCategoryChange: (description: string, category: string) => void;
  /** 1件の編集・削除のあとに呼ぶ。一覧を読み直す */
  onChanged: () => void;
}

export function TransactionList({
  db,
  transactions,
  learned,
  onCategoryChange,
  onChanged,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState("");

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

  // 表示順だけの並べ替え。集計や判定はここでしない（壁の外なので）。
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      {failure !== "" && <p style={styles.failure}>{failure}</p>}
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
                  {isCategorizable(t) ? (
                    <select
                      value={t.category}
                      onChange={(e) => onCategoryChange(t.description, e.target.value)}
                      style={
                        t.category === UNCATEGORIZED ? styles.selectUncategorized : styles.select
                      }
                    >
                      <option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={styles.fixedCategory}>{t.category}</span>
                  )}
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
} as const;
