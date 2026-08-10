import {
  inMonth,
  monthOf,
  negateExpense,
  netYen,
  shiftMonth,
  sumAll,
} from "../aggregate/period.js";
import { compareByCategory, expenseDeltaYen } from "../aggregate/compare.js";
import { toIsoDate } from "../domain/date-parts.js";
import { sortForList } from "../list/query.js";
import { detectRecurring, totalMonthlyYen } from "../recurring/detect.js";
import type { StoredTransaction } from "../storage/schema.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

/** 上位いくつまで出すか。全部出すとレポート画面と同じになる */
const TOP_CATEGORIES = 5;
const RECENT_ROWS = 5;

const SOURCE_LABEL = { card: "カード", bank: "銀行", cash: "現金" } as const;

/**
 * ホーム。**今月がどうなっているか**だけを出す。
 *
 * 期間を選ばせない。選べる画面は既にレポートとカレンダーにあり、ここで3つ目を
 * 作ると「どこで何を見るか」が決まらなくなる。開いた瞬間に読めることだけを置く。
 */
export function HomeScreen({ transactions }: { transactions: StoredTransaction[] }) {
  const today = toIsoDate(new Date());
  const month = monthOf(today);

  if (transactions.length === 0) {
    return <p>取引がありません。CSV取り込みから始めてください。</p>;
  }

  const current = inMonth(transactions, month);
  const previous = inMonth(transactions, shiftMonth(month, -1));
  const total = sumAll(current);
  const comparison = compareByCategory(current, previous).slice(0, TOP_CATEGORIES);
  const charges = detectRecurring(transactions, month);
  const recent = sortForList(transactions).slice(0, RECENT_ROWS);
  // 引き算も壁の中。符号がひっくり返っても画面を見ただけでは気づけない。
  const expenseDelta = expenseDeltaYen(current, previous);

  return (
    <section>
      <div style={styles.cards}>
        <Card label={`${month} の支出`} tone="expense">
          {YEN.format(negateExpense(total.expenseYen))}
          <Delta yen={expenseDelta} />
        </Card>
        <Card label="収入" tone="income">
          {YEN.format(total.incomeYen)}
        </Card>
        <Card label="収支" tone={netYen(total) < 0 ? "expense" : "income"}>
          {YEN.format(netYen(total))}
        </Card>
        <Card label="固定費・サブスク" tone="plain">
          {YEN.format(negateExpense(totalMonthlyYen(charges)))}
          <span style={styles.sub}>／月・{charges.length}件</span>
        </Card>
      </div>

      <h2 style={styles.h2}>よく使っているカテゴリ</h2>
      {comparison.length === 0 ? (
        <p style={styles.empty}>今月の支出はまだありません。</p>
      ) : (
        <table style={styles.table}>
          <tbody>
            {comparison.map((row) => (
              <tr key={row.category}>
                <td style={styles.td}>{row.category}</td>
                <td style={styles.amount}>{YEN.format(negateExpense(row.expenseYen))}</td>
                <td style={styles.deltaCell}>
                  <Delta yen={row.deltaYen} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={styles.h2}>最近の取引</h2>
      <table style={styles.table}>
        <tbody>
          {recent.map((transaction) => (
            <tr key={transaction.id}>
              <td style={styles.dateCell}>{transaction.date}</td>
              <td style={styles.td}>{transaction.description}</td>
              <td style={styles.sourceCell}>{SOURCE_LABEL[transaction.source]}</td>
              <td style={styles.amount}>{YEN.format(transaction.amountYen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Card({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "expense" | "income" | "plain";
  children: React.ReactNode;
}) {
  return (
    <div style={styles.card}>
      <span style={styles.cardLabel}>{label}</span>
      <span style={{ ...styles.cardValue, ...toneStyle(tone) }}>{children}</span>
    </div>
  );
}

function toneStyle(tone: "expense" | "income" | "plain") {
  if (tone === "expense") {
    return { color: "var(--danger)" };
  }
  if (tone === "income") {
    return { color: "var(--income)" };
  }
  return { color: "var(--fg)" };
}

/** 支出の増減。増えたら赤、減ったら緑（支出なので「増えた」が悪い側） */
function Delta({ yen }: { yen: number }) {
  if (yen === 0) {
    return <span style={styles.deltaFlat}>先月と同じ</span>;
  }
  return (
    <span style={yen > 0 ? styles.deltaUp : styles.deltaDown}>
      先月比 {yen > 0 ? "+" : "−"}
      {YEN.format(Math.abs(yen))}
    </span>
  );
}

const styles = {
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
  },
  card: {
    display: "grid",
    gap: 4,
    border: "1px solid var(--line)",
    borderRadius: 8,
    padding: "12px 14px",
    background: "var(--surface)",
  },
  cardLabel: { fontSize: 12, color: "var(--muted)" },
  cardValue: { fontSize: 22, fontWeight: 650, fontVariantNumeric: "tabular-nums" },
  sub: { fontSize: 12, color: "var(--muted)", marginLeft: 6, fontWeight: 400 },
  h2: { fontSize: 15, marginTop: 26, marginBottom: 8 },
  empty: { fontSize: 13, color: "var(--muted)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  td: { borderBottom: "1px solid var(--line)", padding: "6px 8px" },
  dateCell: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    whiteSpace: "nowrap",
    color: "var(--muted)",
    fontVariantNumeric: "tabular-nums",
  },
  sourceCell: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    whiteSpace: "nowrap",
    fontSize: 12,
    color: "var(--muted)",
  },
  amount: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  deltaCell: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  // marginLeft はカードの中で金額に密着させないため。表のセルでは右寄せなので効かない。
  deltaUp: {
    fontSize: 12,
    color: "var(--danger)",
    fontVariantNumeric: "tabular-nums",
    marginLeft: 6,
  },
  deltaDown: {
    fontSize: 12,
    color: "var(--income)",
    fontVariantNumeric: "tabular-nums",
    marginLeft: 6,
  },
  deltaFlat: { fontSize: 12, color: "var(--faint)", marginLeft: 6 },
} as const;
