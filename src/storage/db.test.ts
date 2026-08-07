import { describe, it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  openDatabase,
  getAllTransactions,
  getAllImports,
  getAllColumnMappings,
  saveImport,
  getLearnedCategories,
  saveLearnedCategories,
  replaceAll,
} from "./db.js";
import type { StoredTransaction, ImportRecord, NamedColumnMapping } from "./schema.js";
import type { BackupData } from "./backup.js";
import type { LearnedCategories } from "../category/classify.js";
import type { ColumnMapping } from "../csv/column-mapping.js";

/**
 * テストごとに新しい IDBFactory を作る。fake-indexeddb のグローバル shim を使うと
 * テスト間でデータベースが共有され、独立性が壊れる。
 */
async function freshDatabase(): Promise<IDBDatabase> {
  return await openDatabase(new IDBFactory());
}

const TRANSACTION: StoredTransaction = {
  id: "t-001",
  date: "2026-01-15",
  amountYen: -500,
  description: "セブンイレブン渋谷店",
  source: "card",
  category: "食費",
};

function transactionOf(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  return { ...TRANSACTION, ...overrides };
}

const MAPPING: ColumnMapping = {
  skipRows: 1,
  dateColumn: 0,
  amountColumn: 2,
  descriptionColumn: 1,
  source: "card",
  invertAmount: true,
};

const IMPORT: ImportRecord = {
  id: "i-001",
  importedAt: "2026-01-20T09:00:00.000Z",
  fileName: "rakuten.csv",
  rawCsv: '日付,摘要,金額\n2026-01-15,"セブンイレブン, 渋谷",500\n',
  mappingUsed: MAPPING,
  transactionCount: 1,
};

function importOf(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return { ...IMPORT, ...overrides };
}

const NAMED_MAPPING: NamedColumnMapping = { name: "楽天カード", ...MAPPING };

function namedMappingOf(overrides: Partial<NamedColumnMapping> = {}): NamedColumnMapping {
  return { ...NAMED_MAPPING, ...overrides };
}

function backupOf(overrides: Partial<BackupData> = {}): BackupData {
  return {
    formatVersion: 1,
    exportedAt: "2026-02-01T00:00:00.000Z",
    transactions: [],
    imports: [],
    columnMappings: [],
    learnedCategories: {},
    ...overrides,
  };
}

