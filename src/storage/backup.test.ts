import { describe, it, expect } from "vitest";
import type {
  StoredTransaction,
  ImportRecord,
  NamedColumnMapping,
  CategoryRecord,
  BudgetRecord,
} from "./schema.js";
import type { LearnedCategories } from "../category/classify.js";
import { defaultCategories } from "../category/default-categories.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
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
    memo: "",
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

const CATEGORY: CategoryRecord = { name: "食費", color: "#2fbf6b", order: 0 };

const BUDGET: BudgetRecord = {
  id: "2026-01:食費",
  month: "2026-01",
  category: "食費",
  amountYen: 60000,
};

const EXPORTED_AT = "2026-08-07T09:00:00.000Z";

function payload(overrides: Partial<BackupPayload> = {}): BackupPayload {
  return {
    transactions: [storedTransaction("t1"), storedTransaction("t2")],
    imports: [importRecord("i1")],
    columnMappings: [MAPPING],
    learnedCategories: LEARNED,
    categories: [CATEGORY],
    budgets: [BUDGET],
    ...overrides,
  };
}

function emptyPayload(): BackupPayload {
  return {
    transactions: [],
    imports: [],
    columnMappings: [],
    learnedCategories: {},
    categories: [],
    budgets: [],
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
    categories: [],
    budgets: [],
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
  it("現在の形式バージョンは 2", () => {
    expect(BACKUP_FORMAT_VERSION).toBe(2);
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
        categories: [],
        budgets: [],
      });
    });

    it("戻り値は formatVersion / exportedAt / 6つのデータだけを持つ", () => {
      expect(Object.keys(buildBackup(payload(), EXPORTED_AT)).sort()).toEqual([
        "budgets",
        "categories",
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
        categories: [CATEGORY],
        budgets: [BUDGET],
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
      expect(parsed.categories).toEqual([CATEGORY]);
      expect(parsed.budgets).toEqual([BUDGET]);
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
      ["読める最小より1つ小さい 0", 0],
      ["読める最大より1つ大きい 3（将来の形式を黙って読まない）", 3],
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

/* ------------------------------------------------------------------ *
 * v2（categories / budgets / memo の追加）
 * ------------------------------------------------------------------ */

const VALID_CATEGORY: Record<string, unknown> = { ...CATEGORY };
const VALID_BUDGET: Record<string, unknown> = { ...BUDGET };

/** v1 の取引。memo を持たない */
const V1_TRANSACTION: Record<string, unknown> = elementWith(
  VALID_TRANSACTION,
  "memo",
  MISSING,
);

/** v1 を読んだときに categories に入るべき既定値 */
const DEFAULTS = defaultCategories(DEFAULT_CATEGORY_RULES);

/** v2 の最小の正しいバックアップ。categories / budgets が必須 */
function v2Object(): Record<string, unknown> {
  return {
    formatVersion: 2,
    exportedAt: EXPORTED_AT,
    transactions: [],
    imports: [],
    columnMappings: [],
    learnedCategories: {},
    categories: [VALID_CATEGORY],
    budgets: [VALID_BUDGET],
  };
}

function v2Json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...v2Object(), ...overrides });
}

function v2JsonWithout(key: string): string {
  const base = v2Object();
  delete base[key];
  return JSON.stringify(base);
}

/** v1 のファイル。categories / budgets / memo のフィールドがそもそも無い */
function v1Object(): Record<string, unknown> {
  return {
    formatVersion: 1,
    exportedAt: EXPORTED_AT,
    transactions: [],
    imports: [],
    columnMappings: [],
    learnedCategories: {},
  };
}

function v1Json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...v1Object(), ...overrides });
}

/**
 * JSON に Infinity のリテラルは書けないので、置換で 1e999 を埋め込む
 * （JSON.parse すると Infinity になる）。NaN は JSON では表現できないため、
 * 文字列を入力に取る parseBackup では到達できない。
 */
const INFINITY_TOKEN = "__INFINITY__";
const NEG_INFINITY_TOKEN = "__NEG_INFINITY__";

