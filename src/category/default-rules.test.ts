import { describe, it, expect } from "vitest";
import { DEFAULT_CATEGORY_RULES, CATEGORIES } from "./default-rules.js";
import {
  classifyDescription,
  UNCATEGORIZED,
  type LearnedCategories,
} from "./classify.js";

const NO_LEARNED: LearnedCategories = Object.freeze({});

/** 既定ルールだけで分類する。学習は常に空（既定ルール自体を検査したいため） */
function classify(description: string): string {
  return classifyDescription(description, DEFAULT_CATEGORY_RULES, NO_LEARNED);
}

/**
 * どのルールにも当たらないはずの架空の店名。
 * このリポジトリは public なので、実在の店舗コード・顧客番号は書かない。
 */
const UNKNOWN_MERCHANT = "ＸＹＺ９９";

describe("CATEGORIES", () => {
  it("空ではない", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });

  it("重複が無い", () => {
    expect([...new Set(CATEGORIES)]).toHaveLength(CATEGORIES.length);
  });

  it("未分類を含まない（未分類はカテゴリ一覧の外側の値）", () => {
    expect(CATEGORIES).not.toContain(UNCATEGORIZED);
    expect(CATEGORIES).not.toContain("未分類");
  });

  it("空文字列や空白だけのカテゴリ名が無い", () => {
    for (const category of CATEGORIES) {
      expect(typeof category).toBe("string");
      expect(category.trim()).not.toBe("");
    }
  });

  it.each(["食費", "サブスク", "娯楽", "光熱費", "通信費"])(
    "既定ルールが返すカテゴリ %s を含む",
    (category) => {
      expect(CATEGORIES).toContain(category);
    },
  );
});

describe("DEFAULT_CATEGORY_RULES の構造", () => {
  it("空ではない", () => {
    expect(DEFAULT_CATEGORY_RULES.length).toBeGreaterThan(0);
  });

  it("空文字列の pattern を含まない", () => {
    for (const rule of DEFAULT_CATEGORY_RULES) {
      expect(rule.pattern).not.toBe("");
    }
  });

  // 空白だけの pattern は classifyDescription の仕様上どの摘要にも当たらない
  // （= 到達不能なルール）ので、空 pattern と同じ理由で存在してはいけない。
  it("空白だけの pattern を含まない", () => {
    for (const rule of DEFAULT_CATEGORY_RULES) {
      expect(rule.pattern.trim()).not.toBe("");
    }
  });

  it("すべての category が CATEGORIES に含まれる", () => {
    for (const rule of DEFAULT_CATEGORY_RULES) {
      expect(CATEGORIES).toContain(rule.category);
    }
  });

  it("category に未分類を持つルールが無い", () => {
    for (const rule of DEFAULT_CATEGORY_RULES) {
      expect(rule.category).not.toBe(UNCATEGORIZED);
    }
  });
});

describe("実際のカード明細の摘要が正しく分類される", () => {
  it.each([
    ["楽天ＳＰ　楽天ペイセブン－イレブン　        000000", "食費"],
    ["楽天ＳＰ　ローソンアプリ　        000000", "食費"],
    ["楽天ＳＰ　マクドナルドアプリ　        000000", "食費"],
    ["ゆめタウン広島（食品）", "食費"],
    ["ＶＩＳＡ国内利用　VS ﾏﾂｸｽﾊﾞﾘﾕﾀﾞﾝﾊﾞﾗﾃﾝ", "食費"],
    ["ＶＩＳＡ海外利用　OPENAI *CHATGPT SUBS", "サブスク"],
    ["ＶＩＳＡ国内利用　VS ｱﾏｿﾞﾝﾌﾟﾗｲﾑｶｲﾋ", "サブスク"],
    ["ＶＩＳＡ国内利用　VS ﾈｯﾄﾌﾘｯｸｽ", "サブスク"],
    ["ＶＩＳＡ海外利用　TWITCH INTERACTIVE,", "娯楽"],
    ["ＶＩＳＡ海外利用　STEAMGAMES.COM 00000", "娯楽"],
    ["中国電力　0000 0000000000000", "光熱費"],
    ["ＢＩＧＬＯＢＥ利用料", "通信費"],
  ])("%s → %s", (description, expected) => {
    expect(classify(description)).toBe(expected);
  });
});

