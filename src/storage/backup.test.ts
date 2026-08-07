import { describe, it, expect } from "vitest";
import type { StoredTransaction, ImportRecord, NamedColumnMapping } from "./schema.js";
import type { LearnedCategories } from "../category/classify.js";
import {
  BACKUP_FORMAT_VERSION,
  buildBackup,
  parseBackup,
  type BackupData,
} from "./backup.js";

type BackupPayload = Omit<BackupData, "formatVersion" | "exportedAt">;

/**
 * parseBackup は要素の中身まで検証する（復元は既存データを全消ししてから書き込むので、
 * 壊れた要素を通すと消した後に落ちて手元に何も残らない）。したがってヘルパーは
 * 仕様を満たす完全な値を返す。
 */
function storedTransaction(id: string): StoredTransaction {
  return {
    id,
    date: "2026-01-15",
    amountYen: -500,
    description: "セブンイレブン渋谷店",
    source: "card",
    category: "食費",
  };
}

function importRecord(id: string): ImportRecord {
  return {
    id,
    importedAt: "2026-01-20T09:00:00.000Z",
    fileName: "rakuten.csv",
    rawCsv: "日付,摘要,金額\n2026-01-15,セブンイレブン,500\n",
    mappingUsed: MAPPING,
    transactionCount: 1,
  };
}

// 列マッピングは name をキーに保存されるので、バックアップにも name が要る
// （当初 ColumnMapping と伝えたのは仕様の誤りだった）。
const MAPPING: NamedColumnMapping = {
  name: "テスト用",
  skipRows: 1,
  dateColumn: 0,
  amountColumn: 1,
  descriptionColumn: 2,
  source: "card",
  invertAmount: false,
};

const LEARNED: LearnedCategories = { セブンイレブン: "食費", 家賃: "住居費" };

const EXPORTED_AT = "2026-08-07T09:00:00.000Z";

function payload(overrides: Partial<BackupPayload> = {}): BackupPayload {
  return {
    transactions: [storedTransaction("t1"), storedTransaction("t2")],
    imports: [importRecord("i1")],
    columnMappings: [MAPPING],
    learnedCategories: LEARNED,
    ...overrides,
  };
}

function emptyPayload(): BackupPayload {
  return {
    transactions: [],
    imports: [],
    columnMappings: [],
    learnedCategories: {},
  };
}

/** 書き換えを試みた瞬間に TypeError で落ちるよう、配列・要素・オブジェクトを凍結する */
function freezeDeep(data: BackupPayload): BackupPayload {
  data.transactions.forEach((value) => Object.freeze(value));
  data.imports.forEach((value) => Object.freeze(value));
  data.columnMappings.forEach((value) => Object.freeze(value));
  Object.freeze(data.transactions);
  Object.freeze(data.imports);
  Object.freeze(data.columnMappings);
  Object.freeze(data.learnedCategories);
  Object.freeze(data);
  return data;
}

/** parseBackup が受け入れるべき、最小の正しいバックアップ */
function validObject(): Record<string, unknown> {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: EXPORTED_AT,
    transactions: [],
    imports: [],
    columnMappings: [],
    learnedCategories: {},
  };
}

function jsonWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...validObject(), ...overrides });
}

function jsonWithout(key: string): string {
  const base = validObject();
  delete base[key];
  return JSON.stringify(base);
}

/** 「その項目自体を持たない」ことを表す番兵。JSON では undefined を書けないため */
const MISSING = Symbol("missing");

/** 仕様を満たす要素の1項目だけを差し替える。MISSING ならキーごと消す */
function elementWith(
  base: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const element: Record<string, unknown> = { ...base };
  if (value === MISSING) {
    delete element[key];
  } else {
    element[key] = value;
  }
  return element;
}

const VALID_TRANSACTION: Record<string, unknown> = { ...storedTransaction("t1") };
const VALID_IMPORT: Record<string, unknown> = { ...importRecord("i1") };
const VALID_MAPPING: Record<string, unknown> = { ...MAPPING };

/** 要素がオブジェクトでない場合。JSON の配列要素に undefined は書けない */
const NON_OBJECTS: Array<[string, unknown]> = [
  ["null", null],
  ["空配列", []],
  ["要素のある配列", ["t1"]],
  ["文字列", "t1"],
  ["数値", 1],
  ["真偽値", true],
];

