import { daysInMonth } from "../domain/date-parts.js";
import { monthOf, shiftMonth } from "../aggregate/period.js";
import { normalizeDescription } from "../category/normalize.js";
import type { StoredTransaction } from "../storage/schema.js";

/** 固定費とみなすのに必要な月数 */
export const MIN_MONTHS = 3;

/**
 * 代表額からのずれの許容幅。
 *
 * サブスクは毎月まったく同額なので、本来は 0 でも拾える。幅を持たせるのは
 * 携帯料金のような「ほぼ固定」を取るため。**季節で倍近く振れる公共料金は
 * この幅から外れて落ちる。** 拾いすぎる側に倒さないのは、固定費の一覧に
 * 変動費が混ざると一覧そのものが読まれなくなるため。
 */
export const AMOUNT_TOLERANCE = 0.2;

export interface RecurringCharge {
  /** 表示用の摘要。直近の取引のもの（正規化前） */
  description: string;
  /** 観測できた月数 */
  monthCount: number;
  /** 直近の発生日 "YYYY-MM-DD" */
  lastDate: string;
  /** 毎月の代表額。**正の数** */
  typicalYen: number;
  /** 次に落ちる予定日 "YYYY-MM-DD" */
  nextDate: string;
}

interface Occurrence {
  month: string;
  date: string;
  description: string;
  /** 支出の大きさ。正の数 */
  amountYen: number;
}

/**
 * 毎月ほぼ同額で落ちている支出を拾う。
 *
 * 判定は次の4つを**すべて**満たすこと。ひとつでも外れたら固定費とみなさない。
 *
 * 1. 支出であること（収入と 0 円は対象外）
 * 2. 同じ月に2回以上現れないこと。固定費は月1回落ちる。この条件がコンビニや
 *    スーパーのような「毎月来るが固定費ではない」摘要をまとめて落とす
 * 3. 現れた月が `MIN_MONTHS` 以上、かつ**連続している**こと。飛びがあれば
 *    毎月の請求ではない
 * 4. 各月の額が代表額の ±`AMOUNT_TOLERANCE` に収まること
 *
 * `throughMonth`（"YYYY-MM"、通常は今月）を取るのは、解約済みの契約を
 * 出し続けないため。直近の発生が今月か先月でなければ落とす。先月を許すのは、
 * 月初にはまだ当月分が落ちていないから。
 *
 * 摘要は `normalizeDescription` で畳んでから突き合わせる。カード明細は全角・
 * 半角カナが揺れるので、生の文字列で数えると同じ契約が別々に数えられる。
 */
export function detectRecurring(
  transactions: readonly StoredTransaction[],
  throughMonth: string,
): RecurringCharge[] {
  const groups = new Map<string, Occurrence[]>();

  for (const transaction of transactions) {
    if (transaction.amountYen >= 0) {
      continue;
    }
    const key = normalizeDescription(transaction.description);
    const occurrence: Occurrence = {
      month: monthOf(transaction.date),
      date: transaction.date,
      description: transaction.description,
      amountYen: -transaction.amountYen,
    };
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [occurrence]);
    } else {
      group.push(occurrence);
    }
  }

  const charges: RecurringCharge[] = [];
  for (const group of groups.values()) {
    const charge = toCharge(group, throughMonth);
    if (charge !== null) {
      charges.push(charge);
    }
  }

  // 額の大きい順。同額は摘要の昇順で決着させる（sumByCategory と同じ方針で、
  // 取引を1件足しただけで並びが入れ替わるのを防ぐ）。
  return charges.sort(
    (a, b) => b.typicalYen - a.typicalYen || a.description.localeCompare(b.description),
  );
}

/**
 * 固定費の月あたりの合計。**正の数**で返す（`typicalYen` と揃える）。
 *
 * 1行の `reduce` だが画面には置かない。`src/ui/` は壁の外なので、合計が
 * 狂っても誰も気づけない（`.claude/rules/typescript.md`）。
 */
export function totalMonthlyYen(charges: readonly RecurringCharge[]): number {
  return charges.reduce((sum, charge) => sum + charge.typicalYen, 0);
}

function toCharge(group: readonly Occurrence[], throughMonth: string): RecurringCharge | null {
  const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
  const months = sorted.map((occurrence) => occurrence.month);

  if (months.length < MIN_MONTHS) {
    return null;
  }
  for (let i = 1; i < months.length; i += 1) {
    // 同じ月の2件目もここで落ちる（shiftMonth は必ず違う月を返すため）。
    if (shiftMonth(months[i - 1]!, 1) !== months[i]!) {
      return null;
    }
  }

  const last = sorted[sorted.length - 1]!;
  if (last.month !== throughMonth && shiftMonth(last.month, 1) !== throughMonth) {
    return null;
  }

  const typicalYen = median(sorted.map((occurrence) => occurrence.amountYen));
  for (const occurrence of sorted) {
    if (
      occurrence.amountYen < typicalYen * (1 - AMOUNT_TOLERANCE) ||
      occurrence.amountYen > typicalYen * (1 + AMOUNT_TOLERANCE)
    ) {
      return null;
    }
  }

  return {
    description: last.description,
    monthCount: months.length,
    lastDate: last.date,
    typicalYen,
    nextDate: sameDayNextMonth(last.date),
  };
}

/**
 * 中央値。偶数個なら小さい側を取る。
 *
 * 2つの平均を取ると円未満が出て、代表額が整数でなくなる。金額は整数の円で
 * 持つ約束なので（`domain/transaction.ts`）、丸めを増やさず片方を選ぶ。
 */
function median(amounts: readonly number[]): number {
  const sorted = [...amounts].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * 翌月の同じ日。**その日が翌月に無ければ月末に寄せる。**
 *
 * 1月31日の翌月を「2月31日」にすると、存在しない日付が画面に出る。
 * `Date` に足させると2月31日は3月3日に繰り上がるので、月をまたいでしまい
 * 「次に落ちる予定」としては嘘になる。`daysInMonth` で切り詰める。
 */
function sameDayNextMonth(date: string): string {
  const month = shiftMonth(monthOf(date), 1);
  const day = Math.min(
    Number(date.slice(8, 10)),
    daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))),
  );
  return `${month}-${String(day).padStart(2, "0")}`;
}
