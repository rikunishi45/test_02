import { describe, it, expect } from "vitest";
import { INCOME, UNCATEGORIZED } from "../category/classify.js";
import type { StoredTransaction } from "../storage/schema.js";
import { compareByCategory, expenseDeltaYen, type CategoryComparison } from "./compare.js";

const BASE: StoredTransaction = {
  id: "t-000",
  date: "2026-07-15",
  amountYen: -1000,
  description: "店",
  source: "card",
  category: "食費",
  memo: "",
};

let sequence = 0;

function tx(category: string, amountYen: number): StoredTransaction {
  sequence += 1;
  return { ...BASE, id: `t-${sequence}`, category, amountYen };
}

/** 支出をカテゴリごとに1件ずつ作る */
function spend(entries: Record<string, number>): StoredTransaction[] {
  return Object.entries(entries).map(([category, yen]) => tx(category, -yen));
}

function rowOf(rows: readonly CategoryComparison[], category: string): CategoryComparison {
  const found = rows.find((row) => row.category === category);
  if (found === undefined) {
    throw new Error(`${category} の行が無い（実際: ${rows.map((r) => r.category).join(",")}）`);
  }
  return found;
}

function categoriesOf(rows: readonly CategoryComparison[]): string[] {
  return rows.map((row) => row.category);
}

