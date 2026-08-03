import type { Transaction, TransactionSource } from "../domain/transaction.js";
import { parseAmount } from "./parse-amount.js";
import { parseDate } from "./parse-date.js";

export interface ColumnMapping {
  /** 先頭から飛ばす行数（ヘッダ行など）。0以上 */
  skipRows: number;
  /** 0始まりの列インデックス */
  dateColumn: number;
  amountColumn: number;
  descriptionColumn: number;
  source: TransactionSource;
  /** 支出を正の数で記録するCSV向け。true なら符号を反転する */
  invertAmount: boolean;
}

/**
 * 行が取り込めなかった理由の種別。
 *
 * メッセージ文言ではなくこの種別で分岐する。列マッピングの設定ミス
 * （column-out-of-range）とデータ側の問題（parse-failed）では、UIが出すべき
 * 案内が違う——前者は設定画面へ、後者は該当行の修正へ誘導する。
 */
export type RowErrorKind = "column-out-of-range" | "parse-failed";

export interface RowError {
  /** 元CSVでの行番号（1始まり。skipRows で飛ばした行も数える） */
  rowNumber: number;
  kind: RowErrorKind;
  message: string;
}

export interface MappingResult {
  transactions: Transaction[];
  errors: RowError[];
}

/**
 * 解析済みのCSV行に列マッピングを当てて Transaction を組み立てる。
 *
 * 金融機関ごとの列構成をコードに焼き込まない。取り込み元が増えても
 * ColumnMapping を足すだけで済ませるため。
 *
 * 1行の失敗で全体を捨てない。実CSVには壊れた行が混ざるので、成功分と
 * 失敗分の両方を返して呼び出し側に判断させる。
 */
export function applyMapping(rows: string[][], mapping: ColumnMapping): MappingResult {
  const transactions: Transaction[] = [];
  const errors: RowError[] = [];

  for (const [offset, row] of rows.slice(mapping.skipRows).entries()) {
    const rowNumber = mapping.skipRows + offset + 1;

    // CSV末尾によくある空行。取り込み失敗ではないのでエラーに数えない。
    if (row.every((field) => field === "")) {
      continue;
    }

    const dateRaw = row[mapping.dateColumn];
    const amountRaw = row[mapping.amountColumn];
    const descriptionRaw = row[mapping.descriptionColumn];

    if (dateRaw === undefined || amountRaw === undefined || descriptionRaw === undefined) {
      errors.push({
        rowNumber,
        kind: "column-out-of-range",
        message: "列インデックスが行の範囲外",
      });
      continue;
    }

    try {
      const date = parseDate(dateRaw);
      const amount = parseAmount(amountRaw);
      transactions.push({
        date,
        // 0 を反転すると -0 になり、Intl.NumberFormat が "-￥0" と表示する。
        // 0 のときは反転しない。
        amountYen: mapping.invertAmount && amount !== 0 ? -amount : amount,
        description: descriptionRaw,
        source: mapping.source,
      });
    } catch (error) {
      errors.push({ rowNumber, kind: "parse-failed", message: String(error) });
    }
  }

  return { transactions, errors };
}
