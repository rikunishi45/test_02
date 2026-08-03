export type TransactionSource = "card" | "bank" | "cash";

export interface Transaction {
  /** ISO 8601 の日付（YYYY-MM-DD）。時刻は持たない */
  date: string;
  /**
   * 符号付き整数の円。支出が負、収入が正（元帳の慣習）。
   * 円は補助単位を持たないので整数で表現でき、浮動小数点の誤差が入らない。
   * 集計は単純な加算で済み、絶対値が要るのは表示側だけ。
   */
  amountYen: number;
  /** 加盟店名・摘要 */
  description: string;
  source: TransactionSource;
}
