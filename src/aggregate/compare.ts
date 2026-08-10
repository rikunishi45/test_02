import { sumByCategory } from "./period.js";
import type { StoredTransaction } from "../storage/schema.js";

export interface CategoryComparison {
  category: string;
  /** 今期の支出（正の数） */
  expenseYen: number;
  /** 前期の支出（正の数）。前期に無ければ 0 */
  previousYen: number;
  /** 増えた額。増加が正、減少が負 */
  deltaYen: number;
}

/**
 * カテゴリごとに今期と前期を突き合わせる。
 *
 * **前期にしか無いカテゴリも返す。** 今期の分だけを並べると、使わなくなった
 * カテゴリが一覧から消える——「減った」ことこそ見たい情報なのに、消えると
 * 気づけない。今期 0 円・前期 3,000 円の行として残す。
 *
 * 収入は含まない。`sumByCategory` に合わせる（カテゴリは支出の内訳を見るもの）。
 *
 * 並びは今期の支出が多い順。同額はカテゴリ名の昇順で決着させる——額だけで
 * 決めると、前期にしか無い 0 円の行どうしの順序が入力順に依存する。
 *
 * **この並べ替えの額の比較は、いまの入力では結果を変えない。** `sumByCategory`
 * が既に支出の降順で返し、前期にしか無いカテゴリは 0 円なので後ろに付くため。
 * Stryker では同値ミュータントとして生存する（`typescript.md` の方針どおり、
 * 無理に潰さない）。それでも書いておくのは、並び順を呼び出し先の戻り順という
 * 暗黙の性質に委ねないため——ここを読めば何順かが分かる状態を保つ。
 */
export function compareByCategory(
  current: readonly StoredTransaction[],
  previous: readonly StoredTransaction[],
): CategoryComparison[] {
  const currentByCategory = toMap(current);
  const previousByCategory = toMap(previous);

  const categories = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);

  return [...categories]
    .map((category) => {
      const expenseYen = currentByCategory.get(category) ?? 0;
      const previousYen = previousByCategory.get(category) ?? 0;
      return { category, expenseYen, previousYen, deltaYen: expenseYen - previousYen };
    })
    .sort((a, b) => b.expenseYen - a.expenseYen || a.category.localeCompare(b.category));
}

function toMap(transactions: readonly StoredTransaction[]): Map<string, number> {
  return new Map(sumByCategory(transactions).map((total) => [total.category, total.expenseYen]));
}