describe("compareByCategory", () => {
  describe("突き合わせ", () => {
    it("両方にあるカテゴリは、今期・前期・差が並ぶ", () => {
      const rows = compareByCategory(spend({ 食費: 5000 }), spend({ 食費: 3000 }));

      expect(rowOf(rows, "食費")).toEqual({
        category: "食費",
        expenseYen: 5000,
        previousYen: 3000,
        deltaYen: 2000,
      });
    });

    it("減っていれば差が負になる", () => {
      const rows = compareByCategory(spend({ 食費: 3000 }), spend({ 食費: 5000 }));

      expect(rowOf(rows, "食費").deltaYen).toBe(-2000);
    });

    it("同額なら差が 0", () => {
      const rows = compareByCategory(spend({ 食費: 3000 }), spend({ 食費: 3000 }));

      expect(rowOf(rows, "食費").deltaYen).toBe(0);
    });

    it("今期にしか無いカテゴリは前期 0 で、差は今期の額そのもの", () => {
      const rows = compareByCategory(spend({ 医療: 2000 }), spend({ 食費: 3000 }));

      expect(rowOf(rows, "医療")).toEqual({
        category: "医療",
        expenseYen: 2000,
        previousYen: 0,
        deltaYen: 2000,
      });
    });

    // 使わなくなったカテゴリが一覧から消えると、「減った」ことに気づけない。
    it("前期にしか無いカテゴリも残る（今期 0 の行になる）", () => {
      const rows = compareByCategory(spend({ 食費: 3000 }), spend({ 娯楽: 4000 }));

      expect(rowOf(rows, "娯楽")).toEqual({
        category: "娯楽",
        expenseYen: 0,
        previousYen: 4000,
        deltaYen: -4000,
      });
    });

    it("両方に無いカテゴリは現れない", () => {
      const rows = compareByCategory(spend({ 食費: 3000 }), spend({ 娯楽: 4000 }));

      expect(categoriesOf(rows)).not.toContain("交通費");
    });

    it("同じカテゴリの複数件はまとまる", () => {
      const current = [tx("食費", -1000), tx("食費", -2000)];

      expect(rowOf(compareByCategory(current, []), "食費").expenseYen).toBe(3000);
    });

    it("カテゴリは重複しない", () => {
      const rows = compareByCategory(spend({ 食費: 1000, 医療: 500 }), spend({ 食費: 800 }));

      expect(new Set(categoriesOf(rows)).size).toBe(rows.length);
    });
  });

  describe("空の入力", () => {
    it("両方空なら空", () => {
      expect(compareByCategory([], [])).toEqual([]);
    });

    it("今期だけ空なら、前期のカテゴリがすべて減少として並ぶ", () => {
      const rows = compareByCategory([], spend({ 食費: 3000, 医療: 500 }));

      expect(rows).toEqual([
        { category: "医療", expenseYen: 0, previousYen: 500, deltaYen: -500 },
        { category: "食費", expenseYen: 0, previousYen: 3000, deltaYen: -3000 },
      ]);
    });

    it("前期だけ空なら、今期のカテゴリがすべて増加として並ぶ", () => {
      const rows = compareByCategory(spend({ 食費: 3000 }), []);

      expect(rowOf(rows, "食費")).toEqual({
        category: "食費",
        expenseYen: 3000,
        previousYen: 0,
        deltaYen: 3000,
      });
    });
  });

  describe("収入は含まない", () => {
    it("今期の収入はカテゴリに現れない", () => {
      const current = [tx("食費", -1000), tx(INCOME, 250000)];

      expect(categoriesOf(compareByCategory(current, []))).toEqual(["食費"]);
    });

    it("前期の収入もカテゴリに現れない", () => {
      const previous = [tx(INCOME, 250000)];

      expect(compareByCategory([], previous)).toEqual([]);
    });

    it("収入があっても支出の額に混ざらない", () => {
      const current = [tx("食費", -1000), tx(INCOME, 250000)];

      expect(rowOf(compareByCategory(current, []), "食費").expenseYen).toBe(1000);
    });

    it("未分類は支出なので現れる", () => {
      const current = [tx(UNCATEGORIZED, -700)];

      expect(categoriesOf(compareByCategory(current, []))).toEqual([UNCATEGORIZED]);
    });
  });

  describe("並び順", () => {
    it("今期の支出が多い順", () => {
      const current = spend({ 食費: 1000, 医療: 3000, 娯楽: 2000 });

      expect(categoriesOf(compareByCategory(current, []))).toEqual(["医療", "娯楽", "食費"]);
    });

    it("同額はカテゴリ名の昇順", () => {
      const current = spend({ b: 1000, a: 1000, c: 1000 });

      expect(categoriesOf(compareByCategory(current, []))).toEqual(["a", "b", "c"]);
    });

    it("今期 0 の行（前期にしか無い）は末尾に集まる", () => {
      const rows = compareByCategory(spend({ 食費: 1000 }), spend({ 娯楽: 9000 }));

      expect(categoriesOf(rows)).toEqual(["食費", "娯楽"]);
    });

    it("今期 0 どうしはカテゴリ名の昇順（入力順に依存しない）", () => {
      const previous = spend({ b: 5000, a: 1000 });

      expect(categoriesOf(compareByCategory([], previous))).toEqual(["a", "b"]);
    });

    it("入力の順序を変えても同じ並びになる", () => {
      const current = spend({ 食費: 1000, 医療: 3000 });
      const previous = spend({ 娯楽: 2000 });

      expect(compareByCategory([...current].reverse(), [...previous].reverse())).toEqual(
        compareByCategory(current, previous),
      );
    });

    it("並びは差の大小では決まらない（今期の額で決まる）", () => {
      // 医療は差が大きいが今期の額は小さい
      const rows = compareByCategory(spend({ 食費: 5000, 医療: 100 }), spend({ 医療: 9000 }));

      expect(categoriesOf(rows)).toEqual(["食費", "医療"]);
    });
  });

  describe("差の整合", () => {
    it("すべての行で deltaYen が expenseYen − previousYen と一致する", () => {
      const rows = compareByCategory(
        spend({ 食費: 5000, 医療: 100 }),
        spend({ 食費: 3000, 娯楽: 700 }),
      );

      for (const row of rows) {
        expect(row.deltaYen).toBe(row.expenseYen - row.previousYen);
      }
    });

    it("今期と前期を入れ替えると差の符号が反転する", () => {
      const current = spend({ 食費: 5000 });
      const previous = spend({ 食費: 3000 });

      expect(rowOf(compareByCategory(previous, current), "食費").deltaYen).toBe(
        -rowOf(compareByCategory(current, previous), "食費").deltaYen,
      );
    });

    it("差の合計が、今期の合計と前期の合計の差と一致する", () => {
      const rows = compareByCategory(
        spend({ 食費: 5000, 医療: 100 }),
        spend({ 食費: 3000, 娯楽: 700 }),
      );
      const delta = rows.reduce((sum, row) => sum + row.deltaYen, 0);

      expect(delta).toBe(5100 - 3700);
    });

    it("同じ集合どうしなら、すべての差が 0", () => {
      const same = spend({ 食費: 5000, 医療: 100 });

      expect(compareByCategory(same, same).every((row) => row.deltaYen === 0)).toBe(true);
    });
  });

  describe("入力を書き換えない", () => {
    it("凍結された配列を渡しても動く", () => {
      const current = Object.freeze(spend({ 食費: 1000 })) as readonly StoredTransaction[];
      const previous = Object.freeze(spend({ 食費: 500 })) as readonly StoredTransaction[];

      expect(() => compareByCategory(current, previous)).not.toThrow();
    });

    it("呼び出しの前後で内容が変わらない", () => {
      const current = spend({ 食費: 1000 });
      const snapshot = structuredClone(current);

      compareByCategory(current, []);

      expect(current).toEqual(snapshot);
    });
  });
});

