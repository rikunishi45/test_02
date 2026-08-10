import { UNCATEGORIZED, type LearnedCategories } from "../category/classify.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import { defaultCategories } from "../category/default-categories.js";
import type { CategoryChange } from "../category/manage.js";
import type { BackupData } from "./backup.js";
import {
  DB_NAME,
  DB_VERSION,
  STORE_BUDGETS,
  STORE_CATEGORIES,
  STORE_COLUMN_MAPPINGS,
  STORE_IMPORTS,
  STORE_LEARNED_CATEGORIES,
  STORE_TRANSACTIONS,
  type BudgetRecord,
  type CategoryRecord,
  type ImportRecord,
  type NamedColumnMapping,
  type StoredTransaction,
} from "./schema.js";

interface LearnedCategoryRecord {
  description: string;
  category: string;
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function commit(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * 書き込みを積んでからコミットする。
 *
 * `put` は keyPath が欠けた値などで**同期的に**例外を投げる。その例外をそのまま
 * 外に出すと、既に積んだ `clear()` や先行する `put` を抱えたトランザクションが
 * 誰にも中断されずコミットされる。全消ししてから失敗する経路（replaceAll）では
 * それがデータ消失になる。明示的に中断する。
 */
async function writeAll(transaction: IDBTransaction, queueWrites: () => void): Promise<void> {
  try {
    queueWrites();
  } catch (error) {
    transaction.abort();
    throw error;
  }
  await commit(transaction);
}

/**
 * 既存の取引に `memo` を埋める。
 *
 * `memo` は空文字列で持つ約束（`schema.ts`）。省略可能にすると `memo ?? ""` が
 * 呼び出し側に散るので、境界でここ1回だけ埋める。
 *
 * versionchange トランザクションの中で走るので、途中で失敗すればアップグレード
 * ごと巻き戻ってDBはv1のまま残る。中途半端に埋まった状態にはならない。
 */
function backfillMemo(store: IDBObjectStore): void {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }
    const value = cursor.value as StoredTransaction;
    if (typeof value.memo !== "string") {
      cursor.update({ ...value, memo: "" });
    }
    cursor.continue();
  };
}

/**
 * データベースを開く。必要ならスキーマを上げる。
 *
 * **`onblocked` を握るのが要。** 別のタブが古いバージョンで開いたままだと
 * versionchange が始められず、`onsuccess` も `onerror` も来ない。握らないと
 * Promise が永久に解決せず、画面は「読み込み中…」のまま何の説明も出せない。
 * v1 しか無かった間は upgrade が起きなかったので表に出なかった経路。
 */
export function openDatabase(indexedDB: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      reject(
        new Error(
          "このアプリを開いている他のタブがあるため、データベースを更新できません。" +
            "他のタブを閉じてから再読み込みしてください。",
        ),
      );
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_TRANSACTIONS)) {
        const store = db.createObjectStore(STORE_TRANSACTIONS, { keyPath: "id" });
        // 一覧は日付順に見るので索引を張る。件数が増えても並べ替えで詰まらない。
        store.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains(STORE_IMPORTS)) {
        db.createObjectStore(STORE_IMPORTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_COLUMN_MAPPINGS)) {
        db.createObjectStore(STORE_COLUMN_MAPPINGS, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(STORE_LEARNED_CATEGORIES)) {
        db.createObjectStore(STORE_LEARNED_CATEGORIES, { keyPath: "description" });
      }

      // --- v2 で増えたもの ---
      if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
        const store = db.createObjectStore(STORE_CATEGORIES, { keyPath: "name" });
        // 新規・既存を問わず初期値を入れる。ここでしか入れないので、後から
        // ユーザーが消したカテゴリが次回の起動で復活することは無い。
        for (const category of defaultCategories(DEFAULT_CATEGORY_RULES)) {
          store.put(category);
        }
      }
      if (!db.objectStoreNames.contains(STORE_BUDGETS)) {
        const store = db.createObjectStore(STORE_BUDGETS, { keyPath: "id" });
        // 予算画面は月単位で開くので、月で引ける索引を張る。
        store.createIndex("month", "month");
      }

      // 新規作成なら取引が空なので、埋め戻しは何もせずに終わる。`oldVersion` で
      // 分岐しないのはそのため——**どちらの経路でも結果が同じ条件を書くと、
      // 外しても誰も気づけない分岐が増える**だけになる。
      // onupgradeneeded の中では transaction は必ずある。型システムはそれを
      // 証明できないので ! で閉じる（parse-date.ts と同じ方針）。
      backfillMemo(request.transaction!.objectStore(STORE_TRANSACTIONS));
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getAllCategories(db: IDBDatabase): Promise<CategoryRecord[]> {
  const store = db.transaction(STORE_CATEGORIES, "readonly").objectStore(STORE_CATEGORIES);
  return toPromise(store.getAll() as IDBRequest<CategoryRecord[]>);
}

