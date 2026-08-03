import { describe, it, expect } from "vitest";
import { clampNumber } from "./clamp-number.js";

describe("clampNumber", () => {
  describe("範囲内（min <= value <= max）", () => {
    it("value が min と max の間にあるとき、value をそのまま返す", () => {
      expect(clampNumber(5, 0, 10)).toBe(5);
    });

    it("value が min と等しいとき、value（= min）を返す", () => {
      expect(clampNumber(0, 0, 10)).toBe(0);
    });

    it("value が max と等しいとき、value（= max）を返す", () => {
      expect(clampNumber(10, 0, 10)).toBe(10);
    });
  });

  describe("下限を下回る（value < min）", () => {
    it("value が min のすぐ下のとき、min を返す", () => {
      expect(clampNumber(-1, 0, 10)).toBe(0);
    });

    it("value が min より大きく下回るとき、min を返す", () => {
      expect(clampNumber(-100, 0, 10)).toBe(0);
    });
  });

  describe("上限を上回る（value > max）", () => {
    it("value が max のすぐ上のとき、max を返す", () => {
      expect(clampNumber(11, 0, 10)).toBe(10);
    });

    it("value が max より大きく上回るとき、max を返す", () => {
      expect(clampNumber(1000, 0, 10)).toBe(10);
    });
  });

  describe("min === max（範囲が1点）", () => {
    it("value がその1点と一致するとき、その値を返す", () => {
      expect(clampNumber(5, 5, 5)).toBe(5);
    });

    it("value がその1点を下回るとき、その点の値を返す", () => {
      expect(clampNumber(4, 5, 5)).toBe(5);
    });

    it("value がその1点を上回るとき、その点の値を返す", () => {
      expect(clampNumber(6, 5, 5)).toBe(5);
    });
  });

  describe("無効な範囲（min > max）", () => {
    it("min が max よりわずかに大きいとき、RangeError を送出する", () => {
      expect(() => clampNumber(5, 6, 5)).toThrow(RangeError);
    });

    it("min が max より大幅に大きいとき、RangeError を送出する", () => {
      expect(() => clampNumber(5, 100, 0)).toThrow(RangeError);
    });
  });

  describe("NaN の入力", () => {
    it("value が NaN のとき、RangeError を送出する", () => {
      expect(() => clampNumber(NaN, 0, 10)).toThrow(RangeError);
    });

    it("min が NaN のとき、RangeError を送出する", () => {
      expect(() => clampNumber(5, NaN, 10)).toThrow(RangeError);
    });

    it("max が NaN のとき、RangeError を送出する", () => {
      expect(() => clampNumber(5, 0, NaN)).toThrow(RangeError);
    });

    it("value・min・max のすべてが NaN のとき、RangeError を送出する", () => {
      expect(() => clampNumber(NaN, NaN, NaN)).toThrow(RangeError);
    });
  });
});
