import type {
  StoredTransaction,
  ImportRecord,
  NamedColumnMapping,
  CategoryRecord,
  BudgetRecord,
} from "./schema.js";
import type { LearnedCategories } from "../category/classify.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import { defaultCategories } from "../category/default-categories.js";

/** 書き出す形式。カテゴリ・予算・`memo` が増えた分を 2 とする */
export const BACKUP_FORMAT_VERSION = 2;

/** 読める形式。古いものは読み替えて受け入れる（`parseBackup`） */
const READABLE_FORMAT_VERSIONS = [1, 2];

export interface BackupData {
  formatVersion: number;
  exportedAt: string;
  transactions: StoredTransaction[];
  imports: ImportRecord[];
  columnMappings: NamedColumnMapping[];
  learnedCategories: LearnedCategories;
  categories: CategoryRecord[];
  budgets: BudgetRecord[];
}

export type BackupPayload = Omit<BackupData, "formatVersion" | "exportedAt">;

/**
 * バックアップ用のデータをまとめる。
 *
 * 現在時刻を関数内で取らずに引数で受ける。時刻を内部で取ると結果が呼ぶたびに
 * 変わり、テストで固定できなくなる。
 */
export function buildBackup(payload: BackupPayload, exportedAt: string): BackupData {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    transactions: [...payload.transactions],
    imports: [...payload.imports],
    columnMappings: [...payload.columnMappings],
    learnedCategories: { ...payload.learnedCategories },
    categories: [...payload.categories],
    budgets: [...payload.budgets],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TRANSACTION_SOURCES = ["card", "bank", "cash"];

/**
 * 復元は既存データを全消ししてから書き込む。壊れた要素をここで通すと、
 * 消した後で画面が落ちて手元に何も残らない。アプリが実際に読むフィールドまでは
 * 見てから通す（全フィールドの深い検証はしない）。
 */
function validateTransactions(items: unknown[]): void {
  for (const [index, item] of items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseBackup: transactions[${index}] がオブジェクトではない`);
    }
    for (const key of ["id", "date", "description", "category"]) {
      if (typeof item[key] !== "string") {
        throw new Error(`parseBackup: transactions[${index}].${key} が文字列ではない`);
      }
    }
    if (typeof item["amountYen"] !== "number" || !Number.isInteger(item["amountYen"])) {
      throw new Error(`parseBackup: transactions[${index}].amountYen が整数ではない`);
    }
    if (!TRANSACTION_SOURCES.includes(item["source"] as string)) {
      throw new Error(`parseBackup: transactions[${index}].source が未知の値`);
    }
    // v1 のバックアップには memo が無い。無いのは許して後で空文字列を入れるが、
    // 別の型が入っているのは書き換えられたファイルなので通さない。
    const memo = item["memo"];
    if (memo !== undefined && typeof memo !== "string") {
      throw new Error(`parseBackup: transactions[${index}].memo が文字列ではない`);
    }
  }
}

/** `#rrggbb` だけを受ける。画面がそのまま style に渡すので、形の分からない値は入れない */
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

function validateCategories(items: unknown[]): void {
  for (const [index, item] of items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseBackup: categories[${index}] がオブジェクトではない`);
    }
    if (typeof item["name"] !== "string" || item["name"] === "") {
      throw new Error(`parseBackup: categories[${index}].name が空でない文字列ではない`);
    }
    if (typeof item["color"] !== "string" || !HEX_COLOR.test(item["color"])) {
      throw new Error(`parseBackup: categories[${index}].color が #rrggbb ではない`);
    }
    if (typeof item["order"] !== "number" || !Number.isInteger(item["order"])) {
      throw new Error(`parseBackup: categories[${index}].order が整数ではない`);
    }
  }
}

function validateBudgets(items: unknown[]): void {
  for (const [index, item] of items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseBackup: budgets[${index}] がオブジェクトではない`);
    }
    for (const key of ["id", "month", "category"]) {
      if (typeof item[key] !== "string") {
        throw new Error(`parseBackup: budgets[${index}].${key} が文字列ではない`);
      }
    }
    // 予算は正の数で持つ（schema.ts）。負や 0 を通すと達成率が 0 除算や
    // 負の割合になり、画面では「それらしい数字」として出てしまう。
    const amount = item["amountYen"];
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      throw new Error(`parseBackup: budgets[${index}].amountYen が1以上の整数ではない`);
    }
  }
}

/** 列マッピングは取り込み画面がそのまま読み込むので、同じ理由で検証する */
function validateColumnMappings(items: unknown[]): void {
  for (const [index, item] of items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseBackup: columnMappings[${index}] がオブジェクトではない`);
    }
    if (typeof item["name"] !== "string") {
      throw new Error(`parseBackup: columnMappings[${index}].name が文字列ではない`);
    }
    // 負値を弾く。skipRows が負だと applyMapping の rows.slice(skipRows) が
    // 最終行だけを取り込み、残りをエラーにも errors[] にも出さずに捨てる。
    // 列インデックスの負値は row[-1] が undefined になって範囲外エラーとして
    // 表に出るが、同じ理由で通す意味が無いのでまとめて弾く。
    for (const key of ["skipRows", "dateColumn", "amountColumn", "descriptionColumn"]) {
      const value = item[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`parseBackup: columnMappings[${index}].${key} が0以上の整数ではない`);
      }
    }
    if (typeof item["invertAmount"] !== "boolean") {
      throw new Error(`parseBackup: columnMappings[${index}].invertAmount が真偽値ではない`);
    }
    if (!TRANSACTION_SOURCES.includes(item["source"] as string)) {
      throw new Error(`parseBackup: columnMappings[${index}].source が未知の値`);
    }
  }
}

