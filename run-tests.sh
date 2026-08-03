#!/usr/bin/env bash
#
# src/ に対する壁の定義。保護パスなので、ここに書いた実行順序と、
# vitest.config.ts / stryker.config.mjs（どちらも保護パス）に書いた閾値は
# AIが下げられない。テスト本体（src/**/*.test.ts）は保護しないので自由に
# 追加・修正してよい。
#
# npm test のような package.json 経由の間接呼び出しは使わない。package.json
# は非保護パスなので、scripts を差し替えることで壁を迂回できてしまう。
# npx で直接コマンドを呼ぶことで、この迂回路を作らない。
#
# --ignore-scripts: package.json / package-lock.json は保護パスにしてあるが、
# 依存パッケージ自体が持つ postinstall 等のライフサイクルスクリプトまでは
# 保護できない。npm ci 時にそれらを実行させないことで、依存インストール経由の
# 任意コード実行を塞ぐ。
#
set -euo pipefail

npm ci --ignore-scripts
npx tsc --noEmit
npx vitest run --coverage
npx stryker run
