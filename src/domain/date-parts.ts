const MONTHS_WITH_30_DAYS = [4, 6, 9, 11];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `month` は1〜12 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return MONTHS_WITH_30_DAYS.includes(month) ? 30 : 31;
}

/**
 * `"YYYY-MM-DD"` の曜日を返す。0 が日曜、6 が土曜。
 *
 * **UTCで組んでUTCで読む。ローカル時刻の `Date` は使わない。**
 * `new Date("2026-08-01")` はUTCとして解釈されるが、ローカルのゲッタで読むと
 * 日付がずれる地域がある。UTCで閉じれば実行環境のタイムゾーンに依らない。
 *
 * **`Date.UTC` ではなく `setUTCFullYear` を使う。** `Date.UTC` は年 0〜99 を
 * 1900年代に読み替えるため、`Date.UTC(99, 0, 1)` が 1999年になる。今は `parseDate` が
 * 年を1900〜2100に絞るのでその読み替えには届かないが、曜日の正しさを境界の受理域に
 * 依存させない——受理域と安全域がずれた瞬間に、曜日が狂ってカレンダーの格子が
 * 丸ごと1列ずれる。
 *
 * 日付そのものの妥当性はここでは見ない。呼び出し元は `parseDate` を通った値か、
 * `daysInMonth` の範囲で組み立てた値を渡す。
 */
export function dayOfWeek(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return utc.getUTCDay();
}

/**
 * `"YYYY-MM-DD"` に日数を足す。負の数で引ける。
 *
 * **UTCで組んでUTCで読む**（`dayOfWeek` と同じ理由）。ローカル時刻で組むと、
 * 夏時間のある地域で日付が1日ずれる。`Date.UTC` ではなく `setUTCFullYear` を
 * 使うのも同じ理由で、年 0〜99 が1900年代に読み替えられるのを避けるため。
 *
 * 週表示は月をまたぐ（7月最終週の後半が8月になる）ので、月末・年末・うるう年の
 * 繰り上がりを自分で書かずに `Date` に任せる。
 */
export function addDays(date: string, days: number): string {
  const utc = new Date(0);
  utc.setUTCFullYear(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  utc.setUTCDate(utc.getUTCDate() + days);

  const year = String(utc.getUTCFullYear()).padStart(4, "0");
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * `Date` の**ローカル**日付を `"YYYY-MM-DD"` にする。入力欄の初期値に使う。
 *
 * `toISOString().slice(0, 10)` を使わない。あれはUTCなので、JST(UTC+9)では
 * 0時〜9時に前日の日付が出る。`dayOfWeek` がUTCで閉じるのと方針が逆に見えるが、
 * 欲しいものが違う——あちらは文字列の曜日という環境に依らない事実で、
 * こちらは「人間が今日だと思っている日」。
 */
export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
