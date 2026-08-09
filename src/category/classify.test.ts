import { describe, it, expect } from "vitest";
import {
  classifyDescription,
  categoryFor,
  isCategorizable,
  INCOME,
  UNCATEGORIZED,
  type CategoryRule,
  type LearnedCategories,
} from "./classify.js";

/**
 * `{ __proto__: "…" }` のリテラルはプロトタイプ設定になり自分自身のキーにならない。
 * 汚染系のキーを「自分自身のキー」として持つ learned を確実に作るためのヘルパー。
 */
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
  return result;
}

/** `__proto__` を自分自身のキーに持つオブジェクトでも安全に中身を比較する */
function entriesOf(target: LearnedCategories): [string, string][] {
  return Object.entries(target).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function ruleOf(pattern: string, category: string): CategoryRule {
  return { pattern, category };
}

/** 入力を書き換えたら即座に落ちるよう、配列と各要素を凍結して渡す */
function frozenRules(rules: readonly CategoryRule[]): readonly CategoryRule[] {
  return Object.freeze(rules.map((rule) => Object.freeze({ ...rule })));
}

const NO_RULES: readonly CategoryRule[] = Object.freeze([]);
const NO_LEARNED: LearnedCategories = Object.freeze(learnedOf([]));

describe("UNCATEGORIZED", () => {
  it('未分類カテゴリは "未分類" である', () => {
    expect(UNCATEGORIZED).toBe("未分類");
  });
});

describe("classifyDescription", () => {
  describe("3. どれにも当たらないとき、未分類を返す", () => {
    it("ルールも学習も空のとき、未分類", () => {
      expect(classifyDescription("セブンイレブン渋谷店", NO_RULES, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });

    it("ルールはあるが、どの pattern も含まれないとき、未分類", () => {
      const rules = frozenRules([
        ruleOf("amazon", "買い物"),
        ruleOf("ローソン", "食費"),
      ]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });

    it("学習はあるが、別の description のものしか無いとき、未分類", () => {
      const learned = learnedOf([["ローソン", "食費"]]);
      expect(classifyDescription("セブンイレブン渋谷店", NO_RULES, learned)).toBe(
        UNCATEGORIZED,
      );
    });

    it("description が空文字列で、非空 pattern のルールしか無いとき、未分類", () => {
      const rules = frozenRules([ruleOf("amazon", "買い物")]);
      expect(classifyDescription("", rules, NO_LEARNED)).toBe(UNCATEGORIZED);
    });

    it("description が空文字列で、ルールも学習も空のとき、未分類", () => {
      expect(classifyDescription("", NO_RULES, NO_LEARNED)).toBe(UNCATEGORIZED);
    });
  });

  describe("2. ルールの部分一致（当たる／当たらない の対）", () => {
    const rules = frozenRules([ruleOf("セブンイレブン", "食費")]);

    it("pattern が description に含まれるとき、そのカテゴリを返す", () => {
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("pattern が description に含まれないとき、未分類", () => {
      expect(classifyDescription("ファミリーマート渋谷店", rules, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });

    it("description が pattern と完全一致するときも、当たる", () => {
      expect(classifyDescription("セブンイレブン", rules, NO_LEARNED)).toBe("食費");
    });

    it("pattern が description の先頭にあるとき、当たる", () => {
      expect(classifyDescription("セブンイレブン渋谷", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("pattern が description の末尾にあるとき、当たる", () => {
      expect(classifyDescription("渋谷セブンイレブン", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("pattern が description の中間にあるとき、当たる", () => {
      expect(classifyDescription("渋谷セブンイレブン店", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("description のほうが pattern より短いとき（包含が逆向き）、当たらない", () => {
      expect(classifyDescription("セブン", rules, NO_LEARNED)).toBe(UNCATEGORIZED);
    });

    it("1文字だけ違うとき、当たらない", () => {
      expect(classifyDescription("セブンイレブソ渋谷店", rules, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });
  });

  describe("2. 大文字小文字を区別しない", () => {
    it("pattern が大文字・description が小文字のとき、当たる", () => {
      const rules = frozenRules([ruleOf("AMAZON", "買い物")]);
      expect(classifyDescription("amazon.co.jp", rules, NO_LEARNED)).toBe("買い物");
    });

    it("pattern が小文字・description が大文字のとき、当たる", () => {
      const rules = frozenRules([ruleOf("amazon", "買い物")]);
      expect(classifyDescription("AMAZON.CO.JP", rules, NO_LEARNED)).toBe("買い物");
    });

    it("pattern が大文字・description が混在のとき、当たる（仕様の例）", () => {
      const rules = frozenRules([ruleOf("AMAZON", "買い物")]);
      expect(classifyDescription("Amazon.co.jp", rules, NO_LEARNED)).toBe("買い物");
    });

    it("pattern も description も混在で、綴りだけ同じとき、当たる", () => {
      const rules = frozenRules([ruleOf("AmAzOn", "買い物")]);
      expect(classifyDescription("決済 aMaZoN 3000円", rules, NO_LEARNED)).toBe(
        "買い物",
      );
    });

    it("大文字小文字を無視しても綴りが違うときは、当たらない", () => {
      const rules = frozenRules([ruleOf("AMAZON", "買い物")]);
      expect(classifyDescription("amazom.co.jp", rules, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });
  });

  describe("2. 複数のルールが当たるとき、先頭のルールが勝つ", () => {
    const foodFirst = frozenRules([
      ruleOf("セブン", "食費"),
      ruleOf("イレブン", "雑費"),
    ]);
    const miscFirst = frozenRules([
      ruleOf("イレブン", "雑費"),
      ruleOf("セブン", "食費"),
    ]);

    it("2つとも当たる入力で、1つ目のカテゴリを返す", () => {
      expect(classifyDescription("セブンイレブン渋谷店", foodFirst, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("順序を入れ替えると結果も入れ替わる（先頭優先であって偶然ではない）", () => {
      expect(classifyDescription("セブンイレブン渋谷店", miscFirst, NO_LEARNED)).toBe(
        "雑費",
      );
    });

    it("1つ目が当たらず2つ目と3つ目が当たるとき、2つ目のカテゴリを返す", () => {
      const rules = frozenRules([
        ruleOf("ローソン", "コンビニ"),
        ruleOf("セブン", "食費"),
        ruleOf("イレブン", "雑費"),
      ]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("最後のルールだけが当たるとき、そのカテゴリを返す（全件走査する）", () => {
      const rules = frozenRules([
        ruleOf("ローソン", "コンビニ"),
        ruleOf("amazon", "買い物"),
        ruleOf("セブン", "食費"),
      ]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("同じ pattern が別カテゴリで2回現れるとき、先頭のカテゴリを返す", () => {
      const rules = frozenRules([
        ruleOf("セブン", "食費"),
        ruleOf("セブン", "雑費"),
      ]);
      expect(classifyDescription("セブンイレブン", rules, NO_LEARNED)).toBe("食費");
    });

    it("先頭一致の判定は大文字小文字を無視した後の順序で決まる", () => {
      const rules = frozenRules([
        ruleOf("AMAZON", "買い物"),
        ruleOf("amazon.co.jp", "書籍"),
      ]);
      expect(classifyDescription("Amazon.co.jp", rules, NO_LEARNED)).toBe("買い物");
    });
  });

  describe("2. 空文字列の pattern は決してマッチしない", () => {
    it("空 pattern のルールだけのとき、未分類", () => {
      const rules = frozenRules([ruleOf("", "空パターン")]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });

    it("description も空文字列のとき、空 pattern はマッチしない", () => {
      const rules = frozenRules([ruleOf("", "空パターン")]);
      expect(classifyDescription("", rules, NO_LEARNED)).toBe(UNCATEGORIZED);
    });

    it("空 pattern の後ろに当たるルールがあるとき、後ろのカテゴリを返す", () => {
      const rules = frozenRules([
        ruleOf("", "空パターン"),
        ruleOf("amazon", "買い物"),
      ]);
      expect(classifyDescription("Amazon.co.jp", rules, NO_LEARNED)).toBe("買い物");
    });

    it("空 pattern が複数並んでいても、後ろの当たるルールに到達する", () => {
      const rules = frozenRules([
        ruleOf("", "空1"),
        ruleOf("", "空2"),
        ruleOf("セブン", "食費"),
      ]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("空 pattern が当たるルールの後ろにあっても、前のルールが勝つ", () => {
      const rules = frozenRules([
        ruleOf("セブン", "食費"),
        ruleOf("", "空パターン"),
      ]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("空 pattern を挟んだ2つの当たるルールでは、前のほうが勝つ", () => {
      const rules = frozenRules([
        ruleOf("セブン", "食費"),
        ruleOf("", "空パターン"),
        ruleOf("イレブン", "雑費"),
      ]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("空 pattern と空 description の組でも、学習があればそちらが返る（空パターン経由ではない）", () => {
      const rules = frozenRules([ruleOf("", "空パターン")]);
      const learned = learnedOf([["", "手入力"]]);
      expect(classifyDescription("", rules, learned)).toBe("手入力");
    });

    it.each([
      ["半角空白", " "],
      ["全角空白 U+3000", "　"],
      ["タブ", "\t"],
      ["空白の連続", "   "],
    ])("空白だけの pattern (%s) はマッチしない", (_name, pattern) => {
      const rules = frozenRules([ruleOf(pattern, "空白")]);
      // 空パターンを弾く理由がそのまま当てはまる。実データの摘要は
      // `楽天ＳＰ　楽天ペイ…` のように区切りを持ち、正規化後は必ず空白を含む。
      // 空白1本のルールが紛れ込むと全件がそのカテゴリになる。
      expect(classifyDescription("セブン 渋谷店", rules, NO_LEARNED)).toBe(UNCATEGORIZED);
      expect(classifyDescription("セブン渋谷店", rules, NO_LEARNED)).toBe(UNCATEGORIZED);
    });
  });

  describe("1. 学習が当たるとき、そのカテゴリを返す", () => {
    it("ルールが空でも、学習だけで分類できる", () => {
      const learned = learnedOf([["セブンイレブン渋谷店", "食費"]]);
      expect(classifyDescription("セブンイレブン渋谷店", NO_RULES, learned)).toBe(
        "食費",
      );
    });

    it("複数の学習があっても、description に対応するものを返す", () => {
      const learned = learnedOf([
        ["ローソン", "コンビニ"],
        ["セブンイレブン渋谷店", "食費"],
        ["Amazon.co.jp", "書籍"],
      ]);
      expect(classifyDescription("Amazon.co.jp", NO_RULES, learned)).toBe("書籍");
    });

    it("description が空文字列でも、空文字列キーの学習が当たる", () => {
      const learned = learnedOf([["", "手入力"]]);
      expect(classifyDescription("", NO_RULES, learned)).toBe("手入力");
    });

    it("学習されたカテゴリが空文字列でも、そのまま返す", () => {
      const learned = learnedOf([["セブンイレブン渋谷店", ""]]);
      expect(classifyDescription("セブンイレブン渋谷店", NO_RULES, learned)).toBe("");
    });
  });

  describe("1. 学習とルールが両方当たるとき、学習が勝つ", () => {
    const rules = frozenRules([ruleOf("amazon", "買い物")]);

    it("学習があるとき、学習側のカテゴリを返す", () => {
      const learned = learnedOf([["Amazon.co.jp", "書籍"]]);
      expect(classifyDescription("Amazon.co.jp", rules, learned)).toBe("書籍");
    });

    it("同じルールで学習が無いときは、ルール側のカテゴリを返す（対）", () => {
      expect(classifyDescription("Amazon.co.jp", rules, NO_LEARNED)).toBe("買い物");
    });

    it("学習が先頭ルールより優先される（ルールが複数当たる場合でも）", () => {
      const manyRules = frozenRules([
        ruleOf("セブン", "食費"),
        ruleOf("イレブン", "雑費"),
      ]);
      const learned = learnedOf([["セブンイレブン渋谷店", "交際費"]]);
      expect(classifyDescription("セブンイレブン渋谷店", manyRules, learned)).toBe(
        "交際費",
      );
    });

    it("学習カテゴリが未分類でも、その値がそのまま返る（ルールに落ちない）", () => {
      const learned = learnedOf([["Amazon.co.jp", UNCATEGORIZED]]);
      expect(classifyDescription("Amazon.co.jp", rules, learned)).toBe(UNCATEGORIZED);
    });
  });

  describe("1. 学習キーは完全一致でなければ効かない", () => {
    it("学習キーが description の前方部分でしかないとき、効かない", () => {
      const learned = learnedOf([["セブンイレブン", "食費"]]);
      expect(classifyDescription("セブンイレブン渋谷店", NO_RULES, learned)).toBe(
        UNCATEGORIZED,
      );
    });

    it("学習キーが description を含んでいる（逆向きの包含）とき、効かない", () => {
      const learned = learnedOf([["セブンイレブン渋谷店", "食費"]]);
      expect(classifyDescription("セブンイレブン", NO_RULES, learned)).toBe(
        UNCATEGORIZED,
      );
    });

    it("末尾に空白が付いただけでも、効かない", () => {
      const learned = learnedOf([["セブンイレブン", "食費"]]);
      expect(classifyDescription("セブンイレブン ", NO_RULES, learned)).toBe(
        UNCATEGORIZED,
      );
    });

    it("完全一致するとき（上の各ケースとの対）、効く", () => {
      const learned = learnedOf([["セブンイレブン", "食費"]]);
      expect(classifyDescription("セブンイレブン", NO_RULES, learned)).toBe("食費");
    });

    it("部分一致でしかない学習は、ルールの判定を妨げない", () => {
      const rules = frozenRules([ruleOf("セブン", "コンビニ")]);
      const learned = learnedOf([["セブンイレブン", "食費"]]);
      expect(classifyDescription("セブンイレブン渋谷店", rules, learned)).toBe(
        "コンビニ",
      );
    });
  });

  describe("プロトタイプ汚染：自分自身のキーでなければ学習は無いものとして扱う", () => {
    const pollutedNames = [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
    ];

    for (const name of pollutedNames) {
      it(`description が "${name}" で learned が空のとき、未分類（文字列）を返す`, () => {
        const result = classifyDescription(name, NO_RULES, NO_LEARNED);
        expect(typeof result).toBe("string");
        expect(result).toBe(UNCATEGORIZED);
      });

      it(`description が "${name}" でも、learned に無関係なキーがあるだけなら未分類`, () => {
        const learned = learnedOf([["ローソン", "コンビニ"]]);
        const result = classifyDescription(name, NO_RULES, learned);
        expect(typeof result).toBe("string");
        expect(result).toBe(UNCATEGORIZED);
      });
    }

    it('description が "constructor" のとき、ルールがあればルールが適用される', () => {
      const rules = frozenRules([ruleOf("CONSTRUCT", "工事")]);
      expect(classifyDescription("constructor", rules, NO_LEARNED)).toBe("工事");
    });

    it('description が "toString" のとき、ルールがあればルールが適用される', () => {
      const rules = frozenRules([ruleOf("tostring", "文字列")]);
      expect(classifyDescription("toString", rules, NO_LEARNED)).toBe("文字列");
    });

    it('description が "__proto__" のとき、ルールがあればルールが適用される', () => {
      const rules = frozenRules([ruleOf("proto", "プロト")]);
      expect(classifyDescription("__proto__", rules, NO_LEARNED)).toBe("プロト");
    });

    for (const name of ["constructor", "toString", "__proto__"]) {
      it(`"${name}" が learned の自分自身のキーであれば、そのカテゴリが返る（対）`, () => {
        const learned = learnedOf([[name, "食費"]]);
        expect(classifyDescription(name, NO_RULES, learned)).toBe("食費");
      });

      it(`"${name}" が learned の自分自身のキーのとき、ルールより優先される`, () => {
        const rules = frozenRules([ruleOf("o", "その他")]);
        const learned = learnedOf([[name, "食費"]]);
        expect(classifyDescription(name, rules, learned)).toBe("食費");
      });
    }
  });

  describe("純粋関数であること", () => {
    it("rules と learned を書き換えない", () => {
      const rules: CategoryRule[] = [
        ruleOf("", "空パターン"),
        ruleOf("セブン", "食費"),
        ruleOf("イレブン", "雑費"),
      ];
      const learned = learnedOf([
        ["ローソン", "コンビニ"],
        ["Amazon.co.jp", "書籍"],
      ]);
      const rulesSnapshot = rules.map((rule) => ({ ...rule }));
      const learnedSnapshot = entriesOf(learned);

      classifyDescription("セブンイレブン渋谷店", rules, learned);

      expect(rules).toEqual(rulesSnapshot);
      expect(entriesOf(learned)).toEqual(learnedSnapshot);
    });

    it("凍結された rules / learned を渡しても、書き換えを試みない", () => {
      const rules = frozenRules([ruleOf("セブン", "食費"), ruleOf("", "空")]);
      const learned = Object.freeze(learnedOf([["ローソン", "コンビニ"]]));
      expect(() =>
        classifyDescription("セブンイレブン渋谷店", rules, learned),
      ).not.toThrow();
    });

    it("同じ入力で2回呼ぶと、同じ結果になる", () => {
      const rules = frozenRules([
        ruleOf("", "空"),
        ruleOf("セブン", "食費"),
        ruleOf("イレブン", "雑費"),
      ]);
      const learned = Object.freeze(learnedOf([["Amazon.co.jp", "書籍"]]));

      expect(classifyDescription("セブンイレブン渋谷店", rules, learned)).toBe("食費");
      expect(classifyDescription("セブンイレブン渋谷店", rules, learned)).toBe("食費");
      expect(classifyDescription("Amazon.co.jp", rules, learned)).toBe("書籍");
      expect(classifyDescription("Amazon.co.jp", rules, learned)).toBe("書籍");
    });

    it("直前の呼び出しの結果が、次の呼び出しに影響しない", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = Object.freeze(learnedOf([["Amazon.co.jp", "書籍"]]));

      expect(classifyDescription("Amazon.co.jp", rules, learned)).toBe("書籍");
      expect(classifyDescription("ローソン渋谷店", rules, learned)).toBe(
        UNCATEGORIZED,
      );
      expect(classifyDescription("セブンイレブン", rules, learned)).toBe("食費");
    });
  });
});

/** categoryFor / isCategorizable に渡す最小の取引。書き換えを試みたら落ちるよう凍結する */
function txOf(
  description: string,
  amountYen: number,
): Readonly<{ description: string; amountYen: number }> {
  return Object.freeze({ description, amountYen });
}

describe("INCOME", () => {
  it('収入カテゴリは "収入" である', () => {
    expect(INCOME).toBe("収入");
  });

  it("収入カテゴリと未分類カテゴリは別の値である", () => {
    expect(INCOME).not.toBe(UNCATEGORIZED);
  });
});

describe("isCategorizable", () => {
  describe("支出（負）だけが編集できる", () => {
    it.each<[string, number]>([
      ["典型的な支出", -1000],
      ["境界（最小の支出）", -1],
      ["大きな支出", -1234567],
    ])("金額が負のとき true（%s）", (_name, amountYen) => {
      expect(isCategorizable({ amountYen })).toBe(true);
    });

    it.each<[string, number]>([
      ["典型的な収入", 250000],
      ["境界（最小の収入）", 1],
      ["大きな収入", 1234567],
    ])("金額が正のとき false（%s）", (_name, amountYen) => {
      expect(isCategorizable({ amountYen })).toBe(false);
    });

    it("金額が 0 のとき false", () => {
      expect(isCategorizable({ amountYen: 0 })).toBe(false);
    });

    it("金額が -0 のとき false（-0 < 0 は偽なので支出として扱わない）", () => {
      const amountYen = -0;
      // フィクスチャが本当に -0 であることを先に固定する（+0 に潰れていたら意味が無い）
      expect(Object.is(amountYen, -0)).toBe(true);

      expect(isCategorizable({ amountYen })).toBe(false);
    });

    it("-1 と 1 で結果が反転する（符号が判定軸である）", () => {
      expect(isCategorizable({ amountYen: -1 })).toBe(true);
      expect(isCategorizable({ amountYen: 1 })).toBe(false);
    });

    it("0 をまたぐ -1 / 0 / 1 で、true になるのは -1 だけ", () => {
      expect([-1, 0, 1].map((amountYen) => isCategorizable({ amountYen }))).toEqual([
        true,
        false,
        false,
      ]);
    });

    it("boolean を返す（truthy な別の値ではない）", () => {
      expect(typeof isCategorizable({ amountYen: -1000 })).toBe("boolean");
      expect(typeof isCategorizable({ amountYen: 1000 })).toBe("boolean");
    });
  });
});

describe("categoryFor", () => {
  describe("収入（正）は分類しない", () => {
    it("ルールも学習も無いとき、収入カテゴリを返す", () => {
      expect(categoryFor(txOf("給与振込", 250000), NO_RULES, NO_LEARNED)).toBe(
        INCOME,
      );
    });

    it("摘要がルールに当たっても、収入カテゴリを返す", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      expect(categoryFor(txOf("セブンイレブン", 1000), rules, NO_LEARNED)).toBe(
        INCOME,
      );
    });

    it("学習に完全一致のエントリがあっても、収入カテゴリを返す", () => {
      const learned = learnedOf([["セブンイレブン", "食費"]]);
      expect(categoryFor(txOf("セブンイレブン", 1000), NO_RULES, learned)).toBe(
        INCOME,
      );
    });

    it("学習とルールが両方当たっても、収入カテゴリを返す", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = learnedOf([["セブンイレブン", "交際費"]]);
      expect(categoryFor(txOf("セブンイレブン", 1000), rules, learned)).toBe(INCOME);
    });

    it("金額が 1 円（境界）でも、収入カテゴリを返す", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      expect(categoryFor(txOf("セブンイレブン", 1), rules, NO_LEARNED)).toBe(INCOME);
    });

    it.each([
      ["ルールに当たる摘要", "セブンイレブン渋谷店"],
      ["学習に完全一致する摘要", "Amazon.co.jp"],
      ["空文字列の摘要", ""],
      ["どれにも当たらない摘要", "架空商店ＸＹＺ９９"],
      ["プロトタイプ由来のキー名", "constructor"],
      ["プロトタイプ由来のキー名", "__proto__"],
      ["プロトタイプ由来のキー名", "toString"],
    ])("金額が正なら、摘要を変えても収入カテゴリのまま（%s）", (_name, description) => {
      const rules = frozenRules([ruleOf("セブン", "食費"), ruleOf("", "空パターン")]);
      const learned = learnedOf([
        ["Amazon.co.jp", "書籍"],
        ["", "手入力"],
        ["constructor", "工事"],
        ["__proto__", "プロト"],
        ["toString", "文字列"],
      ]);

      const result = categoryFor(txOf(description, 1000), rules, learned);

      expect(typeof result).toBe("string");
      expect(result).toBe(INCOME);
    });
  });

  describe("0 円は収入にも支出にも寄せない", () => {
    it("ルールも学習も無いとき、未分類", () => {
      expect(categoryFor(txOf("給与調整", 0), NO_RULES, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });

    it("摘要がルールに当たっても、未分類", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      expect(categoryFor(txOf("セブンイレブン", 0), rules, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });

    it("学習に完全一致のエントリがあっても、未分類", () => {
      const learned = learnedOf([["セブンイレブン", "食費"]]);
      expect(categoryFor(txOf("セブンイレブン", 0), NO_RULES, learned)).toBe(
        UNCATEGORIZED,
      );
    });

    it("-0 でも未分類（収入にも支出にも寄らない）", () => {
      const amountYen = -0;
      expect(Object.is(amountYen, -0)).toBe(true);

      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = learnedOf([["セブンイレブン", "交際費"]]);

      const result = categoryFor(txOf("セブンイレブン", amountYen), rules, learned);

      expect(result).not.toBe(INCOME);
      expect(result).toBe(UNCATEGORIZED);
    });

    it("+0 と -0 で結果が同じ", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      expect(categoryFor(txOf("セブンイレブン", -0), rules, NO_LEARNED)).toBe(
        categoryFor(txOf("セブンイレブン", 0), rules, NO_LEARNED),
      );
    });
  });

  describe("支出（負）は従来どおり分類する", () => {
    it("学習が最優先（ルールより強い）", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = learnedOf([["セブンイレブン渋谷店", "交際費"]]);
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, learned)).toBe(
        "交際費",
      );
    });

    it("学習が無ければルールが当たる（上の対）", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("複数のルールが当たるとき、先頭のルールが勝つ", () => {
      const rules = frozenRules([ruleOf("セブン", "食費"), ruleOf("イレブン", "雑費")]);
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("ルールの部分一致は大文字小文字を区別しない", () => {
      const rules = frozenRules([ruleOf("AMAZON", "買い物")]);
      expect(categoryFor(txOf("Amazon.co.jp", -3000), rules, NO_LEARNED)).toBe(
        "買い物",
      );
    });

    it("学習キーは完全一致でなければ効かない（部分一致では効かない）", () => {
      const learned = learnedOf([["セブンイレブン", "食費"]]);
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), NO_RULES, learned)).toBe(
        UNCATEGORIZED,
      );
    });

    it("どれにも当たらないとき、未分類", () => {
      const rules = frozenRules([ruleOf("ローソン", "食費")]);
      expect(categoryFor(txOf("架空商店ＸＹＺ９９", -1000), rules, NO_LEARNED)).toBe(
        UNCATEGORIZED,
      );
    });

    it("金額が -1 円（境界）でも、支出として分類される", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1), rules, NO_LEARNED)).toBe(
        "食費",
      );
    });

    it("摘要が空文字列でも、空文字列キーの学習が当たる", () => {
      const learned = learnedOf([["", "手入力"]]);
      expect(categoryFor(txOf("", -1000), NO_RULES, learned)).toBe("手入力");
    });

    it("学習されたカテゴリが空文字列でも、その値がそのまま返る", () => {
      const learned = learnedOf([["セブンイレブン渋谷店", ""]]);
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), NO_RULES, learned)).toBe(
        "",
      );
    });

    it("学習がプロトタイプ由来のキーしか持たないとき、未分類（汚染を拾わない）", () => {
      const result = categoryFor(txOf("constructor", -1000), NO_RULES, NO_LEARNED);
      expect(typeof result).toBe("string");
      expect(result).toBe(UNCATEGORIZED);
    });

    it.each([
      ["ルールが当たる", "セブンイレブン渋谷店"],
      ["学習が完全一致する", "Amazon.co.jp"],
      ["どれにも当たらない", "架空商店ＸＹＺ９９"],
      ["空文字列", ""],
      ["プロトタイプ由来のキー名", "__proto__"],
    ])(
      "支出のカテゴリは classifyDescription と同じ結果になる（%s）",
      (_name, description) => {
        const rules = frozenRules([
          ruleOf("セブン", "食費"),
          ruleOf("イレブン", "雑費"),
        ]);
        const learned = learnedOf([["Amazon.co.jp", "書籍"]]);

        expect(categoryFor(txOf(description, -1000), rules, learned)).toBe(
          classifyDescription(description, rules, learned),
        );
      },
    );
  });

  describe("符号が結果を決める", () => {
    it("摘要を固定して符号だけ変えると、結果が3通りに分かれる", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = learnedOf([["セブンイレブン渋谷店", "交際費"]]);

      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, learned)).toBe(
        "交際費",
      );
      expect(categoryFor(txOf("セブンイレブン渋谷店", 1000), rules, learned)).toBe(
        INCOME,
      );
      expect(categoryFor(txOf("セブンイレブン渋谷店", 0), rules, learned)).toBe(
        UNCATEGORIZED,
      );
    });

    it("編集できない取引（isCategorizable が false）のカテゴリは、摘要に依らない", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = learnedOf([["セブンイレブン渋谷店", "交際費"]]);

      for (const amountYen of [1000, 1, 0, -0]) {
        expect(isCategorizable({ amountYen })).toBe(false);
        expect(categoryFor(txOf("セブンイレブン渋谷店", amountYen), rules, learned)).toBe(
          categoryFor(txOf("架空商店ＸＹＺ９９", amountYen), rules, learned),
        );
      }
    });
  });

  describe("純粋関数であること", () => {
    it("rules と learned を書き換えない", () => {
      const rules: CategoryRule[] = [
        ruleOf("セブン", "食費"),
        ruleOf("イレブン", "雑費"),
      ];
      const learned = learnedOf([["Amazon.co.jp", "書籍"]]);
      const rulesSnapshot = rules.map((rule) => ({ ...rule }));
      const learnedSnapshot = entriesOf(learned);

      categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, learned);
      categoryFor(txOf("セブンイレブン渋谷店", 1000), rules, learned);
      categoryFor(txOf("セブンイレブン渋谷店", 0), rules, learned);

      expect(rules).toEqual(rulesSnapshot);
      expect(entriesOf(learned)).toEqual(learnedSnapshot);
    });

    it("凍結された取引・rules・learned を渡しても、書き換えを試みない", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = Object.freeze(learnedOf([["Amazon.co.jp", "書籍"]]));

      expect(() =>
        categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, learned),
      ).not.toThrow();
      expect(() =>
        categoryFor(txOf("セブンイレブン渋谷店", 1000), rules, learned),
      ).not.toThrow();
    });

    it("同じ入力で2回呼ぶと、同じ結果になる", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = Object.freeze(learnedOf([["Amazon.co.jp", "書籍"]]));

      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, learned)).toBe(
        "食費",
      );
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, learned)).toBe(
        "食費",
      );
      expect(categoryFor(txOf("給与振込", 250000), rules, learned)).toBe(INCOME);
      expect(categoryFor(txOf("給与振込", 250000), rules, learned)).toBe(INCOME);
    });

    it("直前の呼び出しの結果が、次の呼び出しに影響しない", () => {
      const rules = frozenRules([ruleOf("セブン", "食費")]);
      const learned = Object.freeze(learnedOf([["Amazon.co.jp", "書籍"]]));

      expect(categoryFor(txOf("給与振込", 250000), rules, learned)).toBe(INCOME);
      expect(categoryFor(txOf("Amazon.co.jp", -3000), rules, learned)).toBe("書籍");
      expect(categoryFor(txOf("架空商店ＸＹＺ９９", 0), rules, learned)).toBe(
        UNCATEGORIZED,
      );
      expect(categoryFor(txOf("セブンイレブン渋谷店", -1000), rules, learned)).toBe(
        "食費",
      );
    });
  });
});
