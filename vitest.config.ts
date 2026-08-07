import { defineConfig } from "vitest/config";

// 保護パス。カバレッジしきい値はここでしか定義できない
// （CLIフラグでの上書きが確証できなかったため安全側に倒している）。
// run-tests.sh がこの設定でCIを回す。AIはこのファイルを直接編集できない。
//
// src/ui/ は壁の外に出してある。UIはこの環境で唯一、人間のレビューが実際に入る層で、
// 数字がおかしければ見て分かる。壁が守っているのは「見ても分からない誤り」
// （CSVの取りこぼし、うるう年、金額の丸め）で、それらは src/ui/ の外にあり、
// そちらのしきい値は一切下げていない。
//
// なお include の "src/**/*.ts" は .tsx にマッチしないので、React コンポーネントは
// 元から対象外だった。下の exclude が実際に外しているのは src/ui/ 配下の .ts
// （useDatabase.ts）だけ。この差はレビューで指摘されるまで気づいていなかった。
//
// 引き換えに「ロジックを src/ui/ に書けば壁を逃れられる」穴が開く。
// .claude/rules/typescript.md に禁止を明記してあるが、機械的な強制ではない。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/ui/**"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
