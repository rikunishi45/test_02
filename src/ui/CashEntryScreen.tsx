import { useState, type ReactNode } from "react";
import {
  buildCashTransaction,
  type CashEntryError,
  type CashEntryField,
  type CashEntryKind,
} from "../cash/manual-entry.js";
import { classifyDescription, type LearnedCategories } from "../category/classify.js";
import { CATEGORIES, DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import { toIsoDate } from "../domain/date-parts.js";
import { putTransactions, setLearnedCategory } from "../storage/db.js";
import type { StoredTransaction } from "../storage/schema.js";

/** カテゴリ欄の「自動」。摘要からの分類に任せる */
const AUTO = "";

const KINDS: readonly (readonly [CashEntryKind, string])[] = [
  ["expense", "支出"],
  ["income", "収入"],
];

interface Props {
  db: IDBDatabase;
  learned: LearnedCategories;
  onSaved: () => void;
}

export function CashEntryScreen({ db, learned, onSaved }: Props) {
  const [kind, setKind] = useState<CashEntryKind>("expense");
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(AUTO);
  const [errors, setErrors] = useState<CashEntryError[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function errorFor(field: CashEntryField): string | undefined {
    return errors.find((e) => e.field === field)?.message;
  }

  async function save() {
    // 検証は壁の中。画面は結果を出し分けるだけ。
    const result = buildCashTransaction({ date, amount, description, kind });
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
        category: classifyDescription(
          result.transaction.description,
          DEFAULT_CATEGORY_RULES,
          learned,
        ),
      };
      await putTransactions(db, [stored]);

      setMessage(`${result.transaction.description} を登録しました。`);
      // 日付は残す。同じ日の分を続けて入れることが多い。
      setAmount("");
      setDescription("");
      setCategory(AUTO);
      onSaved();

      // 明示的に選んだカテゴリは摘要ごとの学習として覚える。取引の category に
      // 書くだけでは、次の再読み込みで reclassifyTransactions がルール側の
      // 判定に戻してしまう。
      //
      // **取引の保存とは別に扱う。** 同じ try に入れてまとめて失敗を報告すると、
      // 取引は保存済みなのに「登録できませんでした」と出る。人間は再試行し、
      // 別のIDで同じ支出がもう1件入る——個別削除の経路が無いので、これは
      // バックアップからの全復元でしか消せない。学習の失敗は一覧から選び直せば
      // 回復できるので、そう案内して登録の成功はそのまま残す。
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
      <p style={styles.lead}>CSVに現れない現金の支出と収入を手で足します。</p>

      {message !== "" && <p style={styles.message}>{message}</p>}

      <form
        style={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="種別">
          <span style={styles.kinds}>
            {KINDS.map(([value, label]) => (
              <label key={value} style={styles.kind}>
                <input
                  type="radio"
                  name="kind"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {label}
              </label>
            ))}
          </span>
        </Field>

        <Field label="日付" error={errorFor("date")}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="金額（円）" error={errorFor("amount")}>
          <input
            inputMode="numeric"
            placeholder="1200"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
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
  lead: { fontSize: 14, color: "var(--muted)" },
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
  kinds: { display: "flex", gap: 16 },
  kind: { display: "flex", gap: 4, alignItems: "center" },
  fieldError: {
    margin: "4px 0 0 104px",
    fontSize: 13,
    background: "var(--error)",
    padding: "4px 8px",
    borderRadius: 4,
  },
  message: { background: "var(--success)", padding: "8px 12px", borderRadius: 6 },
  primary: {
    padding: "8px 18px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    borderRadius: 6,
  },
} as const;
