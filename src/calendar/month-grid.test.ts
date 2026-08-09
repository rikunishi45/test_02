import { describe, it, expect } from "vitest";
import type { PeriodTotal } from "../aggregate/period.js";
import {
  cellMagnitude,
  heatOf,
  monthGrid,
  totalOfCells,
  weekGrid,
  type CalendarCell,
} from "./month-grid.js";
import { dayOfWeek } from "../domain/date-parts.js";

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

const BLANK: CalendarCell = { date: null, day: null, expenseYen: 0, incomeYen: 0 };

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
    expect(at(at(weeks, 0), 0)).toEqual({ date: "2026-02-01", day: 1, expenseYen: 0, incomeYen: 0 });
    expect(at(at(weeks, 3), 6)).toEqual({ date: "2026-02-28", day: 28, expenseYen: 0, incomeYen: 0 });
  });

  it("2026-02 の第1週は 1〜7 日がそのまま並ぶ", () => {
    expect(at(monthGrid("2026-02", []), 0)).toEqual([
      { date: "2026-02-01", day: 1, expenseYen: 0, incomeYen: 0 },
      { date: "2026-02-02", day: 2, expenseYen: 0, incomeYen: 0 },
      { date: "2026-02-03", day: 3, expenseYen: 0, incomeYen: 0 },
      { date: "2026-02-04", day: 4, expenseYen: 0, incomeYen: 0 },
      { date: "2026-02-05", day: 5, expenseYen: 0, incomeYen: 0 },
      { date: "2026-02-06", day: 6, expenseYen: 0, incomeYen: 0 },
      { date: "2026-02-07", day: 7, expenseYen: 0, incomeYen: 0 },
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
      { date: "2026-08-01", day: 1, expenseYen: 0, incomeYen: 0 },
    ]);
  });

  it("2026-08 は6週になり、最終週は 30・31 日のあと空白5個で終わる", () => {
    const weeks = monthGrid("2026-08", []);
    expect(weeks.length).toBe(6);
    expect(at(weeks, 5)).toEqual([
      { date: "2026-08-30", day: 30, expenseYen: 0, incomeYen: 0 },
      { date: "2026-08-31", day: 31, expenseYen: 0, incomeYen: 0 },
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
    expect(cell).toEqual({ date: "2026-07-10", day: 10, expenseYen: 0, incomeYen: 0 });
  });

  it("収入だけの日は expenseYen が 0 のまま（収入が支出に混ざらない）", () => {
    const weeks = monthGrid("2026-07", [totalOf("2026-07-20", 0, 250000)]);
    const cell = filledCells(weeks).find((item) => item.date === "2026-07-20");
    expect(cell).toEqual({ date: "2026-07-20", day: 20, expenseYen: 0, incomeYen: 250000 });
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
    expect(at(at(august, 0), 6)).toEqual({ date: "2026-08-01", day: 1, expenseYen: 500, incomeYen: 0 });
  });
});

/** date で引ける形にほぐす。null（空白セル）は除かれる */
function amountsByDate(cells: readonly CalendarCell[]): Map<string, [number, number]> {
  const entries = cells
    .filter((cell): cell is CalendarCell & { date: string } => cell.date !== null)
    .map((cell): [string, [number, number]] => [cell.date, [cell.expenseYen, cell.incomeYen]]);
  return new Map(entries);
}

function amountsOf(cells: readonly CalendarCell[], date: string): [number, number] {
  const found = amountsByDate(cells).get(date);
  if (found === undefined) {
    throw new Error(`${date} のセルが無い`);
  }
  return found;
}

function sumOf(cells: readonly CalendarCell[]): [number, number] {
  return cells.reduce<[number, number]>(
    (sum, cell) => [sum[0] + cell.expenseYen, sum[1] + cell.incomeYen],
    [0, 0],
  );
}

/** cellMagnitude / heatOf に渡すための、実在する日を持つセル */
function cellWith(expenseYen: number, incomeYen: number): CalendarCell {
  return { date: "2026-07-15", day: 15, expenseYen, incomeYen };
}

