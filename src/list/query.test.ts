import { describe, it, expect } from "vitest";
import { sumAll } from "../aggregate/period.js";
import type { StoredTransaction } from "../storage/schema.js";
import { PER_PAGE, pageCount, pageSlice } from "./paginate.js";
import {
  NO_QUERY,
  kindOf,
  matchesQuery,
  matchesText,
  normalizeForSearch,
  queryTransactions,
  sortForList,
  type TransactionQuery,
} from "./query.js";

const BASE: StoredTransaction = {
  id: "t-000",
  date: "2026-07-15",
  amountYen: -1200,
  description: "コンビニ",
  source: "card",
  category: "食費",
  memo: "",
};

let sequence = 0;

function tx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  sequence += 1;
  return { ...BASE, id: `t-${String(sequence).padStart(3, "0")}`, ...overrides };
}

function queryOf(overrides: Partial<TransactionQuery> = {}): TransactionQuery {
  return { ...NO_QUERY, ...overrides };
}

function idsOf(transactions: readonly StoredTransaction[]): string[] {
  return transactions.map((transaction) => transaction.id);
}

describe("NO_QUERY", () => {
  it("すべての項目が「絞り込まない」状態", () => {
    expect(NO_QUERY).toEqual({
      text: "",
      category: null,
      source: null,
      kind: null,
      month: null,
    });
  });

  it("どんな取引にも当たる", () => {
    expect(matchesQuery(tx(), NO_QUERY)).toBe(true);
    expect(matchesQuery(tx({ amountYen: 250000, category: "収入" }), NO_QUERY)).toBe(true);
  });
});

describe("normalizeForSearch", () => {
  it("全角英数を半角にする（実データの摘要はこの形）", () => {
    expect(normalizeForSearch("ＶＩＳＡ海外利用")).toBe("visa海外利用");
  });

  it("大文字を小文字にする", () => {
    expect(normalizeForSearch("VISA")).toBe("visa");
  });

  it("半角カナを全角にする（濁点も合成する）", () => {
    expect(normalizeForSearch("ﾈｯﾄﾌﾘｯｸｽ")).toBe("ネットフリックス");
  });

  it("連続する空白を1つに畳んで前後を落とす", () => {
    expect(normalizeForSearch("  ＶＩＳＡ 　 国内  ")).toBe("visa 国内");
  });

  it("空文字列は空文字列のまま", () => {
    expect(normalizeForSearch("")).toBe("");
  });

  it("空白だけなら空文字列になる", () => {
    expect(normalizeForSearch("   ")).toBe("");
  });

  it("全角と半角の表記が同じ形に畳まれる", () => {
    expect(normalizeForSearch("ＶＩＳＡ")).toBe(normalizeForSearch("visa"));
  });
});

