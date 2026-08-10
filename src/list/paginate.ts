/**
 * 1ページの件数。
 *
 * 実データは3か月で138件。50件なら3ページで、月をまたいで眺めるのに
 * ページ送りが邪魔にならない。
 */
export const PER_PAGE = 50;

/**
 * ページ数。**0件でも 1 を返す。**
 *
 * 0 を返すと「0 / 0 ページ」と出る。絞り込んだ結果が空なのは正常な状態で、
 * そこに 0 ページ目という存在しない位置を作らない。ページ番号は常に
 * 1〜`pageCount` の中にある、という約束をここで閉じる。
 */
export function pageCount(total: number, perPage: number): number {
  if (total <= 0) {
    return 1;
  }
  return Math.ceil(total / perPage);
}

/**
 * ページ番号を 1〜`pageCount` に収める。
 *
 * **絞り込むと総数が減る。** 3ページ目を見ている状態で条件を足すと、行が
 * 1ページ分しか残らないことがある。そのまま3ページ目を切り出すと空の表が
 * 出て、絞り込みで0件になったのか、ページが行き過ぎただけなのかが画面から
 * 読めない。最後のページに寄せる。
 */
export function clampPage(page: number, total: number, perPage: number): number {
  const last = pageCount(total, perPage);
  if (!Number.isFinite(page)) {
    return 1;
  }
  return Math.min(Math.max(Math.trunc(page), 1), last);
}

/**
 * `page` ページ目（1起点）を切り出す。範囲外のページは丸めてから切る。
 *
 * 丸めを呼び出し側に任せない。任せると「clampPage を呼び忘れたときだけ空
 * ページが出る」という、画面を見ても原因の分からない不具合になる。
 */
export function pageSlice<T>(items: readonly T[], page: number, perPage: number): T[] {
  const safe = clampPage(page, items.length, perPage);
  const start = (safe - 1) * perPage;
  return items.slice(start, start + perPage);
}

/** 「n〜m 件目」の表示に使う範囲。0件なら両方 0 */
export function pageRange(
  total: number,
  page: number,
  perPage: number,
): { first: number; last: number } {
  if (total <= 0) {
    return { first: 0, last: 0 };
  }
  const safe = clampPage(page, total, perPage);
  const first = (safe - 1) * perPage + 1;
  return { first, last: Math.min(first + perPage - 1, total) };
}
