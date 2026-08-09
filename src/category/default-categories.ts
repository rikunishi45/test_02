import { INCOME, UNCATEGORIZED, type CategoryRule } from "./classify.js";
import type { CategoryRecord } from "../storage/schema.js";

/**
 * 支出カテゴリの表示色の初期値。並び順に割り当て、足りなくなったら先頭に戻る。
 *
 * 色そのものは後からマスタで変えられる。ここが決めるのは「最初に何色か」だけ。
 *
 * **初期カテゴリの数（`DEFAULT_CATEGORY_RULES` に現れるカテゴリ数）以上であること。**
 * 足りないと初期状態で同じ色が2つ出る。7色だったときは8番目の「食費」が
 * 「サブスク」と同色になり、**支出が最大のカテゴリが円グラフで別物と見分けられない**
 * 状態になっていた。
 *
 * **灰色は入れない。** 未分類に予約してある（`UNCATEGORIZED_COLOR`）。支出の
 * カテゴリに灰色を混ぜると、分類済みと未分類の区別が色から読めなくなる。
 */
export const CATEGORY_PALETTE = [
  "#2fbf6b",
  "#ef6a6a",
  "#e8b84b",
  "#9b7cf0",
  "#4aa8e8",
  "#f08ab0",
  "#2f9fa8",
  "#e0813c",
] as const;

/** 収入は支出のパレットから外す。内訳の円グラフに現れないので、色をぶつけても意味が無い */
export const INCOME_COLOR = "#3ddc97";

/** 未分類は目立たせない。ここが目立つと「分類済み」との差が読めなくなる */
export const UNCATEGORIZED_COLOR = "#5d6b64";

/**
 * カテゴリマスタの初期値をルールから作る。
 *
 * ルールに現れるカテゴリ名を重複なく取り、**名前の昇順**に並べる。ルールの
 * 記述順は「どの摘要を先に判定するか」の都合で決まっていて、一覧の並びとしては
 * 意味を持たない。並び順は後からドラッグで変えられるので、ここでは安定した
 * 順序でありさえすればよい。
 *
 * 収入と未分類は末尾に固定する。どちらも支出のカテゴリではないので、
 * 支出カテゴリの間に混ぜない。
 */
export function defaultCategories(rules: readonly CategoryRule[]): CategoryRecord[] {
  // 収入・未分類がルール側に現れても二重に作らない。主キーが name なので、
  // 重複するとストアに入れた時点で片方が黙って上書きされ、order が狂う。
  const names = [...new Set(rules.map((rule) => rule.category))]
    .filter((name) => name !== INCOME && name !== UNCATEGORIZED)
    .sort((a, b) => a.localeCompare(b));

  const spending = names.map((name, index) => ({
    name,
    color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]!,
    order: index,
  }));

  return [
    ...spending,
    { name: INCOME, color: INCOME_COLOR, order: spending.length },
    { name: UNCATEGORIZED, color: UNCATEGORIZED_COLOR, order: spending.length + 1 },
  ];
}
