import { describe, it, expect } from "vitest";
import { INCOME, UNCATEGORIZED, type CategoryRule } from "./classify.js";
import type { CategoryRecord } from "../storage/schema.js";
import {
  defaultCategories,
  CATEGORY_PALETTE,
  INCOME_COLOR,
  UNCATEGORIZED_COLOR,
} from "./default-categories.js";
import { DEFAULT_CATEGORY_RULES } from "./default-rules.js";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const paletteSize = CATEGORY_PALETTE.length;

function rule(category: string, pattern = `pattern:${category}`): CategoryRule {
  return { pattern, category };
}

/**
 * n 件のルール。カテゴリ名は 0 埋めした連番なので、記述順・昇順・パレットの
 * 割り当て順の3つを混同せずに突き合わせられる（ASCII なので localeCompare の
 * 結果がロケール実装に依らない）。
 */
function labeledRules(count: number): CategoryRule[] {
  return Array.from({ length: count }, (_, i) => rule(`c${String(i).padStart(2, "0")}`));
}

function namesOf(records: readonly CategoryRecord[]): string[] {
  return records.map((record) => record.name);
}

function colorsOf(records: readonly CategoryRecord[]): string[] {
  return records.map((record) => record.color);
}

/** 収入・未分類を除いた支出カテゴリ。パレットの割り当て対象はここだけ */
function expensesOf(records: readonly CategoryRecord[]): CategoryRecord[] {
  return records.filter(
    (record) => record.name !== INCOME && record.name !== UNCATEGORIZED,
  );
}

