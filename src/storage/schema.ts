import type { Transaction } from "../domain/transaction.js";
import type { ColumnMapping } from "../csv/column-mapping.js";

export const DB_NAME = "kakeibo";

/**
 * 2 に上げたのは**オブジェクトストアを2つ増やしたから**（categories / budgets）。
 *
 * IndexedDB のレコードはスキーマレスなので、既存レコードへのフィールド追加
 * （`memo`）だけならバージョンを上げる必要は無い。ただ今回は上げる機会なので、
 * 既存行の `memo` の埋め戻しもこの versionchange に相乗りさせている（`db.ts`）。
 *
 * 4 は**初期カテゴリを増やしたから**（住居 / 美容）。カテゴリの初期値はストアを
 * 作るときにしか入らないので、既に使っているデータベースには versionchange で
 * 足すしかない。**足す経路をバージョンに紐づけるのが要**——起動のたびに足すと、
 * ユーザーが消したカテゴリが次の起動で復活する（`db.ts`）。
 *
 * **3 を飛ばしている。** 開発中、この定数を 3 に上げた状態で画面が読み込まれ、
 * 移行の中身を書く前に versionchange を使い切ったブラウザができた。そこは
 * もう v3 なので、移行を 3 に紐づけると**そのデータベースだけ永久に足されない。**
 * 4 にすれば、新規・v1・v2・中身の無い v3 のどれもが同じ状態に収束する。
 */
export const DB_VERSION = 4;

export const STORE_TRANSACTIONS = "transactions";
export const STORE_IMPORTS = "imports";
export const STORE_COLUMN_MAPPINGS = "columnMappings";
export const STORE_LEARNED_CATEGORIES = "learnedCategories";
export const STORE_CATEGORIES = "categories";
export const STORE_BUDGETS = "budgets";

/** 保存された取引。id はストレージ層が採番する */
export interface StoredTransaction extends Transaction {
  id: string;
  /** 分類済みのカテゴリ。未分類なら "未分類" */
  category: string;
  /**
   * 任意のメモ。**無い場合は空文字列で、`undefined` にはしない。**
   *
   * 省略可能にすると `memo ?? ""` が呼び出し側に散る。境界（マイグレーション・
   * `parseBackup`・入力の検証）で必ず埋めて、内側では常に文字列として扱う。
   */
  memo: string;
}

/**
 * カテゴリのマスタ。名前が主キー。
 *
 * 取引側は `category` に名前を文字列で持つ。ID参照にしないのは、取り込みと
 * 分類がカテゴリ名を直接返す設計になっているため（`classify.ts`）。名前を
 * 変えたらマスタと取引の両方を書き換える必要があるが、それは名前変更の
 * 実装（段階5）の仕事にする。
 */
export interface CategoryRecord {
  name: string;
  /** 表示色。"#rrggbb" */
  color: string;
  /** 並び順。小さいほど先 */
  order: number;
}

/**
 * 月×カテゴリの予算。
 *
 * **総額は持たない。カテゴリ別予算の合計を総額とする。** 別々に持つと、
 * 内訳と総額が食い違った状態を作れてしまう（元モックが実際にそうなっていた）。
 */
export interface BudgetRecord {
  /** `"${month}:${category}"`。主キー */
  id: string;
  /** "YYYY-MM" */
  month: string;
  category: string;
  /** 予算額。**正の数**（集計側が支出を正で持つのに揃える） */
  amountYen: number;
}

/** `BudgetRecord.id` の組み立て。ここ以外で文字列連結しない */
export function budgetId(month: string, category: string): string {
  return `${month}:${category}`;
}

/**
 * 取り込み履歴。CSV原文を残すのは、パーサのバグが後から見つかっても
 * 再解析で復旧できるようにするため（実際にPR#22で安全整数の丸めバグが出た）。
 */
export interface ImportRecord {
  id: string;
  importedAt: string;
  fileName: string;
  rawCsv: string;
  mappingUsed: ColumnMapping;
  transactionCount: number;
}

/** 口座ごとの列マッピング。name をキーにする（"楽天カード" など） */
export interface NamedColumnMapping extends ColumnMapping {
  name: string;
}
