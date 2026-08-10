import { useRef, useState } from "react";
import { monthOf, negateExpense, shiftMonth } from "../aggregate/period.js";
import { expenseCategories } from "../category/manage.js";
import { clampNumber } from "../clamp-number.js";
import { toIsoDate } from "../domain/date-parts.js";
import { setBudget } from "../storage/db.js";
import type { BudgetRecord, StoredTransaction } from "../storage/schema.js";
import { parseBudgetInput } from "../budget/input.js";
import {
  budgetProgress,
  budgetSummary,
  unbudgetedYen,
  type BudgetRow,
} from "../budget/progress.js";

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });
const PERCENT = new Intl.NumberFormat("ja-JP", { style: "percent", maximumFractionDigits: 0 });

interface Props {
  db: IDBDatabase;
  transactions: StoredTransaction[];
  /** 予算を立てられるカテゴリ。マスタの並び順 */
  categories: readonly string[];
  /**
   * 予算。**この画面では持たない。**
   *
   * 自前で読み直すと、`App` 側の予算が古いままになる。カテゴリの改名は
   * `App` の予算を見て移送先を決めるので（`movedBudgets`）、古いコピーが
   * 残っていると**改名しても予算が付いてこない**——実データで踏んだ。
   */
  budgets: readonly BudgetRecord[];
  /** 書き込みのあとに読み直す。`App` の予算と取引をまとめて更新する */
  onChanged: () => Promise<void>;
}

/**
 * 月×カテゴリの予算。
 *
 * 予算は取引と違って「読み直して一覧に反映する」だけなので、`App` の
 * `reload` は呼ばずにこの画面の中で読み直す。取引のカテゴリや件数は変わらない。
 */
export function BudgetScreen({ db, transactions, categories, budgets, onChanged }: Props) {
  const [month, setMonth] = useState(() => monthOf(toIsoDate(new Date())));
  const [draft, setDraft] = useState<{ category: string; value: string } | null>(null);
  const [message, setMessage] = useState("");
  const running = useRef(false);

  async function save(category: string, value: string) {
    if (running.current) {
      return;
    }
    running.current = true;
    try {
      // 入力の解釈は壁の中。空欄は 0 になり、setBudget がレコードを消す。
      const parsed = parseBudgetInput(value);
      if (!parsed.ok) {
        setMessage(parsed.message);
        return;
      }
      await setBudget(db, month, category, parsed.amountYen);
      // 読み直しは App に任せる。ここで自前の state を持つと二重の真実になる。
      await onChanged();
      setDraft(null);
      setMessage("");
    } catch (error) {
      setMessage(`保存できませんでした: ${String(error)}`);
    } finally {
      running.current = false;
    }
  }

  // 突き合わせと合計は壁の中。ここは呼んで並べるだけ。
  const rows = budgetProgress(budgets, transactions, month);
  const summary = budgetSummary(rows);
  const outside = unbudgetedYen(rows);
  // 予算を立てていないカテゴリを足せるようにする。既に行があるものは出さない。
  const shown = new Set(rows.map((row) => row.category));
  const addable = expenseCategories(categories).filter((name) => !shown.has(name));

  return (
    <section>
      <div style={styles.bar}>
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <span style={styles.month}>{month}</span>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </button>
        <button type="button" onClick={() => setMonth(monthOf(toIsoDate(new Date())))}>
          今月
        </button>
      </div>

      {message !== "" && <p style={styles.message}>{message}</p>}

      <div style={styles.summary}>
        <Stat label="予算" value={YEN.format(summary.budgetYen)} />
        <Stat label="使った" value={YEN.format(negateExpense(summary.spentYen))} tone="expense" />
        <Stat
          label="残り"
          value={YEN.format(summary.remainingYen)}
          tone={summary.remainingYen < 0 ? "expense" : "income"}
        />
        <Stat
          label="達成率"
          value={summary.budgetYen > 0 ? PERCENT.format(summary.ratio) : "—"}
          tone={summary.ratio > 1 ? "expense" : "plain"}
        />
      </div>
      {outside > 0 && (
        <p style={styles.outside}>
          予算を立てていないカテゴリで {YEN.format(negateExpense(outside))} 使っています。
        </p>
      )}

      {rows.length === 0 && addable.length === 0 ? (
        <p style={styles.empty}>この月の取引もカテゴリもありません。</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>カテゴリ</th>
              <th style={{ ...styles.th, textAlign: "right" }}>予算</th>
              <th style={{ ...styles.th, textAlign: "right" }}>使った</th>
              <th style={{ ...styles.th, textAlign: "right" }}>残り</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.category}
                row={row}
                editing={draft?.category === row.category}
                draft={draft?.value ?? ""}
                onDraft={(value) => setDraft({ category: row.category, value })}
                onEdit={() =>
                  setDraft({
                    category: row.category,
                    value: row.budgeted ? String(row.budgetYen) : "",
                  })
                }
                onCancel={() => setDraft(null)}
                onSave={() => void save(row.category, draft?.value ?? "")}
              />
            ))}
          </tbody>
        </table>
      )}

      {addable.length > 0 && (
        <p style={styles.add}>
          <label>
            予算を足す：
            <select
              aria-label="予算を足すカテゴリ"
              value=""
              onChange={(e) => {
                if (e.target.value !== "") {
                  setDraft({ category: e.target.value, value: "" });
                }
              }}
            >
              <option value="">カテゴリを選ぶ</option>
              {addable.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {draft !== null && !shown.has(draft.category) && (
            <span style={styles.addRow}>
              {draft.category}
              <input
                inputMode="numeric"
                aria-label="予算額"
                style={styles.input}
                value={draft.value}
                onChange={(e) => setDraft({ category: draft.category, value: e.target.value })}
              />
              <button
                type="button"
                style={styles.primary}
                onClick={() => void save(draft.category, draft.value)}
              >
                保存
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                やめる
              </button>
            </span>
          )}
        </p>
      )}
    </section>
  );
}

