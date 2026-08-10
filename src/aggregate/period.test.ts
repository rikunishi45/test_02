import { describe, it, expect } from "vitest";
import type { StoredTransaction } from "../storage/schema.js";
import { UNCATEGORIZED } from "../category/classify.js";
import {
  monthOf,
  yearOf,
  sumByYear,
  shiftYear,
  inRange,
  shiftMonth,
  sumByMonth,
  sumByDay,
  sumAll,
  sumByCategory,
  inMonth,
  inCategory,
  negateExpense,
  netYen,
  type PeriodTotal,
  type CategoryTotal,
} from "./period.js";

const BASE: StoredTransaction = {
  id: "t0",
  date: "2026-01-15",
  amountYen: -1000,
  description: "店A",
  source: "card",
  category: "食費",
  memo: "",
};

let sequence = 0;

function tx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  sequence += 1;
  return { ...BASE, id: `t${sequence}`, ...overrides };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`index ${index} の要素が存在しない（length=${items.length}）`);
  }
  return item;
}

function periodsOf(totals: readonly PeriodTotal[]): string[] {
  return totals.map((total) => total.period);
}

function categoriesOf(totals: readonly CategoryTotal[]): string[] {
  return totals.map((total) => total.category);
}

function totalOf(totals: readonly PeriodTotal[], period: string): PeriodTotal {
  const found = totals.find((total) => total.period === period);
  if (found === undefined) {
    throw new Error(`period ${period} のエントリが無い（実際: ${periodsOf(totals).join(",")}）`);
  }
  return found;
}

/**
 * +0 であることを検査する。Object.is(-0, 0) は false なので toBe が区別する。
 * 1 / value は失敗時に -Infinity を出して原因を示すための補助。
 */
function expectPlusZero(value: number): void {
  expect(value).toBe(0);
  expect(1 / value).toBe(Number.POSITIVE_INFINITY);
}

/** 引数の配列（および各要素）が呼び出しで書き換えられないこと */
function expectInputUnchanged(
  transactions: StoredTransaction[],
  run: (input: StoredTransaction[]) => unknown,
): void {
  const before = structuredClone(transactions);
  run(transactions);
  expect(transactions).toEqual(before);
}

describe("monthOf", () => {
  it("YYYY-MM-DD から YYYY-MM を取り出す", () => {
    expect(monthOf("2026-01-15")).toBe("2026-01");
  });

  it("月初の日付でも、その月を返す", () => {
    expect(monthOf("2026-01-01")).toBe("2026-01");
  });

  it("月末の日付でも、その月を返す（翌月に繰り上がらない）", () => {
    expect(monthOf("2026-01-31")).toBe("2026-01");
  });

  it("年末の日付では、その年の12月を返す（翌年に繰り上がらない）", () => {
    expect(monthOf("2025-12-31")).toBe("2025-12");
  });

  it("2桁の月をゼロ詰めのまま保つ", () => {
    expect(monthOf("2026-10-05")).toBe("2026-10");
  });

  it("同じ月の別の日は、同じ月を返す", () => {
    expect(monthOf("2026-03-01")).toBe(monthOf("2026-03-28"));
  });

  it("月が違えば、違う値を返す", () => {
    expect(monthOf("2026-03-31")).not.toBe(monthOf("2026-04-01"));
  });
});

