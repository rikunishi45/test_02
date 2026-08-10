import { describe, it, expect } from "vitest";
import type { CategoryRecord, StoredTransaction } from "../storage/schema.js";
import { INCOME, UNCATEGORIZED, type LearnedCategories } from "./classify.js";
import {
  FIXED_CATEGORIES,
  expenseCategories,
  selectableCategories,
  moveCategory,
  recolorCategory,
  removeCategory,
  renameCategory,
  type CategoryChange,
  type CategoryResult,
  type CategoryState,
} from "./manage.js";

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

function record(name: string, order: number, color = "#112233"): CategoryRecord {
  return { name, color, order };
}

/** 食費・交通費・収入・未分類の4つ */
function stateOf(overrides: Partial<CategoryState> = {}): CategoryState {
  return {
    categories: [record("食費", 0), record("交通費", 1), record(INCOME, 2), record(UNCATEGORIZED, 3)],
    transactions: [],
    learned: {},
    ...overrides,
  };
}

function expectOk(result: CategoryResult): CategoryChange {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`成功を期待したが失敗した: ${result.message}`);
  }
  return result.change;
}

function expectFailure(result: CategoryResult): string {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`失敗を期待したが成功した: ${JSON.stringify(result.change)}`);
  }
  return result.message;
}

function namesOf(categories: readonly CategoryRecord[]): string[] {
  return categories.map((c) => c.name);
}

describe("FIXED_CATEGORIES", () => {
  it("収入と未分類が入っている", () => {
    expect([...FIXED_CATEGORIES].sort()).toEqual([INCOME, UNCATEGORIZED].sort());
  });
});

