// 保護パス。thresholds は Stryker の仕様上 CLI からは上書きできず、
// この設定ファイルにしか書けない（公式ドキュメントで確認済み）。
// break を下回ると run-tests.sh が非ゼロ終了する。AIはこのファイルを直接編集できない。
//
// src/ui/ は mutate の対象から外してある。理由は vitest.config.ts のコメントに
// 書いた通り。加えてミューテーションテストはJSXと相性が悪い——"取り込む" を "" に
// 変える変異を殺すにはラベル文言を厳密検査するテストが要り、文言を変えるたびに
// テストが壊れる。
//
// ただし "src/**/*.ts" は .tsx にマッチしないので、React コンポーネントは元から
// 対象外。下の除外が実際に効くのは src/ui/ 配下の .ts に対してだけ。
export default {
  mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/ui/**"],
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  thresholds: {
    high: 80,
    low: 60,
    break: 70,
  },
  reporters: ["clear-text", "progress"],
};
