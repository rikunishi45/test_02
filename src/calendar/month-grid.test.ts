import { describe, it, expect } from "vitest";
import type { PeriodTotal } from "../aggregate/period.js";
import { monthGrid, type CalendarCell } from "./month-grid.js";

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`index ${index} の要素が存在しない（length=${items.length}）`);
  }
  return item;
}

function totalOf(period: string, expenseYen: number, incomeYen = 0): PeriodTotal {
  return { period, expenseYen, incomeYen };
}

function flatten(weeks: readonly (readonly CalendarCell[])[]): CalendarCell[] {
  return weeks.flatMap((week) => [...week]);
}

function isBlank(cell: CalendarCell): boolean {
  return cell.date === null;
}

function filledCells(weeks: readonly (readonly CalendarCell[])[]): CalendarCell[] {
  return flatten(weeks).filter((cell) => !isBlank(cell));
}

function countLeadingBlanks(cells: readonly CalendarCell[]): number {
  const index = cells.findIndex((cell) => !isBlank(cell));
  return index === -1 ? cells.length : index;
}

function countTrailingBlanks(cells: readonly CalendarCell[]): number {
  return countLeadingBlanks([...cells].reverse());
}

const BLANK: CalendarCell = { date: null, day: null, expenseYen: 0 };

/** date コマンドで裏を取った実測値 */
interface MonthCase {
  month: string;
  firstWeekday: number;
  lastDay: number;
  leadingBlanks: number;
  weeks: number;
  trailingBlanks: number;
}

const MONTH_CASES: readonly MonthCase[] = [
  { month: "2026-02", firstWeekday: 0, lastDay: 28, leadingBlanks: 0, weeks: 4, trailingBlanks: 0 },
  { month: "2026-03", firstWeekday: 0, lastDay: 31, leadingBlanks: 0, weeks: 5, trailingBlanks: 4 },
  { month: "2026-07", firstWeekday: 3, lastDay: 31, leadingBlanks: 3, weeks: 5, trailingBlanks: 1 },
  { month: "2026-08", firstWeekday: 6, lastDay: 31, leadingBlanks: 6, weeks: 6, trailingBlanks: 5 },
  { month: "2026-11", firstWeekday: 0, lastDay: 30, leadingBlanks: 0, weeks: 5, trailingBlanks: 5 },
  { month: "2024-02", firstWeekday: 4, lastDay: 29, leadingBlanks: 4, weeks: 5, trailingBlanks: 2 },
  { month: "2100-02", firstWeekday: 1, lastDay: 28, leadingBlanks: 1, weeks: 5, trailingBlanks: 6 },
];

