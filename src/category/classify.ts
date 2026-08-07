import { normalizeDescription } from "./normalize.js";

export const UNCATEGORIZED = "未分類";

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
