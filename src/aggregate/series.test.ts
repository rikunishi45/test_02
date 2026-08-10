import { describe, it, expect } from "vitest";
import {
  buildSeries,
  categorySeries,
  EXPENSE_SERIES,
  INCOME_SERIES,
} from "./series.js";
import { sumByMonth, sumByYear } from "./period.js";
import { INCOME, UNCATEGORIZED } from "../category/classify.js";
import type { StoredTransaction } from "../storage/schema.js";

const BASE: StoredTransaction = {
  id: "s0",
  date: "2026-05-10",
  amountYen: -1000,
  description: "店A",
  source: "card",
  category: "食費",
  memo: "",
};

let sequence = 0;

function tx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  sequence += 1;
  return { ...BASE, id: `s${sequence}`, ...overrides };
}

/**
 * 5月・6月・7月。6月は食費が無く、7月に収入がある——「カテゴリの無い期間」と
 * 「支出と収入の両方がある期間」を1つの入力で作る。
 */
const TRANSACTIONS: StoredTransaction[] = [
  tx({ date: "2026-05-10", amountYen: -1000, category: "食費" }),
  tx({ date: "2026-05-20", amountYen: -500, category: "交通費" }),
  tx({ date: "2026-06-10", amountYen: -2000, category: "交通費" }),
  tx({ date: "2026-07-10", amountYen: -3000, category: "食費" }),
  tx({ date: "2026-07-25", amountYen: 250000, category: INCOME }),
];

const MONTHS = sumByMonth(TRANSACTIONS);
const YEARS = sumByYear(TRANSACTIONS);

describe("categorySeries", () => {
  it("カテゴリ名から選択欄の値を作る", () => {
    expect(categorySeries("食費")).toBe("category:食費");
  });

  it("合計の値とぶつからない", () => {
    expect(categorySeries("食費")).not.toBe(EXPENSE_SERIES);
    expect(categorySeries("食費")).not.toBe(INCOME_SERIES);
  });

  /** 印が無いと、`収入` という名前のカテゴリが合計の収入と同じ値になる */
  it("収入という名前のカテゴリでも、合計の収入と区別できる", () => {
    expect(categorySeries(INCOME)).not.toBe(INCOME_SERIES);
  });

  it("印の付いた値はカテゴリとして解釈される", () => {
    const series = buildSeries(TRANSACTIONS, MONTHS, categorySeries(INCOME), "month");

    // 収入の合計ではなく、カテゴリ「収入」の**支出**（0円）を見る
    expect(series.values).toEqual([0, 0, 0]);
    expect(series.income).toBe(false);
  });
});

describe("buildSeries — 支出の合計", () => {
  it("期間ごとの支出を返す", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, EXPENSE_SERIES, "month").values).toEqual([
      1500, 2000, 3000,
    ]);
  });

  it("見出しは「支出」", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, EXPENSE_SERIES, "month").label).toBe("支出");
  });

  it("収入の系列ではない", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, EXPENSE_SERIES, "month").income).toBe(false);
  });

  it("収入を混ぜない", () => {
    const values = buildSeries(TRANSACTIONS, MONTHS, EXPENSE_SERIES, "month").values;

    expect(values[2]).toBe(3000);
  });
});

describe("buildSeries — 収入", () => {
  it("期間ごとの収入を返す", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, INCOME_SERIES, "month").values).toEqual([
      0, 0, 250000,
    ]);
  });

  it("見出しは「収入」", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, INCOME_SERIES, "month").label).toBe("収入");
  });

  it("収入の系列だと分かる", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, INCOME_SERIES, "month").income).toBe(true);
  });

  it("支出を混ぜない", () => {
    const values = buildSeries(TRANSACTIONS, MONTHS, INCOME_SERIES, "month").values;

    expect(values[0]).toBe(0);
  });
});

