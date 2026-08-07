import { describe, it, expect } from "vitest";
import { normalizeDescription } from "./normalize.js";

/**
 * 見えない文字はエスケープで書く。テストの期待値がエディタの表示に依存すると、
 * 後から読んだ人（人間・AIとも）が何を検査しているのか判断できなくなる。
 */
const IDEOGRAPHIC_SPACE = "　"; // 全角空白
const NBSP = " "; // NO-BREAK SPACE。NFKC で U+0020 になる
const EM_SPACE = " "; // EM SPACE。NFKC で U+0020 になる
const FULLWIDTH_HYPHEN_MINUS = "－"; // －
const HYPHEN_MINUS = "-"; // -

describe("normalizeDescription", () => {
  describe("1. NFKC：カード明細に実際に現れる形が畳まれる", () => {
    it("全角英字が半角になる（半角カナ・全角空白と混在した実データの形）", () => {
      expect(
        normalizeDescription("ＶＩＳＡ国内利用　VS ｱﾏｿﾞﾝﾌﾟﾗｲﾑｶｲﾋ"),
      ).toBe("VISA国内利用 VS アマゾンプライムカイヒ");
    });

    it("全角英字だけの摘要が半角になる", () => {
      expect(normalizeDescription("ＢＩＧＬＯＢＥ利用料")).toBe("BIGLOBE利用料");
    });

    it("全角ハイフンマイナス U+FF0D が半角ハイフンマイナス U+002D になる", () => {
      expect(normalizeDescription(FULLWIDTH_HYPHEN_MINUS)).toBe(HYPHEN_MINUS);
    });

    it("半角カナが全角カナになり、分離した濁点が合成される", () => {
      expect(normalizeDescription("ﾏﾂｸｽﾊﾞﾘﾕ")).toBe("マツクスバリユ");
    });

    it("半角カナの長音記号が全角の長音記号になる", () => {
      expect(normalizeDescription("ﾗｰﾒﾝ")).toBe("ラーメン");
    });

    it("半角カナの小書き文字は小書きのまま合成される", () => {
      expect(normalizeDescription("ﾈｯﾄﾌﾘｯｸｽ")).toBe("ネットフリックス");
    });

    it("結合用濁点 U+3099 が前の仮名と合成される", () => {
      expect(normalizeDescription("バ")).toBe("バ");
    });

    it("全角数字が半角数字になる", () => {
      expect(normalizeDescription("ＸＹＺ９９")).toBe("XYZ99");
    });

    it("全角括弧が半角括弧になる", () => {
      expect(normalizeDescription("ゆめタウン広島（食品）")).toBe(
        "ゆめタウン広島(食品)",
      );
    });

    it("互換文字（丸数字）が通常の数字になる", () => {
      expect(normalizeDescription("①")).toBe("1");
    });

    it("互換文字（ローマ数字）が通常のラテン文字になる", () => {
      expect(normalizeDescription("Ⅳ")).toBe("IV");
    });

    it("合字（ﬁ）が個別の文字に分解される", () => {
      expect(normalizeDescription("ﬁ")).toBe("fi");
    });
  });

  describe("1. NFKC が直さないこと（畳みすぎていないことの確認）", () => {
    it("大書きで転記された店名は小書きに復元されない", () => {
      const result = normalizeDescription("ﾏﾂｸｽﾊﾞﾘﾕﾀﾞﾝﾊﾞﾗﾃﾝ");
      expect(result).toBe("マツクスバリユダンバラテン");
      expect(result).not.toBe("マックスバリュダンバラテン");
    });

    it("カタカナはひらがなにならない", () => {
      expect(normalizeDescription("ラーメン")).toBe("ラーメン");
    });

    it("ひらがなはカタカナにならない", () => {
      expect(normalizeDescription("らーめん")).toBe("らーめん");
    });

    it("英字の大文字小文字は変換されない（小文字化は分類側の責務）", () => {
      expect(normalizeDescription("VISA")).toBe("VISA");
      expect(normalizeDescription("visa")).toBe("visa");
      expect(normalizeDescription("Amazon.co.jp")).toBe("Amazon.co.jp");
    });

    it("全角英字は半角になるが大文字小文字は保たれる", () => {
      expect(normalizeDescription("ｖｉｓａ")).toBe("visa");
    });

    it("漢字はそのまま残る", () => {
      expect(normalizeDescription("中国電力")).toBe("中国電力");
    });
  });

  describe("2. 連続する空白を半角空白1個にまとめる", () => {
    it("全角空白1個が半角空白1個になる", () => {
      expect(normalizeDescription(`楽天${IDEOGRAPHIC_SPACE}カード`)).toBe(
        "楽天 カード",
      );
    });

    it("半角空白の連続が1個にまとまる", () => {
      expect(normalizeDescription("楽天        カード")).toBe("楽天 カード");
    });

    it("全角空白と半角空白が連続していても1個にまとまる", () => {
      expect(
        normalizeDescription(`楽天${IDEOGRAPHIC_SPACE}        カード`),
      ).toBe("楽天 カード");
    });

    it("タブ・改行・復帰も空白として1個にまとまる", () => {
      expect(normalizeDescription("楽天\t\r\n カード")).toBe("楽天 カード");
    });

    it("NO-BREAK SPACE も半角空白1個になる", () => {
      expect(normalizeDescription(`楽天${NBSP}${NBSP}カード`)).toBe(
        "楽天 カード",
      );
    });

    it("EM SPACE も半角空白1個になる", () => {
      expect(normalizeDescription(`楽天${EM_SPACE}カード`)).toBe("楽天 カード");
    });

    it("空白で区切られた箇所が複数あっても、それぞれ1個になる（つながらない）", () => {
      expect(
        normalizeDescription(
          `楽天${IDEOGRAPHIC_SPACE}${IDEOGRAPHIC_SPACE}ペイ   セブン`,
        ),
      ).toBe("楽天 ペイ セブン");
    });

    it("既に半角空白1個の箇所は変わらない", () => {
      expect(normalizeDescription("VS ｱﾏｿﾞﾝ")).toBe("VS アマゾン");
    });

    it("空白で区切られた語そのものは連結されない", () => {
      const result = normalizeDescription("楽天  ペイ");
      expect(result).toBe("楽天 ペイ");
      expect(result).not.toBe("楽天ペイ");
    });
  });

  describe("3. 前後の空白を落とす", () => {
    it("先頭の空白が落ちる", () => {
      expect(normalizeDescription("   BIGLOBE利用料")).toBe("BIGLOBE利用料");
    });

    it("末尾の空白が落ちる", () => {
      expect(normalizeDescription("BIGLOBE利用料   ")).toBe("BIGLOBE利用料");
    });

    it("先頭と末尾の全角空白が落ちる", () => {
      expect(
        normalizeDescription(
          `${IDEOGRAPHIC_SPACE}ＢＩＧＬＯＢＥ利用料${IDEOGRAPHIC_SPACE}`,
        ),
      ).toBe("BIGLOBE利用料");
    });

    it("前後の空白が落ちても、中間の空白は1個残る", () => {
      expect(
        normalizeDescription(`${IDEOGRAPHIC_SPACE}楽天  ペイ${NBSP}`),
      ).toBe("楽天 ペイ");
    });

    it("タブと改行だけの前後も落ちる", () => {
      expect(normalizeDescription("\t\n中国電力\n\t")).toBe("中国電力");
    });
  });

  describe("境界値", () => {
    it("空文字列は空文字列のまま", () => {
      expect(normalizeDescription("")).toBe("");
    });

    // 「前後の空白を落とす」（仕様3）を適用すると、空白しか無い文字列は空になる。
    it.each([
      ["半角空白1個", " "],
      ["半角空白の連続", "     "],
      ["全角空白1個", IDEOGRAPHIC_SPACE],
      ["全角空白の連続", `${IDEOGRAPHIC_SPACE}${IDEOGRAPHIC_SPACE}`],
      ["タブ", "\t"],
      ["改行", "\n"],
      ["NO-BREAK SPACE", NBSP],
      ["空白の種類が混在", ` \t${IDEOGRAPHIC_SPACE}\n${NBSP}`],
    ])("空白だけの文字列（%s）は空文字列になる", (_name, input) => {
      expect(normalizeDescription(input)).toBe("");
    });

    it("1文字の純ASCIIは変わらない", () => {
      expect(normalizeDescription("A")).toBe("A");
    });

    it.each([
      "AMAZON",
      "amazon.co.jp",
      "OPENAI *CHATGPT SUBS",
      "STEAMGAMES.COM",
      "TWITCH INTERACTIVE,",
      "VS",
      "-",
      "000000",
      "A B C",
    ])("正規化しても変わらない純ASCII文字列: %s", (input) => {
      expect(normalizeDescription(input)).toBe(input);
    });

    it("絵文字はNFKCの対象外なのでそのまま残る", () => {
      expect(normalizeDescription("\u{1F35C}")).toBe("\u{1F35C}");
    });

    it("絵文字を含む摘要でも、他の部分だけが正規化される", () => {
      expect(normalizeDescription("ＲＡＭＥＮ\u{1F35C}　ﾗｰﾒﾝ")).toBe(
        "RAMEN\u{1F35C} ラーメン",
      );
    });

    it("サロゲートペアが壊れない（コードポイント数が保たれる）", () => {
      const result = normalizeDescription(`\u{1F35C}${IDEOGRAPHIC_SPACE}\u{1F35C}`);
      expect(result).toBe("\u{1F35C} \u{1F35C}");
      expect([...result]).toHaveLength(3);
    });

    it("空白を含まない長い摘要でも、空白が挿入されない", () => {
      expect(normalizeDescription("ｱﾏｿﾞﾝﾌﾟﾗｲﾑｶｲﾋ")).toBe("アマゾンプライムカイヒ");
    });
  });

  describe("実データの摘要の形（3つの規則が同時に効く）", () => {
    it("楽天SPのコンビニ決済（全角英字・全角ハイフン・全角空白＋連続空白）", () => {
      expect(
        normalizeDescription(
          `楽天ＳＰ${IDEOGRAPHIC_SPACE}楽天ペイセブン－イレブン${IDEOGRAPHIC_SPACE}        000000`,
        ),
      ).toBe("楽天SP 楽天ペイセブン-イレブン 000000");
    });

    it("VISA海外利用（半角のまま・区切りは全角空白）", () => {
      expect(
        normalizeDescription(
          `ＶＩＳＡ海外利用${IDEOGRAPHIC_SPACE}OPENAI *CHATGPT SUBS`,
        ),
      ).toBe("VISA海外利用 OPENAI *CHATGPT SUBS");
    });

    it("電力会社（数字と空白の並び）", () => {
      expect(
        normalizeDescription(`中国電力${IDEOGRAPHIC_SPACE}0000 0000000000000`),
      ).toBe("中国電力 0000 0000000000000");
    });
  });

  describe("冪等性：2回かけても1回と同じ", () => {
    it.each([
      "",
      " ",
      IDEOGRAPHIC_SPACE,
      "A",
      "amazon.co.jp",
      FULLWIDTH_HYPHEN_MINUS,
      "ＢＩＧＬＯＢＥ利用料",
      "ﾏﾂｸｽﾊﾞﾘﾕ",
      "ﾗｰﾒﾝ",
      "バ",
      "\u{1F35C}",
      `${IDEOGRAPHIC_SPACE}楽天ＳＰ${IDEOGRAPHIC_SPACE}   ﾈｯﾄﾌﾘｯｸｽ${NBSP}`,
      `ＶＩＳＡ国内利用${IDEOGRAPHIC_SPACE}VS ｱﾏｿﾞﾝﾌﾟﾗｲﾑｶｲﾋ`,
      "ゆめタウン広島（食品）",
    ])("normalizeDescription(x) を2回かけても結果が同じ: %j", (input) => {
      const once = normalizeDescription(input);
      expect(normalizeDescription(once)).toBe(once);
    });

    it("3回かけても変わらない", () => {
      const input = `　ＶＩＳＡ国内利用${IDEOGRAPHIC_SPACE}  VS ﾏﾂｸｽﾊﾞﾘﾕ　`;
      const once = normalizeDescription(input);
      expect(normalizeDescription(normalizeDescription(once))).toBe(once);
    });
  });

  describe("純粋関数であること", () => {
    it("同じ入力で2回呼ぶと同じ結果になる", () => {
      const input = `ＶＩＳＡ国内利用${IDEOGRAPHIC_SPACE}VS ﾈｯﾄﾌﾘｯｸｽ`;
      expect(normalizeDescription(input)).toBe(normalizeDescription(input));
    });

    it("直前の呼び出しが次の呼び出しに影響しない", () => {
      expect(normalizeDescription("ﾗｰﾒﾝ")).toBe("ラーメン");
      expect(normalizeDescription("")).toBe("");
      expect(normalizeDescription("ﾗｰﾒﾝ")).toBe("ラーメン");
    });

    it("常に文字列を返す", () => {
      expect(typeof normalizeDescription("")).toBe("string");
      expect(typeof normalizeDescription(IDEOGRAPHIC_SPACE)).toBe("string");
      expect(typeof normalizeDescription("ＢＩＧＬＯＢＥ")).toBe("string");
    });
  });
});