const NON_STRINGS: Array<[string, unknown]> = [
  ["数値", 1],
  ["null", null],
  ["真偽値", true],
  ["配列", ["x"]],
  ["オブジェクト", { value: "x" }],
  ["項目自体が無い", MISSING],
];

const NON_INTEGERS: Array<[string, unknown]> = [
  ["小数 1.5", 1.5],
  ["小数 -0.5", -0.5],
  ["小数 0.1", 0.1],
  ['数値ではなく文字列 "1"', "1"],
  ["null", null],
  ["真偽値", true],
  ["配列", [1]],
  ["オブジェクト", { value: 1 }],
  ["項目自体が無い", MISSING],
];

const BAD_SOURCES: Array<[string, unknown]> = [
  ["未知の値 credit", "credit"],
  ["大文字混じりの Card", "Card"],
  ['前後に空白のある " card "', " card "],
  ["空文字列", ""],
  ["3種を連結した文字列", "cardbankcash"],
  ["数値", 0],
  ["null", null],
  ["真偽値", true],
  ["配列", ["card"]],
  ["項目自体が無い", MISSING],
];

describe("BACKUP_FORMAT_VERSION", () => {
  it("現在の形式バージョンは 1", () => {
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });
});

describe("buildBackup", () => {
  it("formatVersion に BACKUP_FORMAT_VERSION を入れる", () => {
    expect(buildBackup(payload(), EXPORTED_AT).formatVersion).toBe(
      BACKUP_FORMAT_VERSION,
    );
  });

  describe("exportedAt は引数をそのまま入れる（関数内で現在時刻を取らない）", () => {
    it("渡した ISO 文字列がそのまま入る", () => {
      expect(buildBackup(payload(), EXPORTED_AT).exportedAt).toBe(EXPORTED_AT);
    });

    it("時計からは出てこない文字列でも、そのまま入る", () => {
      expect(buildBackup(payload(), "not-a-timestamp").exportedAt).toBe(
        "not-a-timestamp",
      );
    });

    it("空文字列でも、そのまま入る", () => {
      expect(buildBackup(payload(), "").exportedAt).toBe("");
    });

    it("引数を変えると exportedAt だけが変わる", () => {
      const first = buildBackup(payload(), "2020-01-01T00:00:00.000Z");
      const second = buildBackup(payload(), "2030-12-31T23:59:59.999Z");

      expect(first.exportedAt).toBe("2020-01-01T00:00:00.000Z");
      expect(second.exportedAt).toBe("2030-12-31T23:59:59.999Z");
      expect({ ...first, exportedAt: "" }).toEqual({ ...second, exportedAt: "" });
    });
  });

  describe("他のフィールドは引数の内容をそのまま持つ", () => {
    it("transactions / imports / columnMappings / learnedCategories がそのまま入る", () => {
      const data = payload();
      const backup = buildBackup(data, EXPORTED_AT);

      expect(backup.transactions).toEqual(data.transactions);
      expect(backup.imports).toEqual(data.imports);
      expect(backup.columnMappings).toEqual(data.columnMappings);
      expect(backup.learnedCategories).toEqual(data.learnedCategories);
    });

    it("要素の順序を保つ", () => {
      const data = payload({
        transactions: [
          storedTransaction("a"),
          storedTransaction("b"),
          storedTransaction("c"),
        ],
      });
      expect(buildBackup(data, EXPORTED_AT).transactions).toEqual([
        storedTransaction("a"),
        storedTransaction("b"),
        storedTransaction("c"),
      ]);
    });

    it("すべて空のデータでも、空のまま持つ", () => {
      const backup = buildBackup(emptyPayload(), EXPORTED_AT);

      expect(backup).toEqual({
        formatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: EXPORTED_AT,
        transactions: [],
        imports: [],
        columnMappings: [],
        learnedCategories: {},
      });
    });

    it("戻り値は formatVersion / exportedAt / 4つのデータだけを持つ", () => {
      expect(Object.keys(buildBackup(payload(), EXPORTED_AT)).sort()).toEqual([
        "columnMappings",
        "exportedAt",
        "formatVersion",
        "imports",
        "learnedCategories",
        "transactions",
      ]);
    });
  });

  describe("引数を書き換えない", () => {
    it("凍結したデータを渡しても、書き換えを試みない", () => {
      expect(() => buildBackup(freezeDeep(payload()), EXPORTED_AT)).not.toThrow();
    });

    it("呼び出しの前後で引数の内容が変わらない", () => {
      const data = payload();
      const snapshot = structuredClone(data);

      buildBackup(data, EXPORTED_AT);

      expect(data).toEqual(snapshot);
    });

    it("空のデータを凍結して渡しても、書き換えを試みない", () => {
      expect(() =>
        buildBackup(freezeDeep(emptyPayload()), EXPORTED_AT),
      ).not.toThrow();
    });
  });
});

