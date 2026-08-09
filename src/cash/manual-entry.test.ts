import { describe, it, expect } from "vitest";
import { buildManualTransaction, toManualEntryInput } from "./manual-entry.js";
import type {
  ManualEntryError,
  ManualEntryField,
  ManualEntryInput,
  ManualEntryKind,
  ManualEntryResult,
} from "./manual-entry.js";
import type { Transaction, TransactionSource } from "../domain/transaction.js";
import type { StoredTransaction } from "../storage/schema.js";
import { pressKey } from "./keypad.js";

/** 既定はすべて有効な入力。検査したい項目だけ差し替える */
const inputOf = (overrides: Partial<ManualEntryInput> = {}): ManualEntryInput => ({
  date: "2026-08-09",
  amount: "1200",
  description: "コンビニ",
  kind: "expense",
  source: "cash",
  memo: "",
  ...overrides,
});

function expectSuccess(result: ManualEntryResult): Transaction {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`成功を期待したが失敗した: ${JSON.stringify(result.errors)}`);
  }
  return result.transaction;
}

function expectFailure(result: ManualEntryResult): ManualEntryError[] {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`失敗を期待したが成功した: ${JSON.stringify(result.transaction)}`);
  }
  return result.errors;
}

/** エラーの field を辞書順に並べたもの。message の文言は検査しない */
const failedFields = (result: ManualEntryResult): ManualEntryField[] =>
  expectFailure(result)
    .map((e) => e.field)
    .sort();

