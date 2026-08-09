/**
 * 金額のテンキーが受け付けるキー。数字のほかに「00」と訂正の2つ。
 *
 * 記号（`.` や `-`）は無い。円は補助単位を持たないので小数点は要らず、符号は
 * 種別（支出・収入）から決まる（`manual-entry.ts`）。
 */
export type KeypadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "00"
  | "backspace"
  | "clear";

/**
 * 受け付ける桁数の上限。
 *
 * **上限を入力側に置く。** 置かないと `Number.MAX_SAFE_INTEGER` を超える桁まで
 * 打ててしまい、`parseAmount` が「安全に扱える整数の範囲を超えている」で弾く。
 * その時点で人間にできることは押した分を全部消すことだけで、エラーとして遅い。
 */
export const MAX_AMOUNT_DIGITS = 9;

/**
 * テンキーを1つ押した後の金額文字列を返す。
 *
 * `current` はこの関数が返した値であることを前提にする（画面の状態を往復する
 * だけで、外から来ない）。だから桁数や先頭ゼロの検査を入口でやり直さない。
 *
 * **先頭のゼロを作らない。** `"0"` や `"00"` から始まる文字列は `parseAmount` を
 * 通れば同じ数になるが、打ち間違いが画面に残ったまま登録できてしまう。空の
 * ままにして「まだ何も入っていない」と一致させる。
 *
 * **上限を超える押下は、部分的に入れずに丸ごと捨てる。** `"00"` が1桁だけ入る
 * 状況で1桁だけ足すと、押したキーと入った桁数が食い違う。
 */
export function pressKey(current: string, key: KeypadKey): string {
  if (key === "clear") {
    return "";
  }
  if (key === "backspace") {
    return current.slice(0, -1);
  }
  if (current === "") {
    return key === "0" || key === "00" ? "" : key;
  }
  if (current.length + key.length > MAX_AMOUNT_DIGITS) {
    return current;
  }
  return current + key;
}
