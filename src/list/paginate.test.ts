import { describe, it, expect } from "vitest";
import { PER_PAGE, clampPage, pageCount, pageRange, pageSlice } from "./paginate.js";

/** 1..n の連番。切り出した中身がどこの範囲かをそのまま読める */
function items(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => index + 1);
}

describe("PER_PAGE", () => {
  it("1件以上の正の整数", () => {
    expect(Number.isInteger(PER_PAGE)).toBe(true);
    expect(PER_PAGE).toBeGreaterThan(0);
  });
});

describe("pageCount", () => {
  describe("0件でも1ページ", () => {
    it("0件は1ページ（0ページ目を作らない）", () => {
      expect(pageCount(0, 50)).toBe(1);
    });

    it("負の総数でも1ページ", () => {
      expect(pageCount(-5, 50)).toBe(1);
    });
  });

  describe("割り切れる件数", () => {
    it("1ページぶんちょうどは1ページ", () => {
      expect(pageCount(50, 50)).toBe(1);
    });

    it("2ページぶんちょうどは2ページ", () => {
      expect(pageCount(100, 50)).toBe(2);
    });

    it("10ページぶんちょうどは10ページ", () => {
      expect(pageCount(500, 50)).toBe(10);
    });
  });

  describe("余りが出る件数", () => {
    it("1件でも1ページ", () => {
      expect(pageCount(1, 50)).toBe(1);
    });

    it("1ページを1件超えると2ページ（境界のすぐ外）", () => {
      expect(pageCount(51, 50)).toBe(2);
    });

    it("1ページに1件足りないときは1ページ（境界のすぐ内）", () => {
      expect(pageCount(49, 50)).toBe(1);
    });

    it("端数は切り上げる", () => {
      expect(pageCount(138, 50)).toBe(3);
    });
  });

  it("perPage が1なら件数と同じページ数", () => {
    expect(pageCount(7, 1)).toBe(7);
  });

  it("perPage が総数より大きければ1ページ", () => {
    expect(pageCount(3, 50)).toBe(1);
  });
});

describe("clampPage", () => {
  describe("範囲内はそのまま", () => {
    it.each([1, 2, 3])("%i ページ目はそのまま", (page) => {
      expect(clampPage(page, 138, 50)).toBe(page);
    });
  });

  describe("下にはみ出す", () => {
    it.each([0, -1, -100])("%i は1に寄せる", (page) => {
      expect(clampPage(page, 138, 50)).toBe(1);
    });
  });

  describe("上にはみ出す", () => {
    it("最後のページに寄せる", () => {
      expect(clampPage(4, 138, 50)).toBe(3);
    });

    it("はるかに大きい番号でも最後のページ", () => {
      expect(clampPage(9999, 138, 50)).toBe(3);
    });

    // 絞り込みで総数が減ったときの経路。3ページ目を見ていて1ページ分しか
    // 残らなければ、空の表ではなく1ページ目を見せる。
    it("総数が減ると、行き過ぎたページが最後のページに戻る", () => {
      expect(clampPage(3, 12, 50)).toBe(1);
    });

    it("0件になったときは1ページ目", () => {
      expect(clampPage(3, 0, 50)).toBe(1);
    });
  });

  describe("整数でない入力", () => {
    it("小数は切り捨てる", () => {
      expect(clampPage(2.9, 138, 50)).toBe(2);
    });

    it("NaN は1にする", () => {
      expect(clampPage(Number.NaN, 138, 50)).toBe(1);
    });

    it("Infinity は1にする（最後のページに化けない）", () => {
      expect(clampPage(Number.POSITIVE_INFINITY, 138, 50)).toBe(1);
    });

    it("-Infinity は1にする", () => {
      expect(clampPage(Number.NEGATIVE_INFINITY, 138, 50)).toBe(1);
    });
  });

  it("結果は常に 1 以上 pageCount 以下", () => {
    for (const page of [-3, 0, 1, 2, 3, 4, 50]) {
      const clamped = clampPage(page, 138, 50);
      expect(clamped).toBeGreaterThanOrEqual(1);
      expect(clamped).toBeLessThanOrEqual(pageCount(138, 50));
    }
  });
});