describe("renameCategory", () => {
  describe("マスタ", () => {
    it("名前が変わる", () => {
      const change = expectOk(renameCategory(stateOf(), "食費", "外食"));

      expect(namesOf(change.categories)).toEqual(["外食", "交通費", INCOME, UNCATEGORIZED]);
    });

    it("色と並び順は変わらない", () => {
      const state = stateOf({ categories: [record("食費", 3, "#aabbcc"), record(INCOME, 0)] });
      const change = expectOk(renameCategory(state, "食費", "外食"));

      expect(change.categories[0]).toEqual({ name: "外食", color: "#aabbcc", order: 3 });
    });

    it("他のカテゴリは変わらない", () => {
      const change = expectOk(renameCategory(stateOf(), "食費", "外食"));

      expect(change.categories.filter((c) => c.name !== "外食")).toEqual(
        stateOf().categories.filter((c) => c.name !== "食費"),
      );
    });

    it("件数が変わらない", () => {
      const change = expectOk(renameCategory(stateOf(), "食費", "外食"));

      expect(change.categories).toHaveLength(4);
    });

    it("前後の空白を落とす", () => {
      const change = expectOk(renameCategory(stateOf(), "食費", "  外食  "));

      expect(namesOf(change.categories)).toContain("外食");
    });
  });

  describe("取引の付け替え", () => {
    it("そのカテゴリの取引だけを新しい名前にする", () => {
      const state = stateOf({
        transactions: [
          tx({ id: "a", category: "食費" }),
          tx({ id: "b", category: "交通費" }),
          tx({ id: "c", category: "食費" }),
        ],
      });
      const change = expectOk(renameCategory(state, "食費", "外食"));

      expect(change.transactions.map((t) => [t.id, t.category])).toEqual([
        ["a", "外食"],
        ["c", "外食"],
      ]);
    });

    it("変わらない取引は返さない（書き戻す件数を増やさない）", () => {
      const state = stateOf({ transactions: [tx({ category: "交通費" })] });

      expect(expectOk(renameCategory(state, "食費", "外食")).transactions).toEqual([]);
    });

    it("取引が無くても成功する", () => {
      expect(expectOk(renameCategory(stateOf(), "食費", "外食")).transactions).toEqual([]);
    });

    it("カテゴリ以外の項目は変えない", () => {
      const original = tx({ category: "食費", memo: "昼", amountYen: -800 });
      const state = stateOf({ transactions: [original] });
      const change = expectOk(renameCategory(state, "食費", "外食"));

      expect(change.transactions[0]).toEqual({ ...original, category: "外食" });
    });

    it("元の取引を書き換えない", () => {
      const original = tx({ category: "食費" });
      const state = stateOf({ transactions: [original] });

      renameCategory(state, "食費", "外食");

      expect(original.category).toBe("食費");
    });
  });

  describe("学習の付け替え", () => {
    const learned: LearnedCategories = {
      セブン: "食費",
      タクシー: "交通費",
      ローソン: "食費",
    };

    it("そのカテゴリを指す学習を新しい名前にする", () => {
      const change = expectOk(renameCategory(stateOf({ learned }), "食費", "外食"));

      expect(change.learned).toEqual([
        { description: "セブン", category: "外食" },
        { description: "ローソン", category: "外食" },
      ]);
    });

    it("他のカテゴリを指す学習は動かさない", () => {
      const change = expectOk(renameCategory(stateOf({ learned }), "食費", "外食"));

      expect(change.learned.map((e) => e.description)).not.toContain("タクシー");
    });

    it("学習が空でも成功する", () => {
      expect(expectOk(renameCategory(stateOf(), "食費", "外食")).learned).toEqual([]);
    });

    it("名前の変更では学習を消さない", () => {
      expect(expectOk(renameCategory(stateOf({ learned }), "食費", "外食")).forget).toEqual([]);
    });

    // 学習はルールより優先される。旧名のままだと、名前を変えた直後の
    // 再分類で元に戻る。
    it("学習を付け替えないと元に戻る、という関係を固定する", () => {
      const change = expectOk(renameCategory(stateOf({ learned }), "食費", "外食"));
      const stillOld = change.learned.filter((entry) => entry.category === "食費");

      expect(stillOld).toEqual([]);
    });
  });

  describe("変えられないもの", () => {
    it.each([INCOME, UNCATEGORIZED])("%s は名前を変えられない", (fixed) => {
      expect(expectFailure(renameCategory(stateOf(), fixed, "べつの名前"))).toContain(fixed);
    });

    it("存在しないカテゴリは変えられない", () => {
      expect(expectFailure(renameCategory(stateOf(), "存在しない", "外食"))).toContain(
        "存在しません",
      );
    });
  });

  describe("新しい名前の検査", () => {
    it("空文字列は弾く", () => {
      expect(expectFailure(renameCategory(stateOf(), "食費", ""))).toBe(
        "カテゴリ名を入力してください",
      );
    });

    it.each(["   ", "\t", "　"])("空白だけ（%j）も弾く", (name) => {
      expect(expectFailure(renameCategory(stateOf(), "食費", name))).toBe(
        "カテゴリ名を入力してください",
      );
    });

    it("既にある名前は弾く（統合はしない）", () => {
      expect(expectFailure(renameCategory(stateOf(), "食費", "交通費"))).toContain("既にあります");
    });

    it.each([INCOME, UNCATEGORIZED])("%s と同じ名前にはできない", (fixed) => {
      expect(expectFailure(renameCategory(stateOf(), "食費", fixed))).toContain("既にあります");
    });

    it("空白を落とすと既存と同じになる名前も弾く", () => {
      expect(expectFailure(renameCategory(stateOf(), "食費", " 交通費 "))).toContain(
        "既にあります",
      );
    });
  });

  describe("同じ名前への変更", () => {
    it("成功するが何も変わらない", () => {
      const state = stateOf({ transactions: [tx({ category: "食費" })], learned: { A: "食費" } });
      const change = expectOk(renameCategory(state, "食費", "食費"));

      expect(change.transactions).toEqual([]);
      expect(change.learned).toEqual([]);
      expect(namesOf(change.categories)).toEqual(namesOf(state.categories));
    });

    it("空白だけの違いも「同じ」として扱う", () => {
      const change = expectOk(renameCategory(stateOf(), "食費", " 食費 "));

      expect(change.transactions).toEqual([]);
    });
  });
});