export function getAllBudgets(db: IDBDatabase): Promise<BudgetRecord[]> {
  const store = db.transaction(STORE_BUDGETS, "readonly").objectStore(STORE_BUDGETS);
  return toPromise(store.getAll() as IDBRequest<BudgetRecord[]>);
}

export function getAllTransactions(db: IDBDatabase): Promise<StoredTransaction[]> {
  const store = db.transaction(STORE_TRANSACTIONS, "readonly").objectStore(STORE_TRANSACTIONS);
  return toPromise(store.getAll() as IDBRequest<StoredTransaction[]>);
}

/**
 * 既存の取引を上書きする。再分類の結果を書き戻すのに使う。
 *
 * 取り込みには使わない。取り込みは履歴とマッピングも一緒に書く必要があり、
 * それを別トランザクションに分けると部分的に書かれた状態が残る（saveImport 参照）。
 */
export async function putTransactions(
  db: IDBDatabase,
  transactions: readonly StoredTransaction[],
): Promise<void> {
  const tx = db.transaction(STORE_TRANSACTIONS, "readwrite");
  const store = tx.objectStore(STORE_TRANSACTIONS);
  await writeAll(tx, () => {
    for (const transaction of transactions) {
      store.put(transaction);
    }
  });
}

/**
 * 取引を1件消す。**取り消せない。** 呼ぶ前に人間の確認を取ること。
 *
 * 存在しない id を渡しても失敗しない（IndexedDB の `delete` は該当なしでも
 * 成功する）。「消えていること」が求める結果で、それは既に満たされている——
 * 呼び出し側に「消す前に存在を確かめる」経路を作らせない。2つの画面から
 * 同じ行を消したときに、片方だけがエラーになる理由も無い。
 *
 * まとめて消す口は作らない。全消しは `replaceAll`（バックアップからの復元）
 * が持っていて、それ以外に複数件を一度に失う操作を増やさない。
 */
export async function deleteTransaction(db: IDBDatabase, id: string): Promise<void> {
  const tx = db.transaction(STORE_TRANSACTIONS, "readwrite");
  const store = tx.objectStore(STORE_TRANSACTIONS);
  await writeAll(tx, () => {
    store.delete(id);
  });
}

/**
 * カテゴリの付け替えをまとめて書く。マスタ・取引・学習を**1つのトランザクション**で。
 *
 * 分けて書くと、途中で失敗したときに「一覧では外食だが、次の再読み込みで
 * 食費に戻る」状態が残る。どのストアの書き込みが落ちたのかは画面から読めない。
 *
 * マスタは全消しして入れ直す。名前が主キーなので、名前を変えると古いキーの
 * レコードが残る——差分を追って消すより、渡された集合をそのまま正とする方が
 * ずれる余地が無い（`replaceAll` と同じ形）。
 */
export async function saveCategoryChange(db: IDBDatabase, change: CategoryChange): Promise<void> {
  const tx = db.transaction(
    [STORE_CATEGORIES, STORE_TRANSACTIONS, STORE_LEARNED_CATEGORIES],
    "readwrite",
  );
  await writeAll(tx, () => {
    const categories = tx.objectStore(STORE_CATEGORIES);
    categories.clear();
    for (const record of change.categories) {
      categories.put(record);
    }

    const transactions = tx.objectStore(STORE_TRANSACTIONS);
    for (const transaction of change.transactions) {
      transactions.put(transaction);
    }

    const learned = tx.objectStore(STORE_LEARNED_CATEGORIES);
    for (const entry of change.learned) {
      learned.put(entry);
    }
    for (const description of change.forget) {
      learned.delete(description);
    }
  });
}

/**
 * 1回の取り込みを丸ごと保存する。取引・取り込み履歴・使った列マッピングを
 * 1つのトランザクションで書く。
 *
 * ストアごとに分けて順に await すると、途中で失敗したときに「取引だけ入って
 * 履歴が無い」状態が残る。画面はそれをエラーとして表示するので、人間は
 * 失敗したと思って再試行し、同じ取引が別のIDでもう一度入る。
 */
