import type { StoredTransaction } from "../storage/schema.js";
import { UNCATEGORIZED } from "../category/classify.js";

/**
 * 期間ごとの集計。
 *
 * 支出と収入を分けて、**どちらも正の数**で持つ。取引の `amountYen` は支出が負・
 * 収入が正だが（`domain/transaction.ts`）、分けるには符号を見る判定が要り、
 * それは画面ではなくここの仕事になる。一度分けてしまえば大きさで持つ方が自然で、
 * 表示のたびに符号を反転させる場所を増やさずに済む。
 */
export interface PeriodTotal {
  /** "YYYY-MM"（月次）または "YYYY-MM-DD"（日次） */
  period: string;
  expenseYen: number;
  incomeYen: number;
}

export interface CategoryTotal {
  category: string;
  expenseYen: number;
}

/** "YYYY-MM-DD" → "YYYY-MM" */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * 月キー（"YYYY-MM"）を `step` か月だけ動かす。
 *
 * **日付に「1か月」を足す形では書けない。** 1月31日の翌月は2月31日で、
 * `Date` に足させると3月3日に繰り上がる。月キーだけを動かせばその問題が無い。
 *
 * 年は4桁にゼロ詰めする。境界（`parseDate`）が年を1900〜2100に絞るので取り込んだ
 * データからは3桁以下の年は来ないが、詰めないと日付順の比較（文字列の辞書順）が
 * 壊れる。ゼロ詰めの正しさを境界の受理域に依存させない。
 */
export function shiftMonth(month: string, step: number): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  // 0起点の通し月に直してから動かす。12月をまたぐ繰り上がり・繰り下がりを
  // 自分で場合分けしない。
  const total = year * 12 + (monthNumber - 1) + step;
  const shiftedYear = Math.floor(total / 12);
  const shiftedMonth = total - shiftedYear * 12 + 1;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

/**
 * 期間キーごとに支出と収入を合計する。返る順序は期間の昇順。
 *
 * 日付は "YYYY-MM-DD" 固定なので、文字列の辞書順が日付順と一致する
 * （`domain/transaction.ts`）。日付として解釈し直す必要はない。
 *
 * 金額 0 の取引は支出にも収入にも数えない。`-0` も同様（`-0 < 0` は偽）。
 * 合計に `-0` を混ぜないためで、混ざると `Intl.NumberFormat` が `-￥0` と表示する。
 */
function sumByPeriod(
  transactions: readonly StoredTransaction[],
  keyOf: (transaction: StoredTransaction) => string,
): PeriodTotal[] {
  const totals = new Map<string, PeriodTotal>();

  for (const transaction of transactions) {
    const period = keyOf(transaction);
    let total = totals.get(period);
    if (total === undefined) {
      total = { period, expenseYen: 0, incomeYen: 0 };
      totals.set(period, total);
    }
    if (transaction.amountYen < 0) {
      total.expenseYen -= transaction.amountYen;
    } else if (transaction.amountYen > 0) {
      total.incomeYen += transaction.amountYen;
    }
  }

  return [...totals.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function sumByMonth(transactions: readonly StoredTransaction[]): PeriodTotal[] {
  return sumByPeriod(transactions, (transaction) => monthOf(transaction.date));
}

export function sumByDay(transactions: readonly StoredTransaction[]): PeriodTotal[] {
  return sumByPeriod(transactions, (transaction) => transaction.date);
}

/** `"YYYY-MM-DD"` から年（`"YYYY"`）を取り出す */
export function yearOf(date: string): string {
  return date.slice(0, 4);
}

export function sumByYear(transactions: readonly StoredTransaction[]): PeriodTotal[] {
  return sumByPeriod(transactions, (transaction) => yearOf(transaction.date));
}

/**
 * 年キー（`"YYYY"`）を `step` 年だけ動かす。
 *
 * 年は4桁にゼロ詰めする。`shiftMonth` と同じ理由——詰めないと日付順の比較
 * （文字列の辞書順）が壊れる。
 */
export function shiftYear(year: string, step: number): string {
  return String(Number(year) + step).padStart(4, "0");
}

/**
 * 期間で割らずに全件を合計する。絞り込みに追従する合計を出すため。
 *
 * `sumByMonth` の結果を足し合わせる形では書かない。絞り込んだ集合が複数の月に
 * またがるとき、月ごとに丸めた値を足すことになるわけではないが、**「画面に
 * 並んでいる行の合計」と「合計欄の数字」を別経路で出すと食い違う**
 * （`totalOfCells` と同じ理由）。渡された集合をそのまま1回で足す。
 *
 * 支出・収入とも正の数で返す。空の集合では両方 +0（`-0` にしない）。
 */
export function sumAll(transactions: readonly StoredTransaction[]): {
  expenseYen: number;
  incomeYen: number;
} {
  let expenseYen = 0;
  let incomeYen = 0;
  for (const transaction of transactions) {
    if (transaction.amountYen < 0) {
      expenseYen -= transaction.amountYen;
    } else if (transaction.amountYen > 0) {
      incomeYen += transaction.amountYen;
    }
  }
  return { expenseYen, incomeYen };
}

/**
 * カテゴリごとの支出を合計する。支出の多い順。同額ならカテゴリ名の昇順。
 *
 * 並び順を額だけで決めると、同額のカテゴリの順序が入力順に依存して、
 * 取引を1件足しただけで凡例の並びが入れ替わる。名前で決着させる。
 *
 * 収入は含めない。カテゴリは支出の内訳を見るためのもので、給与や振替を
 * 同じ円グラフに混ぜると割合の意味が壊れる。
 */
export function sumByCategory(transactions: readonly StoredTransaction[]): CategoryTotal[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.amountYen >= 0) {
      continue;
    }
    const category = transaction.category === "" ? UNCATEGORIZED : transaction.category;
    totals.set(category, (totals.get(category) ?? 0) - transaction.amountYen);
  }

  return [...totals.entries()]
    .map(([category, expenseYen]) => ({ category, expenseYen }))
    .sort((a, b) => b.expenseYen - a.expenseYen || a.category.localeCompare(b.category));
}

