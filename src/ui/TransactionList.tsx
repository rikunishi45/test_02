import { UNCATEGORIZED } from "../category/classify.js";
import { CATEGORIES } from "../category/default-rules.js";
import type { StoredTransaction } from "../storage/schema.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

const SOURCE_LABEL = {
  card: "カード",
  bank: "銀行",
  cash: "現金",
} as const;

interface Props {
  transactions: StoredTransaction[];
  /** 摘要ごとに覚える。同じ摘要の取引はまとめて動く */
  onCategoryChange: (description: string, category: string) => void;
}

export function TransactionList({ transactions, onCategoryChange }: Props) {
  if (transactions.length === 0) {
    return <p>取引がありません。CSV取り込みから始めてください。</p>;
  }

  // 表示順だけの並べ替え。集計や判定はここでしない（壁の外なので）。
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>日付</th>
          <th style={styles.th}>摘要</th>
          <th style={styles.th}>カテゴリ</th>
          <th style={styles.th}>元</th>
          <th style={{ ...styles.th, textAlign: "right" }}>金額</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((t) => (
          <tr key={t.id}>
            <td style={styles.td}>{t.date}</td>
            <td style={styles.td}>{t.description}</td>
            <td style={styles.td}>
              <select
                value={t.category}
                onChange={(e) => onCategoryChange(t.description, e.target.value)}
                style={t.category === UNCATEGORIZED ? styles.selectUncategorized : styles.select}
              >
                <option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </td>
            <td style={styles.td}>{SOURCE_LABEL[t.source]}</td>
            <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {YEN.format(t.amountYen)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const styles = {
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    borderBottom: "2px solid var(--line)",
    padding: "6px 8px",
    fontWeight: 600,
  },
  td: { borderBottom: "1px solid var(--line)", padding: "6px 8px" },
  select: { fontSize: 13, padding: "2px 4px" },
  // 未分類は目で拾えるようにする。ルールを足す対象がここに集まる。
  selectUncategorized: {
    fontSize: 13,
    padding: "2px 4px",
    background: "var(--error)",
  },
} as const;