describe("sumByMonth", () => {
  describe("空の入力", () => {
    it("取引が空なら、空配列を返す", () => {
      expect(sumByMonth([])).toEqual([]);
    });
  });

  describe("符号の反転（支出は負で持ち、正で返す）", () => {
    it("支出だけの月は、expenseYen が符号を反転した正の数になる", () => {
      const totals = sumByMonth([tx({ date: "2026-01-15", amountYen: -1200 })]);

      expect(at(totals, 0).expenseYen).toBe(1200);
    });

    it("支出だけの月は、incomeYen が +0 になる（-0 にならない）", () => {
      const totals = sumByMonth([tx({ date: "2026-01-15", amountYen: -1200 })]);

      expectPlusZero(at(totals, 0).incomeYen);
    });

    it("収入だけの月は、incomeYen がそのままの正の数になる", () => {
      const totals = sumByMonth([tx({ date: "2026-01-25", amountYen: 300000 })]);

      expect(at(totals, 0).incomeYen).toBe(300000);
    });

    it("収入だけの月は、expenseYen が +0 になる（-0 にならない）", () => {
      const totals = sumByMonth([tx({ date: "2026-01-25", amountYen: 300000 })]);

      expectPlusZero(at(totals, 0).expenseYen);
    });

    it("支出と収入が混ざる月は、それぞれ別に合計する", () => {
      const totals = sumByMonth([
        tx({ date: "2026-01-05", amountYen: -1200 }),
        tx({ date: "2026-01-25", amountYen: 300000 }),
        tx({ date: "2026-01-28", amountYen: -800 }),
      ]);

      expect(totals).toEqual([{ period: "2026-01", expenseYen: 2000, incomeYen: 300000 }]);
    });
  });

  describe("月ごとのまとめ方", () => {
    it("同じ月の複数の取引は、1つのエントリにまとまる", () => {
      const totals = sumByMonth([
        tx({ date: "2026-02-01", amountYen: -100 }),
        tx({ date: "2026-02-14", amountYen: -200 }),
        tx({ date: "2026-02-28", amountYen: -300 }),
      ]);

      expect(totals).toEqual([{ period: "2026-02", expenseYen: 600, incomeYen: 0 }]);
    });

    it("違う月の取引は、別のエントリになる", () => {
      const totals = sumByMonth([
        tx({ date: "2026-01-31", amountYen: -100 }),
        tx({ date: "2026-02-01", amountYen: -200 }),
      ]);

      expect(totals).toEqual([
        { period: "2026-01", expenseYen: 100, incomeYen: 0 },
        { period: "2026-02", expenseYen: 200, incomeYen: 0 },
      ]);
    });

    it("period は YYYY-MM 形式で、日を含まない", () => {
      const totals = sumByMonth([tx({ date: "2026-07-09", amountYen: -100 })]);

      expect(at(totals, 0).period).toBe("2026-07");
    });

    it("同じ月が2つのエントリに割れない", () => {
      const totals = sumByMonth([
        tx({ date: "2026-03-01", amountYen: -100 }),
        tx({ date: "2026-03-31", amountYen: 100 }),
      ]);

      expect(periodsOf(totals)).toEqual(["2026-03"]);
    });
  });

  describe("並び順（period の昇順・入力順に依存しない）", () => {
    it("入力が降順でも、period の昇順で返る", () => {
      const totals = sumByMonth([
        tx({ date: "2026-03-01", amountYen: -300 }),
        tx({ date: "2026-01-01", amountYen: -100 }),
        tx({ date: "2026-02-01", amountYen: -200 }),
      ]);

      expect(periodsOf(totals)).toEqual(["2026-01", "2026-02", "2026-03"]);
    });

    it("年をまたぐとき、2025-12 が 2026-01 より前に来る", () => {
      const totals = sumByMonth([
        tx({ date: "2026-01-05", amountYen: -100 }),
        tx({ date: "2025-12-25", amountYen: -200 }),
      ]);

      expect(periodsOf(totals)).toEqual(["2025-12", "2026-01"]);
    });

    it("入力を逆順にしても、同じ結果になる", () => {
      const transactions = [
        tx({ date: "2025-11-01", amountYen: -100 }),
        tx({ date: "2025-12-01", amountYen: 200 }),
        tx({ date: "2026-01-01", amountYen: -300 }),
        tx({ date: "2026-10-01", amountYen: -400 }),
      ];

      expect(sumByMonth([...transactions].reverse())).toEqual(sumByMonth(transactions));
    });

    it("2026-02 と 2026-10 を、文字列としてではなく月として正しく並べる", () => {
      const totals = sumByMonth([
        tx({ date: "2026-10-01", amountYen: -100 }),
        tx({ date: "2026-02-01", amountYen: -200 }),
      ]);

      expect(periodsOf(totals)).toEqual(["2026-02", "2026-10"]);
    });
  });

  describe("金額 0 の取引", () => {
    it("0 円の取引だけの月も、エントリが作られる", () => {
      const totals = sumByMonth([tx({ date: "2026-04-10", amountYen: 0 })]);

      expect(periodsOf(totals)).toEqual(["2026-04"]);
    });

    it("0 円の取引は、expenseYen にも incomeYen にも数えない", () => {
      const totals = sumByMonth([tx({ date: "2026-04-10", amountYen: 0 })]);

      expect(at(totals, 0)).toEqual({ period: "2026-04", expenseYen: 0, incomeYen: 0 });
    });

    it("0 円だけの月の expenseYen は +0 になる（-0 にならない）", () => {
      const totals = sumByMonth([tx({ date: "2026-04-10", amountYen: 0 })]);

      expectPlusZero(at(totals, 0).expenseYen);
    });

    it("-0 円の取引も、支出に数えない（-0 < 0 は偽）", () => {
      const totals = sumByMonth([tx({ date: "2026-05-10", amountYen: -0 })]);

      expect(at(totals, 0)).toEqual({ period: "2026-05", expenseYen: 0, incomeYen: 0 });
    });

    it("-0 円だけの月の expenseYen は +0 になる（-0 にならない）", () => {
      const totals = sumByMonth([tx({ date: "2026-05-10", amountYen: -0 })]);

      expectPlusZero(at(totals, 0).expenseYen);
    });

    it("-0 円だけの月の incomeYen は +0 になる（-0 にならない）", () => {
      const totals = sumByMonth([tx({ date: "2026-05-10", amountYen: -0 })]);

      expectPlusZero(at(totals, 0).incomeYen);
    });

    it("0 円の取引が混ざっても、他の取引の合計を変えない", () => {
      const totals = sumByMonth([
        tx({ date: "2026-06-01", amountYen: -500 }),
        tx({ date: "2026-06-02", amountYen: 0 }),
        tx({ date: "2026-06-03", amountYen: -0 }),
        tx({ date: "2026-06-04", amountYen: 700 }),
      ]);

      expect(totals).toEqual([{ period: "2026-06", expenseYen: 500, incomeYen: 700 }]);
    });

    it("0 円だけの月も、他の月と一緒に昇順の位置に並ぶ", () => {
      const totals = sumByMonth([
        tx({ date: "2026-03-01", amountYen: -100 }),
        tx({ date: "2026-02-01", amountYen: 0 }),
        tx({ date: "2026-01-01", amountYen: 100 }),
      ]);

      expect(totals).toEqual([
        { period: "2026-01", expenseYen: 0, incomeYen: 100 },
        { period: "2026-02", expenseYen: 0, incomeYen: 0 },
        { period: "2026-03", expenseYen: 100, incomeYen: 0 },
      ]);
    });
  });

  describe("カテゴリや摘要には依存しない", () => {
    it("カテゴリが違っても、同じ月なら合算される", () => {
      const totals = sumByMonth([
        tx({ date: "2026-01-05", amountYen: -100, category: "食費" }),
        tx({ date: "2026-01-06", amountYen: -200, category: "交通費" }),
        tx({ date: "2026-01-07", amountYen: -300, category: "" }),
      ]);

      expect(totals).toEqual([{ period: "2026-01", expenseYen: 600, incomeYen: 0 }]);
    });
  });
});

