import { addDays, dayOfWeek, daysInMonth } from "../domain/date-parts.js";
import type { PeriodTotal } from "../aggregate/period.js";

export interface CalendarCell {
  /** その日の日付（"YYYY-MM-DD"）。月の前後を埋める空白は `null` */
  date: string | null;
  /** 日付の「日」の部分。空白は `null` */
  day: number | null;
  /** その日の支出（正の数）。取引が無い日と空白は 0 */
  expenseYen: number;
  /** その日の収入（正の数）。取引が無い日と空白は 0 */
  incomeYen: number;
}

/**
 * セルの濃さの基準になる額。**支出があればその大きさ、無ければ収入の大きさ。**
 *
 * カレンダーはカテゴリで絞り込める。絞り込むと片側しか残らない——支出の
 * カテゴリを選べば収入は常に 0、「収入」を選べば支出が常に 0 になる。
 * だから「両方あるときは支出を採る」の1行で3つの場合すべてに答えが出る。
 *
 * 画面側で `絞り込みが収入かどうか` を見て分けると、**壁の外に判定が出る。**
 */
export function cellMagnitude(cell: CalendarCell): number {
  return cell.expenseYen > 0 ? cell.expenseYen : cell.incomeYen;
}

/**
 * 並んでいるセルの合計。支出・収入とも**正の数**で返す。
 *
 * `sumByMonth` で別に集計せず、**画面に出ているセルそのものから足す。**
 * 別経路で出すと、絞り込みや表示範囲の食い違いで「並んでいる数字の合計」と
 * 「合計欄の数字」がずれる。ずれても画面を見て気づけない類の誤り。
 *
 * 月表示の空白セルは 0 なので、そのまま混ざっても合計は変わらない。
 */
export function totalOfCells(cells: readonly CalendarCell[]): {
  expenseYen: number;
  incomeYen: number;
} {
  let expenseYen = 0;
  let incomeYen = 0;
  for (const cell of cells) {
    expenseYen += cell.expenseYen;
    incomeYen += cell.incomeYen;
  }
  return { expenseYen, incomeYen };
}

/**
 * セルの濃さを 0〜1 で返す。`peak` はその月（週）の `cellMagnitude` の最大値。
 *
 * **`peak` が 0 のとき 0 を返す。** 取引が1件も無い月は最大値が 0 になり、
 * 割るとすべてのセルが `NaN` になって濃さが指定されない（画面では色が消える）。
 *
 * 濃さを月内で正規化するのは、月をまたいで比べるものではないため。
 * **絞り込むと最大値が変わる**ので、絞り込み後の値で取り直す必要がある。
 */
export function heatOf(cell: CalendarCell, peak: number): number {
  if (peak <= 0) {
    return 0;
  }
  return cellMagnitude(cell) / peak;
}

/**
 * 1か月分のカレンダーを週の配列にして返す。**日曜始まり。**
 *
 * 返る週は必ず7セット。月初の前と月末の後は `date: null` の空白で埋める。
 * 埋めないと曜日の列がずれ、画面側で位置合わせの計算が要る——それは
 * 「画面を見ても気づきにくい誤り」なのでここでやる。
 *
 * `month` は `"YYYY-MM"`。`sumByMonth` / `monthOf` が返す形をそのまま渡す前提で、
 * 妥当性は検証しない（システム境界ではないため）。
 */
export function monthGrid(month: string, dailyTotals: readonly PeriodTotal[]): CalendarCell[][] {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const byDate = indexByDate(dailyTotals);

  // 空白は毎回新しく作る。1個を使い回すと全セルが同じ参照になり、
  // 呼び出し側が1つ書き換えたときに全部が変わる。
  const cells: CalendarCell[] = [];

  const leading = dayOfWeek(`${month}-01`);
  for (let index = 0; index < leading; index += 1) {
    cells.push(blank());
  }

  const lastDay = daysInMonth(year, monthNumber);
  for (let day = 1; day <= lastDay; day += 1) {
    cells.push(cellFor(`${month}-${String(day).padStart(2, "0")}`, byDate));
  }

  while (cells.length % 7 !== 0) {
    cells.push(blank());
  }

  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

/**
 * `date` を含む1週間（日曜〜土曜）を返す。**必ず7セットで、空白は入らない。**
 *
 * 月表示と違って月をまたぐ（7月の最終週の後半は8月）。だから
 * 「月内の日付を組み立てる」形では書けず、日数の加減算に落とす。
 */
export function weekGrid(date: string, dailyTotals: readonly PeriodTotal[]): CalendarCell[] {
  const byDate = indexByDate(dailyTotals);
  const sunday = addDays(date, -dayOfWeek(date));
  return Array.from({ length: 7 }, (_unused, offset) =>
    cellFor(addDays(sunday, offset), byDate),
  );
}

function indexByDate(dailyTotals: readonly PeriodTotal[]): Map<string, PeriodTotal> {
  const byDate = new Map<string, PeriodTotal>();
  for (const total of dailyTotals) {
    byDate.set(total.period, total);
  }
  return byDate;
}

function cellFor(date: string, byDate: Map<string, PeriodTotal>): CalendarCell {
  const total = byDate.get(date);
  return {
    date,
    day: Number(date.slice(8, 10)),
    expenseYen: total?.expenseYen ?? 0,
    incomeYen: total?.incomeYen ?? 0,
  };
}

function blank(): CalendarCell {
  return { date: null, day: null, expenseYen: 0, incomeYen: 0 };
}
