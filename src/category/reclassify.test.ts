import { describe, it, expect } from "vitest";
import { reclassifyTransactions } from "./reclassify.js";
import {
  INCOME,
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
    memo: "",
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
          memo: "手で書いたメモ",
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
        memo: "手で書いたメモ",
      });
    });

    it("金額が 0 や正（収入）でも、amountYen と source がそのまま残る", () => {
      // ルールのカテゴリは "収入" 以外にしてある。ルールが適用されていれば
      // "給与所得" になるので、収入がルールを見ていないことも同時に分かる。
      const rules = rulesOf(["給与", "給与所得"]);
      const input = frozen([
        tx("t1", "給与振込", UNCATEGORIZED, { amountYen: 250000, source: "bank" }),
        tx("t2", "給与調整", "食費", { amountYen: 0, source: "bank" }),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(
        result.map((item) => [item.amountYen, item.source, item.category]),
      ).toEqual([
        [250000, "bank", INCOME],
        [0, "bank", UNCATEGORIZED],
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

  describe("収入は分類しない", () => {
    it("収入の取引は、摘要がルールに当たっても収入カテゴリになる", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: 1000 }),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe(INCOME);
    });

    it("収入の取引は、学習に完全一致のエントリがあっても収入カテゴリになる", () => {
      const learned = learnedOf([["セブンイレブン渋谷店", "交際費"]]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: 1000 }),
      ]);

      const result = reclassifyTransactions(input, NO_RULES, learned);

      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe(INCOME);
    });

    it("収入の取引でも、category 以外のフィールドはすべて保たれる", () => {
      const rules = rulesOf(["給与", "給与所得"]);
      const input = frozen([
        tx("tx-0002", "給与振込", UNCATEGORIZED, {
          date: "2026-02-29",
          amountYen: 250000,
          source: "bank",
          memo: "7月分",
        }),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result[0]).toEqual({
        id: "tx-0002",
        date: "2026-02-29",
        amountYen: 250000,
        description: "給与振込",
        source: "bank",
        category: INCOME,
        memo: "7月分",
      });
    });

    it("既に収入カテゴリが入っている収入の取引は、変わっていないので返らない", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", INCOME, { amountYen: 1000 }),
      ]);

      expect(reclassifyTransactions(input, rules, NO_LEARNED)).toEqual([]);
    });

    it("収入の取引に別のカテゴリが入っていれば、収入カテゴリに直して返る（上の対）", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", "食費", { amountYen: 1000 }),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result.map((item) => [item.id, item.category])).toEqual([["t1", INCOME]]);
    });

    it("金額 1 円（境界）の取引も収入カテゴリになる", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: 1 }),
      ]);

      expect(reclassifyTransactions(input, rules, NO_LEARNED)[0]?.category).toBe(INCOME);
    });

    it("支出と収入が混ざっていても、支出だけが摘要どおりに分類される", () => {
      const rules = rulesOf(["セブンイレブン", "食費"], ["給与", "給与所得"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: -1000 }),
        tx("t2", "給与振込", UNCATEGORIZED, { amountYen: 250000 }),
        tx("t3", "架空商店ＸＹＺ９９", "食費", { amountYen: -500 }),
        tx("t4", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: 3000 }),
      ]);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result.map((item) => [item.id, item.category])).toEqual([
        ["t1", "食費"],
        ["t2", INCOME],
        ["t3", UNCATEGORIZED],
        ["t4", INCOME],
      ]);
    });

    it("同じ摘要の支出と収入があるとき、学習は支出だけに効く", () => {
      const learned = learnedOf([["セブンイレブン渋谷店", "交際費"]]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: -1000 }),
        tx("t2", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: 1000 }),
      ]);

      const result = reclassifyTransactions(input, NO_RULES, learned);

      expect(result.map((item) => [item.id, item.category])).toEqual([
        ["t1", "交際費"],
        ["t2", INCOME],
      ]);
    });

    it("同じ摘要の学習を付け替えても、動くのは支出だけで収入は動かない", () => {
      // 塞いだ穴そのもの。学習は摘要をキーにし符号を持たないので、
      // 以前はここで収入側まで一緒に動いていた。
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", UNCATEGORIZED, { amountYen: -1000 }),
        tx("t2", "セブンイレブン渋谷店", INCOME, { amountYen: 1000 }),
      ]);

      const before = reclassifyTransactions(
        input,
        NO_RULES,
        learnedOf([["セブンイレブン渋谷店", "交際費"]]),
      );
      const after = reclassifyTransactions(
        input,
        NO_RULES,
        learnedOf([["セブンイレブン渋谷店", "雑費"]]),
      );

      // 収入（t2）はどちらでも変更なし＝返らない。支出（t1）だけが学習に従う
      expect(before.map((item) => [item.id, item.category])).toEqual([
        ["t1", "交際費"],
      ]);
      expect(after.map((item) => [item.id, item.category])).toEqual([["t1", "雑費"]]);
    });
  });

  describe("0 円は収入にも支出にも寄せない", () => {
    it("0 円の取引は未分類になる", () => {
      const input = frozen([
        tx("t1", "給与調整", "食費", { amountYen: 0, source: "bank" }),
      ]);

      const result = reclassifyTransactions(input, NO_RULES, NO_LEARNED);

      expect(result.map((item) => [item.id, item.category])).toEqual([
        ["t1", UNCATEGORIZED],
      ]);
    });

    it("0 円の取引は、摘要がルールや学習に当たっても未分類になる", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const learned = learnedOf([["セブンイレブン渋谷店", "交際費"]]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", "食費", { amountYen: 0 }),
      ]);

      const result = reclassifyTransactions(input, rules, learned);

      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe(UNCATEGORIZED);
    });

    it("-0 円の取引も未分類になり、金額はそのまま残る", () => {
      const rules = rulesOf(["セブンイレブン", "食費"]);
      const input = frozen([
        tx("t1", "セブンイレブン渋谷店", "食費", { amountYen: -0 }),
      ]);
      // フィクスチャが本当に -0 であることを先に固定する
      expect(Object.is(input[0]?.amountYen, -0)).toBe(true);

      const result = reclassifyTransactions(input, rules, NO_LEARNED);

      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe(UNCATEGORIZED);
      expect(result[0]?.category).not.toBe(INCOME);
      expect(Object.is(result[0]?.amountYen, -0)).toBe(true);
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

describe("known — マスタに無いカテゴリを未分類に落とす", () => {
  const rules: CategoryRule[] = [{ pattern: "セブン", category: "食費" }];

  it("マスタにあるカテゴリはそのまま", () => {
    const transactions = [tx("a", "セブン", UNCATEGORIZED)];
    const known = new Set(["食費", UNCATEGORIZED]);

    expect(reclassifyTransactions(transactions, rules, {}, known)[0]?.category).toBe("食費");
  });

  // カテゴリの名前を変えてもルールは旧名を返し続ける。落とさないと、選択欄に
  // 現れないカテゴリの行が一覧に出る。
  it("マスタに無いカテゴリは未分類になる", () => {
    const transactions = [tx("a", "セブン", UNCATEGORIZED)];
    const known = new Set(["外食", UNCATEGORIZED]);

    expect(reclassifyTransactions(transactions, rules, {}, known)).toEqual([]);
  });

  it("既にそのカテゴリだった取引も未分類に戻る", () => {
    const transactions = [tx("a", "セブン", "食費")];
    const known = new Set(["外食", UNCATEGORIZED]);

    expect(reclassifyTransactions(transactions, rules, {}, known)[0]?.category).toBe(UNCATEGORIZED);
  });

  it("学習が指す名前もマスタに無ければ未分類になる", () => {
    const transactions = [tx("a", "タクシー", "交通費")];
    const known = new Set(["食費", UNCATEGORIZED]);

    expect(
      reclassifyTransactions(transactions, rules, { タクシー: "交通費" }, known)[0]?.category,
    ).toBe(UNCATEGORIZED);
  });

  it("収入がマスタに無ければ未分類になる", () => {
    const transactions = [tx("a", "給与", INCOME, { amountYen: 250000 })];
    const known = new Set([UNCATEGORIZED]);

    expect(reclassifyTransactions(transactions, rules, {}, known)[0]?.category).toBe(UNCATEGORIZED);
  });

  it("収入がマスタにあればそのまま", () => {
    const transactions = [tx("a", "給与", INCOME, { amountYen: 250000 })];
    const known = new Set([INCOME, UNCATEGORIZED]);

    expect(reclassifyTransactions(transactions, rules, {}, known)).toEqual([]);
  });

  it("省略すると落とさない（今までどおり）", () => {
    const transactions = [tx("a", "セブン", UNCATEGORIZED)];

    expect(reclassifyTransactions(transactions, rules, {})[0]?.category).toBe("食費");
  });

  it("空の known ではすべて未分類になる", () => {
    const transactions = [
      tx("a", "セブン", "食費"),
      tx("b", "給与", INCOME, { amountYen: 250000 }),
    ];

    expect(
      reclassifyTransactions(transactions, rules, {}, new Set()).map((t) => t.category),
    ).toEqual([UNCATEGORIZED, UNCATEGORIZED]);
  });

  it("落としても他の項目は変わらない", () => {
    const original = tx("a", "セブン", "食費", { memo: "昼" });

    expect(reclassifyTransactions([original], rules, {}, new Set([UNCATEGORIZED]))[0]).toEqual({
      ...original,
      category: UNCATEGORIZED,
    });
  });
});
