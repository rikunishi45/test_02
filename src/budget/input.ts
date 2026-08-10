import { parseAmount } from "../csv/parse-amount.js";

export type BudgetInputResult =
  | { ok: true; amountYen: number }
  | { ok: false; message: string };

/**
 * 予算の入力欄を読む。
 *
 * **空欄は 0（予算を外す）。** `setBudget` が 0 でレコードを消すので、
 * 「外す」ための別の操作を作らずに済む。
 *
 * 金額そのものの解釈は取り込みと同じ `parseAmount` に任せる。カンマ・全角・
 * `￥` の扱いを2つ持つと、CSVでは通る書き方が予算欄では弾かれる、という
 * 食い違いが出る。**円の読み方はアプリに1つしか無い。**
 *
 * 負の数は弾く。`setBudget` は 0 以下を「消す」と解釈するので、そのまま渡すと
 * `-500` の打ち間違いで予算が黙って消える。0 と空欄だけが「外す」。
 *
 * **全角は NFKC で畳んでから渡す。** `parseAmount` は畳まない——あちらはCSVの
 * 金額列、つまり機械が出した値を読む。こちらは人がIMEで打つ欄なので、
 * 全角のまま「数字で入力してください」と返されるのは説明として遠い。
 * 畳む位置を入口に置けば、金額の読み方そのものは1つのままでいられる。
 */
export function parseBudgetInput(input: string): BudgetInputResult {
  if (input.trim() === "") {
    return { ok: true, amountYen: 0 };
  }

  let amountYen: number;
  try {
    amountYen = parseAmount(input.normalize("NFKC"));
  } catch {
    // parseAmount のメッセージは内部の関数名を含む。入力欄に出す文言は
    // ここで作る（`manual-entry.ts` の未入力と同じ方針）。
    return { ok: false, message: "金額は数字で入力してください" };
  }

  if (amountYen < 0) {
    return { ok: false, message: "予算は0円以上で入力してください" };
  }
  return { ok: true, amountYen };
}
