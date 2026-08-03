import { describe, it, expect } from "vitest";
import { applyMapping } from "./column-mapping.js";
import type { ColumnMapping } from "./column-mapping.js";
import type { Transaction } from "../domain/transaction.js";

/** 既定は date=0, amount=1, description=2 / skipRows=0 / card / 反転なし */
const mappingOf = (overrides: Partial<ColumnMapping> = {}): ColumnMapping => ({
  skipRows: 0,
  dateColumn: 0,
  amountColumn: 1,
  descriptionColumn: 2,
  source: "card",
  invertAmount: false,
  ...overrides,
});

describe("applyMapping", () => {
  describe("正常系", () => {
    it("skipRows が 0 のとき、先頭行も飛ばさずに変換する", () => {
      const rows = [
        ["2026-08-03", "-1234", "コンビニ"],
        ["2026-08-04", "5000", "給与"],
      ];

      const expected: Transaction[] = [
        { date: "2026-08-03", amountYen: -1234, description: "コンビニ", source: "card" },
        { date: "2026-08-04", amountYen: 5000, description: "給与", source: "card" },
      ];

      expect(applyMapping(rows, mappingOf())).toEqual({ transactions: expected, errors: [] });
    });

    it("skipRows が 1 のとき、ヘッダ行を飛ばして残りを変換する", () => {
      const rows = [
        ["日付", "金額", "摘要"],
        ["2026-08-03", "-1234", "コンビニ"],
        ["2026-08-04", "5000", "給与"],
      ];

      const expected: Transaction[] = [
        { date: "2026-08-03", amountYen: -1234, description: "コンビニ", source: "card" },
        { date: "2026-08-04", amountYen: 5000, description: "給与", source: "card" },
      ];

      expect(applyMapping(rows, mappingOf({ skipRows: 1 }))).toEqual({
        transactions: expected,
        errors: [],
      });
    });

    it("skipRows が 2 のとき、先頭2行を飛ばす", () => {
      const rows = [
        ["# エクスポート"],
        ["日付", "金額", "摘要"],
        ["2026-08-03", "-1234", "コンビニ"],
      ];

      expect(applyMapping(rows, mappingOf({ skipRows: 2 }))).toEqual({
        transactions: [
          { date: "2026-08-03", amountYen: -1234, description: "コンビニ", source: "card" },
        ],
        errors: [],
      });
    });

    it("transactions は入力の行順を保つ", () => {
      const rows = [
        ["2026-08-03", "1", "a"],
        ["2026-08-01", "2", "b"],
        ["2026-08-02", "3", "c"],
      ];

      const result = applyMapping(rows, mappingOf());

      expect(result.transactions.map((t) => t.description)).toEqual(["a", "b", "c"]);
    });

    it("列の並びが日付・金額・摘要の順でなくても、指定した列から取り出す", () => {
      const rows = [["-1234", "コンビニ", "2026-08-03"]];

      expect(
        applyMapping(
          rows,
          mappingOf({ dateColumn: 2, amountColumn: 0, descriptionColumn: 1 }),
        ),
      ).toEqual({
        transactions: [
          { date: "2026-08-03", amountYen: -1234, description: "コンビニ", source: "card" },
        ],
        errors: [],
      });
    });

    it("指定した列より後ろに余分な列があっても無視する", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ", "余分", "さらに余分"]];

      expect(applyMapping(rows, mappingOf())).toEqual({
        transactions: [
          { date: "2026-08-03", amountYen: -1234, description: "コンビニ", source: "card" },
        ],
        errors: [],
      });
    });

    it("日付と金額は正規化されて格納される（各パーサを通していること）", () => {
      const rows = [["2026/8/3", "¥1,234円", "スーパー"]];

      expect(applyMapping(rows, mappingOf())).toEqual({
        transactions: [
          { date: "2026-08-03", amountYen: 1234, description: "スーパー", source: "card" },
        ],
        errors: [],
      });
    });

    it("摘要はそのまま格納される（カンマを含む値も欠けない）", () => {
      const rows = [["2026-08-03", "-1234", "スーパー, 食料品"]];

      expect(applyMapping(rows, mappingOf()).transactions.map((t) => t.description)).toEqual([
        "スーパー, 食料品",
      ]);
    });

    it("摘要が空文字列でも、他の列が有効ならエラーにしない", () => {
      const rows = [["2026-08-03", "-1234", ""]];

      expect(applyMapping(rows, mappingOf())).toEqual({
        transactions: [{ date: "2026-08-03", amountYen: -1234, description: "", source: "card" }],
        errors: [],
      });
    });
  });

  describe("source", () => {
    it("mapping の source が各 Transaction に入る（card）", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      expect(applyMapping(rows, mappingOf({ source: "card" })).transactions.map((t) => t.source))
        .toEqual(["card"]);
    });

    it("mapping の source が各 Transaction に入る（bank）", () => {
      const rows = [["2026-08-03", "-1234", "振込"]];

      expect(applyMapping(rows, mappingOf({ source: "bank" })).transactions.map((t) => t.source))
        .toEqual(["bank"]);
    });

    it("mapping の source が各 Transaction に入る（cash）", () => {
      const rows = [
        ["2026-08-03", "-1234", "現金1"],
        ["2026-08-04", "-99", "現金2"],
      ];

      expect(applyMapping(rows, mappingOf({ source: "cash" })).transactions.map((t) => t.source))
        .toEqual(["cash", "cash"]);
    });
  });

  describe("invertAmount", () => {
    it("true でも金額 0 は -0 にせず 0 のままにする", () => {
      // -0 は Intl.NumberFormat が "-￥0" と表示する。
      // toBe は Object.is 基準なので -0 と 0 を区別する。
      const rows = [["2026-08-03", "0", "残高調整"]];

      const result = applyMapping(rows, mappingOf({ invertAmount: true }));

      expect(result.transactions[0]?.amountYen).toBe(0);
    });

    it("false のとき、符号をそのまま保つ", () => {
      const rows = [
        ["2026-08-03", "-1234", "支出"],
        ["2026-08-04", "5000", "収入"],
      ];

      expect(
        applyMapping(rows, mappingOf({ invertAmount: false })).transactions.map((t) => t.amountYen),
      ).toEqual([-1234, 5000]);
    });

    it("true のとき、負数を正数に反転する", () => {
      const rows = [["2026-08-03", "-1234", "支出"]];

      expect(
        applyMapping(rows, mappingOf({ invertAmount: true })).transactions.map((t) => t.amountYen),
      ).toEqual([1234]);
    });

    it("true のとき、正数を負数に反転する", () => {
      const rows = [["2026-08-04", "5000", "収入"]];

      expect(
        applyMapping(rows, mappingOf({ invertAmount: true })).transactions.map((t) => t.amountYen),
      ).toEqual([-5000]);
    });

    it("true のとき、同じ入力に対して false と逆符号になる", () => {
      const rows = [
        ["2026-08-03", "-1234", "支出"],
        ["2026-08-04", "5000", "収入"],
      ];

      const notInverted = applyMapping(rows, mappingOf({ invertAmount: false }));
      const inverted = applyMapping(rows, mappingOf({ invertAmount: true }));

      expect(inverted.transactions.map((t) => t.amountYen)).toEqual(
        notInverted.transactions.map((t) => -t.amountYen),
      );
    });

    it("true でも日付・摘要・source は変わらない", () => {
      const rows = [["2026/8/3", "-1,234", "コンビニ"]];

      expect(applyMapping(rows, mappingOf({ invertAmount: true, source: "bank" }))).toEqual({
        transactions: [
          { date: "2026-08-03", amountYen: 1234, description: "コンビニ", source: "bank" },
        ],
        errors: [],
      });
    });
  });

  describe("列インデックスが行の範囲外", () => {
    it("最後の列を指しているとき（範囲のすぐ内側）、成功する", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf({ descriptionColumn: 2 }));

      expect(result.errors).toEqual([]);
      expect(result.transactions).toHaveLength(1);
    });

    it("最後の列の1つ先を指しているとき（範囲のすぐ外側）、errors に記録して行を飛ばす", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf({ descriptionColumn: 3 }));

      expect(result.transactions).toEqual([]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([1]);
    });

    it("行が短くて摘要列が存在しないとき、errors に記録して行を飛ばす", () => {
      const rows = [["2026-08-03", "-1234"]];

      const result = applyMapping(rows, mappingOf());

      expect(result.transactions).toEqual([]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([1]);
    });

    it("日付列が範囲外のとき、errors に記録して行を飛ばす", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf({ dateColumn: 5 }));

      expect(result.transactions).toEqual([]);
      expect(result.errors).toHaveLength(1);
    });

    it("金額列が範囲外のとき、errors に記録して行を飛ばす", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf({ amountColumn: 9 }));

      expect(result.transactions).toEqual([]);
      expect(result.errors).toHaveLength(1);
    });

    it("日付列だけが範囲外のとき、種別は column-out-of-range になる", () => {
      // 他の列は妥当なので、範囲チェックを外すとパース側で落ちて
      // parse-failed になってしまう。種別で区別できることを検査する。
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf({ dateColumn: 5 }));

      expect(result.errors.map((e) => e.kind)).toEqual(["column-out-of-range"]);
    });

    it("金額列だけが範囲外のとき、種別は column-out-of-range になる", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf({ amountColumn: 9 }));

      expect(result.errors.map((e) => e.kind)).toEqual(["column-out-of-range"]);
    });

    it("摘要列だけが範囲外のとき、種別は column-out-of-range になる", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf({ descriptionColumn: 7 }));

      expect(result.errors.map((e) => e.kind)).toEqual(["column-out-of-range"]);
    });

    it("範囲外の行があっても例外を投げず、範囲内の行は変換される", () => {
      const rows = [
        ["2026-08-03", "-1234", "コンビニ"],
        ["2026-08-04", "-99"],
        ["2026-08-05", "-500", "書店"],
      ];

      const result = applyMapping(rows, mappingOf());

      expect(result.transactions.map((t) => t.date)).toEqual(["2026-08-03", "2026-08-05"]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([2]);
    });
  });

  describe("パース失敗", () => {
    it("日付がパースできない行は errors に記録して飛ばす", () => {
      const rows = [["2026-13-01", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf());

      expect(result.transactions).toEqual([]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([1]);
    });

    it("列は範囲内でパースだけ失敗したとき、種別は parse-failed になる", () => {
      const rows = [["2026-13-01", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf());

      expect(result.errors.map((e) => e.kind)).toEqual(["parse-failed"]);
    });

    it("平年の2月29日の行は errors に記録して飛ばす", () => {
      const rows = [["2026-02-29", "-1234", "コンビニ"]];

      expect(applyMapping(rows, mappingOf()).errors).toHaveLength(1);
    });

    it("金額がパースできない行は errors に記録して飛ばす", () => {
      const rows = [["2026-08-03", "abc", "コンビニ"]];

      const result = applyMapping(rows, mappingOf());

      expect(result.transactions).toEqual([]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([1]);
    });

    it("金額が小数の行は errors に記録して飛ばす", () => {
      const rows = [["2026-08-03", "12.5", "コンビニ"]];

      expect(applyMapping(rows, mappingOf()).errors).toHaveLength(1);
    });

    it("日付と金額の両方が不正でも、1行につき errors は1件で、例外は投げない", () => {
      const rows = [["not-a-date", "not-a-number", "コンビニ"]];

      expect(() => applyMapping(rows, mappingOf())).not.toThrow();
      expect(applyMapping(rows, mappingOf()).errors).toHaveLength(1);
    });

    it("全行が不正でも例外を投げず、errors だけを返す", () => {
      const rows = [
        ["x", "y", "z"],
        ["a", "b", "c"],
      ];

      const result = applyMapping(rows, mappingOf());

      expect(result.transactions).toEqual([]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([1, 2]);
    });

    it("errors の message は空でない文字列である", () => {
      const rows = [["2026-13-01", "-1234", "コンビニ"]];

      const result = applyMapping(rows, mappingOf());

      expect(result.errors).toHaveLength(1);
      expect(result.errors.every((e) => typeof e.message === "string" && e.message.length > 0))
        .toBe(true);
    });

    it("成功行とエラー行が混在するとき、両方をそれぞれに振り分ける", () => {
      const rows = [
        ["日付", "金額", "摘要"],
        ["2026-08-03", "-1234", "コンビニ"],
        ["2026-13-01", "-500", "壊れた日付"],
        ["2026-08-05", "abc", "壊れた金額"],
        ["2026-08-06", "-99", "書店"],
      ];

      const result = applyMapping(rows, mappingOf({ skipRows: 1 }));

      expect(result.transactions).toEqual([
        { date: "2026-08-03", amountYen: -1234, description: "コンビニ", source: "card" },
        { date: "2026-08-06", amountYen: -99, description: "書店", source: "card" },
      ]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([3, 4]);
    });
  });

  describe("rowNumber", () => {
    it("skipRows が 0 のとき、最初の行の rowNumber は 1（0始まりではない）", () => {
      const rows = [["bad", "bad", "x"]];

      expect(applyMapping(rows, mappingOf()).errors.map((e) => e.rowNumber)).toEqual([1]);
    });

    it("skipRows が 0 のとき、3行目のエラーの rowNumber は 3", () => {
      const rows = [
        ["2026-08-03", "-1", "a"],
        ["2026-08-04", "-2", "b"],
        ["bad", "-3", "c"],
      ];

      expect(applyMapping(rows, mappingOf()).errors.map((e) => e.rowNumber)).toEqual([3]);
    });

    it("skipRows が 1 のとき、最初のデータ行の rowNumber は 2（飛ばした行も数える）", () => {
      const rows = [
        ["日付", "金額", "摘要"],
        ["bad", "-1234", "コンビニ"],
      ];

      expect(applyMapping(rows, mappingOf({ skipRows: 1 })).errors.map((e) => e.rowNumber))
        .toEqual([2]);
    });

    it("skipRows が 2 のとき、最初のデータ行の rowNumber は 3", () => {
      const rows = [
        ["# コメント"],
        ["日付", "金額", "摘要"],
        ["bad", "-1234", "コンビニ"],
      ];

      expect(applyMapping(rows, mappingOf({ skipRows: 2 })).errors.map((e) => e.rowNumber))
        .toEqual([3]);
    });

    it("rowNumber は成功行を含めた通し番号で、errors の件数に依存しない", () => {
      const rows = [
        ["日付", "金額", "摘要"],
        ["2026-08-03", "-1", "ok"],
        ["bad", "-2", "ng"],
        ["2026-08-05", "-3", "ok"],
        ["2026-08-06", "xyz", "ng"],
      ];

      expect(applyMapping(rows, mappingOf({ skipRows: 1 })).errors.map((e) => e.rowNumber))
        .toEqual([3, 5]);
    });
  });

  describe("空行の扱い", () => {
    it("全フィールドが空文字列の行は、errors にも transactions にも入らない", () => {
      const rows = [
        ["2026-08-03", "-1234", "コンビニ"],
        ["", "", ""],
      ];

      expect(applyMapping(rows, mappingOf())).toEqual({
        transactions: [
          { date: "2026-08-03", amountYen: -1234, description: "コンビニ", source: "card" },
        ],
        errors: [],
      });
    });

    it("空文字列1つだけの行（CSVの空行）も黙って飛ばす（列が範囲外でもエラーにしない）", () => {
      const rows = [["2026-08-03", "-1234", "コンビニ"], [""]];

      expect(applyMapping(rows, mappingOf()).errors).toEqual([]);
    });

    it("空行が複数あっても、すべて黙って飛ばす", () => {
      const rows = [["", "", ""], [""], ["", ""]];

      expect(applyMapping(rows, mappingOf())).toEqual({ transactions: [], errors: [] });
    });

    it("1つでも空でないフィールドがあれば空行ではなく、パース失敗として errors に入る", () => {
      const rows = [["", "", "摘要だけある"]];

      const result = applyMapping(rows, mappingOf());

      expect(result.transactions).toEqual([]);
      expect(result.errors.map((e) => e.rowNumber)).toEqual([1]);
    });

    it("空白文字だけのフィールドは空文字列ではないので、errors に入る", () => {
      const rows = [[" ", " ", " "]];

      expect(applyMapping(rows, mappingOf()).errors).toHaveLength(1);
    });

    it("空行を飛ばしても、後続行の rowNumber はずれない", () => {
      const rows = [
        ["2026-08-03", "-1", "a"],
        ["", "", ""],
        ["bad", "-3", "c"],
      ];

      expect(applyMapping(rows, mappingOf()).errors.map((e) => e.rowNumber)).toEqual([3]);
    });
  });

  describe("行数と skipRows の境界", () => {
    it("rows が空配列のとき、transactions も errors も空を返す", () => {
      expect(applyMapping([], mappingOf())).toEqual({ transactions: [], errors: [] });
    });

    it("rows が空配列で skipRows が 1 のとき、例外を投げず空を返す", () => {
      expect(applyMapping([], mappingOf({ skipRows: 1 }))).toEqual({
        transactions: [],
        errors: [],
      });
    });

    it("skipRows が行数より1小さいとき（境界のすぐ内側）、最終行だけ処理する", () => {
      const rows = [
        ["2026-08-03", "-1", "a"],
        ["2026-08-04", "-2", "b"],
      ];

      expect(applyMapping(rows, mappingOf({ skipRows: 1 })).transactions.map((t) => t.description))
        .toEqual(["b"]);
    });

    it("skipRows が行数と等しいとき（境界のすぐ外側）、何も処理せず errors も空", () => {
      const rows = [
        ["2026-08-03", "-1", "a"],
        ["2026-08-04", "-2", "b"],
      ];

      expect(applyMapping(rows, mappingOf({ skipRows: 2 }))).toEqual({
        transactions: [],
        errors: [],
      });
    });

    it("skipRows が行数を超えるとき、例外を投げず空を返す", () => {
      const rows = [["2026-08-03", "-1", "a"]];

      expect(applyMapping(rows, mappingOf({ skipRows: 5 }))).toEqual({
        transactions: [],
        errors: [],
      });
    });
  });

  describe("純粋関数であること", () => {
    it("入力の rows を書き換えない", () => {
      const rows = [
        ["日付", "金額", "摘要"],
        ["2026/8/3", "¥1,234", "コンビニ"],
        ["bad", "-2", "b"],
      ];
      const snapshot = rows.map((row) => [...row]);

      applyMapping(rows, mappingOf({ skipRows: 1, invertAmount: true }));

      expect(rows).toEqual(snapshot);
    });

    it("同じ入力を2回渡すと同じ結果を返す", () => {
      const rows = [
        ["2026-08-03", "-1234", "コンビニ"],
        ["bad", "-2", "b"],
      ];

      expect(applyMapping(rows, mappingOf())).toEqual(applyMapping(rows, mappingOf()));
    });
  });
});
