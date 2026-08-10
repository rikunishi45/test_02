import { describe, it, expect } from "vitest";
import { INCOME, UNCATEGORIZED } from "../category/classify.js";
import { budgetId, type BudgetRecord, type StoredTransaction } from "../storage/schema.js";
import {
  budgetProgress,
  budgetSummary,
  unbudgetedYen,
  type BudgetRow,
} from "./progress.js";

const MONTH = "2026-07";

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

function tx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  sequence += 1;
  return { ...BASE, id: `t-${sequence}`, ...overrides };
}

/** カテゴリごとに支出1件ずつ。額は正で渡す */
function spend(entries: Record<string, number>, date = "2026-07-15"): StoredTransaction[] {
  return Object.entries(entries).map(([category, yen]) =>
    tx({ category, amountYen: -yen, date }),
  );
}

/** カテゴリごとの予算。額は正 */
function budgets(entries: Record<string, number>, month = MONTH): BudgetRecord[] {
  return Object.entries(entries).map(([category, amountYen]) => ({
    id: budgetId(month, category),
    month,
    category,
    amountYen,
  }));
}

function rowOf(rows: readonly BudgetRow[], category: string): BudgetRow {
  const found = rows.find((row) => row.category === category);
  if (found === undefined) {
    throw new Error(`${category} の行が無い（実際: ${rows.map((r) => r.category).join(",")}）`);
  }
  return found;
}

function categoriesOf(rows: readonly BudgetRow[]): string[] {
  return rows.map((row) => row.category);
}