describe("removeCategory", () => {
  const state = stateOf({
    transactions: [
      tx({ id: "a", category: "食費" }),
      tx({ id: "b", category: "交通費" }),
      tx({ id: "c", category: "食費" }),
    ],
    learned: { セブン: "食費", タクシー: "交通費" },
  });

  describe("マスタから消える", () => {
    it("指定したカテゴリが消える", () => {
      const change = expectOk(removeCategory(state, "食費", "交通費"));

      expect(namesOf(change.categories)).toEqual(["交通費", INCOME, UNCATEGORIZED]);
    });

    it("消えるのは1つだけ", () => {
      expect(expectOk(removeCategory(state, "食費", "交通費")).categories).toHaveLength(3);
    });
  });

  describe("取引の付け替え", () => {
    it("消したカテゴリの取引が付け替え先になる", () => {
      const change = expectOk(removeCategory(state, "食費", "交通費"));

      expect(change.transactions.map((t) => [t.id, t.category])).toEqual([
        ["a", "交通費"],
        ["c", "交通費"],
      ]);
    });

    it("他のカテゴリの取引は動かない", () => {
      const change = expectOk(removeCategory(state, "食費", "交通費"));

      expect(change.transactions.map((t) => t.id)).not.toContain("b");
    });

    it("未分類へも付け替えられる", () => {
      const change = expectOk(removeCategory(state, "食費", UNCATEGORIZED));

      expect(change.transactions.every((t) => t.category === UNCATEGORIZED)).toBe(true);
    });

    it("取引がゼロ件のカテゴリも消せる", () => {
      const empty = stateOf({ categories: [...stateOf().categories] });

      expect(expectOk(removeCategory(empty, "食費", "交通費")).transactions).toEqual([]);
    });
  });

  describe("学習の付け替え", () => {
    it("学習も付け替え先を指すようになる", () => {
      const change = expectOk(removeCategory(state, "食費", "交通費"));

      expect(change.learned).toContainEqual({ description: "セブン", category: "交通費" });
    });

    // 取引の大半はルールで分類されていて学習を持たない。覚えさせないと、
    // 次の再分類でルールが旧名を返し、マスタに無いので未分類に落ちる。
    it("学習を持たない取引の摘要も覚えさせる", () => {
      const change = expectOk(removeCategory(state, "食費", "交通費"));

      expect(change.learned).toContainEqual({ description: "コンビニ", category: "交通費" });
    });

    // 学習はルールより優先されるので、未分類を値として持たせると
    // 「常に未分類」に固定されてルールが当たらなくなる。
    it("未分類へ付け替えるときは、覚え直さずに忘れる", () => {
      const change = expectOk(removeCategory(state, "食費", UNCATEGORIZED));

      expect(change.learned).toEqual([]);
      expect([...change.forget].sort()).toEqual(["コンビニ", "セブン"]);
    });

    it("未分類以外への付け替えでは忘れない", () => {
      expect(expectOk(removeCategory(state, "食費", "交通費")).forget).toEqual([]);
    });

    it("他のカテゴリを指す学習は忘れない", () => {
      const change = expectOk(removeCategory(state, "食費", UNCATEGORIZED));

      expect(change.forget).not.toContain("タクシー");
    });
  });

  describe("消せないもの", () => {
    it.each([INCOME, UNCATEGORIZED])("%s は消せない", (fixed) => {
      expect(expectFailure(removeCategory(state, fixed, "食費"))).toContain(fixed);
    });

    it("存在しないカテゴリは消せない", () => {
      expect(expectFailure(removeCategory(state, "存在しない", "食費"))).toContain("存在しません");
    });
  });

  describe("付け替え先の検査", () => {
    it("自分自身は指定できない", () => {
      expect(expectFailure(removeCategory(state, "食費", "食費"))).toContain("別のカテゴリ");
    });

    it("存在しない付け替え先は弾く", () => {
      expect(expectFailure(removeCategory(state, "食費", "存在しない"))).toContain("存在しません");
    });

    it("空文字列の付け替え先は弾く", () => {
      expect(expectFailure(removeCategory(state, "食費", ""))).toContain("存在しません");
    });

    it("収入へも付け替えられる（消せないだけで、行き先にはなれる）", () => {
      expect(removeCategory(state, "食費", INCOME).ok).toBe(true);
    });
  });

  it("消したあとのマスタに、付け替え先が残っている", () => {
    const change = expectOk(removeCategory(state, "食費", "交通費"));

    expect(namesOf(change.categories)).toContain("交通費");
  });

  it("取引が指すカテゴリが、必ずマスタに残っている", () => {
    const change = expectOk(removeCategory(state, "食費", "交通費"));
    const remaining = new Set(namesOf(change.categories));

    for (const transaction of change.transactions) {
      expect(remaining.has(transaction.category)).toBe(true);
    }
  });
});

