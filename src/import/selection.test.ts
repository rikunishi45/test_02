import { describe, it, expect } from "vitest";
import type { ImportRowStatus } from "./classify-duplicates.js";
import { isSelectedForImport } from "./selection.js";

/**
 * 仕様は2つだけ：
 *   - 既定は status で決まる（new は取り込む、duplicate-candidate は取り込まない）
 *   - toggled が true なら、その既定を反転する
 * 4通り（status 2種 × toggled 2種）をすべて検査したうえで、
 * 「片方の引数だけを変えると結果が変わる」ことを引数ごとに検査する。
 */
const NEW: ImportRowStatus = "new";
const DUPLICATE: ImportRowStatus = "duplicate-candidate";

describe("isSelectedForImport", () => {
  describe("4通りすべて", () => {
    it("new かつ toggled false のとき、取り込む（既定）", () => {
      expect(isSelectedForImport(NEW, false)).toBe(true);
    });

    it("new かつ toggled true のとき、取り込まない（既定の反転）", () => {
      expect(isSelectedForImport(NEW, true)).toBe(false);
    });

    it("duplicate-candidate かつ toggled false のとき、取り込まない（既定）", () => {
      expect(isSelectedForImport(DUPLICATE, false)).toBe(false);
    });

    it("duplicate-candidate かつ toggled true のとき、取り込む（既定の反転）", () => {
      expect(isSelectedForImport(DUPLICATE, true)).toBe(true);
    });
  });

  describe("toggled だけを変えると、結果が反転する", () => {
    it("status が new のとき、true と false で結果が異なる", () => {
      expect(isSelectedForImport(NEW, true)).not.toBe(isSelectedForImport(NEW, false));
    });

    it("status が duplicate-candidate のとき、true と false で結果が異なる", () => {
      expect(isSelectedForImport(DUPLICATE, true)).not.toBe(
        isSelectedForImport(DUPLICATE, false),
      );
    });
  });

  describe("status だけを変えると、結果が反転する", () => {
    it("toggled が false のとき、new と duplicate-candidate で結果が異なる", () => {
      expect(isSelectedForImport(NEW, false)).not.toBe(
        isSelectedForImport(DUPLICATE, false),
      );
    });

    it("toggled が true のとき、new と duplicate-candidate で結果が異なる", () => {
      expect(isSelectedForImport(NEW, true)).not.toBe(
        isSelectedForImport(DUPLICATE, true),
      );
    });
  });

  describe("戻り値の性質", () => {
    it("4通りとも真偽値を返す（真値・偽値ではなく true / false そのもの）", () => {
      for (const status of [NEW, DUPLICATE]) {
        for (const toggled of [true, false]) {
          expect(typeof isSelectedForImport(status, toggled)).toBe("boolean");
        }
      }
    });

    it("同じ引数で2回呼ぶと、同じ結果になる（状態を持たない）", () => {
      expect(isSelectedForImport(NEW, false)).toBe(isSelectedForImport(NEW, false));
      expect(isSelectedForImport(DUPLICATE, false)).toBe(
        isSelectedForImport(DUPLICATE, false),
      );
    });

    it("呼び出しの順序は結果に影響しない", () => {
      isSelectedForImport(DUPLICATE, true);
      isSelectedForImport(NEW, true);
      expect(isSelectedForImport(NEW, false)).toBe(true);
      expect(isSelectedForImport(DUPLICATE, false)).toBe(false);
    });
  });
});