describe("pageSlice", () => {
  describe("切り出す範囲", () => {
    it("1ページ目は先頭から perPage 件", () => {
      expect(pageSlice(items(138), 1, 50)).toEqual(items(50));
    });

    it("2ページ目は 51〜100 件目", () => {
      const page = pageSlice(items(138), 2, 50);

      expect([page[0], page[page.length - 1], page.length]).toEqual([51, 100, 50]);
    });

    it("最後のページは余りだけ（38件）", () => {
      const page = pageSlice(items(138), 3, 50);

      expect([page[0], page[page.length - 1], page.length]).toEqual([101, 138, 38]);
    });

    it("割り切れるときの最後のページは perPage 件", () => {
      expect(pageSlice(items(100), 2, 50).length).toBe(50);
    });
  });

  describe("範囲外のページ", () => {
    it("行き過ぎたページは最後のページを返す（空にしない）", () => {
      expect(pageSlice(items(138), 4, 50)).toEqual(pageSlice(items(138), 3, 50));
    });

    it("0ページ目は1ページ目を返す", () => {
      expect(pageSlice(items(138), 0, 50)).toEqual(pageSlice(items(138), 1, 50));
    });

    it("負のページも1ページ目を返す", () => {
      expect(pageSlice(items(138), -2, 50)).toEqual(pageSlice(items(138), 1, 50));
    });
  });

  describe("端のケース", () => {
    it("空の配列は空を返す", () => {
      expect(pageSlice([], 1, 50)).toEqual([]);
    });

    it("空の配列に行き過ぎたページを指定しても空", () => {
      expect(pageSlice([], 5, 50)).toEqual([]);
    });

    it("perPage より少ない件数は全部返る", () => {
      expect(pageSlice(items(3), 1, 50)).toEqual([1, 2, 3]);
    });

    it("ちょうど perPage 件は1ページに収まる", () => {
      expect(pageSlice(items(50), 1, 50)).toEqual(items(50));
    });
  });

  describe("ページをまたいで過不足が無い", () => {
    it("全ページを繋ぐと元の並びに戻る", () => {
      const all = items(138);
      const joined = [1, 2, 3].flatMap((page) => pageSlice(all, page, 50));

      expect(joined).toEqual(all);
    });

    it("同じ要素が2つのページに現れない", () => {
      const all = items(138);
      const joined = [1, 2, 3].flatMap((page) => pageSlice(all, page, 50));

      expect(new Set(joined).size).toBe(all.length);
    });

    it("perPage が1でも過不足なく分かれる", () => {
      const all = items(5);
      const joined = [1, 2, 3, 4, 5].flatMap((page) => pageSlice(all, page, 1));

      expect(joined).toEqual(all);
    });
  });

  describe("入力を書き換えない", () => {
    it("元の配列の内容が変わらない", () => {
      const all = items(138);
      const snapshot = [...all];

      pageSlice(all, 2, 50);

      expect(all).toEqual(snapshot);
    });

    it("入力の配列そのものは返さない", () => {
      const all = items(3);

      expect(pageSlice(all, 1, 50)).not.toBe(all);
    });

    it("凍結された配列を渡しても動く", () => {
      expect(pageSlice(Object.freeze(items(3)), 1, 50)).toEqual([1, 2, 3]);
    });
  });
});

describe("pageRange", () => {
  it("0件なら 0〜0", () => {
    expect(pageRange(0, 1, 50)).toEqual({ first: 0, last: 0 });
  });

  it("1ページ目は 1〜50", () => {
    expect(pageRange(138, 1, 50)).toEqual({ first: 1, last: 50 });
  });

  it("2ページ目は 51〜100", () => {
    expect(pageRange(138, 2, 50)).toEqual({ first: 51, last: 100 });
  });

  it("最後のページは総数で止まる", () => {
    expect(pageRange(138, 3, 50)).toEqual({ first: 101, last: 138 });
  });

  it("1件だけなら 1〜1", () => {
    expect(pageRange(1, 1, 50)).toEqual({ first: 1, last: 1 });
  });

  it("行き過ぎたページは最後のページの範囲になる", () => {
    expect(pageRange(138, 9, 50)).toEqual(pageRange(138, 3, 50));
  });

  it("last は総数を超えない", () => {
    for (const page of [1, 2, 3, 4]) {
      expect(pageRange(138, page, 50).last).toBeLessThanOrEqual(138);
    }
  });

  it("範囲の件数が、そのページの実際の件数と一致する", () => {
    const all = items(138);
    for (const page of [1, 2, 3]) {
      const { first, last } = pageRange(all.length, page, 50);
      expect(last - first + 1).toBe(pageSlice(all, page, 50).length);
    }
  });
});
