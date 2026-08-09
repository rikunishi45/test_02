import { useState } from "react";
import {
  inCategory,
  inMonth,
  monthOf,
  negateExpense,
  shiftMonth,
  sumByDay,
} from "../aggregate/period.js";
import {
  cellMagnitude,
  heatOf,
  monthGrid,
  totalOfCells,
  weekGrid,
  type CalendarCell,
} from "../calendar/month-grid.js";
import { maxOf } from "../chart/bar-chart.js";
import { addDays, toIsoDate } from "../domain/date-parts.js";
import type { StoredTransaction } from "../storage/schema.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });
const YEN_SHORT = new Intl.NumberFormat("ja-JP", { notation: "compact" });
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 一番濃いセルの塗りの不透明度。
 *
 * `heatOf` が返すのは 0〜1 の比で、そのまま不透明度にすると最大のセルが
 * 塗りつぶしになり、上に載る赤い金額が読めない。**比は事実、ここは見せ方。**
 */
const FILL_MAX_OPACITY = 0.34;

type View = "month" | "week";

/**
 * カレンダー。カテゴリで絞り込める。
 *
 * 絞り込みの状態をこの画面の外に持ち出さない。画面をまたいで効く絞り込みは、
 * どこで何を見ているのか分からなくなる。
 *
 * 判定と集計はすべて壁の中（`inCategory` / `monthGrid` / `weekGrid` /
 * `cellMagnitude` / `heatOf`）。ここは呼んで並べるだけ。
 */
export function CalendarScreen({
  transactions,
  categories,
}: {
  transactions: StoredTransaction[];
  /** 絞り込みに出すカテゴリ。並び順はマスタのもの */
  categories: readonly string[];
}) {
  const today = toIsoDate(new Date());
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(today);
  const [category, setCategory] = useState<string | null>(null);

  const filtered = inCategory(transactions, category);
  const month = monthOf(anchor);

  const cells =
    view === "month"
      ? monthGrid(month, sumByDay(inMonth(filtered, month))).flat()
      : weekGrid(anchor, sumByDay(filtered));

  const peak = maxOf(cells.map(cellMagnitude));
  const totals = totalOfCells(cells);
  // 週の範囲はセルから読む。週の開始日をここで計算し直すと weekGrid と
  // 二重に持つことになり、片方だけずれても画面では気づけない。
  const range = `${cells[0]?.date ?? ""} 〜 ${cells[cells.length - 1]?.date ?? ""}`;

  return (
    <section>
      <div style={styles.bar}>
        <div style={styles.nav}>
          <button type="button" onClick={() => setAnchor(shift(anchor, view, -1))}>
            ‹
          </button>
          <span style={styles.period}>{view === "month" ? month : range}</span>
          <button type="button" onClick={() => setAnchor(shift(anchor, view, 1))}>
            ›
          </button>
          <button type="button" onClick={() => setAnchor(today)}>
            今日
          </button>
        </div>
        <div style={styles.seg}>
          <button
            type="button"
            style={view === "month" ? styles.segOn : styles.segOff}
            onClick={() => setView("month")}
          >
            月
          </button>
          <button
            type="button"
            style={view === "week" ? styles.segOn : styles.segOff}
            onClick={() => setView("week")}
          >
            週
          </button>
        </div>
      </div>

      <div style={styles.chips}>
        <Chip label="すべて" on={category === null} onClick={() => setCategory(null)} />
        {categories.map((name) => (
          <Chip
            key={name}
            label={name}
            on={category === name}
            onClick={() => setCategory(name)}
          />
        ))}
      </div>

      <div style={styles.calendar}>
        {WEEKDAYS.map((label, index) => (
          <div key={label} style={weekdayStyle(index)}>
            {label}
          </div>
        ))}
        {cells.map((cell, index) => (
          <Cell key={cell.date ?? `blank-${index}`} cell={cell} peak={peak} today={today} />
        ))}
      </div>

      <p style={styles.foot}>
        {view === "month" ? "月間合計" : "週の合計"}
        <span style={styles.total}>支出 {YEN.format(negateExpense(totals.expenseYen))}</span>
        <span style={styles.income}>収入 {YEN.format(totals.incomeYen)}</span>
        {category !== null && <span style={styles.filterNote}>絞り込み：{category}</span>}
      </p>
    </section>
  );
}

