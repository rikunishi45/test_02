import { budgetId, type BudgetRecord, type CategoryRecord, type StoredTransaction } from "../storage/schema.js";
import { INCOME, UNCATEGORIZED, isCategorizable, type LearnedCategories } from "./classify.js";

/** 名前を変えられない・消せないカテゴリ */
export const FIXED_CATEGORIES: readonly string[] = [INCOME, UNCATEGORIZED];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * 書き戻す内容。**1つのトランザクションでまとめて書く前提**（`db.ts`）。
 *
 * 取引だけ書けて学習が書けない、といった中途半端な状態を作らない。カテゴリの
 * 付け替えは3つのストアにまたがるので、分けて書くと「一覧では外食だが、
 * 次の再読み込みで食費に戻る」状態が残る。
 */
export interface CategoryChange {
  /** 書き戻すマスタ全体 */
  categories: CategoryRecord[];
  /** カテゴリが変わった取引だけ */
  transactions: StoredTransaction[];
  /** 付け替える学習 */
  learned: { description: string; category: string }[];
  /**
   * 学習から消す摘要。
   *
   * **未分類への付け替えは「忘れる」と同じ意味にする。** 学習はルールより
   * 優先される（`classifyDescription`）ので、`未分類` を値として持たせると
   * 「常に未分類」に固定され、ルールを足しても当たらなくなる。
   * `setLearnedCategory` が `UNCATEGORIZED` で削除するのと同じ約束。
   */
  forget: string[];
  /**
   * 書き戻す予算。**予算のキーはカテゴリ名を含む**（`budgetId`）ので、名前が
   * 変わると id ごと作り直しになる。古い id は `removedBudgetIds` で消す。
   *
   * 追従させないと、旧名の予算が孤立して残る。しかも段階7の一覧は
   * 「予算のある行と支出のある行の和集合」なので、**旧名が「予算あり・支出0」の
   * 行として、新名が「予算外の支出」として別々に出る**——落ちも警告も出ない
   * （Codex 指摘）。
   */
  budgets: BudgetRecord[];
  /** 消す予算の id */
  removedBudgetIds: string[];
}

export type CategoryResult =
  | { ok: true; change: CategoryChange }
  | { ok: false; message: string };

/** 変更なし。呼び出し側が「成功したが書くものが無い」を分岐せずに済む */
const NO_CHANGE = (categories: readonly CategoryRecord[]): CategoryChange => ({
  categories: [...categories],
  transactions: [],
  learned: [],
  forget: [],
  budgets: [],
  removedBudgetIds: [],
});

export interface CategoryState {
  categories: readonly CategoryRecord[];
  transactions: readonly StoredTransaction[];
  learned: LearnedCategories;
  budgets: readonly BudgetRecord[];
}

/**
 * カテゴリの名前を変える。マスタ・取引・学習をまとめて付け替える。
 *
 * **収入と未分類は変えられない。** どちらもコードが定数として参照していて
 * （`categoryFor` は収入を返し、`setLearnedCategory` は未分類で学習を消す）、
 * 名前だけ変えると画面の表示と処理の判定が食い違う。
 *
 * **ルール（`default-rules.ts`）は旧名を返し続ける。** ルールはコード上の定数で
 * 実行時に書き換えられない。既存の取引は学習で新しい名前に固定されるが、
 * 名前を変えたあとに取り込んだ**新しい摘要**は旧名に分類される——それは
 * マスタに無い名前なので `reclassifyTransactions` が未分類に落とす。
 * そこで分類し直せば学習が覚える。
 */
