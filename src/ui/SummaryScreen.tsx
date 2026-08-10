import { useState } from "react";
import {
  inMonth,
  inRange,
  monthOf,
  negateExpense,
  shiftMonth,
  shiftYear,
  sumAll,
  sumByCategory,
  sumByMonth,
  sumByYear,
  yearOf,
  type PeriodTotal,
} from "../aggregate/period.js";
import { compareByCategory, type CategoryComparison } from "../aggregate/compare.js";
import { colorOf } from "../category/color.js";
import { layoutBars, maxOf, niceScale, yOf } from "../chart/bar-chart.js";
import { clampNumber } from "../clamp-number.js";
import { toIsoDate } from "../domain/date-parts.js";
import {
  detectRecurring,
  MIN_MONTHS,
  totalMonthlyYen,
  type RecurringCharge,
} from "../recurring/detect.js";
import type { CategoryRecord, StoredTransaction } from "../storage/schema.js";
import { CategoryDot } from "./CategoryDot.js";

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

type Mode = "month" | "year" | "range";

const MODES: readonly (readonly [Mode, string])[] = [
  ["month", "月"],
  ["year", "年"],
  ["range", "期間"],
];

export function SummaryScreen({
  transactions,
  categories: master,
}: {
  transactions: StoredTransaction[];
  categories: readonly CategoryRecord[];
}) {
  const months = sumByMonth(transactions);
  const years = sumByYear(transactions);
  const [mode, setMode] = useState<Mode>("month");
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  if (months.length === 0) {
    return <p>取引がありません。CSV取り込みから始めてください。</p>;
  }

  // 既定は最新。sumByMonth / sumByYear はどちらも昇順なので末尾。
  const periods = mode === "year" ? years : months;
  const latest = periods[periods.length - 1]!.period;
  const period = selected !== null && periods.some((p) => p.period === selected) ? selected : latest;

  // 期間指定の既定は「その年のはじめから今日まで」ではなく、データの全期間。
  // 空のまま眺めて「0件」と出るより、まず全部見えている方が迷わない。
  const rangeFrom = from === "" ? months[0]!.period + "-01" : from;
  const rangeTo = to === "" ? latestDate(transactions) : to;

  // 絞り込みと集計は壁の中。ここは呼んで並べるだけ。
  const current =
    mode === "month"
      ? inMonth(transactions, period)
      : mode === "year"
        ? transactions.filter((t) => yearOf(t.date) === period)
        : inRange(transactions, rangeFrom, rangeTo);

  // 期間指定には「前の期間」を決める自然な単位が無いので比較しない。
  // 同じ長さの直前を勝手に前期とすると、月末をまたぐ範囲で意味が変わる。
  const previous =
    mode === "month"
      ? inMonth(transactions, shiftMonth(period, -1))
      : mode === "year"
        ? transactions.filter((t) => yearOf(t.date) === shiftYear(period, -1))
        : null;

  const categories = sumByCategory(current);
  const comparison = previous === null ? null : compareByCategory(current, previous);
  // 3モードとも `current` から出す。期間指定だけ別経路で合計すると、そちらに
  // 収入が乗らない（実際に収入が出ないまま残っていた）。合計は壁の中の `sumAll`。
  const total = sumAll(current);

  return (
    <section>
      <div style={styles.modes}>
        {MODES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            style={mode === value ? styles.modeOn : styles.modeOff}
            onClick={() => {
              setMode(value);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
        {mode === "range" && (
          <>
            <input
              type="date"
              aria-label="開始日"
              value={rangeFrom}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span style={styles.tilde}>〜</span>
            <input
              type="date"
              aria-label="終了日"
              value={rangeTo}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        )}
      </div>

      {mode !== "range" && (
        <>
          <h2 style={styles.h2}>{mode === "year" ? "年ごとの支出" : "月ごとの支出"}</h2>
          <MonthlyBars months={periods} selected={period} onSelect={setSelected} mode={mode} />
        </>
      )}

      <h2 style={styles.h2}>
        {mode === "range" ? `${rangeFrom} 〜 ${rangeTo}` : period} の内訳
        <span style={styles.total}>{YEN.format(negateExpense(total.expenseYen))}</span>
      </h2>
      {total.incomeYen > 0 && <p style={styles.income}>収入 {YEN.format(total.incomeYen)}</p>}

      {/*
        比較があるときは、今期の支出が0でも表を出す。前期にしか無い行こそ
        「減った」を伝えるもので、そこで空状態に差し替えると、いちばん減った
        月だけ何も出ない（Codex 指摘）。出すものが無いのは comparison が
        空のときだけ。
      */}
      {comparison !== null ? (
        comparison.length === 0 ? (
          <p>この期間の支出はありません。</p>
        ) : (
          <ComparisonTable
            rows={comparison}
            label={mode === "year" ? "前年比" : "先月比"}
            master={master}
          />
        )
      ) : categories.length === 0 ? (
        <p>この期間の支出はありません。</p>
      ) : (
        <table style={styles.table}>
          <tbody>
            {categories.map((c) => (
              <tr key={c.category}>
                <td style={styles.td}>
                  <CategoryDot color={colorOf(master, c.category)} />
                  {c.category}
                </td>
                <td style={styles.amountCell}>{YEN.format(negateExpense(c.expenseYen))}</td>
                <td style={{ ...styles.td, width: "50%" }}>
                  <Share
                    value={c.expenseYen}
                    of={categories[0]!.expenseYen}
                    color={colorOf(master, c.category)}
                  />
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

/** データの中でいちばん新しい日付。期間指定の既定の終わり */
function latestDate(transactions: readonly StoredTransaction[]): string {
  return transactions.reduce((latest, t) => (t.date > latest ? t.date : latest), transactions[0]!.date);
}

/**
 * カテゴリ別の内訳と、前の期間との差。
 *
 * 差は**金額で出して率は出さない。** 前期が0円のカテゴリで率が無限大になり、
 * 「新しく使い始めた」ことを伝えるのに率は向かない。
 */
function ComparisonTable({
  rows,
  label,
  master,
}: {
  rows: readonly CategoryComparison[];
  label: string;
  master: readonly CategoryRecord[];
}) {
  const peak = rows[0]?.expenseYen ?? 0;

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th} />
          <th style={{ ...styles.th, textAlign: "right" }}>支出</th>
          <th style={{ ...styles.th, textAlign: "right" }}>{label}</th>
          <th style={styles.th} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.category}>
            <td style={styles.td}>
              <CategoryDot color={colorOf(master, row.category)} />
              {row.category}
            </td>
            <td style={styles.amountCell}>{YEN.format(negateExpense(row.expenseYen))}</td>
            <td style={{ ...styles.amountCell, ...deltaStyle(row.deltaYen) }}>
              {formatDelta(row.deltaYen)}
            </td>
            <td style={{ ...styles.td, width: "40%" }}>
              {peak > 0 && (
                <Share value={row.expenseYen} of={peak} color={colorOf(master, row.category)} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 増えたら赤、減ったら緑、同じならグレー。支出なので「増えた」が悪い側 */
function deltaStyle(deltaYen: number) {
  if (deltaYen > 0) {
    return { color: "var(--danger)" };
  }
  if (deltaYen < 0) {
    return { color: "var(--income)" };
  }
  return { color: "var(--faint)" };
}

function formatDelta(deltaYen: number): string {
  if (deltaYen === 0) {
    return "±0";
  }
  // 支出は増えたときに符号を + で出す。金額そのものは絶対値で読ませる。
  return `${deltaYen > 0 ? "+" : "−"}${YEN.format(Math.abs(deltaYen))}`;
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

function Share({ value, of, color }: { value: number; of: number; color: string }) {
  // 幅の比だけ。0除算は of > 0 が保証される（先頭要素は最大かつ支出のみ）。
  return (
    <span style={styles.shareTrack}>
      <span style={{ ...styles.shareFill, width: `${(value / of) * 100}%`, background: color }} />
    </span>
  );
}

/** ホバーで出す吹き出しの大きさ。中の文字はこの幅に収まる想定 */
const POP_WIDTH = 132;
const POP_HEIGHT = 42;
const POP_GAP = 8;

function MonthlyBars({
  months,
  selected,
  onSelect,
  mode,
}: {
  months: PeriodTotal[];
  selected: string;
  onSelect: (month: string) => void;
  mode: "month" | "year";
}) {
  const [hovered, setHovered] = useState<number | null>(null);
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
      aria-label={mode === "year" ? "年ごとの支出" : "月ごとの支出"}
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
            <g
              key={period}
              onClick={() => onSelect(period)}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
              style={styles.barGroup}
            >
              {/*
                当たり判定は棒ではなく列全体にする。棒が低い月（支出が少ない月）
                ほどホバーしにくい、という状態を作らないため。
              */}
              <rect
                x={AXIS_WIDTH + bar.x}
                y={0}
                width={bar.width}
                height={CHART_HEIGHT}
                fill="transparent"
              />
              <rect
                x={AXIS_WIDTH + bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={period === selected ? "var(--accent)" : "var(--bar)"}
                opacity={hovered === index && period !== selected ? 0.8 : 1}
              />
              <text
                x={AXIS_WIDTH + bar.x + bar.width / 2}
                y={CHART_HEIGHT + 15}
                textAnchor="middle"
                style={period === selected ? styles.monthLabelActive : styles.monthLabel}
              >
                {mode === "year" ? period : period.slice(5)}
              </text>
            </g>
          );
        })}

        {hovered !== null && bars[hovered] !== undefined && (
          <HoverPop total={months[hovered]!} bar={bars[hovered]!} />
        )}
      </g>
    </svg>
  );
}

/**
 * 棒の上に出す吹き出し。
 *
 * **左右は図の中に収める**（`clampNumber`）。端の棒で中央に置くと軸の外へ
 * はみ出して、数字が切れる。上にも収める——いちばん高い棒では棒の上に
 * 余白が無いので、その場合は棒の中に重ねる。
 *
 * `pointerEvents: none` にしないと、吹き出し自体がホバーを奪って
 * 出たり消えたりを繰り返す。
 */
function HoverPop({
  total,
  bar,
}: {
  total: PeriodTotal;
  bar: { x: number; y: number; width: number; height: number };
}) {
  const center = AXIS_WIDTH + bar.x + bar.width / 2;
  const x = clampNumber(
    center - POP_WIDTH / 2,
    AXIS_WIDTH,
    AXIS_WIDTH + CHART_WIDTH - POP_WIDTH,
  );
  const y = clampNumber(bar.y - POP_HEIGHT - POP_GAP, 0, CHART_HEIGHT - POP_HEIGHT);

  return (
    <g style={styles.pop}>
      <rect x={x} y={y} width={POP_WIDTH} height={POP_HEIGHT} rx={6} style={styles.popBox} />
      <text x={x + 10} y={y + 17} style={styles.popPeriod}>
        {total.period}
      </text>
      <text x={x + 10} y={y + 33} style={styles.popExpense}>
        {YEN.format(negateExpense(total.expenseYen))}
      </text>
      {total.incomeYen > 0 && (
        <text x={x + POP_WIDTH - 10} y={y + 33} textAnchor="end" style={styles.popIncome}>
          +{YEN_SHORT.format(total.incomeYen)}
        </text>
      )}
    </g>
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
  // 吹き出しがホバーを奪うと、出た瞬間にマウスが外れて点滅する
  pop: { pointerEvents: "none" },
  popBox: { fill: "var(--surface-2)", stroke: "var(--line)" },
  popPeriod: { fontSize: 11, fill: "currentColor", opacity: 0.7 },
  popExpense: { fontSize: 13, fill: "var(--danger)", fontVariantNumeric: "tabular-nums" },
  popIncome: { fontSize: 11, fill: "var(--income)", fontVariantNumeric: "tabular-nums" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  td: { borderBottom: "1px solid var(--line)", padding: "6px 8px" },
  th: {
    textAlign: "left",
    borderBottom: "2px solid var(--line)",
    padding: "6px 8px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--muted)",
  },
  amountCell: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  modes: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 },
  modeOn: {
    padding: "4px 14px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    fontWeight: 650,
  },
  modeOff: { padding: "4px 14px", color: "var(--muted)" },
  tilde: { color: "var(--muted)" },
  shareTrack: { display: "block", background: "var(--line)", borderRadius: 3, height: 8 },
  shareFill: { display: "block", background: "var(--bar)", borderRadius: 3, height: 8 },
} as const;