describe("buildManualTransaction", () => {
  describe("正常系", () => {
    it("有効な入力から Transaction を組み立てる", () => {
      const result = buildManualTransaction({
        date: "2026/8/9",
        amount: "¥1,200",
        description: " コンビニ ",
        kind: "expense",
        source: "cash",
        memo: "",
      });

      expect(expectSuccess(result)).toEqual({
        date: "2026-08-09",
        amountYen: -1200,
        description: "コンビニ",
        source: "cash",
      });
    });

    it("実データに現れる形（1,200円 と 年月日表記）でも組み立てる", () => {
      const result = buildManualTransaction({
        date: "2026年8月9日",
        amount: "1,200円",
        description: "ランチ",
        kind: "expense",
        source: "cash",
        memo: "",
      });

      expect(expectSuccess(result)).toEqual({
        date: "2026-08-09",
        amountYen: -1200,
        description: "ランチ",
        source: "cash",
      });
    });

    it("成功したとき ok は true である", () => {
      expect(buildManualTransaction(inputOf()).ok).toBe(true);
    });

    it("成功したとき errors を持たない", () => {
      const result = buildManualTransaction(inputOf());

      expect("errors" in result).toBe(false);
    });

    it("Transaction は date / amountYen / description / source の4つだけを持つ", () => {
      const transaction = expectSuccess(buildManualTransaction(inputOf()));

      expect(Object.keys(transaction).sort()).toEqual([
        "amountYen",
        "date",
        "description",
        "source",
      ]);
    });
  });

  describe("source（支払い方法）", () => {
    const sources: readonly TransactionSource[] = ["cash", "card", "bank"];

    it.each(sources)("入力の source=%s をそのまま Transaction に載せる", (source) => {
      expect(expectSuccess(buildManualTransaction(inputOf({ source }))).source).toBe(source);
    });

    it("source を変えると Transaction の source だけが変わる", () => {
      const cash = expectSuccess(buildManualTransaction(inputOf({ source: "cash" })));
      const card = expectSuccess(buildManualTransaction(inputOf({ source: "card" })));

      expect(card).toEqual({ ...cash, source: "card" });
    });

    it("source は cash に固定されていない（card がそのまま通る）", () => {
      const result = buildManualTransaction({
        date: "2026年1月1日",
        amount: "¥9,999円",
        description: "初詣",
        kind: "expense",
        source: "card",
        memo: "",
      });

      expect(expectSuccess(result).source).toBe("card");
    });

    it.each(sources)("収入でも source=%s をそのまま載せる", (source) => {
      const result = buildManualTransaction(inputOf({ kind: "income", source }));

      expect(expectSuccess(result).source).toBe(source);
    });

    it("source は日付や金額の解釈に影響しない", () => {
      const cash = expectSuccess(buildManualTransaction(inputOf({ source: "cash" })));
      const bank = expectSuccess(buildManualTransaction(inputOf({ source: "bank" })));

      expect([bank.date, bank.amountYen]).toEqual([cash.date, cash.amountYen]);
    });
  });

  describe("memo", () => {
    function memoOf(result: ManualEntryResult): string {
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`成功を期待したが失敗した: ${JSON.stringify(result.errors)}`);
      }
      return result.memo;
    }

    it("入力のメモをそのまま返す", () => {
      expect(memoOf(buildManualTransaction(inputOf({ memo: "会社の飲み会" })))).toBe("会社の飲み会");
    });

    it("空のメモは空文字列で返る（undefined にならない）", () => {
      const memo = memoOf(buildManualTransaction(inputOf({ memo: "" })));

      expect(memo).toBe("");
      expect(typeof memo).toBe("string");
    });

    it("メモが空でも成功する（必須ではない）", () => {
      expect(buildManualTransaction(inputOf({ memo: "" })).ok).toBe(true);
    });

    it("前後の空白を落とす", () => {
      expect(memoOf(buildManualTransaction(inputOf({ memo: "  昼食  " })))).toBe("昼食");
    });

    it("空白だけのメモは空文字列になる（空に見えて空でないメモを作らない）", () => {
      expect(memoOf(buildManualTransaction(inputOf({ memo: "   " })))).toBe("");
    });

    it.each(["\t", "\n", "\u3000"])("空白文字 %j だけのメモも空文字列になる", (blank) => {
      expect(memoOf(buildManualTransaction(inputOf({ memo: blank })))).toBe("");
    });

    it("中の空白は残す", () => {
      expect(memoOf(buildManualTransaction(inputOf({ memo: "会社 の 飲み会" })))).toBe(
        "会社 の 飲み会",
      );
    });

    it("メモは Transaction に混ざらない（別に返る）", () => {
      const result = buildManualTransaction(inputOf({ memo: "昼食" }));

      expect(Object.keys(expectSuccess(result))).not.toContain("memo");
    });

    it("メモは摘要に影響しない", () => {
      const withMemo = expectSuccess(buildManualTransaction(inputOf({ memo: "昼食" })));
      const withoutMemo = expectSuccess(buildManualTransaction(inputOf({ memo: "" })));

      expect(withMemo).toEqual(withoutMemo);
    });

    it("メモが長くても弾かれない", () => {
      const long = "あ".repeat(500);

      expect(memoOf(buildManualTransaction(inputOf({ memo: long })))).toBe(long);
    });

    it("失敗したときは memo を返さない", () => {
      const result = buildManualTransaction(inputOf({ amount: "0", memo: "昼食" }));

      expect("memo" in result).toBe(false);
    });
  });

  describe("日付の受け付けと正規化", () => {
    it("YYYY/M/D を YYYY-MM-DD に正規化する", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026/8/9" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("YYYY-M-D を YYYY-MM-DD に正規化する", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026-8-9" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("YYYY年M月D日 を YYYY-MM-DD に正規化する", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026年8月9日" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("スラッシュ区切りで既に2桁ゼロ埋めされていても読める", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026/08/09" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("ハイフン区切りで既に YYYY-MM-DD の形なら、そのままの値になる", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026-12-31" }))).date).toBe(
        "2026-12-31",
      );
    });

    it("年月日表記で2桁ゼロ埋めされていても読める", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026年08月09日" }))).date).toBe(
        "2026-08-09",
      );
    });

    it("3つの表記は同じ日付として同じ結果になる", () => {
      const slash = expectSuccess(buildManualTransaction(inputOf({ date: "2026/8/9" })));
      const hyphen = expectSuccess(buildManualTransaction(inputOf({ date: "2026-8-9" })));
      const kanji = expectSuccess(buildManualTransaction(inputOf({ date: "2026年8月9日" })));

      expect(hyphen).toEqual(slash);
      expect(kanji).toEqual(slash);
    });

    it("前後に空白があっても読める", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "  2026/8/9  " }))).date).toBe(
        "2026-08-09",
      );
    });

    it("前後にタブや改行があっても読める", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "\t2026年8月9日\n" }))).date).toBe(
        "2026-08-09",
      );
    });
  });

  describe("日付の境界（月末日と翌日）", () => {
    it("4月30日は有効である", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026/4/30" }))).date).toBe(
        "2026-04-30",
      );
    });

    it("4月31日は実在しないのでエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/4/31" })))).toEqual(["date"]);
    });

    it("1月31日は有効である", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026/1/31" }))).date).toBe(
        "2026-01-31",
      );
    });

    it("1月32日はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/1/32" })))).toEqual(["date"]);
    });

    it("12月31日（年内最終日）は有効である", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026/12/31" }))).date).toBe(
        "2026-12-31",
      );
    });

    it("1月1日（年内最初の日）は有効である", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026/1/1" }))).date).toBe(
        "2026-01-01",
      );
    });

    it("13月はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/13/1" })))).toEqual(["date"]);
    });

    it("0月はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/0/9" })))).toEqual(["date"]);
    });

    it("0日はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/8/0" })))).toEqual(["date"]);
    });

    it("2月30日はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026年2月30日" })))).toEqual([
        "date",
      ]);
    });
  });

  describe("日付の境界（うるう年）", () => {
    it("4で割り切れる年の2月29日は有効である", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2024/2/29" }))).date).toBe(
        "2024-02-29",
      );
    });

    it("うるう年でない年の2月29日はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/2/29" })))).toEqual(["date"]);
    });

    it("うるう年でない年でも2月28日は有効である（29日との対）", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2026/2/28" }))).date).toBe(
        "2026-02-28",
      );
    });

    it("400で割り切れる年（2000年）の2月29日は有効である", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2000/2/29" }))).date).toBe(
        "2000-02-29",
      );
    });

    it("100で割り切れるが400で割り切れない年（1900年）の2月29日はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "1900/2/29" })))).toEqual(["date"]);
    });

    it("うるう年の2月29日は年月日表記でも有効である", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ date: "2024年2月29日" }))).date).toBe(
        "2024-02-29",
      );
    });
  });

  describe("解釈できない日付", () => {
    it("空文字列はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "" })))).toEqual(["date"]);
    });

    it("空白だけのときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "   " })))).toEqual(["date"]);
    });

    it("日付ではない文字列はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "きのう" })))).toEqual(["date"]);
    });

    it("日が欠けているとエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/8" })))).toEqual(["date"]);
    });

    it("年が欠けているとエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "8/9" })))).toEqual(["date"]);
    });

    it("区切り文字が無い8桁の数字はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "20260809" })))).toEqual(["date"]);
    });

    it("区切り文字が混ざっているとエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026-8/9" })))).toEqual(["date"]);
    });

    it("時刻が付いているとエラーになる（日付だけを持つため）", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026/8/9 12:00" })))).toEqual([
        "date",
      ]);
    });

    it("日付の途中に空白があるとエラーになる（除去するのは前後の空白だけ）", () => {
      expect(failedFields(buildManualTransaction(inputOf({ date: "2026 / 8 / 9" })))).toEqual([
        "date",
      ]);
    });
  });

  describe("金額の受け付けと符号反転", () => {
    it("正の整数を負の amountYen にする", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "1200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("カンマ区切りを読む", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "1,200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("カンマが複数あっても読む", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "1,234,567" }))).amountYen).toBe(
        -1234567,
      );
    });

    it("半角風の ¥ を許容する", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "¥1,200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("全角の ￥ を許容する", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "￥1,200" }))).amountYen).toBe(
        -1200,
      );
    });

    it("末尾の 円 を許容する", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "1,200円" }))).amountYen).toBe(
        -1200,
      );
    });

    it("通貨記号と単位が同時にあっても読む", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "¥1,200円" }))).amountYen).toBe(
        -1200,
      );
    });

    it("前後の空白を無視する", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "  ¥1,200  " }))).amountYen).toBe(
        -1200,
      );
    });

    it("amountYen は整数である", () => {
      const transaction = expectSuccess(buildManualTransaction(inputOf({ amount: "¥1,200円" })));

      expect(Number.isInteger(transaction.amountYen)).toBe(true);
    });

    it("amountYen は必ず負である（支出を負で表す元帳の慣習）", () => {
      const transaction = expectSuccess(buildManualTransaction(inputOf({ amount: "1" })));

      expect(transaction.amountYen).toBeLessThan(0);
    });
  });

  describe("金額の境界", () => {
    it("最小の有効値 1 を受け付け、-1 にする", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "1" }))).amountYen).toBe(-1);
    });

    it("0 はエラーになる（反転で -0 を作らないため）", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "0" })))).toEqual(["amount"]);
    });

    it("通貨記号付きの 0 もエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "¥0円" })))).toEqual(["amount"]);
    });

    it("安全整数の上限そのものは受け付ける", () => {
      const transaction = expectSuccess(
        buildManualTransaction(inputOf({ amount: "9007199254740991" })),
      );

      expect(transaction.amountYen).toBe(-9007199254740991);
    });

    it("安全整数の上限を1つ超えるとき、黙って丸めずエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "9007199254740992" })))).toEqual([
        "amount",
      ]);
    });

    it("桁数が極端に多いとき、Infinity にせずエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "9".repeat(400) })))).toEqual([
        "amount",
      ]);
    });
  });

  describe("金額が -0 にならないこと", () => {
    it("成功した Transaction の amountYen が -0 になることはない", () => {
      // -0 は `-0 < 0` が偽になり範囲チェックを素通りし、Intl.NumberFormat が
      // "-￥0" と表示する。toBe は Object.is 基準なので -0 と 0 を区別する。
      const transaction = expectSuccess(buildManualTransaction(inputOf({ amount: "1" })));

      expect(Object.is(transaction.amountYen, -0)).toBe(false);
    });

    it('"0" を成功させないことで -0 の発生源を断つ', () => {
      const result = buildManualTransaction(inputOf({ amount: "0" }));

      expect(result.ok).toBe(false);
    });

    it('"-0" はエラーになる', () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "-0" })))).toEqual(["amount"]);
    });
  });

  describe("金額に符号を付けられないこと", () => {
    it("負の数はエラーになる（符号を付けるのはこの関数の役割）", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "-500" })))).toEqual(["amount"]);
    });

    it("カンマ付きの負の数もエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "-1,200" })))).toEqual(["amount"]);
    });

    it("通貨記号付きの負の数もエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "¥-1,200" })))).toEqual([
        "amount",
      ]);
    });

    it("符号を外した同じ値は成功する（負数ケースとの対）", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ amount: "500" }))).amountYen).toBe(-500);
    });
  });

  describe("金額の未入力", () => {
    function amountMessage(input: Partial<ManualEntryInput>): string {
      const errors = expectFailure(buildManualTransaction(inputOf(input)));
      const found = errors.find((e) => e.field === "amount");
      if (found === undefined) {
        throw new Error(`amount のエラーが無い: ${JSON.stringify(errors)}`);
      }
      return found.message;
    }

    // テンキーでは「まだ何も押していない」が開始状態なので、ここは正常な
    // 経路として通る。内部の関数名を出さない。
    it.each(["", "   ", "\t", "\u3000"])("%j は未入力として案内する", (amount) => {
      expect(amountMessage({ amount })).toBe("金額を入力してください");
    });

    it("未入力の案内に内部の関数名が混ざらない", () => {
      expect(amountMessage({ amount: "" })).not.toContain("parseAmount");
    });

    it("未入力の案内に Error の接頭辞が付かない", () => {
      expect(amountMessage({ amount: "" })).not.toContain("Error");
    });

    it("解釈できない入力のときは、未入力とは別の案内になる", () => {
      expect(amountMessage({ amount: "abc" })).not.toBe("金額を入力してください");
    });

    it("0 のときは、未入力とは別の案内になる", () => {
      expect(amountMessage({ amount: "0" })).toBe("金額は1円以上の正の数で入力してください");
    });

    it("未入力でも他の項目の検証は止まらない", () => {
      expect(
        failedFields(buildManualTransaction(inputOf({ amount: "", description: "" }))),
      ).toEqual(["amount", "description"]);
    });
  });

  describe("金額として解釈できない入力", () => {
    it("空文字列はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "" })))).toEqual(["amount"]);
    });

    it("空白だけのときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "   " })))).toEqual(["amount"]);
    });

    it("通貨記号だけで数字が無いときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "¥" })))).toEqual(["amount"]);
    });

    it("単位だけで数字が無いときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "円" })))).toEqual(["amount"]);
    });

    it("小数はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "1.5" })))).toEqual(["amount"]);
    });

    it("小数部が0でも、小数表記ならエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "1200.0" })))).toEqual(["amount"]);
    });

    it("英字だけのときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "abc" })))).toEqual(["amount"]);
    });

    it("数字の後ろに英字が続くときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "1200yen" })))).toEqual([
        "amount",
      ]);
    });

    it("数値の途中に空白があるときエラーになる（除去するのは前後の空白だけ）", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "1 200" })))).toEqual(["amount"]);
    });

    it("Infinity という文字列はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "Infinity" })))).toEqual([
        "amount",
      ]);
    });

    it("NaN という文字列はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "NaN" })))).toEqual(["amount"]);
    });
  });

  describe("摘要", () => {
    it("前後の空白を落として格納する", () => {
      expect(
        expectSuccess(buildManualTransaction(inputOf({ description: "  コンビニ  " }))).description,
      ).toBe("コンビニ");
    });

    it("タブや改行も落とす", () => {
      expect(
        expectSuccess(buildManualTransaction(inputOf({ description: "\tコンビニ\n" }))).description,
      ).toBe("コンビニ");
    });

    it("途中の空白は残す（落とすのは前後だけ）", () => {
      expect(
        expectSuccess(buildManualTransaction(inputOf({ description: " スーパー 食料品 " })))
          .description,
      ).toBe("スーパー 食料品");
    });

    it("カンマを含む摘要もそのまま格納する", () => {
      expect(
        expectSuccess(buildManualTransaction(inputOf({ description: "スーパー, 食料品" })))
          .description,
      ).toBe("スーパー, 食料品");
    });

    it("1文字の摘要も有効である（空との境界）", () => {
      expect(expectSuccess(buildManualTransaction(inputOf({ description: "茶" }))).description).toBe(
        "茶",
      );
    });

    it("空文字列はエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ description: "" })))).toEqual([
        "description",
      ]);
    });

    it("半角スペースだけのときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ description: "   " })))).toEqual([
        "description",
      ]);
    });

    it("全角スペースだけのときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ description: "　" })))).toEqual([
        "description",
      ]);
    });

    it("タブだけのときエラーになる", () => {
      expect(failedFields(buildManualTransaction(inputOf({ description: "\t" })))).toEqual([
        "description",
      ]);
    });
  });

  describe("エラーの集約", () => {
    it("3項目とも不正なとき、エラーは3件で field は1つずつである", () => {
      const result = buildManualTransaction({
        date: "2026/2/30",
        amount: "-0",
        description: "   ",
        kind: "expense",
        source: "cash",
        memo: "",
      });

      expect(failedFields(result)).toEqual(["amount", "date", "description"]);
    });

    it("日付と金額が不正なとき、最初の失敗で打ち切らず2件返す", () => {
      const result = buildManualTransaction(inputOf({ date: "2026/13/1", amount: "abc" }));

      expect(failedFields(result)).toEqual(["amount", "date"]);
    });

    it("金額と摘要が不正なとき、2件返す", () => {
      const result = buildManualTransaction(inputOf({ amount: "0", description: "" }));

      expect(failedFields(result)).toEqual(["amount", "description"]);
    });

    it("日付と摘要が不正なとき、2件返す", () => {
      const result = buildManualTransaction(inputOf({ date: "", description: " " }));

      expect(failedFields(result)).toEqual(["date", "description"]);
    });

    it("1項目だけ不正なとき、他項目のエラーは含まれない", () => {
      expect(failedFields(buildManualTransaction(inputOf({ amount: "1.5" })))).toEqual(["amount"]);
    });

    it("同じ項目のエラーが重複して積まれない", () => {
      const fields = failedFields(buildManualTransaction(inputOf({ amount: "-0" })));

      expect(fields).toHaveLength(new Set(fields).size);
    });

    it("失敗したとき ok は false である", () => {
      expect(buildManualTransaction(inputOf({ amount: "abc" })).ok).toBe(false);
    });

    it("失敗したとき transaction を持たない", () => {
      const result = buildManualTransaction(inputOf({ amount: "abc" }));

      expect("transaction" in result).toBe(false);
    });

    it("失敗したとき errors は空配列にならない", () => {
      expect(expectFailure(buildManualTransaction(inputOf({ date: "abc" }))).length).toBeGreaterThan(
        0,
      );
    });

    it("各エラーの message は空でない文字列である（文言そのものは検査しない）", () => {
      const errors = expectFailure(
        buildManualTransaction({
          date: "x",
          amount: "y",
          description: "",
          kind: "expense",
          source: "cash",
          memo: "",
        }),
      );

      expect(errors.every((e) => typeof e.message === "string" && e.message.length > 0)).toBe(true);
    });

    it("どんな不正入力でも例外を投げず、結果として返す", () => {
      expect(() =>
        buildManualTransaction({
          date: "",
          amount: "",
          description: "",
          kind: "expense",
          source: "cash",
          memo: "",
        }),
      ).not.toThrow();
    });
  });

  describe("入力を書き換えないこと", () => {
    it("成功したとき、渡した input オブジェクトを書き換えない", () => {
      const input = {
        date: " 2026/8/9 ",
        amount: " ¥1,200円 ",
        description: " コンビニ ",
        kind: "expense" as const,
        source: "cash" as const,
        memo: " 昼 ",
      };
      const snapshot = { ...input };

      buildManualTransaction(input);

      expect(input).toEqual(snapshot);
    });

    it("失敗したとき、渡した input オブジェクトを書き換えない", () => {
      const input = {
        date: "2026/2/30",
        amount: "-0",
        description: "  ",
        kind: "expense" as const,
        source: "cash" as const,
        memo: " 昼 ",
      };
      const snapshot = { ...input };

      buildManualTransaction(input);

      expect(input).toEqual(snapshot);
    });

    it("同じ入力を2回渡すと同じ結果を返す", () => {
      const input = inputOf({ date: "2026年8月9日", amount: "¥1,200円" });

      expect(buildManualTransaction(input)).toEqual(buildManualTransaction(input));
    });
  });

  describe('収入（kind: "income"）', () => {
    /** 既定の有効な入力を収入にしたもの。検査したい項目だけ差し替える */
    const incomeInputOf = (overrides: Partial<ManualEntryInput> = {}): ManualEntryInput =>
      inputOf({ kind: "income", ...overrides });

    describe("符号", () => {
      it("正の整数を正の amountYen にする", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ amount: "1200" }))).amountYen,
        ).toBe(1200);
      });

      it("有効な入力から Transaction を組み立てる", () => {
        const result = buildManualTransaction({
          date: "2026/8/9",
          amount: "¥1,200",
          description: " 給与 ",
          kind: "income",
          source: "cash",
          memo: "",
        });

        expect(expectSuccess(result)).toEqual({
          date: "2026-08-09",
          amountYen: 1200,
          description: "給与",
          source: "cash",
        });
      });

      it("amountYen は必ず正である（収入を正で表す元帳の慣習）", () => {
        const transaction = expectSuccess(buildManualTransaction(incomeInputOf({ amount: "1" })));

        expect(transaction.amountYen).toBeGreaterThan(0);
      });

      it("最小の有効値 1 を受け付け、1 にする", () => {
        expect(expectSuccess(buildManualTransaction(incomeInputOf({ amount: "1" }))).amountYen).toBe(
          1,
        );
      });

      it("amountYen は整数である", () => {
        const transaction = expectSuccess(
          buildManualTransaction(incomeInputOf({ amount: "¥1,200円" })),
        );

        expect(Number.isInteger(transaction.amountYen)).toBe(true);
      });
    });

    describe("kind による差", () => {
      const base = {
        date: "2026/8/9",
        amount: "¥1,200円",
        description: " コンビニ ",
        source: "cash" as const,
        memo: "",
      };

      it("kind を変えると amountYen の符号だけが反転する", () => {
        const expense = expectSuccess(buildManualTransaction({ ...base, kind: "expense" }));
        const income = expectSuccess(buildManualTransaction({ ...base, kind: "income" }));

        expect(expense.amountYen).toBe(-1200);
        expect(income.amountYen).toBe(1200);
      });

      it("kind を変えても date / description / source は同一である", () => {
        const expense = expectSuccess(buildManualTransaction({ ...base, kind: "expense" }));
        const income = expectSuccess(buildManualTransaction({ ...base, kind: "income" }));

        expect(income.date).toBe(expense.date);
        expect(income.description).toBe(expense.description);
        expect(income.source).toBe(expense.source);
      });

      it("kind で変わるのは amountYen だけで、キーの構成は変わらない", () => {
        const expense = expectSuccess(buildManualTransaction({ ...base, kind: "expense" }));
        const income = expectSuccess(buildManualTransaction({ ...base, kind: "income" }));

        expect({ ...income, amountYen: 0 }).toEqual({ ...expense, amountYen: 0 });
      });
    });

    describe("source", () => {
      it("収入の source も入力から決まる（銀行振込の収入）", () => {
        const result = buildManualTransaction({
          date: "2026年1月1日",
          amount: "¥9,999円",
          description: "お年玉",
          kind: "income",
          source: "bank",
          memo: "",
        });

        expect(expectSuccess(result).source).toBe("bank");
      });

      it("既定の入力（現金収入）では cash のまま", () => {
        expect(expectSuccess(buildManualTransaction(incomeInputOf())).source).toBe("cash");
      });
    });

    describe("収入でも受け付ける表記", () => {
      it("カンマ区切りを読む", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ amount: "1,200" }))).amountYen,
        ).toBe(1200);
      });

      it("半角風の ¥ を許容する", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ amount: "¥1,200" }))).amountYen,
        ).toBe(1200);
      });

      it("全角の ￥ を許容する", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ amount: "￥1,200" }))).amountYen,
        ).toBe(1200);
      });

      it("末尾の 円 を許容する", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ amount: "1,200円" }))).amountYen,
        ).toBe(1200);
      });

      it("前後の空白を無視する", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ amount: "  ¥1,200円  " }))).amountYen,
        ).toBe(1200);
      });

      it("日付を YYYY-MM-DD に正規化する", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ date: "2026年8月9日" }))).date,
        ).toBe("2026-08-09");
      });

      it("摘要の前後の空白を落とす", () => {
        expect(
          expectSuccess(buildManualTransaction(incomeInputOf({ description: "  給与  " })))
            .description,
        ).toBe("給与");
      });
    });

    describe("収入でも変わらない拒否", () => {
      it('"0" はエラーになる（受理域を向きによって変えないため）', () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ amount: "0" })))).toEqual([
          "amount",
        ]);
      });

      it('"-0" はエラーになる', () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ amount: "-0" })))).toEqual([
          "amount",
        ]);
      });

      it("通貨記号付きの 0 もエラーになる", () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ amount: "¥0円" })))).toEqual([
          "amount",
        ]);
      });

      it('"-500" はエラーになる（符号を決めるのは kind であり入力側ではない）', () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ amount: "-500" })))).toEqual([
          "amount",
        ]);
      });

      it("通貨記号付きの負の数もエラーになる", () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ amount: "¥-1,200" })))).toEqual([
          "amount",
        ]);
      });

      it("符号を外した同じ値は成功する（負数ケースとの対）", () => {
        expect(expectSuccess(buildManualTransaction(incomeInputOf({ amount: "500" }))).amountYen).toBe(
          500,
        );
      });

      it("小数はエラーになる", () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ amount: "1.5" })))).toEqual([
          "amount",
        ]);
      });

      it("金額が空文字列のときエラーになる", () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ amount: "" })))).toEqual([
          "amount",
        ]);
      });

      it("実在しない日付はエラーになる", () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ date: "2026/2/30" })))).toEqual([
          "date",
        ]);
      });

      it("摘要が半角スペースだけのときエラーになる", () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ description: "   " })))).toEqual([
          "description",
        ]);
      });

      it("摘要が全角スペースだけのときエラーになる", () => {
        expect(failedFields(buildManualTransaction(incomeInputOf({ description: "　" })))).toEqual([
          "description",
        ]);
      });

      it("3項目とも不正なとき、収入でもエラーをまとめて返す", () => {
        const result = buildManualTransaction({
          date: "2026/2/30",
          amount: "-0",
          description: "   ",
          kind: "income",
          source: "cash",
          memo: "",
        });

        expect(failedFields(result)).toEqual(["amount", "date", "description"]);
      });
    });

    describe("収入の金額が -0 にならないこと", () => {
      it("成功した Transaction の amountYen が -0 になることはない", () => {
        // 収入は「反転しない」向きだが、反転処理を共通化すると二重反転で -0 が戻る。
        // toBe は Object.is 基準なので -0 と 0 を区別する。
        const transaction = expectSuccess(buildManualTransaction(incomeInputOf({ amount: "1" })));

        expect(Object.is(transaction.amountYen, -0)).toBe(false);
      });
    });

    describe("収入の金額の境界", () => {
      it("安全整数の上限そのものを、正のまま受け付ける", () => {
        const transaction = expectSuccess(
          buildManualTransaction(incomeInputOf({ amount: "9007199254740991" })),
        );

        expect(transaction.amountYen).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("安全整数の上限を1つ超えるとき、黙って丸めずエラーになる", () => {
        expect(
          failedFields(buildManualTransaction(incomeInputOf({ amount: "9007199254740992" }))),
        ).toEqual(["amount"]);
      });
    });

    describe("kind によらず同じであること", () => {
      const bothKinds: readonly ManualEntryKind[] = ["expense", "income"];

      it.each(bothKinds)("kind=%s のとき source は入力のものが載る", (kind) => {
        expect(expectSuccess(buildManualTransaction(inputOf({ kind, source: "card" }))).source).toBe(
          "card",
        );
      });

      it.each(bothKinds)("kind=%s のとき 0 は amount のエラーになる", (kind) => {
        expect(failedFields(buildManualTransaction(inputOf({ amount: "0", kind })))).toEqual([
          "amount",
        ]);
      });

      it.each(bothKinds)("kind=%s のとき負の入力は amount のエラーになる", (kind) => {
        expect(failedFields(buildManualTransaction(inputOf({ amount: "-500", kind })))).toEqual([
          "amount",
        ]);
      });

      it.each(bothKinds)("kind=%s のとき kind 自体のエラーは返らない", (kind) => {
        const result = buildManualTransaction(inputOf({ date: "きのう", amount: "abc", kind }));

        expect(failedFields(result)).toEqual(["amount", "date"]);
      });

      it.each(bothKinds)("kind=%s のとき amountYen の絶対値は入力の大きさに等しい", (kind) => {
        const transaction = expectSuccess(
          buildManualTransaction(inputOf({ amount: "1,234,567", kind })),
        );

        expect(Math.abs(transaction.amountYen)).toBe(1234567);
      });
    });
  });
});