/**
 * 並び順の契約を、`sumByCategory` の戻り順に依存せずに固定する。
 *
 * `compareByCategory` は内部で `sumByCategory` を使っていて、その戻りは既に
 * 支出の降順に並んでいる。**それに寄りかかると、片方の並びが変わったときに
 * 静かに崩れる。** 並べ直しが効いていることをここで見る。
 */
describe("並び順は自前の比較で決まる", () => {
  it("多数のカテゴリでも今期の降順になる", () => {
    const current = spend({ a: 100, b: 900, c: 300, d: 700, e: 500 });

    expect(categoriesOf(compareByCategory(current, []))).toEqual(["b", "d", "e", "c", "a"]);
  });

  it("今期と前期が入り混じっても、今期の降順のあとに今期0が並ぶ", () => {
    const current = spend({ a: 100, b: 900, c: 300 });
    const previous = spend({ z: 8000, y: 200 });

    expect(categoriesOf(compareByCategory(current, previous))).toEqual([
      "b",
      "c",
      "a",
      "y",
      "z",
    ]);
  });

  it("隣り合う2件の大小が必ず正しい", () => {
    const rows = compareByCategory(spend({ a: 100, b: 900, c: 300, d: 700 }), spend({ z: 50 }));

    for (let i = 1; i < rows.length; i += 1) {
      const before = rows[i - 1]!;
      const after = rows[i]!;
      expect(before.expenseYen).toBeGreaterThanOrEqual(after.expenseYen);
    }
  });
});

describe("expenseDeltaYen", () => {
  it("増えたら正", () => {
    expect(expenseDeltaYen(spend({ 食費: 5000 }), spend({ 食費: 3000 }))).toBe(2000);
  });

  it("減ったら負", () => {
    expect(expenseDeltaYen(spend({ 食費: 3000 }), spend({ 食費: 5000 }))).toBe(-2000);
  });

  it("同額なら 0", () => {
    expect(expenseDeltaYen(spend({ 食費: 3000 }), spend({ 食費: 3000 }))).toBe(0);
  });

  it("同額のときの 0 は +0", () => {
    const delta = expenseDeltaYen(spend({ 食費: 3000 }), spend({ 食費: 3000 }));

    expect(delta).toBe(0);
    expect(1 / delta).toBe(Number.POSITIVE_INFINITY);
  });

  it("両方空なら +0", () => {
    const delta = expenseDeltaYen([], []);

    expect(delta).toBe(0);
    expect(1 / delta).toBe(Number.POSITIVE_INFINITY);
  });

  it("前期が空なら今期の全額が増加になる", () => {
    expect(expenseDeltaYen(spend({ 食費: 5000, 医療: 100 }), [])).toBe(5100);
  });

  it("今期が空なら前期の全額が減少になる", () => {
    expect(expenseDeltaYen([], spend({ 食費: 5000 }))).toBe(-5000);
  });

  it("カテゴリをまたいで合計する", () => {
    expect(expenseDeltaYen(spend({ a: 100, b: 200, c: 300 }), spend({ a: 600 }))).toBe(0);
  });

  it("カテゴリの入れ替わりがあっても合計だけを見る", () => {
    expect(expenseDeltaYen(spend({ 医療: 1000 }), spend({ 食費: 400 }))).toBe(600);
  });

  it("収入は増減に混ざらない", () => {
    const current = [tx("食費", -1000), tx(INCOME, 250000)];

    expect(expenseDeltaYen(current, [])).toBe(1000);
  });

  it("前期の収入も混ざらない", () => {
    const previous = [tx("食費", -1000), tx(INCOME, 250000)];

    expect(expenseDeltaYen([], previous)).toBe(-1000);
  });

  it("今期と前期を入れ替えると符号が反転する", () => {
    const current = spend({ 食費: 5000 });
    const previous = spend({ 食費: 3000 });

    expect(expenseDeltaYen(previous, current)).toBe(-expenseDeltaYen(current, previous));
  });

  it("compareByCategory の差の総和と一致する", () => {
    const current = spend({ 食費: 5000, 医療: 100 });
    const previous = spend({ 食費: 3000, 娯楽: 700 });
    const sumOfRows = compareByCategory(current, previous).reduce((s, r) => s + r.deltaYen, 0);

    expect(expenseDeltaYen(current, previous)).toBe(sumOfRows);
  });

  it("入力を書き換えない", () => {
    const current = spend({ 食費: 1000 });
    const snapshot = structuredClone(current);

    expenseDeltaYen(current, []);

    expect(current).toEqual(snapshot);
  });
});
