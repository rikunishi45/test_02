import { describe, it, expect } from "vitest";
import type { Transaction } from "../domain/transaction.js";
import {
  classifyForImport,
  transactionFingerprint,
  type ClassifiedTransaction,
} from "./classify-duplicates.js";

const BASE: Transaction = {
  date: "2026-01-15",
  amountYen: -500,
  description: "セブンイレブン",
  source: "card",
};

function transactionOf(overrides: Partial<Transaction> = {}): Transaction {
  return { ...BASE, ...overrides };
}

function repeat(transaction: Transaction, count: number): Transaction[] {
  return Array.from({ length: count }, () => ({ ...transaction }));
}

function statusesOf(classified: readonly ClassifiedTransaction[]): string[] {
  return classified.map((row) => row.status);
}

/** 入力を書き換えたら即座に落ちるよう、配列と各要素を凍結して渡す */
function frozen(transactions: readonly Transaction[]): readonly Transaction[] {
  return Object.freeze(transactions.map((t) => Object.freeze({ ...t })));
}

describe("transactionFingerprint", () => {
  describe("4項目すべてが一致するとき、同じ指紋になる", () => {
    it("別々に構築した同内容の取引は、同じ指紋になる", () => {
      expect(transactionFingerprint(transactionOf())).toBe(
        transactionFingerprint(transactionOf()),
      );
    });

    it("同じ取引を2回渡しても、同じ指紋を返す（決定的である）", () => {
      const transaction = transactionOf();
      expect(transactionFingerprint(transaction)).toBe(
        transactionFingerprint(transaction),
      );
    });

    it("プロパティの定義順が違っても、内容が同じなら同じ指紋になる", () => {
      const reordered: Transaction = {
        source: BASE.source,
        description: BASE.description,
        amountYen: BASE.amountYen,
        date: BASE.date,
      };
      expect(transactionFingerprint(reordered)).toBe(
        transactionFingerprint(transactionOf()),
      );
    });

    it("収入（正の金額）どうしでも、内容が同じなら同じ指紋になる", () => {
      const income = transactionOf({ amountYen: 250000, source: "bank" });
      expect(transactionFingerprint(income)).toBe(
        transactionFingerprint({ ...income }),
      );
    });

    it("空の description どうしでも、内容が同じなら同じ指紋になる", () => {
      const blank = transactionOf({ description: "" });
      expect(transactionFingerprint(blank)).toBe(
        transactionFingerprint({ ...blank }),
      );
    });

    it("文字列を返す", () => {
      expect(typeof transactionFingerprint(transactionOf())).toBe("string");
    });
  });

  describe("date だけが違うとき、指紋が変わる", () => {
    it("1日違いのとき、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ date: "2026-01-16" }))).not.toBe(
        transactionFingerprint(transactionOf({ date: "2026-01-15" })),
      );
    });

    it("月だけが違うとき、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ date: "2026-02-15" }))).not.toBe(
        transactionFingerprint(transactionOf({ date: "2026-01-15" })),
      );
    });

    it("年だけが違うとき、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ date: "2025-01-15" }))).not.toBe(
        transactionFingerprint(transactionOf({ date: "2026-01-15" })),
      );
    });
  });

  describe("amountYen だけが違うとき、指紋が変わる", () => {
    it("1円違いのとき、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ amountYen: -501 }))).not.toBe(
        transactionFingerprint(transactionOf({ amountYen: -500 })),
      );
    });

    it("符号だけが違うとき（-500 と 500）、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ amountYen: 500 }))).not.toBe(
        transactionFingerprint(transactionOf({ amountYen: -500 })),
      );
    });

    it("0 と 0以外は、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ amountYen: 0 }))).not.toBe(
        transactionFingerprint(transactionOf({ amountYen: -500 })),
      );
    });
  });

  describe("description だけが違うとき、指紋が変わる", () => {
    it("店名が違うとき、指紋が変わる", () => {
      expect(
        transactionFingerprint(transactionOf({ description: "ローソン" })),
      ).not.toBe(
        transactionFingerprint(transactionOf({ description: "セブンイレブン" })),
      );
    });

    it("末尾の空白の有無だけが違うとき、指紋が変わる（トリムしない）", () => {
      expect(
        transactionFingerprint(transactionOf({ description: "セブンイレブン " })),
      ).not.toBe(
        transactionFingerprint(transactionOf({ description: "セブンイレブン" })),
      );
    });

    it("先頭の空白の有無だけが違うとき、指紋が変わる（トリムしない）", () => {
      expect(
        transactionFingerprint(transactionOf({ description: " セブンイレブン" })),
      ).not.toBe(
        transactionFingerprint(transactionOf({ description: "セブンイレブン" })),
      );
    });

    it("大文字小文字だけが違うとき、指紋が変わる（統一しない）", () => {
      expect(transactionFingerprint(transactionOf({ description: "AMAZON" }))).not.toBe(
        transactionFingerprint(transactionOf({ description: "amazon" })),
      );
    });

    it("空文字列と空白1文字は、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ description: "" }))).not.toBe(
        transactionFingerprint(transactionOf({ description: " " })),
      );
    });
  });

  describe("source だけが違うとき、指紋が変わる", () => {
    it("card と bank は、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ source: "card" }))).not.toBe(
        transactionFingerprint(transactionOf({ source: "bank" })),
      );
    });

    it("bank と cash は、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ source: "bank" }))).not.toBe(
        transactionFingerprint(transactionOf({ source: "cash" })),
      );
    });

    it("card と cash は、指紋が変わる", () => {
      expect(transactionFingerprint(transactionOf({ source: "card" }))).not.toBe(
        transactionFingerprint(transactionOf({ source: "cash" })),
      );
    });
  });

  describe("項目の境界が混ざらないこと", () => {
    it("金額と description の切れ目がずれた組み合わせでも、指紋が衝突しない", () => {
      // 区切り無しで連結すると "…-500セブン…" と "…-5" + "00セブン…" が同じ文字列になる
      const a = transactionOf({ amountYen: -500, description: "セブン" });
      const b = transactionOf({ amountYen: -5, description: "00セブン" });
      expect(transactionFingerprint(a)).not.toBe(transactionFingerprint(b));
    });

    it("description が区切り文字らしき記号を含んでいても、他項目との衝突を起こさない", () => {
      const a = transactionOf({ description: "セブン|card", source: "bank" });
      const b = transactionOf({ description: "セブン", source: "card" });
      expect(transactionFingerprint(a)).not.toBe(transactionFingerprint(b));
    });
  });

  it("引数を書き換えない", () => {
    const transaction = transactionOf();
    const snapshot = structuredClone(transaction);
    transactionFingerprint(Object.freeze(transaction));
    expect(transaction).toEqual(snapshot);
  });
});

