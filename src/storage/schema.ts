import type { Transaction } from "../domain/transaction.js";
import type { ColumnMapping } from "../csv/column-mapping.js";

export const DB_NAME = "kakeibo";
export const DB_VERSION = 1;

export const STORE_TRANSACTIONS = "transactions";
export const STORE_IMPORTS = "imports";
export const STORE_COLUMN_MAPPINGS = "columnMappings";
export const STORE_LEARNED_CATEGORIES = "learnedCategories";

/** 保存された取引。id はストレージ層が採番する */
export interface StoredTransaction extends Transaction {
  id: string;
  /** 分類済みのカテゴリ。未分類なら "未分類" */
  category: string;
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
