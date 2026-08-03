import { describe, it, expect } from "vitest";
import { parseAmount } from "./parse-amount.js";

describe("parseAmount", () => {
  describe("数字だけの入力", () => {
    it("正の整数のとき、その値を返す", () => {
      expect(parseAmount("1234")).toBe(1234);
    });

    it("0 のとき、0 を返す", () => {
      expect(parseAmount("0")).toBe(0);
    });

    it("1桁のとき、その値を返す", () => {
      expect(parseAmount("7")).toBe(7);
    });

    it("先頭が0で始まる数字を8進数などと解釈せず、10進数として読む", () => {
      expect(parseAmount("0123")).toBe(123);
    });

    it("桁数が多くてもそのまま整数として返す", () => {
      expect(parseAmount("1234567")).toBe(1234567);
    });
  });

  describe("カンマの除去", () => {
    it("3桁区切りのカンマを除去する", () => {
      expect(parseAmount("1,234")).toBe(1234);
    });

    it("カンマが複数あっても除去する", () => {
      expect(parseAmount("1,234,567")).toBe(1234567);
    });

    it("カンマの位置が3桁区切りとして不正でも、単に除去する（位置は検証しない）", () => {
      expect(parseAmount("1,23,4")).toBe(1234);
    });
  });

  describe("通貨記号・単位の除去", () => {
    it("半角風の ¥ を除去する", () => {
      expect(parseAmount("¥1234")).toBe(1234);
    });

    it("全角の ￥ を除去する", () => {
      expect(parseAmount("￥1234")).toBe(1234);
    });

    it("¥ とカンマが同時にあっても両方除去する", () => {
      expect(parseAmount("¥1,234")).toBe(1234);
    });

    it("末尾の 円 を除去する", () => {
      expect(parseAmount("1234円")).toBe(1234);
    });

    it("¥ と末尾の 円 とカンマが同時にあっても、すべて除去する", () => {
      expect(parseAmount("¥1,234円")).toBe(1234);
    });

    it("円 は末尾の単位としてのみ扱い、先頭にあるときは例外を送出する", () => {
      expect(() => parseAmount("円1234")).toThrow();
    });
  });

  describe("安全に扱える整数の範囲", () => {
    it("安全整数の上限そのものは読める", () => {
      expect(parseAmount("9007199254740991")).toBe(9007199254740991);
    });

    it("安全整数の上限を1つ超えるとき、黙って丸めずに例外を送出する", () => {
      expect(() => parseAmount("9007199254740992")).toThrow();
    });

    it("安全整数の下限そのものは読める", () => {
      expect(parseAmount("-9007199254740991")).toBe(-9007199254740991);
    });

    it("安全整数の下限を1つ下回るとき、例外を送出する", () => {
      expect(() => parseAmount("-9007199254740992")).toThrow();
    });

    it("桁数が極端に多いとき、Infinity を返さず例外を送出する", () => {
      expect(() => parseAmount("1".repeat(400))).toThrow();
    });
  });

  describe("負のゼロを作らないこと", () => {
    it('"-0" は -0 ではなく 0 を返す', () => {
      // Intl.NumberFormat は -0 を "-￥0" と表示するため、
      // 表示層に渡る前に 0 へ寄せる。toBe は Object.is 基準なので両者を区別する。
      expect(parseAmount("-0")).toBe(0);
    });

    it('"0" はそのまま 0 を返す', () => {
      expect(parseAmount("0")).toBe(0);
    });
  });

  describe("符号", () => {
    it("先頭が - のとき、負数を返す", () => {
      expect(parseAmount("-1234")).toBe(-1234);
    });

    it("先頭が - でカンマを含むとき、負数を返す", () => {
      expect(parseAmount("-1,234")).toBe(-1234);
    });

    it("先頭が - で末尾に 円 があるとき、負数を返す", () => {
      expect(parseAmount("-1234円")).toBe(-1234);
    });

    it("先頭に - が無いとき、正数を返す（符号ありとの対）", () => {
      expect(parseAmount("1234")).toBe(1234);
    });
  });

  describe("前後の空白", () => {
    it("前後に空白があるとき、除去して読む", () => {
      expect(parseAmount(" 1234 ")).toBe(1234);
    });

    it("前後にタブや改行があるとき、除去して読む", () => {
      expect(parseAmount("\t1234\n")).toBe(1234);
    });

    it("空白と - が同時にあるとき、除去したうえで負数として読む", () => {
      expect(parseAmount("  -1,234  ")).toBe(-1234);
    });

    it("末尾に空白があっても、その手前の円を単位として除去する", () => {
      expect(parseAmount("1234円 ")).toBe(1234);
    });

    it("通貨記号と数字の間に空白があるとき、どちらも除去して読む", () => {
      expect(parseAmount("¥ 1,234")).toBe(1234);
    });
  });

  describe("空の入力（例外）", () => {
    it("空文字列のとき、例外を送出する", () => {
      expect(() => parseAmount("")).toThrow();
    });

    it("半角スペースだけのとき、例外を送出する", () => {
      expect(() => parseAmount("   ")).toThrow();
    });

    it("タブだけのとき、例外を送出する", () => {
      expect(() => parseAmount("\t")).toThrow();
    });
  });

  describe("小数（例外）", () => {
    it("小数部があるとき、例外を送出する", () => {
      expect(() => parseAmount("12.5")).toThrow();
    });

    it("小数部が0で値としては整数でも、小数表記なら例外を送出する", () => {
      expect(() => parseAmount("12.0")).toThrow();
    });

    it("小数点で終わるとき、例外を送出する", () => {
      expect(() => parseAmount("12.")).toThrow();
    });

    it("小数点で始まるとき、例外を送出する", () => {
      expect(() => parseAmount(".5")).toThrow();
    });

    it("カンマと小数点が混ざるとき、例外を送出する", () => {
      expect(() => parseAmount("1,234.5")).toThrow();
    });

    it("負の小数のとき、例外を送出する", () => {
      expect(() => parseAmount("-12.5")).toThrow();
    });

    it("小数点を含まない同じ桁の入力は成功する（小数ケースとの対）", () => {
      expect(parseAmount("125")).toBe(125);
    });
  });

  describe("数字以外を含む（例外）", () => {
    it("英字だけのとき、例外を送出する", () => {
      expect(() => parseAmount("abc")).toThrow();
    });

    it("数字の後ろに英字が続くとき、例外を送出する", () => {
      expect(() => parseAmount("12abc")).toThrow();
    });

    it("数字の前に英字があるとき、例外を送出する", () => {
      expect(() => parseAmount("abc12")).toThrow();
    });

    it("数値の途中に空白があるとき、例外を送出する（除去するのは前後の空白だけ）", () => {
      expect(() => parseAmount("1 234")).toThrow();
    });

    it("指数表記のとき、例外を送出する", () => {
      expect(() => parseAmount("1e3")).toThrow();
    });

    it("+ 符号は認められていないため、例外を送出する", () => {
      expect(() => parseAmount("+1234")).toThrow();
    });

    it("- が2つ続くとき、例外を送出する", () => {
      expect(() => parseAmount("--1234")).toThrow();
    });

    it("- だけのとき、例外を送出する", () => {
      expect(() => parseAmount("-")).toThrow();
    });

    it("通貨記号だけで数字が無いとき、例外を送出する", () => {
      expect(() => parseAmount("¥")).toThrow();
    });

    it("単位だけで数字が無いとき、例外を送出する", () => {
      expect(() => parseAmount("円")).toThrow();
    });

    it("¥ と 円 を除去した結果が空になるとき、例外を送出する", () => {
      expect(() => parseAmount("¥円")).toThrow();
    });

    it("カンマだけのとき、例外を送出する", () => {
      expect(() => parseAmount(",")).toThrow();
    });

    it("NaN という文字列のとき、例外を送出する", () => {
      expect(() => parseAmount("NaN")).toThrow();
    });

    it("Infinity という文字列のとき、例外を送出する", () => {
      expect(() => parseAmount("Infinity")).toThrow();
    });
  });

  describe("戻り値が整数であること", () => {
    it("成功した場合の戻り値は整数である", () => {
      expect(Number.isInteger(parseAmount("¥1,234円"))).toBe(true);
      expect(Number.isInteger(parseAmount("-1,234"))).toBe(true);
    });
  });
});