/** 取り込み履歴は id が主キー。欠けると保存時にトランザクションごと落ちる */
function validateImports(items: unknown[]): void {
  for (const [index, item] of items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseBackup: imports[${index}] がオブジェクトではない`);
    }
    if (typeof item["id"] !== "string") {
      throw new Error(`parseBackup: imports[${index}].id が文字列ではない`);
    }
  }
}

/**
 * バックアップJSONを読む。
 *
 * ここはシステム境界（外部から来るファイル）なので検証する。
 *
 * **古い形式（v1）は読み替えて受け入れる。** 「ときどき書き出してください」と
 * 案内してきた以上、手元にv1のファイルがある前提で作る必要がある。逆に
 * **新しすぎる形式は読まない**——古いアプリが新しいバックアップを中途半端に
 * 読み込むと、知らないフィールドが静かに消える。
 */
export function parseBackup(json: string): BackupData {
  const parsed: unknown = JSON.parse(json);

  if (!isPlainObject(parsed)) {
    throw new Error("parseBackup: バックアップがオブジェクトではない");
  }
  if (typeof parsed["formatVersion"] !== "number") {
    throw new Error("parseBackup: formatVersion が数値ではない");
  }
  if (!READABLE_FORMAT_VERSIONS.includes(parsed["formatVersion"])) {
    throw new Error(
      `parseBackup: 対応していない形式のバージョン: ${String(parsed["formatVersion"])}`,
    );
  }
  if (typeof parsed["exportedAt"] !== "string") {
    throw new Error("parseBackup: exportedAt が文字列ではない");
  }
  if (!Array.isArray(parsed["transactions"])) {
    throw new Error("parseBackup: transactions が配列ではない");
  }
  if (!Array.isArray(parsed["imports"])) {
    throw new Error("parseBackup: imports が配列ではない");
  }
  if (!Array.isArray(parsed["columnMappings"])) {
    throw new Error("parseBackup: columnMappings が配列ではない");
  }
  if (!isPlainObject(parsed["learnedCategories"])) {
    throw new Error("parseBackup: learnedCategories がオブジェクトではない");
  }

  validateTransactions(parsed["transactions"]);
  validateImports(parsed["imports"]);
  validateColumnMappings(parsed["columnMappings"]);

  let categories: CategoryRecord[];
  let budgets: BudgetRecord[];
  if (parsed["formatVersion"] === 1) {
    // v1 はカテゴリのマスタも予算も持たない。空配列で復元すると、復元した瞬間に
    // カテゴリ一覧が消える（replaceAll はストアを全消ししてから書く）。
    // マイグレーションと同じ初期値を入れ直す。
    categories = defaultCategories(DEFAULT_CATEGORY_RULES);
    budgets = [];
  } else {
    if (!Array.isArray(parsed["categories"])) {
      throw new Error("parseBackup: categories が配列ではない");
    }
    if (!Array.isArray(parsed["budgets"])) {
      throw new Error("parseBackup: budgets が配列ではない");
    }
    validateCategories(parsed["categories"]);
    validateBudgets(parsed["budgets"]);
    categories = parsed["categories"] as CategoryRecord[];
    budgets = parsed["budgets"] as BudgetRecord[];
  }

  return {
    formatVersion: parsed["formatVersion"],
    exportedAt: parsed["exportedAt"],
    // 検証は通っているが、v1 の取引には memo が無い。型の上では string でも
    // 実際には欠けているので、ここで埋める。
    transactions: (parsed["transactions"] as StoredTransaction[]).map((transaction) => ({
      ...transaction,
      memo: transaction.memo ?? "",
    })),
    imports: parsed["imports"] as ImportRecord[],
    columnMappings: parsed["columnMappings"] as NamedColumnMapping[],
    learnedCategories: parsed["learnedCategories"] as LearnedCategories,
    categories,
    budgets,
  };
}
