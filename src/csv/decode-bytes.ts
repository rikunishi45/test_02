/**
 * CSVファイルのバイト列を文字列にする。
 *
 * 日本の金融機関のCSVは Shift_JIS のことが多いが、楽天カードの明細は
 * BOM付きUTF-8だった（実データで確認）。どちらも来る前提で判定する。
 *
 * 判定は「UTF-8として厳密にデコードできるか」で行う。fatal: true にすると
 * 不正なバイト列で例外になるので、Shift_JIS のバイト列はここで弾かれる。
 * 逆にUTF-8として妥当なものをShift_JISと誤判定することはない。
 *
 * BOMは明示的に取り除いていない。TextDecoder が ignoreBOM を既定の false の
 * まま使うと先頭のBOMを自動で落とすため（実測で確認。ignoreBOM: true にすると
 * 残る）。自前で除去する分岐を書いたが一度も実行されず、ミューテーションテストに
 * 到達不能と指摘されたので消した。
 */
export function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}