describe("monthGrid — グリッドの形", () => {
  describe.each(MONTH_CASES)(
    "$month",
    ({ month, firstWeekday, lastDay, leadingBlanks, weeks, trailingBlanks }) => {
      it(`${weeks}週になる`, () => {
        expect(monthGrid(month, []).length).toBe(weeks);
      });

      it("各週はちょうど7セル", () => {
        expect(monthGrid(month, []).map((week) => week.length)).toEqual(
          Array.from({ length: weeks }, () => 7),
        );
      });

      it(`総セル数は ${weeks * 7}`, () => {
        expect(flatten(monthGrid(month, [])).length).toBe(weeks * 7);
      });

      it(`先頭の空白は ${leadingBlanks} 個`, () => {
        expect(countLeadingBlanks(flatten(monthGrid(month, [])))).toBe(leadingBlanks);
      });

      it(`末尾の空白は ${trailingBlanks} 個`, () => {
        expect(countTrailingBlanks(flatten(monthGrid(month, [])))).toBe(trailingBlanks);
      });

      it("空白でないセルは月の日数と同じ個数", () => {
        expect(filledCells(monthGrid(month, [])).length).toBe(lastDay);
      });

      it("weeks[0] の中で day === 1 のセルの添字が、1日の曜日と一致する", () => {
        const firstWeek = at(monthGrid(month, []), 0);
        expect(firstWeek.findIndex((cell) => cell.day === 1)).toBe(firstWeekday);
      });

      it("day が 1 から月末日まで、飛ばさず重複せずに並ぶ", () => {
        const days = filledCells(monthGrid(month, [])).map((cell) => cell.day);
        expect(days).toEqual(Array.from({ length: lastDay }, (_, index) => index + 1));
      });

      it("date の末尾2桁が day と一致する（2桁ゼロ埋め）", () => {
        const mismatched = filledCells(monthGrid(month, [])).filter(
          (cell) => cell.date !== `${month}-${String(cell.day).padStart(2, "0")}`,
        );
        expect(mismatched).toEqual([]);
      });

      it("date の月の部分がすべて対象月と一致する（前月・翌月が混ざらない）", () => {
        const foreign = filledCells(monthGrid(month, []))
          .map((cell) => cell.date)
          .filter((date) => date === null || date.slice(0, 7) !== month);
        expect(foreign).toEqual([]);
      });

      it("空白セルは date も day も null で expenseYen は 0", () => {
        const blanks = flatten(monthGrid(month, [])).filter(isBlank);
        expect(blanks).toEqual(Array.from({ length: weeks * 7 - lastDay }, () => BLANK));
      });

      it("空白は先頭と末尾にだけ現れ、月の途中では途切れない", () => {
        const cells = flatten(monthGrid(month, []));
        const middle = cells.slice(leadingBlanks, cells.length - trailingBlanks);
        expect(middle.filter(isBlank)).toEqual([]);
        expect(middle.length).toBe(lastDay);
      });
    },
  );

  it("2026-02 は先頭も末尾も空白ゼロで、ちょうど4週になる（常に空白を足す・常に6週返す実装を落とす）", () => {
    const weeks = monthGrid("2026-02", []);
    expect(weeks.length).toBe(4);
    expect(flatten(weeks).filter(isBlank)).toEqual([]);
    expect(at(at(weeks, 0), 0)).toEqual({ date: "2026-02-01", day: 1, expenseYen: 0 });
    expect(at(at(weeks, 3), 6)).toEqual({ date: "2026-02-28", day: 28, expenseYen: 0 });
  });

  it("2026-02 の第1週は 1〜7 日がそのまま並ぶ", () => {
    expect(at(monthGrid("2026-02", []), 0)).toEqual([
      { date: "2026-02-01", day: 1, expenseYen: 0 },
      { date: "2026-02-02", day: 2, expenseYen: 0 },
      { date: "2026-02-03", day: 3, expenseYen: 0 },
      { date: "2026-02-04", day: 4, expenseYen: 0 },
      { date: "2026-02-05", day: 5, expenseYen: 0 },
      { date: "2026-02-06", day: 6, expenseYen: 0 },
      { date: "2026-02-07", day: 7, expenseYen: 0 },
    ]);
  });

  it("2026-08 の第1週は空白6個のあとに1日が来る（反対側の端）", () => {
    expect(at(monthGrid("2026-08", []), 0)).toEqual([
      BLANK,
      BLANK,
      BLANK,
      BLANK,
      BLANK,
      BLANK,
      { date: "2026-08-01", day: 1, expenseYen: 0 },
    ]);
  });

  it("2026-08 は6週になり、最終週は 30・31 日のあと空白5個で終わる", () => {
    const weeks = monthGrid("2026-08", []);
    expect(weeks.length).toBe(6);
    expect(at(weeks, 5)).toEqual([
      { date: "2026-08-30", day: 30, expenseYen: 0 },
      { date: "2026-08-31", day: 31, expenseYen: 0 },
      BLANK,
      BLANK,
      BLANK,
      BLANK,
      BLANK,
    ]);
  });

  it("2024-02 は閏年なので29日まで並ぶ", () => {
    const days = filledCells(monthGrid("2024-02", [])).map((cell) => cell.day);
    expect(days[days.length - 1]).toBe(29);
    expect(filledCells(monthGrid("2024-02", [])).map((cell) => cell.date)).toContain("2024-02-29");
  });

  it("2100-02 は世紀の例外で平年なので28日で終わる（29日は現れない）", () => {
    const dates = filledCells(monthGrid("2100-02", [])).map((cell) => cell.date);
    expect(dates[dates.length - 1]).toBe("2100-02-28");
    expect(dates).not.toContain("2100-02-29");
  });

  it("2026-02 は平年なので28日で終わる（29日は現れない）", () => {
    const dates = filledCells(monthGrid("2026-02", [])).map((cell) => cell.date);
    expect(dates[dates.length - 1]).toBe("2026-02-28");
    expect(dates).not.toContain("2026-02-29");
  });

  it("30日の月は30日で終わる（2026-11）", () => {
    const dates = filledCells(monthGrid("2026-11", [])).map((cell) => cell.date);
    expect(dates[dates.length - 1]).toBe("2026-11-30");
    expect(dates).not.toContain("2026-11-31");
  });

  it("同じ列に並ぶ日は7日ずつ離れている（2026-07 の日曜列）", () => {
    const sundays = monthGrid("2026-07", [])
      .map((week) => at(week, 0))
      .filter((cell) => !isBlank(cell))
      .map((cell) => cell.day);
    expect(sundays).toEqual([5, 12, 19, 26]);
  });
});

