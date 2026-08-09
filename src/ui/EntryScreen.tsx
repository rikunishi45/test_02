import { useState, type ReactNode } from "react";
import {
  buildManualTransaction,
  type ManualEntryError,
  type ManualEntryField,
  type ManualEntryKind,
} from "../cash/manual-entry.js";
import { pressKey, type KeypadKey } from "../cash/keypad.js";
import { categoryFor, type LearnedCategories } from "../category/classify.js";
import { CATEGORIES, DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import { toIsoDate } from "../domain/date-parts.js";
import type { TransactionSource } from "../domain/transaction.js";
import { putTransactions, setLearnedCategory } from "../storage/db.js";
import type { StoredTransaction } from "../storage/schema.js";

/** カテゴリ欄の「自動」。摘要からの分類に任せる */
const AUTO = "";

const KINDS: readonly (readonly [ManualEntryKind, string])[] = [
  ["expense", "支出"],
  ["income", "収入"],
];

/** 支払い方法。`Transaction.source` そのもので、一覧の「元」列と同じ軸 */
const SOURCES: readonly (readonly [TransactionSource, string])[] = [
  ["cash", "現金"],
  ["card", "カード"],
  ["bank", "銀行"],
];

/** テンキーの並び。最下段は 00・0・訂正 */
const KEYS: readonly KeypadKey[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "00",
  "0",
  "backspace",
];

const KEY_LABEL: Partial<Record<KeypadKey, string>> = {
  backspace: "⌫",
  clear: "C",
};

const GROUPED = new Intl.NumberFormat("ja-JP");

interface Props {
  db: IDBDatabase;
  learned: LearnedCategories;
  onSaved: () => void;
}

export function EntryScreen({ db, learned, onSaved }: Props) {
  const [kind, setKind] = useState<ManualEntryKind>("expense");
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<TransactionSource>("cash");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(AUTO);
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState<ManualEntryError[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function errorFor(field: ManualEntryField): string | undefined {
    return errors.find((e) => e.field === field)?.message;
  }

  // 桁の積み上げは壁の中（pressKey）。ここは押されたキーを渡すだけ。
  function press(key: KeypadKey) {
    setAmount((current) => pressKey(current, key));
  }

  async function save() {
    // 検証は壁の中。画面は結果を出し分けるだけ。
    const result = buildManualTransaction({ date, amount, description, kind, source, memo });
    if (!result.ok) {
      setErrors(result.errors);
      setMessage("");
      return;
    }
    setErrors([]);

    // 二重クリックで同じ支出が別のIDで2件入るのを塞ぐ（ImportScreen と同じ）。
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      const stored: StoredTransaction = {
        ...result.transaction,
        id: crypto.randomUUID(),
        category: categoryFor(result.transaction, DEFAULT_CATEGORY_RULES, learned),
        memo: result.memo,
      };
      await putTransactions(db, [stored]);

      setMessage(`${result.transaction.description} を登録しました。`);
      // 日付と支払い方法は残す。同じ日・同じ手段で続けて入れることが多い。
      setAmount("");
      setDescription("");
      setCategory(AUTO);
      setMemo("");
      onSaved();

      // 明示的に選んだカテゴリは摘要ごとの学習として覚える。取引の category に
      // 書くだけでは、次の再読み込みで reclassifyTransactions がルール側の
      // 判定に戻してしまう。
      //
      // **取引の保存とは別に扱う。** 同じ try に入れてまとめて失敗を報告すると、
      // 取引は保存済みなのに「登録できませんでした」と出る。人間は再試行し、
      // 別のIDで同じ支出がもう1件入る。学習の失敗は一覧から選び直せば回復できる
      // ので、そう案内して登録の成功はそのまま残す。
      //
      // 収入では学習しない。カテゴリ欄は収入のとき出していないので `category` は
      // AUTO のままだが、支出で選んだ値が残ったまま収入に切り替える経路がある。
      // 学習は摘要ごと（符号を持たない）なので、そこで覚えると同じ摘要の**支出**
      // まで巻き込む。
      if (kind === "expense" && category !== AUTO) {
        try {
          await setLearnedCategory(db, result.transaction.description, category);
        } catch (error) {
          setMessage(
            `${result.transaction.description} を登録しました。` +
              `カテゴリは覚えられませんでした（一覧から選び直してください）: ${String(error)}`,
          );
        }
      }
    } catch (error) {
      setMessage(`登録できませんでした: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      {message !== "" && <p style={styles.message}>{message}</p>}

      <form
        style={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div style={styles.pad}>
          <div style={styles.kinds}>
            {KINDS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                style={kind === value ? styles.kindOn : styles.kindOff}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={styles.display}>
            <span style={styles.sign}>{kind === "expense" ? "−" : "+"}</span>
            <output style={kind === "expense" ? styles.amount : styles.amountIncome}>
              ¥{GROUPED.format(Number(amount === "" ? "0" : amount))}
            </output>
            <button
              type="button"
              style={styles.clear}
              onClick={() => press("clear")}
              aria-label="金額を消す"
            >
              {KEY_LABEL.clear}
            </button>
          </div>
          {errorFor("amount") !== undefined && (
            <p style={styles.padError}>{errorFor("amount")}</p>
          )}

          <div style={styles.keys}>
            {KEYS.map((key) => (
              <button key={key} type="button" style={styles.key} onClick={() => press(key)}>
                {KEY_LABEL[key] ?? key}
              </button>
            ))}
          </div>
        </div>

        <Field label="日付" error={errorFor("date")}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="支払い方法">
          <span style={styles.chips}>
            {SOURCES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={source === value}
                style={source === value ? styles.chipOn : styles.chip}
                onClick={() => setSource(value)}
              >
                {label}
              </button>
            ))}
          </span>
        </Field>

        <Field label="摘要" error={errorFor("description")}>
          <input
            placeholder="コンビニ"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {/*
          カテゴリ欄は支出のときだけ出す。sumByCategory は収入を集計に入れない
          （「カテゴリは支出の内訳を見るためのもの」— aggregate/period.ts）ので、
          収入に付けたカテゴリはどこにも出ない死んだ値になる。
        */}
        {kind === "expense" && (
          <Field label="カテゴリ">
            {/*
              「未分類」は選択肢に出さない。setLearnedCategory は UNCATEGORIZED を
              渡すと学習を消す仕様なので、選んでもルール判定に戻るだけで、明示的な
              選択が黙って捨てられる。ルールに任せる意味は「自動」が既に持っている。
            */}
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value={AUTO}>自動（摘要から判定）</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="メモ">
          <input
            placeholder="任意"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </Field>

        <p>
          <button type="submit" style={styles.primary} disabled={saving}>
            {saving ? "登録中…" : "登録する"}
          </button>
        </p>
      </form>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label style={styles.label}>
        <span style={styles.labelText}>{label}</span>
        {children}
      </label>
      {error !== undefined && <p style={styles.fieldError}>{error}</p>}
    </div>
  );
}

const styles = {
  form: {
    display: "grid",
    gap: 12,
    maxWidth: 420,
    border: "1px solid var(--line)",
    borderRadius: 6,
    padding: 16,
  },
  label: { display: "flex", gap: 8, alignItems: "center", fontSize: 14 },
  labelText: { width: 96, flexShrink: 0 },
  pad: { display: "grid", gap: 10 },
  kinds: { display: "flex", gap: 4 },
  kindOn: {
    flex: 1,
    padding: "6px 0",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    fontWeight: 650,
  },
  kindOff: { flex: 1, padding: "6px 0", color: "var(--muted)" },
  display: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    border: "1px solid var(--line)",
    borderRadius: 6,
    padding: "10px 12px",
  },
  sign: { fontSize: 20, color: "var(--muted)" },
  amount: {
    flex: 1,
    textAlign: "right",
    fontSize: 30,
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
    color: "var(--danger)",
  },
  amountIncome: {
    flex: 1,
    textAlign: "right",
    fontSize: 30,
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
    color: "var(--income)",
  },
  clear: { padding: "2px 10px", fontSize: 13, color: "var(--muted)" },
  keys: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 },
  key: {
    padding: "14px 0",
    fontSize: 19,
    fontVariantNumeric: "tabular-nums",
    borderRadius: 6,
  },
  chips: { display: "flex", gap: 6 },
  chip: { borderRadius: 999, padding: "3px 12px", fontSize: 13, color: "var(--muted)" },
  chipOn: {
    borderRadius: 999,
    padding: "3px 12px",
    fontSize: 13,
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    fontWeight: 650,
  },
  fieldError: {
    margin: "4px 0 0 104px",
    fontSize: 13,
    background: "var(--error)",
    padding: "4px 8px",
    borderRadius: 4,
  },
  padError: { fontSize: 13, background: "var(--error)", padding: "4px 8px", borderRadius: 4 },
  message: { background: "var(--success)", padding: "8px 12px", borderRadius: 6 },
  primary: {
    padding: "8px 18px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    borderRadius: 6,
  },
} as const;
