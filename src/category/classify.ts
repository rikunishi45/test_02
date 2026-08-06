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

  const haystack = description.toLowerCase();
  for (const rule of rules) {
    // 空パターンはあらゆる文字列に含まれてしまう。1本紛れ込むだけで
    // 全件がそのカテゴリになるので、マッチさせない。
    if (rule.pattern === "") {
      continue;
    }
    if (haystack.includes(rule.pattern.toLowerCase())) {
      return rule.category;
    }
  }

  return UNCATEGORIZED;
}

/**
 * 手動修正を学習に反映した新しい記録を返す。引数は書き換えない。
 *
 * 未分類を指定したときは学習を消す。「間違って覚えさせた」を取り消す経路が
 * 無いと、一度ついた分類を直せなくなる。
 */
export function rememberCategory(
  learned: LearnedCategories,
  description: string,
  category: string,
): LearnedCategories {
  if (category === UNCATEGORIZED) {
    const next: Record<string, string> = { ...learned };
    delete next[description];
    return next;
  }

  return { ...learned, [description]: category };
}