function withInfinities(json: string): string {
  return json
    .replaceAll(`"${INFINITY_TOKEN}"`, "1e999")
    .replaceAll(`"${NEG_INFINITY_TOKEN}"`, "-1e999");
}

const NON_ARRAYS: Array<[string, unknown]> = [
  ["オブジェクト", {}],
  ["中身のあるオブジェクト", { 0: { name: "食費" } }],
  ['文字列 "[]"', "[]"],
  ["数値", 0],
  ["null", null],
  ["真偽値", false],
];

const VALID_COLORS: string[] = [
  "#2fbf6b",
  "#000000",
  "#ffffff",
  "#123456",
  "#ABCDEF",
  "#AbCdEf",
];

const INVALID_COLORS: Array<[string, unknown]> = [
  ["色名 red", "red"],
  ["3桁の短縮形 #fff", "#fff"],
  ["16進数でない #gggggg", "#gggggg"],
  ["# の無い 2fbf6b", "2fbf6b"],
  ["空文字列", ""],
  ["# だけ", "#"],
  ['末尾に空白 "#2fbf6b "', "#2fbf6b "],
  ['先頭に空白 " #2fbf6b"', " #2fbf6b"],
  ["5桁 #12345", "#12345"],
  ["7桁 #2fbf6bb", "#2fbf6bb"],
  ["rgb() 記法", "rgb(47,191,107)"],
];

const VALID_ORDERS: Array<[string, number]> = [
  ["0", 0],
  ["1", 1],
  ["大きい整数 999", 999],
  ["負の整数 -1", -1],
  ["大きい負の整数 -999", -999],
  ["安全整数の上限", Number.MAX_SAFE_INTEGER],
  ["安全整数の下限", Number.MIN_SAFE_INTEGER],
];

