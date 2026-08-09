import { describe, it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  openDatabase,
  getAllTransactions,
  getAllImports,
  getAllColumnMappings,
  getAllCategories,
  getAllBudgets,
  saveImport,
  getLearnedCategories,
  setLearnedCategory,
  replaceAll,
  putTransactions,
  deleteTransaction,
} from "./db.js";
import { budgetId, type StoredTransaction, type ImportRecord, type NamedColumnMapping } from "./schema.js";
import { BACKUP_FORMAT_VERSION, type BackupData } from "./backup.js";
import {
  classifyDescription,
  UNCATEGORIZED,
  type CategoryRule,
  type LearnedCategories,
} from "../category/classify.js";
import type { ColumnMapping } from "../csv/column-mapping.js";
import { defaultCategories } from "../category/default-categories.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";

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
  memo: "",
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
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: "2026-02-01T00:00:00.000Z",
    transactions: [],
    imports: [],
    columnMappings: [],
    learnedCategories: {},
    categories: [],
    budgets: [],
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

/** 学習カテゴリのセットアップ。1件ずつしか書けないので順に呼ぶ */
async function seedLearned(
  db: IDBDatabase,
  learned: LearnedCategories,
): Promise<void> {
  for (const [description, category] of Object.entries(learned)) {
    await setLearnedCategory(db, description, category);
  }
}

/** 4ストアすべてに1件ずつ、あとで消えたと判別できるデータを入れる */
async function seedAllStores(db: IDBDatabase): Promise<void> {
  await seed(db, {
    transactions: [transactionOf({ id: "old-t", description: "旧取引" })],
    record: importOf({ id: "old-i", fileName: "old.csv" }),
    mapping: namedMappingOf({ name: "旧マッピング" }),
  });
  await seedLearned(db, { 旧摘要: "旧カテゴリ" });
}

describe("openDatabase", () => {
  it('データベース名は "kakeibo"、バージョンは 2', async () => {
    const db = await freshDatabase();
    expect(db.name).toBe("kakeibo");
    expect(db.version).toBe(2);
  });

  it("6つのオブジェクトストアを作る", async () => {
    const db = await freshDatabase();
    expect(storeNames(db)).toEqual([
      "budgets",
      "categories",
      "columnMappings",
      "imports",
      "learnedCategories",
      "transactions",
    ]);
  });

  it("各ストアの keyPath が仕様どおり", async () => {
    const db = await freshDatabase();
    const tx = db.transaction(
      [
        "transactions",
        "imports",
        "columnMappings",
        "learnedCategories",
        "categories",
        "budgets",
      ],
      "readonly",
    );
    expect(tx.objectStore("transactions").keyPath).toBe("id");
    expect(tx.objectStore("imports").keyPath).toBe("id");
    expect(tx.objectStore("columnMappings").keyPath).toBe("name");
    expect(tx.objectStore("learnedCategories").keyPath).toBe("description");
    expect(tx.objectStore("categories").keyPath).toBe("name");
    expect(tx.objectStore("budgets").keyPath).toBe("id");
  });

  it('budgets には month フィールドに対する "month" 索引がある', async () => {
    const db = await freshDatabase();
    const store = db.transaction("budgets", "readonly").objectStore("budgets");
    expect(store.indexNames.contains("month")).toBe(true);
    expect(store.index("month").keyPath).toBe("month");
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
    expect(second.version).toBe(2);
    expect(storeNames(second)).toEqual([
      "budgets",
      "categories",
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

/**
 * v1 のデータベースを、v1 当時のスキーマそのままで作る。
 *
 * `openDatabase` を使わずに手で組むのが要。あちらは常に最新版を開くので、
 * 「古い状態から上げる」経路をそもそも通らない。**移行が実データに対して
 * 一度きりの不可逆な操作である以上、ここは古い形を再現して確かめる。**
 *
 * `memo` は付けない。v1 に無かったフィールドなので。
 */
interface V1Transaction {
  id: string;
  date: string;
  amountYen: number;
  description: string;
  source: string;
  category: string;
}

/** v1 のスキーマで開いた接続を返す。**閉じるのは呼び出し側の責任** */
function openV1(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open("kakeibo", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("transactions", { keyPath: "id" }).createIndex("date", "date");
      db.createObjectStore("imports", { keyPath: "id" });
      db.createObjectStore("columnMappings", { keyPath: "name" });
      db.createObjectStore("learnedCategories", { keyPath: "description" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openVersion1(factory: IDBFactory, rows: readonly V1Transaction[]): Promise<void> {
  const db = await openV1(factory);
  const tx = db.transaction("transactions", "readwrite");
  const store = tx.objectStore("transactions");
  await new Promise<void>((resolve, reject) => {
    for (const row of rows) {
      store.put(row);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // 開いたままだと versionchange が blocked になり、次の open が返らない。
  db.close();
}

function v1Transaction(overrides: Partial<V1Transaction> = {}): V1Transaction {
  return {
    id: "v1-001",
    date: "2026-01-15",
    amountYen: -500,
    description: "セブンイレブン渋谷店",
    source: "card",
    category: "食費",
    ...overrides,
  };
}

describe("v1 から v2 への移行", () => {
  it("v1 のデータベースを開くと、増えた2つのストアができる", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, []);

    const db = await openDatabase(factory);

    expect(db.version).toBe(2);
    expect(storeNames(db)).toEqual([
      "budgets",
      "categories",
      "columnMappings",
      "imports",
      "learnedCategories",
      "transactions",
    ]);
  });

  it("v1 に入っていた取引が消えない", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, [
      v1Transaction({ id: "a", description: "既存1" }),
      v1Transaction({ id: "b", description: "既存2", amountYen: -1200 }),
    ]);

    const db = await openDatabase(factory);

    expect(byId(await getAllTransactions(db))).toEqual(
      byId([
        { ...v1Transaction({ id: "a", description: "既存1" }), memo: "" },
        { ...v1Transaction({ id: "b", description: "既存2", amountYen: -1200 }), memo: "" },
      ]),
    );
  });

  it("v1 の取引すべてに memo が空文字列で入る（undefined のまま残さない）", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, [
      v1Transaction({ id: "a" }),
      v1Transaction({ id: "b" }),
      v1Transaction({ id: "c" }),
    ]);

    const db = await openDatabase(factory);
    const rows = await getAllTransactions(db);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.memo).toBe("");
    }
  });

  /**
   * 埋め戻しは「memo が文字列でないものだけ」を対象にする。全件を無条件に
   * 上書きすると、既に入っている memo が消える。v1 の取引に memo は無い前提だが、
   * ここを無条件にすると移行が**データを消す方向に**壊れるので、区別を固定する。
   */
  it("既に memo が入っている取引は、埋め戻しで上書きされない", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, [
      { ...v1Transaction({ id: "has-memo" }), memo: "既にあるメモ" } as V1Transaction,
      v1Transaction({ id: "no-memo" }),
    ]);

    const db = await openDatabase(factory);
    const rows = await getAllTransactions(db);

    expect(rows.find((row) => row.id === "has-memo")?.memo).toBe("既にあるメモ");
    expect(rows.find((row) => row.id === "no-memo")?.memo).toBe("");
  });

  it("v1 に取引が1件も無くても移行できる", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, []);

    const db = await openDatabase(factory);

    expect(await getAllTransactions(db)).toEqual([]);
  });

  it("移行でカテゴリの初期値が入る", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, []);

    const db = await openDatabase(factory);

    expect(await getAllCategories(db)).toEqual(
      expect.arrayContaining(defaultCategories(DEFAULT_CATEGORY_RULES)),
    );
  });

  it("移行の直後、予算は1件も入っていない", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, []);

    const db = await openDatabase(factory);

    expect(await getAllBudgets(db)).toEqual([]);
  });

  it("移行した後にもう一度開いても、memo が上書きされない", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, [v1Transaction({ id: "a" })]);

    const first = await openDatabase(factory);
    await putTransactions(first, [
      { ...v1Transaction({ id: "a" }), source: "card", memo: "書いたメモ" } as StoredTransaction,
    ]);
    first.close();

    const second = await openDatabase(factory);

    expect((await getAllTransactions(second))[0]?.memo).toBe("書いたメモ");
  });

  it("移行した後にもう一度開いても、消したカテゴリが復活しない", async () => {
    const factory = new IDBFactory();
    await openVersion1(factory, []);

    const first = await openDatabase(factory);
    const tx = first.transaction("categories", "readwrite");
    tx.objectStore("categories").clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
    first.close();

    const second = await openDatabase(factory);

    expect(await getAllCategories(second)).toEqual([]);
  });
});

