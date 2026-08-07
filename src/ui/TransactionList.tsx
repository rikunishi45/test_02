import type { StoredTransaction } from "../storage/schema.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

const SOURCE_LABEL = {
  card: "カード",
  bank: "銀行",
  cash: "現金",
} as const;

export function TransactionList({ transactions }: { transactions: StoredTransaction[] }) {
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
            <td style={styles.td}>{t.category}</td>
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
} as const;
