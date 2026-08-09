import { parseAmount } from "../csv/parse-amount.js";
import { parseDate } from "../csv/parse-date.js";
import type { Transaction, TransactionSource } from "../domain/transaction.js";

export type ManualEntryField = "date" | "amount" | "description";

export interface ManualEntryError {
  field: ManualEntryField;
  message: string;
}

export type ManualEntryKind = "expense" | "income";

export interface ManualEntryInput {
  date: string;
  /** 金額の**大きさ**。正の数で受け取り、符号は `kind` から決める */
  amount: string;
  description: string;
  kind: ManualEntryKind;
  /**
   * 支払い方法。`Transaction.source` そのもので、別のフィールドを作らない。
   *
   * 「現金／カード／銀行」は取り込み元の区別と同じ軸で、二重に持つと
   * 取り込んだ行と手入力の行で別の欄を見ることになる。
   */
  source: TransactionSource;
  memo: string;
}

/**
 * `memo` は `Transaction` に無い（`StoredTransaction` 側のフィールド）ので、
 * 組み立て済みの取引とは別に返す。ここで `StoredTransaction` を組むには
 * `id` と `category` が要るが、どちらもこの関数の責任ではない。
 */
export type ManualEntryResult =
  | { ok: true; transaction: Transaction; memo: string }
  | { ok: false; errors: ManualEntryError[] };

/**
 * 手入力の1件を検証して `Transaction` に組み立てる。CSVに現れない支出と
 * 収入を手で足すため。
 *
 * **検証をここに置く（画面に置かない）。** 日付と金額は取り込みと同じ
 * `parseDate` / `parseAmount` を通す。手入力だけ別の解釈をすると、同じ
 * `"2026/2/30"` がCSVでは弾かれ手入力では通る、といった食い違いが起きる。
 *
 * **金額は大きさだけを受け、符号は `kind` から決める。** 支出が負・収入が正と
 * いう元帳の慣習（`domain/transaction.ts`）を入力欄に持ち込ませない。入力側でも
 * 符号を付けられると「支出として -500」の意味が二重になり、どちらを優先するかを
 * 決める分岐がここに増える。`0` を弾くのは反転で `-0` を作らないため
 * （`-0 < 0` は偽なので後段の範囲チェックを素通りする）。
 *
 * 最初の失敗で止めずに全項目を検証する。3つ直すのに3回送信させないため。
 *
 * **メモは空でよい。** 摘要と違って必須にしない。ただし前後の空白は落とす——
 * `"   "` を許すと、画面では空に見えるのに空でないメモが保存される。
 */
export function buildManualTransaction(input: ManualEntryInput): ManualEntryResult {
  const errors: ManualEntryError[] = [];

  let date: string | undefined;
  try {
    date = parseDate(input.date);
  } catch (error) {
    errors.push({ field: "date", message: String(error) });
  }

  let amountYen: number | undefined;
  // 未入力を parseAmount に渡さない。テンキーでは「まだ何も押していない」が
  // 開始状態で、そこに「parseAmount: 金額として解釈できない」と内部の関数名まで
  // 出すのは誤りの説明として遠い（AGENTS.md 5）。
  if (input.amount.trim() === "") {
    errors.push({ field: "amount", message: "金額を入力してください" });
  } else {
    try {
      const amount = parseAmount(input.amount);
      if (amount <= 0) {
        errors.push({ field: "amount", message: "金額は1円以上の正の数で入力してください" });
      } else {
        amountYen = input.kind === "expense" ? -amount : amount;
      }
    } catch (error) {
      errors.push({ field: "amount", message: String(error) });
    }
  }

  const description = input.description.trim();
  if (description === "") {
    errors.push({ field: "description", message: "摘要を入力してください" });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ここに到達した時点で日付と金額の解析は成功している。型システムはそれを
  // 証明できないので ! で閉じる（parse-date.ts と同じ方針）。
  return {
    ok: true,
    transaction: { date: date!, amountYen: amountYen!, description, source: input.source },
    memo: input.memo.trim(),
  };
}