/**
 * 支出の大きさを、元帳の符号（支出は負）に戻す。**0 は `+0` のまま返す。**
 *
 * 集計は支出を正の数で持つが、画面では `-￥12,345` と符号付きで出したい。
 * そこで単純に `-expenseYen` と書くと、支出が0の月（収入だけの月は普通にある）で
 * `-0` になり、`Intl.NumberFormat` が `-￥0` と表示する。
 *
 * 反転そのものは1行だが、**このプロジェクトで `-0` を4回踏んでいる**ので、
 * 判定を画面側に置かず壁の中に固定する。
 */
export function negateExpense(expenseYen: number): number {
  return expenseYen === 0 ? 0 : -expenseYen;
}

/**
 * 収支（収入 − 支出）。プラスなら残った額、マイナスなら足りなかった額。
 *
 * `PeriodTotal` はどちらも正の数で持つので、引き算はここで1回だけ行う。
 * 画面で `income - expense` と書くと、`negateExpense` を通した表示用の値と
 * 混ざったときに符号が二重に反転する——このプロジェクトで4回踏んでいる形
 * （`.claude/rules/typescript.md`）。
 *
 * 両方 0 のときに `-0` を作らない。`0 - 0` は `+0` なので素直に引けるが、
 * ここが将来 `-(expense - income)` の形に書き換わると `-0` が生まれる。
 */
export function netYen(total: Pick<PeriodTotal, "expenseYen" | "incomeYen">): number {
  return total.incomeYen - total.expenseYen;
}

/** 指定した月（"YYYY-MM"）の取引だけを取り出す */
export function inMonth(
  transactions: readonly StoredTransaction[],
  month: string,
): StoredTransaction[] {
  return transactions.filter((transaction) => monthOf(transaction.date) === month);
}

/**
 * `from` から `to` までの取引を取り出す。**両端を含む。**
 *
 * 日付は `"YYYY-MM-DD"` に正規化済み（`parseDate`）なので、文字列の比較が
 * そのまま日付の比較になる。`Date` に変換しないのは、変換するとタイムゾーンの
 * 解釈が入り込むため（`date-parts.ts` と同じ理由）。
 *
 * `from` が `to` より後なら空になる。「範囲が逆」を別のエラーにしない——
 * 入力欄で日付を2つ選ばせる以上その状態は普通に作れて、そのとき欲しいのは
 * 例外ではなく「該当なし」だから。
 */
export function inRange(
  transactions: readonly StoredTransaction[],
  from: string,
  to: string,
): StoredTransaction[] {
  return transactions.filter(
    (transaction) => transaction.date >= from && transaction.date <= to,
  );
}

/**
 * 指定したカテゴリの取引だけを取り出す。`null` は「絞り込まない」。
 *
 * 収入もカテゴリ（`"収入"`）を持つので、支出と同じ経路で絞れる。
 * 照合は完全一致。カテゴリ名はマスタから来る決まった文字列で、摘要のような
 * 表記の揺れが無い（揺れを畳むのは `normalizeDescription` の仕事）。
 */
export function inCategory(
  transactions: readonly StoredTransaction[],
  category: string | null,
): StoredTransaction[] {
  if (category === null) {
    return [...transactions];
  }
  return transactions.filter((transaction) => transaction.category === category);
}