/**
 * 別のタブが古いバージョンで開いたままだと versionchange が始められない。
 * v1 しか無かった間は upgrade 自体が起きなかったので、この経路は表に出なかった。
 */
describe("他の接続に阻まれたとき", () => {
  it("古いバージョンの接続が開いたままなら、待ち続けずに失敗する", async () => {
    const factory = new IDBFactory();
    const held = await openV1(factory);

    await expect(openDatabase(factory)).rejects.toThrow(/他のタブ/u);

    held.close();
  });

  it("阻んでいた接続を閉じれば、開けるようになる", async () => {
    const factory = new IDBFactory();
    const held = await openV1(factory);
    await expect(openDatabase(factory)).rejects.toThrow();

    held.close();
    const db = await openDatabase(factory);

    expect(db.version).toBe(2);
    expect(storeNames(db)).toContain("categories");
  });
});

describe("カテゴリの初期値", () => {
  it("新規のデータベースにも初期値が入る", async () => {
    const db = await freshDatabase();

    expect(await getAllCategories(db)).toEqual(
      expect.arrayContaining(defaultCategories(DEFAULT_CATEGORY_RULES)),
    );
  });

  it("初期値の件数が defaultCategories と一致する", async () => {
    const db = await freshDatabase();

    expect(await getAllCategories(db)).toHaveLength(
      defaultCategories(DEFAULT_CATEGORY_RULES).length,
    );
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
    await seedLearned(db, learned);

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
    await seedLearned(db, learned);

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

    await seedLearned(db, learned);

    expect(await getLearnedCategories(db)).toEqual(learned);
  });

  it("摘要が __proto__ や constructor でも、往復して文字列として取れる", async () => {
    const db = await freshDatabase();
    const learned = learnedOf([
      ["__proto__", "食費"],
      ["constructor", "交通費"],
      ["toString", "日用品"],
      ["hasOwnProperty", "住居費"],
    ]);

    await seedLearned(db, learned);

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
    await seedLearned(db, { "": "未分類扱いの空摘要" });

    const learned = await getLearnedCategories(db);
    expect(Object.keys(learned)).toEqual([""]);
    expect(learned[""]).toBe("未分類扱いの空摘要");
  });

  it("学習カテゴリの保存は、取引・履歴・列マッピングに影響しない", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);

    await seedLearned(db, { 新摘要: "新カテゴリ" });

    expect(await getAllTransactions(db)).toHaveLength(1);
    expect(await getAllImports(db)).toHaveLength(1);
    expect(await getAllColumnMappings(db)).toHaveLength(1);
  });
});

/**
 * 単一の摘要だけを更新する API。マップ全体を受け取る旧 API では、呼び出し側が
 * 「全体を読む → 1件直す → 全体を書き戻す」をせざるを得ず、2件を続けて直すと
 * 先行の修正がエラーも出さずに消えた（lost update）。ここでは取り消しの意味論と、
 * その窓が無いことを検査する。
 */