/** monthGrid が実際に作る空白セル（テスト側で組み立てた偽物ではない） */
function realBlankCell(): CalendarCell {
  const blank = flatten(monthGrid("2026-08", [totalOf("2026-08-15", 5000, 6000)])).find(isBlank);
  if (blank === undefined) {
    throw new Error("2026-08 に空白セルが無い");
  }
  return blank;
}

describe("monthGrid — 収入の割り当て", () => {
  it("period が一致する日のセルに incomeYen が入る", () => {
    const cells = filledCells(
      monthGrid("2026-07", [totalOf("2026-07-01", 0, 250000), totalOf("2026-07-25", 0, 8000)]),
    );
    expect([amountsOf(cells, "2026-07-01"), amountsOf(cells, "2026-07-25")]).toEqual([
      [0, 250000],
      [0, 8000],
    ]);
  });

  it("同じ日に支出と収入の両方があると、両方がそのセルに入る", () => {
    const cells = filledCells(monthGrid("2026-07", [totalOf("2026-07-10", 1200, 5000)]));
    expect(amountsOf(cells, "2026-07-10")).toEqual([1200, 5000]);
  });

  it("支出だけの日は incomeYen が 0、収入だけの日は expenseYen が 0", () => {
    const cells = filledCells(
      monthGrid("2026-07", [totalOf("2026-07-03", 900, 0), totalOf("2026-07-04", 0, 700)]),
    );
    expect([amountsOf(cells, "2026-07-03"), amountsOf(cells, "2026-07-04")]).toEqual([
      [900, 0],
      [0, 700],
    ]);
  });

  it("dailyTotals に無い日は expenseYen も incomeYen も 0", () => {
    const cells = filledCells(monthGrid("2026-07", [totalOf("2026-07-15", 3400, 5000)]));
    const others = cells.filter((cell) => cell.date !== "2026-07-15");
    expect(others.length).toBe(30);
    expect(others.filter((cell) => cell.expenseYen !== 0 || cell.incomeYen !== 0)).toEqual([]);
  });

  it("dailyTotals が空なら、全日が expenseYen: 0 / incomeYen: 0 になる", () => {
    const cells = filledCells(monthGrid("2026-11", []));
    expect(cells.length).toBe(30);
    expect(sumOf(cells)).toEqual([0, 0]);
  });

  it("空白セルは expenseYen も incomeYen も 0", () => {
    const blanks = flatten(
      monthGrid("2026-08", [totalOf("2026-08-01", 1000, 2000), totalOf("2026-08-31", 300, 400)]),
    ).filter(isBlank);
    expect(blanks.length).toBe(11);
    expect(blanks).toEqual(
      Array.from({ length: 11 }, () => ({
        date: null,
        day: null,
        expenseYen: 0,
        incomeYen: 0,
      })),
    );
  });

  it("その月に属さない period の収入は混ざらない", () => {
    const cells = flatten(
      monthGrid("2026-07", [
        totalOf("2026-06-30", 0, 9999),
        totalOf("2026-08-01", 0, 8888),
        totalOf("2026-07-20", 0, 250000),
      ]),
    );
    expect(sumOf(cells)).toEqual([0, 250000]);
  });

  it("グリッド上の収入の総和が、その月に属するエントリの収入の総和と一致する", () => {
    const cells = flatten(
      monthGrid("2026-08", [
        totalOf("2026-08-01", 100, 1000),
        totalOf("2026-08-15", 200, 2000),
        totalOf("2026-08-31", 300, 3000),
        totalOf("2026-09-01", 400, 4000),
      ]),
    );
    expect(sumOf(cells)).toEqual([600, 6000]);
  });

  it("閏日の収入もセルに入る（2024-02-29）", () => {
    const cells = filledCells(monthGrid("2024-02", [totalOf("2024-02-29", 0, 4321)]));
    expect(amountsOf(cells, "2024-02-29")).toEqual([0, 4321]);
  });

  it("収入だけを含む dailyTotals でも、支出の総和は 0 のまま", () => {
    const cells = flatten(monthGrid("2026-07", [totalOf("2026-07-25", 0, 250000)]));
    expect(sumOf(cells)[0]).toBe(0);
  });

  it("dailyTotals を書き換えない（収入を含む場合）", () => {
    const totals = [totalOf("2026-07-01", 1200, 3000), totalOf("2026-06-30", 9999, 9999)];
    const snapshot = totals.map((total) => ({ ...total }));
    monthGrid("2026-07", totals);
    expect(totals).toEqual(snapshot);
    expect(totals.length).toBe(2);
  });
});

