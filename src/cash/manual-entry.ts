import { parseAmount } from "../csv/parse-amount.js";
import { parseDate } from "../csv/parse-date.js";
import type { Transaction } from "../domain/transaction.js";

export type CashEntryField = "date" | "amount" | "description";

export interface CashEntryError {
  field: CashEntryField;
  message: string;
}

export type CashEntryKind = "expense" | "income";

export interface CashEntryInput {
  date: string;
  /** 金額の**大きさ**。正の数で受け取り、符号は `kind` から決める */
  amount: string;
  description: string;
  kind: CashEntryKind;
}

export type CashEntryResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; errors: CashEntryError[] };

/**
 * 手入力の1件を検証して `Transaction` に組み立てる。CSVに現れない現金の
 * 支出と収入用。
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
 */
export function buildCashTransaction(input: CashEntryInput): CashEntryResult {
  const errors: CashEntryError[] = [];

  let date: string | undefined;
  try {
    date = parseDate(input.date);
  } catch (error) {
    errors.push({ field: "date", message: String(error) });
  }

  let amountYen: number | undefined;
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
    transaction: { date: date!, amountYen: amountYen!, description, source: "cash" },
  };
}
