const CURRENCY_SYMBOLS = /[¥￥]/g;
const TRAILING_YEN = /円$/;
const COMMAS = /,/g;
const INTEGER = /^-?\d+$/;

/**
 * 金額文字列を整数の円に変換する。
 *
 * カンマは位置の妥当性を検証せずに除去する。区切り位置の正しさは金額の意味に
 * 影響せず、金融機関ごとに揺れる部分なので、ここで弾く価値がない。
 */
export function parseAmount(input: string): number {
  const normalized = input
    .trim()
    .replace(CURRENCY_SYMBOLS, "")
    .replace(TRAILING_YEN, "")
    .replace(COMMAS, "")
    .trim();

  if (!INTEGER.test(normalized)) {
    throw new Error(`parseAmount: 金額として解釈できない: ${input}`);
  }

  const value = Number(normalized);

  // 正規表現は桁数を制限しないので、ここを通さないと安全整数を超えた値が
  // 黙って丸められる（"9007199254740993" → 9007199254740992）。
  // 金額が誤った値のまま通る唯一の経路なので、例外にして気づけるようにする。
  if (!Number.isSafeInteger(value)) {
    throw new Error(`parseAmount: 安全に扱える整数の範囲を超えている: ${input}`);
  }

  // "-0" は -0 になる。Intl.NumberFormat が -0 を "-￥0" と表示してしまうので、
  // 表示層に渡る前にここで 0 に寄せる（value === 0 は -0 でも真）。
  if (value === 0) {
    return 0;
  }

  return value;
}