describe("monthGrid — 支出の割り当て", () => {
  it("period が一致する日のセルに expenseYen が入る", () => {
    const weeks = monthGrid("2026-07", [
      totalOf("2026-07-01", 1200),
      totalOf("2026-07-15", 3400),
      totalOf("2026-07-31", 560),
    ]);
    const byDate = new Map(
      filledCells(weeks).map((cell): [string | null, number] => [cell.date, cell.expenseYen]),
    );
    expect([byDate.get("2026-07-01"), byDate.get("2026-07-15"), byDate.get("2026-07-31")]).toEqual([
      1200, 3400, 560,
    ]);
  });

  it("一致するものが無い日は 0 になる", () => {
    const weeks = monthGrid("2026-07", [totalOf("2026-07-15", 3400)]);
    const zeroDays = filledCells(weeks)
      .filter((cell) => cell.expenseYen === 0)
      .map((cell) => cell.day);
    expect(zeroDays.length).toBe(30);
    expect(zeroDays).not.toContain(15);
  });

  it("dailyTotals が空でも、その月の全日が expenseYen: 0 で並ぶ", () => {
    const weeks = monthGrid("2026-07", []);
    const cells = filledCells(weeks);
    expect(cells.length).toBe(31);
    expect(cells.map((cell) => cell.expenseYen)).toEqual(Array.from({ length: 31 }, () => 0));
  });

  it("expenseYen が 0 のエントリでも 0 のまま（欠損と区別せず 0）", () => {
    const weeks = monthGrid("2026-07", [totalOf("2026-07-10", 0)]);
    const cell = filledCells(weeks).find((item) => item.date === "2026-07-10");
    expect(cell).toEqual({ date: "2026-07-10", day: 10, expenseYen: 0 });
  });

  it("incomeYen は無視される（収入だけの日は expenseYen: 0）", () => {
    const weeks = monthGrid("2026-07", [totalOf("2026-07-20", 0, 250000)]);
    const cell = filledCells(weeks).find((item) => item.date === "2026-07-20");
    expect(cell).toEqual({ date: "2026-07-20", day: 20, expenseYen: 0 });
  });

  describe("その月に属さない period は無視される", () => {
    it("前月・翌月・前年同月の日付はグリッドに現れず、値も混ざらない", () => {
      const weeks = monthGrid("2026-07", [
        totalOf("2026-06-30", 9999),
        totalOf("2026-08-01", 8888),
        totalOf("2025-07-15", 7777),
        totalOf("2026-07-15", 3400),
      ]);
      const cells = filledCells(weeks);
      expect(cells.map((cell) => cell.date)).not.toContain("2026-06-30");
      expect(cells.map((cell) => cell.date)).not.toContain("2026-08-01");
      expect(cells.map((cell) => cell.expenseYen).filter((yen) => yen !== 0)).toEqual([3400]);
    });

    it("月そのものの文字列（\"2026-07\"）はどの日にも一致しない", () => {
      const weeks = monthGrid("2026-07", [totalOf("2026-07", 5000)]);
      expect(filledCells(weeks).map((cell) => cell.expenseYen)).toEqual(
        Array.from({ length: 31 }, () => 0),
      );
    });

    it("ゼロ埋めされていない日付は一致しない", () => {
      const weeks = monthGrid("2026-07", [totalOf("2026-07-5", 5000)]);
      const cell = filledCells(weeks).find((item) => item.date === "2026-07-05");
      expect(cell?.expenseYen).toBe(0);
    });

    it("その月に属さないエントリだけでも全日 0 で並ぶ", () => {
      const weeks = monthGrid("2026-02", [totalOf("2026-01-31", 1000), totalOf("2026-03-01", 2000)]);
      const cells = filledCells(weeks);
      expect(cells.length).toBe(28);
      expect(cells.map((cell) => cell.expenseYen)).toEqual(Array.from({ length: 28 }, () => 0));
    });
  });

  describe("支出の合計", () => {
    it("グリッド上の総和が、その月に属するエントリの総和と一致する", () => {
      const totals = [
        totalOf("2026-07-01", 1200),
        totalOf("2026-07-15", 3400),
        totalOf("2026-07-31", 560),
        totalOf("2026-06-30", 9999),
        totalOf("2026-08-01", 8888),
      ];
      const gridSum = flatten(monthGrid("2026-07", totals)).reduce(
        (sum, cell) => sum + cell.expenseYen,
        0,
      );
      expect(gridSum).toBe(1200 + 3400 + 560);
    });

    it("月初と月末の両端が合計に含まれる（端が切り落とされていない）", () => {
      const gridSum = flatten(
        monthGrid("2026-08", [totalOf("2026-08-01", 100), totalOf("2026-08-31", 200)]),
      ).reduce((sum, cell) => sum + cell.expenseYen, 0);
      expect(gridSum).toBe(300);
    });

    it("閏日の支出も合計に含まれる（2024-02-29）", () => {
      const weeks = monthGrid("2024-02", [totalOf("2024-02-29", 4321)]);
      const gridSum = flatten(weeks).reduce((sum, cell) => sum + cell.expenseYen, 0);
      expect(gridSum).toBe(4321);
      expect(filledCells(weeks).find((cell) => cell.day === 29)?.expenseYen).toBe(4321);
    });

    it("該当エントリが無ければ総和は 0", () => {
      const gridSum = flatten(monthGrid("2026-11", [])).reduce(
        (sum, cell) => sum + cell.expenseYen,
        0,
      );
      expect(gridSum).toBe(0);
    });
  });
});