describe("setLearnedCategory", () => {
  const POLLUTED_NAMES = ["__proto__", "constructor", "toString"];

  describe("覚える", () => {
    it("空のデータベースに1件覚えると、読み戻せる", async () => {
      const db = await freshDatabase();

      await expect(
        setLearnedCategory(db, "セブンイレブン渋谷店", "食費"),
      ).resolves.toBeUndefined();

      expect(await getLearnedCategories(db)).toEqual({ セブンイレブン渋谷店: "食費" });
    });

    it("別々の摘要を続けて覚えると、両方とも残る", async () => {
      const db = await freshDatabase();

      await setLearnedCategory(db, "セブンイレブン渋谷店", "食費");
      await setLearnedCategory(db, "JR東日本", "交通費");

      expect(await getLearnedCategories(db)).toEqual({
        セブンイレブン渋谷店: "食費",
        "JR東日本": "交通費",
      });
    });

    it("同じ摘要に別のカテゴリを覚えさせると、増えずに置き換わる", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "セブンイレブン渋谷店", "食費");

      await setLearnedCategory(db, "セブンイレブン渋谷店", "日用品");

      const learned = await getLearnedCategories(db);
      expect(learned).toEqual({ セブンイレブン渋谷店: "日用品" });
      expect(Object.keys(learned)).toHaveLength(1);
    });

    it("上書きしても、他の摘要の記録は変わらない", async () => {
      const db = await freshDatabase();
      await seedLearned(db, {
        セブンイレブン渋谷店: "食費",
        "JR東日本": "交通費",
        "Amazon.co.jp": "書籍",
      });

      await setLearnedCategory(db, "JR東日本", "旅費");

      expect(await getLearnedCategories(db)).toEqual({
        セブンイレブン渋谷店: "食費",
        "JR東日本": "旅費",
        "Amazon.co.jp": "書籍",
      });
    });

    it("同じ摘要・同じカテゴリを2回指定しても、1件のまま", async () => {
      const db = await freshDatabase();

      await setLearnedCategory(db, "ローソン", "コンビニ");
      await setLearnedCategory(db, "ローソン", "コンビニ");

      const learned = await getLearnedCategories(db);
      expect(Object.keys(learned)).toEqual(["ローソン"]);
      expect(learned["ローソン"]).toBe("コンビニ");
    });

    it("摘要が空文字列でも覚えられる", async () => {
      const db = await freshDatabase();

      await setLearnedCategory(db, "", "手入力");

      const learned = await getLearnedCategories(db);
      expect(Object.keys(learned)).toEqual([""]);
      expect(learned[""]).toBe("手入力");
    });

    it("カテゴリが空文字列のときは、未分類ではないので消さずに覚える", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "ローソン", "コンビニ");

      await setLearnedCategory(db, "ローソン", "");

      const learned = await getLearnedCategories(db);
      expect(Object.hasOwn(learned, "ローソン")).toBe(true);
      expect(learned).toEqual({ ローソン: "" });
    });

    it.each([
      ["末尾に空白が付いた未分類", "未分類 "],
      ["先頭に空白が付いた未分類", " 未分類"],
      ["未分類の部分文字列", "未分"],
      ["未分類を含む長い文字列", "未分類あつかい"],
    ])(
      "カテゴリが %s のときは、取り消しではなく普通に覚える（前方・部分一致で消さない）",
      async (_name, category) => {
        const db = await freshDatabase();
        await setLearnedCategory(db, "ローソン", "コンビニ");

        await setLearnedCategory(db, "ローソン", category);

        const learned = await getLearnedCategories(db);
        expect(Object.hasOwn(learned, "ローソン")).toBe(true);
        expect(learned["ローソン"]).toBe(category);
        expect(Object.keys(learned)).toHaveLength(1);
      },
    );

    for (const name of POLLUTED_NAMES) {
      it(`摘要が "${name}" でも、覚えて文字列として読み戻せる`, async () => {
        const db = await freshDatabase();

        await setLearnedCategory(db, name, "食費");
        await setLearnedCategory(db, "ローソン", "コンビニ");

        const learned = await getLearnedCategories(db);
        expect(Object.hasOwn(learned, name)).toBe(true);
        expect(typeof learned[name]).toBe("string");
        expect(learned[name]).toBe("食費");
        expect(learned["ローソン"]).toBe("コンビニ");
      });
    }
  });

  /**
   * 一度覚えた分類を消す経路が無いと、間違って覚えさせたものを直せなくなる。
   * 取り消しは "未分類" を指定することで行う。
   */
  describe("未分類を指定したとき、記録を消す", () => {
    it("覚えた記録が消える", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "ローソン", "コンビニ");

      await setLearnedCategory(db, "ローソン", UNCATEGORIZED);

      const learned = await getLearnedCategories(db);
      expect(Object.hasOwn(learned, "ローソン")).toBe(false);
      expect(learned).toEqual({});
    });

    it("消しても、他の摘要の記録は消えない", async () => {
      const db = await freshDatabase();
      await seedLearned(db, {
        ローソン: "コンビニ",
        "Amazon.co.jp": "書籍",
        "JR東日本": "交通費",
      });

      await setLearnedCategory(db, "Amazon.co.jp", UNCATEGORIZED);

      expect(await getLearnedCategories(db)).toEqual({
        ローソン: "コンビニ",
        "JR東日本": "交通費",
      });
    });

    it("完全一致した摘要だけが消える（部分一致する摘要は残る）", async () => {
      const db = await freshDatabase();
      await seedLearned(db, {
        セブンイレブン: "食費",
        セブンイレブン渋谷店: "交際費",
      });

      await setLearnedCategory(db, "セブンイレブン", UNCATEGORIZED);

      expect(await getLearnedCategories(db)).toEqual({ セブンイレブン渋谷店: "交際費" });
    });

    it("消した後、同じ摘要にもう一度別のカテゴリを覚えさせられる", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "ローソン", "コンビニ");
      await setLearnedCategory(db, "ローソン", UNCATEGORIZED);

      await setLearnedCategory(db, "ローソン", "食費");

      const learned = await getLearnedCategories(db);
      expect(learned).toEqual({ ローソン: "食費" });
      expect(Object.keys(learned)).toHaveLength(1);
    });

    it("存在しない摘要に未分類を指定しても、reject せず内容も変わらない", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "Amazon.co.jp", "書籍");

      await expect(
        setLearnedCategory(db, "ローソン", UNCATEGORIZED),
      ).resolves.toBeUndefined();

      expect(await getLearnedCategories(db)).toEqual({ "Amazon.co.jp": "書籍" });
    });

    it("空のデータベースに未分類を指定しても、reject せず空のまま", async () => {
      const db = await freshDatabase();

      await expect(
        setLearnedCategory(db, "ローソン", UNCATEGORIZED),
      ).resolves.toBeUndefined();

      const learned = await getLearnedCategories(db);
      expect(learned).toEqual({});
      expect(Object.keys(learned)).toEqual([]);
    });

    it("摘要が空文字列の記録も消せる", async () => {
      const db = await freshDatabase();
      await seedLearned(db, { "": "手入力", ローソン: "コンビニ" });

      await setLearnedCategory(db, "", UNCATEGORIZED);

      const learned = await getLearnedCategories(db);
      expect(Object.hasOwn(learned, "")).toBe(false);
      expect(learned).toEqual({ ローソン: "コンビニ" });
    });

    for (const name of POLLUTED_NAMES) {
      it(`摘要が "${name}" の記録も消せる`, async () => {
        const db = await freshDatabase();
        await setLearnedCategory(db, name, "食費");
        await setLearnedCategory(db, "ローソン", "コンビニ");

        await setLearnedCategory(db, name, UNCATEGORIZED);

        const learned = await getLearnedCategories(db);
        expect(Object.hasOwn(learned, name)).toBe(false);
        expect(Object.keys(learned)).toEqual(["ローソン"]);
      });

      it(`覚えていない "${name}" に未分類を指定しても、reject せず内容が変わらない`, async () => {
        const db = await freshDatabase();
        await setLearnedCategory(db, "ローソン", "コンビニ");

        await expect(
          setLearnedCategory(db, name, UNCATEGORIZED),
        ).resolves.toBeUndefined();

        const learned = await getLearnedCategories(db);
        expect(Object.hasOwn(learned, name)).toBe(false);
        expect(Object.keys(learned)).toEqual(["ローソン"]);
      });
    }
  });

  describe("学習カテゴリ以外のストアに触らない", () => {
    it("覚えても、取引・履歴・列マッピングは変わらない", async () => {
      const db = await freshDatabase();
      await seedAllStores(db);
      const transactionsBefore = await getAllTransactions(db);
      const importsBefore = await getAllImports(db);
      const mappingsBefore = await getAllColumnMappings(db);
      expect(transactionsBefore).toHaveLength(1);

      await setLearnedCategory(db, "新摘要", "新カテゴリ");

      expect(await getAllTransactions(db)).toEqual(transactionsBefore);
      expect(await getAllImports(db)).toEqual(importsBefore);
      expect(await getAllColumnMappings(db)).toEqual(mappingsBefore);
      expect(await getLearnedCategories(db)).toEqual({
        旧摘要: "旧カテゴリ",
        新摘要: "新カテゴリ",
      });
    });

    it("取り消しても、取引・履歴・列マッピングは変わらない", async () => {
      const db = await freshDatabase();
      await seedAllStores(db);
      const transactionsBefore = await getAllTransactions(db);
      const importsBefore = await getAllImports(db);
      const mappingsBefore = await getAllColumnMappings(db);
      expect(mappingsBefore).toHaveLength(1);

      await setLearnedCategory(db, "旧摘要", UNCATEGORIZED);

      expect(await getAllTransactions(db)).toEqual(transactionsBefore);
      expect(await getAllImports(db)).toEqual(importsBefore);
      expect(await getAllColumnMappings(db)).toEqual(mappingsBefore);
      expect(await getLearnedCategories(db)).toEqual({});
    });
  });

  describe("失敗したとき", () => {
    it("閉じた接続に覚えさせようとすると、Promise が reject する", async () => {
      const db = await freshDatabase();
      db.close();

      await expect(setLearnedCategory(db, "ローソン", "コンビニ")).rejects.toThrow();
    });

    it("閉じた接続に取り消しを指定しても、Promise が reject する", async () => {
      const db = await freshDatabase();
      db.close();

      await expect(
        setLearnedCategory(db, "ローソン", UNCATEGORIZED),
      ).rejects.toThrow();
    });

    it("失敗しても、既に覚えた記録は残る", async () => {
      const factory = new IDBFactory();
      const db = await openDatabase(factory);
      await setLearnedCategory(db, "ローソン", "コンビニ");
      db.close();

      await expect(
        setLearnedCategory(db, "セブンイレブン渋谷店", "食費"),
      ).rejects.toThrow();

      const reopened = await openDatabase(factory);
      expect(await getLearnedCategories(reopened)).toEqual({ ローソン: "コンビニ" });
    });
  });

  /**
   * 旧 API は「全体を読む → 1件直す → 全体を書き戻す」だったので、2件の更新が
   * 重なると先に書いた側が黙って消えた。ユーザーが明示的に入力した分類が
   * エラーも無く失われるので、ここが最も重要な検査になる。
   */
  describe("同時更新で記録が失われない", () => {
    it("異なる摘要への同時更新が、1件も失われない", async () => {
      const db = await freshDatabase();

      await Promise.all([
        setLearnedCategory(db, "セブンイレブン渋谷店", "食費"),
        setLearnedCategory(db, "JR東日本", "交通費"),
        setLearnedCategory(db, "Amazon.co.jp", "書籍"),
      ]);

      const learned = await getLearnedCategories(db);
      expect(learned).toEqual({
        セブンイレブン渋谷店: "食費",
        "JR東日本": "交通費",
        "Amazon.co.jp": "書籍",
      });
      expect(Object.keys(learned)).toHaveLength(3);
    });

    it("既存の記録があるとき、同時更新しても既存は消えない", async () => {
      const db = await freshDatabase();
      await seedLearned(db, { 既存A: "食費", 既存B: "交通費" });

      await Promise.all([
        setLearnedCategory(db, "新A", "日用品"),
        setLearnedCategory(db, "新B", "住居費"),
      ]);

      expect(await getLearnedCategories(db)).toEqual({
        既存A: "食費",
        既存B: "交通費",
        新A: "日用品",
        新B: "住居費",
      });
    });

    it("多数の摘要を同時に更新しても、全件残る", async () => {
      const db = await freshDatabase();
      const entries = Array.from(
        { length: 20 },
        (_, index) => [`摘要-${index}`, `カテゴリ-${index}`] as const,
      );

      await Promise.all(
        entries.map(([description, category]) =>
          setLearnedCategory(db, description, category),
        ),
      );

      const learned = await getLearnedCategories(db);
      expect(Object.keys(learned)).toHaveLength(entries.length);
      expect(learned).toEqual(learnedOf(entries));
    });

    it("覚えると取り消しを同時に走らせても、取り消した記録だけが消える", async () => {
      const db = await freshDatabase();
      await seedLearned(db, { 消す対象: "食費", 残る記録: "交通費" });

      await Promise.all([
        setLearnedCategory(db, "消す対象", UNCATEGORIZED),
        setLearnedCategory(db, "新しい記録", "書籍"),
      ]);

      const learned = await getLearnedCategories(db);
      expect(Object.hasOwn(learned, "消す対象")).toBe(false);
      expect(learned).toEqual({ 残る記録: "交通費", 新しい記録: "書籍" });
    });

    it("同じ摘要への同時更新では、どちらか一方だけが残る", async () => {
      const db = await freshDatabase();

      await Promise.all([
        setLearnedCategory(db, "セブンイレブン渋谷店", "食費"),
        setLearnedCategory(db, "セブンイレブン渋谷店", "日用品"),
      ]);

      const learned = await getLearnedCategories(db);
      expect(Object.keys(learned)).toEqual(["セブンイレブン渋谷店"]);
      expect(["食費", "日用品"]).toContain(learned["セブンイレブン渋谷店"]);
    });

    it("同じ摘要への「覚える」と「取り消し」が重なっても、他の記録は無傷", async () => {
      const db = await freshDatabase();
      await seedLearned(db, { 競合する摘要: "旧カテゴリ", 無関係な摘要: "交通費" });

      await Promise.all([
        setLearnedCategory(db, "競合する摘要", "食費"),
        setLearnedCategory(db, "競合する摘要", UNCATEGORIZED),
      ]);

      const learned = await getLearnedCategories(db);
      expect(learned["無関係な摘要"]).toBe("交通費");
      // どちらが勝つかは決めない。旧カテゴリが生き残るのだけは誤り
      // （両方の更新が失われたことになる）
      expect(Object.values(learned)).not.toContain("旧カテゴリ");
      expect(
        Object.keys(learned).filter(
          (key) => key !== "無関係な摘要" && key !== "競合する摘要",
        ),
      ).toEqual([]);
      if (Object.hasOwn(learned, "競合する摘要")) {
        expect(learned["競合する摘要"]).toBe("食費");
      }
    });
  });

  /**
   * 取り消しの意味論が「間違って覚えた分類を直せる」ことに繋がっているかは、
   * 保存内容だけでなく分類結果で見ないと分からない。
   */
  describe("classifyDescription との組み合わせ", () => {
    const RULES: readonly CategoryRule[] = Object.freeze([
      Object.freeze({ pattern: "amazon", category: "買い物" }),
    ]);
    const NO_RULES: readonly CategoryRule[] = Object.freeze([]);

    it("覚えた摘要は、次の分類でルールより優先される", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "Amazon.co.jp", "書籍");

      const learned = await getLearnedCategories(db);
      expect(classifyDescription("Amazon.co.jp", RULES, learned)).toBe("書籍");
    });

    it("未分類で取り消すと、ルールの判定に戻る", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "Amazon.co.jp", "書籍");
      await setLearnedCategory(db, "Amazon.co.jp", UNCATEGORIZED);

      const learned = await getLearnedCategories(db);
      expect(classifyDescription("Amazon.co.jp", RULES, learned)).toBe("買い物");
    });

    it("ルールにも当たらない摘要の記録を取り消すと、未分類に戻る", async () => {
      const db = await freshDatabase();
      await setLearnedCategory(db, "ローソン渋谷店", "コンビニ");
      await setLearnedCategory(db, "ローソン渋谷店", UNCATEGORIZED);

      const learned = await getLearnedCategories(db);
      expect(classifyDescription("ローソン渋谷店", NO_RULES, learned)).toBe(
        UNCATEGORIZED,
      );
    });
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

  it("バックアップのカテゴリと予算が入る", async () => {
    const db = await freshDatabase();
    const categories = [
      { name: "食費", color: "#2fbf6b", order: 0 },
      { name: "住居費", color: "#ef6a6a", order: 1 },
    ];
    const budgets = [
      { id: budgetId("2026-07", "食費"), month: "2026-07", category: "食費", amountYen: 60000 },
    ];

    await replaceAll(db, backupOf({ categories, budgets }));

    expect(await getAllCategories(db)).toEqual(expect.arrayContaining(categories));
    expect(await getAllCategories(db)).toHaveLength(2);
    expect(await getAllBudgets(db)).toEqual(budgets);
  });

  /**
   * 移行で入れた初期値が残ったまま復元すると、バックアップに無いカテゴリが
   * 混ざる。全消ししてから書く対象に categories が入っているかを確かめる。
   */
  it("復元前から入っていたカテゴリは消える", async () => {
    const db = await freshDatabase();
    expect((await getAllCategories(db)).length).toBeGreaterThan(0);

    const categories = [{ name: "食費", color: "#2fbf6b", order: 0 }];
    await replaceAll(db, backupOf({ categories }));

    expect(await getAllCategories(db)).toEqual(categories);
  });

  it("復元前から入っていた予算は消える", async () => {
    const db = await freshDatabase();
    const before = [
      { id: budgetId("2026-06", "食費"), month: "2026-06", category: "食費", amountYen: 50000 },
    ];
    await replaceAll(db, backupOf({ budgets: before }));

    await replaceAll(db, backupOf({ budgets: [] }));

    expect(await getAllBudgets(db)).toEqual([]);
  });
});