describe("parseBackup", () => {
  describe("正常系", () => {
    it("buildBackup の結果を JSON にして読み直すと、同じ内容になる（往復）", () => {
      const built = buildBackup(payload(), EXPORTED_AT);
      expect(parseBackup(JSON.stringify(built))).toEqual(built);
    });

    it("すべて空のデータでも往復できる", () => {
      const built = buildBackup(emptyPayload(), EXPORTED_AT);
      expect(parseBackup(JSON.stringify(built))).toEqual(built);
    });

    it("手書きの JSON でも、各フィールドをその内容のまま返す", () => {
      const json = JSON.stringify({
        formatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: "1999-12-31T23:59:59.999Z",
        transactions: [storedTransaction("t1"), storedTransaction("t2")],
        imports: [{ id: "i1" }],
        columnMappings: [MAPPING],
        learnedCategories: { セブンイレブン: "食費" },
      });
      const parsed = parseBackup(json);

      expect(parsed.formatVersion).toBe(BACKUP_FORMAT_VERSION);
      expect(parsed.exportedAt).toBe("1999-12-31T23:59:59.999Z");
      expect(parsed.transactions).toEqual([
        storedTransaction("t1"),
        storedTransaction("t2"),
      ]);
      expect(parsed.imports).toEqual([{ id: "i1" }]);
      expect(parsed.columnMappings).toEqual([MAPPING]);
      expect(parsed.learnedCategories).toEqual({ セブンイレブン: "食費" });
    });

    it("exportedAt が空文字列でも受け入れる（文字列でありさえすればよい）", () => {
      expect(parseBackup(jsonWith({ exportedAt: "" })).exportedAt).toBe("");
    });

    it("learnedCategories が空オブジェクトでも受け入れる", () => {
      expect(parseBackup(jsonWith({ learnedCategories: {} })).learnedCategories).toEqual(
        {},
      );
    });
  });

  describe("JSON として不正なら例外", () => {
    it.each<[string, string]>([
      ["空文字列", ""],
      ["空白だけ", "   "],
      ["途中で切れたオブジェクト", '{"formatVersion":1'],
      ["クォートされていないキー", "{formatVersion:1}"],
      ["JSON ではない文字列", "not json at all"],
      ["undefined という文字列", "undefined"],
      ["末尾にゴミが付いている", `${JSON.stringify(validObject())}}`],
    ])("%s のとき例外を投げる", (_label, json) => {
      expect(() => parseBackup(json)).toThrow();
    });
  });

  describe("トップレベルがオブジェクトでなければ例外", () => {
    it.each<[string, string]>([
      ["配列", "[]"],
      ["要素のある配列", '[{"formatVersion":1}]'],
      ["数値", "1"],
      ["文字列", '"backup"'],
      ["null", "null"],
      ["真偽値", "true"],
    ])("%s のとき例外を投げる", (_label, json) => {
      expect(() => parseBackup(json)).toThrow();
    });

    it("オブジェクトなら受け入れる（対）", () => {
      expect(parseBackup(JSON.stringify(validObject())).formatVersion).toBe(
        BACKUP_FORMAT_VERSION,
      );
    });
  });

  describe("formatVersion の一致判定（境界の内外）", () => {
    it("BACKUP_FORMAT_VERSION と一致すれば受け入れる", () => {
      expect(
        parseBackup(jsonWith({ formatVersion: BACKUP_FORMAT_VERSION }))
          .formatVersion,
      ).toBe(BACKUP_FORMAT_VERSION);
    });

    it.each<[string, unknown]>([
      ["1つ小さい 0", 0],
      ["1つ大きい 2（将来の形式を黙って読まない）", 2],
      ["負の値 -1", -1],
      ["小数 1.5", 1.5],
      ["大きく離れた値 100", 100],
    ])("%s のとき例外を投げる", (_label, value) => {
      expect(() => parseBackup(jsonWith({ formatVersion: value }))).toThrow();
    });

    it.each<[string, unknown]>([
      ['数値ではなく文字列 "1"', "1"],
      ["null", null],
      ["真偽値 true", true],
      ["配列 [1]", [1]],
      ["オブジェクト", { version: 1 }],
    ])("%s のとき例外を投げる", (_label, value) => {
      expect(() => parseBackup(jsonWith({ formatVersion: value }))).toThrow();
    });

    it("キー自体が無いとき例外を投げる", () => {
      expect(() => parseBackup(jsonWithout("formatVersion"))).toThrow();
    });
  });

  describe("transactions / imports / columnMappings が配列でなければ例外", () => {
    const fields = ["transactions", "imports", "columnMappings"] as const;
    /** 「要素があっても受け入れる」側の対で使う、各フィールドらしい要素 */
    const sampleElement: Record<(typeof fields)[number], unknown> = {
      transactions: VALID_TRANSACTION,
      imports: { id: "i1" },
      columnMappings: VALID_MAPPING,
    };
    const nonArrays: Array<[string, unknown]> = [
      ["オブジェクト", {}],
      ["中身のあるオブジェクト", { 0: { id: "t1" } }],
      ["文字列", "[]"],
      ["数値", 0],
      ["null", null],
      ["真偽値", false],
    ];

    for (const field of fields) {
      describe(field, () => {
        it.each(nonArrays)("%s のとき例外を投げる", (_label, value) => {
          expect(() => parseBackup(jsonWith({ [field]: value }))).toThrow();
        });

        it("キー自体が無いとき例外を投げる", () => {
          expect(() => parseBackup(jsonWithout(field))).toThrow();
        });

        it("空配列なら受け入れる（対）", () => {
          expect(parseBackup(jsonWith({ [field]: [] }))[field]).toEqual([]);
        });

        it("要素のある配列なら受け入れる（対）", () => {
          const element = sampleElement[field];
          expect(parseBackup(jsonWith({ [field]: [element] }))[field]).toEqual([
            element,
          ]);
        });
      });
    }
  });

  describe("learnedCategories がオブジェクトでなければ例外", () => {
    it.each<[string, unknown]>([
      ["null（typeof null === \"object\" に引っかからないこと）", null],
      ["空配列", []],
      ["要素のある配列", ["食費"]],
      ["文字列", "食費"],
      ["数値", 0],
      ["真偽値", true],
    ])("%s のとき例外を投げる", (_label, value) => {
      expect(() => parseBackup(jsonWith({ learnedCategories: value }))).toThrow();
    });

    it("キー自体が無いとき例外を投げる", () => {
      expect(() => parseBackup(jsonWithout("learnedCategories"))).toThrow();
    });

    it("オブジェクトなら受け入れる（対）", () => {
      expect(
        parseBackup(jsonWith({ learnedCategories: { ローソン: "食費" } }))
          .learnedCategories,
      ).toEqual({ ローソン: "食費" });
    });
  });

  describe("exportedAt が文字列でなければ例外", () => {
    it.each<[string, unknown]>([
      ["数値（エポックミリ秒）", 1_754_557_200_000],
      ["null", null],
      ["真偽値", true],
      ["配列", ["2026-08-07T09:00:00.000Z"]],
      ["オブジェクト", { iso: "2026-08-07T09:00:00.000Z" }],
    ])("%s のとき例外を投げる", (_label, value) => {
      expect(() => parseBackup(jsonWith({ exportedAt: value }))).toThrow();
    });

    it("キー自体が無いとき例外を投げる", () => {
      expect(() => parseBackup(jsonWithout("exportedAt"))).toThrow();
    });

    it("文字列なら受け入れる（対）", () => {
      expect(
        parseBackup(jsonWith({ exportedAt: "2026-08-07T09:00:00.000Z" })).exportedAt,
      ).toBe("2026-08-07T09:00:00.000Z");
    });
  });

  describe("transactions の要素の検証", () => {
    /** 要素1件だけを差し替えた JSON。他のフィールドはすべて正しい */
    function txJson(element: unknown): string {
      return jsonWith({ transactions: [element] });
    }

    it("仕様を満たす要素は、そのまま返る（対）", () => {
      expect(parseBackup(txJson(VALID_TRANSACTION)).transactions).toEqual([
        VALID_TRANSACTION,
      ]);
    });

    it("空配列なら、要素の検証をする対象が無いので受け入れる", () => {
      expect(parseBackup(jsonWith({ transactions: [] })).transactions).toEqual([]);
    });

    describe("要素がオブジェクトでなければ例外", () => {
      it.each(NON_OBJECTS)("%s のとき例外を投げる", (_label, value) => {
        expect(() => parseBackup(txJson(value))).toThrow();
      });

      it("空オブジェクト（必須項目が1つも無い）のとき例外を投げる", () => {
        expect(() => parseBackup(txJson({}))).toThrow();
      });
    });

    describe.each(["id", "date", "description", "category"])("%s は文字列", (field) => {
      it("文字列なら受け入れる（対）", () => {
        const element = elementWith(VALID_TRANSACTION, field, "任意の文字列");
        expect(parseBackup(txJson(element)).transactions).toEqual([element]);
      });

      it("空文字列でも受け入れる（文字列でありさえすればよい）", () => {
        const element = elementWith(VALID_TRANSACTION, field, "");
        expect(parseBackup(txJson(element)).transactions).toEqual([element]);
      });

      it.each(NON_STRINGS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(txJson(elementWith(VALID_TRANSACTION, field, value))),
        ).toThrow();
      });
    });

    describe("amountYen は整数", () => {
      it.each<[string, number]>([
        ["0", 0],
        ["正の整数 1", 1],
        ["負の整数 -1", -1],
        ["負の整数 -500", -500],
        ["安全整数の上限", Number.MAX_SAFE_INTEGER],
        ["安全整数の下限", Number.MIN_SAFE_INTEGER],
      ])("%s なら受け入れる（対）", (_label, value) => {
        const element = elementWith(VALID_TRANSACTION, "amountYen", value);
        expect(parseBackup(txJson(element)).transactions).toEqual([element]);
      });

      it.each(NON_INTEGERS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(txJson(elementWith(VALID_TRANSACTION, "amountYen", value))),
        ).toThrow();
      });

      it("1 は通り 1.5 は通らない（整数かどうかだけで分かれる）", () => {
        expect(() =>
          parseBackup(txJson(elementWith(VALID_TRANSACTION, "amountYen", 1))),
        ).not.toThrow();
        expect(() =>
          parseBackup(txJson(elementWith(VALID_TRANSACTION, "amountYen", 1.5))),
        ).toThrow();
      });

      it("Infinity（有限でない数値）のとき例外を投げる", () => {
        // NaN / Infinity は JSON.stringify では書けないので、生の JSON を組み立てる。
        // 1e999 は JSON として正しい数値リテラルで、parse すると Infinity になる。
        const raw = `{"formatVersion":${BACKUP_FORMAT_VERSION},"exportedAt":"${EXPORTED_AT}","transactions":[{"id":"t1","date":"2026-01-15","description":"セブン","category":"食費","source":"card","amountYen":1e999}],"imports":[],"columnMappings":[],"learnedCategories":{}}`;
        expect(() => parseBackup(raw)).toThrow();
      });
    });

    describe("source は card / bank / cash のいずれか", () => {
      it.each(["card", "bank", "cash"])("%s なら受け入れる（対）", (value) => {
        const element = elementWith(VALID_TRANSACTION, "source", value);
        expect(parseBackup(txJson(element)).transactions).toEqual([element]);
      });

      it.each(BAD_SOURCES)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(txJson(elementWith(VALID_TRANSACTION, "source", value))),
        ).toThrow();
      });
    });

    describe("複数要素のうち1つでも違反すれば例外", () => {
      const broken = elementWith(VALID_TRANSACTION, "amountYen", 1.5);
      const ok = (id: string): Record<string, unknown> =>
        elementWith(VALID_TRANSACTION, "id", id);

      it("3件すべて正しければ受け入れる（対）", () => {
        const elements = [ok("a"), ok("b"), ok("c")];
        expect(parseBackup(jsonWith({ transactions: elements })).transactions).toEqual(
          elements,
        );
      });

      it.each<[string, Array<Record<string, unknown>>]>([
        ["先頭だけが壊れている", [broken, ok("b"), ok("c")]],
        ["中間だけが壊れている", [ok("a"), broken, ok("c")]],
        ["末尾だけが壊れている", [ok("a"), ok("b"), broken]],
      ])("%s とき例外を投げる", (_label, elements) => {
        expect(() => parseBackup(jsonWith({ transactions: elements }))).toThrow();
      });
    });
  });

  describe("columnMappings の要素の検証", () => {
    function mappingJson(element: unknown): string {
      return jsonWith({ columnMappings: [element] });
    }

    it("仕様を満たす要素は、そのまま返る（対）", () => {
      expect(parseBackup(mappingJson(VALID_MAPPING)).columnMappings).toEqual([
        VALID_MAPPING,
      ]);
    });

    it("空配列なら受け入れる", () => {
      expect(parseBackup(jsonWith({ columnMappings: [] })).columnMappings).toEqual([]);
    });

    describe("要素がオブジェクトでなければ例外", () => {
      it.each(NON_OBJECTS)("%s のとき例外を投げる", (_label, value) => {
        expect(() => parseBackup(mappingJson(value))).toThrow();
      });

      it("空オブジェクトのとき例外を投げる", () => {
        expect(() => parseBackup(mappingJson({}))).toThrow();
      });
    });

    describe("name は文字列", () => {
      it("文字列なら受け入れる（対）", () => {
        const element = elementWith(VALID_MAPPING, "name", "三菱UFJ銀行");
        expect(parseBackup(mappingJson(element)).columnMappings).toEqual([element]);
      });

      it("空文字列でも受け入れる", () => {
        const element = elementWith(VALID_MAPPING, "name", "");
        expect(parseBackup(mappingJson(element)).columnMappings).toEqual([element]);
      });

      it.each(NON_STRINGS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(mappingJson(elementWith(VALID_MAPPING, "name", value))),
        ).toThrow();
      });
    });

    /**
     * 負値を弾くのは型の綺麗さのためではない。skipRows が負だと取り込み時の
     * rows.slice(skipRows) が末尾だけを取り込み、残りをエラーも出さずに捨てる。
     * 列インデックスの負値も同じ理由でここで止める。
     */
    describe.each(["skipRows", "dateColumn", "amountColumn", "descriptionColumn"])(
      "%s は0以上の整数",
      (field) => {
        it.each<[string, number]>([
          ["下限ちょうどの 0", 0],
          ["1", 1],
          ["大きい整数 99", 99],
          ["安全整数の上限", Number.MAX_SAFE_INTEGER],
        ])("%s なら受け入れる（対）", (_label, value) => {
          const element = elementWith(VALID_MAPPING, field, value);
          expect(parseBackup(mappingJson(element)).columnMappings).toEqual([element]);
        });

        it.each(NON_INTEGERS)("%s のとき例外を投げる", (_label, value) => {
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, value))),
          ).toThrow();
        });

        it.each<[string, number]>([
          ["下限のすぐ外側 -1", -1],
          ["大きい負値 -100", -100],
          ["安全整数の下限", Number.MIN_SAFE_INTEGER],
        ])("整数でも負の値 %s なら例外を投げる", (_label, value) => {
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, value))),
          ).toThrow();
        });

        it("0 は通り 0.5 は通らない（整数かどうかで分かれる）", () => {
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, 0))),
          ).not.toThrow();
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, 0.5))),
          ).toThrow();
        });

        it("0 は通り -1 は通らない（下限の内と外で分かれる）", () => {
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, 0))),
          ).not.toThrow();
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, -1))),
          ).toThrow();
        });

        it("1 は通り -1 は通らない（絶対値ではなく符号で分かれる）", () => {
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, 1))),
          ).not.toThrow();
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, -1))),
          ).toThrow();
        });
      },
    );

    describe("4つの数値項目は、他が正しくても1つが負なら例外", () => {
      it.each(["skipRows", "dateColumn", "amountColumn", "descriptionColumn"])(
        "%s だけが -1 のとき例外を投げる",
        (field) => {
          expect(() =>
            parseBackup(mappingJson(elementWith(VALID_MAPPING, field, -1))),
          ).toThrow();
        },
      );

      it("4つすべてが 0 なら受け入れる（対）", () => {
        const element = {
          ...VALID_MAPPING,
          skipRows: 0,
          dateColumn: 0,
          amountColumn: 0,
          descriptionColumn: 0,
        };
        expect(parseBackup(mappingJson(element)).columnMappings).toEqual([element]);
      });

      it("4つすべてが -1 のとき例外を投げる", () => {
        const element = {
          ...VALID_MAPPING,
          skipRows: -1,
          dateColumn: -1,
          amountColumn: -1,
          descriptionColumn: -1,
        };
        expect(() => parseBackup(mappingJson(element))).toThrow();
      });
    });

    describe("invertAmount は真偽値", () => {
      it.each([true, false])("%s なら受け入れる（対）", (value) => {
        const element = elementWith(VALID_MAPPING, "invertAmount", value);
        expect(parseBackup(mappingJson(element)).columnMappings).toEqual([element]);
      });

      it.each<[string, unknown]>([
        ['文字列 "true"', "true"],
        ['文字列 "false"', "false"],
        ["空文字列", ""],
        ["数値 1", 1],
        ["数値 0", 0],
        ["null", null],
        ["配列", [true]],
        ["オブジェクト", { value: true }],
        ["項目自体が無い", MISSING],
      ])("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(mappingJson(elementWith(VALID_MAPPING, "invertAmount", value))),
        ).toThrow();
      });
    });

    describe("source は card / bank / cash のいずれか", () => {
      it.each(["card", "bank", "cash"])("%s なら受け入れる（対）", (value) => {
        const element = elementWith(VALID_MAPPING, "source", value);
        expect(parseBackup(mappingJson(element)).columnMappings).toEqual([element]);
      });

      it.each(BAD_SOURCES)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(mappingJson(elementWith(VALID_MAPPING, "source", value))),
        ).toThrow();
      });
    });

    describe("複数要素のうち1つでも違反すれば例外", () => {
      const broken = elementWith(VALID_MAPPING, "invertAmount", "true");
      const ok = (name: string): Record<string, unknown> =>
        elementWith(VALID_MAPPING, "name", name);

      it("2件とも正しければ受け入れる（対）", () => {
        const elements = [ok("A"), ok("B")];
        expect(parseBackup(jsonWith({ columnMappings: elements })).columnMappings).toEqual(
          elements,
        );
      });

      const negative = elementWith(VALID_MAPPING, "skipRows", -1);

      it.each<[string, Array<Record<string, unknown>>]>([
        ["先頭だけが壊れている", [broken, ok("B")]],
        ["末尾だけが壊れている", [ok("A"), broken]],
        ["先頭だけ skipRows が負", [negative, ok("B")]],
        ["末尾だけ skipRows が負", [ok("A"), negative]],
      ])("%s とき例外を投げる", (_label, elements) => {
        expect(() => parseBackup(jsonWith({ columnMappings: elements }))).toThrow();
      });
    });
  });

  describe("imports の要素の検証", () => {
    function importJson(element: unknown): string {
      return jsonWith({ imports: [element] });
    }

    it("仕様を満たす要素は、そのまま返る（対）", () => {
      expect(parseBackup(importJson(VALID_IMPORT)).imports).toEqual([VALID_IMPORT]);
    });

    it("空配列なら受け入れる", () => {
      expect(parseBackup(jsonWith({ imports: [] })).imports).toEqual([]);
    });

    describe("要素がオブジェクトでなければ例外", () => {
      it.each(NON_OBJECTS)("%s のとき例外を投げる", (_label, value) => {
        expect(() => parseBackup(importJson(value))).toThrow();
      });

      it("空オブジェクト（id が無い）のとき例外を投げる", () => {
        expect(() => parseBackup(importJson({}))).toThrow();
      });
    });

    describe("id は文字列", () => {
      it("文字列なら受け入れる（対）", () => {
        const element = elementWith(VALID_IMPORT, "id", "i-42");
        expect(parseBackup(importJson(element)).imports).toEqual([element]);
      });

      it("空文字列でも受け入れる", () => {
        const element = elementWith(VALID_IMPORT, "id", "");
        expect(parseBackup(importJson(element)).imports).toEqual([element]);
      });

      it.each(NON_STRINGS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(importJson(elementWith(VALID_IMPORT, "id", value))),
        ).toThrow();
      });
    });

    it("id 以外の項目は検証しない：id だけの要素でも受け入れる", () => {
      expect(parseBackup(importJson({ id: "i1" })).imports).toEqual([{ id: "i1" }]);
    });

    describe("複数要素のうち1つでも違反すれば例外", () => {
      it("2件とも正しければ受け入れる（対）", () => {
        const elements = [{ id: "i1" }, { id: "i2" }];
        expect(parseBackup(jsonWith({ imports: elements })).imports).toEqual(elements);
      });

      it.each<[string, unknown[]]>([
        ["先頭だけが壊れている", [{ id: 1 }, { id: "i2" }]],
        ["末尾だけが壊れている", [{ id: "i1" }, { id: 1 }]],
        ["末尾が null", [{ id: "i1" }, null]],
      ])("%s とき例外を投げる", (_label, elements) => {
        expect(() => parseBackup(jsonWith({ imports: elements }))).toThrow();
      });
    });
  });

  describe("learnedCategories の中身は検証しない", () => {
    it("値が文字列でなくても受け入れ、そのまま返す", () => {
      const learned = { セブンイレブン: 123, ローソン: null, 家賃: { nested: true } };
      expect(parseBackup(jsonWith({ learnedCategories: learned })).learnedCategories).toEqual(
        learned,
      );
    });

    it("キーが空文字列でも受け入れる", () => {
      expect(
        parseBackup(jsonWith({ learnedCategories: { "": "未分類" } })).learnedCategories,
      ).toEqual({ "": "未分類" });
    });
  });

  describe("複数の項目が同時に壊れていても例外", () => {
    it("formatVersion と transactions が両方おかしいとき例外を投げる", () => {
      expect(() =>
        parseBackup(jsonWith({ formatVersion: 2, transactions: null })),
      ).toThrow();
    });

    it("空オブジェクトのとき例外を投げる", () => {
      expect(() => parseBackup("{}")).toThrow();
    });

    it("3つの配列すべてに要素があり、すべて正しければ受け入れる（対）", () => {
      const json = jsonWith({
        transactions: [VALID_TRANSACTION],
        imports: [VALID_IMPORT],
        columnMappings: [VALID_MAPPING],
        learnedCategories: LEARNED,
      });
      const parsed = parseBackup(json);

      expect(parsed.transactions).toEqual([VALID_TRANSACTION]);
      expect(parsed.imports).toEqual([VALID_IMPORT]);
      expect(parsed.columnMappings).toEqual([VALID_MAPPING]);
      expect(parsed.learnedCategories).toEqual(LEARNED);
    });

    it.each<[string, Record<string, unknown>]>([
      [
        "transactions の要素だけが壊れている",
        { transactions: [elementWith(VALID_TRANSACTION, "source", "credit")] },
      ],
      [
        "imports の要素だけが壊れている",
        { imports: [elementWith(VALID_IMPORT, "id", 1)] },
      ],
      [
        "columnMappings の要素だけが壊れている",
        { columnMappings: [elementWith(VALID_MAPPING, "skipRows", 1.5)] },
      ],
      [
        "columnMappings の要素の skipRows だけが負",
        { columnMappings: [elementWith(VALID_MAPPING, "skipRows", -1)] },
      ],
      [
        "columnMappings の要素の dateColumn だけが負",
        { columnMappings: [elementWith(VALID_MAPPING, "dateColumn", -1)] },
      ],
    ])("他の2つの配列が正しくても、%s なら例外を投げる", (_label, override) => {
      const json = jsonWith({
        transactions: [VALID_TRANSACTION],
        imports: [VALID_IMPORT],
        columnMappings: [VALID_MAPPING],
        ...override,
      });
      expect(() => parseBackup(json)).toThrow();
    });
  });
});
