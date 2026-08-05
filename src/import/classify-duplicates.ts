import type { Transaction } from "../domain/transaction.js";

export type ImportRowStatus = "new" | "duplicate-candidate";

export interface ClassifiedTransaction {
  transaction: Transaction;
  status: ImportRowStatus;
}

/**
 * 同一の取引かどうかを判定するための指紋。
 *
 * JSON.stringify を使うのは、区切り文字を自前で選ぶと摘要にその文字が
 * 含まれたときに別の取引が同じ指紋になり得るため。
 *
 * 正規化（空白のトリム等）はしない。同じ取引を同じ取り込み元から出力すれば
 * 文字列は一致するはずで、正規化を挟むと「なぜ同一と判定されたか」が
 * 追いにくくなる。
 */
export function transactionFingerprint(transaction: Transaction): string {
  return JSON.stringify([
    transaction.date,
    transaction.amountYen,
    transaction.description,
    transaction.source,
  ]);
}

/**
 * 取り込もうとしている取引を、新規と重複候補に仕分ける。
 *
 * 重複候補を自動で除外しない。同じ店で同額を2回使うことは普通にあり、
 * 機械的に消すと正当な明細が失われる。判断は人間に渡す。
 *
 * 件数で突き合わせる点が要。既存に1件ある取引が新規CSVに2件あるなら、
 * 重複しているのは1件だけで、もう1件は新しい取引として扱う。
 */
export function classifyForImport(
  existing: readonly Transaction[],
  incoming: readonly Transaction[],
): ClassifiedTransaction[] {
  const remaining = new Map<string, number>();
  for (const transaction of existing) {
    const fingerprint = transactionFingerprint(transaction);
    remaining.set(fingerprint, (remaining.get(fingerprint) ?? 0) + 1);
  }

  return incoming.map((transaction) => {
    const fingerprint = transactionFingerprint(transaction);
    const count = remaining.get(fingerprint) ?? 0;

    if (count > 0) {
      remaining.set(fingerprint, count - 1);
      return { transaction, status: "duplicate-candidate" };
    }

    return { transaction, status: "new" };
  });
}