describe("budgetId", () => {
  it("月とカテゴリをコロンでつなぐ", () => {
    expect(budgetId("2026-07", "食費")).toBe("2026-07:食費");
  });

  it("月かカテゴリが違えば、別のキーになる", () => {
    expect(budgetId("2026-07", "食費")).not.toBe(budgetId("2026-08", "食費"));
    expect(budgetId("2026-07", "食費")).not.toBe(budgetId("2026-07", "住居費"));
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

/**
 * 再分類の結果（カテゴリだけ変わった取引）を書き戻す用途。書き込み先は transactions
 * ストアだけで、取り込み履歴・列マッピング・学習カテゴリには触らない。
 */
describe("putTransactions", () => {
  it("空配列を渡しても成功する", async () => {
    const db = await freshDatabase();

    await expect(putTransactions(db, [])).resolves.toBeUndefined();

    expect(await getAllTransactions(db)).toEqual([]);
  });

  it("空配列を渡すと、既存の取引は1件も変わらない", async () => {
    const db = await freshDatabase();
    const existing = [
      transactionOf({ id: "keep-1", category: "食費" }),
      transactionOf({ id: "keep-2", category: "未分類" }),
    ];
    await seed(db, { transactions: existing });

    await putTransactions(db, []);

    expect(byId(await getAllTransactions(db))).toEqual(byId(existing));
  });

  it("存在しない id を渡すと、新しく追加される", async () => {
    const db = await freshDatabase();
    const added = transactionOf({ id: "brand-new", category: "交通費" });

    await expect(putTransactions(db, [added])).resolves.toBeUndefined();

    expect(await getAllTransactions(db)).toEqual([added]);
  });

  it("空のデータベースに複数件を追加できる", async () => {
    const db = await freshDatabase();
    const added = [
      transactionOf({ id: "a", category: "食費" }),
      transactionOf({ id: "b", category: "交通費" }),
      transactionOf({ id: "c", category: "未分類" }),
    ];

    await putTransactions(db, added);

    expect(byId(await getAllTransactions(db))).toEqual(byId(added));
  });

  it("同じ id の取引は、カテゴリが置き換わる（再分類の書き戻し）", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: [transactionOf({ id: "a", category: "未分類" })] });

    const reclassified = transactionOf({ id: "a", category: "食費" });
    await putTransactions(db, [reclassified]);

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([reclassified]);
    expect(stored.map((row) => row.category)).not.toContain("未分類");
  });

  it("同じ id の取引は、カテゴリ以外も含めて内容がまるごと置き換わる", async () => {
    const db = await freshDatabase();
    const before = transactionOf({
      id: "same",
      date: "2026-01-15",
      amountYen: -500,
      description: "旧摘要",
      source: "card",
      category: "未分類",
    });
    await seed(db, { transactions: [before] });

    const after = transactionOf({
      id: "same",
      date: "2026-02-20",
      amountYen: 1200,
      description: "新摘要",
      source: "bank",
      category: "収入",
    });
    await putTransactions(db, [after]);

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([after]);
    expect(stored[0]).not.toMatchObject({ description: "旧摘要" });
  });

  it("渡していない id の既存取引は影響を受けない", async () => {
    const db = await freshDatabase();
    const untouched = transactionOf({ id: "untouched", category: "交通費", description: "残る" });
    await seed(db, {
      transactions: [untouched, transactionOf({ id: "target", category: "未分類" })],
    });

    const updated = transactionOf({ id: "target", category: "日用品" });
    await putTransactions(db, [updated]);

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(2);
    expect(byId(stored)).toEqual(byId([untouched, updated]));
  });

  it("既存の上書きと新規追加が1回の呼び出しで混在できる", async () => {
    const db = await freshDatabase();
    await seed(db, {
      transactions: [
        transactionOf({ id: "keep", category: "食費", description: "触らない" }),
        transactionOf({ id: "update", category: "未分類" }),
      ],
    });

    const updated = transactionOf({ id: "update", category: "住居費" });
    const inserted = transactionOf({ id: "insert", category: "交通費" });
    await putTransactions(db, [updated, inserted]);

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(3);
    expect(byId(stored)).toEqual(
      byId([transactionOf({ id: "keep", category: "食費", description: "触らない" }), updated, inserted]),
    );
  });

  it("取り込み履歴・列マッピング・学習カテゴリには触らない", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);
    const importsBefore = await getAllImports(db);
    const mappingsBefore = await getAllColumnMappings(db);
    const learnedBefore = await getLearnedCategories(db);

    await putTransactions(db, [transactionOf({ id: "old-t", category: "再分類後" })]);

    expect(await getAllImports(db)).toEqual(importsBefore);
    expect(await getAllColumnMappings(db)).toEqual(mappingsBefore);
    expect(await getLearnedCategories(db)).toEqual(learnedBefore);
  });

  it("空配列でも、取り込み履歴・列マッピング・学習カテゴリは消えない", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);

    await putTransactions(db, []);

    expect(await getAllImports(db)).toHaveLength(1);
    expect(await getAllColumnMappings(db)).toHaveLength(1);
    expect(await getLearnedCategories(db)).toEqual(learnedOf([["旧摘要", "旧カテゴリ"]]));
  });

  it("各フィールドの境界値が、上書き後もそのまま往復する", async () => {
    const db = await freshDatabase();
    await seed(db, {
      transactions: [
        transactionOf({ id: "a", category: "未分類" }),
        transactionOf({ id: "b", category: "未分類" }),
        transactionOf({ id: "c", category: "未分類" }),
      ],
    });

    const updated = [
      transactionOf({ id: "a", amountYen: 0, description: "", category: "" }),
      transactionOf({
        id: "b",
        amountYen: Number.MAX_SAFE_INTEGER,
        date: "2000-02-29",
        source: "cash",
        category: "収入",
      }),
      transactionOf({ id: "c", amountYen: -1, description: "改行\nとカンマ, を含む摘要" }),
    ];
    await putTransactions(db, updated);

    expect(byId(await getAllTransactions(db))).toEqual(byId(updated));
  });

  it("id が空文字列でも保存でき、後から同じ id で上書きできる", async () => {
    const db = await freshDatabase();

    await putTransactions(db, [transactionOf({ id: "", category: "未分類" })]);
    await putTransactions(db, [transactionOf({ id: "", category: "食費" })]);

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([transactionOf({ id: "", category: "食費" })]);
  });

  it("同じ id を1つの配列に2回入れると、後の内容が残る（put の意味論）", async () => {
    const db = await freshDatabase();

    await putTransactions(db, [
      transactionOf({ id: "dup", category: "先", description: "先" }),
      transactionOf({ id: "dup", category: "後", description: "後" }),
    ]);

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([transactionOf({ id: "dup", category: "後", description: "後" })]);
  });

  it("凍結された配列・要素を渡しても成功する", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: [transactionOf({ id: "a", category: "未分類" })] });

    const frozen = Object.freeze([Object.freeze(transactionOf({ id: "a", category: "食費" }))]);
    await expect(putTransactions(db, frozen)).resolves.toBeUndefined();

    expect(await getAllTransactions(db)).toEqual([transactionOf({ id: "a", category: "食費" })]);
  });

  it("連続して呼び出すと、最後に書いた内容が残る", async () => {
    const db = await freshDatabase();

    await putTransactions(db, [transactionOf({ id: "a", category: "1回目" })]);
    await putTransactions(db, [transactionOf({ id: "a", category: "2回目" })]);
    await putTransactions(db, [transactionOf({ id: "b", category: "別の取引" })]);

    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(2);
    expect(byId(stored)).toEqual(
      byId([
        transactionOf({ id: "a", category: "2回目" }),
        transactionOf({ id: "b", category: "別の取引" }),
      ]),
    );
  });

  it("saveImport で保存した取引も上書きできる（保存経路が違っても同じストア）", async () => {
    const db = await freshDatabase();
    await saveImport(
      db,
      [transactionOf({ id: "imported", category: "未分類" })],
      importOf({ id: "i-1" }),
      namedMappingOf({ name: "m-1" }),
    );

    await putTransactions(db, [transactionOf({ id: "imported", category: "食費" })]);

    expect(await getAllTransactions(db)).toEqual([
      transactionOf({ id: "imported", category: "食費" }),
    ]);
  });
});

