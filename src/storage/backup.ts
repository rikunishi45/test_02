import type { StoredTransaction, ImportRecord, NamedColumnMapping } from "./schema.js";
import type { LearnedCategories } from "../category/classify.js";

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupData {
  formatVersion: number;
  exportedAt: string;
  transactions: StoredTransaction[];
  imports: ImportRecord[];
  columnMappings: NamedColumnMapping[];
  learnedCategories: LearnedCategories;
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
 * 形式のバージョンが違うものは黙って読まない——将来フィールドを増やしたとき、
 * 古いアプリが新しいバックアップを中途半端に読み込むと、差分が静かに消える。
 */
export function parseBackup(json: string): BackupData {
  const parsed: unknown = JSON.parse(json);

  if (!isPlainObject(parsed)) {
    throw new Error("parseBackup: バックアップがオブジェクトではない");
  }
  if (typeof parsed["formatVersion"] !== "number") {
    throw new Error("parseBackup: formatVersion が数値ではない");
  }
  if (parsed["formatVersion"] !== BACKUP_FORMAT_VERSION) {
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

  return {
    formatVersion: parsed["formatVersion"],
    exportedAt: parsed["exportedAt"],
    transactions: parsed["transactions"] as StoredTransaction[],
    imports: parsed["imports"] as ImportRecord[],
    columnMappings: parsed["columnMappings"] as NamedColumnMapping[],
    learnedCategories: parsed["learnedCategories"] as LearnedCategories,
  };
}
