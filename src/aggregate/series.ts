import {
  inCategory,
  sumByMonth,
  sumByYear,
  valuesFor,
  type PeriodTotal,
} from "./period.js";
import type { StoredTransaction } from "../storage/schema.js";

/**
 * レポートのグラフに出す系列。
 *
 * **選択欄の値（文字列）から系列を決める判定をここに置く。** 画面（`src/ui/`）は
 * カバレッジもミューテーションテストも掛からないので、そこに置くと
 * 「支出のつもりで収入を出していた」類の取り違えが壁を通らずにマージされる。
 * グラフは目で見て気づけそうに思えるが、気づけるのは棒の高さが**明らかに**
 * おかしいときだけで、カテゴリの取り違えは金額として自然に見える。
 */

/** 支出の合計 */
export const EXPENSE_SERIES = "expense";
/** 収入の合計 */
export const INCOME_SERIES = "income";

/**
 * カテゴリの系列を表す値。**印を付ける。**
 * 付けないと、`収入` という名前のカテゴリを作ったときに合計の収入と区別できない。
 */
const CATEGORY_PREFIX = "category:";

export function categorySeries(name: string): string {
  return `${CATEGORY_PREFIX}${name}`;
}

/** 選択欄の値が指すカテゴリ名。合計（支出・収入）なら `null` */
function categoryOf(series: string): string | null {
  return series.startsWith(CATEGORY_PREFIX) ? series.slice(CATEGORY_PREFIX.length) : null;
}

/** 期間の単位。グラフの横軸をどちらで刻むか */
export type PeriodUnit = "month" | "year";

export interface Series {
  /** 期間の並びに合わせた棒の値。取引の無い期間は 0（`valuesFor`） */
  values: number[];
  /** 見出しと読み上げに使う名前 */
  label: string;
  /** 収入の系列。金額を正のまま緑で出すかどうかの判断に使う */
  income: boolean;
}

/**
 * 選択された系列を、グラフがそのまま描ける形に組み立てる。
 *
 * `periods` には**絞り込む前の全期間**の集計を渡す。系列を切り替えても横軸が
 * 動かないようにするためで、カテゴリで絞った集計をそのまま並べると、取引の
 * 無い期間が詰められて棒とラベルがずれる（`valuesFor`）。
 *
 * 知らない値は支出の合計として扱う。選択欄の選択肢はここが決める値
 * （`EXPENSE_SERIES` / `INCOME_SERIES` / `categorySeries`）だけなので、
 * 他の値は状態が壊れたときにしか来ない——そこで例外を投げても画面には
 * 「グラフが出ない」としか現れず、既定に倒す方が回復できる。
 *
 * マスタから消えたカテゴリも同じで、絞り込みが空になり全期間 0 の系列になる。
 */
export function buildSeries(
  transactions: readonly StoredTransaction[],
  periods: readonly PeriodTotal[],
  series: string,
  unit: PeriodUnit,
): Series {
  const keys = periods.map((total) => total.period);
  const category = categoryOf(series);

  if (category !== null) {
    const filtered = inCategory(transactions, category);
    const totals = unit === "year" ? sumByYear(filtered) : sumByMonth(filtered);
    return { values: valuesFor(keys, totals, "expenseYen"), label: category, income: false };
  }

  if (series === INCOME_SERIES) {
    return { values: valuesFor(keys, periods, "incomeYen"), label: "収入", income: true };
  }

  return { values: valuesFor(keys, periods, "expenseYen"), label: "支出", income: false };
}