/**
 * 1件ずつ別トランザクションで put する実装だと、途中で失敗したときに「先頭だけ書けた」
 * 状態が残る。再分類の書き戻しでそれが起きると、一部の取引だけカテゴリが変わった
 * 中途半端な状態になる。ここではその状態が残らないことを検査する。
 */
describe("putTransactions の原子性", () => {
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

  /** keyPath が undefined に解決される場合も、有効なキーが無いので put に失敗する */
  function transactionWithUndefinedId(): StoredTransaction {
    return { ...transactionOf(), id: undefined } as unknown as StoredTransaction;
  }

  const EXISTING = [
    transactionOf({ id: "keep-1", description: "既存1", category: "食費" }),
    transactionOf({ id: "keep-2", description: "既存2", category: "交通費", amountYen: -100 }),
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

  it("id を持たない取引を含むとき、呼び出しが reject される", async () => {
    const db = await freshDatabase();

    await expect(putTransactions(db, [transactionWithoutId()])).rejects.toThrow();
  });

  it("id が undefined の取引を含むとき、呼び出しが reject される", async () => {
    const db = await freshDatabase();

    await expect(putTransactions(db, [transactionWithUndefinedId()])).rejects.toThrow();
  });

  it("配列の途中が壊れているとき、その前後の正しい取引も入らない", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const outcome = await outcomeOf(() =>
      putTransactions(db, [
        transactionOf({ id: "before-broken", description: "壊れた要素の前" }),
        transactionWithoutId(),
        transactionOf({ id: "after-broken", description: "壊れた要素の後" }),
      ]),
    );

    expect(outcome).toBe("失敗");
    const storedIds = (await getAllTransactions(db)).map((row) => row.id);
    expect(storedIds).not.toContain("before-broken");
    expect(storedIds).not.toContain("after-broken");
    expect(byId(await getAllTransactions(db))).toEqual(byId(EXISTING));
  });

  it("壊れた要素が配列の末尾にあっても、先頭の正しい取引は入らない", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const outcome = await outcomeOf(() =>
      putTransactions(db, [
        transactionOf({ id: "first", description: "先頭" }),
        transactionOf({ id: "second", description: "2番目" }),
        transactionWithoutId(),
      ]),
    );

    expect(outcome).toBe("失敗");
    const storedIds = (await getAllTransactions(db)).map((row) => row.id);
    expect(storedIds).not.toContain("first");
    expect(storedIds).not.toContain("second");
    expect(byId(await getAllTransactions(db))).toEqual(byId(EXISTING));
  });

  it("既存の取引と同じ id を含む呼び出しが失敗しても、既存の内容は上書きされない", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const outcome = await outcomeOf(() =>
      putTransactions(db, [
        transactionOf({ id: "keep-1", category: "上書きされてはいけないカテゴリ" }),
        transactionWithoutId(),
      ]),
    );

    expect(outcome).toBe("失敗");
    const stored = await getAllTransactions(db);
    expect(stored.map((row) => row.category)).not.toContain("上書きされてはいけないカテゴリ");
    expect(byId(stored)).toEqual(byId(EXISTING));
  });

  it("失敗しても、既存の取引が消えることはない", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const outcome = await outcomeOf(() => putTransactions(db, [transactionWithoutId()]));

    expect(outcome).toBe("失敗");
    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(EXISTING.length);
    expect(byId(stored)).toEqual(byId(EXISTING));
  });

  it("失敗しても、取り込み履歴・列マッピング・学習カテゴリは変わらない", async () => {
    const db = await freshDatabase();
    await seedAllStores(db);

    const outcome = await outcomeOf(() =>
      putTransactions(db, [transactionOf({ id: "new-t" }), transactionWithoutId()]),
    );

    expect(outcome).toBe("失敗");
    expect((await getAllImports(db)).map((row) => row.id)).toEqual(["old-i"]);
    expect((await getAllColumnMappings(db)).map((m) => m.name)).toEqual(["旧マッピング"]);
    expect(await getLearnedCategories(db)).toEqual(learnedOf([["旧摘要", "旧カテゴリ"]]));
  });

  it("id を補えば同じ呼び出しが成功する（失敗の原因が id の欠落であることの対）", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    const repaired = { ...transactionWithoutId(), id: "repaired" };
    await expect(
      putTransactions(db, [
        transactionOf({ id: "before-broken", description: "壊れた要素の前" }),
        repaired,
        transactionOf({ id: "after-broken", description: "壊れた要素の後" }),
      ]),
    ).resolves.toBeUndefined();

    expect(byId(await getAllTransactions(db))).toEqual(
      byId([
        ...EXISTING,
        transactionOf({ id: "before-broken", description: "壊れた要素の前" }),
        repaired,
        transactionOf({ id: "after-broken", description: "壊れた要素の後" }),
      ]),
    );
  });

  it("失敗した後でも、正しい引数なら書き戻せる", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: EXISTING });

    expect(await outcomeOf(() => putTransactions(db, [transactionWithoutId()]))).toBe("失敗");

    const updated = transactionOf({ id: "keep-1", description: "既存1", category: "日用品" });
    await putTransactions(db, [updated]);

    expect(byId(await getAllTransactions(db))).toEqual(byId([updated, EXISTING[1]!]));
  });
});

