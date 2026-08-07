import { dayOfWeek, daysInMonth } from "../domain/date-parts.js";
import type { PeriodTotal } from "../aggregate/period.js";

export interface CalendarCell {
  /** その日の日付（"YYYY-MM-DD"）。月の前後を埋める空白は `null` */
  date: string | null;
  /** 日付の「日」の部分。空白は `null` */
  day: number | null;
  /** その日の支出（正の数）。取引が無い日と空白は 0 */
  expenseYen: number;
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

  const expenseByDate = new Map<string, number>();
  for (const total of dailyTotals) {
    expenseByDate.set(total.period, total.expenseYen);
  }

  // 空白は毎回新しく作る。1個を使い回すと全セルが同じ参照になり、
  // 呼び出し側が1つ書き換えたときに全部が変わる。
  const blank = (): CalendarCell => ({ date: null, day: null, expenseYen: 0 });
  const cells: CalendarCell[] = [];

  const leading = dayOfWeek(`${month}-01`);
  for (let index = 0; index < leading; index += 1) {
    cells.push(blank());
  }

  const lastDay = daysInMonth(year, monthNumber);
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({ date, day, expenseYen: expenseByDate.get(date) ?? 0 });
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
