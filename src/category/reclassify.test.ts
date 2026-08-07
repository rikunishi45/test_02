import { describe, it, expect } from "vitest";
import { reclassifyTransactions } from "./reclassify.js";
import {
  UNCATEGORIZED,
  type CategoryRule,
  type LearnedCategories,
} from "./classify.js";
import type { StoredTransaction } from "../storage/schema.js";

function tx(
  id: string,
  description: string,
  category: string,
  extra: Partial<StoredTransaction> = {},
): StoredTransaction {
  return {
    id,
    date: "2026-07-01",
    amountYen: -1000,
    description,
    source: "card",
    category,
    ...extra,
  };
}

/**
 * 配列と各要素を凍結する。書き換えを試みた瞬間に落ちるようにするため。
 * 戻り値の型は可変のまま（readonly 引数・可変引数のどちらの署名でも渡せる）。
 */
function frozen(list: StoredTransaction[]): StoredTransaction[] {
  for (const item of list) Object.freeze(item);
  Object.freeze(list);
  return list;
}

function rulesOf(...pairs: readonly (readonly [string, string])[]): CategoryRule[] {
  const rules = pairs.map(([pattern, category]) =>
    Object.freeze({ pattern, category }),
  );
  Object.freeze(rules);
  return rules;
}

function learnedOf(
  entries: readonly (readonly [string, string])[],
): LearnedCategories {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(result, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return Object.freeze(result);
}

function snapshot(list: readonly StoredTransaction[]): StoredTransaction[] {
  return list.map((item) => ({ ...item }));
}

const NO_RULES: CategoryRule[] = rulesOf();
const NO_LEARNED: LearnedCategories = learnedOf([]);

describe("reclassifyTransactions", () => {
  describe("カテゴリが変わったものだけを返す", () => {
    it("全件のカテゴリが変わるとき、全件を返す", () => {
      const rules = rulesOf(["セブンイレブン", "食費"], ["amazon", "買い物"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "Amazon.co.jp", UNCATEGORIZED),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result).toHaveLength(2);
      expect(result.map((item) => [item.id, item.category])).toEqual([
        ["t1", "食費"],
        ["t2", "買い物"],
      ]);
    });

    it("1件もカテゴリが変わらないとき、空配列を返す", () => {
      const rules = rulesOf(["セブンイレブン", "食費"], ["amazon", "買い物"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", "食費"),
        tx("t2", "Amazon.co.jp", "買い物"),
      ]);

      expect(reclassifyTransactions(input, rules, NO_LEARNED)).toEqual([]);
    });

    it("一部だけ変わるとき、変わったものだけを返す", () => {
      const rules = rulesOf(["セブンイレブン", "食費"], ["amazon", "買い物"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", "食費"), // 変わらない
        tx("t2", "Amazon.co.jp", UNCATEGORIZED), // 変わる
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("t2");
      expect(result[0]?.category).toBe("買い物");
    });

    it("入力が1件で変わるとき、その1件を返す", () => {
      const rules = rulesOf(["ローソン", "食費"]);
      const input = frozen([tx("t1", "ローソン渋谷店", UNCATEGORIZED)]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe("食費");
    });

    it("入力が1件で変わらないとき、空配列を返す", () => {
      const rules = rulesOf(["ローソン", "食費"]);
      const input = frozen([tx("t1", "ローソン渋谷店", "食費")]);

      expect(reclassifyTransactions(input, rules, NO_LEARNED)).toEqual([]);
    });

    it("既に未分類で、分類結果も未分類のとき、返さない", () => {
      const rules = rulesOf(["ローソン", "食費"]);
      const input = frozen([tx("t1", "架空商店ＸＹＺ９９", UNCATEGORIZED)]);

      expect(reclassifyTransactions(input, rules, NO_LEARNED)).toEqual([]);
    });

    it("同じ description でも、既存カテゴリが違えば片方だけ返る", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", "食費"), // 一致するので返らない
        tx("t2", "セブンイレブン渋谷店", "雑費"), // 違うので返る
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("t2");
      expect(result[0]?.category).toBe("食費");
    });

    it("同じ description の取引が複数変わるとき、いずれも返る（重複排除しない）", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "セブンイレブン渋谷店", UNCATEGORIZED),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result.map((item) => item.id)).toEqual(["t1", "t2"]);
    });
  });

  describe("空配列", () => {
    it("空配列を渡すと空配列が返る", () => {
      expect(reclassifyTransactions([], NO_RULES, NO_LEARNED)).toEqual([]);
    });

    it("ルールと学習があっても、空配列を渡せば空配列", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const learned = learnedOf([["Amazon.co.jp", "書籍"]]);
      expect(reclassifyTransactions([], rules, learned)).toEqual([]);
    });
  });

  describe("順序は入力の順序を保つ", () => {
    it("変わる要素が飛び飛びでも、入力順で返る", () => {
      const rules = rulesOf(
        ["セブンイレブン", "食費"],
        ["amazon", "買い物"],
        ["JR", "交通費"],
      );
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED), // 変わる
        tx("t2", "Amazon.co.jp", "買い物"), // 変わらない
        tx("t3", "JR東日本", UNCATEGORIZED), // 変わる
        tx("t4", "セブンイレブン新宿店", "食費"), // 変わらない
        tx("t5", "Amazon.co.jp/order", UNCATEGORIZED), // 変わる
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result.map((item) => item.id)).toEqual(["t1", "t3", "t5"]);
    });

    it("先頭だけが変わるとき、その1件が返る", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "架空商店ＸＹＺ９９", UNCATEGORIZED),
      ]);

      expect(
        reclassifyTransactions(input, rules, NO_LEARNED).map((item) => item.id),
      ).toEqual(["t1"]);
    });

    it("末尾だけが変わるとき、その1件が返る", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "架空商店ＸＹＺ９９", UNCATEGORIZED),
        tx("t2", "セブンイレブン渋谷店", UNCATEGORIZED),
      ]);

      expect(
        reclassifyTransactions(input, rules, NO_LEARNED).map((item) => item.id),
      ).toEqual(["t2"]);
    });
  });

  describe("category 以外のフィールドを保つ", () => {
    it("id・date・amountYen・description・source がそのまま残る", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("tx-0001", "セブンイレブン渋谷店", UNCATEGORIZED, {
          date: "2026-02-29",
          amountYen: -12345,
          source: "card",
        }),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result[0]).toEqual({
        id: "tx-0001",
        date: "2026-02-29",
        amountYen: -12345,
        description: "セブンイレブン渋谷店",
        source: "card",
        category: "食費",
      });
    });

    it("金額が 0 や正（収入）でも、そのまま残る", () => {
      const rules = rulesOf(["給与", "収入"]);
      const input = frozen([
        tx("t1", "給与振込", UNCATEGORIZED, { amountYen: 250000, source: "bank" }),
        tx("t2", "給与調整", UNCATEGORIZED, { amountYen: 0, source: "bank" }),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result.map((item) => [item.amountYen, item.source])).toEqual([
        [250000, "bank"],
        [0, "bank"],
      ]);
    });

    it("description が空文字列の取引も扱える", () => {
      const learned = learnedOf([["", "手入力"]]);
      const input = frozen([tx("t1", "", UNCATEGORIZED)]);

      const result = reclassifyTransactions(input, NO_RULES, learned);

      expect(result).toHaveLength(1);
      expect(result[0]?.description).toBe("");
      expect(result[0]?.category).toBe("手入力");
    });
  });

  describe("分類は classifyDescription の仕様に従う", () => {
    it("学習がルールより優先される", () => {
      const rules = rulesOf(["amazon", "買い物"]);
      const learned = learnedOf([["Amazon.co.jp", "書籍"]]);
      const input = frozen([tx("t1", "Amazon.co.jp", UNCATEGORIZED)]);

      const result = reclassifyTransactions(input, rules, learned);

      expect(result[0]?.category).toBe("書籍");
    });

    it("学習が無ければルールが適用される（上の対）", () => {
      const rules = rulesOf(["amazon", "買い物"]);
      const input = frozen([tx("t1", "Amazon.co.jp", UNCATEGORIZED)]);

      expect(
        reclassifyTransactions(input, rules, NO_LEARNED)[0]?.category,
      ).toBe("買い物");
    });

    it("学習が既存カテゴリと同じなら、返らない", () => {
      const rules = rulesOf(["amazon", "買い物"]);
      const learned = learnedOf([["Amazon.co.jp", "書籍"]]);
      const input = frozen([tx("t1", "Amazon.co.jp", "書籍")]);

      expect(reclassifyTransactions(input, rules, learned)).toEqual([]);
    });

    it("複数のルールが当たるとき、先頭のルールのカテゴリになる", () => {
      const rules = rulesOf(["セブン", "食費"], ["イレブン", "雑費"]);
      const input = frozen([tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED)]);

      expect(
        reclassifyTransactions(input, rules, NO_LEARNED)[0]?.category,
      ).toBe("食費");
    });

    it("学習されたカテゴリが空文字列でも、その値になる", () => {
      const learned = learnedOf([["セブンイレブン渋谷店", ""]]);
      const input = frozen([tx("t1", "セブンイレブン渋谷店", "食費")]);

      const result = reclassifyTransactions(input, NO_RULES, learned);

      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe("");
    });
  });

  describe("本来の用途：ルールを足す／消す", () => {
    it("未分類だったものが、ルール追加で分類される", () => {
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "ローソン新宿店", UNCATEGORIZED),
      ]);

      const before = reclassifyTransactions(input, NO_RULES, NO_LEARNED);
      expect(before).toEqual([]);

      const after = reclassifyTransactions(
        input,
        rulesOf(["セブンイレブン", "食費"]),
        NO_LEARNED,
      );
      expect(after.map((item) => [item.id, item.category])).toEqual([
        ["t1", "食費"],
      ]);
    });

    it("分類済みだったものが、ルールを空にすると未分類に戻る", () => {
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", "食費"),
        tx("t2", "Amazon.co.jp", "買い物"),
      ]);

      const result = reclassifyTransactions(input, NO_RULES, NO_LEARNED);

      expect(result.map((item) => [item.id, item.category])).toEqual([
        ["t1", UNCATEGORIZED],
        ["t2", UNCATEGORIZED],
      ]);
    });

    it("ルールのカテゴリを変えると、その分だけ変更が返る", () => {
      const input = frozen([tx("t1", "セブンイレブン渋谷店", "食費")]);

      expect(
        reclassifyTransactions(input, rulesOf(["セブンイレブン", "食費"]), NO_LEARNED),
      ).toEqual([]);

      const result = reclassifyTransactions(
        input,
        rulesOf(["セブンイレブン", "交際費"]),
        NO_LEARNED,
      );
      expect(result[0]?.category).toBe("交際費");
    });
  });

  describe("引数を書き換えない", () => {
    it("入力配列の要素の category が呼び出し後も元のまま", () => {
      const rules = rulesOf(["セブンイレブン", "食費"], ["amazon", "買い物"]);
      const input = [
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "Amazon.co.jp", "書籍"),
      ];
      const before = snapshot(input);

      reclassifyTransactions(input, rules, NO_LEARNED);

      expect(snapshot(input)).toEqual(before);
      expect(input[0]?.category).toBe(UNCATEGORIZED);
      expect(input[1]?.category).toBe("書籍");
    });

    it("入力配列の長さと並びが変わらない", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = [
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "架空商店ＸＹＺ９９", UNCATEGORIZED),
        tx("t3", "セブンイレブン新宿店", UNCATEGORIZED),
      ];

      reclassifyTransactions(input, rules, NO_LEARNED);

      expect(input).toHaveLength(3);
      expect(input.map((item) => item.id)).toEqual(["t1", "t2", "t3"]);
    });

    it("凍結された配列・要素を渡しても例外にならない", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "架空商店ＸＹＺ９９", "食費"),
      ]);

      expect(() =>
        reclassifyTransactions(input, rules, NO_LEARNED),
      ).not.toThrow();
    });

    it("凍結された入力でも、正しい結果が返る", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "架空商店ＸＹＺ９９", "食費"),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result.map((item) => [item.id, item.category])).toEqual([
        ["t1", "食費"],
        ["t2", UNCATEGORIZED],
      ]);
    });

    it("返す要素は入力要素とは別のオブジェクト", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED)]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result[0]).not.toBe(input[0]);
    });

    it("返す配列は入力配列とは別の配列（変更が無いときも）", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([tx("t1", "セブンイレブン渋谷店", "食費")]);

      expect(reclassifyTransactions(input, rules, NO_LEARNED)).not.toBe(input);
    });

    it("ルールと学習を書き換えない", () => {
      const rules = [
        { pattern: "セブンイレブン", category: "食費" },
        { pattern: "amazon", category: "買い物" },
      ];
      const rulesBefore = rules.map((rule) => ({ ...rule }));
      const learned = learnedOf([["Amazon.co.jp", "書籍"]]);
      const learnedBefore = Object.entries(learned);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "Amazon.co.jp", UNCATEGORIZED),
      ]);

      reclassifyTransactions(input, rules, learned);

      expect(rules).toEqual(rulesBefore);
      expect(Object.entries(learned)).toEqual(learnedBefore);
    });
  });

  describe("純粋関数であること", () => {
    it("同じ入力で2回呼ぶと、同じ結果になる", () => {
      const rules = rulesOf(["セブンイレブン", "食費"], ["amazon", "買い物"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED),
        tx("t2", "Amazon.co.jp", "買い物"),
        tx("t3", "架空商店ＸＹＺ９９", UNCATEGORIZED),
      ]);

      const first = reclassifyTransactions(input, rules, NO_LEARNED);
      const second = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(second).toEqual(first);
      expect(first).toHaveLength(1);
    });

    it("戻り値を再度渡すと、もう変更は出ない（収束する）", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED)]);

      const changed = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(reclassifyTransactions(changed, rules, NO_LEARNED)).toEqual([]);
    });

    it("直前の呼び出しが次の呼び出しに影響しない", () => {
      const input = frozen([tx("t1", "セブンイレブン渋谷店", "食費")]);

      expect(reclassifyTransactions(input, NO_RULES, NO_LEARNED)).toHaveLength(1);
      expect(
        reclassifyTransactions(input, rulesOf(["セブンイレブン", "食費"]), NO_LEARNED),
      ).toEqual([]);
      expect(reclassifyTransactions(input, NO_RULES, NO_LEARNED)).toHaveLength(1);
    });
  });
});