describe("sumByDay", () => {
  describe("空の入力", () => {
    it("取引が空なら、空配列を返す", () => {
      expect(sumByDay([])).toEqual([]);
    });
  });

  describe("日ごとのまとめ方", () => {
    it("period は日付そのもの（YYYY-MM-DD）になる", () => {
      const totals = sumByDay([tx({ date: "2026-07-09", amountYen: -100 })]);

      expect(at(totals, 0).period).toBe("2026-07-09");
    });

    it("同じ日の複数の取引は、1つのエントリにまとまる", () => {
      const totals = sumByDay([
        tx({ date: "2026-01-15", amountYen: -100 }),
        tx({ date: "2026-01-15", amountYen: -250 }),
        tx({ date: "2026-01-15", amountYen: 1000 }),
      ]);

      expect(totals).toEqual([{ period: "2026-01-15", expenseYen: 350, incomeYen: 1000 }]);
    });

    it("同じ月の別の日は、別のエントリになる（月にまとめない）", () => {
      const totals = sumByDay([
        tx({ date: "2026-01-15", amountYen: -100 }),
        tx({ date: "2026-01-16", amountYen: -200 }),
      ]);

      expect(totals).toEqual([
        { period: "2026-01-15", expenseYen: 100, incomeYen: 0 },
        { period: "2026-01-16", expenseYen: 200, incomeYen: 0 },
      ]);
    });
  });

  describe("符号の反転", () => {
    it("支出は符号を反転した正の数で返る", () => {
      const totals = sumByDay([tx({ date: "2026-01-15", amountYen: -1200 })]);

      expect(at(totals, 0).expenseYen).toBe(1200);
    });

    it("収入だけの日の expenseYen は +0 になる（-0 にならない）", () => {
      const totals = sumByDay([tx({ date: "2026-01-15", amountYen: 500 })]);

      expectPlusZero(at(totals, 0).expenseYen);
    });

    it("支出だけの日の incomeYen は +0 になる（-0 にならない）", () => {
      const totals = sumByDay([tx({ date: "2026-01-15", amountYen: -500 })]);

      expectPlusZero(at(totals, 0).incomeYen);
    });
  });

  describe("並び順（period の昇順・入力順に依存しない）", () => {
    it("入力が降順でも、日付の昇順で返る", () => {
      const totals = sumByDay([
        tx({ date: "2026-01-31", amountYen: -300 }),
        tx({ date: "2026-01-02", amountYen: -100 }),
        tx({ date: "2026-01-09", amountYen: -200 }),
      ]);

      expect(periodsOf(totals)).toEqual(["2026-01-02", "2026-01-09", "2026-01-31"]);
    });

    it("年をまたぐとき、2025-12-31 が 2026-01-01 より前に来る", () => {
      const totals = sumByDay([
        tx({ date: "2026-01-01", amountYen: -100 }),
        tx({ date: "2025-12-31", amountYen: -200 }),
      ]);

      expect(periodsOf(totals)).toEqual(["2025-12-31", "2026-01-01"]);
    });

    it("入力を逆順にしても、同じ結果になる", () => {
      const transactions = [
        tx({ date: "2025-12-31", amountYen: -100 }),
        tx({ date: "2026-01-01", amountYen: 200 }),
        tx({ date: "2026-01-01", amountYen: -300 }),
        tx({ date: "2026-02-10", amountYen: -400 }),
      ];

      expect(sumByDay([...transactions].reverse())).toEqual(sumByDay(transactions));
    });
  });

  describe("金額 0 の取引", () => {
    it("0 円の取引だけの日も、エントリが作られる", () => {
      const totals = sumByDay([tx({ date: "2026-04-10", amountYen: 0 })]);

      expect(totals).toEqual([{ period: "2026-04-10", expenseYen: 0, incomeYen: 0 }]);
    });

    it("-0 円の取引も、支出に数えない", () => {
      const totals = sumByDay([tx({ date: "2026-04-10", amountYen: -0 })]);

      expect(totals).toEqual([{ period: "2026-04-10", expenseYen: 0, incomeYen: 0 }]);
    });

    it("-0 円だけの日の expenseYen は +0 になる（-0 にならない）", () => {
      const totals = sumByDay([tx({ date: "2026-04-10", amountYen: -0 })]);

      expectPlusZero(at(totals, 0).expenseYen);
    });

    it("0 円の取引が混ざっても、その日の合計を変えない", () => {
      const totals = sumByDay([
        tx({ date: "2026-04-10", amountYen: -500 }),
        tx({ date: "2026-04-10", amountYen: 0 }),
        tx({ date: "2026-04-10", amountYen: -0 }),
      ]);

      expect(totals).toEqual([{ period: "2026-04-10", expenseYen: 500, incomeYen: 0 }]);
    });
  });

  describe("sumByMonth との整合", () => {
    it("同じ入力なら、日次の合計を月ごとに足した額が月次の合計と一致する", () => {
      const transactions = [
        tx({ date: "2026-01-05", amountYen: -100 }),
        tx({ date: "2026-01-05", amountYen: 400 }),
        tx({ date: "2026-01-20", amountYen: -250 }),
        tx({ date: "2026-02-01", amountYen: -700 }),
      ];

      const januaryDays = sumByDay(transactions).filter((total) =>
        total.period.startsWith("2026-01"),
      );
      const januaryExpense = januaryDays.reduce((sum, total) => sum + total.expenseYen, 0);
      const januaryIncome = januaryDays.reduce((sum, total) => sum + total.incomeYen, 0);
      const january = totalOf(sumByMonth(transactions), "2026-01");

      expect({ expenseYen: januaryExpense, incomeYen: januaryIncome }).toEqual({
        expenseYen: january.expenseYen,
        incomeYen: january.incomeYen,
      });
    });
  });
});

describe("sumByCategory", () => {
  describe("空の結果になる入力", () => {
    it("取引が空なら、空配列を返す", () => {
      expect(sumByCategory([])).toEqual([]);
    });

    it("収入しか無いなら、空配列を返す", () => {
      expect(
        sumByCategory([
          tx({ amountYen: 300000, category: "給与" }),
          tx({ amountYen: 5000, category: "その他収入" }),
        ]),
      ).toEqual([]);
    });

    it("0 円の取引しか無いなら、空配列を返す", () => {
      expect(sumByCategory([tx({ amountYen: 0, category: "食費" })])).toEqual([]);
    });

    it("-0 円の取引しか無いなら、空配列を返す（-0 >= 0 は真）", () => {
      expect(sumByCategory([tx({ amountYen: -0, category: "食費" })])).toEqual([]);
    });
  });

  describe("支出だけを、正の数で合計する", () => {
    it("支出は符号を反転した正の数になる", () => {
      expect(sumByCategory([tx({ amountYen: -1200, category: "食費" })])).toEqual([
        { category: "食費", expenseYen: 1200 },
      ]);
    });

    it("同じカテゴリの複数の支出は、1つにまとまる", () => {
      const totals = sumByCategory([
        tx({ amountYen: -100, category: "食費" }),
        tx({ amountYen: -200, category: "食費" }),
      ]);

      expect(totals).toEqual([{ category: "食費", expenseYen: 300 }]);
    });

    it("同じカテゴリの収入は、支出から差し引かれない", () => {
      const totals = sumByCategory([
        tx({ amountYen: -1000, category: "食費" }),
        tx({ amountYen: 400, category: "食費" }),
      ]);

      expect(totals).toEqual([{ category: "食費", expenseYen: 1000 }]);
    });

    it("収入しか無いカテゴリは、結果に現れない", () => {
      const totals = sumByCategory([
        tx({ amountYen: -1000, category: "食費" }),
        tx({ amountYen: 300000, category: "給与" }),
      ]);

      expect(categoriesOf(totals)).toEqual(["食費"]);
    });

    it("0 円の取引しか無いカテゴリは、結果に現れない", () => {
      const totals = sumByCategory([
        tx({ amountYen: -1000, category: "食費" }),
        tx({ amountYen: 0, category: "交通費" }),
        tx({ amountYen: -0, category: "日用品" }),
      ]);

      expect(categoriesOf(totals)).toEqual(["食費"]);
    });
  });

  describe("並び順（expenseYen の降順）", () => {
    it("金額の大きいカテゴリが先に来る", () => {
      const totals = sumByCategory([
        tx({ amountYen: -100, category: "交通費" }),
        tx({ amountYen: -3000, category: "住居費" }),
        tx({ amountYen: -500, category: "食費" }),
      ]);

      expect(totals).toEqual([
        { category: "住居費", expenseYen: 3000 },
        { category: "食費", expenseYen: 500 },
        { category: "交通費", expenseYen: 100 },
      ]);
    });

    it("合算後の金額で比較する（1件あたりの金額では並べない）", () => {
      const totals = sumByCategory([
        tx({ amountYen: -900, category: "住居費" }),
        tx({ amountYen: -500, category: "食費" }),
        tx({ amountYen: -500, category: "食費" }),
      ]);

      expect(categoriesOf(totals)).toEqual(["食費", "住居費"]);
    });
  });

  describe("同額のときの並び順（category の昇順・入力順に依存しない）", () => {
    it("同額のカテゴリは、category の昇順で並ぶ", () => {
      const totals = sumByCategory([
        tx({ amountYen: -1000, category: "C" }),
        tx({ amountYen: -1000, category: "A" }),
        tx({ amountYen: -1000, category: "B" }),
      ]);

      expect(categoriesOf(totals)).toEqual(["A", "B", "C"]);
    });

    it("入力順を変えても、同額のカテゴリの並びは変わらない", () => {
      const order1 = sumByCategory([
        tx({ amountYen: -1000, category: "A" }),
        tx({ amountYen: -1000, category: "B" }),
        tx({ amountYen: -2000, category: "Z" }),
      ]);
      const order2 = sumByCategory([
        tx({ amountYen: -1000, category: "B" }),
        tx({ amountYen: -2000, category: "Z" }),
        tx({ amountYen: -1000, category: "A" }),
      ]);

      expect(categoriesOf(order2)).toEqual(categoriesOf(order1));
    });

    it("同額のカテゴリより、金額の大きいカテゴリが先に来る", () => {
      const totals = sumByCategory([
        tx({ amountYen: -1000, category: "A" }),
        tx({ amountYen: -1000, category: "B" }),
        tx({ amountYen: -2000, category: "Z" }),
      ]);

      expect(categoriesOf(totals)).toEqual(["Z", "A", "B"]);
    });

    it("日本語のカテゴリでも、同額なら category の昇順で並ぶ", () => {
      const totals = sumByCategory([
        tx({ amountYen: -1000, category: "食費" }),
        tx({ amountYen: -1000, category: "交通費" }),
      ]);

      expect(categoriesOf(totals)).toEqual(["交通費", "食費"]);
    });
  });

  describe("空文字列のカテゴリ", () => {
    it("category が空文字列の支出は、未分類として集計される", () => {
      const totals = sumByCategory([tx({ amountYen: -800, category: "" })]);

      expect(totals).toEqual([{ category: UNCATEGORIZED, expenseYen: 800 }]);
    });

    it("UNCATEGORIZED は「未分類」である", () => {
      expect(UNCATEGORIZED).toBe("未分類");
    });

    it("空文字列と「未分類」の取引は、同じエントリにまとまる", () => {
      const totals = sumByCategory([
        tx({ amountYen: -300, category: "" }),
        tx({ amountYen: -700, category: UNCATEGORIZED }),
      ]);

      expect(totals).toEqual([{ category: UNCATEGORIZED, expenseYen: 1000 }]);
    });

    it("空文字列のカテゴリは、結果に空文字列として現れない", () => {
      const totals = sumByCategory([tx({ amountYen: -800, category: "" })]);

      expect(categoriesOf(totals)).not.toContain("");
    });

    it("空文字列のカテゴリも、他のカテゴリと同じ規則で並ぶ", () => {
      const totals = sumByCategory([
        tx({ amountYen: -100, category: "食費" }),
        tx({ amountYen: -900, category: "" }),
      ]);

      expect(totals).toEqual([
        { category: UNCATEGORIZED, expenseYen: 900 },
        { category: "食費", expenseYen: 100 },
      ]);
    });
  });
});