describe("deleteTransaction", () => {
  it("指定した1件を消す", async () => {
    const db = await freshDatabase();
    await seed(db, {
      transactions: [transactionOf({ id: "a" }), transactionOf({ id: "b" })],
    });

    await deleteTransaction(db, "a");

    expect((await getAllTransactions(db)).map((t) => t.id)).toEqual(["b"]);
  });

  it("消した1件以外は、内容まで含めてそのまま残る", async () => {
    const db = await freshDatabase();
    const keep = [
      transactionOf({ id: "keep-1", category: "食費", memo: "昼" }),
      transactionOf({ id: "keep-2", category: "交通費", amountYen: -220 }),
    ];
    await seed(db, { transactions: [...keep, transactionOf({ id: "gone" })] });

    await deleteTransaction(db, "gone");

    expect(byId(await getAllTransactions(db))).toEqual(byId(keep));
  });

  it("1件だけのデータベースを空にできる", async () => {
    const db = await freshDatabase();
    await seed(db, { transactions: [transactionOf({ id: "only" })] });

    await deleteTransaction(db, "only");

    expect(await getAllTransactions(db)).toEqual([]);
  });

  it("消えるのはちょうど1件（同じ日付・同じ金額の行が巻き添えにならない）", async () => {
    const db = await freshDatabase();
    const twin = { date: "2026-03-03", amountYen: -1000, description: "同じ店" };
    await seed(db, {
      transactions: [
        transactionOf({ id: "x", ...twin }),
        transactionOf({ id: "y", ...twin }),
        transactionOf({ id: "z", ...twin }),
      ],
    });

    await deleteTransaction(db, "y");

    expect((await getAllTransactions(db)).map((t) => t.id).sort()).toEqual(["x", "z"]);
  });

  describe("存在しない id", () => {
    it("失敗しない", async () => {
      const db = await freshDatabase();
      await seed(db, { transactions: [transactionOf({ id: "a" })] });

      await expect(deleteTransaction(db, "missing")).resolves.toBeUndefined();
    });

    it("他の取引を消さない", async () => {
      const db = await freshDatabase();
      const existing = [transactionOf({ id: "a" }), transactionOf({ id: "b" })];
      await seed(db, { transactions: existing });

      await deleteTransaction(db, "missing");

      expect(byId(await getAllTransactions(db))).toEqual(byId(existing));
    });

    it("空のデータベースでも失敗しない", async () => {
      const db = await freshDatabase();

      await expect(deleteTransaction(db, "missing")).resolves.toBeUndefined();

      expect(await getAllTransactions(db)).toEqual([]);
    });

    it("空文字列の id でも失敗せず、何も消えない", async () => {
      const db = await freshDatabase();
      const existing = [transactionOf({ id: "a" })];
      await seed(db, { transactions: existing });

      await expect(deleteTransaction(db, "")).resolves.toBeUndefined();

      expect(await getAllTransactions(db)).toEqual(existing);
    });
  });

  describe("繰り返し", () => {
    it("同じ id を2回消しても失敗しない（2回目は何も起きない）", async () => {
      const db = await freshDatabase();
      await seed(db, { transactions: [transactionOf({ id: "a" }), transactionOf({ id: "b" })] });

      await deleteTransaction(db, "a");
      await expect(deleteTransaction(db, "a")).resolves.toBeUndefined();

      expect((await getAllTransactions(db)).map((t) => t.id)).toEqual(["b"]);
    });

    it("順に呼べば複数件を消せる", async () => {
      const db = await freshDatabase();
      await seed(db, {
        transactions: [
          transactionOf({ id: "a" }),
          transactionOf({ id: "b" }),
          transactionOf({ id: "c" }),
        ],
      });

      await deleteTransaction(db, "a");
      await deleteTransaction(db, "c");

      expect((await getAllTransactions(db)).map((t) => t.id)).toEqual(["b"]);
    });

    it("消したあと、同じ id で入れ直せる", async () => {
      const db = await freshDatabase();
      await seed(db, { transactions: [transactionOf({ id: "a", category: "食費" })] });

      await deleteTransaction(db, "a");
      const revived = transactionOf({ id: "a", category: "交通費" });
      await putTransactions(db, [revived]);

      expect(await getAllTransactions(db)).toEqual([revived]);
    });
  });

  describe("他のストアに触らない", () => {
    it("取り込み履歴と列マッピングは残る", async () => {
      const db = await freshDatabase();
      await seed(db, { transactions: [transactionOf({ id: "a" })] });
      const importsBefore = await getAllImports(db);
      const mappingsBefore = await getAllColumnMappings(db);

      await deleteTransaction(db, "a");

      expect(await getAllImports(db)).toEqual(importsBefore);
      expect(await getAllColumnMappings(db)).toEqual(mappingsBefore);
    });

    it("学習したカテゴリは残る", async () => {
      const db = await freshDatabase();
      await seed(db, { transactions: [transactionOf({ id: "a", description: "店A" })] });
      await seedLearned(db, learnedOf([["店A", "食費"]]));

      await deleteTransaction(db, "a");

      expect(await getLearnedCategories(db)).toEqual(learnedOf([["店A", "食費"]]));
    });

    it("カテゴリのマスタは残る", async () => {
      const db = await freshDatabase();
      await seed(db, { transactions: [transactionOf({ id: "a" })] });
      const categoriesBefore = await getAllCategories(db);

      await deleteTransaction(db, "a");

      expect(await getAllCategories(db)).toEqual(categoriesBefore);
    });
  });
});