describe("monthGrid — 入力を書き換えない", () => {
  it("凍結された配列と要素を渡しても動く", () => {
    const totals = Object.freeze([
      Object.freeze(totalOf("2026-07-01", 1200)),
      Object.freeze(totalOf("2026-07-15", 3400)),
    ]);
    const weeks = monthGrid("2026-07", totals);
    const byDate = new Map(
      filledCells(weeks).map((cell): [string | null, number] => [cell.date, cell.expenseYen]),
    );
    expect([byDate.get("2026-07-01"), byDate.get("2026-07-15")]).toEqual([1200, 3400]);
  });

  it("呼び出し後も dailyTotals の内容が変わらない", () => {
    const totals = [
      totalOf("2026-07-01", 1200),
      totalOf("2026-06-30", 9999),
      totalOf("2026-07-15", 3400),
    ];
    const snapshot = totals.map((total) => ({ ...total }));
    monthGrid("2026-07", totals);
    expect(totals).toEqual(snapshot);
    expect(totals.length).toBe(3);
  });

  it("同じ配列を使い回して別の月を組んでも、互いに影響しない", () => {
    const totals = [totalOf("2026-07-15", 3400), totalOf("2026-08-01", 500)];
    const july = monthGrid("2026-07", totals);
    const august = monthGrid("2026-08", totals);

    expect(flatten(july).reduce((sum, cell) => sum + cell.expenseYen, 0)).toBe(3400);
    expect(flatten(august).reduce((sum, cell) => sum + cell.expenseYen, 0)).toBe(500);
    expect(at(at(august, 0), 6)).toEqual({ date: "2026-08-01", day: 1, expenseYen: 500 });
  });
});
