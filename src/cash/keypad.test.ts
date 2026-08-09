import { describe, it, expect } from "vitest";
import { MAX_AMOUNT_DIGITS, pressKey, type KeypadKey } from "./keypad.js";

const DIGITS: readonly KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** 左から順に押す。画面が状態を往復させるのと同じ形 */
function press(keys: readonly KeypadKey[], start = ""): string {
  return keys.reduce((current, key) => pressKey(current, key), start);
}

/** ちょうど上限の桁数になる文字列 */
function atLimit(): string {
  return "1".repeat(MAX_AMOUNT_DIGITS);
}

describe("MAX_AMOUNT_DIGITS", () => {
  it("parseAmount が安全に扱える桁数に収まっている", () => {
    expect(Number("9".repeat(MAX_AMOUNT_DIGITS))).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it("1円単位の家計簿として実用になる桁数がある（100万円が打てる）", () => {
    expect(MAX_AMOUNT_DIGITS).toBeGreaterThanOrEqual(7);
  });
});

describe("pressKey — 数字を足す", () => {
  it.each(DIGITS)("空の状態で %s を押すと、その数字だけになる", (key) => {
    expect(pressKey("", key)).toBe(key);
  });

  it.each(DIGITS)("既にある文字列の末尾に %s を足す", (key) => {
    expect(pressKey("12", key)).toBe(`12${key}`);
  });

  it("押した順に左から並ぶ", () => {
    expect(press(["1", "2", "0", "0"])).toBe("1200");
  });

  it("同じ数字を続けて押しても、まとめられない", () => {
    expect(press(["7", "7", "7"])).toBe("777");
  });

  it("1桁ずつ増える", () => {
    expect([press(["5"]), press(["5", "5"]), press(["5", "5", "5"])]).toEqual([
      "5",
      "55",
      "555",
    ]);
  });
});

describe("pressKey — 00", () => {
  it("2桁まとめて足す", () => {
    expect(pressKey("12", "00")).toBe("1200");
  });

  it("空の状態では何も入らない（先頭がゼロにならない）", () => {
    expect(pressKey("", "00")).toBe("");
  });

  it("1 のあとの 00 は 100 になる", () => {
    expect(press(["1", "00"])).toBe("100");
  });

  it("00 を続けて押すと2桁ずつ増える", () => {
    expect(press(["3", "00", "00"])).toBe("30000");
  });
});

describe("pressKey — 先頭のゼロを作らない", () => {
  it("空の状態で 0 を押しても空のまま", () => {
    expect(pressKey("", "0")).toBe("");
  });

  it("0 を何回押しても空のまま", () => {
    expect(press(["0", "0", "0"])).toBe("");
  });

  it("0 を押したあとに 5 を押すと 5 になる（05 にならない）", () => {
    expect(press(["0", "5"])).toBe("5");
  });

  it("00 を押したあとに 5 を押すと 5 になる", () => {
    expect(press(["00", "5"])).toBe("5");
  });

  it("先頭以外のゼロは入る", () => {
    expect(press(["1", "0", "5"])).toBe("105");
  });

  it("末尾のゼロも入る", () => {
    expect(press(["5", "0"])).toBe("50");
  });

  it("全部消したあとの 0 も入らない", () => {
    expect(press(["9", "backspace", "0"])).toBe("");
  });

  it("clear のあとの 0 も入らない", () => {
    expect(press(["9", "clear", "0"])).toBe("");
  });
});

describe("pressKey — backspace", () => {
  it("末尾の1文字を消す", () => {
    expect(pressKey("1200", "backspace")).toBe("120");
  });

  it("1桁だけのときは空になる", () => {
    expect(pressKey("7", "backspace")).toBe("");
  });

  it("空のときは空のまま（例外を投げない）", () => {
    expect(pressKey("", "backspace")).toBe("");
  });

  it("空のときに何回押しても空のまま", () => {
    expect(press(["backspace", "backspace", "backspace"])).toBe("");
  });

  it("00 で入れた2桁は、backspace 2回で消える（1回では1桁だけ残る）", () => {
    expect(press(["1", "00", "backspace"])).toBe("10");
    expect(press(["1", "00", "backspace", "backspace"])).toBe("1");
  });

  it("押した数だけ消える", () => {
    expect(press(["1", "2", "3", "4", "backspace", "backspace"])).toBe("12");
  });

  it("消したあとに続けて打てる", () => {
    expect(press(["1", "2", "backspace", "9"])).toBe("19");
  });
});

describe("pressKey — clear", () => {
  it("全部消す", () => {
    expect(pressKey("123456", "clear")).toBe("");
  });

  it("空のときは空のまま", () => {
    expect(pressKey("", "clear")).toBe("");
  });

  it("1桁でも空になる", () => {
    expect(pressKey("7", "clear")).toBe("");
  });

  it("上限まで入っていても空になる", () => {
    expect(pressKey(atLimit(), "clear")).toBe("");
  });

  it("消したあとに続けて打てる", () => {
    expect(press(["1", "2", "3", "clear", "9"])).toBe("9");
  });
});

describe("pressKey — 桁数の上限", () => {
  it("上限ちょうどまでは入る", () => {
    expect(press(Array.from({ length: MAX_AMOUNT_DIGITS }, () => "1" as KeypadKey))).toBe(
      atLimit(),
    );
  });

  it("上限を超える1桁は入らない", () => {
    expect(pressKey(atLimit(), "9")).toBe(atLimit());
  });

  it("上限に達したあとは何回押しても増えない", () => {
    expect(press(["9", "9", "9"], atLimit())).toBe(atLimit());
  });

  it("上限の1つ手前なら、あと1桁だけ入る", () => {
    const oneShort = "1".repeat(MAX_AMOUNT_DIGITS - 1);

    expect(pressKey(oneShort, "9")).toBe(`${oneShort}9`);
    expect(pressKey(`${oneShort}9`, "9")).toBe(`${oneShort}9`);
  });

  it("残り1桁のときの 00 は、1桁だけ入らずに丸ごと捨てられる", () => {
    const oneShort = "1".repeat(MAX_AMOUNT_DIGITS - 1);

    expect(pressKey(oneShort, "00")).toBe(oneShort);
  });

  it("残り2桁のときの 00 はそのまま入る", () => {
    const twoShort = "1".repeat(MAX_AMOUNT_DIGITS - 2);

    expect(pressKey(twoShort, "00")).toBe(`${twoShort}00`);
  });

  it("上限で止まったあと、backspace すればまた入る", () => {
    expect(press(["backspace", "9"], atLimit())).toBe(`${"1".repeat(MAX_AMOUNT_DIGITS - 1)}9`);
  });

  it("上限を超えて押しても、桁数は上限のまま", () => {
    const result = press(Array.from({ length: MAX_AMOUNT_DIGITS + 5 }, () => "1" as KeypadKey));

    expect(result.length).toBe(MAX_AMOUNT_DIGITS);
  });

  it("00 を押し続けても上限を超えない", () => {
    const result = press(Array.from({ length: MAX_AMOUNT_DIGITS }, () => "00" as KeypadKey), "1");

    expect(result.length).toBeLessThanOrEqual(MAX_AMOUNT_DIGITS);
  });
});

describe("pressKey — 数として解釈できる形を保つ", () => {
  it("入力の結果は、空か、先頭がゼロでない数字の列になる", () => {
    const keys: KeypadKey[] = ["0", "1", "00", "9", "backspace", "0", "5", "clear", "0", "2"];
    let current = "";
    for (const key of keys) {
      current = pressKey(current, key);
      expect(current).toMatch(/^$|^[1-9][0-9]*$/);
    }
  });

  it("空でなければ Number に通して正の整数になる", () => {
    const amount = press(["1", "2", "00"]);

    expect(Number(amount)).toBe(1200);
    expect(Number.isSafeInteger(Number(amount))).toBe(true);
  });

  it("上限まで打った値も安全な整数の範囲に収まる", () => {
    const result = press(Array.from({ length: MAX_AMOUNT_DIGITS + 3 }, () => "9" as KeypadKey));

    expect(Number.isSafeInteger(Number(result))).toBe(true);
  });
});
