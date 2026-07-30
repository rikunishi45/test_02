#!/usr/bin/env bash
#
# src/ に対する壁の定義。保護パスなので、ここに書いた下限はAIが下げられない。
# テスト本体（tests/）は保護しないので自由に追加・修正してよい。
#
# 版を固定する。固定しないと外部要因でCIがランダムに赤くなり、
# 「テストが失敗した」と区別がつかなくなる。
#
set -euo pipefail

pip install -q pytest==8.3.4 pytest-cov==6.0.0
pytest tests/ --cov=src --cov-fail-under=80