export function renameCategory(state: CategoryState, from: string, to: string): CategoryResult {
  const name = to.trim();
  if (name === "") {
    return { ok: false, message: "カテゴリ名を入力してください" };
  }
  if (FIXED_CATEGORIES.includes(from)) {
    return { ok: false, message: `${from} は名前を変えられません` };
  }
  if (!state.categories.some((record) => record.name === from)) {
    return { ok: false, message: `${from} は存在しません` };
  }
  if (name === from) {
    return { ok: true, change: NO_CHANGE(state.categories) };
  }
  if (state.categories.some((record) => record.name === name)) {
    return { ok: false, message: `${name} は既にあります` };
  }

  return {
    ok: true,
    change: {
      categories: state.categories.map((record) =>
        record.name === from ? { ...record, name } : record,
      ),
      transactions: movedTransactions(state.transactions, from, name),
      ...movedLearned(state, from, name),
      ...movedBudgets(state, from, name),
    },
  };
}

/**
 * カテゴリを消して、その取引を別のカテゴリに付け替える。
 *
 * **付け替え先を必ず取る。** 消すだけにすると、取引はマスタに無いカテゴリを
 * 指したまま残る。どこへ行ったかを人間が決める形にする。
 */
export function removeCategory(
  state: CategoryState,
  name: string,
  reassignTo: string,
): CategoryResult {
  if (FIXED_CATEGORIES.includes(name)) {
    return { ok: false, message: `${name} は消せません` };
  }
  if (!state.categories.some((record) => record.name === name)) {
    return { ok: false, message: `${name} は存在しません` };
  }
  if (reassignTo === name) {
    return { ok: false, message: "付け替え先には別のカテゴリを選んでください" };
  }
  if (!state.categories.some((record) => record.name === reassignTo)) {
    return { ok: false, message: `${reassignTo} は存在しません` };
  }

  return {
    ok: true,
    change: {
      categories: state.categories.filter((record) => record.name !== name),
      transactions: movedTransactions(state.transactions, name, reassignTo),
      ...movedLearned(state, name, reassignTo),
      ...movedBudgets(state, name, reassignTo),
    },
  };
}

/** 表示色を変える。取引には触らない */
export function recolorCategory(
  categories: readonly CategoryRecord[],
  name: string,
  color: string,
): CategoryResult {
  if (!HEX_COLOR.test(color)) {
    return { ok: false, message: `色は #rrggbb の形式で指定してください: ${color}` };
  }
  if (!categories.some((record) => record.name === name)) {
    return { ok: false, message: `${name} は存在しません` };
  }
  return {
    ok: true,
    change: {
      ...NO_CHANGE(categories),
      categories: categories.map((record) => (record.name === name ? { ...record, color } : record)),
    },
  };
}

/**
 * 並び順を1つ動かす。端では何も起きない。
 *
 * **動かしたあとに 0 から振り直す。** 隣と `order` を交換するだけだと、
 * 初期値に同じ `order` や飛び番があったときに順序が決まらない。振り直せば
 * 「一覧に見えている順序」と `order` が常に一致する。
 */
export function moveCategory(
  categories: readonly CategoryRecord[],
  name: string,
  direction: -1 | 1,
): CategoryResult {
  const ordered = sortByOrder(categories);
  const index = ordered.findIndex((record) => record.name === name);
  if (index === -1) {
    return { ok: false, message: `${name} は存在しません` };
  }
  const target = index + direction;
  if (target < 0 || target >= ordered.length) {
    return { ok: true, change: NO_CHANGE(categories) };
  }

  const moved = [...ordered];
  const [record] = moved.splice(index, 1);
  moved.splice(target, 0, record!);

  return {
    ok: true,
    change: {
      ...NO_CHANGE(categories),
      categories: moved.map((item, position) => ({ ...item, order: position })),
    },
  };
}

