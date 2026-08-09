import { useState } from "react";
import {
  buildManualTransaction,
  toManualEntryInput,
  type ManualEntryError,
  type ManualEntryField,
  type ManualEntryInput,
  type ManualEntryKind,
} from "../cash/manual-entry.js";
import { categoryFor, type LearnedCategories } from "../category/classify.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import type { TransactionSource } from "../domain/transaction.js";
import { putTransactions } from "../storage/db.js";
import type { StoredTransaction } from "../storage/schema.js";

const KINDS: readonly (readonly [ManualEntryKind, string])[] = [
  ["expense", "支出"],
  ["income", "収入"],
];

const SOURCES: readonly (readonly [TransactionSource, string])[] = [
  ["cash", "現金"],
  ["card", "カード"],
  ["bank", "銀行"],
];

interface Props {
  db: IDBDatabase;
  transaction: StoredTransaction;
  learned: LearnedCategories;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * 取引1件の編集。カテゴリ欄は持たない——一覧の行にある選択欄が既に
 * 「摘要ごとに覚える」経路を持っていて、ここに2つ目を作ると同じ値を別の
 * 意味で書ける（片方は1件だけ、片方は同じ摘要すべて）。
 */
export function TransactionEditor({ db, transaction, learned, onSaved, onCancel }: Props) {
  // 符号をほどくのは壁の中（toManualEntryInput）。
  const [input, setInput] = useState<ManualEntryInput>(() => toManualEntryInput(transaction));
  const [errors, setErrors] = useState<ManualEntryError[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ManualEntryInput>(key: K, value: ManualEntryInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  function errorFor(field: ManualEntryField): string | undefined {
    return errors.find((e) => e.field === field)?.message;
  }

  async function save() {
    const result = buildManualTransaction(input);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage("");
      return;
    }
    setErrors([]);

    if (saving) {
      return;
    }
    setSaving(true);
    try {
      // **id を引き継ぐ。** 新しい id を振ると上書きではなく2件目になる。
      // カテゴリは組み立て直した取引から取り直す——摘要を直したときも、
      // 支出から収入に変えたときも、古い判定が残らない。
      const updated: StoredTransaction = {
        ...result.transaction,
        id: transaction.id,
        category: categoryFor(result.transaction, DEFAULT_CATEGORY_RULES, learned),
        memo: result.memo,
      };
      await putTransactions(db, [updated]);
      onSaved();
    } catch (error) {
      setMessage(`保存できませんでした: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      style={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {message !== "" && <p style={styles.message}>{message}</p>}

      <div style={styles.row}>
        <span style={styles.seg}>
          {KINDS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={input.kind === value}
              style={input.kind === value ? styles.segOn : styles.segOff}
              onClick={() => set("kind", value)}
            >
              {label}
            </button>
          ))}
        </span>

        <input
          type="date"
          aria-label="日付"
          value={input.date}
          onChange={(e) => set("date", e.target.value)}
        />

        <input
          inputMode="numeric"
          aria-label="金額"
          style={styles.amount}
          value={input.amount}
          onChange={(e) => set("amount", e.target.value)}
        />

        <span style={styles.seg}>
          {SOURCES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={input.source === value}
              style={input.source === value ? styles.chipOn : styles.chip}
              onClick={() => set("source", value)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      <div style={styles.row}>
        <input
          aria-label="摘要"
          style={styles.description}
          value={input.description}
          onChange={(e) => set("description", e.target.value)}
        />
        <input
          aria-label="メモ"
          placeholder="メモ（任意）"
          style={styles.memo}
          value={input.memo}
          onChange={(e) => set("memo", e.target.value)}
        />
        <button type="submit" style={styles.primary} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button type="button" onClick={onCancel}>
          やめる
        </button>
      </div>

      {(["date", "amount", "description"] as const).map((field) =>
        errorFor(field) === undefined ? null : (
          <p key={field} style={styles.error}>
            {errorFor(field)}
          </p>
        ),
      )}
    </form>
  );
}

const styles = {
  form: { display: "grid", gap: 8, padding: "10px 8px" },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  seg: { display: "flex", gap: 4 },
  segOn: {
    padding: "3px 12px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    fontWeight: 650,
  },
  segOff: { padding: "3px 12px", color: "var(--muted)" },
  chip: { borderRadius: 999, padding: "3px 10px", fontSize: 13, color: "var(--muted)" },
  chipOn: {
    borderRadius: 999,
    padding: "3px 10px",
    fontSize: 13,
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    fontWeight: 650,
  },
  amount: { width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  description: { flex: "1 1 160px" },
  memo: { flex: "1 1 160px" },
  primary: {
    padding: "4px 14px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
  },
  error: { fontSize: 13, background: "var(--error)", padding: "4px 8px", borderRadius: 4 },
  message: { fontSize: 13, background: "var(--error)", padding: "4px 8px", borderRadius: 4 },
} as const;