describe("recolorCategory", () => {
  const categories = stateOf().categories;

  it("指定したカテゴリの色が変わる", () => {
    const change = expectOk(recolorCategory(categories, "食費", "#ff0000"));

    expect(change.categories.find((c) => c.name === "食費")?.color).toBe("#ff0000");
  });

  it("他のカテゴリの色は変わらない", () => {
    const change = expectOk(recolorCategory(categories, "食費", "#ff0000"));

    expect(change.categories.find((c) => c.name === "交通費")?.color).toBe("#112233");
  });

  it("名前と並び順は変わらない", () => {
    const change = expectOk(recolorCategory(categories, "食費", "#ff0000"));

    expect(namesOf(change.categories)).toEqual(namesOf(categories));
    expect(change.categories.map((c) => c.order)).toEqual(categories.map((c) => c.order));
  });

  it("取引にも学習にも触らない", () => {
    const change = expectOk(recolorCategory(categories, "食費", "#ff0000"));

    expect(change.transactions).toEqual([]);
    expect(change.learned).toEqual([]);
    expect(change.forget).toEqual([]);
  });

  it.each([INCOME, UNCATEGORIZED])("%s の色は変えられる（名前と違って固定しない）", (fixed) => {
    expect(recolorCategory(categories, fixed, "#ff0000").ok).toBe(true);
  });

  describe("色の形式", () => {
    it.each(["#ff0000", "#FF0000", "#000000", "#ffffff", "#1a2B3c"])("%s は通る", (color) => {
      expect(recolorCategory(categories, "食費", color).ok).toBe(true);
    });

    it.each([
      "ff0000",
      "#fff",
      "#ff00000",
      "#gggggg",
      "",
      "red",
      "#ff 000",
      // 先頭に何か付いた形。^ が無いと末尾だけ見て通ってしまう
      "x#ff0000",
      " #ff0000",
      "##ff0000",
      "color:#ff0000",
    ])("%j は弾く", (color) => {
      expect(expectFailure(recolorCategory(categories, "食費", color))).toContain("#rrggbb");
    });
  });

  it("存在しないカテゴリは弾く", () => {
    expect(expectFailure(recolorCategory(categories, "存在しない", "#ff0000"))).toContain(
      "存在しません",
    );
  });

  it("元のマスタを書き換えない", () => {
    const input = [record("食費", 0, "#112233")];

    recolorCategory(input, "食費", "#ff0000");

    expect(input[0]?.color).toBe("#112233");
  });
});

