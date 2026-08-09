import { describe, it, expect } from "vitest";
import type { StoredTransaction } from "../storage/schema.js";
import {
  detectRecurring,
  MIN_MONTHS,
  AMOUNT_TOLERANCE,
  totalMonthlyYen,
  type RecurringCharge,
} from "./detect.js";

const BASE: StoredTransaction = {
  id: "t0",
  date: "2026-01-10",
  amountYen: -1490,
  description: "NETFLIX",
  source: "card",
  category: "サブスク",
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

/** 2026-01 から 2026-03 までの3か月。throughMonth は "2026-03" を既定にする */
const THREE_MONTHS = ["2026-01", "2026-02", "2026-03"] as const;

/**
 * 同じ摘要の取引を、月ごとに1件ずつ作る。
 * amountYen に配列を渡すと月ごとに違う額になる（符号はテスト側で明示する）。
 */
function monthly(
  description: string,
  amountYen: number | readonly number[],
  months: readonly string[] = THREE_MONTHS,
  day = "10",
): StoredTransaction[] {
  return months.map((month, index) =>
    tx({
      date: `${month}-${day}`,
      amountYen: typeof amountYen === "number" ? amountYen : at(amountYen, index),
      description,
    }),
  );
}

/** 結果がちょうど1件であることを確かめたうえで、その1件を返す */
function onlyCharge(charges: readonly RecurringCharge[]): RecurringCharge {
  expect(charges).toHaveLength(1);
  return at(charges, 0);
}

function descriptionsOf(charges: readonly RecurringCharge[]): string[] {
  return charges.map((charge) => charge.description);
}

/** 3か月連続・同額の支出1件を作り、その検出結果を返す（日付だけを変えたいとき用） */
function chargeForDates(dates: readonly string[], throughMonth: string): RecurringCharge {
  const transactions = dates.map((date) => tx({ date, amountYen: -1000, description: "家賃" }));
  return onlyCharge(detectRecurring(transactions, throughMonth));
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

describe("定数", () => {
  it("MIN_MONTHS は 3（3か月観測できたら固定費とみなす）", () => {
    expect(MIN_MONTHS).toBe(3);
  });

  it("AMOUNT_TOLERANCE は 0.2（代表額の ±20%）", () => {
    expect(AMOUNT_TOLERANCE).toBe(0.2);
  });
});

describe("detectRecurring", () => {
  describe("空の入力", () => {
    it("取引が空なら、空配列を返す", () => {
      expect(detectRecurring([], "2026-03")).toEqual([]);
    });

    it("取引が1件だけなら、空配列を返す", () => {
      expect(detectRecurring([tx({ date: "2026-03-10", amountYen: -1490 })], "2026-03")).toEqual(
        [],
      );
    });
  });

  describe("基本の検出", () => {
    it("3か月連続・完全同額の支出を、全フィールド付きで1件返す", () => {
      const charges = detectRecurring(monthly("NETFLIX", -1490), "2026-03");

      expect(charges).toEqual([
        {
          description: "NETFLIX",
          monthCount: 3,
          lastDate: "2026-03-10",
          typicalYen: 1490,
          nextDate: "2026-04-10",
        },
      ]);
    });

    it("typicalYen は正の整数で返る（符号を反転した額）", () => {
      const charge = onlyCharge(detectRecurring(monthly("NETFLIX", -1490), "2026-03"));

      expect(charge.typicalYen).toBe(1490);
      expect(Number.isInteger(charge.typicalYen)).toBe(true);
    });

    it("lastDate は直近の月の取引の日付になる（日が前月より小さくても直近の月を採る）", () => {
      const transactions = [
        tx({ date: "2026-01-25", amountYen: -1490 }),
        tx({ date: "2026-02-25", amountYen: -1490 }),
        tx({ date: "2026-03-07", amountYen: -1490 }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).lastDate).toBe("2026-03-07");
    });

    it("入力の順序を変えても、同じ結果になる", () => {
      const transactions = monthly("NETFLIX", -1490);
      const shuffled = [at(transactions, 2), at(transactions, 0), at(transactions, 1)];

      expect(detectRecurring(shuffled, "2026-03")).toEqual(
        detectRecurring(transactions, "2026-03"),
      );
    });

    it("source や category が違っても、摘要が同じなら1グループにまとまる", () => {
      const transactions = [
        tx({ date: "2026-01-10", amountYen: -1490, source: "card", category: "サブスク" }),
        tx({ date: "2026-02-10", amountYen: -1490, source: "bank", category: "未分類" }),
        tx({ date: "2026-03-10", amountYen: -1490, source: "cash", category: "娯楽費" }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).monthCount).toBe(3);
    });

    it("摘要が違えば、別のグループとして扱う", () => {
      const transactions = [...monthly("NETFLIX", -1490), ...monthly("家賃", -80000)];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual([
        "家賃",
        "NETFLIX",
      ]);
    });

    it("大文字と小文字が違う摘要は、別のグループになる（正規化は NFKC と空白だけ）", () => {
      const transactions = [...monthly("NETFLIX", -1490), ...monthly("netflix", -980)];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual([
        "NETFLIX",
        "netflix",
      ]);
    });
  });

  describe("最低月数（MIN_MONTHS = 3）", () => {
    it("ちょうど3か月なら拾う", () => {
      const charges = detectRecurring(monthly("NETFLIX", -1490), "2026-03");

      expect(onlyCharge(charges).monthCount).toBe(3);
    });

    it("2か月では拾わない", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490, ["2026-02", "2026-03"]), "2026-03")).toEqual(
        [],
      );
    });

    it("1か月では拾わない", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490, ["2026-03"]), "2026-03")).toEqual([]);
    });

    it("4か月なら monthCount が 4 になる", () => {
      const months = ["2025-12", "2026-01", "2026-02", "2026-03"];
      const charges = detectRecurring(monthly("NETFLIX", -1490, months), "2026-03");

      expect(onlyCharge(charges).monthCount).toBe(4);
    });

    it("5か月なら monthCount が 5 になる", () => {
      const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
      const charges = detectRecurring(monthly("NETFLIX", -1490, months), "2026-03");

      expect(onlyCharge(charges).monthCount).toBe(5);
    });

    it("12か月続いていても、1件のグループとして返る", () => {
      const months = [
        "2025-04",
        "2025-05",
        "2025-06",
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
        "2026-03",
      ];
      const charges = detectRecurring(monthly("NETFLIX", -1490, months), "2026-03");

      expect(onlyCharge(charges).monthCount).toBe(12);
    });
  });

  describe("月の連続性", () => {
    it("月が1つ飛んでいたら拾わない（2026-01・2026-03・2026-04）", () => {
      const transactions = monthly("NETFLIX", -1490, ["2026-01", "2026-03", "2026-04"]);

      expect(detectRecurring(transactions, "2026-04")).toEqual([]);
    });

    it("飛んだ後に3か月連続していても、グループ全体を拾わない", () => {
      const months = ["2025-11", "2026-01", "2026-02", "2026-03"];

      expect(detectRecurring(monthly("NETFLIX", -1490, months), "2026-03")).toEqual([]);
    });

    it("年をまたいで連続していれば拾う（2025-11・2025-12・2026-01）", () => {
      const months = ["2025-11", "2025-12", "2026-01"];
      const charges = detectRecurring(monthly("NETFLIX", -1490, months), "2026-01");

      expect(onlyCharge(charges).monthCount).toBe(3);
    });

    it("年をまたぐところで12月が抜けていたら拾わない", () => {
      const months = ["2025-10", "2025-11", "2026-01", "2026-02"];

      expect(detectRecurring(monthly("NETFLIX", -1490, months), "2026-02")).toEqual([]);
    });

    it("同じ月番号でも年が違えば連続とみなさない（2025-01・2026-01・2026-02）", () => {
      const months = ["2025-01", "2026-01", "2026-02"];

      expect(detectRecurring(monthly("NETFLIX", -1490, months), "2026-02")).toEqual([]);
    });
  });

  describe("同じ月に2件以上あるグループ", () => {
    it("1か月だけ2件あると、そのグループ全体を拾わない", () => {
      const transactions = [
        ...monthly("セブンイレブン", -1000),
        tx({ date: "2026-02-20", amountYen: -1000, description: "セブンイレブン" }),
      ];

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });

    it("直近の月に2件あっても、そのグループ全体を拾わない", () => {
      const transactions = [
        ...monthly("スーパーA", -1000),
        tx({ date: "2026-03-28", amountYen: -1000, description: "スーパーA" }),
      ];

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });

    it("同じ日に2件でも、そのグループ全体を拾わない", () => {
      const transactions = [
        ...monthly("スーパーA", -1000),
        tx({ date: "2026-01-10", amountYen: -1000, description: "スーパーA" }),
      ];

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });

    it("除外は摘要ごとで、他のグループには波及しない", () => {
      const transactions = [
        ...monthly("スーパーA", -1000),
        tx({ date: "2026-02-20", amountYen: -1000, description: "スーパーA" }),
        ...monthly("家賃", -80000),
      ];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual(["家賃"]);
    });

    it("正規化すると同じになる摘要が同じ月に2件あるときも、拾わない", () => {
      const transactions = [
        ...monthly("NETFLIX", -1490),
        tx({ date: "2026-02-20", amountYen: -1490, description: "ＮＥＴＦＬＩＸ" }),
      ];

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });
  });

  describe("支出だけを対象にする", () => {
    it("収入が毎月同額で3か月続いても拾わない", () => {
      expect(detectRecurring(monthly("給与", 300000), "2026-03")).toEqual([]);
    });

    it("0 円の取引が毎月あっても拾わない", () => {
      expect(detectRecurring(monthly("ポイント充当", 0), "2026-03")).toEqual([]);
    });

    it("-0 円の取引が毎月あっても拾わない（-0 は支出ではない）", () => {
      expect(detectRecurring(monthly("ポイント充当", -0), "2026-03")).toEqual([]);
    });

    it("0 円の取引が同じ摘要・同じ月に混ざっても、結果を壊さない", () => {
      const transactions = [
        ...monthly("NETFLIX", -1490),
        tx({ date: "2026-02-20", amountYen: 0, description: "NETFLIX" }),
      ];

      expect(detectRecurring(transactions, "2026-03")).toEqual([
        {
          description: "NETFLIX",
          monthCount: 3,
          lastDate: "2026-03-10",
          typicalYen: 1490,
          nextDate: "2026-04-10",
        },
      ]);
    });

    it("-0 円の取引が同じ摘要・同じ月に混ざっても、結果を壊さない", () => {
      const transactions = [
        ...monthly("NETFLIX", -1490),
        tx({ date: "2026-02-20", amountYen: -0, description: "NETFLIX" }),
      ];

      expect(detectRecurring(transactions, "2026-03")).toEqual([
        {
          description: "NETFLIX",
          monthCount: 3,
          lastDate: "2026-03-10",
          typicalYen: 1490,
          nextDate: "2026-04-10",
        },
      ]);
    });

    it("無関係な収入や 0 円の取引が入力に混ざっても、固定費の検出を邪魔しない", () => {
      const transactions = [
        ...monthly("家賃", -80000),
        ...monthly("給与", 300000),
        ...monthly("ポイント充当", 0),
      ];

      expect(detectRecurring(transactions, "2026-03")).toEqual([
        {
          description: "家賃",
          monthCount: 3,
          lastDate: "2026-03-10",
          typicalYen: 80000,
          nextDate: "2026-04-10",
        },
      ]);
    });

    it("途中の月が収入だけになると、支出の月が飛ぶので拾わない", () => {
      const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
      const transactions = monthly("返金あり店", [-1000, 1000, -1000, -1000], months);

      expect(detectRecurring(transactions, "2026-04")).toEqual([]);
    });
  });

  describe("金額のばらつき（代表額の ±20%）", () => {
    it("ちょうど -20% と +20% の月があっても拾う（境界を含む）", () => {
      const transactions = monthly("水道光熱費", [-800, -1000, -1200]);
      const charge = onlyCharge(detectRecurring(transactions, "2026-03"));

      expect(charge.typicalYen).toBe(1000);
      expect(charge.monthCount).toBe(3);
    });

    it("-20% をわずかに超える月があれば拾わない（799 は 800 に届かない）", () => {
      const transactions = monthly("水道光熱費", [-799, -1000, -1200]);

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });

    it("+20% をわずかに超える月があれば拾わない（1201 は 1200 を超える）", () => {
      const transactions = monthly("水道光熱費", [-800, -1000, -1201]);

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });

    it("直近の月だけ大きく外れていても拾わない", () => {
      const transactions = monthly("水道光熱費", [-1000, -1000, -3000]);

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });

    it("最初の月だけ大きく外れていても拾わない", () => {
      const transactions = monthly("水道光熱費", [-100, -1000, -1000]);

      expect(detectRecurring(transactions, "2026-03")).toEqual([]);
    });

    it("±20% に収まる小さなばらつきなら拾う", () => {
      const transactions = monthly("水道光熱費", [-950, -1000, -1050]);

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).typicalYen).toBe(1000);
    });
  });

  describe("typicalYen（各月の額の中央値）", () => {
    it("奇数個なら、真ん中の額になる", () => {
      const transactions = monthly("水道光熱費", [-900, -1000, -1100]);

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).typicalYen).toBe(1000);
    });

    it("入力順が額の昇順でなくても、中央値は変わらない", () => {
      const transactions = monthly("水道光熱費", [-1100, -900, -1000]);

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).typicalYen).toBe(1000);
    });

    it("偶数個なら、真ん中2つのうち小さい側になる（平均でも大きい側でもない）", () => {
      const months = ["2025-12", "2026-01", "2026-02", "2026-03"];
      // 中央の2つは 1000 と 1100。平均なら 1050、大きい側なら 1100 になる
      const transactions = monthly("水道光熱費", [-950, -1000, -1100, -1150], months);

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).typicalYen).toBe(1000);
    });

    it("偶数個で真ん中2つが隣り合う額でも、小さい側になる", () => {
      const months = ["2025-12", "2026-01", "2026-02", "2026-03"];
      const transactions = monthly("水道光熱費", [-1000, -1001, -1002, -1003], months);

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).typicalYen).toBe(1001);
    });

    it("5か月なら、3番目に小さい額になる", () => {
      const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
      const transactions = monthly("水道光熱費", [-800, -900, -1000, -1100, -1200], months);
      const charge = onlyCharge(detectRecurring(transactions, "2026-03"));

      expect(charge.typicalYen).toBe(1000);
      expect(charge.monthCount).toBe(5);
    });

    it("すべて同額なら、その額になる", () => {
      expect(onlyCharge(detectRecurring(monthly("NETFLIX", -1490), "2026-03")).typicalYen).toBe(
        1490,
      );
    });
  });

  describe("直近の発生月と throughMonth の関係", () => {
    it("直近が throughMonth と同じ月なら拾う", () => {
      const charges = detectRecurring(monthly("NETFLIX", -1490), "2026-03");

      expect(onlyCharge(charges).lastDate).toBe("2026-03-10");
    });

    it("直近が throughMonth の1つ前の月なら拾う（月初はまだ当月分が落ちていない）", () => {
      const charges = detectRecurring(monthly("NETFLIX", -1490), "2026-04");

      expect(onlyCharge(charges).lastDate).toBe("2026-03-10");
    });

    it("直近が throughMonth の2か月前なら拾わない（解約済みとみなす）", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490), "2026-05")).toEqual([]);
    });

    it("直近が throughMonth の1年前なら拾わない", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490), "2027-03")).toEqual([]);
    });

    it("直近が throughMonth の翌月（未来）なら拾わない", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490), "2026-02")).toEqual([]);
    });

    it("直近が throughMonth より先の年なら拾わない", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490), "2025-12")).toEqual([]);
    });

    it("年をまたいで1つ前の月でも拾う（直近 2025-12、throughMonth 2026-01）", () => {
      const months = ["2025-10", "2025-11", "2025-12"];
      const charges = detectRecurring(monthly("NETFLIX", -1490, months), "2026-01");

      expect(onlyCharge(charges).lastDate).toBe("2025-12-10");
    });

    it("年をまたいで2か月前なら拾わない（直近 2025-12、throughMonth 2026-02）", () => {
      const months = ["2025-10", "2025-11", "2025-12"];

      expect(detectRecurring(monthly("NETFLIX", -1490, months), "2026-02")).toEqual([]);
    });

    it("解約済みのグループだけを落とし、続いているグループは残す", () => {
      const oldMonths = ["2025-10", "2025-11", "2025-12"];
      const transactions = [
        ...monthly("解約したサブスク", -3000, oldMonths),
        ...monthly("NETFLIX", -1490),
      ];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual(["NETFLIX"]);
    });

    it("throughMonth が空文字列なら、どのグループも該当しない", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490), "")).toEqual([]);
    });

    it("throughMonth が年だけ（YYYY）なら、どのグループも該当しない", () => {
      expect(detectRecurring(monthly("NETFLIX", -1490), "2026")).toEqual([]);
    });
  });

  describe("摘要の正規化（NFKC・連続空白・前後の空白）", () => {
    it("全角英字と半角英字は同じグループになる", () => {
      const transactions = [
        tx({ date: "2026-01-10", description: "ＮＥＴＦＬＩＸ" }),
        tx({ date: "2026-02-10", description: "NETFLIX" }),
        tx({ date: "2026-03-10", description: "ＮＥＴＦＬＩＸ" }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).monthCount).toBe(3);
    });

    it("半角カナと全角カナ、全角空白と半角空白は同じグループになる", () => {
      const transactions = [
        tx({ date: "2026-01-10", description: "ｱﾏｿﾞﾝ　ﾌﾟﾗｲﾑ" }),
        tx({ date: "2026-02-10", description: "アマゾン プライム" }),
        tx({ date: "2026-03-10", description: "ｱﾏｿﾞﾝ　ﾌﾟﾗｲﾑ" }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).monthCount).toBe(3);
    });

    it("連続する空白の数が違っても同じグループになる", () => {
      const transactions = [
        tx({ date: "2026-01-10", description: "SPOTIFY   PREMIUM" }),
        tx({ date: "2026-02-10", description: "SPOTIFY PREMIUM" }),
        tx({ date: "2026-03-10", description: "SPOTIFY  PREMIUM" }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).monthCount).toBe(3);
    });

    it("前後の空白の有無が違っても同じグループになる", () => {
      const transactions = [
        tx({ date: "2026-01-10", description: "  NETFLIX" }),
        tx({ date: "2026-02-10", description: "NETFLIX  " }),
        tx({ date: "2026-03-10", description: "NETFLIX" }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).monthCount).toBe(3);
    });

    it("description は直近の取引の摘要を、正規化せずそのまま返す", () => {
      const transactions = [
        tx({ date: "2026-01-10", description: "NETFLIX" }),
        tx({ date: "2026-02-10", description: "NETFLIX" }),
        tx({ date: "2026-03-10", description: "ＮＥＴＦＬＩＸ　" }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).description).toBe(
        "ＮＥＴＦＬＩＸ　",
      );
    });

    it("直近の取引の摘要が正規化済みの形なら、そのまま返る", () => {
      const transactions = [
        tx({ date: "2026-01-10", description: "ＮＥＴＦＬＩＸ" }),
        tx({ date: "2026-02-10", description: "ＮＥＴＦＬＩＸ" }),
        tx({ date: "2026-03-10", description: "NETFLIX" }),
      ];

      expect(onlyCharge(detectRecurring(transactions, "2026-03")).description).toBe("NETFLIX");
    });

    it("空白の違いしかない摘要は、2つのグループに割れない", () => {
      const transactions = [
        tx({ date: "2026-01-10", description: "SPOTIFY PREMIUM" }),
        tx({ date: "2026-02-10", description: "SPOTIFY  PREMIUM" }),
        tx({ date: "2026-03-10", description: " SPOTIFY PREMIUM " }),
      ];

      expect(detectRecurring(transactions, "2026-03")).toHaveLength(1);
    });
  });

  describe("nextDate（直近の発生日の翌月の同じ日）", () => {
    it("翌月に同じ日があれば、その日になる", () => {
      const charge = chargeForDates(["2026-01-15", "2026-02-15", "2026-03-15"], "2026-03");

      expect(charge.nextDate).toBe("2026-04-15");
    });

    it("月初の日でも、翌月の同じ日になる", () => {
      const charge = chargeForDates(["2026-01-01", "2026-02-01", "2026-03-01"], "2026-03");

      expect(charge.nextDate).toBe("2026-04-01");
    });

    it("1月31日は、翌月の末日 2月28日に切り詰める（平年）", () => {
      const charge = chargeForDates(["2025-11-30", "2025-12-31", "2026-01-31"], "2026-01");

      expect(charge.nextDate).toBe("2026-02-28");
    });

    it("1月30日も、2月28日に切り詰める（平年）", () => {
      const charge = chargeForDates(["2025-11-30", "2025-12-30", "2026-01-30"], "2026-01");

      expect(charge.nextDate).toBe("2026-02-28");
    });

    it("1月29日も、2月28日に切り詰める（平年）", () => {
      const charge = chargeForDates(["2025-11-29", "2025-12-29", "2026-01-29"], "2026-01");

      expect(charge.nextDate).toBe("2026-02-28");
    });

    it("うるう年の1月31日は、2月29日に切り詰める", () => {
      const charge = chargeForDates(["2023-11-30", "2023-12-31", "2024-01-31"], "2024-01");

      expect(charge.nextDate).toBe("2024-02-29");
    });

    it("うるう年の1月29日は、切り詰めずに2月29日になる", () => {
      const charge = chargeForDates(["2023-11-29", "2023-12-29", "2024-01-29"], "2024-01");

      expect(charge.nextDate).toBe("2024-02-29");
    });

    it("2月29日の翌月は3月29日（切り詰めない）", () => {
      const charge = chargeForDates(["2023-12-29", "2024-01-29", "2024-02-29"], "2024-02");

      expect(charge.nextDate).toBe("2024-03-29");
    });

    it("3月31日は、30日までしかない4月30日に切り詰める", () => {
      const charge = chargeForDates(["2026-01-31", "2026-02-28", "2026-03-31"], "2026-03");

      expect(charge.nextDate).toBe("2026-04-30");
    });

    it("5月31日は、6月30日に切り詰める", () => {
      const charge = chargeForDates(["2026-03-31", "2026-04-30", "2026-05-31"], "2026-05");

      expect(charge.nextDate).toBe("2026-06-30");
    });

    it("7月31日は、31日まである8月31日のままになる", () => {
      const charge = chargeForDates(["2026-05-31", "2026-06-30", "2026-07-31"], "2026-07");

      expect(charge.nextDate).toBe("2026-08-31");
    });

    it("12月15日は、翌年の1月15日になる（年をまたぐ）", () => {
      const charge = chargeForDates(["2025-10-15", "2025-11-15", "2025-12-15"], "2025-12");

      expect(charge.nextDate).toBe("2026-01-15");
    });

    it("12月31日は、翌年の1月31日になる（年をまたいでも切り詰めない）", () => {
      const charge = chargeForDates(["2025-10-31", "2025-11-30", "2025-12-31"], "2025-12");

      expect(charge.nextDate).toBe("2026-01-31");
    });

    // parseDate は \d{4} を受理するので、4桁に満たない年の日付が保存され得る。
    // 年をゼロ詰めしないと "100-01-15" になり、日付順の比較（文字列の辞書順）が壊れる。
    it("4桁に満たない年でも、繰り上げた年を4桁にゼロ詰めする", () => {
      const charge = chargeForDates(["0099-10-15", "0099-11-15", "0099-12-15"], "0099-12");

      expect(charge.nextDate).toBe("0100-01-15");
    });

    it("nextDate は lastDate より後の日付になる", () => {
      const charge = chargeForDates(["2025-11-30", "2025-12-31", "2026-01-31"], "2026-01");

      expect(charge.nextDate > charge.lastDate).toBe(true);
    });

    it("nextDate は YYYY-MM-DD 形式（月日をゼロ詰めする）", () => {
      const charge = chargeForDates(["2026-06-05", "2026-07-05", "2026-08-05"], "2026-08");

      expect(charge.nextDate).toBe("2026-09-05");
    });
  });

  describe("並び順（typicalYen の降順、同額なら description の昇順）", () => {
    it("代表額の大きい固定費が先に来る", () => {
      const transactions = [
        ...monthly("NETFLIX", -1490),
        ...monthly("家賃", -80000),
        ...monthly("水道代", -4200),
      ];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual([
        "家賃",
        "水道代",
        "NETFLIX",
      ]);
    });

    it("代表額が同じなら、摘要の昇順で並ぶ", () => {
      const transactions = [...monthly("Spotify", -980), ...monthly("AppleMusic", -980)];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual([
        "AppleMusic",
        "Spotify",
      ]);
    });

    it("日本語の摘要でも、同額なら昇順で並ぶ", () => {
      const transactions = [...monthly("ジムB", -7000), ...monthly("ジムA", -7000)];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual(["ジムA", "ジムB"]);
    });

    it("代表額の比較が摘要の比較より優先される", () => {
      const transactions = [...monthly("AppleMusic", -980), ...monthly("Spotify", -1480)];

      expect(descriptionsOf(detectRecurring(transactions, "2026-03"))).toEqual([
        "Spotify",
        "AppleMusic",
      ]);
    });

    it("入力の順序を変えても、並び順は変わらない", () => {
      const transactions = [
        ...monthly("家賃", -80000),
        ...monthly("AppleMusic", -980),
        ...monthly("Spotify", -980),
        ...monthly("NETFLIX", -1490),
      ];

      expect(descriptionsOf(detectRecurring([...transactions].reverse(), "2026-03"))).toEqual([
        "家賃",
        "NETFLIX",
        "AppleMusic",
        "Spotify",
      ]);
    });
  });

  describe("引数の配列を書き換えない", () => {
    const transactions = (): StoredTransaction[] => [
      ...monthly("NETFLIX", -1490),
      ...monthly("家賃", -80000),
      ...monthly("給与", 300000),
      tx({ date: "2026-02-20", amountYen: 0, description: "ポイント充当" }),
    ];

    it("detectRecurring は入力の配列も要素も書き換えない", () => {
      expectInputUnchanged(transactions(), (input) => detectRecurring(input, "2026-03"));
    });

    it("検出されないグループしか無い場合も、入力を書き換えない", () => {
      expectInputUnchanged(transactions(), (input) => detectRecurring(input, "2026-12"));
    });
  });
});

describe("totalMonthlyYen", () => {
  function charge(typicalYen: number): RecurringCharge {
    return {
      description: "x",
      monthCount: 3,
      lastDate: "2026-03-10",
      typicalYen,
      nextDate: "2026-04-10",
    };
  }

  it("固定費が無ければ +0（-0 にしない）", () => {
    const total = totalMonthlyYen([]);

    expect(Object.is(total, 0)).toBe(true);
  });

  it("typicalYen の合計を正の数で返す", () => {
    expect(totalMonthlyYen([charge(1490), charge(80000), charge(1080)])).toBe(82570);
  });

  it("1件なら、その額をそのまま返す", () => {
    expect(totalMonthlyYen([charge(1490)])).toBe(1490);
  });
});
