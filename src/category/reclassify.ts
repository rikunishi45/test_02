import type { StoredTransaction } from "../storage/schema.js";
import { classifyDescription, type CategoryRule, type LearnedCategories } from "./classify.js";

/**
 * 保存済みの取引を今のルールと学習で分類し直し、**カテゴリが変わったものだけ**を返す。
 *
 * ルールは後から増える。取り込み時に決めたカテゴリを固定してしまうと、
 * ルールを足しても過去の取引は未分類のまま残る。
 *
 * 変わらなかったものを返さないのは、呼び出し側が書き戻す件数を最小にするため。
 * 全件を書き戻しても結果は同じだが、35件が数千件になったときに効いてくる。
 */
export function reclassifyTransactions(
  transactions: readonly StoredTransaction[],
  rules: readonly CategoryRule[],
  learned: LearnedCategories,
): StoredTransaction[] {
  const changed: StoredTransaction[] = [];
  for (const transaction of transactions) {
    const category = classifyDescription(transaction.description, rules, learned);
    if (category !== transaction.category) {
      changed.push({ ...transaction, category });
    }
  }
  return changed;
}