describe("moveCategory", () => {
  const categories = [record("A", 0), record("B", 1), record("C", 2)];

  describe("動かす", () => {
    it("上に1つ動く", () => {
      const change = expectOk(moveCategory(categories, "B", -1));

      expect(namesOf(change.categories)).toEqual(["B", "A", "C"]);
    });

    it("下に1つ動く", () => {
      const change = expectOk(moveCategory(categories, "B", 1));

      expect(namesOf(change.categories)).toEqual(["A", "C", "B"]);
    });

    it("動かしたあと order が 0 から振り直される", () => {
      const change = expectOk(moveCategory(categories, "C", -1));

      expect(change.categories.map((c) => [c.name, c.order])).toEqual([
        ["A", 0],
        ["C", 1],
        ["B", 2],
      ]);
    });

    it("2回動かすと2つ分動く", () => {
      const once = expectOk(moveCategory(categories, "C", -1)).categories;
      const twice = expectOk(moveCategory(once, "C", -1)).categories;

      expect(namesOf(twice)).toEqual(["C", "A", "B"]);
    });

    it("上に動かしてから下に動かすと元に戻る", () => {
      const up = expectOk(moveCategory(categories, "B", -1)).categories;
      const back = expectOk(moveCategory(up, "B", 1)).categories;

      expect(namesOf(back)).toEqual(["A", "B", "C"]);
    });
  });

  describe("端では動かない", () => {
    it("先頭を上に動かしても変わらない", () => {
      expect(namesOf(expectOk(moveCategory(categories, "A", -1)).categories)).toEqual([
        "A",
        "B",
        "C",
      ]);
    });

    it("末尾を下に動かしても変わらない", () => {
      expect(namesOf(expectOk(moveCategory(categories, "C", 1)).categories)).toEqual([
        "A",
        "B",
        "C",
      ]);
    });

    it("端で動かしても失敗にはしない", () => {
      expect(moveCategory(categories, "A", -1).ok).toBe(true);
    });

    // 端では「何も起きない」。order の振り直しも起きない——飛び番のまま
    // 返ることで、動かしていないことが結果からも読める。
    it("末尾を下に動かしても order が振り直されない", () => {
      const gapped = [record("A", 7), record("B", 9), record("C", 20)];

      expect(expectOk(moveCategory(gapped, "C", 1)).categories).toEqual(gapped);
    });

    it("先頭を上に動かしても order が振り直されない", () => {
      const gapped = [record("A", 7), record("B", 9), record("C", 20)];

      expect(expectOk(moveCategory(gapped, "A", -1)).categories).toEqual(gapped);
    });

    it("1件だけならどちらにも動かない", () => {
      const single = [record("A", 0)];

      expect(namesOf(expectOk(moveCategory(single, "A", -1)).categories)).toEqual(["A"]);
      expect(namesOf(expectOk(moveCategory(single, "A", 1)).categories)).toEqual(["A"]);
    });
  });

  describe("order が乱れていても並べ直せる", () => {
    it("飛び番があっても見えている順で動く", () => {
      const gapped = [record("A", 0), record("B", 5), record("C", 100)];
      const change = expectOk(moveCategory(gapped, "C", -1));

      expect(change.categories.map((c) => [c.name, c.order])).toEqual([
        ["A", 0],
        ["C", 1],
        ["B", 2],
      ]);
    });

    it("同じ order は名前の昇順で決着してから動く", () => {
      const tied = [record("B", 0), record("A", 0), record("C", 0)];
      const change = expectOk(moveCategory(tied, "C", -1));

      expect(namesOf(change.categories)).toEqual(["A", "C", "B"]);
    });

    it("動かしたあとの order に重複も飛びも無い", () => {
      const gapped = [record("A", 7), record("B", 7), record("C", 2)];
      const orders = expectOk(moveCategory(gapped, "A", 1)).categories.map((c) => c.order);

      expect(orders).toEqual([0, 1, 2]);
    });

    it("入力の並び順に依存しない", () => {
      const forward = [record("A", 0), record("B", 1), record("C", 2)];
      const backward = [record("C", 2), record("B", 1), record("A", 0)];

      expect(namesOf(expectOk(moveCategory(backward, "B", -1)).categories)).toEqual(
        namesOf(expectOk(moveCategory(forward, "B", -1)).categories),
      );
    });
  });

  it("取引にも学習にも触らない", () => {
    const change = expectOk(moveCategory(categories, "B", -1));

    expect(change.transactions).toEqual([]);
    expect(change.learned).toEqual([]);
    expect(change.forget).toEqual([]);
  });

  it("件数が変わらない", () => {
    expect(expectOk(moveCategory(categories, "B", -1)).categories).toHaveLength(3);
  });

  it("色は変わらない", () => {
    const colored = [record("A", 0, "#aaaaaa"), record("B", 1, "#bbbbbb")];
    const change = expectOk(moveCategory(colored, "B", -1));

    expect(change.categories.find((c) => c.name === "B")?.color).toBe("#bbbbbb");
  });

  it("存在しないカテゴリは弾く", () => {
    expect(expectFailure(moveCategory(categories, "存在しない", -1))).toContain("存在しません");
  });

  it("元のマスタを書き換えない", () => {
    const input = [record("A", 0), record("B", 1)];

    moveCategory(input, "B", -1);

    expect(namesOf(input)).toEqual(["A", "B"]);
  });
});

describe("expenseCategories", () => {
  const names = ["食費", "交通費", INCOME, UNCATEGORIZED];

  it("収入を除く", () => {
    expect(expenseCategories(names)).not.toContain(INCOME);
  });

  it("未分類は残す（学習を消す経路として要る）", () => {
    expect(expenseCategories(names)).toContain(UNCATEGORIZED);
  });

  it("それ以外はすべて残る", () => {
    expect(expenseCategories(names)).toEqual(["食費", "交通費", UNCATEGORIZED]);
  });

  it("並び順を変えない", () => {
    expect(expenseCategories(["交通費", "食費"])).toEqual(["交通費", "食費"]);
  });

  it("空の配列は空を返す", () => {
    expect(expenseCategories([])).toEqual([]);
  });

  it("収入が無くても落ちない", () => {
    expect(expenseCategories(["食費"])).toEqual(["食費"]);
  });

  it("元の配列を書き換えない", () => {
    const input = [...names];

    expenseCategories(input);

    expect(input).toEqual(names);
  });
});