export async function saveImport(
  db: IDBDatabase,
  transactions: readonly StoredTransaction[],
  record: ImportRecord,
  mapping: NamedColumnMapping,
): Promise<void> {
  const tx = db.transaction(
    [STORE_TRANSACTIONS, STORE_IMPORTS, STORE_COLUMN_MAPPINGS],
    "readwrite",
  );
  await writeAll(tx, () => {
    const store = tx.objectStore(STORE_TRANSACTIONS);
    for (const transaction of transactions) {
      store.put(transaction);
    }
    tx.objectStore(STORE_IMPORTS).put(record);
    tx.objectStore(STORE_COLUMN_MAPPINGS).put(mapping);
  });
}

export function getAllImports(db: IDBDatabase): Promise<ImportRecord[]> {
  const store = db.transaction(STORE_IMPORTS, "readonly").objectStore(STORE_IMPORTS);
  return toPromise(store.getAll() as IDBRequest<ImportRecord[]>);
}

export function getAllColumnMappings(db: IDBDatabase): Promise<NamedColumnMapping[]> {
  const store = db.transaction(STORE_COLUMN_MAPPINGS, "readonly").objectStore(STORE_COLUMN_MAPPINGS);
  return toPromise(store.getAll() as IDBRequest<NamedColumnMapping[]>);
}

export async function getLearnedCategories(db: IDBDatabase): Promise<LearnedCategories> {
  const store = db
    .transaction(STORE_LEARNED_CATEGORIES, "readonly")
    .objectStore(STORE_LEARNED_CATEGORIES);
  const records = await toPromise(store.getAll() as IDBRequest<LearnedCategoryRecord[]>);
  // fromEntries は own property を作るので、摘要が "__proto__" でも
  // プロトタイプを汚染しない。
  return Object.fromEntries(records.map((r) => [r.description, r.category]));
}

/**
 * 摘要1件のカテゴリを覚える。`UNCATEGORIZED` を渡すと忘れる。
 *
 * 取り消しの経路を残すのが要。一度覚えた分類を消せないと、間違って覚えさせた
 * ものを直せなくなる。
 *
 * **マップ全体を受け取る形にしない。** 全体を受けると呼び出し側が
 * 「読む → 直す → 書き戻す」をせざるを得ず、2件を続けて直したときに
 * 1件目の修正が黙って消える（lost update）。ストアの keyPath が description
 * なので、1件の更新は読み込み無しの put / delete で済み、競合の窓が無い。
 */
export async function setLearnedCategory(
  db: IDBDatabase,
  description: string,
  category: string,
): Promise<void> {
  const tx = db.transaction(STORE_LEARNED_CATEGORIES, "readwrite");
  const store = tx.objectStore(STORE_LEARNED_CATEGORIES);
  await writeAll(tx, () => {
    if (category === UNCATEGORIZED) {
      store.delete(description);
    } else {
      store.put({ description, category });
    }
  });
}

/**
 * バックアップから全データを復元する。既存のデータは消える。
 *
 * 1つのトランザクションでまとめて行う。途中で失敗したときに
 * 「取引だけ消えて復元されていない」状態を作らないため。
 */
export async function replaceAll(db: IDBDatabase, backup: BackupData): Promise<void> {
  const tx = db.transaction(
    [
      STORE_TRANSACTIONS,
      STORE_IMPORTS,
      STORE_COLUMN_MAPPINGS,
      STORE_LEARNED_CATEGORIES,
      STORE_CATEGORIES,
      STORE_BUDGETS,
    ],
    "readwrite",
  );

  await writeAll(tx, () => {
    const transactions = tx.objectStore(STORE_TRANSACTIONS);
    transactions.clear();
    for (const t of backup.transactions) {
      transactions.put(t);
    }

    const imports = tx.objectStore(STORE_IMPORTS);
    imports.clear();
    for (const record of backup.imports) {
      imports.put(record);
    }

    const mappings = tx.objectStore(STORE_COLUMN_MAPPINGS);
    mappings.clear();
    for (const mapping of backup.columnMappings) {
      mappings.put(mapping);
    }

    const learned = tx.objectStore(STORE_LEARNED_CATEGORIES);
    learned.clear();
    for (const [description, category] of Object.entries(backup.learnedCategories)) {
      learned.put({ description, category });
    }

    const categories = tx.objectStore(STORE_CATEGORIES);
    categories.clear();
    for (const category of backup.categories) {
      categories.put(category);
    }

    const budgets = tx.objectStore(STORE_BUDGETS);
    budgets.clear();
    for (const budget of backup.budgets) {
      budgets.put(budget);
    }
  });
}