describe("classifyForImport", () => {
  describe("空の入力", () => {
    it("existing も incoming も空のとき、空配列を返す", () => {
      expect(classifyForImport([], [])).toEqual([]);
    });

    it("existing が空でないが incoming が空のとき、空配列を返す", () => {
      expect(classifyForImport(frozen([transactionOf()]), [])).toEqual([]);
    });

    it("existing が空のとき、incoming はすべて new になる", () => {
      const incoming = frozen([
        transactionOf(),
        transactionOf({ description: "ローソン" }),
        transactionOf({ date: "2026-02-01" }),
      ]);
      expect(statusesOf(classifyForImport([], incoming))).toEqual([
        "new",
        "new",
        "new",
      ]);
    });
  });

  describe("件数の突き合わせ（同一指紋のみ）", () => {
    const target = transactionOf();

    it("existing 0件・incoming 1件 のとき、new", () => {
      const result = classifyForImport([], frozen(repeat(target, 1)));
      expect(statusesOf(result)).toEqual(["new"]);
    });

    it("existing 1件・incoming 1件 のとき、duplicate-candidate", () => {
      const result = classifyForImport(
        frozen(repeat(target, 1)),
        frozen(repeat(target, 1)),
      );
      expect(statusesOf(result)).toEqual(["duplicate-candidate"]);
    });

    it("existing 0件・incoming 2件 のとき、同じ店で2回買った正当な明細として両方 new", () => {
      const result = classifyForImport([], frozen(repeat(target, 2)));
      expect(statusesOf(result)).toEqual(["new", "new"]);
    });

    it("existing 1件・incoming 2件 のとき、先頭だけ duplicate-candidate で2件目は new", () => {
      const result = classifyForImport(
        frozen(repeat(target, 1)),
        frozen(repeat(target, 2)),
      );
      expect(statusesOf(result)).toEqual(["duplicate-candidate", "new"]);
    });

    it("existing 2件・incoming 1件 のとき、incoming の1件だけが duplicate-candidate", () => {
      const result = classifyForImport(
        frozen(repeat(target, 2)),
        frozen(repeat(target, 1)),
      );
      expect(statusesOf(result)).toEqual(["duplicate-candidate"]);
    });

    it("existing 2件・incoming 2件 のとき、両方 duplicate-candidate", () => {
      const result = classifyForImport(
        frozen(repeat(target, 2)),
        frozen(repeat(target, 2)),
      );
      expect(statusesOf(result)).toEqual([
        "duplicate-candidate",
        "duplicate-candidate",
      ]);
    });

    it("existing 2件・incoming 3件 のとき、先頭2件が duplicate-candidate で3件目は new", () => {
      const result = classifyForImport(
        frozen(repeat(target, 2)),
        frozen(repeat(target, 3)),
      );
      expect(statusesOf(result)).toEqual([
        "duplicate-candidate",
        "duplicate-candidate",
        "new",
      ]);
    });

    it("existing 3件・incoming 2件 のとき、既存が多くても incoming の2件とも duplicate-candidate", () => {
      const result = classifyForImport(
        frozen(repeat(target, 3)),
        frozen(repeat(target, 2)),
      );
      expect(statusesOf(result)).toEqual([
        "duplicate-candidate",
        "duplicate-candidate",
      ]);
    });

    it("existing 3件・incoming 5件 のとき、3件目と4件目で切り替わる", () => {
      const result = classifyForImport(
        frozen(repeat(target, 3)),
        frozen(repeat(target, 5)),
      );
      expect(statusesOf(result)).toEqual([
        "duplicate-candidate",
        "duplicate-candidate",
        "duplicate-candidate",
        "new",
        "new",
      ]);
    });

    it("existing の並び順は結果に影響しない（件数だけで決まる）", () => {
      const other = transactionOf({ description: "ローソン" });
      const forward = classifyForImport(
        frozen([target, other, target]),
        frozen(repeat(target, 3)),
      );
      const backward = classifyForImport(
        frozen([target, target, other]),
        frozen(repeat(target, 3)),
      );
      expect(statusesOf(forward)).toEqual([
        "duplicate-candidate",
        "duplicate-candidate",
        "new",
      ]);
      expect(statusesOf(backward)).toEqual(statusesOf(forward));
    });
  });

  describe("4項目のうち1つでも違えば、別の取引として扱う", () => {
    it("date だけが違うとき、new", () => {
      const result = classifyForImport(
        frozen([transactionOf({ date: "2026-01-15" })]),
        frozen([transactionOf({ date: "2026-01-16" })]),
      );
      expect(statusesOf(result)).toEqual(["new"]);
    });

    it("amountYen だけが違うとき、new", () => {
      const result = classifyForImport(
        frozen([transactionOf({ amountYen: -500 })]),
        frozen([transactionOf({ amountYen: -501 })]),
      );
      expect(statusesOf(result)).toEqual(["new"]);
    });

    it("description だけが違うとき、new", () => {
      const result = classifyForImport(
        frozen([transactionOf({ description: "セブンイレブン" })]),
        frozen([transactionOf({ description: "ローソン" })]),
      );
      expect(statusesOf(result)).toEqual(["new"]);
    });

    it("source だけが違うとき、new", () => {
      const result = classifyForImport(
        frozen([transactionOf({ source: "card" })]),
        frozen([transactionOf({ source: "bank" })]),
      );
      expect(statusesOf(result)).toEqual(["new"]);
    });

    it("符号だけが違うとき（-500 と 500）、new", () => {
      const result = classifyForImport(
        frozen([transactionOf({ amountYen: -500 })]),
        frozen([transactionOf({ amountYen: 500 })]),
      );
      expect(statusesOf(result)).toEqual(["new"]);
    });

    it("description の末尾の空白の有無だけが違うとき、new", () => {
      const result = classifyForImport(
        frozen([transactionOf({ description: "セブンイレブン" })]),
        frozen([transactionOf({ description: "セブンイレブン " })]),
      );
      expect(statusesOf(result)).toEqual(["new"]);
    });

    it("4項目すべてが一致するとき（上の各ケースとの対）、duplicate-candidate", () => {
      const result = classifyForImport(
        frozen([transactionOf()]),
        frozen([transactionOf()]),
      );
      expect(statusesOf(result)).toEqual(["duplicate-candidate"]);
    });

    it("existing に無関係な取引しか無いとき、すべて new", () => {
      const result = classifyForImport(
        frozen([
          transactionOf({ description: "ローソン" }),
          transactionOf({ date: "2026-03-03" }),
        ]),
        frozen(repeat(transactionOf(), 2)),
      );
      expect(statusesOf(result)).toEqual(["new", "new"]);
    });
  });

  describe("指紋ごとに独立して件数が突き合わされる", () => {
    const a = transactionOf({ description: "セブンイレブン", amountYen: -500 });
    const b = transactionOf({ description: "ローソン", amountYen: -800 });

    it("A が既存1件・新規2件、B が既存0件・新規1件 のとき、対応が保たれる", () => {
      const result = classifyForImport(frozen([a]), frozen([a, a, b]));
      expect(statusesOf(result)).toEqual([
        "duplicate-candidate",
        "new",
        "new",
      ]);
    });

    it("指紋が交互に並んでいても、それぞれの件数で判定される", () => {
      // A は既存2件、B は既存0件
      const result = classifyForImport(
        frozen([a, a]),
        frozen([b, a, b, a, a]),
      );
      expect(statusesOf(result)).toEqual([
        "new",
        "duplicate-candidate",
        "new",
        "duplicate-candidate",
        "new",
      ]);
    });

    it("一方の指紋の既存件数が、他方の判定に流用されない", () => {
      // A は既存3件、B は既存0件。B が A の余りを消費してはいけない
      const result = classifyForImport(
        frozen([a, a, a]),
        frozen([a, b, b]),
      );
      expect(statusesOf(result)).toEqual(["duplicate-candidate", "new", "new"]);
    });
  });

  describe("戻り値の形と順序", () => {
    it("incoming と同じ長さの配列を返す", () => {
      const incoming = frozen(repeat(transactionOf(), 4));
      expect(classifyForImport(frozen([transactionOf()]), incoming)).toHaveLength(4);
    });

    it("各要素の transaction は incoming の対応する要素と同じ内容で、順序も同じ", () => {
      const incoming = frozen([
        transactionOf({ description: "A" }),
        transactionOf({ description: "B" }),
        transactionOf({ description: "C" }),
      ]);
      const result = classifyForImport(frozen([transactionOf({ description: "B" })]), incoming);
      expect(result.map((row) => row.transaction)).toEqual([...incoming]);
      expect(statusesOf(result)).toEqual(["new", "duplicate-candidate", "new"]);
    });

    it("重複候補が後ろに並んでいても、位置が入れ替わらない", () => {
      const dup = transactionOf({ description: "重複" });
      const incoming = frozen([
        transactionOf({ description: "先頭" }),
        dup,
        transactionOf({ description: "末尾" }),
      ]);
      const result = classifyForImport(frozen([dup]), incoming);
      expect(result.map((row) => row.transaction.description)).toEqual([
        "先頭",
        "重複",
        "末尾",
      ]);
      expect(statusesOf(result)).toEqual(["new", "duplicate-candidate", "new"]);
    });

    it("status は new と duplicate-candidate のいずれかだけを取る", () => {
      const result = classifyForImport(
        frozen(repeat(transactionOf(), 1)),
        frozen(repeat(transactionOf(), 3)),
      );
      for (const row of result) {
        expect(["new", "duplicate-candidate"]).toContain(row.status);
      }
    });
  });

  describe("純粋関数であること", () => {
    it("existing と incoming を書き換えない", () => {
      const existing = [transactionOf(), transactionOf({ description: "ローソン" })];
      const incoming = [transactionOf(), transactionOf(), transactionOf({ source: "cash" })];
      const existingSnapshot = structuredClone(existing);
      const incomingSnapshot = structuredClone(incoming);

      classifyForImport(existing, incoming);

      expect(existing).toEqual(existingSnapshot);
      expect(incoming).toEqual(incomingSnapshot);
    });

    it("凍結された配列と要素を渡しても、書き換えを試みない", () => {
      const existing = frozen(repeat(transactionOf(), 2));
      const incoming = frozen(repeat(transactionOf(), 3));
      expect(() => classifyForImport(existing, incoming)).not.toThrow();
    });

    it("同じ入力で2回呼ぶと、同じ結果になる", () => {
      const existing = frozen([transactionOf(), transactionOf({ description: "ローソン" })]);
      const incoming = frozen([
        transactionOf(),
        transactionOf(),
        transactionOf({ description: "ローソン" }),
      ]);

      const first = classifyForImport(existing, incoming);
      const second = classifyForImport(existing, incoming);

      expect(statusesOf(second)).toEqual(statusesOf(first));
      expect(statusesOf(first)).toEqual(["duplicate-candidate", "new", "duplicate-candidate"]);
    });

    it("戻り値を書き換えても、次の呼び出しの結果に影響しない", () => {
      const existing = frozen(repeat(transactionOf(), 1));
      const incoming = frozen(repeat(transactionOf(), 2));

      const first = classifyForImport(existing, incoming);
      first.length = 0;

      expect(statusesOf(classifyForImport(existing, incoming))).toEqual([
        "duplicate-candidate",
        "new",
      ]);
    });
  });

  describe("classifyForImport の同一判定は transactionFingerprint と一致する", () => {
    it("指紋が同じなら duplicate-candidate、違えば new になる", () => {
      const left = transactionOf({ description: "セブンイレブン" });
      const right = transactionOf({ description: "セブンイレブン " });

      expect(transactionFingerprint(left)).not.toBe(transactionFingerprint(right));
      expect(statusesOf(classifyForImport(frozen([left]), frozen([right])))).toEqual([
        "new",
      ]);
      expect(statusesOf(classifyForImport(frozen([left]), frozen([{ ...left }])))).toEqual([
        "duplicate-candidate",
      ]);
    });
  });
});