describe("v2 形式", () => {
  describe("formatVersion は 1 と 2 のどちらも読める", () => {
    it("v2 を受け入れる", () => {
      expect(() => parseBackup(v2Json())).not.toThrow();
    });

    it("v1 を受け入れる", () => {
      expect(() => parseBackup(v1Json())).not.toThrow();
    });

    it.each<[string, unknown]>([
      ["1つ小さい 0（下限のすぐ外）", 0],
      ["1つ大きい 3（将来の形式を黙って読まない）", 3],
      ["負の値 -1", -1],
      ["小数 1.5", 1.5],
      ["小数 2.5", 2.5],
      ["大きく離れた値 100", 100],
    ])("%s のとき例外を投げる", (_label, value) => {
      expect(() => parseBackup(v2Json({ formatVersion: value }))).toThrow();
    });

    it.each<[string, unknown]>([
      ['数値ではなく文字列 "2"', "2"],
      ['数値ではなく文字列 "1"', "1"],
      ["null", null],
      ["真偽値 true", true],
      ["配列 [2]", [2]],
      ["オブジェクト", { version: 2 }],
    ])("%s のとき例外を投げる", (_label, value) => {
      expect(() => parseBackup(v2Json({ formatVersion: value }))).toThrow();
    });

    it("キー自体が無いとき例外を投げる", () => {
      expect(() => parseBackup(v2JsonWithout("formatVersion"))).toThrow();
    });

    it("1 は通り 0 は通らない（下限の内と外）", () => {
      expect(() => parseBackup(v1Json({ formatVersion: 1 }))).not.toThrow();
    });

    // 読み替えた結果を 2 に繰り上げない。どのバージョンのファイルから来たかは、
    // 復元後に問題が出たときの手掛かりになる。
    it("v1 を読んだ結果の formatVersion は 1 のまま", () => {
      expect(parseBackup(v1Json()).formatVersion).toBe(1);
      expect(() => parseBackup(v1Json({ formatVersion: 0 }))).toThrow();
    });

    it("2 は通り 3 は通らない（上限の内と外）", () => {
      expect(() => parseBackup(v2Json({ formatVersion: 2 }))).not.toThrow();
      expect(() => parseBackup(v2Json({ formatVersion: 3 }))).toThrow();
    });
  });

  describe("v1 に無いフィールドを埋める", () => {
    it("categories は defaultCategories(DEFAULT_CATEGORY_RULES) と同じ内容になる", () => {
      expect(parseBackup(v1Json()).categories).toEqual(DEFAULTS);
    });

    it("埋めた categories は空ではない（両方が空で一致しただけ、を排除する）", () => {
      expect(parseBackup(v1Json()).categories.length).toBeGreaterThan(0);
    });

    it("budgets は空配列になる", () => {
      expect(parseBackup(v1Json()).budgets).toEqual([]);
    });

    it("取引の memo は空文字列になる", () => {
      expect(parseBackup(v1Json({ transactions: [V1_TRANSACTION] })).transactions).toEqual(
        [{ ...V1_TRANSACTION, memo: "" }],
      );
    });

    it("取引が複数あっても、すべての memo が空文字列になる", () => {
      const elements = [
        elementWith(V1_TRANSACTION, "id", "t1"),
        elementWith(V1_TRANSACTION, "id", "t2"),
        elementWith(V1_TRANSACTION, "id", "t3"),
      ];
      const parsed = parseBackup(v1Json({ transactions: elements }));

      expect(parsed.transactions.map((transaction) => transaction.memo)).toEqual([
        "",
        "",
        "",
      ]);
    });

    it("v1 の他のフィールドはそのまま残る", () => {
      const parsed = parseBackup(
        v1Json({
          transactions: [V1_TRANSACTION],
          imports: [VALID_IMPORT],
          columnMappings: [VALID_MAPPING],
          learnedCategories: LEARNED,
        }),
      );

      expect(parsed.imports).toEqual([VALID_IMPORT]);
      expect(parsed.columnMappings).toEqual([VALID_MAPPING]);
      expect(parsed.learnedCategories).toEqual(LEARNED);
      expect(parsed.exportedAt).toBe(EXPORTED_AT);
    });
  });

  describe("v1 では categories / budgets のフィールドを見ない", () => {
    it("categories が書いてあっても無視して既定値にする", () => {
      const written = [{ name: "書いてあるカテゴリ", color: "#111111", order: 0 }];
      const parsed = parseBackup(v1Json({ categories: written }));

      expect(parsed.categories).toEqual(DEFAULTS);
      expect(parsed.categories).not.toEqual(written);
    });

    it("budgets が書いてあっても無視して空配列にする", () => {
      expect(parseBackup(v1Json({ budgets: [VALID_BUDGET] })).budgets).toEqual([]);
    });

    it.each<[string, unknown]>([
      ["配列ですらない文字列", "not an array"],
      ["null", null],
      ["数値", 0],
      ["オブジェクト", {}],
      ["要素が壊れた配列", [{ name: "", color: "red", order: 1.5 }]],
      ["要素が null の配列", [null]],
    ])("categories が %s でも、v1 なら例外にならず既定値になる", (_label, value) => {
      expect(parseBackup(v1Json({ categories: value })).categories).toEqual(DEFAULTS);
    });

    it.each<[string, unknown]>([
      ["配列ですらない文字列", "not an array"],
      ["null", null],
      ["数値", 0],
      ["オブジェクト", {}],
      ["amountYen が 0 の要素を含む配列", [{ ...BUDGET, amountYen: 0 }]],
      ["要素が null の配列", [null]],
    ])("budgets が %s でも、v1 なら例外にならず空配列になる", (_label, value) => {
      expect(parseBackup(v1Json({ budgets: value })).budgets).toEqual([]);
    });
  });

  describe("v2 では categories / budgets が必須", () => {
    it.each(["categories", "budgets"])("%s のキーが無いとき例外を投げる", (field) => {
      expect(() => parseBackup(v2JsonWithout(field))).toThrow();
    });

    describe.each(["categories", "budgets"])("%s が配列でなければ例外", (field) => {
      it.each(NON_ARRAYS)("%s のとき例外を投げる", (_label, value) => {
        expect(() => parseBackup(v2Json({ [field]: value }))).toThrow();
      });

      it("空配列なら受け入れる（対）", () => {
        expect(parseBackup(v2Json({ [field]: [] }))[field as "categories"]).toEqual([]);
      });
    });

    it("両方に要素があり、すべて正しければそのまま返る（対）", () => {
      const parsed = parseBackup(v2Json());

      expect(parsed.categories).toEqual([VALID_CATEGORY]);
      expect(parsed.budgets).toEqual([VALID_BUDGET]);
    });
  });

  describe("v2 の categories の要素の検証", () => {
    function catJson(element: unknown): string {
      return v2Json({ categories: [element] });
    }

    it("仕様を満たす要素は、そのまま返る（対）", () => {
      expect(parseBackup(catJson(VALID_CATEGORY)).categories).toEqual([VALID_CATEGORY]);
    });

    describe("要素がオブジェクトでなければ例外", () => {
      it.each(NON_OBJECTS)("%s のとき例外を投げる", (_label, value) => {
        expect(() => parseBackup(catJson(value))).toThrow();
      });

      it("空オブジェクト（必須項目が1つも無い）のとき例外を投げる", () => {
        expect(() => parseBackup(catJson({}))).toThrow();
      });
    });

    describe("name は空でない文字列", () => {
      it.each(["食費", "交際費", " ", "a", "0"])("%s なら受け入れる（対）", (value) => {
        const element = elementWith(VALID_CATEGORY, "name", value);
        expect(parseBackup(catJson(element)).categories).toEqual([element]);
      });

      it("空文字列のとき例外を投げる（他の項目と違い、空は許さない）", () => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "name", ""))),
        ).toThrow();
      });

      it.each(NON_STRINGS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "name", value))),
        ).toThrow();
      });

      it('"a" は通り "" は通らない（長さ0かどうかで分かれる）', () => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "name", "a"))),
        ).not.toThrow();
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "name", ""))),
        ).toThrow();
      });
    });

    describe("color は #rrggbb 形式", () => {
      it.each(VALID_COLORS)("%s なら受け入れる（対）", (value) => {
        const element = elementWith(VALID_CATEGORY, "color", value);
        expect(parseBackup(catJson(element)).categories).toEqual([element]);
      });

      it.each(INVALID_COLORS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "color", value))),
        ).toThrow();
      });

      it.each(NON_STRINGS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "color", value))),
        ).toThrow();
      });

      it("大文字 #ABCDEF は通り、16進でない #GGGGGG は通らない", () => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "color", "#ABCDEF"))),
        ).not.toThrow();
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "color", "#GGGGGG"))),
        ).toThrow();
      });

      it('"#2fbf6b" は通り、末尾に空白を足した "#2fbf6b " は通らない（前後の余りを許さない）', () => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "color", "#2fbf6b"))),
        ).not.toThrow();
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "color", "#2fbf6b "))),
        ).toThrow();
      });
    });

    describe("order は整数（負も可）", () => {
      it.each(VALID_ORDERS)("%s なら受け入れる（対）", (_label, value) => {
        const element = elementWith(VALID_CATEGORY, "order", value);
        expect(parseBackup(catJson(element)).categories).toEqual([element]);
      });

      it.each(NON_INTEGERS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "order", value))),
        ).toThrow();
      });

      it.each<[string, string]>([
        ["Infinity", INFINITY_TOKEN],
        ["-Infinity", NEG_INFINITY_TOKEN],
      ])("%s のとき例外を投げる", (_label, token) => {
        const json = withInfinities(catJson(elementWith(VALID_CATEGORY, "order", token)));
        expect(() => parseBackup(json)).toThrow();
      });

      it("-1 は通り -1.5 は通らない（符号ではなく整数かどうかで分かれる）", () => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "order", -1))),
        ).not.toThrow();
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "order", -1.5))),
        ).toThrow();
      });

      it("0 と -1 の両方が通る（下限を 0 にしていないこと）", () => {
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "order", 0))),
        ).not.toThrow();
        expect(() =>
          parseBackup(catJson(elementWith(VALID_CATEGORY, "order", -1))),
        ).not.toThrow();
      });
    });

    describe("複数要素のうち1つでも違反すれば例外", () => {
      const ok = (name: string): Record<string, unknown> =>
        elementWith(VALID_CATEGORY, "name", name);
      const broken = elementWith(VALID_CATEGORY, "color", "red");

      it("3件すべて正しければ受け入れる（対）", () => {
        const elements = [ok("食費"), ok("住居費"), ok("交通費")];
        expect(parseBackup(v2Json({ categories: elements })).categories).toEqual(elements);
      });

      it.each<[string, Array<Record<string, unknown>>]>([
        ["先頭だけが壊れている", [broken, ok("住居費"), ok("交通費")]],
        ["中間だけが壊れている", [ok("食費"), broken, ok("交通費")]],
        ["末尾だけが壊れている", [ok("食費"), ok("住居費"), broken]],
      ])("%s とき例外を投げる", (_label, elements) => {
        expect(() => parseBackup(v2Json({ categories: elements }))).toThrow();
      });
    });
  });

  describe("v2 の budgets の要素の検証", () => {
    function budgetJson(element: unknown): string {
      return v2Json({ budgets: [element] });
    }

    it("仕様を満たす要素は、そのまま返る（対）", () => {
      expect(parseBackup(budgetJson(VALID_BUDGET)).budgets).toEqual([VALID_BUDGET]);
    });

    describe("要素がオブジェクトでなければ例外", () => {
      it.each(NON_OBJECTS)("%s のとき例外を投げる", (_label, value) => {
        expect(() => parseBackup(budgetJson(value))).toThrow();
      });

      it("空オブジェクト（必須項目が1つも無い）のとき例外を投げる", () => {
        expect(() => parseBackup(budgetJson({}))).toThrow();
      });
    });

    describe.each(["id", "month", "category"])("%s は文字列", (field) => {
      it("文字列なら受け入れる（対）", () => {
        const element = elementWith(VALID_BUDGET, field, "任意の文字列");
        expect(parseBackup(budgetJson(element)).budgets).toEqual([element]);
      });

      it("空文字列でも受け入れる（文字列でありさえすればよい）", () => {
        const element = elementWith(VALID_BUDGET, field, "");
        expect(parseBackup(budgetJson(element)).budgets).toEqual([element]);
      });

      it.each(NON_STRINGS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, field, value))),
        ).toThrow();
      });
    });

    describe("3つの文字列項目は、他が正しくても1つが数値なら例外", () => {
      it.each(["id", "month", "category"])("%s だけが数値のとき例外を投げる", (field) => {
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, field, 1))),
        ).toThrow();
      });
    });

    describe("amountYen は 1 以上の整数", () => {
      it.each<[string, number]>([
        ["下限ちょうどの 1", 1],
        ["2", 2],
        ["60000", 60_000],
        ["安全整数の上限", Number.MAX_SAFE_INTEGER],
      ])("%s なら受け入れる（対）", (_label, value) => {
        const element = elementWith(VALID_BUDGET, "amountYen", value);
        expect(parseBackup(budgetJson(element)).budgets).toEqual([element]);
      });

      it.each<[string, number]>([
        ["下限のすぐ外側 0", 0],
        ["-1", -1],
        ["-60000", -60_000],
        ["安全整数の下限", Number.MIN_SAFE_INTEGER],
      ])("整数でも %s なら例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, "amountYen", value))),
        ).toThrow();
      });

      it.each(NON_INTEGERS)("%s のとき例外を投げる", (_label, value) => {
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, "amountYen", value))),
        ).toThrow();
      });

      it.each<[string, string]>([
        ["Infinity", INFINITY_TOKEN],
        ["-Infinity", NEG_INFINITY_TOKEN],
      ])("%s のとき例外を投げる", (_label, token) => {
        const json = withInfinities(
          budgetJson(elementWith(VALID_BUDGET, "amountYen", token)),
        );
        expect(() => parseBackup(json)).toThrow();
      });

      it("1 は通り 0 は通らない（下限の内と外）", () => {
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, "amountYen", 1))),
        ).not.toThrow();
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, "amountYen", 0))),
        ).toThrow();
      });

      it("1 は通り 1.5 は通らない（整数かどうかで分かれる）", () => {
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, "amountYen", 1))),
        ).not.toThrow();
        expect(() =>
          parseBackup(budgetJson(elementWith(VALID_BUDGET, "amountYen", 1.5))),
        ).toThrow();
      });
    });

    describe("複数要素のうち1つでも違反すれば例外", () => {
      const ok = (id: string): Record<string, unknown> =>
        elementWith(VALID_BUDGET, "id", id);
      const broken = elementWith(VALID_BUDGET, "amountYen", 0);

      it("3件すべて正しければ受け入れる（対）", () => {
        const elements = [ok("a"), ok("b"), ok("c")];
        expect(parseBackup(v2Json({ budgets: elements })).budgets).toEqual(elements);
      });

      it.each<[string, Array<Record<string, unknown>>]>([
        ["先頭だけが壊れている", [broken, ok("b"), ok("c")]],
        ["中間だけが壊れている", [ok("a"), broken, ok("c")]],
        ["末尾だけが壊れている", [ok("a"), ok("b"), broken]],
      ])("%s とき例外を投げる", (_label, elements) => {
        expect(() => parseBackup(v2Json({ budgets: elements }))).toThrow();
      });
    });
  });

  describe("取引の memo", () => {
    function txJson(element: unknown, version: 1 | 2 = 2): string {
      return version === 2
        ? v2Json({ transactions: [element] })
        : v1Json({ transactions: [element] });
    }

    it.each(["コンビニで昼食", "  前後に空白  ", "改行\nあり", "絵文字ではない記号 ¥"])(
      "v2 で memo が文字列 %s なら、その値がそのまま残る",
      (value) => {
        const element = elementWith(VALID_TRANSACTION, "memo", value);
        expect(parseBackup(txJson(element)).transactions).toEqual([element]);
      },
    );

    it("v2 で memo が空文字列なら、空文字列のまま残る", () => {
      const element = elementWith(VALID_TRANSACTION, "memo", "");
      expect(parseBackup(txJson(element)).transactions).toEqual([element]);
    });

    it("v2 で memo が無ければ空文字列になる", () => {
      const element = elementWith(VALID_TRANSACTION, "memo", MISSING);
      expect(parseBackup(txJson(element)).transactions).toEqual([
        { ...element, memo: "" },
      ]);
    });

    it("v1 で memo が無ければ空文字列になる", () => {
      expect(parseBackup(txJson(V1_TRANSACTION, 1)).transactions).toEqual([
        { ...V1_TRANSACTION, memo: "" },
      ]);
    });

    it.each<[string, unknown]>([
      ["数値", 1],
      ["null", null],
      ["真偽値", true],
      ["配列", ["メモ"]],
      ["オブジェクト", { text: "メモ" }],
    ])("v2 で memo が %s のとき例外を投げる", (_label, value) => {
      expect(() =>
        parseBackup(txJson(elementWith(VALID_TRANSACTION, "memo", value))),
      ).toThrow();
    });

    it("複数取引のうち1件だけ memo が数値でも例外を投げる", () => {
      const elements = [
        elementWith(VALID_TRANSACTION, "id", "t1"),
        elementWith(elementWith(VALID_TRANSACTION, "id", "t2"), "memo", 1),
      ];
      expect(() => parseBackup(v2Json({ transactions: elements }))).toThrow();
    });

    it("memo だけが異なる複数取引が、それぞれの値を保つ", () => {
      const elements = [
        elementWith(elementWith(VALID_TRANSACTION, "id", "t1"), "memo", "一件目"),
        elementWith(elementWith(VALID_TRANSACTION, "id", "t2"), "memo", ""),
        elementWith(elementWith(VALID_TRANSACTION, "id", "t3"), "memo", "三件目"),
      ];
      expect(
        parseBackup(v2Json({ transactions: elements })).transactions.map(
          (transaction) => transaction.memo,
        ),
      ).toEqual(["一件目", "", "三件目"]);
    });
  });

  describe("buildBackup（v2）", () => {
    /** categories / budgets を凍結する。既存の freezeDeep はこの2つを見ない */
    function freezeV2Arrays(data: BackupPayload): BackupPayload {
      data.categories.forEach((value) => Object.freeze(value));
      data.budgets.forEach((value) => Object.freeze(value));
      Object.freeze(data.categories);
      Object.freeze(data.budgets);
      return data;
    }

    it("formatVersion に 2 を入れる", () => {
      expect(buildBackup(payload(), EXPORTED_AT).formatVersion).toBe(2);
    });

    it("categories / budgets が引数の内容のまま入る", () => {
      const data = payload();
      const backup = buildBackup(data, EXPORTED_AT);

      expect(backup.categories).toEqual(data.categories);
      expect(backup.budgets).toEqual(data.budgets);
    });

    it("categories / budgets の要素の順序を保つ", () => {
      const categories: CategoryRecord[] = [
        { name: "食費", color: "#2fbf6b", order: 0 },
        { name: "住居費", color: "#3b82f6", order: 1 },
        { name: "交通費", color: "#f59e0b", order: 2 },
      ];
      const budgets: BudgetRecord[] = [
        { id: "2026-01:食費", month: "2026-01", category: "食費", amountYen: 60_000 },
        { id: "2026-02:食費", month: "2026-02", category: "食費", amountYen: 55_000 },
      ];
      const backup = buildBackup(payload({ categories, budgets }), EXPORTED_AT);

      expect(backup.categories).toEqual(categories);
      expect(backup.budgets).toEqual(budgets);
    });

    it("空の categories / budgets も空のまま持つ", () => {
      const backup = buildBackup(payload({ categories: [], budgets: [] }), EXPORTED_AT);

      expect(backup.categories).toEqual([]);
      expect(backup.budgets).toEqual([]);
    });

    it.each(["categories", "budgets"] as const)(
      "%s は渡した配列と同一参照ではない",
      (field) => {
        const data = payload();
        const backup = buildBackup(data, EXPORTED_AT);

        expect(backup[field]).not.toBe(data[field]);
        expect(backup[field]).toEqual(data[field]);
      },
    );

    it("凍結した categories / budgets を渡しても、書き換えを試みない", () => {
      expect(() =>
        buildBackup(freezeV2Arrays(payload()), EXPORTED_AT),
      ).not.toThrow();
    });

    it("呼び出しの前後で categories / budgets の内容が変わらない", () => {
      const data = payload();
      const snapshot = structuredClone({
        categories: data.categories,
        budgets: data.budgets,
      });

      buildBackup(data, EXPORTED_AT);

      expect({ categories: data.categories, budgets: data.budgets }).toEqual(snapshot);
    });

    it("buildBackup の結果を JSON にして読み直すと、同じ内容になる（v2 の往復）", () => {
      const built = buildBackup(payload(), EXPORTED_AT);
      expect(parseBackup(JSON.stringify(built))).toEqual(built);
    });
  });
});