function Cell({
  cell,
  peak,
  today,
}: {
  cell: CalendarCell;
  peak: number;
  today: string;
}) {
  if (cell.date === null) {
    return <div style={styles.cell} />;
  }
  return (
    <div style={cell.date === today ? styles.cellToday : styles.cell}>
      <span
        style={{ ...styles.cellFill, opacity: heatOf(cell, peak) * FILL_MAX_OPACITY }}
      />
      <span style={styles.cellDay}>{cell.day}</span>
      {cell.expenseYen > 0 && (
        <span style={styles.cellExpense}>-{YEN_SHORT.format(cell.expenseYen)}</span>
      )}
      {cell.incomeYen > 0 && (
        <span style={styles.cellIncome}>+{YEN_SHORT.format(cell.incomeYen)}</span>
      )}
    </div>
  );
}

function Chip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={on} style={on ? styles.chipOn : styles.chip} onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * 月表示なら月を、週表示なら週を1つ動かす。
 *
 * 月を動かすときは月初に寄せる。「同じ日で翌月」にすると 1/31 の翌月が
 * 作れない。日付の演算そのものは壁の中（`shiftMonth` / `addDays`）。
 */
function shift(anchor: string, view: View, direction: number): string {
  if (view === "week") {
    return addDays(anchor, 7 * direction);
  }
  return `${shiftMonth(monthOf(anchor), direction)}-01`;
}

function weekdayStyle(index: number) {
  if (index === 0) {
    return styles.weekdaySunday;
  }
  if (index === 6) {
    return styles.weekdaySaturday;
  }
  return styles.weekday;
}

const styles = {
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  nav: { display: "flex", alignItems: "center", gap: 8 },
  period: { fontSize: 15, fontWeight: 650, fontVariantNumeric: "tabular-nums" },
  seg: { display: "flex", gap: 4 },
  segOn: {
    padding: "4px 14px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    fontWeight: 650,
  },
  segOff: { padding: "4px 14px" },
  chips: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 },
  chip: { borderRadius: 999, padding: "3px 12px", fontSize: 13, color: "var(--muted)" },
  chipOn: {
    borderRadius: 999,
    padding: "3px 12px",
    fontSize: 13,
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    fontWeight: 650,
  },
  calendar: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  weekday: { fontSize: 12, textAlign: "center", opacity: 0.7, paddingBottom: 2 },
  weekdaySunday: {
    fontSize: 12,
    textAlign: "center",
    color: "var(--danger)",
    paddingBottom: 2,
  },
  weekdaySaturday: {
    fontSize: 12,
    textAlign: "center",
    color: "var(--accent)",
    paddingBottom: 2,
  },
  cell: {
    position: "relative",
    minHeight: 58,
    border: "1px solid var(--line)",
    borderRadius: 5,
    padding: "4px 6px",
    overflow: "hidden",
  },
  cellToday: {
    position: "relative",
    minHeight: 58,
    border: "1px solid var(--accent)",
    borderRadius: 5,
    padding: "4px 6px",
    overflow: "hidden",
  },
  cellFill: { position: "absolute", inset: 0, background: "var(--bar)" },
  cellDay: { position: "relative", fontSize: 12, opacity: 0.75 },
  cellExpense: {
    position: "relative",
    display: "block",
    fontSize: 12,
    color: "var(--danger)",
    fontVariantNumeric: "tabular-nums",
    marginTop: 2,
  },
  cellIncome: {
    position: "relative",
    display: "block",
    fontSize: 12,
    color: "var(--income)",
    fontVariantNumeric: "tabular-nums",
  },
  foot: {
    display: "flex",
    gap: 16,
    alignItems: "baseline",
    flexWrap: "wrap",
    marginTop: 14,
    fontSize: 13,
    color: "var(--muted)",
  },
  total: { color: "var(--fg)", fontVariantNumeric: "tabular-nums" },
  income: { color: "var(--income)", fontVariantNumeric: "tabular-nums" },
  filterNote: { marginLeft: "auto", color: "var(--faint)" },
} as const;