describe("matchesText", () => {
  describe("検索語が空", () => {
    it("空文字列はすべてに当たる", () => {
      expect(matchesText(tx({ description: "何でも" }), "")).toBe(true);
    });

    it("空白だけもすべてに当たる", () => {
      expect(matchesText(tx({ description: "何でも" }), "   ")).toBe(true);
    });

    it("全角空白だけもすべてに当たる", () => {
      expect(matchesText(tx({ description: "何でも" }), "　")).toBe(true);
    });
  });

  describe("部分一致", () => {
    it("摘要の一部に当たる", () => {
      expect(matchesText(tx({ description: "セブン－イレブン渋谷" }), "イレブン")).toBe(true);
    });

    it("先頭に当たる", () => {
      expect(matchesText(tx({ description: "ゆめタウン広島" }), "ゆめ")).toBe(true);
    });

    it("末尾に当たる", () => {
      expect(matchesText(tx({ description: "ゆめタウン広島" }), "広島")).toBe(true);
    });

    it("含まれない語には当たらない", () => {
      expect(matchesText(tx({ description: "ゆめタウン広島" }), "コンビニ")).toBe(false);
    });
  });

  describe("表記の揺れを越える", () => {
    it("半角で打った語が全角の摘要に当たる", () => {
      expect(matchesText(tx({ description: "ＶＩＳＡ海外利用" }), "visa")).toBe(true);
    });

    it("大文字で打っても当たる", () => {
      expect(matchesText(tx({ description: "ＶＩＳＡ海外利用" }), "VISA")).toBe(true);
    });

    it("全角で打っても当たる", () => {
      expect(matchesText(tx({ description: "ＶＩＳＡ海外利用" }), "ＶＩＳＡ")).toBe(true);
    });

    it("半角カナの摘要に全角カナで当たる", () => {
      expect(matchesText(tx({ description: "ﾈｯﾄﾌﾘｯｸｽ" }), "ネットフリックス")).toBe(true);
    });
  });

  describe("複数の語（すべて満たす）", () => {
    const netflix = tx({ description: "ＶＩＳＡ国内利用　ＶＳ ﾈｯﾄﾌﾘｯｸｽ" });

    it("2つの語が両方あれば当たる", () => {
      expect(matchesText(netflix, "visa ネットフリックス")).toBe(true);
    });

    it("語の順序は問わない", () => {
      expect(matchesText(netflix, "ネットフリックス visa")).toBe(true);
    });

    it("片方しか無ければ当たらない", () => {
      expect(matchesText(netflix, "visa アマゾン")).toBe(false);
    });

    it("語が増えるほど当たりにくくなる（OR ではない）", () => {
      expect(matchesText(netflix, "visa")).toBe(true);
      expect(matchesText(netflix, "visa 存在しない語")).toBe(false);
    });

    it("語の間の空白が連続していても同じ", () => {
      expect(matchesText(netflix, "visa    ネットフリックス")).toBe(true);
    });

    it("全角空白で区切っても同じ", () => {
      expect(matchesText(netflix, "visa　ネットフリックス")).toBe(true);
    });
  });

  describe("メモも対象にする", () => {
    it("メモに当たる", () => {
      expect(matchesText(tx({ description: "コンビニ", memo: "会社の飲み会" }), "飲み会")).toBe(
        true,
      );
    });

    it("摘要とメモにまたがる2語でも当たる", () => {
      const transaction = tx({ description: "コンビニ", memo: "会社の飲み会" });

      expect(matchesText(transaction, "コンビニ 飲み会")).toBe(true);
    });

    it("メモが空でも摘要だけで当たる", () => {
      expect(matchesText(tx({ description: "コンビニ", memo: "" }), "コンビニ")).toBe(true);
    });

    it("摘要とメモの境目をまたぐ文字列には当たらない", () => {
      const transaction = tx({ description: "AB", memo: "CD" });

      expect(matchesText(transaction, "abcd")).toBe(false);
    });
  });
});

describe("kindOf", () => {
  it("負は支出", () => {
    expect(kindOf(tx({ amountYen: -1200 }))).toBe("expense");
  });

  it("正は収入", () => {
    expect(kindOf(tx({ amountYen: 250000 }))).toBe("income");
  });

  it("1円の支出は支出（境界）", () => {
    expect(kindOf(tx({ amountYen: -1 }))).toBe("expense");
  });

  it("1円の収入は収入（境界）", () => {
    expect(kindOf(tx({ amountYen: 1 }))).toBe("income");
  });

  it("0 は支出", () => {
    expect(kindOf(tx({ amountYen: 0 }))).toBe("expense");
  });

  it("-0 も支出（-0 < 0 は偽なので、正なら収入の向きで書く）", () => {
    expect(kindOf(tx({ amountYen: -0 }))).toBe("expense");
  });
});

