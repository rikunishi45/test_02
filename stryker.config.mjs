// 保護パス。thresholds は Stryker の仕様上 CLI からは上書きできず、
// この設定ファイルにしか書けない（公式ドキュメントで確認済み）。
// break を下回ると run-tests.sh が非ゼロ終了する。AIはこのファイルを直接編集できない。
export default {
  mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  thresholds: {
    high: 80,
    low: 60,
    break: 70,
  },
  reporters: ["clear-text", "progress"],
};