describe("inMonth", () => {
  describe("絞り込み", () => {
    it("指定した月の取引だけを返す", () => {
      const transactions = [
        tx({ id: "a", date: "2026-01-05" }),
        tx({ id: "b", date: "2026-02-05" }),
        tx({ id: "c", date: "2026-01-25" }),
      ];

      expect(inMonth(transactions, "2026-01").map((t) => t.id)).toEqual(["a", "c"]);
    });

    it("月初の取引を含む", () => {
      const transactions = [tx({ id: "a", date: "2026-01-01" })];

      expect(inMonth(transactions, "2026-01")).toEqual(transactions);
    });

    it("月末の取引を含む", () => {
      const transactions = [tx({ id: "a", date: "2026-01-31" })];

      expect(inMonth(transactions, "2026-01")).toEqual(transactions);
    });

    it("前月末の取引を含まない", () => {
      expect(inMonth([tx({ date: "2025-12-31" })], "2026-01")).toEqual([]);
    });

    it("翌月初の取引を含まない", () => {
      expect(inMonth([tx({ date: "2026-02-01" })], "2026-01")).toEqual([]);
    });

    it("年が違えば、同じ月でも含まない", () => {
      expect(inMonth([tx({ date: "2025-01-15" })], "2026-01")).toEqual([]);
    });

    it("入力の順序を保つ（日付順に並べ替えない）", () => {
      const transactions = [
        tx({ id: "c", date: "2026-01-25" }),
        tx({ id: "a", date: "2026-01-05" }),
        tx({ id: "b", date: "2026-01-15" }),
      ];

      expect(inMonth(transactions, "2026-01").map((t) => t.id)).toEqual(["c", "a", "b"]);
    });

    it("金額やカテゴリでは絞り込まない（0 円・収入も含む）", () => {
      const transactions = [
        tx({ id: "a", date: "2026-01-05", amountYen: 0 }),
        tx({ id: "b", date: "2026-01-06", amountYen: 500 }),
        tx({ id: "c", date: "2026-01-07", amountYen: -500, category: "" }),
      ];

      expect(inMonth(transactions, "2026-01")).toEqual(transactions);
    });
  });

  describe("該当なし", () => {
    it("取引が空なら、空配列を返す", () => {
      expect(inMonth([], "2026-01")).toEqual([]);
    });

    it("その月の取引が1件も無ければ、空配列を返す", () => {
      expect(inMonth([tx({ date: "2026-03-15" })], "2026-01")).toEqual([]);
    });

    it("month が空文字列なら、どの取引も該当しない", () => {
      expect(inMonth([tx({ date: "2026-01-15" })], "")).toEqual([]);
    });

    it("month が年だけ（YYYY）なら、どの取引も該当しない", () => {
      expect(inMonth([tx({ date: "2026-01-15" })], "2026")).toEqual([]);
    });

    it("month が日付（YYYY-MM-DD）なら、どの取引も該当しない", () => {
      expect(inMonth([tx({ date: "2026-01-15" })], "2026-01-15")).toEqual([]);
    });
  });

  describe("sumByMonth との整合", () => {
    it("inMonth で絞った取引の月次集計は、全体の月次集計のその月と一致する", () => {
      const transactions = [
        tx({ date: "2026-01-05", amountYen: -100 }),
        tx({ date: "2025-12-31", amountYen: -9999 }),
        tx({ date: "2026-01-20", amountYen: 4000 }),
        tx({ date: "2026-02-01", amountYen: -700 }),
      ];

      expect(sumByMonth(inMonth(transactions, "2026-01"))).toEqual([
        totalOf(sumByMonth(transactions), "2026-01"),
      ]);
    });
  });
});