describe("matchesQuery", () => {
  describe("カテゴリ", () => {
    it("一致すれば当たる", () => {
      expect(matchesQuery(tx({ category: "食費" }), queryOf({ category: "食費" }))).toBe(true);
    });

    it("違えば当たらない", () => {
      expect(matchesQuery(tx({ category: "食費" }), queryOf({ category: "交通費" }))).toBe(false);
    });

    it("null なら絞り込まない", () => {
      expect(matchesQuery(tx({ category: "食費" }), queryOf({ category: null }))).toBe(true);
    });

    it("部分一致では当たらない（完全一致）", () => {
      expect(matchesQuery(tx({ category: "食費" }), queryOf({ category: "食" }))).toBe(false);
    });
  });

  describe("支払い方法", () => {
    it("一致すれば当たる", () => {
      expect(matchesQuery(tx({ source: "card" }), queryOf({ source: "card" }))).toBe(true);
    });

    it("違えば当たらない", () => {
      expect(matchesQuery(tx({ source: "card" }), queryOf({ source: "cash" }))).toBe(false);
    });

    it("null なら絞り込まない", () => {
      expect(matchesQuery(tx({ source: "bank" }), queryOf({ source: null }))).toBe(true);
    });
  });

  describe("種別", () => {
    it("支出で絞ると支出に当たる", () => {
      expect(matchesQuery(tx({ amountYen: -1200 }), queryOf({ kind: "expense" }))).toBe(true);
    });

    it("支出で絞ると収入には当たらない", () => {
      expect(matchesQuery(tx({ amountYen: 250000 }), queryOf({ kind: "expense" }))).toBe(false);
    });

    it("収入で絞ると収入に当たる", () => {
      expect(matchesQuery(tx({ amountYen: 250000 }), queryOf({ kind: "income" }))).toBe(true);
    });

    it("null なら両方に当たる", () => {
      expect(matchesQuery(tx({ amountYen: -1200 }), queryOf({ kind: null }))).toBe(true);
      expect(matchesQuery(tx({ amountYen: 250000 }), queryOf({ kind: null }))).toBe(true);
    });
  });

  describe("月", () => {
    it("同じ月なら当たる", () => {
      expect(matchesQuery(tx({ date: "2026-07-15" }), queryOf({ month: "2026-07" }))).toBe(true);
    });

    it("月初と月末も当たる", () => {
      expect(matchesQuery(tx({ date: "2026-07-01" }), queryOf({ month: "2026-07" }))).toBe(true);
      expect(matchesQuery(tx({ date: "2026-07-31" }), queryOf({ month: "2026-07" }))).toBe(true);
    });

    it("前月末・翌月初は当たらない", () => {
      expect(matchesQuery(tx({ date: "2026-06-30" }), queryOf({ month: "2026-07" }))).toBe(false);
      expect(matchesQuery(tx({ date: "2026-08-01" }), queryOf({ month: "2026-07" }))).toBe(false);
    });

    it("null なら絞り込まない", () => {
      expect(matchesQuery(tx({ date: "2020-01-01" }), queryOf({ month: null }))).toBe(true);
    });
  });

  describe("条件を重ねる（すべて満たす必要がある）", () => {
    const transaction = tx({
      date: "2026-07-15",
      amountYen: -1200,
      description: "ＶＩＳＡ国内利用",
      source: "card",
      category: "サブスク",
    });

    it("すべて満たせば当たる", () => {
      expect(
        matchesQuery(
          transaction,
          queryOf({
            text: "visa",
            category: "サブスク",
            source: "card",
            kind: "expense",
            month: "2026-07",
          }),
        ),
      ).toBe(true);
    });

    it.each([
      ["text", { text: "アマゾン" }],
      ["category", { category: "食費" }],
      ["source", { source: "cash" as const }],
      ["kind", { kind: "income" as const }],
      ["month", { month: "2026-08" }],
    ])("%s が1つでも外れれば当たらない", (_label, override) => {
      expect(
        matchesQuery(
          transaction,
          queryOf({
            text: "visa",
            category: "サブスク",
            source: "card",
            kind: "expense",
            month: "2026-07",
            ...override,
          }),
        ),
      ).toBe(false);
    });
  });
});

