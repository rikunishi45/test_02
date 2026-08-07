import type { StoredTransaction } from "../storage/schema.js";
import { UNCATEGORIZED } from "../category/classify.js";

/**
 * 期間ごとの集計。
 *
 * 支出と収入を分けて、**どちらも正の数**で持つ。取引の `amountYen` は支出が負・
 * 収入が正だが（`domain/transaction.ts`）、分けるには符号を見る判定が要り、
 * それは画面ではなくここの仕事になる。一度分けてしまえば大きさで持つ方が自然で、
 * 表示のたびに符号を反転させる場所を増やさずに済む。
 */
export interface PeriodTotal {
  /** "YYYY-MM"（月次）または "YYYY-MM-DD"（日次） */
  period: string;
  expenseYen: number;
  incomeYen: number;
}

export interface CategoryTotal {
  category: string;
  expenseYen: number;
}

/** "YYYY-MM-DD" → "YYYY-MM" */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * 期間キーごとに支出と収入を合計する。返る順序は期間の昇順。
 *
 * 日付は "YYYY-MM-DD" 固定なので、文字列の辞書順が日付順と一致する
 * （`domain/transaction.ts`）。日付として解釈し直す必要はない。
 *
 * 金額 0 の取引は支出にも収入にも数えない。`-0` も同様（`-0 < 0` は偽）。
 * 合計に `-0` を混ぜないためで、混ざると `Intl.NumberFormat` が `-￥0` と表示する。
 */
function sumByPeriod(
  transactions: readonly StoredTransaction[],
  keyOf: (transaction: StoredTransaction) => string,
): PeriodTotal[] {
  const totals = new Map<string, PeriodTotal>();

  for (const transaction of transactions) {
    const period = keyOf(transaction);
    let total = totals.get(period);
    if (total === undefined) {
      total = { period, expenseYen: 0, incomeYen: 0 };
      totals.set(period, total);
    }
    if (transaction.amountYen < 0) {
      total.expenseYen -= transaction.amountYen;
    } else if (transaction.amountYen > 0) {
      total.incomeYen += transaction.amountYen;
    }
  }

  return [...totals.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function sumByMonth(transactions: readonly StoredTransaction[]): PeriodTotal[] {
  return sumByPeriod(transactions, (transaction) => monthOf(transaction.date));
}

export function sumByDay(transactions: readonly StoredTransaction[]): PeriodTotal[] {
  return sumByPeriod(transactions, (transaction) => transaction.date);
}

/**
 * カテゴリごとの支出を合計する。支出の多い順。同額ならカテゴリ名の昇順。
 *
 * 並び順を額だけで決めると、同額のカテゴリの順序が入力順に依存して、
 * 取引を1件足しただけで凡例の並びが入れ替わる。名前で決着させる。
 *
 * 収入は含めない。カテゴリは支出の内訳を見るためのもので、給与や振替を
 * 同じ円グラフに混ぜると割合の意味が壊れる。
 */
export function sumByCategory(transactions: readonly StoredTransaction[]): CategoryTotal[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.amountYen >= 0) {
      continue;
    }
    const category = transaction.category === "" ? UNCATEGORIZED : transaction.category;
    totals.set(category, (totals.get(category) ?? 0) - transaction.amountYen);
  }

  return [...totals.entries()]
    .map(([category, expenseYen]) => ({ category, expenseYen }))
    .sort((a, b) => b.expenseYen - a.expenseYen || a.category.localeCompare(b.category));
}

/**
 * 支出の大きさを、元帳の符号（支出は負）に戻す。**0 は `+0` のまま返す。**
 *
 * 集計は支出を正の数で持つが、画面では `-￥42,202` と符号付きで出したい。
 * そこで単純に `-expenseYen` と書くと、支出が0の月（収入だけの月は普通にある）で
 * `-0` になり、`Intl.NumberFormat` が `-￥0` と表示する。
 *
 * 反転そのものは1行だが、**このプロジェクトで `-0` を4回踏んでいる**ので、
 * 判定を画面側に置かず壁の中に固定する。
 */
export function negateExpense(expenseYen: number): number {
  return expenseYen === 0 ? 0 : -expenseYen;
}

/** 指定した月（"YYYY-MM"）の取引だけを取り出す */
export function inMonth(
  transactions: readonly StoredTransaction[],
  month: string,
): StoredTransaction[] {
  return transactions.filter((transaction) => monthOf(transaction.date) === month);
}
