import { describe, it, expect } from "vitest";
import { isLeapYear, daysInMonth, dayOfWeek, toIsoDate } from "./date-parts.js";
import { addDays } from "./date-parts.js";

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`index ${index} の要素が存在しない（length=${items.length}）`);
  }
  return item;
}

/** "YYYY-MM" と日数から、その月の全日を "YYYY-MM-DD" で並べる（文字列の組み立てのみ） */
function datesOfMonth(month: string, lastDay: number): string[] {
  return Array.from(
    { length: lastDay },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
}

function weekdaysOf(dates: readonly string[]): number[] {
  return dates.map((date) => dayOfWeek(date));
}

describe("isLeapYear", () => {
  describe("4年ごとの規則", () => {
    it.each<[number, boolean]>([
      [2024, true],
      [2020, true],
      [1996, true],
      [2004, true],
    ])("%i は4で割り切れるので閏年", (year, expected) => {
      expect(isLeapYear(year)).toBe(expected);
    });

    it.each<[number, boolean]>([
      [2023, false],
      [2025, false],
      [2026, false],
      [2001, false],
      [1999, false],
    ])("%i は4で割り切れないので平年", (year, expected) => {
      expect(isLeapYear(year)).toBe(expected);
    });
  });

  describe("世紀の例外（100で割り切れる年は閏年でない）", () => {
    it.each<[number, boolean]>([
      [1900, false],
      [2100, false],
      [2200, false],
      [2300, false],
      [1800, false],
    ])("%i は100で割り切れ400では割り切れないので平年", (year, expected) => {
      expect(isLeapYear(year)).toBe(expected);
    });
  });

  describe("世紀の例外の例外（400で割り切れる年は閏年）", () => {
    it.each<[number, boolean]>([
      [2000, true],
      [2400, true],
      [1600, true],
      [1200, true],
    ])("%i は400で割り切れるので閏年", (year, expected) => {
      expect(isLeapYear(year)).toBe(expected);
    });
  });

  it("100年の境界をまたぐ連続した年を一括で検査する（1899〜1901, 1999〜2001, 2099〜2101）", () => {
    const years = [1899, 1900, 1901, 1999, 2000, 2001, 2099, 2100, 2101];
    expect(years.map((year) => isLeapYear(year))).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("400年周期の4つの世紀年で、2000だけが閏年になる", () => {
    expect([1900, 2000, 2100, 2200].map((year) => isLeapYear(year))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });
});

describe("daysInMonth", () => {
  describe("平年の12か月すべて", () => {
    const EXPECTED_2026 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    it.each(EXPECTED_2026.map((days, index): [number, number] => [index + 1, days]))(
      "2026年%i月は%i日",
      (month, days) => {
        expect(daysInMonth(2026, month)).toBe(days);
      },
    );

    it("平年の12か月の合計は365日", () => {
      const total = EXPECTED_2026.map((_, index) => daysInMonth(2026, index + 1)).reduce(
        (sum, days) => sum + days,
        0,
      );
      expect(total).toBe(365);
    });
  });

  describe("閏年の12か月すべて", () => {
    const EXPECTED_2024 = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    it.each(EXPECTED_2024.map((days, index): [number, number] => [index + 1, days]))(
      "2024年%i月は%i日",
      (month, days) => {
        expect(daysInMonth(2024, month)).toBe(days);
      },
    );

    it("閏年の12か月の合計は366日", () => {
      const total = EXPECTED_2024.map((_, index) => daysInMonth(2024, index + 1)).reduce(
        (sum, days) => sum + days,
        0,
      );
      expect(total).toBe(366);
    });
  });

  describe("2月の日数（閏年・平年・世紀の例外）", () => {
    it.each([
      [2024, 29],
      [2020, 29],
      [2000, 29],
      [2400, 29],
      [2026, 28],
      [2023, 28],
      [1900, 28],
      [2100, 28],
      [2200, 28],
    ])("%i年2月は%i日", (year, days) => {
      expect(daysInMonth(year, 2)).toBe(days);
    });
  });

  it("2月以外の月は閏年かどうかで変わらない", () => {
    const others = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(others.map((month) => daysInMonth(2024, month))).toEqual(
      others.map((month) => daysInMonth(2026, month)),
    );
  });

  it("7月と8月は連続して31日（月の長さが交互だと決めつけていない）", () => {
    expect([daysInMonth(2026, 7), daysInMonth(2026, 8)]).toEqual([31, 31]);
  });
});

describe("dayOfWeek", () => {
  describe("実測値（0が日曜、6が土曜）", () => {
    it.each<[string, number]>([
      ["2026-01-01", 4],
      ["2026-06-01", 1],
      ["2026-07-01", 3],
      ["2026-08-01", 6],
      ["2026-02-01", 0],
      ["2024-02-29", 4],
      ["2000-02-29", 2],
      ["2100-03-01", 1],
    ])("%s は %i", (date, expected) => {
      expect(dayOfWeek(date)).toBe(expected);
    });

    it("日曜は 0 を返す（1 や 7 ではない）", () => {
      expect(dayOfWeek("2026-02-01")).toBe(0);
    });

    it("土曜は 6 を返す", () => {
      expect(dayOfWeek("2026-08-01")).toBe(6);
    });
  });

  describe("連続する日付", () => {
    it("日曜始まりの1週間で 0,1,2,3,4,5,6 と並ぶ（2026-02-01〜07）", () => {
      expect(weekdaysOf(datesOfMonth("2026-02", 7))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("土曜の翌日は 6 の次が 0 に戻る（2026-08-01〜08）", () => {
      const dates = datesOfMonth("2026-08", 8);
      expect(weekdaysOf(dates)).toEqual([6, 0, 1, 2, 3, 4, 5, 6]);
    });

    it("1か月分（28日）が 0〜6 の繰り返しになる（2026-02）", () => {
      const expected = Array.from({ length: 28 }, (_, index) => index % 7);
      expect(weekdaysOf(datesOfMonth("2026-02", 28))).toEqual(expected);
    });
  });

  describe("7日後は同じ曜日", () => {
    it("同一月内で7日ごとに同じ値になる（2026-07-01, 08, 15, 22, 29 はいずれも水曜=3）", () => {
      expect(
        weekdaysOf(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]),
      ).toEqual([3, 3, 3, 3, 3]);
    });

    it("月をまたいだ7日後も同じ値になる（2026-07-29 と 2026-08-05 はどちらも 3）", () => {
      expect(weekdaysOf(["2026-07-29", "2026-08-05"])).toEqual([3, 3]);
    });
  });

  describe("月をまたぐ連続", () => {
    it("2026-07-31（金=5）の翌日 2026-08-01 は土=6", () => {
      expect(weekdaysOf(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"])).toEqual([
        4, 5, 6, 0,
      ]);
    });

    it("30日の月の末日をまたいでも崩れない（2026-06-30 火=2 → 2026-07-01 水=3）", () => {
      expect(weekdaysOf(["2026-06-30", "2026-07-01"])).toEqual([2, 3]);
    });

    it("年をまたいでも崩れない（2025-12-31 水=3 → 2026-01-01 木=4）", () => {
      expect(weekdaysOf(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"])).toEqual([
        2, 3, 4, 5,
      ]);
    });

    it("閏年の年末をまたいでも崩れない（2024-12-31 火=2 → 2025-01-01 水=3）", () => {
      expect(weekdaysOf(["2024-12-31", "2025-01-01"])).toEqual([2, 3]);
    });
  });

  describe("2月末をまたぐ連続", () => {
    it("閏日をまたぐ（2024-02-28 水=3 → 2024-02-29 木=4 → 2024-03-01 金=5）", () => {
      expect(weekdaysOf(["2024-02-28", "2024-02-29", "2024-03-01"])).toEqual([3, 4, 5]);
    });

    it("平年の2月末をまたぐ（2025-02-27 木=4 → 2025-02-28 金=5 → 2025-03-01 土=6）", () => {
      expect(weekdaysOf(["2025-02-27", "2025-02-28", "2025-03-01"])).toEqual([4, 5, 6]);
    });

    it("世紀の例外の2月末をまたぐ（2100-02-28 日=0 → 2100-03-01 月=1、間に閏日は無い）", () => {
      expect(weekdaysOf(["2100-02-27", "2100-02-28", "2100-03-01"])).toEqual([6, 0, 1]);
    });

    it("1900年も閏年でない（1900-02-28 水=3 → 1900-03-01 木=4）", () => {
      expect(weekdaysOf(["1900-02-28", "1900-03-01"])).toEqual([3, 4]);
    });

    it("400で割り切れる2000年は閏日を挟む（2000-02-28 月=1 → 2000-02-29 火=2 → 2000-03-01 水=3）", () => {
      expect(weekdaysOf(["2000-02-28", "2000-02-29", "2000-03-01"])).toEqual([1, 2, 3]);
    });

    it("閏年の2月をまたぐと、翌年の同日は2日ずれる（2024-03-01 金=5 → 2025-03-01 土=6）", () => {
      expect(weekdaysOf(["2024-03-01", "2025-03-01"])).toEqual([5, 6]);
    });
  });

  describe("戻り値の範囲", () => {
    const SCAN_DATES = [
      ...datesOfMonth("2026-08", 31),
      ...datesOfMonth("2024-02", 29),
      ...datesOfMonth("2100-02", 28),
      ...datesOfMonth("1900-12", 31),
    ];

    it("すべての日付で 0〜6 の整数を返す", () => {
      const outOfRange = SCAN_DATES.filter((date) => {
        const value = dayOfWeek(date);
        return !Number.isInteger(value) || value < 0 || value > 6;
      });
      expect(outOfRange).toEqual([]);
    });

    it("1か月を走査すると 0〜6 のすべての値が現れる（2026-08）", () => {
      const seen = new Set(weekdaysOf(datesOfMonth("2026-08", 31)));
      expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("日付ごとの値は 7 日周期でのみ一致する（同一週内に同じ曜日は現れない）", () => {
      const week = weekdaysOf(datesOfMonth("2024-02", 7));
      expect(new Set(week).size).toBe(7);
      expect(at(week, 0)).toBe(4);
    });
  });
});

describe("dayOfWeek — 4桁だが100未満の年", () => {
  // 境界（parseDate）は年を1900〜2100に絞るのでこの年は取り込みからは来ないが、
  // 曜日の正しさを境界の受理域に依存させない。Date.UTC は年 0〜99 を1900年代に
  // 読み替えるため、そこを通ると 0099年が1999年として計算され、曜日が狂う。
  // 期待値は Python の datetime（先発グレゴリオ暦）で裏を取った。
  it.each([
    ["0099-01-01", 4],
    ["0001-01-01", 1],
    ["1000-06-15", 0],
  ])("%s の曜日は %i", (date, expected) => {
    expect(dayOfWeek(date)).toBe(expected);
  });

  it("0099年が1999年として扱われていない", () => {
    // 1999-01-01 は金曜(5)。読み替えが起きるとこちらの値が返る。
    expect(dayOfWeek("1999-01-01")).toBe(5);
    expect(dayOfWeek("0099-01-01")).not.toBe(dayOfWeek("1999-01-01"));
  });

  it("100未満の年でも曜日が連続する", () => {
    expect([
      dayOfWeek("0099-01-01"),
      dayOfWeek("0099-01-02"),
      dayOfWeek("0099-01-03"),
    ]).toEqual([4, 5, 6]);
  });
});

describe("toIsoDate", () => {
  it("ローカル日付を YYYY-MM-DD にする", () => {
    expect(toIsoDate(new Date(2026, 7, 9))).toBe("2026-08-09");
  });

  it("月と日を2桁にゼロ埋めする", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("2桁の月日はそのまま並べる", () => {
    expect(toIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("時刻を持つ Date でも日付部分だけを返す", () => {
    expect(toIsoDate(new Date(2026, 7, 9, 23, 59, 59))).toBe("2026-08-09");
    expect(toIsoDate(new Date(2026, 7, 9, 0, 0, 0))).toBe("2026-08-09");
  });

  it("100未満の年を4桁にゼロ埋めする", () => {
    // Date のコンストラクタは年 0〜99 を1900年代に読み替えるので setFullYear で作る。
    const date = new Date(2026, 0, 1);
    date.setFullYear(99, 0, 1);
    expect(toIsoDate(date)).toBe("0099-01-01");
  });
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

describe("addDays", () => {
  describe("0 日", () => {
    it.each([
      "2026-08-09",
      "2026-01-01",
      "2026-12-31",
      "2024-02-29",
      "2026-02-28",
      "0099-12-31",
    ])("%s に 0 を足すと同じ日付が返る", (date) => {
      expect(addDays(date, 0)).toBe(date);
    });

    it("0 と -0 で結果が変わらない", () => {
      expect(addDays("2026-08-09", -0)).toBe("2026-08-09");
    });
  });

  describe("月内の加算・減算", () => {
    it.each<[string, number, string]>([
      ["2026-08-09", 1, "2026-08-10"],
      ["2026-08-09", 5, "2026-08-14"],
      ["2026-08-09", 22, "2026-08-31"],
      ["2026-08-09", -1, "2026-08-08"],
      ["2026-08-09", -8, "2026-08-01"],
      ["2026-08-01", 30, "2026-08-31"],
      ["2026-08-31", -30, "2026-08-01"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });
  });

  describe("月をまたぐ", () => {
    it.each<[string, number, string]>([
      ["2026-07-31", 1, "2026-08-01"],
      ["2026-08-01", -1, "2026-07-31"],
      ["2026-08-31", 1, "2026-09-01"],
      ["2026-09-01", -1, "2026-08-31"],
      ["2026-01-31", 1, "2026-02-01"],
      ["2026-02-01", -1, "2026-01-31"],
      ["2026-06-30", 1, "2026-07-01"],
      ["2026-07-01", -1, "2026-06-30"],
      ["2026-11-30", 1, "2026-12-01"],
      ["2026-12-01", -1, "2026-11-30"],
      ["2026-04-30", 1, "2026-05-01"],
      ["2026-05-01", -1, "2026-04-30"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });

    it.each<[string, number, string]>([
      ["2026-01-31", 29, "2026-03-01"],
      ["2026-03-01", -29, "2026-01-31"],
      ["2026-01-15", 50, "2026-03-06"],
    ])("2か月以上またいでも崩れない（%s に %i 日で %s）", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });

    it("月の1日にその月の日数を足すと、翌月の1日になる", () => {
      const cases: [number, number][] = [
        [2026, 1],
        [2026, 2],
        [2024, 2],
        [2100, 2],
        [2026, 4],
        [2026, 11],
        [2026, 12],
      ];
      const actual = cases.map(([year, month]) =>
        addDays(`${year}-${pad2(month)}-01`, daysInMonth(year, month)),
      );
      const expected = cases.map(([year, month]) =>
        month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`,
      );
      expect(actual).toEqual(expected);
    });
  });

  describe("年をまたぐ", () => {
    it.each<[string, number, string]>([
      ["2025-12-31", 1, "2026-01-01"],
      ["2026-01-01", -1, "2025-12-31"],
      ["2026-12-31", 1, "2027-01-01"],
      ["2027-01-01", -1, "2026-12-31"],
      ["2024-12-31", 1, "2025-01-01"],
      ["2025-12-25", 10, "2026-01-04"],
      ["2026-01-05", -10, "2025-12-26"],
      ["2099-12-31", 1, "2100-01-01"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });

    it("12月31日の翌日は、年が繰り上がって1月1日になる（12月32日にならない）", () => {
      expect(addDays("2026-12-31", 1)).not.toBe("2026-12-32");
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    });
  });

  describe("うるう年の2月末", () => {
    it.each<[string, number, string]>([
      ["2024-02-28", 1, "2024-02-29"],
      ["2024-02-29", 1, "2024-03-01"],
      ["2024-02-28", 2, "2024-03-01"],
      ["2024-03-01", -1, "2024-02-29"],
      ["2024-02-29", -1, "2024-02-28"],
      ["2024-01-31", 29, "2024-02-29"],
      ["2000-02-28", 1, "2000-02-29"],
      ["2000-02-29", 1, "2000-03-01"],
      ["2024-01-01", 366, "2025-01-01"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });
  });

  describe("平年の2月末（29日は存在しない）", () => {
    it.each<[string, number, string]>([
      ["2026-02-28", 1, "2026-03-01"],
      ["2026-02-28", 2, "2026-03-02"],
      ["2026-03-01", -1, "2026-02-28"],
      ["2025-02-28", 1, "2025-03-01"],
      ["2100-02-28", 1, "2100-03-01"],
      ["2100-03-01", -1, "2100-02-28"],
      ["1900-02-28", 1, "1900-03-01"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });

    it("2月28日の翌日は、閏年なら2月29日・平年なら3月1日になる", () => {
      expect([addDays("2024-02-28", 1), addDays("2026-02-28", 1)]).toEqual([
        "2024-02-29",
        "2026-03-01",
      ]);
    });

    it("平年に 2月29日 は現れない（2月中の連続31日を走査）", () => {
      const scanned = Array.from({ length: 31 }, (_, index) => addDays("2026-02-01", index));
      expect(scanned).not.toContain("2026-02-29");
      expect(scanned[27]).toBe("2026-02-28");
      expect(scanned[28]).toBe("2026-03-01");
    });
  });

  describe("30日の月と31日の月の末日", () => {
    it.each<[string, number, string]>([
      ["2026-04-30", 1, "2026-05-01"],
      ["2026-06-30", 1, "2026-07-01"],
      ["2026-09-30", 1, "2026-10-01"],
      ["2026-11-30", 1, "2026-12-01"],
      ["2026-03-31", 1, "2026-04-01"],
      ["2026-05-31", 1, "2026-06-01"],
      ["2026-07-31", 1, "2026-08-01"],
      ["2026-10-31", 1, "2026-11-01"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });

    it("30日の月に31日は現れない（2026-06-30 の翌日は 2026-06-31 ではない）", () => {
      expect(addDays("2026-06-30", 1)).not.toBe("2026-06-31");
    });

    it("7月31日の翌日が8月1日、8月31日の翌日が9月1日（31日が連続する月でも崩れない）", () => {
      expect([addDays("2026-07-31", 1), addDays("2026-08-31", 1)]).toEqual([
        "2026-08-01",
        "2026-09-01",
      ]);
    });
  });

  describe("大きな値", () => {
    it.each<[string, number, string]>([
      ["2026-01-01", 365, "2027-01-01"],
      ["2024-01-01", 365, "2024-12-31"],
      ["2026-01-01", -365, "2025-01-01"],
      ["2025-01-01", -365, "2024-01-02"],
      ["2026-01-01", 400, "2027-02-05"],
      ["2026-01-01", -400, "2024-11-27"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });

    it("閏年をまたぐ365日は、平年をまたぐ365日と1日ずれる", () => {
      expect([addDays("2024-01-01", 365), addDays("2026-01-01", 365)]).toEqual([
        "2024-12-31",
        "2027-01-01",
      ]);
    });
  });

  describe("4桁に満たない年もゼロ詰めされる", () => {
    // 境界（parseDate）が絞る範囲の外でもゼロ詰めが崩れないことを見る。
    // Date.UTC は年 0〜99 を1900年代に読み替えるため、そこを通ると桁が崩れる。
    it.each<[string, number, string]>([
      ["0099-12-31", 1, "0100-01-01"],
      ["0100-01-01", -1, "0099-12-31"],
      ["0001-01-01", 1, "0001-01-02"],
      ["0001-12-31", 1, "0002-01-01"],
      ["0009-12-31", 1, "0010-01-01"],
      ["0099-02-28", 1, "0099-03-01"],
      ["0100-02-28", 1, "0100-03-01"],
      ["0400-02-28", 1, "0400-02-29"],
    ])("%s に %i 日足すと %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
    });

    it("0099年が1999年として扱われていない", () => {
      expect(addDays("1999-12-31", 1)).toBe("2000-01-01");
      expect(addDays("0099-12-31", 1)).not.toBe(addDays("1999-12-31", 1));
    });

    it("100未満の年でも返り値が4桁のままになる", () => {
      expect(addDays("0099-12-31", 1)).toMatch(ISO_DATE);
      expect(addDays("0001-01-01", 1)).toMatch(ISO_DATE);
    });
  });

  describe("返り値の形式", () => {
    it.each<[string, number]>([
      ["2026-08-09", 0],
      ["2026-08-09", 1],
      ["2026-09-30", 1],
      ["2026-12-31", 1],
      ["2026-01-01", -1],
      ["2024-02-28", 1],
      ["2026-01-01", 400],
      ["2026-01-01", -400],
      ["0099-12-31", 1],
      ["0001-01-01", -0],
    ])("%s + %i の返り値は YYYY-MM-DD に一致する", (date, days) => {
      expect(addDays(date, days)).toMatch(ISO_DATE);
    });

    it("1年分（366日）を走査しても、すべて YYYY-MM-DD に一致する", () => {
      const invalid = Array.from({ length: 366 }, (_, index) =>
        addDays("2024-01-01", index),
      ).filter((date) => !ISO_DATE.test(date));
      expect(invalid).toEqual([]);
    });

    it("月と日が1桁の日付でもゼロ詰めされる", () => {
      expect([addDays("2026-01-04", 1), addDays("2026-08-31", 1)]).toEqual([
        "2026-01-05",
        "2026-09-01",
      ]);
    });
  });

  describe("往復と合成", () => {
    it.each<[string, number]>([
      ["2026-08-09", 1],
      ["2026-08-09", -1],
      ["2026-02-28", 1],
      ["2024-02-28", 400],
      ["2025-12-31", 365],
      ["2026-07-15", -37],
      ["0099-12-31", 1],
      ["2026-01-01", 0],
    ])("addDays(addDays(%s, %i), -(%i)) は元の日付に戻る", (date, days) => {
      expect(addDays(addDays(date, days), -days)).toBe(date);
    });

    it("2回に分けて足しても、まとめて足しても同じ（2026-01-15 に 20+30 日）", () => {
      expect(addDays(addDays("2026-01-15", 20), 30)).toBe("2026-03-06");
      expect(addDays("2026-01-15", 50)).toBe("2026-03-06");
    });

    it("閏日をまたぐ往復でも元に戻る", () => {
      expect(addDays(addDays("2024-02-28", 2), -2)).toBe("2024-02-28");
      expect(addDays(addDays("2024-03-01", -2), 2)).toBe("2024-03-01");
    });
  });

  describe("連続性（dayOfWeek・並び順との整合）", () => {
    it.each(["2026-08-09", "2025-12-28", "2024-02-26", "2100-02-25"])(
      "%s から7日後は同じ曜日になる",
      (date) => {
        expect(dayOfWeek(addDays(date, 7))).toBe(dayOfWeek(date));
      },
    );

    it.each(["2026-07-31", "2025-12-31", "2024-02-28", "2026-02-28"])(
      "%s の翌日は曜日が1つ進む",
      (date) => {
        expect(dayOfWeek(addDays(date, 1))).toBe((dayOfWeek(date) + 1) % 7);
      },
    );

    it("1日ずつ足していくと、日付が重複せず昇順に並ぶ（2026-01-20 から41日）", () => {
      const dates = Array.from({ length: 41 }, (_, index) => addDays("2026-01-20", index));
      expect(new Set(dates).size).toBe(41);
      expect(dates).toEqual([...dates].sort());
    });

    it("閏年の2月をまたいで1日ずつ足しても、日付が重複せず昇順に並ぶ（2024-02-20 から20日）", () => {
      const dates = Array.from({ length: 20 }, (_, index) => addDays("2024-02-20", index));
      expect(new Set(dates).size).toBe(20);
      expect(dates).toEqual([...dates].sort());
      expect(dates).toContain("2024-02-29");
    });
  });
});