function Row({
  row,
  editing,
  draft,
  onDraft,
  onEdit,
  onCancel,
  onSave,
}: {
  row: BudgetRow;
  editing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <tr>
      <td style={styles.td}>
        {row.category}
        <Bar ratio={row.ratio} budgeted={row.budgeted} />
      </td>
      <td style={styles.amount}>
        {editing ? (
          <input
            inputMode="numeric"
            aria-label={`${row.category} の予算額`}
            style={styles.input}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
          />
        ) : row.budgeted ? (
          YEN.format(row.budgetYen)
        ) : (
          <span style={styles.none}>—</span>
        )}
      </td>
      <td style={styles.amount}>{YEN.format(negateExpense(row.spentYen))}</td>
      <td style={{ ...styles.amount, ...(row.remainingYen < 0 ? styles.over : undefined) }}>
        {row.budgeted ? YEN.format(row.remainingYen) : <span style={styles.none}>—</span>}
      </td>
      <td style={styles.actions}>
        {editing ? (
          <>
            <button type="button" style={styles.primary} onClick={onSave}>
              保存
            </button>
            <button type="button" style={styles.small} onClick={onCancel}>
              やめる
            </button>
          </>
        ) : (
          <button type="button" style={styles.small} onClick={onEdit}>
            {row.budgeted ? "変える" : "決める"}
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * 使った割合の帯。**100%を超えても帯は振り切らせず、色で示す。**
 *
 * 幅を1より大きくすると隣の列にはみ出す。`clampNumber` で 0〜1 に収め、
 * 超過は色と「残り」の負の数で読ませる。
 */
function Bar({ ratio, budgeted }: { ratio: number; budgeted: boolean }) {
  if (!budgeted) {
    return null;
  }
  const width = clampNumber(ratio, 0, 1);
  return (
    <span style={styles.track}>
      <span
        style={{
          ...styles.fill,
          width: `${width * 100}%`,
          background: ratio > 1 ? "var(--danger)" : "var(--bar)",
        }}
      />
    </span>
  );
}

function Stat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "expense" | "income" | "plain";
}) {
  const color =
    tone === "expense" ? "var(--danger)" : tone === "income" ? "var(--income)" : "var(--fg)";
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{label}</span>
      <span style={{ ...styles.statValue, color }}>{value}</span>
    </div>
  );
}

const styles = {
  bar: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  month: { fontSize: 15, fontWeight: 650, fontVariantNumeric: "tabular-nums" },
  message: { fontSize: 13, background: "var(--error)", padding: "6px 10px", borderRadius: 6 },
  summary: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10,
    marginBottom: 10,
  },
  stat: {
    display: "grid",
    gap: 2,
    border: "1px solid var(--line)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--surface)",
  },
  statLabel: { fontSize: 12, color: "var(--muted)" },
  statValue: { fontSize: 19, fontWeight: 650, fontVariantNumeric: "tabular-nums" },
  outside: { fontSize: 13, color: "var(--muted)", margin: "0 0 12px" },
  empty: { fontSize: 13, color: "var(--muted)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    borderBottom: "2px solid var(--line)",
    padding: "6px 8px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--muted)",
  },
  td: { borderBottom: "1px solid var(--line)", padding: "6px 8px" },
  amount: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  actions: {
    borderBottom: "1px solid var(--line)",
    padding: "6px 8px",
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  over: { color: "var(--danger)" },
  none: { color: "var(--faint)" },
  input: { width: 100, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  track: {
    display: "block",
    background: "var(--line)",
    borderRadius: 3,
    height: 6,
    marginTop: 4,
    maxWidth: 220,
  },
  fill: { display: "block", borderRadius: 3, height: 6 },
  small: { fontSize: 12, padding: "2px 8px", marginLeft: 4, color: "var(--muted)" },
  primary: {
    fontSize: 12,
    padding: "2px 10px",
    marginLeft: 4,
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
  },
  add: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 },
  addRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
} as const;