/** 取得順は仕様に無いので、内容の比較は並べ替えてから行う */
function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function byName(rows: readonly NamedColumnMapping[]): NamedColumnMapping[] {
  return [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** "__proto__" のようなキーをオブジェクトリテラルで書くと own property にならない */
function learnedOf(entries: readonly (readonly [string, string])[]): LearnedCategories {
  return Object.fromEntries(entries);
}

function storeNames(db: IDBDatabase): string[] {
  return Array.from(db.objectStoreNames).sort();
}

/**
 * 保存はすべて saveImport 経由でしか行えないので、セットアップ用に薄く包む。
 * 省略した引数には、そのテストが関心を持たないことが分かる値を入れる。
 */
async function seed(
  db: IDBDatabase,
  data: {
    transactions?: readonly StoredTransaction[];
    record?: ImportRecord;
    mapping?: NamedColumnMapping;
  } = {},
): Promise<void> {
  await saveImport(
    db,
    data.transactions ?? [],
    data.record ?? importOf({ id: "seed-i", fileName: "seed.csv" }),
    data.mapping ?? namedMappingOf({ name: "seed-マッピング" }),
  );
}

/** 4ストアすべてに1件ずつ、あとで消えたと判別できるデータを入れる */
async function seedAllStores(db: IDBDatabase): Promise<void> {
  await seed(db, {
    transactions: [transactionOf({ id: "old-t", description: "旧取引" })],
    record: importOf({ id: "old-i", fileName: "old.csv" }),
    mapping: namedMappingOf({ name: "旧マッピング" }),
  });
  await saveLearnedCategories(db, { 旧摘要: "旧カテゴリ" });
}

describe("openDatabase", () => {
  it('データベース名は "kakeibo"、バージョンは 1', async () => {
    const db = await freshDatabase();
    expect(db.name).toBe("kakeibo");
    expect(db.version).toBe(1);
  });

  it("4つのオブジェクトストアを作る", async () => {
    const db = await freshDatabase();
    expect(storeNames(db)).toEqual([
      "columnMappings",
      "imports",
      "learnedCategories",
      "transactions",
    ]);
  });

  it("各ストアの keyPath が仕様どおり", async () => {
    const db = await freshDatabase();
    const tx = db.transaction(
      ["transactions", "imports", "columnMappings", "learnedCategories"],
      "readonly",
    );
    expect(tx.objectStore("transactions").keyPath).toBe("id");
    expect(tx.objectStore("imports").keyPath).toBe("id");
    expect(tx.objectStore("columnMappings").keyPath).toBe("name");
    expect(tx.objectStore("learnedCategories").keyPath).toBe("description");
  });

  it('transactions には date フィールドに対する "date" 索引がある', async () => {
    const db = await freshDatabase();
    const store = db.transaction("transactions", "readonly").objectStore("transactions");
    expect(store.indexNames.contains("date")).toBe(true);
    expect(store.index("date").keyPath).toBe("date");
  });

  it("同じ IDBFactory で2回開いても、2回目もストア構成が揃っている", async () => {
    const factory = new IDBFactory();
    await openDatabase(factory);
    const second = await openDatabase(factory);

    expect(second.name).toBe("kakeibo");
    expect(second.version).toBe(1);
    expect(storeNames(second)).toEqual([
      "columnMappings",
      "imports",
      "learnedCategories",
      "transactions",
    ]);
  });

  it("1回目の接続で保存した内容が、2回目に開いた接続から読める（開き直しで消えない）", async () => {
    const factory = new IDBFactory();
    const first = await openDatabase(factory);
    await seed(first, { transactions: [transactionOf()] });

    const second = await openDatabase(factory);
    expect(await getAllTransactions(second)).toEqual([transactionOf()]);
  });
});

describe("空のデータベースからの取得", () => {
  it("取引を1件も保存していないとき、空配列を返す", async () => {
    const db = await freshDatabase();
    const rows = await getAllTransactions(db);
    expect(rows).toEqual([]);
    expect(rows).toHaveLength(0);
  });

  it("取り込み履歴を1件も保存していないとき、空配列を返す", async () => {
    const db = await freshDatabase();
    const records = await getAllImports(db);
    expect(records).toEqual([]);
    expect(records).toHaveLength(0);
  });

  it("列マッピングを1件も保存していないとき、空配列を返す", async () => {
    const db = await freshDatabase();
    const mappings = await getAllColumnMappings(db);
    expect(mappings).toEqual([]);
    expect(mappings).toHaveLength(0);
  });
});

describe("saveImport", () => {
  it("取引・履歴・マッピングを1回の呼び出しで3ストアに書く", async () => {
    const db = await freshDatabase();
    const transactions = [
      transactionOf({ id: "t-1" }),
      transactionOf({ id: "t-2", description: "ローソン" }),
    ];
    const record = importOf({ id: "i-1", transactionCount: 2 });
    const mapping = namedMappingOf({ name: "楽天カード" });

    await expect(saveImport(db, transactions, record, mapping)).resolves.toBeUndefined();

    expect(byId(await getAllTransactions(db))).toEqual(byId(transactions));
    expect(await getAllImports(db)).toEqual([record]);
    expect(await getAllColumnMappings(db)).toEqual([mapping]);
  });

  it("入れ子の mappingUsed も含めて、履歴がそのまま往復する", async () => {
    const db = await freshDatabase();
    const record = importOf();

    await saveImport(db, [], record, namedMappingOf());

    expect(await getAllImports(db)).toEqual([record]);
    expect((await getAllImports(db))[0]?.mappingUsed).toEqual(MAPPING);
  });

  it("transactions が空配列でも成功し、履歴とマッピングは書かれる", async () => {
    const db = await freshDatabase();
    const record = importOf({ id: "i-empty", rawCsv: "", transactionCount: 0 });
    const mapping = namedMappingOf({ name: "空取り込み" });

    await expect(saveImport(db, [], record, mapping)).resolves.toBeUndefined();

    expect(await getAllTransactions(db)).toEqual([]);
    expect(await getAllImports(db)).toEqual([record]);
    expect(await getAllColumnMappings(db)).toEqual([mapping]);
  });

  it("transactions が空配列でも、既存の取引は消えない", async () => {
    const db = await freshDatabase();
    const existing = [transactionOf({ id: "keep-1" }), transactionOf({ id: "keep-2" })];
    await seed(db, { transactions: existing });

    await saveImport(db, [], importOf({ id: "i-empty" }), namedMappingOf({ name: "別マッピング" }));

    expect(byId(await getAllTransactions(db))).toEqual(byId(existing));
  });

  it("同じ id の取引は追加ではなく置き換わる", async () => {
    const db = await freshDatabase();
    const before = transactionOf({
      id: "same",
      description: "旧",
      amountYen: -100,
      category: "未分類",
    });
    const after = transactionOf({
      id: "same",
      description: "新",
      amountYen: -200,
      category: "食費",
    });
    await seed(db, { transactions: [before] });

    await saveImport(db, [after], importOf({ id: "i-2" }), namedMappingOf({ name: "m-2" }));

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([after]);
    expect(stored.map((row) => row.description)).not.toContain("旧");
  });

  it("同じ id の取り込み履歴は追加ではなく置き換わる", async () => {
    const db = await freshDatabase();
    const before = importOf({ id: "same-i", fileName: "旧.csv", transactionCount: 1 });
    const after = importOf({ id: "same-i", fileName: "新.csv", transactionCount: 7 });
    await seed(db, { record: before });

    await saveImport(db, [], after, namedMappingOf({ name: "m-2" }));

    const stored = await getAllImports(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([after]);
    expect(stored.map((row) => row.fileName)).not.toContain("旧.csv");
  });

  it("同じ name のマッピングは追加ではなく置き換わる", async () => {
    const db = await freshDatabase();
    const before = namedMappingOf({ name: "楽天カード", skipRows: 1, invertAmount: true });
    const after = namedMappingOf({ name: "楽天カード", skipRows: 3, invertAmount: false });
    await seed(db, { mapping: before });

    await saveImport(db, [], importOf({ id: "i-2" }), after);

    const stored = await getAllColumnMappings(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([after]);
    expect(stored.map((m) => m.skipRows)).not.toContain(1);
  });

  it("キーの重ならない既存データは、3ストアとも残る", async () => {
    const db = await freshDatabase();
    const oldTransaction = transactionOf({ id: "old-t", description: "旧取引" });
    const oldRecord = importOf({ id: "old-i", fileName: "old.csv" });
    const oldMapping = namedMappingOf({ name: "旧マッピング" });
    await seed(db, {
      transactions: [oldTransaction],
      record: oldRecord,
      mapping: oldMapping,
    });

    const newTransaction = transactionOf({ id: "new-t", description: "新取引" });
    const newRecord = importOf({ id: "new-i", fileName: "new.csv" });
    const newMapping = namedMappingOf({ name: "新マッピング", source: "bank" });
    await saveImport(db, [newTransaction], newRecord, newMapping);

    expect(byId(await getAllTransactions(db))).toEqual(byId([oldTransaction, newTransaction]));
    expect(byId(await getAllImports(db))).toEqual(byId([oldRecord, newRecord]));
    expect(byName(await getAllColumnMappings(db))).toEqual(byName([oldMapping, newMapping]));
  });

  it("同じ id の取引だけが置き換わり、他の id は残る", async () => {
    const db = await freshDatabase();
    const keep = transactionOf({ id: "keep", description: "残る" });
    await seed(db, {
      transactions: [keep, transactionOf({ id: "replace", description: "旧" })],
    });

    const replaced = transactionOf({ id: "replace", description: "新" });
    await saveImport(db, [replaced], importOf({ id: "i-2" }), namedMappingOf({ name: "m-2" }));

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(2);
    expect(byId(stored)).toEqual(byId([keep, replaced]));
  });

  it("学習カテゴリには触らない", async () => {
    const db = await freshDatabase();
    const learned = learnedOf([
      ["セブンイレブン渋谷店", "食費"],
      ["JR東日本", "交通費"],
    ]);
    await saveLearnedCategories(db, learned);

    await saveImport(db, [transactionOf()], importOf(), namedMappingOf());

    expect(await getLearnedCategories(db)).toEqual(learned);
  });

  it("取引の各フィールドが、境界値も含めてそのまま往復する", async () => {
    const db = await freshDatabase();
    const transactions = [
      transactionOf({
        id: "a",
        amountYen: 250000,
        source: "bank",
        description: "給与",
        category: "収入",
      }),
      transactionOf({ id: "b", amountYen: 0, source: "cash", description: "", category: "未分類" }),
      transactionOf({ id: "c", amountYen: -1, description: "改行\nとカンマ, を含む摘要" }),
      transactionOf({ id: "d", amountYen: Number.MAX_SAFE_INTEGER, date: "2000-02-29" }),
    ];

    await saveImport(db, transactions, importOf(), namedMappingOf());

    expect(byId(await getAllTransactions(db))).toEqual(byId(transactions));
  });

  it("履歴とマッピングの境界値（rawCsv 空・skipRows 0・invertAmount false）も往復する", async () => {
    const db = await freshDatabase();
    const record = importOf({ rawCsv: "", transactionCount: 0 });
    const mapping = namedMappingOf({
      name: "現金",
      skipRows: 0,
      dateColumn: 0,
      amountColumn: 0,
      descriptionColumn: 0,
      source: "cash",
      invertAmount: false,
    });

    await saveImport(db, [], record, mapping);

    expect(await getAllImports(db)).toEqual([record]);
    expect(await getAllColumnMappings(db)).toEqual([mapping]);
  });

  it("マッピング名が空文字列でも往復する", async () => {
    const db = await freshDatabase();
    const mapping = namedMappingOf({ name: "" });

    await saveImport(db, [], importOf(), mapping);

    const stored = await getAllColumnMappings(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([mapping]);
    expect(stored[0]?.name).toBe("");
  });

  it("凍結された引数を渡しても例外にならない", async () => {
    const db = await freshDatabase();
    const transactions = Object.freeze([Object.freeze(transactionOf())]);
    const record = Object.freeze(importOf());
    const mapping = Object.freeze(namedMappingOf());

    await expect(saveImport(db, transactions, record, mapping)).resolves.toBeUndefined();

    expect(await getAllTransactions(db)).toEqual([transactionOf()]);
    expect(await getAllImports(db)).toEqual([importOf()]);
    expect(await getAllColumnMappings(db)).toEqual([namedMappingOf()]);
  });

  it("連続して呼び出すと、取引が積み上がる", async () => {
    const db = await freshDatabase();
    const first = transactionOf({ id: "a", description: "1回目" });
    const second = transactionOf({ id: "b", description: "2回目" });

    await saveImport(db, [first], importOf({ id: "i-1" }), namedMappingOf({ name: "m-1" }));
    await saveImport(db, [second], importOf({ id: "i-2" }), namedMappingOf({ name: "m-2" }));

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(2);
    expect(byId(stored)).toEqual(byId([first, second]));
  });
});

/**
 * 3ストアへの書き込みは原子的でなければならない。取引 → 履歴 → マッピングの順に
 * 別々のトランザクションで書く実装だと、取引だけ入って履歴で落ちる。ここではその
 * 「途中まで書けた状態」が残らないことを検査する。
 */
describe("saveImport の原子性", () => {
  /** transactions ストアの keyPath は "id"。id を持たない要素は put に失敗する */
  function transactionWithoutId(): StoredTransaction {
    return {
      date: "2026-03-01",
      amountYen: -1200,
      description: "id を持たない取引",
      source: "card",
      category: "食費",
    } as unknown as StoredTransaction;
  }

  /** imports ストアの keyPath は "id" */
  function recordWithoutId(): ImportRecord {
    return {
      importedAt: "2026-03-01T00:00:00.000Z",
      fileName: "id を持たない履歴.csv",
      rawCsv: "日付,摘要,金額\n",
      mappingUsed: MAPPING,
      transactionCount: 0,
    } as unknown as ImportRecord;
  }

  /** columnMappings ストアの keyPath は "name" */
  function mappingWithoutName(): NamedColumnMapping {
    return { ...MAPPING } as unknown as NamedColumnMapping;
  }

  const EXISTING_TRANSACTIONS = [
    transactionOf({ id: "keep-1", description: "既存1" }),
    transactionOf({ id: "keep-2", description: "既存2", amountYen: -100 }),
  ];
  const EXISTING_RECORD = importOf({ id: "keep-i", fileName: "既存.csv" });
  const EXISTING_MAPPING = namedMappingOf({ name: "既存マッピング" });

  const NEW_TRANSACTIONS = [
    transactionOf({ id: "new-1", description: "新1" }),
    transactionOf({ id: "new-2", description: "新2" }),
  ];
  const NEW_RECORD = importOf({ id: "new-i", fileName: "新.csv" });
  const NEW_MAPPING = namedMappingOf({ name: "新マッピング" });

  async function seedExisting(db: IDBDatabase): Promise<void> {
    await seed(db, {
      transactions: EXISTING_TRANSACTIONS,
      record: EXISTING_RECORD,
      mapping: EXISTING_MAPPING,
    });
  }

  /** 既存データが3ストアとも無傷であること */
  async function expectExistingIntact(db: IDBDatabase): Promise<void> {
    expect(byId(await getAllTransactions(db))).toEqual(byId(EXISTING_TRANSACTIONS));
    expect(await getAllImports(db)).toEqual([EXISTING_RECORD]);
    expect(await getAllColumnMappings(db)).toEqual([EXISTING_MAPPING]);
  }

  /** 同期的に投げても reject でも「失敗した」と扱えるようにする */
  async function outcomeOf(run: () => Promise<unknown>): Promise<"成功" | "失敗"> {
    try {
      await run();
      return "成功";
    } catch {
      return "失敗";
    }
  }

  it("取引が壊れているとき、呼び出しが reject される", async () => {
    const db = await freshDatabase();
    await expect(
      saveImport(db, [transactionWithoutId()], NEW_RECORD, NEW_MAPPING),
    ).rejects.toThrow();
  });

  it("履歴が壊れているとき、呼び出しが reject される", async () => {
    const db = await freshDatabase();
    await expect(saveImport(db, NEW_TRANSACTIONS, recordWithoutId(), NEW_MAPPING)).rejects.toThrow();
  });

  it("マッピングが壊れているとき、呼び出しが reject される", async () => {
    const db = await freshDatabase();
    await expect(saveImport(db, NEW_TRANSACTIONS, NEW_RECORD, mappingWithoutName())).rejects.toThrow();
  });

  it("履歴だけが壊れているとき、渡した取引が1件も入らず、既存データも無傷", async () => {
    const db = await freshDatabase();
    await seedExisting(db);

    const outcome = await outcomeOf(() =>
      saveImport(db, NEW_TRANSACTIONS, recordWithoutId(), NEW_MAPPING),
    );

    expect(outcome).toBe("失敗");
    const storedIds = (await getAllTransactions(db)).map((row) => row.id);
    expect(storedIds).not.toContain("new-1");
    expect(storedIds).not.toContain("new-2");
    expect((await getAllColumnMappings(db)).map((m) => m.name)).not.toContain("新マッピング");
    await expectExistingIntact(db);
  });

  it("マッピングだけが壊れているとき、渡した取引が1件も入らず、既存データも無傷", async () => {
    const db = await freshDatabase();
    await seedExisting(db);

    const outcome = await outcomeOf(() =>
      saveImport(db, NEW_TRANSACTIONS, NEW_RECORD, mappingWithoutName()),
    );

    expect(outcome).toBe("失敗");
    const storedIds = (await getAllTransactions(db)).map((row) => row.id);
    expect(storedIds).not.toContain("new-1");
    expect(storedIds).not.toContain("new-2");
    expect((await getAllImports(db)).map((row) => row.id)).not.toContain("new-i");
    await expectExistingIntact(db);
  });

  it("取引だけが壊れているとき、履歴もマッピングも書かれず、既存データも無傷", async () => {
    const db = await freshDatabase();
    await seedExisting(db);

    const outcome = await outcomeOf(() =>
      saveImport(db, [transactionWithoutId()], NEW_RECORD, NEW_MAPPING),
    );

    expect(outcome).toBe("失敗");
    expect((await getAllImports(db)).map((row) => row.id)).not.toContain("new-i");
    expect((await getAllColumnMappings(db)).map((m) => m.name)).not.toContain("新マッピング");
    await expectExistingIntact(db);
  });

  it("取引配列の途中が壊れているとき、その前後の正しい取引も入らない", async () => {
    const db = await freshDatabase();
    await seedExisting(db);

    const outcome = await outcomeOf(() =>
      saveImport(
        db,
        [
          transactionOf({ id: "before-broken", description: "壊れた要素の前" }),
          transactionWithoutId(),
          transactionOf({ id: "after-broken", description: "壊れた要素の後" }),
        ],
        NEW_RECORD,
        NEW_MAPPING,
      ),
    );

    expect(outcome).toBe("失敗");
    const storedIds = (await getAllTransactions(db)).map((row) => row.id);
    expect(storedIds).not.toContain("before-broken");
    expect(storedIds).not.toContain("after-broken");
    await expectExistingIntact(db);
  });

  it("既存の取引と同じ id を含む呼び出しが失敗しても、既存の内容は上書きされない", async () => {
    const db = await freshDatabase();
    await seedExisting(db);

    const outcome = await outcomeOf(() =>
      saveImport(
        db,
        [transactionOf({ id: "keep-1", description: "上書きされてはいけない値" })],
        recordWithoutId(),
        NEW_MAPPING,
      ),
    );

    expect(outcome).toBe("失敗");
    expect((await getAllTransactions(db)).map((row) => row.description)).not.toContain(
      "上書きされてはいけない値",
    );
    await expectExistingIntact(db);
  });

  it("失敗しても、学習カテゴリは変わらない", async () => {
    const db = await freshDatabase();
    const learned = { セブンイレブン渋谷店: "食費" };
    await saveLearnedCategories(db, learned);

    const outcome = await outcomeOf(() =>
      saveImport(db, NEW_TRANSACTIONS, recordWithoutId(), NEW_MAPPING),
    );

    expect(outcome).toBe("失敗");
    expect(await getLearnedCategories(db)).toEqual(learned);
  });

  it("keyPath を補えば同じ呼び出しが成功する（失敗の原因が keyPath の欠落であることの対）", async () => {
    const db = await freshDatabase();
    await seedExisting(db);

    const repairedRecord = { ...recordWithoutId(), id: "repaired-i" };
    const repairedMapping = { ...mappingWithoutName(), name: "repaired-m" };
    await expect(
      saveImport(db, NEW_TRANSACTIONS, repairedRecord, repairedMapping),
    ).resolves.toBeUndefined();

    expect(byId(await getAllTransactions(db))).toEqual(
      byId([...EXISTING_TRANSACTIONS, ...NEW_TRANSACTIONS]),
    );
    expect(byId(await getAllImports(db))).toEqual(byId([EXISTING_RECORD, repairedRecord]));
    expect(byName(await getAllColumnMappings(db))).toEqual(
      byName([EXISTING_MAPPING, repairedMapping]),
    );
  });

  it("失敗した後でも、正しい引数なら保存できる", async () => {
    const db = await freshDatabase();
    await seedExisting(db);

    expect(
      await outcomeOf(() => saveImport(db, NEW_TRANSACTIONS, recordWithoutId(), NEW_MAPPING)),
    ).toBe("失敗");

    await saveImport(db, NEW_TRANSACTIONS, NEW_RECORD, NEW_MAPPING);

    expect(byId(await getAllTransactions(db))).toEqual(
      byId([...EXISTING_TRANSACTIONS, ...NEW_TRANSACTIONS]),
    );
    expect(byId(await getAllImports(db))).toEqual(byId([EXISTING_RECORD, NEW_RECORD]));
    expect(byName(await getAllColumnMappings(db))).toEqual(byName([EXISTING_MAPPING, NEW_MAPPING]));
  });
});

describe("学習カテゴリ", () => {
  it("何も保存していないとき、空オブジェクトを返す", async () => {
    const db = await freshDatabase();
    const learned = await getLearnedCategories(db);
    expect(learned).toEqual({});
    expect(Object.keys(learned)).toEqual([]);
  });

  it("何も保存していないとき、プロトタイプ由来のキーを持っているように見えない", async () => {
    const db = await freshDatabase();
    const learned = await getLearnedCategories(db);
    expect(Object.hasOwn(learned, "constructor")).toBe(false);
    expect(typeof learned["constructor"]).not.toBe("string");
  });

  it("保存したオブジェクトが、そのまま取得できる", async () => {
    const db = await freshDatabase();
    const learned = { セブンイレブン渋谷店: "食費", "JR東日本": "交通費" };

    await saveLearnedCategories(db, learned);

    expect(await getLearnedCategories(db)).toEqual(learned);
  });

  it("同じ摘要のカテゴリを変えて保存すると、後の値になる", async () => {
    const db = await freshDatabase();
    await saveLearnedCategories(db, { セブンイレブン渋谷店: "食費" });

    await saveLearnedCategories(db, { セブンイレブン渋谷店: "日用品" });

    const learned = await getLearnedCategories(db);
    expect(learned).toEqual({ セブンイレブン渋谷店: "日用品" });
    expect(Object.keys(learned)).toHaveLength(1);
  });

  it("総入れ替えである：渡されなかったキーは消える", async () => {
    const db = await freshDatabase();
    await saveLearnedCategories(db, { セブンイレブン渋谷店: "食費", "JR東日本": "交通費" });

    await saveLearnedCategories(db, { セブンイレブン渋谷店: "食費" });

    const learned = await getLearnedCategories(db);
    expect(Object.keys(learned)).toEqual(["セブンイレブン渋谷店"]);
    expect(learned).toEqual({ セブンイレブン渋谷店: "食費" });
    expect(Object.hasOwn(learned, "JR東日本")).toBe(false);
  });

  it("総入れ替えである：まったく別のキーだけを渡すと、以前のキーは1つも残らない", async () => {
    const db = await freshDatabase();
    await saveLearnedCategories(db, { A: "食費", B: "交通費", C: "日用品" });

    await saveLearnedCategories(db, { D: "住居費" });

    const learned = await getLearnedCategories(db);
    expect(Object.keys(learned)).toEqual(["D"]);
    expect(learned).toEqual({ D: "住居費" });
  });

  it("空オブジェクトを保存すると、全部消える", async () => {
    const db = await freshDatabase();
    await saveLearnedCategories(db, { セブンイレブン渋谷店: "食費", "JR東日本": "交通費" });

    await saveLearnedCategories(db, {});

    const learned = await getLearnedCategories(db);
    expect(learned).toEqual({});
    expect(Object.keys(learned)).toEqual([]);
  });

  it("摘要が __proto__ や constructor でも、往復して文字列として取れる", async () => {
    const db = await freshDatabase();
    const learned = learnedOf([
      ["__proto__", "食費"],
      ["constructor", "交通費"],
      ["toString", "日用品"],
      ["hasOwnProperty", "住居費"],
    ]);

    await saveLearnedCategories(db, learned);

    const restored = await getLearnedCategories(db);
    expect(typeof restored["__proto__"]).toBe("string");
    expect(typeof restored["constructor"]).toBe("string");
    expect(typeof restored["toString"]).toBe("string");
    expect(typeof restored["hasOwnProperty"]).toBe("string");
    expect(restored["__proto__"]).toBe("食費");
    expect(restored["constructor"]).toBe("交通費");
    expect(restored["toString"]).toBe("日用品");
    expect(restored["hasOwnProperty"]).toBe("住居費");
    expect(Object.keys(restored).sort()).toEqual(
      ["__proto__", "constructor", "hasOwnProperty", "toString"].sort(),
    );
  });

  it("摘要が空文字列でも往復する", async () => {
    const db = await freshDatabase();
    await saveLearnedCategories(db, { "": "未分類扱いの空摘要" });

    const learned = await getLearnedCategories(db);
    expect(Object.keys(learned)).toEqual([""]);
    expect(learned[""]).toBe("未分類扱いの空摘要");
  });

  it("学習カテゴリの保存は、取引・履歴・列マッピングに影響しない", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);

    await saveLearnedCategories(db, { 新摘要: "新カテゴリ" });

    expect(await getAllTransactions(db)).toHaveLength(1);
    expect(await getAllImports(db)).toHaveLength(1);
    expect(await getAllColumnMappings(db)).toHaveLength(1);
  });
});

describe("replaceAll", () => {
  it("空のデータベースに復元すると、4ストアすべてが取得できる", async () => {
    const db = await freshDatabase();
    const transactions = [transactionOf({ id: "n-1" }), transactionOf({ id: "n-2" })];
    const imports = [importOf({ id: "n-i" })];
    const columnMappings = [namedMappingOf({ name: "新マッピング" })];
    const learnedCategories = { 新摘要: "新カテゴリ" };

    await replaceAll(db, backupOf({ transactions, imports, columnMappings, learnedCategories }));

    expect(byId(await getAllTransactions(db))).toEqual(byId(transactions));
    expect(await getAllImports(db)).toEqual(imports);
    expect(await getAllColumnMappings(db)).toEqual(columnMappings);
    expect(await getLearnedCategories(db)).toEqual(learnedCategories);
  });

  it("既存のデータは残らず、バックアップの内容だけになる", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);

    const transactions = [transactionOf({ id: "new-t", description: "新取引" })];
    const imports = [importOf({ id: "new-i", fileName: "new.csv" })];
    const columnMappings = [namedMappingOf({ name: "新マッピング" })];
    const learnedCategories = { 新摘要: "新カテゴリ" };

    await replaceAll(db, backupOf({ transactions, imports, columnMappings, learnedCategories }));

    const storedTransactions = await getAllTransactions(db);
    expect(storedTransactions).toHaveLength(1);
    expect(storedTransactions).toEqual(transactions);
    expect(storedTransactions.map((row) => row.id)).not.toContain("old-t");

    const storedImports = await getAllImports(db);
    expect(storedImports).toHaveLength(1);
    expect(storedImports).toEqual(imports);
    expect(storedImports.map((row) => row.id)).not.toContain("old-i");

    const storedMappings = await getAllColumnMappings(db);
    expect(storedMappings).toHaveLength(1);
    expect(storedMappings).toEqual(columnMappings);
    expect(storedMappings.map((row) => row.name)).not.toContain("旧マッピング");

    const storedLearned = await getLearnedCategories(db);
    expect(Object.keys(storedLearned)).toEqual(["新摘要"]);
    expect(storedLearned).toEqual(learnedCategories);
  });

  it("空のバックアップを渡すと、4ストアすべてが空になる", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);

    await replaceAll(db, backupOf());

    expect(await getAllTransactions(db)).toEqual([]);
    expect(await getAllImports(db)).toEqual([]);
    expect(await getAllColumnMappings(db)).toEqual([]);
    expect(await getLearnedCategories(db)).toEqual({});
    expect(Object.keys(await getLearnedCategories(db))).toEqual([]);
  });

  it("バックアップで空だったストアだけが空になり、中身のあるストアは復元される", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);

    const transactions = [transactionOf({ id: "only-t" })];
    await replaceAll(db, backupOf({ transactions }));

    expect(await getAllTransactions(db)).toEqual(transactions);
    expect(await getAllImports(db)).toEqual([]);
    expect(await getAllColumnMappings(db)).toEqual([]);
    expect(await getLearnedCategories(db)).toEqual({});
  });

  it("空のバックアップを空のデータベースに渡しても例外にならない", async () => {
    const db = await freshDatabase();
    await expect(replaceAll(db, backupOf())).resolves.toBeUndefined();
    expect(await getAllTransactions(db)).toEqual([]);
  });

  it("復元を2回続けても、2回目の内容だけが残る", async () => {
    const db = await freshDatabase();
    await replaceAll(
      db,
      backupOf({
        transactions: [transactionOf({ id: "first" })],
        learnedCategories: { 一度目: "食費" },
      }),
    );

    await replaceAll(
      db,
      backupOf({
        transactions: [transactionOf({ id: "second" })],
        learnedCategories: { 二度目: "交通費" },
      }),
    );

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(1);
    expect(stored.map((row) => row.id)).toEqual(["second"]);
    expect(Object.keys(await getLearnedCategories(db))).toEqual(["二度目"]);
  });

  it("復元後に追加した取引は、復元された取引と共存する", async () => {
    const db = await freshDatabase();
    const restored = transactionOf({ id: "restored" });
    await replaceAll(db, backupOf({ transactions: [restored] }));

    const added = transactionOf({ id: "added" });
    await seed(db, { transactions: [added] });

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(2);
    expect(byId(stored)).toEqual(byId([restored, added]));
  });
});