/** `order` の昇順。同じ `order` は名前の昇順で決着させる（`categoryNames` と同じ方針） */
function sortByOrder(categories: readonly CategoryRecord[]): CategoryRecord[] {
  return [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function movedTransactions(
  transactions: readonly StoredTransaction[],
  from: string,
  to: string,
): StoredTransaction[] {
  return transactions
    .filter((transaction) => transaction.category === from)
    .map((transaction) => ({ ...transaction, category: to }));
}

/**
 * 付け替えに伴う学習の書き換え。
 *
 * **既存の学習を移すだけでは足りない。** 取引の大半はルールで分類されていて
 * 学習を持たない。マスタの名前だけ変えても、次の再分類でルールが旧名を返し、
 * その名前はもうマスタに無いので未分類に落ちる——実データで確認した
 * （娯楽6件を趣味に変えたら、趣味 0件・未分類 +6 になった）。
 *
 * だから**動かす取引の摘要を学習に覚えさせる。** 学習はルールより優先される
 * ので、これで新しい名前に固定される。人間が一覧で1行のカテゴリを直したときに
 * 起きることと同じで、それを対象の行すべてに広げているだけ。
 *
 * 収入と0円の取引は対象外。どちらも符号で決まり、学習を見ない（`categoryFor`）。
 */
function movedLearned(
  state: CategoryState,
  from: string,
  to: string,
): { learned: { description: string; category: string }[]; forget: string[] } {
  const descriptions = new Set(descriptionsOf(state.learned, from));
  for (const transaction of state.transactions) {
    if (transaction.category === from && isCategorizable(transaction)) {
      descriptions.add(transaction.description);
    }
  }

  // 未分類へ動かすなら覚えさせない。学習に未分類を持たせると「常に未分類」に
  // 固定され、ルールを足しても当たらなくなる（CategoryChange.forget 参照）。
  if (to === UNCATEGORIZED) {
    return { learned: [], forget: [...descriptions] };
  }
  return {
    learned: [...descriptions].map((description) => ({ description, category: to })),
    forget: [],
  };
}

/**
 * 予算の付け替え。月ごとに、`from` の予算を `to` へ移す。
 *
 * **移す先に同じ月の予算が既にあれば足す。** 取引（＝支出）が移るので、
 * 使ってよい額も一緒に移らないと、移した先が理由もなく超過する。
 * `schema.ts` の「総額はカテゴリ別予算の合計」に従えば、月の総額は
 * 付け替えの前後で変わらないのが筋。
 */
function movedBudgets(
  state: CategoryState,
  from: string,
  to: string,
): { budgets: BudgetRecord[]; removedBudgetIds: string[] } {
  const moving = state.budgets.filter((record) => record.category === from);
  const existing = new Map(
    state.budgets
      .filter((record) => record.category === to)
      .map((record) => [record.month, record.amountYen]),
  );

  return {
    budgets: moving.map((record) => ({
      id: budgetId(record.month, to),
      month: record.month,
      category: to,
      amountYen: record.amountYen + (existing.get(record.month) ?? 0),
    })),
    removedBudgetIds: moving.map((record) => record.id),
  };
}

function descriptionsOf(learned: LearnedCategories, category: string): string[] {
  return Object.entries(learned)
    .filter(([, value]) => value === category)
    .map(([description]) => description);
}

/**
 * 支出の行に付けられるカテゴリ。**収入を除く。**
 *
 * 収入かどうかは符号で決まる（`categoryFor`）。支出の行に「収入」を選ばせると、
 * 次の再分類で必ず戻る値を選べることになる。
 *
 * 未分類は残す。一覧の選択欄で未分類に戻すのは「学習を消す」経路
 * （`setLearnedCategory`）で、取り消しの手段として要る。
 */
export function expenseCategories(names: readonly string[]): string[] {
  return names.filter((name) => name !== INCOME);
}

/**
 * 新しい取引に**明示的に**選ばせるカテゴリ。収入と未分類の両方を除く。
 *
 * 未分類を出さないのは、選んでもルール判定に戻るだけで明示的な選択が黙って
 * 捨てられるため（`setLearnedCategory` は未分類で学習を消す）。ルールに任せる
 * 意味は入力欄の「自動」が既に持っている。
 */
export function selectableCategories(names: readonly string[]): string[] {
  return names.filter((name) => !FIXED_CATEGORIES.includes(name));
}