describe("引数の配列を書き換えない", () => {
  const transactions = (): StoredTransaction[] => [
    tx({ date: "2026-03-01", amountYen: -300, category: "食費" }),
    tx({ date: "2026-01-31", amountYen: 1000, category: "" }),
    tx({ date: "2026-02-15", amountYen: -100, category: "交通費" }),
  ];

  it("sumByMonth は入力を書き換えない", () => {
    expectInputUnchanged(transactions(), (input) => sumByMonth(input));
  });

  it("sumByDay は入力を書き換えない", () => {
    expectInputUnchanged(transactions(), (input) => sumByDay(input));
  });

  it("sumByCategory は入力を書き換えない", () => {
    expectInputUnchanged(transactions(), (input) => sumByCategory(input));
  });

  it("inMonth は入力を書き換えない", () => {
    expectInputUnchanged(transactions(), (input) => inMonth(input, "2026-02"));
  });

  it("inMonth は全件が該当する場合でも、入力の配列そのものを返さない", () => {
    const input = transactions().map((t) => ({ ...t, date: "2026-02-15" }));

    expect(inMonth(input, "2026-02")).not.toBe(input);
  });
});

describe("negateExpense", () => {
  // 集計は支出を正の数で持ち、画面は符号付きで出したい。単純に `-x` と書くと
  // 支出0の月（収入だけの月は普通にある）で -0 になり、-￥0 と表示される。
  it("0 を渡すと +0 が返る（-0 ではない）", () => {
    expect(Object.is(negateExpense(0), 0)).toBe(true);
  });

  it("-0 を渡しても +0 が返る", () => {
    expect(Object.is(negateExpense(-0), 0)).toBe(true);
  });

  it("+0 の戻り値は Intl.NumberFormat で -￥0 にならない", () => {
    const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });
    expect(yen.format(negateExpense(0))).not.toContain("-");
  });

  it.each([
    [1, -1],
    [42202, -42202],
    [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER],
  ])("正の支出 %i は %i になる", (input, expected) => {
    expect(negateExpense(input)).toBe(expected);
  });

  it("2回かけると元に戻る（0以外）", () => {
    expect(negateExpense(negateExpense(1500))).toBe(1500);
  });

  it("支出ゼロの月の合計を反転しても -0 にならない", () => {
    const incomeOnly: StoredTransaction[] = [
      tx({ date: "2026-08-01", amountYen: 250000 }),
    ];
    const total = at(sumByMonth(incomeOnly), 0);
    expectPlusZero(negateExpense(total.expenseYen));
  });
});

describe("shiftMonth", () => {
  describe("月を1つ動かす", () => {
    it("翌月を返す", () => {
      expect(shiftMonth("2026-07", 1)).toBe("2026-08");
    });

    it("前月を返す", () => {
      expect(shiftMonth("2026-07", -1)).toBe("2026-06");
    });

    it("0 なら同じ月をそのまま返す", () => {
      expect(shiftMonth("2026-07", 0)).toBe("2026-07");
    });
  });

  describe("年をまたぐ", () => {
    it("12月の翌月は翌年の1月", () => {
      expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    });

    it("1月の前月は前年の12月", () => {
      expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    });

    it("12か月動かすと同じ月の翌年になる", () => {
      expect(shiftMonth("2026-07", 12)).toBe("2027-07");
    });

    it("-12 で同じ月の前年になる", () => {
      expect(shiftMonth("2026-07", -12)).toBe("2025-07");
    });

    it("1年をまたぐ大きさで動かす（+18 は1年半後）", () => {
      expect(shiftMonth("2026-07", 18)).toBe("2028-01");
    });

    it("1年をまたぐ大きさで戻す（-18 は1年半前）", () => {
      expect(shiftMonth("2026-07", -18)).toBe("2025-01");
    });

    it("閏年をまたいでも月キーの計算には影響しない（2024-02 の1年後）", () => {
      expect(shiftMonth("2024-02", 12)).toBe("2025-02");
    });
  });

  describe("すべての月で成り立つ", () => {
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

    it.each(months)("2026-%s の1か月後は、月が1つ進むか翌年の01になる", (mm) => {
      const number = Number(mm);
      const expected = number === 12 ? "2027-01" : `2026-${String(number + 1).padStart(2, "0")}`;

      expect(shiftMonth(`2026-${mm}`, 1)).toBe(expected);
    });

    it.each(months)("2026-%s は +1 のあと -1 で元に戻る", (mm) => {
      expect(shiftMonth(shiftMonth(`2026-${mm}`, 1), -1)).toBe(`2026-${mm}`);
    });

    it("1か月ずつ24回動かすと、+24 と同じ月になる", () => {
      let stepped = "2026-03";
      for (let i = 0; i < 24; i += 1) {
        stepped = shiftMonth(stepped, 1);
      }

      expect(stepped).toBe(shiftMonth("2026-03", 24));
      expect(stepped).toBe("2028-03");
    });

    it("1か月ずつ進めると、12か月で12個の異なる月が現れる（同じ月に留まらない）", () => {
      const seen = new Set<string>();
      let stepped = "2026-01";
      for (let i = 0; i < 12; i += 1) {
        stepped = shiftMonth(stepped, 1);
        seen.add(stepped);
      }

      expect(seen.size).toBe(12);
    });
  });

  describe("ゼロ埋め", () => {
    // 境界（parseDate）が絞る範囲の外でも4桁に詰まることを見る。詰めないと
    // 日付順の比較（文字列の辞書順）が壊れる。
    it("年を4桁に詰める（0099-01 の翌月）", () => {
      expect(shiftMonth("0099-01", 1)).toBe("0099-02");
    });

    it("3桁の年も4桁に詰める（0099-12 の翌月は 0100-01）", () => {
      expect(shiftMonth("0099-12", 1)).toBe("0100-01");
    });

    it("1桁の年も4桁に詰める（0001-12 の翌月は 0002-01）", () => {
      expect(shiftMonth("0001-12", 1)).toBe("0002-01");
    });

    it("100未満の年を戻しても4桁のまま（0005-01 の前月は 0004-12）", () => {
      expect(shiftMonth("0005-01", -1)).toBe("0004-12");
    });

    it("月を2桁に詰める（12月から2か月戻すと 10、9か月戻すと 03）", () => {
      expect(shiftMonth("2026-12", -2)).toBe("2026-10");
      expect(shiftMonth("2026-12", -9)).toBe("2026-03");
    });

    it("結果は常に YYYY-MM の7文字", () => {
      for (const step of [-25, -13, -1, 0, 1, 13, 25]) {
        expect(shiftMonth("0099-06", step)).toMatch(/^\d{4}-\d{2}$/);
      }
    });
  });

  describe("月キーの順序が保たれる", () => {
    it("進めた月は元の月より辞書順で後ろ（年をまたいでも）", () => {
      expect(shiftMonth("2026-12", 1) > "2026-12").toBe(true);
      expect(shiftMonth("0099-12", 1) > "0099-12").toBe(true);
    });

    it("戻した月は元の月より辞書順で前（年をまたいでも）", () => {
      expect(shiftMonth("2026-01", -1) < "2026-01").toBe(true);
      expect(shiftMonth("0100-01", -1) < "0100-01").toBe(true);
    });
  });

  it("引数の月キーを読むだけで、返る文字列は新しい値", () => {
    const month = "2026-07";

    expect(shiftMonth(month, 3)).toBe("2026-10");
    expect(month).toBe("2026-07");
  });
});

