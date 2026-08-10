import type { StoredTransaction } from "../storage/schema.js";
import { UNCATEGORIZED, categoryFor, type CategoryRule, type LearnedCategories } from "./classify.js";

/**
 * 保存済みの取引を今のルールと学習で分類し直し、**カテゴリが変わったものだけ**を返す。
 *
 * ルールは後から増える。取り込み時に決めたカテゴリを固定してしまうと、
 * ルールを足しても過去の取引は未分類のまま残る。
 *
 * 変わらなかったものを返さないのは、呼び出し側が書き戻す件数を最小にするため。
 * 全件を書き戻しても結果は同じだが、35件が数千件になったときに効いてくる。
 *
 * `known` を渡すと、**マスタに無いカテゴリを未分類に落とす。** カテゴリの名前を
 * 変えてもルール（コード上の定数）は旧名を返し続けるので、渡さないと画面に
 * 「マスタに無いカテゴリ」の行が出て、選択欄にも現れない幽霊になる。未分類に
 * 落ちれば人間が拾えて、直せば学習が覚える。
 *
 * 省略すると落とさない。**本番の呼び出しは1か所（`App.tsx`）で、そこでは必ず
 * 渡す。** 省略できるようにしてあるのは、この判定を持たない状態の分類を
 * テストが直接確かめられるようにするため。
 */
export function reclassifyTransactions(
  transactions: readonly StoredTransaction[],
  rules: readonly CategoryRule[],
  learned: LearnedCategories,
  known?: ReadonlySet<string>,
): StoredTransaction[] {
  const changed: StoredTransaction[] = [];
  for (const transaction of transactions) {
    const derived = categoryFor(transaction, rules, learned);
    const category = known !== undefined && !known.has(derived) ? UNCATEGORIZED : derived;
    if (category !== transaction.category) {
      changed.push({ ...transaction, category });
    }
  }
  return changed;
}