/**
 * ガードを1つ消しても、後続の別のガードが例外を投げるので `.toThrow()` だけでは
 * 通ってしまう。**どの項目が原因かがエラーに出る**ことまで見て初めて、検証の
 * 一段が丸ごと消えたことに気づける。
 *
 * 見るのは項目名（`categories[0].color` のような位置）だけで、文の言い回しは見ない。
 * 位置は利用者が読む情報そのものなので、変わったら気づいてよい。
 */
describe("v2 形式：どの項目が原因かがエラーに出る", () => {
  it.each<[string, string, RegExp]>([
    ["categories が配列でない", "categories", /categories が配列ではない/u],
    ["budgets が配列でない", "budgets", /budgets が配列ではない/u],
  ])("%s", (_label, key, pattern) => {
    expect(() => parseBackup(v2Json({ [key]: "配列ではない" }))).toThrow(pattern);
  });

  it.each<[string, unknown, RegExp]>([
    ["要素がオブジェクトでない", "文字列", /categories\[0\] がオブジェクトではない/u],
    [
      "name が空文字列",
      elementWith(VALID_CATEGORY, "name", ""),
      /categories\[0\]\.name/u,
    ],
    [
      "color が #rrggbb でない",
      elementWith(VALID_CATEGORY, "color", "red"),
      /categories\[0\]\.color/u,
    ],
    [
      "order が整数でない",
      elementWith(VALID_CATEGORY, "order", 1.5),
      /categories\[0\]\.order/u,
    ],
  ])("categories：%s", (_label, element, pattern) => {
    expect(() => parseBackup(v2Json({ categories: [element] }))).toThrow(pattern);
  });

  it.each<[string, unknown, RegExp]>([
    ["要素がオブジェクトでない", "文字列", /budgets\[0\] がオブジェクトではない/u],
    ["id が文字列でない", elementWith(VALID_BUDGET, "id", 1), /budgets\[0\]\.id/u],
    [
      "month が文字列でない",
      elementWith(VALID_BUDGET, "month", 1),
      /budgets\[0\]\.month/u,
    ],
    [
      "category が文字列でない",
      elementWith(VALID_BUDGET, "category", 1),
      /budgets\[0\]\.category/u,
    ],
    [
      "amountYen が0",
      elementWith(VALID_BUDGET, "amountYen", 0),
      /budgets\[0\]\.amountYen/u,
    ],
  ])("budgets：%s", (_label, element, pattern) => {
    expect(() => parseBackup(v2Json({ budgets: [element] }))).toThrow(pattern);
  });

  it("2件目が壊れているとき、位置に 1 が出る（要素の番号を取り違えない）", () => {
    expect(() =>
      parseBackup(
        v2Json({
          categories: [VALID_CATEGORY, elementWith(VALID_CATEGORY, "color", "red")],
        }),
      ),
    ).toThrow(/categories\[1\]\.color/u);
  });
});

