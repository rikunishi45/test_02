import { inMonth, sumByCategory } from "../aggregate/period.js";
import { INCOME } from "../category/classify.js";
import type { BudgetRecord, StoredTransaction } from "../storage/schema.js";

export interface BudgetRow {
  category: string;
  /** 予算額（正の数）。**予算が無い行は 0** */
  budgetYen: number;
  /** その月の支出（正の数） */
  spentYen: number;
  /** 残り。予算を超えていれば負。予算が無い行は 0 − 支出 で負になる */
  remainingYen: number;
  /**
   * 使った割合。0〜1 を超えることがある（超過は 1 より大きい）。
   *
   * **予算が無い行は 0 を返す。** 割ると `Infinity` になり、画面では帯が
   * 描けず「率」の欄も読めない（`heatOf` と同じ扱い）。
   */
  ratio: number;
  /** 予算が設定されているか。`budgetYen === 0` との区別に使う */
  budgeted: boolean;
}

export interface BudgetSummary {
  budgetYen: number;
  spentYen: number;
  remainingYen: number;
  ratio: number;
}

/**
 * その月の予算と支出を突き合わせる。
 *
 * **予算のある行と、支出のある行の和集合を返す。** 予算だけの行（まだ使って
 * いない）と、支出だけの行（予算を決めていないカテゴリ）はどちらも見たい。
 * 前者を落とすと「使っていない」が見えず、後者を落とすと**予算の外側で
 * 出ていく分**が見えなくなる——後者のほうが危ない。
 *
 * 収入は含めない。予算は支出に対して立てるもので、`sumByCategory` も収入を
 * 集計に入れない。予算側に収入のレコードが混ざっていても落とす。
 *
 * 並びは予算の多い順、同額なら支出の多い順、それも同じならカテゴリ名の昇順。
 * **支出順にしないのは、予算を立てた行を上にまとめて見たいため。**
 */
export function budgetProgress(
  budgets: readonly BudgetRecord[],
  transactions: readonly StoredTransaction[],
  month: string,
): BudgetRow[] {
  const budgetByCategory = new Map<string, number>();
  for (const record of budgets) {
    if (record.month === month && record.category !== INCOME) {
      budgetByCategory.set(record.category, record.amountYen);
    }
  }

  const spentByCategory = new Map(
    sumByCategory(inMonth(transactions, month)).map((total) => [
      total.category,
      total.expenseYen,
    ]),
  );

  const categories = new Set([...budgetByCategory.keys(), ...spentByCategory.keys()]);

  return [...categories]
    .map((category) => {
      const budgeted = budgetByCategory.has(category);
      const budgetYen = budgetByCategory.get(category) ?? 0;
      const spentYen = spentByCategory.get(category) ?? 0;
      return {
        category,
        budgetYen,
        spentYen,
        remainingYen: budgetYen - spentYen,
        ratio: ratioOf(spentYen, budgetYen),
        budgeted,
      };
    })
    .sort(
      (a, b) =>
        b.budgetYen - a.budgetYen ||
        b.spentYen - a.spentYen ||
        a.category.localeCompare(b.category),
    );
}

/**
 * 全体の予算・支出・残り。
 *
 * **総額は行の合計から出す**（`schema.ts` の「総額は持たない」に従う）。別に
 * 持つと内訳と総額が食い違った状態を作れてしまう。
 *
 * 支出は**予算のある行だけ**を数える。予算を立てていないカテゴリの支出まで
 * 分母のない側に足すと、「予算に対してどこまで使ったか」の率が壊れる。
 * 予算外の支出は行として見えるので、そちらで拾う。
 */
export function budgetSummary(rows: readonly BudgetRow[]): BudgetSummary {
  let budgetYen = 0;
  let spentYen = 0;
  for (const row of rows) {
    if (row.budgeted) {
      budgetYen += row.budgetYen;
      spentYen += row.spentYen;
    }
  }
  return {
    budgetYen,
    spentYen,
    remainingYen: budgetYen - spentYen,
    ratio: ratioOf(spentYen, budgetYen),
  };
}

/** 予算の外で出ていった額。予算を立てていないカテゴリの支出の合計 */
export function unbudgetedYen(rows: readonly BudgetRow[]): number {
  return rows.reduce((sum, row) => (row.budgeted ? sum : sum + row.spentYen), 0);
}

/**
 * 使った割合。**分母が 0 以下なら 0**。
 *
 * 予算 0 で支出があるときに `Infinity` を返すと、画面の帯が描けず率の欄も
 * 読めない。0 を返せば「率としては表せない」と一貫して扱える——超過そのものは
 * `remainingYen` が負になることで表れる。
 */
function ratioOf(spentYen: number, budgetYen: number): number {
  if (budgetYen <= 0) {
    return 0;
  }
  return spentYen / budgetYen;
}
