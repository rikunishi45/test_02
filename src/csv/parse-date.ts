const PATTERNS = [
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
  /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
];

const MONTHS_WITH_30_DAYS = [4, 6, 9, 11];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return MONTHS_WITH_30_DAYS.includes(month) ? 30 : 31;
}

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

    const month = Number(monthText);
    const day = Number(dayText);

    if (month < 1 || month > 12) {
      throw new Error(`parseDate: 月が範囲外: ${input}`);
    }
    if (day < 1 || day > daysInMonth(Number(yearText), month)) {
      throw new Error(`parseDate: 日が範囲外: ${input}`);
    }

    // 年は \d{4} なので既に4桁。月日だけゼロ埋めすればよい。
    return `${yearText}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
  }

  throw new Error(`parseDate: 日付として解釈できない: ${input}`);
}