describe("monthGrid — セルの独立性", () => {
  it("同じセルオブジェクトが複数の位置で使い回されていない", () => {
    const cells = flatten(monthGrid("2026-08", []));
    expect(cells.length).toBe(42);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("空白セルを書き換えても、他の空白セルは変わらない", () => {
    const cells = flatten(monthGrid("2026-08", []));
    const blanks = cells.filter(isBlank);
    at(blanks, 0).expenseYen = 999;
    at(blanks, 0).incomeYen = 888;
    expect(blanks.slice(1).filter((cell) => cell.expenseYen !== 0 || cell.incomeYen !== 0)).toEqual(
      [],
    );
  });

  it("値の入ったセルを書き換えても、他のセルは変わらない", () => {
    const cells = flatten(monthGrid("2026-07", [totalOf("2026-07-15", 3400, 5000)]));
    at(cells, 0).expenseYen = 999;
    at(cells, 0).incomeYen = 888;
    const others = cells.slice(1);
    expect(others.filter((cell) => cell.expenseYen === 999 || cell.incomeYen === 888)).toEqual([]);
    expect(sumOf(others)).toEqual([3400, 5000]);
  });

  it("2回呼ぶと、別のセルオブジェクトが返る（前回の書き換えが残らない）", () => {
    const first = flatten(monthGrid("2026-07", [totalOf("2026-07-15", 3400, 5000)]));
    at(first, 0).expenseYen = 999;
    const second = flatten(monthGrid("2026-07", [totalOf("2026-07-15", 3400, 5000)]));
    expect(sumOf(second)).toEqual([3400, 5000]);
  });
});

describe("cellMagnitude", () => {
  it("支出だけのセルは、支出の額を返す", () => {
    expect(cellMagnitude(cellWith(1200, 0))).toBe(1200);
  });

  it("収入だけのセルは、収入の額を返す", () => {
    expect(cellMagnitude(cellWith(0, 250000))).toBe(250000);
  });

  it("支出と収入の両方があるセルは、支出の額を返す（収入ではない）", () => {
    expect(cellMagnitude(cellWith(1200, 250000))).toBe(1200);
  });

  it("収入の方がはるかに大きくても、支出が 0 より大きければ支出の額を返す", () => {
    expect(cellMagnitude(cellWith(1, 999999))).toBe(1);
  });

  it("支出も収入も 0 なら 0 を返す", () => {
    expect(cellMagnitude(cellWith(0, 0))).toBe(0);
  });

  it("空白セルは 0 を返す", () => {
    expect(cellMagnitude(realBlankCell())).toBe(0);
  });

  it("支出が 0 で収入が 0 より大きいときは、収入の額を返す（境界）", () => {
    expect(cellMagnitude(cellWith(0, 1))).toBe(1);
  });

  it("支出が 1 のときは支出を、支出が 0 のときは収入を返す（0 が境界）", () => {
    expect([cellMagnitude(cellWith(1, 500)), cellMagnitude(cellWith(0, 500))]).toEqual([1, 500]);
  });

  it("monthGrid が作ったセルにそのまま渡せる", () => {
    const cells = filledCells(
      monthGrid("2026-07", [
        totalOf("2026-07-01", 1200, 0),
        totalOf("2026-07-02", 0, 250000),
        totalOf("2026-07-03", 800, 300),
      ]),
    );
    const byDate = new Map(cells.map((cell) => [cell.date, cellMagnitude(cell)]));
    expect([
      byDate.get("2026-07-01"),
      byDate.get("2026-07-02"),
      byDate.get("2026-07-03"),
      byDate.get("2026-07-04"),
    ]).toEqual([1200, 250000, 800, 0]);
  });
});

describe("heatOf", () => {
  it("peak が 0 のときは 0 を返す（NaN にならない）", () => {
    const value = heatOf(cellWith(1200, 0), 0);
    expect(value).toBe(0);
    expect(Number.isNaN(value)).toBe(false);
  });

  it("peak が 0 で支出も収入も 0 のときも 0 を返す", () => {
    expect(heatOf(cellWith(0, 0), 0)).toBe(0);
  });

  it("peak が負のときは 0 を返す（負の濃さを返さない）", () => {
    expect(heatOf(cellWith(1200, 0), -100)).toBe(0);
  });

  it("peak が -1 のときも 0 を返す（境界）", () => {
    expect(heatOf(cellWith(1200, 0), -1)).toBe(0);
  });

  it("cellMagnitude が peak と等しいときは 1 を返す", () => {
    expect(heatOf(cellWith(4000, 0), 4000)).toBe(1);
  });

  it("cellMagnitude が peak の半分なら 0.5 を返す", () => {
    expect(heatOf(cellWith(2000, 0), 4000)).toBe(0.5);
  });

  it.each<[number, number, number]>([
    [1000, 4000, 0.25],
    [3000, 4000, 0.75],
    [4000, 4000, 1],
  ])("支出 %i / peak %i は %d", (expenseYen, peak, expected) => {
    expect(heatOf(cellWith(expenseYen, 0), peak)).toBe(expected);
  });

  it("cellMagnitude が 0 なら、peak が正でも 0 を返す", () => {
    expect(heatOf(cellWith(0, 0), 4000)).toBe(0);
  });

  it("空白セルは、peak が正でも 0 を返す", () => {
    expect(heatOf(realBlankCell(), 4000)).toBe(0);
  });

  it("収入だけのセルにも同じ規則が働く（収入 2000 / peak 4000 は 0.5）", () => {
    expect(heatOf(cellWith(0, 2000), 4000)).toBe(0.5);
  });

  it("支出と収入の両方があるセルは、支出を基準に計算する", () => {
    expect(heatOf(cellWith(1000, 9000), 2000)).toBe(0.5);
  });

  it("支出の大きいセルほど値が大きい", () => {
    const peak = 4000;
    const heats = [1000, 2000, 3000, 4000].map((yen) => heatOf(cellWith(yen, 0), peak));
    expect(heats).toEqual([...heats].sort((a, b) => a - b));
    expect(new Set(heats).size).toBe(4);
  });

  describe("-0 を返さない", () => {
    it("peak が 0 のとき +0 を返す", () => {
      expect(Object.is(heatOf(cellWith(1200, 0), 0), 0)).toBe(true);
    });

    it("peak が負のとき +0 を返す", () => {
      expect(Object.is(heatOf(cellWith(1200, 0), -4000), 0)).toBe(true);
    });

    it("cellMagnitude が 0 で peak が正のとき +0 を返す", () => {
      expect(Object.is(heatOf(cellWith(0, 0), 4000), 0)).toBe(true);
    });

    it("空白セルでも +0 を返す", () => {
      expect(Object.is(heatOf(realBlankCell(), 4000), 0)).toBe(true);
    });

    it("+0 は Intl.NumberFormat で -0% にならない", () => {
      const percent = new Intl.NumberFormat("ja-JP", { style: "percent" });
      expect(percent.format(heatOf(cellWith(1200, 0), -4000))).not.toContain("-");
    });
  });
});

interface WeekCase {
  /** weekGrid に渡す日 */
  date: string;
  /** 日曜から土曜までの7日 */
  week: readonly string[];
}

/** 週の区切りは dayOfWeek の既存の実測値から導いてある（日曜始まり） */
const WEEK_CASES: readonly WeekCase[] = [
  {
    date: "2026-07-15",
    week: [
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ],
  },
  {
    date: "2026-02-01",
    week: [
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
      "2026-02-05",
      "2026-02-06",
      "2026-02-07",
    ],
  },
  {
    date: "2026-08-01",
    week: [
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ],
  },
  {
    date: "2026-06-30",
    week: [
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ],
  },
  {
    date: "2025-12-31",
    week: [
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ],
  },
  {
    date: "2024-02-29",
    week: [
      "2024-02-25",
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
    ],
  },
  {
    date: "2025-02-28",
    week: [
      "2025-02-23",
      "2025-02-24",
      "2025-02-25",
      "2025-02-26",
      "2025-02-27",
      "2025-02-28",
      "2025-03-01",
    ],
  },
  {
    date: "2100-02-28",
    week: [
      "2100-02-28",
      "2100-03-01",
      "2100-03-02",
      "2100-03-03",
      "2100-03-04",
      "2100-03-05",
      "2100-03-06",
    ],
  },
];

describe("weekGrid — 週の形", () => {
  describe.each(WEEK_CASES)("$date を含む週", ({ date, week }) => {
    it("7要素になる", () => {
      expect(weekGrid(date, []).length).toBe(7);
    });

    it("空白セルが入らない（すべてに date と day がある）", () => {
      const cells = weekGrid(date, []);
      expect(cells.filter(isBlank)).toEqual([]);
      expect(cells.filter((cell) => cell.day === null)).toEqual([]);
    });

    it("日曜から土曜までの7日がその順に並ぶ", () => {
      expect(weekGrid(date, []).map((cell) => cell.date)).toEqual([...week]);
    });

    it("先頭が日曜、末尾が土曜になる", () => {
      const cells = weekGrid(date, []);
      expect(dayOfWeek(at(cells, 0).date ?? "")).toBe(0);
      expect(dayOfWeek(at(cells, 6).date ?? "")).toBe(6);
    });

    it("渡した日がその週に含まれる", () => {
      expect(weekGrid(date, []).map((cell) => cell.date)).toContain(date);
    });

    it("day が date の日の部分と一致する", () => {
      const mismatched = weekGrid(date, []).filter(
        (cell) => cell.date !== `${cell.date?.slice(0, 8)}${String(cell.day).padStart(2, "0")}`,
      );
      expect(mismatched).toEqual([]);
    });

    it("dailyTotals を渡さなければ、すべてのセルが 0", () => {
      expect(sumOf(weekGrid(date, []))).toEqual([0, 0]);
    });
  });

  it("日曜を渡すと、その日が先頭になる（2026-02-01 は日曜）", () => {
    expect(at(weekGrid("2026-02-01", []), 0).date).toBe("2026-02-01");
  });

  it("土曜を渡すと、その日が末尾になる（2026-08-01 は土曜）", () => {
    expect(at(weekGrid("2026-08-01", []), 6).date).toBe("2026-08-01");
  });

  it("同じ週の日曜と土曜を渡すと、同じ週が返る（2026-08-02 と 2026-08-08）", () => {
    const fromSunday = weekGrid("2026-08-02", []).map((cell) => cell.date);
    const fromSaturday = weekGrid("2026-08-08", []).map((cell) => cell.date);
    expect(fromSunday).toEqual(fromSaturday);
    expect(fromSunday).toEqual([
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
    ]);
  });

  it("土曜の翌日（日曜）を渡すと、別の週になる（2026-08-01 と 2026-08-02）", () => {
    expect(weekGrid("2026-08-01", []).map((cell) => cell.date)).not.toEqual(
      weekGrid("2026-08-02", []).map((cell) => cell.date),
    );
  });

  it("月をまたぐ週では、後半が翌月になる（2026-07-31 は金曜）", () => {
    const dates = weekGrid("2026-07-31", []).map((cell) => cell.date);
    expect(dates.filter((value) => value?.startsWith("2026-07")).length).toBe(6);
    expect(dates.filter((value) => value?.startsWith("2026-08")).length).toBe(1);
    expect(dates).toContain("2026-08-01");
  });

  it("年をまたぐ週では、前半が前年・後半が翌年になる（2026-01-01 は木曜）", () => {
    const dates = weekGrid("2026-01-01", []).map((cell) => cell.date);
    expect(dates.filter((value) => value?.startsWith("2025-12")).length).toBe(4);
    expect(dates.filter((value) => value?.startsWith("2026-01")).length).toBe(3);
    expect(dates).toEqual([
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("閏年の2月末をまたぐ週には 2024-02-29 が現れる", () => {
    expect(weekGrid("2024-03-01", []).map((cell) => cell.date)).toContain("2024-02-29");
  });

  it("平年の2月末をまたぐ週に 2025-02-29 は現れない", () => {
    const dates = weekGrid("2025-02-28", []).map((cell) => cell.date);
    expect(dates).not.toContain("2025-02-29");
    expect(dates).toContain("2025-03-01");
  });

  it("週の中で日付が重複しない", () => {
    const dates = weekGrid("2026-07-15", []).map((cell) => cell.date);
    expect(new Set(dates).size).toBe(7);
  });

  it("同じセルオブジェクトが使い回されていない", () => {
    const cells = weekGrid("2026-07-15", []);
    expect(new Set(cells).size).toBe(7);
    at(cells, 0).expenseYen = 999;
    expect(cells.slice(1).filter((cell) => cell.expenseYen === 999)).toEqual([]);
  });
});

describe("weekGrid — 支出と収入の割り当て", () => {
  it("period が一致する日のセルに expenseYen と incomeYen が入る", () => {
    const cells = weekGrid("2026-07-15", [
      totalOf("2026-07-12", 100, 0),
      totalOf("2026-07-15", 3400, 5000),
      totalOf("2026-07-18", 0, 700),
    ]);
    expect([
      amountsOf(cells, "2026-07-12"),
      amountsOf(cells, "2026-07-15"),
      amountsOf(cells, "2026-07-18"),
    ]).toEqual([
      [100, 0],
      [3400, 5000],
      [0, 700],
    ]);
  });

  it("dailyTotals に無い日は expenseYen も incomeYen も 0", () => {
    const cells = weekGrid("2026-07-15", [totalOf("2026-07-15", 3400, 5000)]);
    const others = cells.filter((cell) => cell.date !== "2026-07-15");
    expect(others.length).toBe(6);
    expect(sumOf(others)).toEqual([0, 0]);
  });

  it("週の外の日の額は混ざらない（前日と翌日）", () => {
    const cells = weekGrid("2026-07-15", [
      totalOf("2026-07-11", 9999, 9999),
      totalOf("2026-07-19", 8888, 8888),
      totalOf("2026-07-15", 3400, 5000),
    ]);
    expect(sumOf(cells)).toEqual([3400, 5000]);
    expect(cells.map((cell) => cell.date)).not.toContain("2026-07-11");
    expect(cells.map((cell) => cell.date)).not.toContain("2026-07-19");
  });

  it("週の境界の日（先頭の日曜と末尾の土曜）の額も入る", () => {
    const cells = weekGrid("2026-07-15", [
      totalOf("2026-07-12", 100, 200),
      totalOf("2026-07-18", 300, 400),
    ]);
    expect(sumOf(cells)).toEqual([400, 600]);
    expect([at(cells, 0).expenseYen, at(cells, 6).expenseYen]).toEqual([100, 300]);
  });

  it("月をまたぐ週では、両方の月の額が入る", () => {
    const cells = weekGrid("2026-08-01", [
      totalOf("2026-07-31", 100, 1000),
      totalOf("2026-08-01", 200, 2000),
    ]);
    expect(sumOf(cells)).toEqual([300, 3000]);
  });

  it("年をまたぐ週では、両方の年の額が入る", () => {
    const cells = weekGrid("2026-01-01", [
      totalOf("2025-12-31", 100, 1000),
      totalOf("2026-01-01", 200, 2000),
    ]);
    expect(sumOf(cells)).toEqual([300, 3000]);
  });

  it("ゼロ埋めされていない日付は一致しない", () => {
    const cells = weekGrid("2026-08-05", [totalOf("2026-08-5", 5000)]);
    expect(sumOf(cells)).toEqual([0, 0]);
  });

  it("月そのものの文字列はどの日にも一致しない", () => {
    expect(sumOf(weekGrid("2026-07-15", [totalOf("2026-07", 5000, 5000)]))).toEqual([0, 0]);
  });

  it("dailyTotals を書き換えない", () => {
    const totals = [
      totalOf("2026-07-12", 100, 200),
      totalOf("2026-07-19", 9999, 9999),
      totalOf("2026-07-15", 3400, 5000),
    ];
    const snapshot = totals.map((total) => ({ ...total }));
    weekGrid("2026-07-15", totals);
    expect(totals).toEqual(snapshot);
    expect(totals.length).toBe(3);
  });

  it("凍結された配列と要素を渡しても動く", () => {
    const totals = Object.freeze([
      Object.freeze(totalOf("2026-07-12", 100, 200)),
      Object.freeze(totalOf("2026-07-15", 3400, 5000)),
    ]);
    expect(sumOf(weekGrid("2026-07-15", totals))).toEqual([3500, 5200]);
  });

  it("同じ配列を使い回して別の週を組んでも、互いに影響しない", () => {
    const totals = [totalOf("2026-07-15", 3400, 5000), totalOf("2026-07-22", 500, 600)];
    expect(sumOf(weekGrid("2026-07-15", totals))).toEqual([3400, 5000]);
    expect(sumOf(weekGrid("2026-07-22", totals))).toEqual([500, 600]);
  });
});

describe("totalOfCells", () => {
  describe("空と 0", () => {
    it("セルが無ければ支出も収入も 0", () => {
      expect(totalOfCells([])).toEqual({ expenseYen: 0, incomeYen: 0 });
    });

    it("空白セルだけなら 0（空白が合計を汚さない）", () => {
      expect(totalOfCells([realBlankCell(), realBlankCell()])).toEqual({
        expenseYen: 0,
        incomeYen: 0,
      });
    });

    it("値が 0 のセルばかりでも 0", () => {
      expect(totalOfCells([cellWith(0, 0), cellWith(0, 0)])).toEqual({
        expenseYen: 0,
        incomeYen: 0,
      });
    });
  });

  describe("支出と収入を別々に足す", () => {
    it("支出だけのセルを足すと、収入は 0 のまま", () => {
      expect(totalOfCells([cellWith(1200, 0), cellWith(800, 0)])).toEqual({
        expenseYen: 2000,
        incomeYen: 0,
      });
    });

    it("収入だけのセルを足すと、支出は 0 のまま", () => {
      expect(totalOfCells([cellWith(0, 250000), cellWith(0, 30000)])).toEqual({
        expenseYen: 0,
        incomeYen: 280000,
      });
    });

    it("同じセルの支出と収入が混ざらない", () => {
      expect(totalOfCells([cellWith(1200, 250000)])).toEqual({
        expenseYen: 1200,
        incomeYen: 250000,
      });
    });

    it("支出と収入が相殺されない（差ではなく、それぞれの合計）", () => {
      expect(totalOfCells([cellWith(1000, 0), cellWith(0, 1000)])).toEqual({
        expenseYen: 1000,
        incomeYen: 1000,
      });
    });

    it("1セルだけでもその値を返す", () => {
      expect(totalOfCells([cellWith(42202, 7)])).toEqual({ expenseYen: 42202, incomeYen: 7 });
    });
  });

  describe("すべてのセルを数える", () => {
    it("先頭のセルも合計に含まれる", () => {
      expect(totalOfCells([cellWith(100, 1), cellWith(0, 0), cellWith(0, 0)]).expenseYen).toBe(100);
    });

    it("末尾のセルも合計に含まれる", () => {
      expect(totalOfCells([cellWith(0, 0), cellWith(0, 0), cellWith(100, 1)]).expenseYen).toBe(100);
    });

    it("同じ額のセルが並んでも、件数ぶん足される（重複が畳まれない）", () => {
      expect(totalOfCells(Array.from({ length: 7 }, () => cellWith(300, 50)))).toEqual({
        expenseYen: 2100,
        incomeYen: 350,
      });
    });

    it("空白セルが間に挟まっても、値のあるセルは全部足される", () => {
      const cells = [cellWith(100, 10), realBlankCell(), cellWith(200, 20), realBlankCell()];

      expect(totalOfCells(cells)).toEqual({ expenseYen: 300, incomeYen: 30 });
    });

    it("並び順を変えても合計は同じ", () => {
      const cells = [cellWith(100, 5), cellWith(200, 0), cellWith(0, 7)];

      expect(totalOfCells([...cells].reverse())).toEqual(totalOfCells(cells));
    });
  });

  describe("グリッドから足す", () => {
    it("月表示のセルの合計が、その月の dailyTotals の合計と一致する", () => {
      const dailyTotals = [
        totalOf("2026-08-01", 1200, 0),
        totalOf("2026-08-15", 800, 250000),
        totalOf("2026-08-31", 500, 300),
      ];

      expect(totalOfCells(flatten(monthGrid("2026-08", dailyTotals)))).toEqual({
        expenseYen: 2500,
        incomeYen: 250300,
      });
    });

    it("月表示は空白を含む全セルを渡しても、値のある日だけが効く", () => {
      const dailyTotals = [totalOf("2026-08-01", 1200, 0)];
      const weeks = monthGrid("2026-08", dailyTotals);

      expect(totalOfCells(flatten(weeks))).toEqual(totalOfCells(filledCells(weeks)));
    });

    it("週表示のセルの合計が、その週に属する日の合計と一致する", () => {
      const dailyTotals = [
        totalOf("2026-07-25", 999, 0),
        totalOf("2026-07-26", 1000, 0),
        totalOf("2026-08-01", 2000, 500),
        totalOf("2026-08-02", 4000, 0),
      ];

      // 2026-07-26（日）〜 2026-08-01（土）。前後の日は入らない。
      expect(totalOfCells(weekGrid("2026-07-28", dailyTotals))).toEqual({
        expenseYen: 3000,
        incomeYen: 500,
      });
    });

    it("取引の無い月は 0 で返る", () => {
      expect(totalOfCells(flatten(monthGrid("2026-08", [])))).toEqual({
        expenseYen: 0,
        incomeYen: 0,
      });
    });
  });

  describe("入力を書き換えない", () => {
    it("凍結された配列とセルを渡しても動く", () => {
      const cells = Object.freeze([
        Object.freeze(cellWith(100, 10)),
        Object.freeze(cellWith(200, 20)),
      ]) as readonly CalendarCell[];

      expect(totalOfCells(cells)).toEqual({ expenseYen: 300, incomeYen: 30 });
    });

    it("呼び出しの前後でセルの値が変わらない", () => {
      const cells = [cellWith(100, 10), cellWith(200, 20)];
      const before = structuredClone(cells);

      totalOfCells(cells);

      expect(cells).toEqual(before);
    });

    it("2回呼んでも同じ値を返す（内部に持ち越さない）", () => {
      const cells = [cellWith(100, 10), cellWith(200, 20)];

      expect(totalOfCells(cells)).toEqual(totalOfCells(cells));
    });
  });
});
