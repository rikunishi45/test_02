import type { ImportRowStatus } from "./classify-duplicates.js";

/**
 * 取り込みプレビューで、その行を取り込む対象にするか。
 *
 * 新規は既定で取り込み、重複候補は既定で取り込まない。人間が行ごとに
 * 切り替えた（toggled）場合は既定を反転する。
 *
 * 画面側に書くと壁（カバレッジ・ミューテーションテスト）の外に出るので、
 * 判定はここに置く。src/ui/ にはこの関数を呼ぶだけを残す。
 */
export function isSelectedForImport(status: ImportRowStatus, toggled: boolean): boolean {
  const selectedByDefault = status === "new";
  return toggled ? !selectedByDefault : selectedByDefault;
}