describe("sortForList", () => {
  it("日付の新しい順に並べる", () => {
    const rows = [
      tx({ id: "a", date: "2026-07-01" }),
      tx({ id: "b", date: "2026-07-31" }),
      tx({ id: "c", date: "2026-07-15" }),
    ];

    expect(idsOf(sortForList(rows))).toEqual(["b", "c", "a"]);
  });

  it("年をまたいでも新しい順", () => {
    const rows = [tx({ id: "old", date: "2025-12-31" }), tx({ id: "new", date: "2026-01-01" })];

    expect(idsOf(sortForList(rows))).toEqual(["new", "old"]);
  });

  describe("同じ日付の決着", () => {
    it("id の昇順になる", () => {
      const rows = [
        tx({ id: "c", date: "2026-07-15" }),
        tx({ id: "a", date: "2026-07-15" }),
        tx({ id: "b", date: "2026-07-15" }),
      ];

      expect(idsOf(sortForList(rows))).toEqual(["a", "b", "c"]);
    });

    // ページ送りは並び順が決まっていることに依存する。入力順で変わると、
    // 同じ行が2ページに出たり、どのページにも出ない行ができる。
    it("入力順を変えても同じ並びになる", () => {
      const rows = [
        tx({ id: "c", date: "2026-07-15" }),
        tx({ id: "a", date: "2026-07-15" }),
        tx({ id: "b", date: "2026-07-15" }),
      ];

      expect(idsOf(sortForList([...rows].reverse()))).toEqual(idsOf(sortForList(rows)));
    });

    it("1件足しても既存の相対順序が変わらない", () => {
      const rows = [tx({ id: "a", date: "2026-07-15" }), tx({ id: "c", date: "2026-07-15" })];
      const withNew = [...rows, tx({ id: "b", date: "2026-07-15" })];

      expect(idsOf(sortForList(withNew))).toEqual(["a", "b", "c"]);
    });

    it("日付が違えば id は効かない（日付が優先）", () => {
      const rows = [
        tx({ id: "z", date: "2026-07-31" }),
        tx({ id: "a", date: "2026-07-01" }),
      ];

      expect(idsOf(sortForList(rows))).toEqual(["z", "a"]);
    });
  });

  describe("端のケース", () => {
    it("空の配列は空を返す", () => {
      expect(sortForList([])).toEqual([]);
    });

    it("1件ならそのまま", () => {
      const rows = [tx({ id: "only" })];

      expect(idsOf(sortForList(rows))).toEqual(["only"]);
    });
  });

  describe("入力を書き換えない", () => {
    it("元の配列の並びが変わらない", () => {
      const rows = [tx({ id: "a", date: "2026-07-01" }), tx({ id: "b", date: "2026-07-31" })];

      sortForList(rows);

      expect(idsOf(rows)).toEqual(["a", "b"]);
    });

    it("凍結された配列を渡しても動く", () => {
      const rows = Object.freeze([
        tx({ id: "a", date: "2026-07-01" }),
        tx({ id: "b", date: "2026-07-31" }),
      ]) as readonly StoredTransaction[];

      expect(idsOf(sortForList(rows))).toEqual(["b", "a"]);
    });
  });
});

describe("queryTransactions", () => {
  const rows = [
    tx({ id: "a", date: "2026-07-01", description: "ＶＩＳＡ国内利用", category: "サブスク" }),
    tx({ id: "b", date: "2026-07-31", description: "ゆめタウン広島", category: "食費" }),
    tx({ id: "c", date: "2026-08-02", description: "コンビニ", category: "食費", source: "cash" }),
    tx({ id: "d", date: "2026-07-15", amountYen: 250000, description: "給与", category: "収入" }),
  ];

  it("条件に合うものだけを返す", () => {
    expect(idsOf(queryTransactions(rows, queryOf({ category: "食費" })))).toEqual(["c", "b"]);
  });

  it("結果は日付の新しい順に並ぶ", () => {
    expect(idsOf(queryTransactions(rows, NO_QUERY))).toEqual(["c", "b", "d", "a"]);
  });

  it("絞り込まなければ全件返る", () => {
    expect(queryTransactions(rows, NO_QUERY).length).toBe(rows.length);
  });

  it("検索語で絞れる", () => {
    expect(idsOf(queryTransactions(rows, queryOf({ text: "visa" })))).toEqual(["a"]);
  });

  it("該当が無ければ空", () => {
    expect(queryTransactions(rows, queryOf({ text: "存在しない" }))).toEqual([]);
  });

  it("空の配列を渡すと空が返る", () => {
    expect(queryTransactions([], NO_QUERY)).toEqual([]);
  });

  it("条件を重ねると結果が狭まる（増えない）", () => {
    const wide = queryTransactions(rows, queryOf({ category: "食費" }));
    const narrow = queryTransactions(rows, queryOf({ category: "食費", source: "cash" }));

    expect(narrow.length).toBeLessThanOrEqual(wide.length);
    expect(idsOf(narrow)).toEqual(["c"]);
  });

  it("収入だけを取り出せる", () => {
    expect(idsOf(queryTransactions(rows, queryOf({ kind: "income" })))).toEqual(["d"]);
  });

  it("月で絞ると他の月が混ざらない", () => {
    expect(idsOf(queryTransactions(rows, queryOf({ month: "2026-08" })))).toEqual(["c"]);
  });

  it("取引そのものは複製せず、同じ参照を返す", () => {
    const found = queryTransactions(rows, queryOf({ text: "visa" }));

    expect(found[0]).toBe(rows[0]);
  });

  describe("入力を書き換えない", () => {
    it("元の配列の並びが変わらない", () => {
      const input = [...rows];

      queryTransactions(input, NO_QUERY);

      expect(idsOf(input)).toEqual(["a", "b", "c", "d"]);
    });

    it("凍結された配列を渡しても動く", () => {
      expect(() => queryTransactions(Object.freeze(rows), NO_QUERY)).not.toThrow();
    });

    it("入力の配列そのものは返さない", () => {
      expect(queryTransactions(rows, NO_QUERY)).not.toBe(rows);
    });
  });
});

