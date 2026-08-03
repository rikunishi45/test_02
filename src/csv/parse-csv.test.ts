import { describe, it, expect } from "vitest";
import { parseCsv } from "./parse-csv.js";

describe("parseCsv", () => {
  describe("空の入力", () => {
    it("空文字列のとき、空配列を返す（空の行を作らない）", () => {
      expect(parseCsv("")).toEqual([]);
    });
  });

  describe("引用符なしの基本形", () => {
    it("区切りも改行も無い1フィールドのとき、1行1列を返す", () => {
      expect(parseCsv("a")).toEqual([["a"]]);
    });

    it("カンマ区切り・LF区切りのとき、行と列に分割する", () => {
      expect(parseCsv("a,b\nc,d")).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
    });

    it("フィールドが空のとき、空文字列のフィールドとして保持する", () => {
      expect(parseCsv("a,,b")).toEqual([["a", "", "b"]]);
    });

    it("行頭のフィールドが空のとき、先頭に空文字列を置く", () => {
      expect(parseCsv(",a")).toEqual([["", "a"]]);
    });

    it("行末のフィールドが空のとき、末尾に空文字列を置く（区切りの後ろを切り捨てない）", () => {
      expect(parseCsv("a,")).toEqual([["a", ""]]);
    });

    it("カンマ1文字だけのとき、空文字列2つの行を返す", () => {
      expect(parseCsv(",")).toEqual([["", ""]]);
    });

    it("フィールド内の空白を保持する（トリムしない）", () => {
      expect(parseCsv(" a , b ")).toEqual([[" a ", " b "]]);
    });
  });

  describe("引用符", () => {
    it("引用符で囲まれたフィールドは、引用符を外した中身を返す", () => {
      expect(parseCsv('"a"')).toEqual([["a"]]);
    });

    it("引用符内のカンマは区切りではなくリテラル文字として扱う", () => {
      expect(parseCsv('"a,b",c')).toEqual([["a,b", "c"]]);
    });

    it("引用符内がカンマ1文字だけのとき、カンマを値として返す", () => {
      expect(parseCsv('","')).toEqual([[","]]);
    });

    it("引用部の後ろに非引用部が続くとき、連結して1つのフィールドにする", () => {
      // 引用符の位置には寛容に振る舞う契約。実CSVの揺れを取り込み時に弾かない。
      expect(parseCsv('a,"b"c,d')).toEqual([["a", "bc", "d"]]);
    });

    it("非引用部と引用部が交互に混ざっても、連結して1つのフィールドにする", () => {
      expect(parseCsv('"a"b"c",d')).toEqual([["abc", "d"]]);
    });

    it("引用符が混ざったフィールドがあっても、フィールド数は保存される", () => {
      // 寛容に読むことで列がずれないこと。列のずれは取り込み全体を壊す。
      expect(parseCsv('a,"b"c,d')[0]).toHaveLength(3);
      expect(parseCsv('"a"b"c",d')[0]).toHaveLength(2);
    });

    it("引用符内のLFは行区切りではなくリテラル文字として扱う", () => {
      expect(parseCsv('"a\nb",c')).toEqual([["a\nb", "c"]]);
    });

    it('引用符内の "" は " 1文字にアンエスケープする', () => {
      expect(parseCsv('"a""b"')).toEqual([['a"b']]);
    });

    it('引用符内が "" だけのとき、" 1文字を返す', () => {
      // 入力は二重引用符4個。外側1組が囲み、内側の "" が " 1文字になる
      expect(parseCsv('""""')).toEqual([['"']]);
    });

    it("引用符で囲まれた空フィールドは、空文字列を返す", () => {
      expect(parseCsv('""')).toEqual([[""]]);
    });

    it("行末が引用符付きの空フィールドのとき、空文字列を保持する", () => {
      expect(parseCsv('a,""')).toEqual([["a", ""]]);
    });

    it("引用符内の空白を保持する", () => {
      expect(parseCsv('" a "')).toEqual([[" a "]]);
    });

    it("引用符付きフィールドと引用符なしフィールドが複数行に混在しても分割できる", () => {
      expect(parseCsv('"a",b\nc,"d,e"')).toEqual([
        ["a", "b"],
        ["c", "d,e"],
      ]);
    });
  });

  describe("改行コード", () => {
    it("CRLF区切りのとき、CRを値に残さず行に分割する", () => {
      expect(parseCsv("a,b\r\nc,d")).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
    });

    it("LFとCRLFが混在しても、どちらも行区切りとして扱う", () => {
      expect(parseCsv("a\r\nb\nc")).toEqual([["a"], ["b"], ["c"]]);
    });

    it("LFを伴わない単独のCRは行区切りではなく、値の一部として残す", () => {
      // RFC4180 が行区切りと定めているのは CRLF。単独のCRを区切りにすると、
      // 値に含まれるCRで行が壊れる。
      expect(parseCsv("a\rb")).toEqual([["a\rb"]]);
    });
  });

  describe("末尾の改行", () => {
    it("末尾がLFのとき、空行を生成しない", () => {
      expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    });

    it("末尾がCRLFのとき、空行も空のCRフィールドも生成しない", () => {
      expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
    });

    it("末尾に改行が無いとき、最後の行を落とさない", () => {
      expect(parseCsv("a,b\nc,d")).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
    });

    it("末尾の引用符付きフィールドの直後がLFでも、空行を生成しない", () => {
      expect(parseCsv('a,"b"\n')).toEqual([["a", "b"]]);
    });

    it("行の途中の空行は、末尾ではないので空文字列1つの行として保持する", () => {
      expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
    });
  });

  describe("行ごとのフィールド数が揃っていない場合", () => {
    it("フィールド数が行ごとに違っても、そのまま返す（列数を揃えない）", () => {
      expect(parseCsv("a,b,c\nd\ne,f")).toEqual([
        ["a", "b", "c"],
        ["d"],
        ["e", "f"],
      ]);
    });
  });

  describe("閉じられていない引用符", () => {
    it("引用符が開いたまま入力が終わるとき、例外を送出する", () => {
      expect(() => parseCsv('"unclosed')).toThrow();
    });

    it("引用符が開いたまま入力が終わり、中にカンマを含むとき、例外を送出する", () => {
      expect(() => parseCsv('"a,b')).toThrow();
    });

    it("引用符が開いたまま入力が終わり、中に改行を含むとき、例外を送出する", () => {
      expect(() => parseCsv('"a\nb')).toThrow();
    });

    it("2列目の引用符が閉じられないまま入力が終わるとき、例外を送出する", () => {
      expect(() => parseCsv('a,"b')).toThrow();
    });

    it('エスケープされた引用符の後に閉じ引用符が無いとき、例外を送出する', () => {
      // 入力は二重引用符3個。開き + エスケープされた "" で終わり、閉じが無い
      expect(() => parseCsv('"""')).toThrow();
    });

    it("引用符1文字だけのとき、例外を送出する", () => {
      expect(() => parseCsv('"')).toThrow();
    });

    it("正しく閉じられている場合は例外を送出しない（上の例外ケースとの対）", () => {
      expect(() => parseCsv('"a"')).not.toThrow();
      expect(() => parseCsv('""')).not.toThrow();
    });
  });

  describe("入力を破壊しないこと", () => {
    it("純粋関数として、同じ入力に対して同じ結果を返す", () => {
      const input = 'h1,h2\n"a,b",c\n';
      const first = parseCsv(input);
      const second = parseCsv(input);
      expect(first).toEqual(second);
      expect(first).toEqual([
        ["h1", "h2"],
        ["a,b", "c"],
      ]);
    });
  });
});