describe("budgetProgress", () => {
  describe("突き合わせ", () => {
    it("予算と支出の両方がある行は、残りと率が出る", () => {
      const rows = budgetProgress(budgets({ 食費: 50000 }), spend({ 食費: 20000 }), MONTH);

      expect(rowOf(rows, "食費")).toEqual({
        category: "食費",
        budgetYen: 50000,
        spentYen: 20000,
        remainingYen: 30000,
        ratio: 0.4,
        budgeted: true,
      });
    });

    it("使い切ると残り 0・率 1", () => {
      const rows = budgetProgress(budgets({ 食費: 50000 }), spend({ 食費: 50000 }), MONTH);

      expect([rowOf(rows, "食費").remainingYen, rowOf(rows, "食費").ratio]).toEqual([0, 1]);
    });

    it("超えると残りが負・率が1を超える", () => {
      const rows = budgetProgress(budgets({ 食費: 40000 }), spend({ 食費: 50000 }), MONTH);

      expect(rowOf(rows, "食費").remainingYen).toBe(-10000);
      expect(rowOf(rows, "食費").ratio).toBeGreaterThan(1);
    });

    it("1円超えただけでも残りが負になる（境界）", () => {
      const rows = budgetProgress(budgets({ 食費: 40000 }), spend({ 食費: 40001 }), MONTH);

      expect(rowOf(rows, "食費").remainingYen).toBe(-1);
    });

    it("1円残っていれば残りは正（境界）", () => {
      const rows = budgetProgress(budgets({ 食費: 40000 }), spend({ 食費: 39999 }), MONTH);

      expect(rowOf(rows, "食費").remainingYen).toBe(1);
    });
  });

  describe("片側しか無い行", () => {
    // 予算だけの行を落とすと「まだ使っていない」が見えない。
    it("予算だけの行は支出0・残り＝予算で出る", () => {
      const rows = budgetProgress(budgets({ 医療: 10000 }), [], MONTH);

      expect(rowOf(rows, "医療")).toEqual({
        category: "医療",
        budgetYen: 10000,
        spentYen: 0,
        remainingYen: 10000,
        ratio: 0,
        budgeted: true,
      });
    });

    // 支出だけの行を落とすと、予算の外側で出ていく分が見えなくなる。
    it("支出だけの行は予算0で出て、budgeted が false", () => {
      const rows = budgetProgress([], spend({ 娯楽: 3000 }), MONTH);

      expect(rowOf(rows, "娯楽")).toEqual({
        category: "娯楽",
        budgetYen: 0,
        spentYen: 3000,
        remainingYen: -3000,
        ratio: 0,
        budgeted: false,
      });
    });

    it("予算のある行は budgeted が true", () => {
      const rows = budgetProgress(budgets({ 食費: 100 }), spend({ 食費: 50 }), MONTH);

      expect(rowOf(rows, "食費").budgeted).toBe(true);
    });

    it("両方が混ざっていても、どちらも消えない", () => {
      const rows = budgetProgress(budgets({ 医療: 10000 }), spend({ 娯楽: 3000 }), MONTH);

      expect(categoriesOf(rows).sort()).toEqual(["医療", "娯楽"]);
    });
  });

  describe("率の分母が 0", () => {
    it("予算が無い行の率は 0（Infinity にしない）", () => {
      const rows = budgetProgress([], spend({ 娯楽: 3000 }), MONTH);

      expect(rowOf(rows, "娯楽").ratio).toBe(0);
      expect(Number.isFinite(rowOf(rows, "娯楽").ratio)).toBe(true);
    });

    it("予算0のレコードがあっても率は 0（NaN にしない）", () => {
      const rows = budgetProgress(budgets({ 娯楽: 0 }), spend({ 娯楽: 3000 }), MONTH);

      expect(rowOf(rows, "娯楽").ratio).toBe(0);
      expect(Number.isNaN(rowOf(rows, "娯楽").ratio)).toBe(false);
    });

    it("予算0でも残りは支出のぶんだけ負になる（超過は金額で表れる）", () => {
      const rows = budgetProgress(budgets({ 娯楽: 0 }), spend({ 娯楽: 3000 }), MONTH);

      expect(rowOf(rows, "娯楽").remainingYen).toBe(-3000);
    });

    it("予算も支出も 0 の行は率 0・残り 0", () => {
      const rows = budgetProgress(budgets({ 医療: 0 }), [], MONTH);

      expect([rowOf(rows, "医療").ratio, rowOf(rows, "医療").remainingYen]).toEqual([0, 0]);
    });
  });

  describe("月で絞る", () => {
    it("他の月の予算は混ざらない", () => {
      const other = budgets({ 娯楽: 9000 }, "2026-06");

      expect(categoriesOf(budgetProgress(other, spend({ 食費: 100 }), MONTH))).toEqual(["食費"]);
    });

    it("他の月の支出は混ざらない", () => {
      const rows = budgetProgress(
        budgets({ 食費: 50000 }),
        spend({ 食費: 20000 }, "2026-06-15"),
        MONTH,
      );

      expect(rowOf(rows, "食費").spentYen).toBe(0);
    });

    it("月初と月末の支出は含む", () => {
      const transactions = [
        ...spend({ 食費: 1000 }, "2026-07-01"),
        ...spend({ 食費: 2000 }, "2026-07-31"),
      ];

      expect(rowOf(budgetProgress([], transactions, MONTH), "食費").spentYen).toBe(3000);
    });

    it("前月末・翌月初は含まない", () => {
      const transactions = [
        ...spend({ 食費: 1000 }, "2026-06-30"),
        ...spend({ 食費: 2000 }, "2026-08-01"),
      ];

      expect(budgetProgress([], transactions, MONTH)).toEqual([]);
    });
  });

  describe("収入は含めない", () => {
    it("収入の取引は行にならない", () => {
      const transactions = [tx({ category: INCOME, amountYen: 250000 })];

      expect(budgetProgress([], transactions, MONTH)).toEqual([]);
    });

    it("収入に予算が設定されていても落とす", () => {
      const rows = budgetProgress(budgets({ [INCOME]: 300000 }), spend({ 食費: 100 }), MONTH);

      expect(categoriesOf(rows)).toEqual(["食費"]);
    });

    it("未分類は支出なので行になる", () => {
      expect(categoriesOf(budgetProgress([], spend({ [UNCATEGORIZED]: 700 }), MONTH))).toEqual([
        UNCATEGORIZED,
      ]);
    });
  });

  describe("並び順", () => {
    it("予算の多い順", () => {
      const rows = budgetProgress(budgets({ a: 1000, b: 5000, c: 3000 }), [], MONTH);

      expect(categoriesOf(rows)).toEqual(["b", "c", "a"]);
    });

    it("予算が同額なら支出の多い順", () => {
      const rows = budgetProgress(budgets({ a: 1000, b: 1000 }), spend({ a: 10, b: 900 }), MONTH);

      expect(categoriesOf(rows)).toEqual(["b", "a"]);
    });

    it("予算も支出も同じならカテゴリ名の昇順", () => {
      const rows = budgetProgress(budgets({ b: 1000, a: 1000 }), [], MONTH);

      expect(categoriesOf(rows)).toEqual(["a", "b"]);
    });

    // 予算を立てた行を上にまとめて見たい。支出順だと予算外の大きい支出が上に来る。
    it("予算のある行が、支出の大きい予算外の行より上に来る", () => {
      const rows = budgetProgress(budgets({ 食費: 1 }), spend({ 食費: 0, 娯楽: 99999 }), MONTH);

      expect(categoriesOf(rows)).toEqual(["食費", "娯楽"]);
    });

    it("入力の順序を変えても同じ並びになる", () => {
      const b = budgets({ a: 1000, b: 5000, c: 3000 });
      const t = spend({ a: 10, b: 20, c: 30 });

      expect(budgetProgress([...b].reverse(), [...t].reverse(), MONTH)).toEqual(
        budgetProgress(b, t, MONTH),
      );
    });
  });

  describe("端のケース", () => {
    it("予算も取引も空なら空", () => {
      expect(budgetProgress([], [], MONTH)).toEqual([]);
    });

    it("同じカテゴリの複数件はまとまる", () => {
      const transactions = [tx({ category: "食費", amountYen: -1000 }), tx({ category: "食費", amountYen: -2000 })];

      expect(rowOf(budgetProgress([], transactions, MONTH), "食費").spentYen).toBe(3000);
    });

    it("カテゴリは重複しない", () => {
      const rows = budgetProgress(budgets({ 食費: 100, 医療: 200 }), spend({ 食費: 50 }), MONTH);

      expect(new Set(categoriesOf(rows)).size).toBe(rows.length);
    });

    it("すべての行で remainingYen が budgetYen − spentYen と一致する", () => {
      const rows = budgetProgress(
        budgets({ 食費: 50000, 医療: 3000 }),
        spend({ 食費: 20000, 娯楽: 800 }),
        MONTH,
      );

      for (const row of rows) {
        expect(row.remainingYen).toBe(row.budgetYen - row.spentYen);
      }
    });
  });

  describe("入力を書き換えない", () => {
    it("凍結された配列を渡しても動く", () => {
      const b = Object.freeze(budgets({ 食費: 100 })) as readonly BudgetRecord[];
      const t = Object.freeze(spend({ 食費: 50 })) as readonly StoredTransaction[];

      expect(() => budgetProgress(b, t, MONTH)).not.toThrow();
    });

    it("呼び出しの前後で内容が変わらない", () => {
      const b = budgets({ 食費: 100 });
      const snapshot = structuredClone(b);

      budgetProgress(b, spend({ 食費: 50 }), MONTH);

      expect(b).toEqual(snapshot);
    });
  });
});