/**
 * 絞り込み・並べ替え・ページ送り・合計は別々のモジュールにあるが、画面では
 * 1本に繋がる。**繋いだときに壊れる性質はここでしか捕まえられない。**
 */
describe("絞り込みとページ送りを繋いだときの性質", () => {
  /** すべて同じ日付。同着の決着が効いていなければページ送りが壊れる */
  function sameDayRows(count: number): StoredTransaction[] {
    return Array.from({ length: count }, (_unused, index) =>
      tx({ id: `row-${String(index).padStart(3, "0")}`, date: "2026-07-15" }),
    );
  }

  function allPages(rows: readonly StoredTransaction[]): StoredTransaction[] {
    const pages = pageCount(rows.length, PER_PAGE);
    return Array.from({ length: pages }, (_unused, index) =>
      pageSlice(rows, index + 1, PER_PAGE),
    ).flat();
  }

  describe("ページをまたいで過不足が無い", () => {
    it("日付が全部同じでも、全ページを繋ぐと元の件数に戻る", () => {
      const found = queryTransactions(sameDayRows(138), NO_QUERY);

      expect(allPages(found).length).toBe(138);
    });

    it("日付が全部同じでも、同じ行が2つのページに現れない", () => {
      const found = queryTransactions(sameDayRows(138), NO_QUERY);

      expect(new Set(idsOf(allPages(found))).size).toBe(138);
    });

    it("入力の順序を変えても、各ページの中身が変わらない", () => {
      const rows = sameDayRows(138);
      const forward = idsOf(allPages(queryTransactions(rows, NO_QUERY)));
      const backward = idsOf(allPages(queryTransactions([...rows].reverse(), NO_QUERY)));

      expect(backward).toEqual(forward);
    });

    it("1件足しても、既存の行がページから消えない", () => {
      const rows = sameDayRows(138);
      const before = new Set(idsOf(allPages(queryTransactions(rows, NO_QUERY))));
      const after = new Set(
        idsOf(allPages(queryTransactions([...rows, tx({ id: "row-999", date: "2026-07-15" })], NO_QUERY))),
      );

      for (const id of before) {
        expect(after.has(id)).toBe(true);
      }
    });

    it("日付が混ざっていても過不足が無い", () => {
      const rows = Array.from({ length: 138 }, (_unused, index) =>
        tx({ id: `m-${String(index).padStart(3, "0")}`, date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}` }),
      );
      const found = queryTransactions(rows, NO_QUERY);

      expect(new Set(idsOf(allPages(found))).size).toBe(138);
    });
  });

  describe("合計が、並んでいる行と食い違わない", () => {
    const mixed = [
      ...Array.from({ length: 60 }, (_unused, index) =>
        tx({ id: `e-${index}`, amountYen: -100, category: "食費", date: "2026-07-10" }),
      ),
      ...Array.from({ length: 60 }, (_unused, index) =>
        tx({ id: `i-${index}`, amountYen: 200, category: "収入", date: "2026-07-11" }),
      ),
    ];

    it("絞り込んだ集合の合計が、全ページに並ぶ行の合計と一致する", () => {
      const found = queryTransactions(mixed, NO_QUERY);

      expect(sumAll(found)).toEqual(sumAll(allPages(found)));
    });

    it("カテゴリで絞っても一致する", () => {
      const found = queryTransactions(mixed, queryOf({ category: "食費" }));

      expect(sumAll(found)).toEqual(sumAll(allPages(found)));
      expect(sumAll(found)).toEqual({ expenseYen: 6000, incomeYen: 0 });
    });

    it("合計は1ページ分ではなく絞り込んだ全件のもの", () => {
      const found = queryTransactions(mixed, queryOf({ category: "食費" }));
      const firstPage = pageSlice(found, 1, PER_PAGE);

      expect(firstPage.length).toBeLessThan(found.length);
      expect(sumAll(found).expenseYen).toBeGreaterThan(sumAll(firstPage).expenseYen);
    });

    it("該当が無ければ合計は 0 で、ページも空", () => {
      const found = queryTransactions(mixed, queryOf({ text: "存在しない語" }));

      expect(sumAll(found)).toEqual({ expenseYen: 0, incomeYen: 0 });
      expect(allPages(found)).toEqual([]);
    });
  });
});
