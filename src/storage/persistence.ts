/**
 * 永続化の要求結果。
 *
 * `denied` と `unsupported` を分けるのは、画面に出す案内が違うため。前者は
 * ブラウザが判断して断った状態で、使い続ければ許可されることがある。後者は
 * 要求する経路自体が無い（`persist()` は secure context でしか使えない）。
 */
export type PersistenceState = "persisted" | "denied" | "unsupported";

/**
 * IndexedDB の永続化をブラウザに要求する。
 *
 * 要求しないと、IndexedDB はストレージ逼迫時にブラウザの判断で退避され得る。
 * このアプリのデータはIndexedDBが正本で、手動入力とカテゴリの修正は元CSVから
 * 復元できない。**2026-08-09 に検証用ブラウザで全ストアが消える事象が起きている。**
 *
 * `persisted()` を先に呼んで分岐しない。`persist()` は既に許可済みなら `true` を
 * 返すので、二段構えにしても結果は変わらず分岐が増えるだけ。
 *
 * `navigator` から直接読まずに引数で受け取る。壁の中のコードがブラウザの
 * グローバルに触ると、テストが実行環境に依存する。
 */
export async function requestPersistence(
  storage: StorageManager | undefined,
): Promise<PersistenceState> {
  // secure context でなければ navigator.storage 自体が無く、古い実装では
  // persist だけ欠けることがある（MDNの例と同じ形の機能検査）。
  if (storage === undefined || typeof storage.persist !== "function") {
    return "unsupported";
  }

  return (await storage.persist()) ? "persisted" : "denied";
}
