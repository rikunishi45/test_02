import { useRef, useState } from "react";
import {
  FIXED_CATEGORIES,
  moveCategory,
  recolorCategory,
  removeCategory,
  renameCategory,
  type CategoryResult,
  type CategoryState,
} from "../category/manage.js";
import type { LearnedCategories } from "../category/classify.js";
import { saveCategoryChange } from "../storage/db.js";
import type { BudgetRecord, CategoryRecord, StoredTransaction } from "../storage/schema.js";

interface Props {
  db: IDBDatabase;
  categories: readonly CategoryRecord[];
  transactions: readonly StoredTransaction[];
  learned: LearnedCategories;
  /** 予算。カテゴリ名が変わると id ごと付け替わるので、判断に要る */
  budgets: readonly BudgetRecord[];
  /**
   * 書き込みのあとに一覧を読み直す。**Promise を返すこと。**
   *
   * 読み直しの完了を待たずにボタンを戻すと、古い `categories` から次の
   * `CategoryChange` が組まれる。`saveCategoryChange` はマスタを入れ直すので、
   * その1回で直前の操作が消える（並び替えの矢印を続けて押すと踏む）。
   */
  onChanged: () => Promise<void>;
}

/**
 * カテゴリの管理。名前・色・並び順・削除時の付け替え。
 *
 * どの操作も「今の状態 → 書き戻す内容」を壁の中（`manage.ts`）で組み立てて、
 * ここは結果を書いて読み直すだけ。付け替えはマスタ・取引・学習の3つに
 * またがるので、書き込みも1つのトランザクションに閉じてある。
 */
export function CategoryPanel({ db, categories, transactions, learned, budgets, onChanged }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // disabled は再描画されるまで効かない。同じフレーム内の2連打は state では
  // 止められないので、同期的に読める印で塞ぐ。
  const running = useRef(false);

  const state: CategoryState = { categories, transactions, learned, budgets };

  async function apply(result: CategoryResult) {
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (running.current) {
      return;
    }
    running.current = true;
    setSaving(true);
    setMessage("");
    try {
      await saveCategoryChange(db, result.change);
      setEditing(null);
      setRemoving(null);
      // 読み直しまで待ってからボタンを戻す。待たないと、古いマスタから
      // 組んだ次の書き込みが直前の変更を消す。
      await onChanged();
    } catch (error) {
      setMessage(`保存できませんでした: ${String(error)}`);
    } finally {
      running.current = false;
      setSaving(false);
    }
  }

  /** 並び順は order の昇順。マスタの読み出し順（主キー順）ではない */
  const ordered = [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  function countOf(name: string): number {
    return transactions.filter((transaction) => transaction.category === name).length;
  }

  return (
    <section style={styles.section}>
      <h2 style={styles.heading}>カテゴリ</h2>
      <p style={styles.lead}>
        名前を変えると、その名前を使っている取引と学習もまとめて付け替わります。
      </p>

      {message !== "" && <p style={styles.message}>{message}</p>}

      <ul style={styles.list}>
        {ordered.map((record, index) => {
          const fixed = FIXED_CATEGORIES.includes(record.name);
          return (
            <li key={record.name} style={styles.item}>
              <span style={styles.move}>
                <button
                  type="button"
                  aria-label={`${record.name} を上へ`}
                  style={styles.iconButton}
                  disabled={index === 0 || saving}
                  onClick={() => void apply(moveCategory(categories, record.name, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${record.name} を下へ`}
                  style={styles.iconButton}
                  disabled={index === ordered.length - 1 || saving}
                  onClick={() => void apply(moveCategory(categories, record.name, 1))}
                >
                  ↓
                </button>
              </span>

              <input
                type="color"
                aria-label={`${record.name} の色`}
                style={styles.color}
                value={record.color}
                onChange={(e) => void apply(recolorCategory(categories, record.name, e.target.value))}
              />

              {editing === record.name ? (
                <>
                  <input
                    aria-label="新しいカテゴリ名"
                    style={styles.nameInput}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                  <button
                    type="button"
                    style={styles.primary}
                    disabled={saving}
                    onClick={() => void apply(renameCategory(state, record.name, draftName))}
                  >
                    保存
                  </button>
                  <button type="button" style={styles.small} onClick={() => setEditing(null)}>
                    やめる
                  </button>
                </>
              ) : (
                <>
                  <span style={styles.name}>{record.name}</span>
                  <span style={styles.count}>{countOf(record.name)} 件</span>
                  {/*
                    収入と未分類は名前を変えられない・消せない。どちらもコードが
                    定数として参照していて、名前だけ変えると表示と判定が食い違う。
                  */}
                  {!fixed && (
                    <>
                      <button
                        type="button"
                        style={styles.small}
                        onClick={() => {
                          setRemoving(null);
                          setDraftName(record.name);
                          setEditing(record.name);
                        }}
                      >
                        名前
                      </button>
                      <button
                        type="button"
                        style={styles.small}
                        onClick={() => {
                          setEditing(null);
                          setReassignTo("");
                          setRemoving(record.name);
                        }}
                      >
                        削除
                      </button>
                    </>
                  )}
                </>
              )}

              {removing === record.name && (
                <span style={styles.confirm}>
                  {/*
                    消すだけの経路は作らない。付け替え先を選ばせないと、取引は
                    マスタに無いカテゴリを指したまま残る。
                  */}
                  <span style={styles.confirmText}>
                    {countOf(record.name)} 件の付け替え先
                  </span>
                  <select
                    aria-label="付け替え先"
                    value={reassignTo}
                    onChange={(e) => setReassignTo(e.target.value)}
                  >
                    <option value="">選んでください</option>
                    {ordered
                      .filter((other) => other.name !== record.name)
                      .map((other) => (
                        <option key={other.name} value={other.name}>
                          {other.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    style={styles.danger}
                    disabled={reassignTo === "" || saving}
                    onClick={() => void apply(removeCategory(state, record.name, reassignTo))}
                  >
                    削除する
                  </button>
                  <button type="button" style={styles.small} onClick={() => setRemoving(null)}>
                    やめる
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const styles = {
  section: { marginBottom: 28 },
  heading: { fontSize: 15, fontWeight: 650, margin: "0 0 6px" },
  lead: { fontSize: 13, color: "var(--muted)", margin: "0 0 10px" },
  message: { fontSize: 13, background: "var(--error)", padding: "6px 10px", borderRadius: 6 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxWidth: 640 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    border: "1px solid var(--line)",
    borderRadius: 6,
    padding: "6px 10px",
  },
  move: { display: "flex", gap: 2 },
  iconButton: { padding: "0 6px", fontSize: 12, color: "var(--muted)" },
  color: { width: 34, height: 26, padding: 0 },
  name: { fontWeight: 600 },
  nameInput: { flex: "1 1 140px" },
  count: { fontSize: 12, color: "var(--faint)", fontVariantNumeric: "tabular-nums" },
  small: { fontSize: 12, padding: "2px 8px", color: "var(--muted)" },
  primary: {
    fontSize: 12,
    padding: "2px 10px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
  },
  confirm: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginLeft: "auto",
  },
  confirmText: { fontSize: 12, color: "var(--danger)" },
  danger: {
    fontSize: 12,
    padding: "2px 8px",
    background: "var(--danger)",
    borderColor: "var(--danger)",
    color: "var(--accent-fg)",
    fontWeight: 650,
  },
} as const;