/**
 * `replaceAll` は全消ししてから `put` する。主キーが重複していると最後の1件だけが
 * 残り、**復元は成功として報告されるのに件数が減る。** 静かに減るのが最悪なので
 * 境界で止める。
 */
describe("v2 形式：主キーの重複", () => {
  it("categories の name が重複していれば例外", () => {
    expect(() =>
      parseBackup(
        v2Json({
          categories: [
            elementWith(VALID_CATEGORY, "order", 0),
            elementWith(VALID_CATEGORY, "order", 1),
          ],
        }),
      ),
    ).toThrow(/categories\[1\]\.name が重複している/u);
  });

  it("budgets の id が重複していれば例外", () => {
    expect(() =>
      parseBackup(
        v2Json({
          budgets: [
            elementWith(VALID_BUDGET, "amountYen", 1000),
            elementWith(VALID_BUDGET, "amountYen", 2000),
          ],
        }),
      ),
    ).toThrow(/budgets\[1\]\.id が重複している/u);
  });

  it("3件目で初めて重複するとき、位置に 2 が出る", () => {
    expect(() =>
      parseBackup(
        v2Json({
          categories: [
            VALID_CATEGORY,
            elementWith(VALID_CATEGORY, "name", "住居費"),
            elementWith(VALID_CATEGORY, "name", "食費"),
          ],
        }),
      ),
    ).toThrow(/categories\[2\]\.name が重複している/u);
  });

  it("name が違えば、他の項目がすべて同じでも通る", () => {
    expect(() =>
      parseBackup(
        v2Json({
          categories: [
            VALID_CATEGORY,
            elementWith(VALID_CATEGORY, "name", "住居費"),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("id が違えば、月とカテゴリが同じでも通る", () => {
    expect(() =>
      parseBackup(
        v2Json({
          budgets: [VALID_BUDGET, elementWith(VALID_BUDGET, "id", "別のキー")],
        }),
      ),
    ).not.toThrow();
  });

  it("1件だけなら重複しようがないので通る", () => {
    expect(() => parseBackup(v2Json({ categories: [VALID_CATEGORY] }))).not.toThrow();
  });

  it("空配列でも通る", () => {
    expect(() => parseBackup(v2Json({ categories: [], budgets: [] }))).not.toThrow();
  });

  /**
   * 重複の検査を型の検査より先に置くと、キーが欠けた壊れた要素同士が
   * undefined で「重複」に化け、原因を取り違えたエラーが出る。
   */
  it("要素が壊れているときは、重複ではなく型のエラーが出る", () => {
    expect(() =>
      parseBackup(
        v2Json({
          categories: [
            elementWith(VALID_CATEGORY, "name", MISSING),
            elementWith(VALID_CATEGORY, "name", MISSING),
          ],
        }),
      ),
    ).toThrow(/categories\[0\]\.name/u);
  });
});
