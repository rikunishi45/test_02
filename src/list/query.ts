import { monthOf } from "../aggregate/period.js";
import { normalizeDescription } from "../category/normalize.js";
import type { TransactionSource } from "../domain/transaction.js";
import type { StoredTransaction } from "../storage/schema.js";

/** 支出か収入か。0円は支出に寄せる（`toManualEntryInput` と同じ向き） */
export type TransactionKind = "expense" | "income";

/**
 * 一覧の絞り込み条件。**`null` と空文字列は「絞り込まない」。**
 *
 * 「絞り込まない」を別のフラグで持たせない。条件とフラグの2つを持つと、
 * 「カテゴリは食費だが絞り込みは無効」という状態が作れてしまい、画面と結果の
 * どちらが正しいのか決められなくなる。
 */
export interface TransactionQuery {
  /** 摘要とメモに対する部分一致。空なら絞り込まない */
  text: string;
  category: string | null;
  source: TransactionSource | null;
  kind: TransactionKind | null;
  /** `"YYYY-MM"` */
  month: string | null;
}

/** 何も絞り込まない状態 */
export const NO_QUERY: TransactionQuery = {
  text: "",
  category: null,
  source: null,
  kind: null,
  month: null,
};

/**
 * 検索の照合用に畳む。`normalizeDescription`（NFKC + 空白の正規化）に
 * **小文字化を足したもの。**
 *
 * 実データの摘要は全角英数（`ＶＩＳＡ海外利用`）で入っている。NFKC が
 * `VISA` に畳むので、これを通せば `visa` でも `ＶＩＳＡ` でも同じ行に当たる。
 *
 * `normalizeDescription` 側に小文字化を足さないのは、あちらがカテゴリ規則の
 * 照合に使われていて、規則は正規化後の形に合わせて書かれているため
 * （大文字を前提にした規則が静かに当たらなくなる）。
 */
export function normalizeForSearch(text: string): string {
  return normalizeDescription(text).toLowerCase();
}

/**
 * 検索語が摘要かメモに当たるか。
 *
 * **空白で区切った語はすべて満たす必要がある（AND）。** `visa netflix` で
 * 「ＶＩＳＡ国内利用 ＶＳ ネットフリックス」に当てたい。OR にすると語を足す
 * ほど結果が増えて、絞り込みとして働かない。
 *
 * 語の順序は問わない。摘要の語順はカード会社の書式で決まっていて、人間が
 * 打つ順と一致しない。
 *
 * 空の検索語に対する早期 return は持たない。`normalizeForSearch` が空白を畳んで
 * 前後を落とすので、空文字列を割ると `[""]` の1語になり、`includes("")` が真に
 * なって全件に当たる——空語を落とす分岐も「空なら true」の分岐も、結果を1つも
 * 変えない（Stryker で生存ミュータントとして出た）。
 */
export function matchesText(transaction: StoredTransaction, text: string): boolean {
  const haystack = `${normalizeForSearch(transaction.description)} ${normalizeForSearch(
    transaction.memo,
  )}`;
  return normalizeForSearch(text)
    .split(" ")
    .every((term) => haystack.includes(term));
}

/** 取引が支出か収入か。0円と -0 は支出（`-0 < 0` は偽なので「正なら収入」で書く） */
export function kindOf(transaction: StoredTransaction): TransactionKind {
  return transaction.amountYen > 0 ? "income" : "expense";
}

/** 1件が条件をすべて満たすか */
export function matchesQuery(transaction: StoredTransaction, query: TransactionQuery): boolean {
  if (query.category !== null && transaction.category !== query.category) {
    return false;
  }
  if (query.source !== null && transaction.source !== query.source) {
    return false;
  }
  if (query.kind !== null && kindOf(transaction) !== query.kind) {
    return false;
  }
  if (query.month !== null && monthOf(transaction.date) !== query.month) {
    return false;
  }
  return matchesText(transaction, query.text);
}

/**
 * 条件に合う取引だけを、一覧の並び順で返す。
 *
 * **並び替えまでをここで済ませる。** 絞り込みと並び替えを別々に呼ぶ形にすると、
 * ページ送りが「絞り込み済みだが未整列の配列」を切り出せてしまう。並び順が
 * 決まっていない集合を切ると、同じページに同じ行が出たり、どのページにも
 * 出ない行ができる。
 */
export function queryTransactions(
  transactions: readonly StoredTransaction[],
  query: TransactionQuery,
): StoredTransaction[] {
  return sortForList(transactions.filter((transaction) => matchesQuery(transaction, query)));
}

/**
 * 一覧の並び順。日付の新しい順、同じ日付なら id の昇順。
 *
 * **同着を id で決着させる。** 日付だけで並べると、同じ日の行の順序が入力順
 * （IndexedDB が返す順）に依存する。1件足しただけで順序が変わると、ページを
 * またいだときに行が重複したり消えたりする。
 */
export function sortForList(transactions: readonly StoredTransaction[]): StoredTransaction[] {
  return [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
}
