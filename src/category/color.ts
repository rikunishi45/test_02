import { UNCATEGORIZED_COLOR } from "./default-categories.js";
import type { CategoryRecord } from "../storage/schema.js";

/**
 * カテゴリマスタから表示色を引く。
 *
 * マスタに無い名前は未分類の灰色にする。**画面側で `?? 適当な色` と書かせない**
 * ための関数で、引けなかったときに何色になるかを1か所に閉じる。マスタの
 * 読み込みが終わる前は空配列で呼ばれるので、引けない状態は普通に起きる。
 */
export function colorOf(categories: readonly CategoryRecord[], name: string): string {
  const record = categories.find((category) => category.name === name);
  return record === undefined ? UNCATEGORIZED_COLOR : record.color;
}
