import { describe, it, expect } from "vitest";
import { buildCashTransaction } from "./manual-entry.js";
import type {
  CashEntryError,
  CashEntryField,
  CashEntryInput,
  CashEntryResult,
} from "./manual-entry.js";
import type { Transaction } from "../domain/transaction.js";

/** 既定はすべて有効な入力。検査したい項目だけ差し替える */
const inputOf = (overrides: Partial<CashEntryInput> = {}): CashEntryInput => ({
  date: "2026-08-09",
  amount: "1200",
  description: "コンビニ",
  ...overrides,
});

function expectSuccess(result: CashEntryResult): Transaction {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`成功を期待したが失敗した: ${JSON.stringify(result.errors)}`);
  }
  return result.transaction;
}

function expectFailure(result: CashEntryResult): CashEntryError[] {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`失敗を期待したが成功した: ${JSON.stringify(result.transaction)}`);
  }
  return result.errors;
}

/** エラーの field を辞書順に並べたもの。message の文言は検査しない */
const failedFields = (result: CashEntryResult): CashEntryField[] =>
  expectFailure(result)
    .map((e) => e.field)
    .sort();

describe("buildCashTransaction", () => {
  describe("正常系", () => {
    it("有効な入力から Transaction を組み立てる", () => {
      const result = buildCashTransaction({
        date: "2026/8/9",
        amount: "¥1,200",
        description: " コンビニ ",
      });

      expect(expectSuccess(result)).toEqual({
        date: "2026-08-09",
        amountYen: -1200,
        description: "コンビニ",
        source: "cash",
      });
    });

    it("実データに現れる形（1,200円 と 年月日表記）でも組み立てる", () => {
      const result = buildCashTransaction({
        date: "2026年8月9日",
        amount: "1,200円",
        description: "ランチ",
      });

      expect(expectSuccess(result)).toEqual({
        date: "2026-08-09",
        amountYen: -1200,
        description: "ランチ",
        source: "cash",
      });
    });

    it("成功したとき ok は true である", () => {
      expect(buildCashTransaction(inputOf()).ok).toBe(true);
    });

    it("成功したとき errors を持たない", () => {
      const result = buildCashTransaction(inputOf());

      expect("errors" in result).toBe(false);
    });

    it("Transaction は date / amountYen / description / source の4つだけを持つ", () => {
      const transaction = expectSuccess(buildCashTransaction(inputOf()));

      expect(Object.keys(transaction).sort()).toEqual([
        "amountYen",
        "date",
        "description",
        "source",
      ]);
    });
  });

  describe("source", () => {
    it("成功時の source は常に cash である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf())).source).toBe("cash");
    });

    it("入力が変わっても source は cash のままである", () => {
      const result = buildCashTransaction({
        date: "2026年1月1日",
        amount: "¥9,999円",
        description: "初詣",
      });

      expect(expectSuccess(result).source).toBe("cash");
    });
  });

  describe("日付の受け付けと正規化", () => {
    it("YYYY/M/D を YYYY-MM-DD に正規化する", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026/8/9" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("YYYY-M-D を YYYY-MM-DD に正規化する", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026-8-9" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("YYYY年M月D日 を YYYY-MM-DD に正規化する", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026年8月9日" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("スラッシュ区切りで既に2桁ゼロ埋めされていても読める", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026/08/09" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("ハイフン区切りで既に YYYY-MM-DD の形なら、そのままの値になる", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026-12-31" }))).date).toBe(
        "2026-12-31",
      );
    });

    it("年月日表記で2桁ゼロ埋めされていても読める", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026年08月09日" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("3つの表記は同じ日付として同じ結果になる", () => {
      const slash = expectSuccess(buildCashTransaction(inputOf({ date: "2026/8/9" })));
      const hyphen = expectSuccess(buildCashTransaction(inputOf({ date: "2026-8-9" })));
      const kanji = expectSuccess(buildCashTransaction(inputOf({ date: "2026年8月9日" })));

      expect(hyphen).toEqual(slash);
      expect(kanji).toEqual(slash);
    });

    it("前後に空白があっても読める", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "  2026/8/9  " }))).date).toBe(
        "2026-08-09",
      );
    });

    it("前後にタブや改行があっても読める", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "\t2026年8月9日\n" }))).date).toBe(
        "2026-08-09",
      );
    });
  });

  describe("日付の境界（月末日と翌日）", () => {
    it("4月30日は有効である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026/4/30" }))).date).toBe(
        "2026-04-30",
      );
    });

    it("4月31日は実在しないのでエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/4/31" })))).toEqual(["date"]);
    });

    it("1月31日は有効である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026/1/31" }))).date).toBe(
        "2026-01-31",
      );
    });

    it("1月32日はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/1/32" })))).toEqual(["date"]);
    });

    it("12月31日（年内最終日）は有効である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026/12/31" }))).date).toBe(
        "2026-12-31",
      );
    });

    it("1月1日（年内最初の日）は有効である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026/1/1" }))).date).toBe(
        "2026-01-01",
      );
    });

    it("13月はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/13/1" })))).toEqual(["date"]);
    });

    it("0月はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/0/9" })))).toEqual(["date"]);
    });

    it("0日はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/8/0" })))).toEqual(["date"]);
    });

    it("2月30日はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026年2月30日" })))).toEqual([
        "date",
      ]);
    });
  });

  describe("日付の境界（うるう年）", () => {
    it("4で割り切れる年の2月29日は有効である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2024/2/29" }))).date).toBe(
        "2024-02-29",
      );
    });

    it("うるう年でない年の2月29日はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/2/29" })))).toEqual(["date"]);
    });

    it("うるう年でない年でも2月28日は有効である（29日との対）", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2026/2/28" }))).date).toBe(
        "2026-02-28",
      );
    });

    it("400で割り切れる年（2000年）の2月29日は有効である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2000/2/29" }))).date).toBe(
        "2000-02-29",
      );
    });

    it("100で割り切れるが400で割り切れない年（1900年）の2月29日はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "1900/2/29" })))).toEqual(["date"]);
    });

    it("うるう年の2月29日は年月日表記でも有効である", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ date: "2024年2月29日" }))).date).toBe(
        "2024-02-29",
      );
    });
  });

  describe("解釈できない日付", () => {
    it("空文字列はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "" })))).toEqual(["date"]);
    });

    it("空白だけのときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "   " })))).toEqual(["date"]);
    });

    it("日付ではない文字列はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "きのう" })))).toEqual(["date"]);
    });

    it("日が欠けているとエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/8" })))).toEqual(["date"]);
    });

    it("年が欠けているとエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "8/9" })))).toEqual(["date"]);
    });

    it("区切り文字が無い8桁の数字はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "20260809" })))).toEqual(["date"]);
    });

    it("区切り文字が混ざっているとエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026-8/9" })))).toEqual(["date"]);
    });

    it("時刻が付いているとエラーになる（日付だけを持つため）", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026/8/9 12:00" })))).toEqual([
        "date",
      ]);
    });

    it("日付の途中に空白があるとエラーになる（除去するのは前後の空白だけ）", () => {
      expect(failedFields(buildCashTransaction(inputOf({ date: "2026 / 8 / 9" })))).toEqual([
        "date",
      ]);
    });
  });

  describe("金額の受け付けと符号反転", () => {
    it("正の整数を負の amountYen にする", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "1200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("カンマ区切りを読む", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "1,200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("カンマが複数あっても読む", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "1,234,567" }))).amountYen).toBe(
        -1234567,
      );
    });

    it("半角風の ¥ を許容する", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "¥1,200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("全角の ￥ を許容する", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "￥1,200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("末尾の 円 を許容する", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "1,200円" }))).amountYen).toBe(
        -1200,
      );
    });

    it("通貨記号と単位が同時にあっても読む", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "¥1,200円" }))).amountYen).toBe(
        -1200,
      );
    });

    it("前後の空白を無視する", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "  ¥1,200  " }))).amountYen).toBe(
        -1200,
      );
    });

    it("amountYen は整数である", () => {
      const transaction = expectSuccess(buildCashTransaction(inputOf({ amount: "¥1,200円" })));

      expect(Number.isInteger(transaction.amountYen)).toBe(true);
    });

    it("amountYen は必ず負である（支出を負で表す元帳の慣習）", () => {
      const transaction = expectSuccess(buildCashTransaction(inputOf({ amount: "1" })));

      expect(transaction.amountYen).toBeLessThan(0);
    });
  });

  describe("金額の境界", () => {
    it("最小の有効値 1 を受け付け、-1 にする", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "1" }))).amountYen).toBe(-1);
    });

    it("0 はエラーになる（反転で -0 を作らないため）", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "0" })))).toEqual(["amount"]);
    });

    it("通貨記号付きの 0 もエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "¥0円" })))).toEqual(["amount"]);
    });

    it("安全整数の上限そのものは受け付ける", () => {
      const transaction = expectSuccess(
        buildCashTransaction(inputOf({ amount: "9007199254740991" })),
      );

      expect(transaction.amountYen).toBe(-9007199254740991);
    });

    it("安全整数の上限を1つ超えるとき、黙って丸めずエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "9007199254740992" })))).toEqual([
        "amount",
      ]);
    });

    it("桁数が極端に多いとき、Infinity にせずエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "9".repeat(400) })))).toEqual([
        "amount",
      ]);
    });
  });

  describe("金額が -0 にならないこと", () => {
    it("成功した Transaction の amountYen が -0 になることはない", () => {
      // -0 は `-0 < 0` が偽になり範囲チェックを素通りし、Intl.NumberFormat が
      // "-￥0" と表示する。toBe は Object.is 基準なので -0 と 0 を区別する。
      const transaction = expectSuccess(buildCashTransaction(inputOf({ amount: "1" })));

      expect(Object.is(transaction.amountYen, -0)).toBe(false);
    });

    it('"0" を成功させないことで -0 の発生源を断つ', () => {
      const result = buildCashTransaction(inputOf({ amount: "0" }));

      expect(result.ok).toBe(false);
    });

    it('"-0" はエラーになる', () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "-0" })))).toEqual(["amount"]);
    });
  });

  describe("金額に符号を付けられないこと", () => {
    it("負の数はエラーになる（符号を付けるのはこの関数の役割）", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "-500" })))).toEqual(["amount"]);
    });

    it("カンマ付きの負の数もエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "-1,200" })))).toEqual(["amount"]);
    });

    it("通貨記号付きの負の数もエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "¥-1,200" })))).toEqual([
        "amount",
      ]);
    });

    it("符号を外した同じ値は成功する（負数ケースとの対）", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ amount: "500" }))).amountYen).toBe(-500);
    });
  });

  describe("金額として解釈できない入力", () => {
    it("空文字列はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "" })))).toEqual(["amount"]);
    });

    it("空白だけのときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "   " })))).toEqual(["amount"]);
    });

    it("通貨記号だけで数字が無いときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "¥" })))).toEqual(["amount"]);
    });

    it("単位だけで数字が無いときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "円" })))).toEqual(["amount"]);
    });

    it("小数はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "1.5" })))).toEqual(["amount"]);
    });

    it("小数部が0でも、小数表記ならエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "1200.0" })))).toEqual(["amount"]);
    });

    it("英字だけのときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "abc" })))).toEqual(["amount"]);
    });

    it("数字の後ろに英字が続くときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "1200yen" })))).toEqual([
        "amount",
      ]);
    });

    it("数値の途中に空白があるときエラーになる（除去するのは前後の空白だけ）", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "1 200" })))).toEqual(["amount"]);
    });

    it("Infinity という文字列はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "Infinity" })))).toEqual([
        "amount",
      ]);
    });

    it("NaN という文字列はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "NaN" })))).toEqual(["amount"]);
    });
  });

  describe("摘要", () => {
    it("前後の空白を落として格納する", () => {
      expect(
        expectSuccess(buildCashTransaction(inputOf({ description: "  コンビニ  " }))).description,
      ).toBe("コンビニ");
    });

    it("タブや改行も落とす", () => {
      expect(
        expectSuccess(buildCashTransaction(inputOf({ description: "\tコンビニ\n" }))).description,
      ).toBe("コンビニ");
    });

    it("途中の空白は残す（落とすのは前後だけ）", () => {
      expect(
        expectSuccess(buildCashTransaction(inputOf({ description: " スーパー 食料品 " })))
          .description,
      ).toBe("スーパー 食料品");
    });

    it("カンマを含む摘要もそのまま格納する", () => {
      expect(
        expectSuccess(buildCashTransaction(inputOf({ description: "スーパー, 食料品" })))
          .description,
      ).toBe("スーパー, 食料品");
    });

    it("1文字の摘要も有効である（空との境界）", () => {
      expect(expectSuccess(buildCashTransaction(inputOf({ description: "茶" }))).description).toBe(
        "茶",
      );
    });

    it("空文字列はエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ description: "" })))).toEqual([
        "description",
      ]);
    });

    it("半角スペースだけのときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ description: "   " })))).toEqual([
        "description",
      ]);
    });

    it("全角スペースだけのときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ description: "　" })))).toEqual([
        "description",
      ]);
    });

    it("タブだけのときエラーになる", () => {
      expect(failedFields(buildCashTransaction(inputOf({ description: "\t" })))).toEqual([
        "description",
      ]);
    });
  });

  describe("エラーの集約", () => {
    it("3項目とも不正なとき、エラーは3件で field は1つずつである", () => {
      const result = buildCashTransaction({
        date: "2026/2/30",
        amount: "-0",
        description: "   ",
      });

      expect(failedFields(result)).toEqual(["amount", "date", "description"]);
    });

    it("日付と金額が不正なとき、最初の失敗で打ち切らず2件返す", () => {
      const result = buildCashTransaction(inputOf({ date: "2026/13/1", amount: "abc" }));

      expect(failedFields(result)).toEqual(["amount", "date"]);
    });

    it("金額と摘要が不正なとき、2件返す", () => {
      const result = buildCashTransaction(inputOf({ amount: "0", description: "" }));

      expect(failedFields(result)).toEqual(["amount", "description"]);
    });

    it("日付と摘要が不正なとき、2件返す", () => {
      const result = buildCashTransaction(inputOf({ date: "", description: " " }));

      expect(failedFields(result)).toEqual(["date", "description"]);
    });

    it("1項目だけ不正なとき、他項目のエラーは含まれない", () => {
      expect(failedFields(buildCashTransaction(inputOf({ amount: "1.5" })))).toEqual(["amount"]);
    });

    it("同じ項目のエラーが重複して積まれない", () => {
      const fields = failedFields(buildCashTransaction(inputOf({ amount: "-0" })));

      expect(fields).toHaveLength(new Set(fields).size);
    });

    it("失敗したとき ok は false である", () => {
      expect(buildCashTransaction(inputOf({ amount: "abc" })).ok).toBe(false);
    });

    it("失敗したとき transaction を持たない", () => {
      const result = buildCashTransaction(inputOf({ amount: "abc" }));

      expect("transaction" in result).toBe(false);
    });

    it("失敗したとき errors は空配列にならない", () => {
      expect(expectFailure(buildCashTransaction(inputOf({ date: "abc" }))).length).toBeGreaterThan(
        0,
      );
    });

    it("各エラーの message は空でない文字列である（文言そのものは検査しない）", () => {
      const errors = expectFailure(
        buildCashTransaction({ date: "x", amount: "y", description: "" }),
      );

      expect(errors.every((e) => typeof e.message === "string" && e.message.length > 0)).toBe(true);
    });

    it("どんな不正入力でも例外を投げず、結果として返す", () => {
      expect(() =>
        buildCashTransaction({ date: "", amount: "", description: "" }),
      ).not.toThrow();
    });
  });

  describe("入力を書き換えないこと", () => {
    it("成功したとき、渡した input オブジェクトを書き換えない", () => {
      const input = { date: " 2026/8/9 ", amount: " ¥1,200円 ", description: " コンビニ " };
      const snapshot = { ...input };

      buildCashTransaction(input);

      expect(input).toEqual(snapshot);
    });

    it("失敗したとき、渡した input オブジェクトを書き換えない", () => {
      const input = { date: "2026/2/30", amount: "-0", description: "  " };
      const snapshot = { ...input };

      buildCashTransaction(input);

      expect(input).toEqual(snapshot);
    });

    it("同じ入力を2回渡すと同じ結果を返す", () => {
      const input = inputOf({ date: "2026年8月9日", amount: "¥1,200円" });

      expect(buildCashTransaction(input)).toEqual(buildCashTransaction(input));
    });
  });
});