describe("budgetSummary", () => {
  it("予算のある行の合計を出す", () => {
    const rows = budgetProgress(
      budgets({ 食費: 50000, 医療: 10000 }),
      spend({ 食費: 20000, 医療: 3000 }),
      MONTH,
    );

    expect(budgetSummary(rows)).toEqual({
      budgetYen: 60000,
      spentYen: 23000,
      remainingYen: 37000,
      ratio: 23000 / 60000,
    });
  });

  // 分母のない支出を足すと「予算に対してどこまで使ったか」が壊れる。
  it("予算を立てていないカテゴリの支出は数えない", () => {
    const rows = budgetProgress(budgets({ 食費: 50000 }), spend({ 食費: 20000, 娯楽: 9000 }), MONTH);

    expect(budgetSummary(rows).spentYen).toBe(20000);
  });

  it("予算外の支出があっても率が変わらない", () => {
    const withOut = budgetProgress(budgets({ 食費: 50000 }), spend({ 食費: 20000 }), MONTH);
    const withExtra = budgetProgress(
      budgets({ 食費: 50000 }),
      spend({ 食費: 20000, 娯楽: 9000 }),
      MONTH,
    );

    expect(budgetSummary(withExtra).ratio).toBe(budgetSummary(withOut).ratio);
  });

  it("予算が1つも無ければ、すべて 0", () => {
    const rows = budgetProgress([], spend({ 娯楽: 9000 }), MONTH);

    expect(budgetSummary(rows)).toEqual({
      budgetYen: 0,
      spentYen: 0,
      remainingYen: 0,
      ratio: 0,
    });
  });

  it("空の行なら、すべて 0", () => {
    expect(budgetSummary([])).toEqual({
      budgetYen: 0,
      spentYen: 0,
      remainingYen: 0,
      ratio: 0,
    });
  });

  it("超過すると残りが負になる", () => {
    const rows = budgetProgress(budgets({ 食費: 10000 }), spend({ 食費: 15000 }), MONTH);

    expect(budgetSummary(rows).remainingYen).toBe(-5000);
  });

  it("合計は行の合計と一致する（総額を別に持たない）", () => {
    const rows = budgetProgress(
      budgets({ 食費: 50000, 医療: 10000, 娯楽: 5000 }),
      spend({ 食費: 20000, 医療: 3000 }),
      MONTH,
    );
    const summary = budgetSummary(rows);
    const budgeted = rows.filter((row) => row.budgeted);

    expect(summary.budgetYen).toBe(budgeted.reduce((s, r) => s + r.budgetYen, 0));
    expect(summary.spentYen).toBe(budgeted.reduce((s, r) => s + r.spentYen, 0));
  });
});