describe("buildSeries — カテゴリ別", () => {
  it("そのカテゴリの支出だけを返す", () => {
    const series = buildSeries(TRANSACTIONS, MONTHS, categorySeries("食費"), "month");

    expect(series.values).toEqual([1000, 0, 3000]);
  });

  it("取引の無い期間は詰めずに 0 を置く（棒とラベルをずらさない）", () => {
    const series = buildSeries(TRANSACTIONS, MONTHS, categorySeries("食費"), "month");

    expect(series.values).toHaveLength(MONTHS.length);
    expect(series.values[1]).toBe(0);
  });

  it("見出しはカテゴリ名", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, categorySeries("交通費"), "month").label).toBe(
      "交通費",
    );
  });

  it("カテゴリは収入の系列ではない（支出として赤で出す）", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, categorySeries("食費"), "month").income).toBe(false);
  });

  it("別のカテゴリの支出を混ぜない", () => {
    const series = buildSeries(TRANSACTIONS, MONTHS, categorySeries("交通費"), "month");

    expect(series.values).toEqual([500, 2000, 0]);
  });

  it("マスタから消えたカテゴリは全期間 0 になる（落ちない）", () => {
    const series = buildSeries(TRANSACTIONS, MONTHS, categorySeries("存在しない"), "month");

    expect(series.values).toEqual([0, 0, 0]);
    expect(series.label).toBe("存在しない");
  });

  it("未分類も系列にできる", () => {
    const rows = [...TRANSACTIONS, tx({ date: "2026-06-05", amountYen: -700, category: UNCATEGORIZED })];

    const series = buildSeries(rows, sumByMonth(rows), categorySeries(UNCATEGORIZED), "month");

    expect(series.values).toEqual([0, 700, 0]);
  });

  it("カテゴリ名に印と同じ文字列が含まれていても取り違えない", () => {
    const rows = [tx({ date: "2026-05-10", amountYen: -800, category: "category:食費" })];

    const series = buildSeries(rows, sumByMonth(rows), categorySeries("category:食費"), "month");

    expect(series.values).toEqual([800]);
    expect(series.label).toBe("category:食費");
  });
});

describe("buildSeries — 期間の単位", () => {
  it("年で刻むと、年ごとの値を返す", () => {
    expect(buildSeries(TRANSACTIONS, YEARS, EXPENSE_SERIES, "year").values).toEqual([6500]);
  });

  it("年で刻んだカテゴリの系列も年ごとに合算する", () => {
    expect(buildSeries(TRANSACTIONS, YEARS, categorySeries("食費"), "year").values).toEqual([
      4000,
    ]);
  });

  it("年をまたぐカテゴリの系列で、取引の無い年は 0 になる", () => {
    const rows = [
      tx({ date: "2025-05-10", amountYen: -1000, category: "食費" }),
      tx({ date: "2026-05-10", amountYen: -2000, category: "交通費" }),
      tx({ date: "2027-05-10", amountYen: -3000, category: "食費" }),
    ];

    const series = buildSeries(rows, sumByYear(rows), categorySeries("食費"), "year");

    expect(series.values).toEqual([1000, 0, 3000]);
  });

  /** 単位を取り違えると、月の集計を年の軸に並べて全部 0 になる */
  it("月と年で結果が変わる", () => {
    const byMonth = buildSeries(TRANSACTIONS, MONTHS, categorySeries("食費"), "month").values;
    const byYear = buildSeries(TRANSACTIONS, YEARS, categorySeries("食費"), "year").values;

    expect(byMonth).not.toEqual(byYear);
  });
});

describe("buildSeries — 端のケース", () => {
  it("取引が無ければ空の系列", () => {
    expect(buildSeries([], [], EXPENSE_SERIES, "month").values).toEqual([]);
  });

  it("知らない値は支出の合計として扱う", () => {
    const series = buildSeries(TRANSACTIONS, MONTHS, "こわれた値", "month");

    expect(series.values).toEqual([1500, 2000, 3000]);
    expect(series.label).toBe("支出");
    expect(series.income).toBe(false);
  });

  it("空文字列も支出の合計として扱う", () => {
    expect(buildSeries(TRANSACTIONS, MONTHS, "", "month").label).toBe("支出");
  });

  it("期間の数と値の数が必ず一致する", () => {
    for (const series of [EXPENSE_SERIES, INCOME_SERIES, categorySeries("食費")]) {
      expect(buildSeries(TRANSACTIONS, MONTHS, series, "month").values).toHaveLength(
        MONTHS.length,
      );
    }
  });

  it("渡した取引を書き換えない", () => {
    const rows = structuredClone(TRANSACTIONS);

    buildSeries(rows, sumByMonth(rows), categorySeries("食費"), "month");

    expect(rows).toEqual(structuredClone(TRANSACTIONS));
  });
});
