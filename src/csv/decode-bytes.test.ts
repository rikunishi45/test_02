import { describe, it, expect } from "vitest";
import { decodeBytes } from "./decode-bytes.js";

/** UTF-8 BOM のバイト列 */
const BOM_BYTES = [0xef, 0xbb, 0xbf] as const;

/** BOM に対応する文字（U+FEFF）。デコード結果の先頭に残っていてはいけない */
const BOM_CHAR = "\u{FEFF}";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function utf8WithBom(text: string): Uint8Array {
  return bytes(...BOM_BYTES, ...utf8(text));
}

/** 「セブン」の Shift_JIS。先頭 0x83 は UTF-8 の先頭バイトになり得ないので UTF-8 としては不正 */
const SJIS_SEVEN = bytes(0x83, 0x5a, 0x83, 0x75, 0x83, 0x93);

describe("decodeBytes", () => {
  describe("UTF-8 として厳密にデコードできるとき、UTF-8 として扱う", () => {
    it("日本語を含む UTF-8 のバイト列を、そのままの文字列に戻す", () => {
      expect(decodeBytes(utf8("セブンイレブン"))).toBe("セブンイレブン");
    });

    it("日本語と記号が混ざった CSV 1行を、そのままの文字列に戻す", () => {
      const line = "2026-01-15,-500,セブンイレブン";
      expect(decodeBytes(utf8(line))).toBe(line);
    });

    it("改行を含む複数行でも、内容を変えずに戻す", () => {
      const csv = "日付,金額,摘要\n2026-01-15,-500,セブンイレブン\n";
      expect(decodeBytes(utf8(csv))).toBe(csv);
    });

    it("サロゲートペアを含む4バイト文字を、壊さずに戻す", () => {
      expect(decodeBytes(utf8("ラーメン🍜"))).toBe("ラーメン🍜");
    });

    it("ASCII のみのバイト列を、そのままの文字列に戻す", () => {
      expect(decodeBytes(utf8("date,amount,description"))).toBe(
        "date,amount,description",
      );
    });

    it("ASCII のみのとき、Shift_JIS として読んでも同じ結果になる（解釈が一致する領域）", () => {
      const ascii = bytes(0x64, 0x61, 0x74, 0x65, 0x2c, 0x2d, 0x35, 0x30, 0x30);
      expect(decodeBytes(ascii)).toBe("date,-500");
      expect(new TextDecoder("shift_jis").decode(ascii)).toBe("date,-500");
    });

    it("空のバイト列のとき、空文字列を返す", () => {
      expect(decodeBytes(bytes())).toBe("");
    });
  });

  describe("UTF-8 として不正なとき、Shift_JIS としてデコードする", () => {
    it("「セブン」の Shift_JIS を、正しく「セブン」に戻す", () => {
      expect(decodeBytes(SJIS_SEVEN)).toBe("セブン");
    });

    it("Shift_JIS の日本語と ASCII が混在する行を、正しく戻す", () => {
      // "セブン" + ",-500"
      const line = bytes(
        0x83,
        0x5a,
        0x83,
        0x75,
        0x83,
        0x93,
        0x2c,
        0x2d,
        0x35,
        0x30,
        0x30,
      );
      expect(decodeBytes(line)).toBe("セブン,-500");
    });

    it("半角カナ（1バイト領域）を、正しく戻す", () => {
      // Shift_JIS の 0xB1 / 0xB2 は半角カナ U+FF71 / U+FF72。
      // UTF-8 としては継続バイトが先頭に来るので不正
      expect(decodeBytes(bytes(0xb1, 0xb2))).toBe("\u{FF71}\u{FF72}");
    });

    it("UTF-8 としても Shift_JIS としても不正なバイトは、置換文字になる（例外を投げない）", () => {
      // 0xFF は UTF-8 に現れず、Shift_JIS の先頭バイトにもならない
      expect(decodeBytes(bytes(0xff))).toBe("\u{FFFD}");
    });
  });

  describe("UTF-8 と Shift_JIS の分岐（同じバイト列でも解釈で別物になる）", () => {
    it("Shift_JIS のバイト列を UTF-8 として読むと別物になるが、decodeBytes は Shift_JIS として読む", () => {
      const asUtf8 = new TextDecoder("utf-8").decode(SJIS_SEVEN);
      expect(asUtf8).not.toBe("セブン");
      expect(decodeBytes(SJIS_SEVEN)).toBe("セブン");
    });

    it("UTF-8 として妥当なら、Shift_JIS として読めても UTF-8 を優先する", () => {
      // "あ" の UTF-8 は E3 81 82。Shift_JIS としても解釈できてしまうが、別物になる
      const input = utf8("あ");
      expect(new TextDecoder("shift_jis").decode(input)).not.toBe("あ");
      expect(decodeBytes(input)).toBe("あ");
    });

    it("UTF-8 として妥当な日本語の連なりでも、Shift_JIS 解釈に落ちない", () => {
      const input = utf8("日本語対応");
      expect(new TextDecoder("shift_jis").decode(input)).not.toBe("日本語対応");
      expect(decodeBytes(input)).toBe("日本語対応");
    });

    it("Shift_JIS のバイト列を UTF-8 として非厳密に読んだ結果（置換文字混じり）を返さない", () => {
      expect(decodeBytes(SJIS_SEVEN)).not.toContain("\u{FFFD}");
    });
  });

  describe("UTF-8 BOM は取り除く", () => {
    it("BOM 付き UTF-8 の結果に、先頭の BOM 文字が残らない", () => {
      const decoded = decodeBytes(utf8WithBom("日付,金額,摘要"));
      expect(decoded.startsWith(BOM_CHAR)).toBe(false);
      expect(decoded).toBe("日付,金額,摘要");
    });

    it("BOM 付きと BOM 無しで、同じ文字列になる（対）", () => {
      const text = "2026-01-15,-500,セブンイレブン";
      expect(decodeBytes(utf8WithBom(text))).toBe(decodeBytes(utf8(text)));
    });

    it("BOM 付き ASCII でも、BOM 無しと同じ文字列になる（対）", () => {
      const text = "date,amount,description";
      expect(decodeBytes(utf8WithBom(text))).toBe(decodeBytes(utf8(text)));
      expect(decodeBytes(utf8WithBom(text))).toBe(text);
    });

    it("BOM だけのバイト列のとき、空文字列を返す", () => {
      expect(decodeBytes(bytes(...BOM_BYTES))).toBe("");
    });

    it("BOM の直後が1文字だけでも、その1文字を返す（取り除きすぎない）", () => {
      expect(decodeBytes(utf8WithBom("A"))).toBe("A");
      expect(decodeBytes(utf8WithBom("あ"))).toBe("あ");
    });

    it("先頭以外に現れた U+FEFF は取り除かない（先頭だけが BOM）", () => {
      const text = `a${BOM_CHAR}b`;
      expect(decodeBytes(utf8(text))).toBe(text);
      expect(decodeBytes(utf8(text))).toHaveLength(3);
    });

    it("BOM が途中にある行でも、先頭の文字は消えない", () => {
      const text = `摘要${BOM_CHAR}金額`;
      expect(decodeBytes(utf8(text))).toBe(text);
    });

    it("BOM の一部（EF BB）だけのバイト列を、BOM として扱わない", () => {
      // UTF-8 としては不正なので Shift_JIS 解釈になる。何であれ空にはならない
      const decoded = decodeBytes(bytes(0xef, 0xbb));
      expect(decoded).not.toBe("");
      expect(decoded.startsWith(BOM_CHAR)).toBe(false);
    });
  });

  describe("入力の受け取り方", () => {
    it("バッファの一部を指す Uint8Array（subarray）でも、その範囲だけをデコードする", () => {
      const padded = bytes(0x00, 0x00, ...utf8("セブンイレブン"));
      expect(decodeBytes(padded.subarray(2))).toBe("セブンイレブン");
    });

    it("subarray に BOM が含まれるときも、BOM を取り除く", () => {
      const padded = bytes(0x00, 0x00, ...BOM_BYTES, ...utf8("金額"));
      expect(decodeBytes(padded.subarray(2))).toBe("金額");
    });

    it("subarray で渡した Shift_JIS も、正しくデコードする", () => {
      const padded = bytes(0x00, ...SJIS_SEVEN);
      expect(decodeBytes(padded.subarray(1))).toBe("セブン");
    });

    it("引数のバイト列を書き換えない", () => {
      const input = utf8WithBom("セブンイレブン");
      const snapshot = Array.from(input);
      decodeBytes(input);
      expect(Array.from(input)).toEqual(snapshot);
    });

    it("同じバイト列を2回渡すと、同じ結果を返す", () => {
      expect(decodeBytes(SJIS_SEVEN)).toBe(decodeBytes(SJIS_SEVEN));
      expect(decodeBytes(utf8WithBom("あ"))).toBe(decodeBytes(utf8WithBom("あ")));
    });
  });
});
