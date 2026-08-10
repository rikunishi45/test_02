import { describe, it, expect } from "vitest";
import type { CategoryRecord } from "../storage/schema.js";
import { UNCATEGORIZED } from "./classify.js";
import { UNCATEGORIZED_COLOR } from "./default-categories.js";
import { colorOf } from "./color.js";

const MASTER: CategoryRecord[] = [
  { name: "食費", color: "#111111", order: 0 },
  { name: "食", color: "#222222", order: 1 },
  { name: UNCATEGORIZED, color: "#333333", order: 2 },
];

describe("colorOf", () => {
  it("マスタにある名前はマスタの色を返す", () => {
    expect(colorOf(MASTER, "食費")).toBe("#111111");
  });

  it("名前は完全一致で引く。前方一致では別のカテゴリの色を返さない", () => {
    expect(colorOf(MASTER, "食")).toBe("#222222");
  });

  it("未分類の色を変えてあれば、変えたあとの色を返す", () => {
    expect(colorOf(MASTER, UNCATEGORIZED)).toBe("#333333");
  });

  it("マスタに無い名前は未分類の色にする", () => {
    expect(colorOf(MASTER, "存在しないカテゴリ")).toBe(UNCATEGORIZED_COLOR);
  });

  it("マスタを読み込む前（空）でも未分類の色を返す", () => {
    expect(colorOf([], "食費")).toBe(UNCATEGORIZED_COLOR);
  });
});
