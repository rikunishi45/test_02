import { daysInMonth } from "../domain/date-parts.js";

const PATTERNS = [
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
  /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
];

/**
 * 受理する年の範囲。家計簿の取引としてこの外側は、実在の記録ではなく列の
 * 取り違えや桁の打ち間違いと見る。
 *
 * **範囲を絞る理由は妥当性だけではない。** 境界の内側では `shiftMonth` や
 * `addDays` が年をまたいで動く。受理域が 0000 や 9999 に接していると、その
 * 繰り上がり・繰り下がりが4桁からあふれて `"YYYY-MM-DD"` の10文字契約が壊れ、
 * `monthOf` の `slice(0, 7)` が別の位置を切り出す。内側の関数それぞれに桁の
 * 防御を足すのではなく（AGENTS.md 3）、境界で余裕のある範囲に閉じ込める。
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/**
 * 日付文字列を YYYY-MM-DD に正規化する。
 *
 * Date オブジェクトを経由しない。Date はタイムゾーンで日付がずれ、
 * 2月30日のような実在しない日付を黙って繰り上げてしまう。
 */
export function parseDate(input: string): string {
  const trimmed = input.trim();

  for (const pattern of PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match === null) {
      continue;
    }

    // どのパターンもキャプチャグループを3つ持つので、マッチした時点で
    // 3つとも存在する。型システムはそれを証明できないので ! で閉じる。
    // 到達不能な undefined 分岐を書くより、不変条件を明示する方が正直。
    const yearText = match[1]!;
    const monthText = match[2]!;
    const dayText = match[3]!;

    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);

    if (year < MIN_YEAR || year > MAX_YEAR) {
      throw new Error(`parseDate: 年が範囲外: ${input}`);
    }
    if (month < 1 || month > 12) {
      throw new Error(`parseDate: 月が範囲外: ${input}`);
    }
    if (day < 1 || day > daysInMonth(year, month)) {
      throw new Error(`parseDate: 日が範囲外: ${input}`);
    }

    // 年は \d{4} なので既に4桁。月日だけゼロ埋めすればよい。
    return `${yearText}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
  }

  throw new Error(`parseDate: 日付として解釈できない: ${input}`);
}
