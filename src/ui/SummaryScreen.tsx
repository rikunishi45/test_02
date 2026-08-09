import { useState } from "react";
import {
  inMonth,
  monthOf,
  negateExpense,
  sumByCategory,
  sumByDay,
  sumByMonth,
  type PeriodTotal,
} from "../aggregate/period.js";
import { monthGrid, type CalendarCell } from "../calendar/month-grid.js";
import { layoutBars, maxOf, niceScale, yOf } from "../chart/bar-chart.js";
import { toIsoDate } from "../domain/date-parts.js";
import {
  detectRecurring,
  MIN_MONTHS,
  totalMonthlyYen,
  type RecurringCharge,
} from "../recurring/detect.js";
import type { StoredTransaction } from "../storage/schema.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });
const YEN_SHORT = new Intl.NumberFormat("ja-JP", { notation: "compact" });

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const BAR_GAP = 10;
const AXIS_WIDTH = 56;
const LABEL_HEIGHT = 22;
// 目盛りラベルは中心が線に乗るので、上端の分だけ余白を取らないと切れる。
const TOP_PAD = 10;
const TICK_DIVISIONS = 5;

export function SummaryScreen({ transactions }: { transactions: StoredTransaction[] }) {
  const months = sumByMonth(transactions);
  const [selected, setSelected] = useState<string | null>(null);

  if (months.length === 0) {
    return <p>取引がありません。CSV取り込みから始めてください。</p>;
  }

  // 既定は最新月。months は昇順なので末尾。
  const month = selected ?? months[months.length - 1]!.period;
  const ofMonth = inMonth(transactions, month);
  const categories = sumByCategory(ofMonth);
  const total = months.find((m) => m.period === month);
  const weeks = monthGrid(month, sumByDay(ofMonth));

  return (
    <section>
      <h2 style={styles.h2}>月ごとの支出</h2>
      <MonthlyBars months={months} selected={month} onSelect={setSelected} />

      <h2 style={styles.h2}>
        {month} の内訳
        {total !== undefined && <span style={styles.total}>{YEN.format(negateExpense(total.expenseYen))}</span>}
      </h2>
      {total !== undefined && total.incomeYen > 0 && (
        <p style={styles.income}>収入 {YEN.format(total.incomeYen)}</p>
      )}

      <MonthCalendar weeks={weeks} />

      {categories.length === 0 ? (
        <p>この月の支出はありません。</p>
      ) : (
        <table style={styles.table}>
          <tbody>
            {categories.map((c) => (
              <tr key={c.category}>
                <td style={styles.td}>{c.category}</td>
                <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {YEN.format(negateExpense(c.expenseYen))}
                </td>
                <td style={{ ...styles.td, width: "50%" }}>
                  <Share value={c.expenseYen} of={categories[0]!.expenseYen} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RecurringPanel transactions={transactions} />
    </section>
  );
}

/**
 * 固定費・サブスクの一覧。
 *
 * 表示している月ではなく**今月**を基準にする。解約済みを落とす判定
 * （`detectRecurring` の `throughMonth`）が「今も落ちているか」を見るもので、
 * 過去の月を眺めているときに一覧が入れ替わると意味が変わってしまう。
 */
function RecurringPanel({ transactions }: { transactions: StoredTransaction[] }) {
  const charges = detectRecurring(transactions, monthOf(toIsoDate(new Date())));

  return (
    <>
      <h2 style={styles.h2}>
        固定費・サブスク
        {charges.length > 0 && (
          <span style={styles.total}>{YEN.format(negateExpense(totalMonthlyYen(charges)))}/月</span>
        )}
      </h2>
      {charges.length === 0 ? (
        <p style={styles.income}>
          {MIN_MONTHS}か月以上つづけて、ほぼ同額で落ちている支出はまだありません。
        </p>
      ) : (
        <table style={styles.table}>
          <tbody>
            {charges.map((charge) => (
              <RecurringRow key={charge.description} charge={charge} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function RecurringRow({ charge }: { charge: RecurringCharge }) {
  return (
    <tr>
      <td style={styles.td}>{charge.description}</td>
      <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {YEN.format(negateExpense(charge.typicalYen))}
      </td>
      <td style={{ ...styles.td, fontSize: 13, opacity: 0.8 }}>
        次回 {charge.nextDate}（{charge.monthCount}か月連続）
      </td>
    </tr>
  );
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function MonthCalendar({ weeks }: { weeks: CalendarCell[][] }) {
  // 濃さの基準はその月の最大。月をまたいで比べるものではないので月内で正規化する。
  const peak = maxOf(weeks.flat().map((cell) => cell.expenseYen));

  return (
    <div style={styles.calendar}>
      {WEEKDAYS.map((label, index) => (
        <div
          key={label}
          style={index === 0 ? styles.weekdaySunday : index === 6 ? styles.weekdaySaturday : styles.weekday}
        >
          {label}
        </div>
      ))}
      {weeks.flat().map((cell, index) => (
        <div key={cell.date ?? `blank-${index}`} style={styles.cell}>
          {cell.date !== null && (
            <>
              <span
                style={{
                  ...styles.cellFill,
                  // peak は 0 になり得る（支出ゼロの月）。0除算を避ける。
                  opacity: peak > 0 ? cell.expenseYen / peak : 0,
                }}
              />
              <span style={styles.cellDay}>{cell.day}</span>
              {cell.expenseYen > 0 && (
                <span style={styles.cellAmount}>{YEN_SHORT.format(cell.expenseYen)}</span>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function Share({ value, of }: { value: number; of: number }) {
  // 幅の比だけ。0除算は of > 0 が保証される（先頭要素は最大かつ支出のみ）。
  return (
    <span style={styles.shareTrack}>
      <span style={{ ...styles.shareFill, width: `${(value / of) * 100}%` }} />
    </span>
  );
}

function MonthlyBars({
  months,
  selected,
  onSelect,
}: {
  months: PeriodTotal[];
  selected: string;
  onSelect: (month: string) => void;
}) {
  const values = months.map((m) => m.expenseYen);
  const { max, ticks } = niceScale(maxOf(values), TICK_DIVISIONS);
  const bars = layoutBars(values, {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    gap: BAR_GAP,
    max,
  });

  return (
    <svg
      viewBox={`0 0 ${AXIS_WIDTH + CHART_WIDTH} ${TOP_PAD + CHART_HEIGHT + LABEL_HEIGHT}`}
      style={styles.svg}
      role="img"
      aria-label="月ごとの支出"
    >
      <g transform={`translate(0 ${TOP_PAD})`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={AXIS_WIDTH}
              x2={AXIS_WIDTH + CHART_WIDTH}
              y1={yOf(tick, max, CHART_HEIGHT)}
              y2={yOf(tick, max, CHART_HEIGHT)}
              stroke="var(--line)"
            />
            <text
              x={AXIS_WIDTH - 6}
              y={yOf(tick, max, CHART_HEIGHT) + 4}
              textAnchor="end"
              style={styles.tickLabel}
            >
              {YEN_SHORT.format(tick)}
            </text>
          </g>
        ))}

        {bars.map((bar, index) => {
          const period = months[index]!.period;
          return (
            <g key={period} onClick={() => onSelect(period)} style={styles.barGroup}>
              <rect
                x={AXIS_WIDTH + bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={period === selected ? "var(--accent)" : "var(--bar)"}
              />
              <text
                x={AXIS_WIDTH + bar.x + bar.width / 2}
                y={CHART_HEIGHT + 15}
                textAnchor="middle"
                style={period === selected ? styles.monthLabelActive : styles.monthLabel}
              >
                {period.slice(5)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const styles = {
  h2: { fontSize: 16, marginTop: 24, display: "flex", alignItems: "baseline", gap: 12 },
  total: { fontSize: 20, fontVariantNumeric: "tabular-nums" },
  income: { fontSize: 13, opacity: 0.8, margin: "4px 0 0" },
  svg: { width: "100%", height: "auto", maxHeight: 260 },
  tickLabel: { fontSize: 11, fill: "currentColor", opacity: 0.6 },
  monthLabel: { fontSize: 11, fill: "currentColor", opacity: 0.7 },
  monthLabelActive: { fontSize: 11, fill: "currentColor", fontWeight: 700 },
  barGroup: { cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  td: { borderBottom: "1px solid var(--line)", padding: "6px 8px" },
  calendar: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
    marginTop: 12,
  },
  weekday: { fontSize: 12, textAlign: "center", opacity: 0.7, paddingBottom: 2 },
  weekdaySunday: { fontSize: 12, textAlign: "center", color: "var(--danger)", paddingBottom: 2 },
  weekdaySaturday: { fontSize: 12, textAlign: "center", color: "var(--accent)", paddingBottom: 2 },
  cell: {
    position: "relative",
    minHeight: 52,
    border: "1px solid var(--line)",
    borderRadius: 4,
    padding: "4px 6px",
    overflow: "hidden",
  },
  cellFill: {
    position: "absolute",
    inset: 0,
    background: "var(--bar)",
  },
  cellDay: { position: "relative", fontSize: 12, opacity: 0.75 },
  cellAmount: {
    position: "relative",
    display: "block",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    marginTop: 2,
  },
  shareTrack: { display: "block", background: "var(--line)", borderRadius: 3, height: 8 },
  shareFill: { display: "block", background: "var(--bar)", borderRadius: 3, height: 8 },
} as const;
