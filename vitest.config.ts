import { defineConfig } from "vitest/config";

// 保護パス。カバレッジしきい値はここでしか定義できない
// （CLIフラグでの上書きが確証できなかったため安全側に倒している）。
// run-tests.sh がこの設定でCIを回す。AIはこのファイルを直接編集できない。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
