---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript / Node 固有のルール

- strict mode。`any` を使わない。境界（外部入力）では `unknown` で受けてから検証する
- テストランナーは Vitest。ミューテーションテストは Stryker
- 実行は `run-tests.sh` を正とする（`npm ci` → `tsc --noEmit` → `vitest run --coverage`
  → `stryker run`）。しきい値は `vitest.config.ts` / `stryker.config.mjs`
  （いずれも保護パス）で固定してあり、AIは下げられない
- Stryker が報告する生存ミュータントのうち、エラーメッセージ文字列の変異や、
  境界値で元の実装と観測可能な違いが出ない同値ミュータントは、無理に潰そうとしない
  （`clamp-number.ts` の `value < min` ↔ `value <= min` がその例：`value === min`
  ではどちらの分岐でも同じ `min` が返るため、原理的にどんなテストでも検知できない）