describe("inCategory", () => {
  describe("null は絞り込まない", () => {
    it("全件を返す", () => {
      const transactions = [
        tx({ id: "a", category: "食費" }),
        tx({ id: "b", category: "交通費" }),
      ];

      expect(inCategory(transactions, null).map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("入力の配列そのものは返さない（呼び出し側の書き換えが波及しない）", () => {
      const input = [tx({ category: "食費" })];

      expect(inCategory(input, null)).not.toBe(input);
    });

    it("空の配列でも空で返る", () => {
      expect(inCategory([], null)).toEqual([]);
    });
  });

  describe("カテゴリでの絞り込み", () => {
    it("指定したカテゴリの取引だけを返す", () => {
      const transactions = [
        tx({ id: "a", category: "食費" }),
        tx({ id: "b", category: "交通費" }),
        tx({ id: "c", category: "食費" }),
      ];

      expect(inCategory(transactions, "食費").map((t) => t.id)).toEqual(["a", "c"]);
    });

    it("元の並び順を保つ", () => {
      const transactions = [
        tx({ id: "a", category: "食費", date: "2026-03-01" }),
        tx({ id: "b", category: "交通費", date: "2026-01-01" }),
        tx({ id: "c", category: "食費", date: "2026-02-01" }),
        tx({ id: "d", category: "食費", date: "2026-01-15" }),
      ];

      expect(inCategory(transactions, "食費").map((t) => t.id)).toEqual(["a", "c", "d"]);
    });

    it("該当が無ければ空の配列", () => {
      expect(inCategory([tx({ category: "食費" })], "交通費")).toEqual([]);
    });

    it("空の配列を渡すと空で返る", () => {
      expect(inCategory([], "食費")).toEqual([]);
    });

    it("取引そのものは複製せず、同じ参照を返す", () => {
      const transaction = tx({ category: "食費" });

      expect(at(inCategory([transaction], "食費"), 0)).toBe(transaction);
    });
  });

  describe("照合は完全一致", () => {
    it.each([["食"], ["食費類"], ["費"], [" 食費"], ["食費 "], ["しょくひ"]])(
      "%s は 食費 に一致しない",
      (category) => {
        expect(inCategory([tx({ category: "食費" })], category)).toEqual([]);
      },
    );

    it("空文字は空文字のカテゴリにだけ一致する", () => {
      const transactions = [tx({ id: "a", category: "" }), tx({ id: "b", category: "食費" })];

      expect(inCategory(transactions, "").map((t) => t.id)).toEqual(["a"]);
    });
  });

  describe("収入と未分類も同じ経路で絞れる", () => {
    it("収入のカテゴリで絞ると収入だけが残る", () => {
      const transactions = [
        tx({ id: "a", category: "収入", amountYen: 250000 }),
        tx({ id: "b", category: "食費", amountYen: -1200 }),
      ];

      expect(inCategory(transactions, "収入").map((t) => t.id)).toEqual(["a"]);
    });

    it("支出のカテゴリで絞ると収入は残らない", () => {
      const transactions = [
        tx({ id: "a", category: "収入", amountYen: 250000 }),
        tx({ id: "b", category: "食費", amountYen: -1200 }),
      ];

      expect(inCategory(transactions, "食費").map((t) => t.id)).toEqual(["b"]);
    });

    it("未分類で絞ると未分類だけが残る", () => {
      const transactions = [
        tx({ id: "a", category: UNCATEGORIZED }),
        tx({ id: "b", category: "食費" }),
      ];

      expect(inCategory(transactions, UNCATEGORIZED).map((t) => t.id)).toEqual(["a"]);
    });
  });

  describe("入力を書き換えない", () => {
    it("凍結された配列を渡しても動く", () => {
      const transactions = Object.freeze([
        Object.freeze(tx({ id: "a", category: "食費" })),
        Object.freeze(tx({ id: "b", category: "交通費" })),
      ]) as readonly StoredTransaction[];

      expect(inCategory(transactions, "食費").map((t) => t.id)).toEqual(["a"]);
    });

    it("呼び出し後も元の配列の長さと順序が変わらない", () => {
      const transactions = [
        tx({ id: "a", category: "食費" }),
        tx({ id: "b", category: "交通費" }),
      ];

      inCategory(transactions, "食費");

      expect(transactions.map((t) => t.id)).toEqual(["a", "b"]);
    });
  });

  it("絞り込んだ結果の合計が、そのカテゴリの合計と一致する", () => {
    const transactions = [
      tx({ category: "食費", amountYen: -1200, date: "2026-01-05" }),
      tx({ category: "交通費", amountYen: -500, date: "2026-01-06" }),
      tx({ category: "食費", amountYen: -800, date: "2026-01-07" }),
    ];

    const summed = sumByMonth(inCategory(transactions, "食費"));

    expect(at(summed, 0).expenseYen).toBe(2000);
  });
});

describe("sumAll", () => {
  describe("空と 0", () => {
    it("空の配列は支出も収入も 0", () => {
      expect(sumAll([])).toEqual({ expenseYen: 0, incomeYen: 0 });
    });

    it("空の配列の expenseYen は +0（-0 にならない）", () => {
      expectPlusZero(sumAll([]).expenseYen);
    });

    it("支出だけのとき incomeYen は +0", () => {
      expectPlusZero(sumAll([tx({ amountYen: -1200 })]).incomeYen);
    });

    it("収入だけのとき expenseYen は +0", () => {
      expectPlusZero(sumAll([tx({ amountYen: 250000 })]).expenseYen);
    });

    it("0円の取引はどちらにも数えない", () => {
      expect(sumAll([tx({ amountYen: 0 })])).toEqual({ expenseYen: 0, incomeYen: 0 });
    });

    it("-0 円の取引もどちらにも数えない", () => {
      const total = sumAll([tx({ amountYen: -0 })]);

      expectPlusZero(total.expenseYen);
      expectPlusZero(total.incomeYen);
    });
  });

  describe("符号ごとに合計する", () => {
    it("支出は符号を反転した正の数で返る", () => {
      expect(sumAll([tx({ amountYen: -1200 })]).expenseYen).toBe(1200);
    });

    it("収入はそのままの正の数で返る", () => {
      expect(sumAll([tx({ amountYen: 250000 })]).incomeYen).toBe(250000);
    });

    it("支出と収入は相殺されない", () => {
      const total = sumAll([tx({ amountYen: -1000 }), tx({ amountYen: 1000 })]);

      expect(total).toEqual({ expenseYen: 1000, incomeYen: 1000 });
    });

    it("複数件を足し合わせる", () => {
      const total = sumAll([
        tx({ amountYen: -1200 }),
        tx({ amountYen: -800 }),
        tx({ amountYen: 250000 }),
      ]);

      expect(total).toEqual({ expenseYen: 2000, incomeYen: 250000 });
    });

    it("1件だけならその額", () => {
      expect(sumAll([tx({ amountYen: -42202 })])).toEqual({ expenseYen: 42202, incomeYen: 0 });
    });
  });

  describe("期間で割らない", () => {
    it("月をまたいでも1つの合計になる", () => {
      const total = sumAll([
        tx({ date: "2026-06-30", amountYen: -1000 }),
        tx({ date: "2026-07-01", amountYen: -2000 }),
        tx({ date: "2027-01-01", amountYen: -3000 }),
      ]);

      expect(total.expenseYen).toBe(6000);
    });

    it("同じ集合を渡せば、月別の合計を足し上げた値と一致する", () => {
      const transactions = [
        tx({ date: "2026-06-30", amountYen: -1000 }),
        tx({ date: "2026-07-01", amountYen: -2000 }),
        tx({ date: "2026-07-02", amountYen: 5000 }),
      ];
      const byMonth = sumByMonth(transactions);

      expect(sumAll(transactions)).toEqual({
        expenseYen: byMonth.reduce((sum, month) => sum + month.expenseYen, 0),
        incomeYen: byMonth.reduce((sum, month) => sum + month.incomeYen, 0),
      });
    });

    it("並び順を変えても同じ合計になる", () => {
      const transactions = [
        tx({ date: "2026-07-01", amountYen: -1000 }),
        tx({ date: "2026-06-01", amountYen: 2000 }),
        tx({ date: "2026-08-01", amountYen: -3000 }),
      ];

      expect(sumAll([...transactions].reverse())).toEqual(sumAll(transactions));
    });
  });

  describe("入力を書き換えない", () => {
    it("呼び出しの前後で内容が変わらない", () => {
      expectInputUnchanged(
        [tx({ amountYen: -1200 }), tx({ amountYen: 250000 })],
        (input) => sumAll(input),
      );
    });

    it("凍結された配列を渡しても動く", () => {
      const transactions = Object.freeze([
        Object.freeze(tx({ amountYen: -1200 })),
      ]) as readonly StoredTransaction[];

      expect(sumAll(transactions)).toEqual({ expenseYen: 1200, incomeYen: 0 });
    });
  });
});

describe("yearOf", () => {
  it("YYYY-MM-DD から YYYY を取り出す", () => {
    expect(yearOf("2026-01-15")).toBe("2026");
  });

  it("元日でもその年を返す", () => {
    expect(yearOf("2026-01-01")).toBe("2026");
  });

  it("大晦日でも翌年に繰り上がらない", () => {
    expect(yearOf("2026-12-31")).toBe("2026");
  });

  it("同じ年の別の日は同じ値", () => {
    expect(yearOf("2026-03-01")).toBe(yearOf("2026-11-28"));
  });

  it("年をまたぐと違う値", () => {
    expect(yearOf("2025-12-31")).not.toBe(yearOf("2026-01-01"));
  });
});

describe("sumByYear", () => {
  it("空なら空配列", () => {
    expect(sumByYear([])).toEqual([]);
  });

  it("同じ年の取引が1つにまとまる", () => {
    const totals = sumByYear([
      tx({ date: "2026-01-05", amountYen: -100 }),
      tx({ date: "2026-12-25", amountYen: -200 }),
    ]);

    expect(totals).toEqual([{ period: "2026", expenseYen: 300, incomeYen: 0 }]);
  });

  it("違う年は別のエントリになる", () => {
    const totals = sumByYear([
      tx({ date: "2025-12-31", amountYen: -100 }),
      tx({ date: "2026-01-01", amountYen: -200 }),
    ]);

    expect(periodsOf(totals)).toEqual(["2025", "2026"]);
  });

  it("period は4桁の年で、月を含まない", () => {
    expect(at(sumByYear([tx({ date: "2026-07-09", amountYen: -100 })]), 0).period).toBe("2026");
  });

  it("年の昇順で返る（入力順に依存しない）", () => {
    const totals = sumByYear([
      tx({ date: "2027-01-01", amountYen: -300 }),
      tx({ date: "2025-01-01", amountYen: -100 }),
      tx({ date: "2026-01-01", amountYen: -200 }),
    ]);

    expect(periodsOf(totals)).toEqual(["2025", "2026", "2027"]);
  });

  it("支出と収入を別々に合計する", () => {
    const totals = sumByYear([
      tx({ date: "2026-03-01", amountYen: -1200 }),
      tx({ date: "2026-08-01", amountYen: 300000 }),
    ]);

    expect(at(totals, 0)).toEqual({ period: "2026", expenseYen: 1200, incomeYen: 300000 });
  });

  it("支出だけの年でも incomeYen は +0（-0 にならない）", () => {
    expectPlusZero(at(sumByYear([tx({ date: "2026-03-01", amountYen: -1200 })]), 0).incomeYen);
  });

  it("年の合計が、その年の月別合計の総和と一致する", () => {
    const transactions = [
      tx({ date: "2026-01-15", amountYen: -1000 }),
      tx({ date: "2026-06-15", amountYen: -2000 }),
      tx({ date: "2026-12-15", amountYen: 5000 }),
    ];
    const byMonth = sumByMonth(transactions);

    expect(at(sumByYear(transactions), 0)).toEqual({
      period: "2026",
      expenseYen: byMonth.reduce((sum, m) => sum + m.expenseYen, 0),
      incomeYen: byMonth.reduce((sum, m) => sum + m.incomeYen, 0),
    });
  });

  it("入力を書き換えない", () => {
    expectInputUnchanged([tx({ date: "2026-01-15" })], (input) => sumByYear(input));
  });
});

describe("inRange", () => {
  const transactions = [
    tx({ id: "a", date: "2026-06-30" }),
    tx({ id: "b", date: "2026-07-01" }),
    tx({ id: "c", date: "2026-07-15" }),
    tx({ id: "d", date: "2026-07-31" }),
    tx({ id: "e", date: "2026-08-01" }),
  ];

  function idsIn(from: string, to: string): string[] {
    return inRange(transactions, from, to).map((t) => t.id);
  }

  describe("両端を含む", () => {
    it("開始日の取引を含む", () => {
      expect(idsIn("2026-07-01", "2026-07-31")).toContain("b");
    });

    it("終了日の取引を含む", () => {
      expect(idsIn("2026-07-01", "2026-07-31")).toContain("d");
    });

    it("範囲の外は含まない", () => {
      const ids = idsIn("2026-07-01", "2026-07-31");
      expect(ids).not.toContain("a");
      expect(ids).not.toContain("e");
    });

    it("範囲内だけが順序を保って返る", () => {
      expect(idsIn("2026-07-01", "2026-07-31")).toEqual(["b", "c", "d"]);
    });
  });

  describe("境界のすぐ外", () => {
    it("開始日の前日は含まれない", () => {
      expect(idsIn("2026-07-01", "2026-12-31")).not.toContain("a");
    });

    it("終了日の翌日は含まれない", () => {
      expect(idsIn("2026-01-01", "2026-07-31")).not.toContain("e");
    });

    it("1日だけの範囲はその日だけ返る", () => {
      expect(idsIn("2026-07-15", "2026-07-15")).toEqual(["c"]);
    });

    it("該当が無い1日の範囲は空", () => {
      expect(idsIn("2026-07-16", "2026-07-16")).toEqual([]);
    });
  });

  describe("端のケース", () => {
    it("空の配列は空を返す", () => {
      expect(inRange([], "2026-01-01", "2026-12-31")).toEqual([]);
    });

    it("すべてを含む範囲なら全件返る", () => {
      expect(idsIn("2000-01-01", "2099-12-31")).toEqual(["a", "b", "c", "d", "e"]);
    });

    // 入力欄で日付を2つ選ばせる以上、逆転した状態は普通に作れる。
    // 例外ではなく「該当なし」を返す。
    it("from が to より後なら空（例外を投げない）", () => {
      expect(idsIn("2026-08-01", "2026-07-01")).toEqual([]);
    });

    it("年をまたぐ範囲も引ける", () => {
      const across = [tx({ id: "x", date: "2025-12-31" }), tx({ id: "y", date: "2026-01-01" })];

      expect(inRange(across, "2025-12-01", "2026-01-31").map((t) => t.id)).toEqual(["x", "y"]);
    });
  });

  describe("入力を書き換えない", () => {
    it("入力の配列そのものは返さない", () => {
      expect(inRange(transactions, "2000-01-01", "2099-12-31")).not.toBe(transactions);
    });

    it("呼び出しの前後で内容が変わらない", () => {
      expectInputUnchanged([...transactions], (input) =>
        inRange(input, "2026-07-01", "2026-07-31"),
      );
    });
  });

  it("月の範囲を指定すると inMonth と同じ結果になる", () => {
    expect(inRange(transactions, "2026-07-01", "2026-07-31")).toEqual(
      inMonth(transactions, "2026-07"),
    );
  });
});

describe("shiftYear", () => {
  it("翌年を返す", () => {
    expect(shiftYear("2026", 1)).toBe("2027");
  });

  it("前年を返す", () => {
    expect(shiftYear("2026", -1)).toBe("2025");
  });

  it("0 なら同じ年", () => {
    expect(shiftYear("2026", 0)).toBe("2026");
  });

  it("世紀をまたぐ", () => {
    expect(shiftYear("2099", 1)).toBe("2100");
    expect(shiftYear("2100", -1)).toBe("2099");
  });

  it("何年でも動かせる", () => {
    expect(shiftYear("2026", 10)).toBe("2036");
    expect(shiftYear("2026", -10)).toBe("2016");
  });

  it("進めてから戻すと元に戻る", () => {
    expect(shiftYear(shiftYear("2026", 3), -3)).toBe("2026");
  });

  describe("ゼロ埋め", () => {
    it("4桁に詰める（0099 の翌年は 0100）", () => {
      expect(shiftYear("0099", 1)).toBe("0100");
    });

    it("100未満の年も4桁のまま", () => {
      expect(shiftYear("0005", -1)).toBe("0004");
    });

    it("3桁になる引き算も4桁で返る", () => {
      expect(shiftYear("0100", -1)).toBe("0099");
    });

    it("結果は常に4桁", () => {
      for (const step of [-50, -1, 0, 1, 50]) {
        expect(shiftYear("0100", step)).toMatch(/^\d{4}$/);
      }
    });
  });

  describe("順序が保たれる", () => {
    it("進めた年は辞書順で後ろ", () => {
      expect(shiftYear("0099", 1) > "0099").toBe(true);
    });

    it("戻した年は辞書順で前", () => {
      expect(shiftYear("0100", -1) < "0100").toBe(true);
    });
  });

  it("12か月動かした shiftMonth の年と一致する", () => {
    expect(shiftMonth("2026-07", 12).slice(0, 4)).toBe(shiftYear("2026", 1));
  });
});

describe("netYen", () => {
  it("収入が多ければ正になる", () => {
    expect(netYen({ expenseYen: 30000, incomeYen: 250000 })).toBe(220000);
  });

  it("支出が多ければ負になる", () => {
    expect(netYen({ expenseYen: 250000, incomeYen: 30000 })).toBe(-220000);
  });

  it("同額なら 0", () => {
    expect(netYen({ expenseYen: 1000, incomeYen: 1000 })).toBe(0);
  });

  it("同額のときの 0 は +0（-￥0 と表示されない）", () => {
    expectPlusZero(netYen({ expenseYen: 1000, incomeYen: 1000 }));
  });

  it("両方 0 なら +0", () => {
    expectPlusZero(netYen({ expenseYen: 0, incomeYen: 0 }));
  });

  it("収入だけなら収入の額そのもの", () => {
    expect(netYen({ expenseYen: 0, incomeYen: 250000 })).toBe(250000);
  });

  it("支出だけなら支出の符号を反転した額", () => {
    expect(netYen({ expenseYen: 42202, incomeYen: 0 })).toBe(-42202);
  });

  it("1円の差も出る", () => {
    expect(netYen({ expenseYen: 1000, incomeYen: 1001 })).toBe(1);
    expect(netYen({ expenseYen: 1001, incomeYen: 1000 })).toBe(-1);
  });

  it("sumByMonth の結果をそのまま渡せる", () => {
    const total = at(
      sumByMonth([
        tx({ date: "2026-07-01", amountYen: -1200 }),
        tx({ date: "2026-07-25", amountYen: 300000 }),
      ]),
      0,
    );

    expect(netYen(total)).toBe(298800);
  });

  it("sumAll の結果をそのまま渡せる", () => {
    expect(netYen(sumAll([tx({ amountYen: -1000 }), tx({ amountYen: 4000 })]))).toBe(3000);
  });

  it("空の集計は +0", () => {
    expectPlusZero(netYen(sumAll([])));
  });
});