describe("toManualEntryInput", () => {
  const stored = (overrides: Partial<StoredTransaction> = {}): StoredTransaction => ({
    id: "t-1",
    date: "2026-08-09",
    amountYen: -1200,
    description: "コンビニ",
    source: "cash",
    category: "食費",
    memo: "",
    ...overrides,
  });

  describe("符号を種別と大きさに分解する", () => {
    it("支出（負）は kind=expense と正の金額になる", () => {
      const input = toManualEntryInput(stored({ amountYen: -1200 }));

      expect([input.kind, input.amount]).toEqual(["expense", "1200"]);
    });

    it("収入（正）は kind=income と正の金額になる", () => {
      const input = toManualEntryInput(stored({ amountYen: 250000 }));

      expect([input.kind, input.amount]).toEqual(["income", "250000"]);
    });

    it("金額に符号が残らない", () => {
      expect(toManualEntryInput(stored({ amountYen: -1200 })).amount).not.toContain("-");
    });

    it("1円の支出も 1 になる（境界）", () => {
      expect(toManualEntryInput(stored({ amountYen: -1 })).amount).toBe("1");
    });

    it("1円の収入も 1 になる（境界）", () => {
      const input = toManualEntryInput(stored({ amountYen: 1 }));

      expect([input.kind, input.amount]).toEqual(["income", "1"]);
    });

    it("大きな額でも指数表記にならない", () => {
      expect(toManualEntryInput(stored({ amountYen: -123456789 })).amount).toBe("123456789");
    });
  });

  describe("0 円", () => {
    it("kind は expense になる", () => {
      expect(toManualEntryInput(stored({ amountYen: 0 })).kind).toBe("expense");
    });

    it("金額は 0 になる", () => {
      expect(toManualEntryInput(stored({ amountYen: 0 })).amount).toBe("0");
    });

    it("-0 でも +0 と同じ結果になる（入力欄に -0 が出ない）", () => {
      expect(toManualEntryInput(stored({ amountYen: -0 }))).toEqual(
        toManualEntryInput(stored({ amountYen: 0 })),
      );
    });

    it("-0 の金額は \"0\" で、\"-0\" にならない", () => {
      expect(toManualEntryInput(stored({ amountYen: -0 })).amount).toBe("0");
    });

    it("0 円のまま保存しようとすると金額のエラーになる（直す機会になる）", () => {
      const input = toManualEntryInput(stored({ amountYen: 0 }));

      expect(failedFields(buildManualTransaction(input))).toEqual(["amount"]);
    });
  });

  describe("そのまま移す項目", () => {
    it("日付をそのまま渡す", () => {
      expect(toManualEntryInput(stored({ date: "2024-02-29" })).date).toBe("2024-02-29");
    });

    it("摘要をそのまま渡す（trim しない。編集で消せる）", () => {
      expect(toManualEntryInput(stored({ description: " コンビニ " })).description).toBe(
        " コンビニ ",
      );
    });

    it.each(["cash", "card", "bank"] as const)("支払い方法 %s をそのまま渡す", (source) => {
      expect(toManualEntryInput(stored({ source })).source).toBe(source);
    });

    it("メモをそのまま渡す", () => {
      expect(toManualEntryInput(stored({ memo: "会社の飲み会" })).memo).toBe("会社の飲み会");
    });

    it("空のメモは空文字列のまま", () => {
      expect(toManualEntryInput(stored({ memo: "" })).memo).toBe("");
    });

    it("id と category は入力に含まれない（編集で失われる値ではない）", () => {
      const input = toManualEntryInput(stored());

      expect(Object.keys(input).sort()).toEqual([
        "amount",
        "date",
        "description",
        "kind",
        "memo",
        "source",
      ]);
    });
  });

  describe("buildManualTransaction と往復する", () => {
    it.each([
      ["支出", -1200],
      ["収入", 250000],
      ["1円の支出", -1],
    ])("%s は、ほどいて組み立て直すと元の取引に戻る", (_label, amountYen) => {
      const original = stored({ amountYen });
      const result = buildManualTransaction(toManualEntryInput(original));

      expect(expectSuccess(result)).toEqual({
        date: original.date,
        amountYen,
        description: original.description,
        source: original.source,
      });
    });

    it("往復してもメモが保たれる", () => {
      const original = stored({ memo: "会社の飲み会" });
      const result = buildManualTransaction(toManualEntryInput(original));

      expect(result.ok && result.memo).toBe("会社の飲み会");
    });

    it("往復で符号が反転しない（支出が収入にならない）", () => {
      const original = stored({ amountYen: -1200 });
      const once = expectSuccess(buildManualTransaction(toManualEntryInput(original)));
      const twice = expectSuccess(
        buildManualTransaction(toManualEntryInput({ ...original, ...once })),
      );

      expect(twice.amountYen).toBe(-1200);
    });

    it("何度往復しても金額が変わらない", () => {
      let current: StoredTransaction = stored({ amountYen: 250000 });
      for (let i = 0; i < 3; i += 1) {
        const built = expectSuccess(buildManualTransaction(toManualEntryInput(current)));
        current = { ...current, ...built };
      }

      expect(current.amountYen).toBe(250000);
    });

    it("金額の区切り記号を入れない（テンキーの続きが打てる形）", () => {
      const amount = toManualEntryInput(stored({ amountYen: -1234567 })).amount;

      expect(amount).toBe("1234567");
      expect(pressKey(amount, "8")).toBe("12345678");
    });
  });

  it("渡した取引を書き換えない", () => {
    const original = stored({ amountYen: -1200, memo: " 昼 " });
    const snapshot = structuredClone(original);

    toManualEntryInput(original);

    expect(original).toEqual(snapshot);
  });
});
