import { describe, it, expect } from "vitest";
import { parseBudgetInput, type BudgetInputResult } from "./input.js";

function amountOf(result: BudgetInputResult): number {
  if (!result.ok) {
    throw new Error(`成功を期待したが失敗した: ${result.message}`);
  }
  return result.amountYen;
}

function messageOf(result: BudgetInputResult): string {
  if (result.ok) {
    throw new Error(`失敗を期待したが成功した: ${result.amountYen}`);
  }
  return result.message;
}

describe("parseBudgetInput", () => {
  describe("空欄は 0（予算を外す）", () => {
    it.each(["", "   ", "\t", "　"])("%j は 0 になる", (input) => {
      expect(amountOf(parseBudgetInput(input))).toBe(0);
    });

    it("空欄はエラーにしない", () => {
      expect(parseBudgetInput("").ok).toBe(true);
    });
  });

  describe("数字を読む", () => {
    it("そのままの数字", () => {
      expect(amountOf(parseBudgetInput("50000"))).toBe(50000);
    });

    it("1円（境界）", () => {
      expect(amountOf(parseBudgetInput("1"))).toBe(1);
    });

    it("明示的な 0 は 0（空欄と同じく外す）", () => {
      expect(amountOf(parseBudgetInput("0"))).toBe(0);
    });

    it("前後の空白は無視する", () => {
      expect(amountOf(parseBudgetInput("  50000  "))).toBe(50000);
    });
  });

  // 円の読み方をアプリに2つ持たない（parseAmount を使う）。全角だけは
  // 入口で畳む——人がIMEで打つ欄なので。
  describe("人が打つ書き方を受け付ける", () => {
    it("3桁区切り", () => {
      expect(amountOf(parseBudgetInput("50,000"))).toBe(50000);
    });

    it("全角の数字（IMEで打つとこうなる）", () => {
      expect(amountOf(parseBudgetInput("５００００"))).toBe(50000);
    });

    it("全角の区切りつき", () => {
      expect(amountOf(parseBudgetInput("５０，０００"))).toBe(50000);
    });

    it("円記号つき", () => {
      expect(amountOf(parseBudgetInput("￥50,000"))).toBe(50000);
    });

    it("「円」つき", () => {
      expect(amountOf(parseBudgetInput("50000円"))).toBe(50000);
    });
  });

  describe("弾くもの", () => {
    it.each(["abc", "五万", "1.5.0", "-"])("%j は数字として読めない", (input) => {
      expect(messageOf(parseBudgetInput(input))).toBe("金額は数字で入力してください");
    });

    it("内部の関数名を出さない", () => {
      expect(messageOf(parseBudgetInput("abc"))).not.toContain("parseAmount");
    });

    it("Error の接頭辞を出さない", () => {
      expect(messageOf(parseBudgetInput("abc"))).not.toContain("Error");
    });
  });

  // setBudget は 0 以下を「消す」と解釈する。負をそのまま渡すと打ち間違いで
  // 予算が黙って消える。
  describe("負の数は弾く", () => {
    it.each(["-1", "-50000", "-50,000"])("%j はエラーになる", (input) => {
      expect(messageOf(parseBudgetInput(input))).toBe("予算は0円以上で入力してください");
    });

    it("負の数のエラーは、読めないときのエラーと区別できる", () => {
      expect(messageOf(parseBudgetInput("-1"))).not.toBe(
        messageOf(parseBudgetInput("abc")),
      );
    });

    it("負の数を「外す」と解釈しない", () => {
      expect(parseBudgetInput("-1").ok).toBe(false);
    });
  });

  describe("結果の形", () => {
    it("成功したときは message を持たない", () => {
      expect("message" in parseBudgetInput("100")).toBe(false);
    });

    it("失敗したときは amountYen を持たない", () => {
      expect("amountYen" in parseBudgetInput("abc")).toBe(false);
    });

    it("成功時の額は常に 0 以上", () => {
      for (const input of ["", "0", "1", "50,000", "￥100"]) {
        expect(amountOf(parseBudgetInput(input))).toBeGreaterThanOrEqual(0);
      }
    });

    it("成功時の額は整数", () => {
      expect(Number.isInteger(amountOf(parseBudgetInput("50000")))).toBe(true);
    });
  });
});