describe("selectableCategories", () => {
  const names = ["食費", "交通費", INCOME, UNCATEGORIZED];

  it("収入と未分類の両方を除く", () => {
    expect(selectableCategories(names)).toEqual(["食費", "交通費"]);
  });

  it.each([INCOME, UNCATEGORIZED])("%s を含まない", (fixed) => {
    expect(selectableCategories(names)).not.toContain(fixed);
  });

  it("expenseCategories より狭い（未分類のぶん）", () => {
    expect(selectableCategories(names).length).toBeLessThan(expenseCategories(names).length);
  });

  it("並び順を変えない", () => {
    expect(selectableCategories(["交通費", "食費", INCOME])).toEqual(["交通費", "食費"]);
  });

  it("空の配列は空を返す", () => {
    expect(selectableCategories([])).toEqual([]);
  });

  it("固定カテゴリしか無ければ空になる", () => {
    expect(selectableCategories([INCOME, UNCATEGORIZED])).toEqual([]);
  });
});

/**
 * 実データで踏んだ不具合の再現。娯楽6件を趣味に変えたら趣味が0件になり、
 * 未分類が6件増えた。ルールで分類された取引は学習を持たないので、マスタの
 * 名前を変えただけでは次の再分類で旧名に戻り、旧名はマスタに無いので落ちる。
 */
describe("ルールで分類された取引の付け替え", () => {
  const ruleClassified = stateOf({
    transactions: [
      tx({ id: "a", category: "食費", description: "セブン－イレブン" }),
      tx({ id: "b", category: "食費", description: "ゆめタウン" }),
    ],
    learned: {},
  });

  it("名前を変えると、動かす取引の摘要が学習に載る", () => {
    const change = expectOk(renameCategory(ruleClassified, "食費", "外食"));

    expect([...change.learned].sort((x, y) => x.description.localeCompare(y.description))).toEqual([
      { description: "セブン－イレブン", category: "外食" },
      { description: "ゆめタウン", category: "外食" },
    ]);
  });

  it("削除して付け替えるときも学習に載る", () => {
    const change = expectOk(removeCategory(ruleClassified, "食費", "交通費"));

    expect(change.learned.map((e) => e.category)).toEqual(["交通費", "交通費"]);
  });

  it("同じ摘要が複数件あっても、学習は1件にまとまる", () => {
    const duplicated = stateOf({
      transactions: [
        tx({ id: "a", category: "食費", description: "セブン" }),
        tx({ id: "b", category: "食費", description: "セブン" }),
      ],
    });
    const change = expectOk(renameCategory(duplicated, "食費", "外食"));

    expect(change.learned).toEqual([{ description: "セブン", category: "外食" }]);
  });

  it("既存の学習と取引の摘要が重なっても二重にならない", () => {
    const overlapping = stateOf({
      transactions: [tx({ id: "a", category: "食費", description: "セブン" })],
      learned: { セブン: "食費" },
    });
    const change = expectOk(renameCategory(overlapping, "食費", "外食"));

    expect(change.learned).toEqual([{ description: "セブン", category: "外食" }]);
  });

  it("動かさないカテゴリの取引は覚えさせない", () => {
    const mixed = stateOf({
      transactions: [
        tx({ id: "a", category: "食費", description: "セブン" }),
        tx({ id: "b", category: "交通費", description: "タクシー" }),
      ],
    });
    const change = expectOk(renameCategory(mixed, "食費", "外食"));

    expect(change.learned.map((e) => e.description)).toEqual(["セブン"]);
  });

  // 収入と0円は符号で決まり、学習を見ない（categoryFor）。覚えさせても効かない。
  it("収入の取引は覚えさせない", () => {
    const withIncome = stateOf({
      transactions: [tx({ id: "a", category: "食費", description: "給与", amountYen: 250000 })],
    });

    expect(expectOk(renameCategory(withIncome, "食費", "外食")).learned).toEqual([]);
  });

  it("0円の取引は覚えさせない", () => {
    const withZero = stateOf({
      transactions: [tx({ id: "a", category: "食費", description: "ゼロ", amountYen: 0 })],
    });

    expect(expectOk(renameCategory(withZero, "食費", "外食")).learned).toEqual([]);
  });

  it("付け替えた取引すべてに、新しい名前を指す学習がある", () => {
    const change = expectOk(renameCategory(ruleClassified, "食費", "外食"));
    const pinned = new Map(change.learned.map((e) => [e.description, e.category]));

    for (const transaction of change.transactions) {
      expect(pinned.get(transaction.description)).toBe(transaction.category);
    }
  });
});