describe("unbudgetedYen", () => {
  it("予算を立てていないカテゴリの支出を合計する", () => {
    const rows = budgetProgress(
      budgets({ 食費: 50000 }),
      spend({ 食費: 20000, 娯楽: 9000, 医療: 1000 }),
      MONTH,
    );

    expect(unbudgetedYen(rows)).toBe(10000);
  });

  it("すべて予算内なら 0", () => {
    const rows = budgetProgress(budgets({ 食費: 50000 }), spend({ 食費: 20000 }), MONTH);

    expect(unbudgetedYen(rows)).toBe(0);
  });

  it("予算が1つも無ければ支出の全額", () => {
    const rows = budgetProgress([], spend({ 娯楽: 9000, 医療: 1000 }), MONTH);

    expect(unbudgetedYen(rows)).toBe(10000);
  });

  it("空の行なら 0", () => {
    expect(unbudgetedYen([])).toBe(0);
  });

  it("予算を立てたが使っていない行は数えない", () => {
    const rows = budgetProgress(budgets({ 医療: 10000 }), [], MONTH);

    expect(unbudgetedYen(rows)).toBe(0);
  });

  it("予算内の支出と予算外の支出の合計が、その月の支出の総額と一致する", () => {
    const rows = budgetProgress(
      budgets({ 食費: 50000 }),
      spend({ 食費: 20000, 娯楽: 9000 }),
      MONTH,
    );

    expect(budgetSummary(rows).spentYen + unbudgetedYen(rows)).toBe(29000);
  });
});