/**
 * 復元は「全消し → 書き込み」の順で行われる。途中で失敗したときに全消しだけが残ると、
 * 手元のデータが消えたまま何も復元されていない状態になる。この不変条件を検査する。
 * parseBackup は不正な要素を弾くが、replaceAll はそれを経由せずに呼べる。
 */
describe("replaceAll の原子性", () => {
  /** transactions ストアの keyPath は "id"。id を持たない要素は put に失敗する */
  function transactionWithoutId(): StoredTransaction {
    return {
      date: "2026-03-01",
      amountYen: -1200,
      description: "id を持たない要素",
      source: "card",
      category: "食費",
    } as unknown as StoredTransaction;
  }

  /** columnMappings ストアの keyPath は "name" */
  function mappingWithoutName(): NamedColumnMapping {
    return { ...MAPPING } as unknown as NamedColumnMapping;
  }

  const EXISTING = [
    transactionOf({ id: "keep-1", description: "既存1" }),
    transactionOf({ id: "keep-2", description: "既存2", amountYen: -100 }),
    transactionOf({ id: "keep-3", description: "既存3", date: "2026-02-02" }),
  ];

  /** 同期的に投げても reject でも「失敗した」と扱えるようにする */
  async function outcomeOf(run: () => Promise<unknown>): Promise<"成功" | "失敗"> {
    try {
      await run();
      return "成功";
    } catch {
      return "失敗";
    }
  }

  it("保存に失敗する要素を含むとき、呼び出しが reject される", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    await expect(
      replaceAll(db, backupOf({ transactions: [transactionWithoutId()] })),
    ).rejects.toThrow();
  });

  it("失敗しても、既存の取引はそのまま残る（clear がロールバックされる）", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const outcome = await outcomeOf(() =>
      replaceAll(db, backupOf({ transactions: [transactionWithoutId()] })),
    );

    expect(outcome).toBe("失敗");
    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(EXISTING.length);
    expect(byId(stored)).toEqual(byId(EXISTING));
  });

  it("失敗したとき、書き込めた分だけが残ることもない", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const outcome = await outcomeOf(() =>
      replaceAll(
        db,
        backupOf({
          transactions: [
            transactionOf({ id: "new-1", description: "新1" }),
            transactionWithoutId(),
            transactionOf({ id: "new-3", description: "新3" }),
          ],
        }),
      ),
    );

    expect(outcome).toBe("失敗");
    const stored = await getAllTransactions(db);
    expect(byId(stored)).toEqual(byId(EXISTING));
    expect(stored.map((row) => row.id)).not.toContain("new-1");
    expect(stored.map((row) => row.id)).not.toContain("new-3");
  });

  it("同じ要素に id を与えれば成功して置き換わる（失敗の原因が id の欠落であることの対）", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const repaired = { ...transactionWithoutId(), id: "repaired" };
    await expect(
      replaceAll(db, backupOf({ transactions: [repaired] })),
    ).resolves.toBeUndefined();

    expect(await getAllTransactions(db)).toEqual([repaired]);
  });

  it("別ストアの要素で失敗しても、取引の全消しがロールバックされる（4ストアが1つのトランザクション）", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING, record: importOf({ id: "keep-i" }) });

    const outcome = await outcomeOf(() =>
      replaceAll(
        db,
        backupOf({
          transactions: [transactionOf({ id: "new-t" })],
          columnMappings: [mappingWithoutName()],
        }),
      ),
    );

    expect(outcome).toBe("失敗");
    expect(byId(await getAllTransactions(db))).toEqual(byId(EXISTING));
    expect((await getAllImports(db)).map((row) => row.id)).toEqual(["keep-i"]);
  });

  it("失敗した後でも、正しいバックアップなら復元できる", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    expect(
      await outcomeOf(() =>
        replaceAll(db, backupOf({ transactions: [transactionWithoutId()] })),
      ),
    ).toBe("失敗");

    const restored = [transactionOf({ id: "after", description: "復旧後" })];
    await replaceAll(db, backupOf({ transactions: restored }));

    expect(await getAllTransactions(db)).toEqual(restored);
  });
});