/** 名前で1件だけ取る。2件あれば（＝重複していれば）ここで落ちる */
function only(records: readonly CategoryRecord[], name: string): CategoryRecord {
  const found = records.filter((record) => record.name === name);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("CATEGORY_PALETTE", () => {
  it("8色ある（初期カテゴリの数以上であること）", () => {
    expect(CATEGORY_PALETTE).toHaveLength(8);
  });

  it("すべて #rrggbb 形式", () => {
    for (const color of CATEGORY_PALETTE) {
      expect(color).toMatch(HEX_COLOR);
    }
  });
});

describe("INCOME_COLOR / UNCATEGORIZED_COLOR", () => {
  it.each<[string, string]>([
    ["INCOME_COLOR", INCOME_COLOR],
    ["UNCATEGORIZED_COLOR", UNCATEGORIZED_COLOR],
  ])("%s は #rrggbb 形式", (_label, color) => {
    expect(color).toMatch(HEX_COLOR);
  });

  it.each<[string, string]>([
    ["INCOME_COLOR", INCOME_COLOR],
    ["UNCATEGORIZED_COLOR", UNCATEGORIZED_COLOR],
  ])("%s は支出のパレットのどの色とも重ならない", (_label, color) => {
    expect([...CATEGORY_PALETTE]).not.toContain(color);
  });
});

/**
 * 実際にこれで壊れた：パレットが7色・初期カテゴリが8件だったとき、8番目の
 * 「食費」が「サブスク」と同色になり、**支出が最大のカテゴリが円グラフで
 * 別物と見分けられない**状態で出ていた。型でもカバレッジでも捕まらないので、
 * 「初期状態に同じ色が2つ出ない」を不変条件として固定する。
 */
describe("実際のルールから作った初期値", () => {
  const initial = defaultCategories(DEFAULT_CATEGORY_RULES);

  it("色がすべて異なる", () => {
    const colors = initial.map((category) => category.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("パレットが初期カテゴリの数以上ある（足りないと色が巡って重なる）", () => {
    const spending = initial.filter(
      (category) => category.name !== INCOME && category.name !== UNCATEGORIZED,
    );
    expect(spending.length).toBeLessThanOrEqual(CATEGORY_PALETTE.length);
  });

  it("名前がすべて異なる（ストアの主キーが name なので、重なると黙って上書きされる）", () => {
    const names = initial.map((category) => category.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("defaultCategories", () => {
  describe("空のルール", () => {
    it("収入と未分類の2件だけを、その順で返す", () => {
      expect(defaultCategories([])).toEqual([
        { name: INCOME, color: INCOME_COLOR, order: 0 },
        { name: UNCATEGORIZED, color: UNCATEGORIZED_COLOR, order: 1 },
      ]);
    });
  });

  describe("ルール1件", () => {
    it("支出1件 + 収入 + 未分類 の3件を返す", () => {
      expect(defaultCategories([rule("食費")])).toEqual([
        { name: "食費", color: CATEGORY_PALETTE[0], order: 0 },
        { name: INCOME, color: INCOME_COLOR, order: 1 },
        { name: UNCATEGORIZED, color: UNCATEGORIZED_COLOR, order: 2 },
      ]);
    });

    it("要素は name / color / order の3項目だけを持つ", () => {
      for (const record of defaultCategories([rule("食費")])) {
        expect(Object.keys(record).sort()).toEqual(["color", "name", "order"]);
      }
    });
  });

  describe("同じカテゴリを指すルールが複数あっても1件にまとまる", () => {
    it("パターン違いの3ルールが同じカテゴリなら、支出は1件", () => {
      const result = defaultCategories([
        rule("食費", "セブンイレブン"),
        rule("食費", "ローソン"),
        rule("食費", "ファミリーマート"),
      ]);

      expect(namesOf(result)).toEqual(["食費", INCOME, UNCATEGORIZED]);
      expect(only(result, "食費").order).toBe(0);
    });

    it("重複を含んでも、異なるカテゴリは全部残る", () => {
      const result = defaultCategories([
        rule("banana", "b1"),
        rule("apple", "a1"),
        rule("banana", "b2"),
        rule("cherry", "c1"),
        rule("apple", "a2"),
      ]);

      expect(namesOf(result)).toEqual([
        "apple",
        "banana",
        "cherry",
        INCOME,
        UNCATEGORIZED,
      ]);
    });

    it("まったく同じルールが2本あっても1件", () => {
      const same = rule("食費", "セブンイレブン");
      expect(namesOf(defaultCategories([same, { ...same }]))).toEqual([
        "食費",
        INCOME,
        UNCATEGORIZED,
      ]);
    });
  });

  describe("並び順は名前の昇順（ルールの記述順に依存しない）", () => {
    it("記述順が降順でも、結果は昇順になる", () => {
      const result = defaultCategories([
        rule("cherry"),
        rule("banana"),
        rule("apple"),
      ]);
      expect(namesOf(expensesOf(result))).toEqual(["apple", "banana", "cherry"]);
    });

    it("記述順を入れ替えても、同じ結果になる", () => {
      const ascending = defaultCategories([rule("apple"), rule("banana"), rule("cherry")]);
      const descending = defaultCategories([
        rule("cherry"),
        rule("banana"),
        rule("apple"),
      ]);
      const shuffled = defaultCategories([rule("banana"), rule("cherry"), rule("apple")]);

      expect(descending).toEqual(ascending);
      expect(shuffled).toEqual(ascending);
    });

    it("記述順に並べたのでは説明できない位置に入る（先頭のルールが末尾に来る）", () => {
      const result = defaultCategories([rule("zzz"), rule("mmm"), rule("aaa")]);
      expect(namesOf(expensesOf(result))).toEqual(["aaa", "mmm", "zzz"]);
    });

    it("日本語のカテゴリ名でも、隣り合う要素が localeCompare で昇順になっている", () => {
      const result = expensesOf(
        defaultCategories([
          rule("日用品"),
          rule("交通費"),
          rule("食費"),
          rule("住居費"),
          rule("娯楽費"),
        ]),
      );

      expect(result).toHaveLength(5);
      for (let i = 1; i < result.length; i += 1) {
        expect(result[i - 1]!.name.localeCompare(result[i]!.name)).toBeLessThan(0);
      }
    });

    it.each<[string, CategoryRule[]]>([
      ["空", []],
      ["支出1件", [rule("食費")]],
      ["支出が昇順で末尾に来る名前", [rule("zzz"), rule("aaa")]],
      ["支出が多数", labeledRules(10)],
    ])("%s のとき、末尾の2件は 収入 → 未分類 の順", (_label, rules) => {
      const result = defaultCategories(rules);
      expect(namesOf(result).slice(-2)).toEqual([INCOME, UNCATEGORIZED]);
    });
  });

  describe("収入・未分類がルールに紛れ込んでいても二重にならない", () => {
    it.each<[string, CategoryRule[]]>([
      ["収入だけを含む", [rule(INCOME, "給与")]],
      ["未分類だけを含む", [rule(UNCATEGORIZED, "不明")]],
      ["両方を含む", [rule(INCOME, "給与"), rule(UNCATEGORIZED, "不明")]],
    ])("%s ルールでも、結果は 収入 → 未分類 の2件だけ", (_label, rules) => {
      expect(defaultCategories(rules)).toEqual([
        { name: INCOME, color: INCOME_COLOR, order: 0 },
        { name: UNCATEGORIZED, color: UNCATEGORIZED_COLOR, order: 1 },
      ]);
    });

    it("支出と混ざっていても、収入・未分類は末尾に1件ずつ", () => {
      const result = defaultCategories([
        rule(UNCATEGORIZED, "不明"),
        rule("食費", "セブン"),
        rule(INCOME, "給与"),
      ]);

      expect(result).toEqual([
        { name: "食費", color: CATEGORY_PALETTE[0], order: 0 },
        { name: INCOME, color: INCOME_COLOR, order: 1 },
        { name: UNCATEGORIZED, color: UNCATEGORIZED_COLOR, order: 2 },
      ]);
    });

    it("収入・未分類を指すルールが何本あっても、それぞれ1件", () => {
      const result = defaultCategories([
        rule(INCOME, "給与"),
        rule(INCOME, "賞与"),
        rule(UNCATEGORIZED, "不明1"),
        rule(UNCATEGORIZED, "不明2"),
        rule("食費", "セブン"),
      ]);

      expect(only(result, INCOME).color).toBe(INCOME_COLOR);
      expect(only(result, UNCATEGORIZED).color).toBe(UNCATEGORIZED_COLOR);
      expect(result).toHaveLength(3);
    });

    it("収入・未分類にはパレットの色を使わない（支出0件でも先頭色にならない）", () => {
      const result = defaultCategories([rule(INCOME, "給与"), rule(UNCATEGORIZED, "不明")]);

      expect(only(result, INCOME).color).toBe(INCOME_COLOR);
      expect(only(result, UNCATEGORIZED).color).toBe(UNCATEGORIZED_COLOR);
    });
  });

  describe("order は 0 から始まる連番", () => {
    it.each<[string, CategoryRule[]]>([
      ["空", []],
      ["支出1件", [rule("食費")]],
      ["支出3件（重複あり）", [rule("b"), rule("a"), rule("b"), rule("c")]],
      ["パレットちょうどの支出", labeledRules(paletteSize)],
      ["パレットを超える支出", labeledRules(paletteSize * 2 + 3)],
      ["収入・未分類が紛れ込む", [rule(INCOME), rule("a"), rule(UNCATEGORIZED)]],
    ])("%s のとき、order が 0..n-1 で飛びも重複も無い", (_label, rules) => {
      const result = defaultCategories(rules);
      expect(result.map((record) => record.order)).toEqual(
        Array.from({ length: result.length }, (_, i) => i),
      );
    });

    it("収入・未分類の order は支出の連番の続きになる", () => {
      const result = defaultCategories(labeledRules(5));

      expect(only(result, INCOME).order).toBe(5);
      expect(only(result, UNCATEGORIZED).order).toBe(6);
    });
  });

  describe("name はすべて一意", () => {
    it.each<[string, CategoryRule[]]>([
      ["空", []],
      ["重複ルールだらけ", [rule("a"), rule("a"), rule("b"), rule("b"), rule("a")]],
      ["収入・未分類が紛れ込む", [rule(INCOME), rule(UNCATEGORIZED), rule(INCOME), rule("a")]],
      ["支出が多数", labeledRules(paletteSize * 2 + 1)],
    ])("%s のとき、name に重複が無い", (_label, rules) => {
      const names = namesOf(defaultCategories(rules));
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("色はパレットを並び順に割り当て、尽きたら先頭に戻る", () => {
    it("パレットちょうどの数なら、パレットの全色が並び順どおりに1回ずつ付く", () => {
      const result = expensesOf(defaultCategories(labeledRules(paletteSize)));

      expect(result).toHaveLength(paletteSize);
      expect(colorsOf(result)).toEqual([...CATEGORY_PALETTE]);
    });

    it("パレット長を1つ超えると、超えた1件だけが先頭色に戻る（境界）", () => {
      const result = expensesOf(defaultCategories(labeledRules(paletteSize + 1)));

      expect(colorsOf(result)).toEqual([...CATEGORY_PALETTE, CATEGORY_PALETTE[0]]);
      expect(result[paletteSize - 1]!.color).toBe(CATEGORY_PALETTE[paletteSize - 1]);
      expect(result[paletteSize]!.color).toBe(CATEGORY_PALETTE[0]);
    });

    it("パレット長ちょうどの位置では、まだ先頭色に戻らない（境界の内側）", () => {
      const result = expensesOf(defaultCategories(labeledRules(paletteSize)));
      expect(result[paletteSize - 1]!.color).toBe(CATEGORY_PALETTE[paletteSize - 1]);
    });

    it("2周してさらに1件なら、[パレット, パレット, 先頭色] になる", () => {
      const result = expensesOf(defaultCategories(labeledRules(paletteSize * 2 + 1)));

      expect(colorsOf(result)).toEqual([
        ...CATEGORY_PALETTE,
        ...CATEGORY_PALETTE,
        CATEGORY_PALETTE[0],
      ]);
    });

    it("色は名前の昇順に沿って付く（ルールの記述順ではない）", () => {
      const result = defaultCategories([rule("bbb"), rule("aaa")]);

      expect(only(result, "aaa").color).toBe(CATEGORY_PALETTE[0]);
      expect(only(result, "bbb").color).toBe(CATEGORY_PALETTE[1]);
    });

    it("支出が多くても、収入・未分類の色はパレットに巻き込まれない", () => {
      const result = defaultCategories(labeledRules(paletteSize * 2 + 3));

      expect(only(result, INCOME).color).toBe(INCOME_COLOR);
      expect(only(result, UNCATEGORIZED).color).toBe(UNCATEGORIZED_COLOR);
    });
  });

  describe("入力を書き換えない", () => {
    it("凍結したルール配列とその要素を渡しても、書き換えを試みない", () => {
      const rules = [rule("banana"), rule("apple"), rule("banana")];
      rules.forEach((value) => Object.freeze(value));
      Object.freeze(rules);

      expect(() => defaultCategories(rules)).not.toThrow();
    });

    it("呼び出しの前後で、ルールの内容も並び順も変わらない", () => {
      const rules = [rule("cherry"), rule("apple"), rule("banana")];
      const snapshot = structuredClone(rules);

      defaultCategories(rules);

      expect(rules).toEqual(snapshot);
    });

    it("空配列を凍結して渡しても、書き換えを試みない", () => {
      expect(() => defaultCategories(Object.freeze([]))).not.toThrow();
    });
  });
});
