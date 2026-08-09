import type { Transaction } from "../domain/transaction.js";
import { normalizeDescription } from "./normalize.js";

export const UNCATEGORIZED = "未分類";

/** 収入のカテゴリ。`sumByCategory` は収入を集計に入れないので内訳には現れない */
export const INCOME = "収入";

export interface CategoryRule {
  /** 摘要にこの文字列が含まれるかで判定する。空文字列のルールはマッチしない */
  pattern: string;
  category: string;
}

/** 手動修正の記録。摘要の完全一致 → カテゴリ */
export type LearnedCategories = Readonly<Record<string, string>>;

/**
 * 摘要からカテゴリを決める。
 *
 * 学習をルールより優先する。ユーザーが明示的に直した内容は、汎用のルールより
 * 意図が強い。
 *
 * 学習は完全一致にする。「セブンイレブン渋谷店」を直したときに
 * 「セブンイレブン新宿店」まで動かすには共通部分の推測が要り、当たれば便利だが
 * 外れると理由の分からない分類になる。広く効かせたいならルールを足す方が明示的。
 *
 * 学習の照合は大文字小文字も区別する（ルールの部分一致とは扱いが違う）。
 * 学習はユーザーが直した摘要そのものの記録なので、勝手に丸めない。
 */
export function classifyDescription(
  description: string,
  rules: readonly CategoryRule[],
  learned: LearnedCategories,
): string {
  // learned は素のオブジェクトなので、in や添字だけで見ると
  // "constructor" のようなプロトタイプ由来のプロパティを拾ってしまう。
  // hasOwn が真なら値は必ず string なので、到達不能な undefined 分岐は書かずに
  // ! で型を閉じる（parse-date.ts と同じ方針）。
  if (Object.hasOwn(learned, description)) {
    return learned[description]!;
  }

  // ルールの照合だけ NFKC で畳む。実データの摘要は全角英数・半角カナ・全角
  // ハイフンが混ざるので、畳まないとどう書いても当たらない（normalize.ts 参照）。
  // learned を畳まないのは上の通り、ユーザーが直した文字列そのものの記録だから。
  const haystack = normalizeDescription(description).toLowerCase();
  for (const rule of rules) {
    // 空パターンはあらゆる文字列に含まれてしまう。1本紛れ込むだけで
    // 全件がそのカテゴリになるので、マッチさせない。正規化で空になる
    // パターン（空白だけなど）も同じ危険があるので、畳んだ後で判定する。
    const needle = normalizeDescription(rule.pattern).toLowerCase();
    if (needle === "") {
      continue;
    }
    if (haystack.includes(needle)) {
      return rule.category;
    }
  }

  return UNCATEGORIZED;
}

/**
 * カテゴリを人間が編集してよい取引か。**支出だけが対象。**
 *
 * 画面はこの判定を自分で書かない。編集欄を出すかどうかと、`categoryFor` が
 * 分類するかどうかは同じ条件で動く必要があり、二重に書くと片方だけずれる。
 */
export function isCategorizable(transaction: Pick<Transaction, "amountYen">): boolean {
  return transaction.amountYen < 0;
}

/**
 * 取引1件のカテゴリを決める。**収入は分類しない。**
 *
 * 学習（`LearnedCategories`）のキーは摘要だけで符号を持たない。収入にカテゴリを
 * 付けられるようにすると、収入の分類を直したときに同じ摘要の**支出**まで動く。
 * 画面には「直していない行が変わった」としか出ないので、見て気づけない。
 *
 * 分類が要るのはそもそも支出だけでもある——`sumByCategory` は収入を集計に
 * 入れない（「カテゴリは支出の内訳を見るためのもの」）。
 *
 * 金額 0 は支出でも収入でもないので、どちらにも寄せず未分類にする。`-0` も
 * ここに落ちる（`-0 > 0` も `-0 < 0` も偽）。三分岐は `sumByPeriod` と同じ形。
 */
export function categoryFor(
  transaction: Pick<Transaction, "description" | "amountYen">,
  rules: readonly CategoryRule[],
  learned: LearnedCategories,
): string {
  if (transaction.amountYen > 0) {
    return INCOME;
  }
  if (transaction.amountYen < 0) {
    return classifyDescription(transaction.description, rules, learned);
  }
  return UNCATEGORIZED;
}