describe("決済経路の名前で分類されない", () => {
  // このグループの前提。ここが崩れていると以下の検査が意味を失う。
  it("架空の店名だけなら未分類（テストの前提の確認）", () => {
    expect(classify(UNKNOWN_MERCHANT)).toBe(UNCATEGORIZED);
  });

  it.each([
    ["楽天ＳＰ", `楽天ＳＰ　${UNKNOWN_MERCHANT}`],
    ["ＶＩＳＡ国内利用 VS", `ＶＩＳＡ国内利用　VS ${UNKNOWN_MERCHANT}`],
    ["ＶＩＳＡ海外利用", `ＶＩＳＡ海外利用　${UNKNOWN_MERCHANT}`],
    ["楽天ペイ", `楽天ペイ　${UNKNOWN_MERCHANT}`],
  ])(
    "決済経路 %s が前置きされた未知の店は未分類（経路名で分類されない）",
    (_route, description) => {
      expect(classify(description)).toBe(UNCATEGORIZED);
    },
  );

  it.each([
    "楽天ＳＰ",
    "ＶＩＳＡ国内利用",
    "ＶＩＳＡ海外利用",
    "VS",
    "楽天ペイ",
  ])("決済経路そのもの（%s）だけでは分類されない", (route) => {
    expect(classify(route)).toBe(UNCATEGORIZED);
  });

  it("同じ決済経路で店名が違えば、別のカテゴリになりうる（経路に吸われていない対の確認）", () => {
    expect(classify("ＶＩＳＡ国内利用　VS ｱﾏｿﾞﾝﾌﾟﾗｲﾑｶｲﾋ")).toBe("サブスク");
    expect(classify("ＶＩＳＡ国内利用　VS ﾏﾂｸｽﾊﾞﾘﾕﾀﾞﾝﾊﾞﾗﾃﾝ")).toBe("食費");
  });

  it("楽天ＳＰ の後ろの店名だけで分類が決まる", () => {
    expect(classify("楽天ＳＰ　ローソンアプリ　        000000")).toBe("食費");
    expect(classify(`楽天ＳＰ　${UNKNOWN_MERCHANT}　        000000`)).toBe(
      UNCATEGORIZED,
    );
  });
});

describe("先に置かれた広いルールが後ろのルールを覆い隠していない", () => {
  DEFAULT_CATEGORY_RULES.forEach((rule, index) => {
    it(`#${index} pattern="${rule.pattern}" は自身の category="${rule.category}" を返す（到達可能）`, () => {
      expect(classify(rule.pattern)).toBe(rule.category);
    });
  });
});

describe("既知の罠：広いルールが具体的な店名を吸っていない", () => {
  it("ガスト は食費（ガス の広いルールに吸われていない）", () => {
    expect(classify("ガスト")).toBe("食費");
  });

  it("ガスト は光熱費ではない", () => {
    expect(classify("ガスト")).not.toBe("光熱費");
  });

  it("ドトール水道橋店 は光熱費ではない（水道 の広いルールに吸われていない）", () => {
    expect(classify("ドトール水道橋店")).not.toBe("光熱費");
  });

  it("ドトール水道橋店 は未分類（ドトールのルールは存在しない）", () => {
    expect(classify("ドトール水道橋店")).toBe(UNCATEGORIZED);
  });

  // 「イオン」を部分一致で持つと、無関係な語（ライオン）と、店名ではない
  // 決済経路（イオンカード・イオン銀行）まで巻き込む。ガス/水道/jr と同型。
  it.each([
    "ライオン事務器",
    "ライオンズマンション管理費",
    "イオンカード年会費",
    "イオン銀行ＡＴＭ手数料",
  ])("%s は食費ではない", (description) => {
    expect(classify(description)).not.toBe("食費");
  });

  it("イオンシネマ広島 は娯楽（食費に吸われていない）", () => {
    expect(classify("イオンシネマ広島")).toBe("娯楽");
  });

  it("イオンモール広島府中 は食費", () => {
    expect(classify("イオンモール広島府中")).toBe("食費");
  });

  // 短い英字パターンは無関係な英字列の途中に紛れる。
  it.each([
    ["LOCNESS SHOP", "通信費"],
    ["PRINTTECH SERVICE", "通信費"],
    ["STEAM CLEANING SVC", "娯楽"],
  ])("%s は %s ではない", (description, category) => {
    expect(classify(description)).not.toBe(category);
  });

  it("STEAMGAMES.COM は娯楽（実データに現れる形）", () => {
    expect(classify("ＶＩＳＡ海外利用　STEAMGAMES.COM 00000")).toBe("娯楽");
  });
});

describe("既定ルールを使っても引数は書き換わらない", () => {
  it("分類しても DEFAULT_CATEGORY_RULES の内容が変わらない", () => {
    const snapshot = DEFAULT_CATEGORY_RULES.map((rule) => ({ ...rule }));
    classify("ＶＩＳＡ国内利用　VS ﾈｯﾄﾌﾘｯｸｽ");
    classify(UNKNOWN_MERCHANT);
    expect(DEFAULT_CATEGORY_RULES.map((rule) => ({ ...rule }))).toEqual(snapshot);
  });

  it("同じ摘要を2回分類しても結果が同じ", () => {
    expect(classify("ＢＩＧＬＯＢＥ利用料")).toBe("通信費");
    expect(classify("ＢＩＧＬＯＢＥ利用料")).toBe("通信費");
  });
});
