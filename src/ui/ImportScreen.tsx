import { useEffect, useState } from "react";
import { decodeBytes } from "../csv/decode-bytes.js";
import { parseCsv } from "../csv/parse-csv.js";
import { applyMapping, type RowError } from "../csv/column-mapping.js";
import { classifyForImport, type ClassifiedTransaction } from "../import/classify-duplicates.js";
import { isSelectedForImport } from "../import/selection.js";
import { categoryFor, type LearnedCategories } from "../category/classify.js";
import { DEFAULT_CATEGORY_RULES } from "../category/default-rules.js";
import { getAllColumnMappings, saveImport } from "../storage/db.js";
import type { NamedColumnMapping, StoredTransaction } from "../storage/schema.js";
import type { Transaction, TransactionSource } from "../domain/transaction.js";

// 楽天カードの明細（実データで確認した列構成）を初期値にしておく。
// 別の口座を取り込むときは画面で変えて保存すれば、次回から選べる。
const DEFAULT_MAPPING: NamedColumnMapping = {
  name: "楽天カード",
  skipRows: 1,
  dateColumn: 0,
  amountColumn: 4,
  descriptionColumn: 1,
  source: "card",
  invertAmount: true,
};

const YEN = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

interface Props {
  db: IDBDatabase;
  existing: StoredTransaction[];
  learned: LearnedCategories;
  onImported: () => void;
}

export function ImportScreen({ db, existing, learned, onImported }: Props) {
  const [fileName, setFileName] = useState("");
  const [rawCsv, setRawCsv] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<NamedColumnMapping>(DEFAULT_MAPPING);
  const [savedMappings, setSavedMappings] = useState<NamedColumnMapping[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getAllColumnMappings(db).then(setSavedMappings);
  }, [db]);

  async function handleFile(file: File) {
    setMessage("");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = decodeBytes(bytes);
    setFileName(file.name);
    setRawCsv(text);
    try {
      setRows(parseCsv(text));
    } catch (error) {
      setRows([]);
      setMessage(`CSVを読めませんでした: ${String(error)}`);
    }
    setSkipped(new Set());
  }

  const result = rows.length > 0 ? applyMapping(rows, mapping) : { transactions: [], errors: [] };
  const classified = classifyForImport(existing, result.transactions);

  // 判定そのものは src/import/selection.ts（壁の中）にある。ここでは
  // 「何番目の行が切り替えられたか」という画面の状態を渡すだけ。
  function isSelected(index: number, entry: ClassifiedTransaction): boolean {
    return isSelectedForImport(entry.status, skipped.has(index));
  }

  function toggle(index: number) {
    const next = new Set(skipped);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSkipped(next);
  }

  async function save() {
    // 二重クリックを塞ぐ。2回目は onImported() 前の古い existing で分類するため
    // 重複候補にならず、別のIDで同じ取引がもう一度書き込まれてしまう。
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await saveSelected();
    } catch (error) {
      setMessage(`取り込めませんでした: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveSelected() {
    const chosen = classified.filter((entry, index) => isSelected(index, entry));
    const stored: StoredTransaction[] = chosen.map((entry) => ({
      ...entry.transaction,
      id: crypto.randomUUID(),
      category: categoryFor(entry.transaction, DEFAULT_CATEGORY_RULES, learned),
      // CSVにメモに当たる列は無い。取り込んだ行は常に空。
      memo: "",
    }));

    await saveImport(
      db,
      stored,
      {
        id: crypto.randomUUID(),
        importedAt: new Date().toISOString(),
        fileName,
        rawCsv,
        mappingUsed: mapping,
        transactionCount: stored.length,
      },
      mapping,
    );

    setMessage(`${stored.length}件を取り込みました。`);
    setRows([]);
    setRawCsv("");
    setFileName("");
    onImported();
  }

  const selectedCount = classified.filter((entry, index) => isSelected(index, entry)).length;
  const duplicateCount = classified.filter((e) => e.status === "duplicate-candidate").length;

  return (
    <section>
      <p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              void handleFile(file);
            }
          }}
        />
      </p>

      {message !== "" && <p style={styles.message}>{message}</p>}

      {savedMappings.length > 0 && (
        <p>
          保存済みの設定：
          {savedMappings.map((m) => (
            <button key={m.name} type="button" style={styles.chip} onClick={() => setMapping(m)}>
              {m.name}
            </button>
          ))}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <MappingForm rows={rows} mapping={mapping} onChange={setMapping} />

          <h2 style={styles.h2}>
            取り込み内容（{selectedCount} / {classified.length} 件を選択中
            {duplicateCount > 0 && `・重複候補 ${duplicateCount} 件`}）
          </h2>

          {result.errors.length > 0 && <ErrorList errors={result.errors} />}

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>取込</th>
                <th style={styles.th}>状態</th>
                <th style={styles.th}>日付</th>
                <th style={styles.th}>摘要</th>
                <th style={{ ...styles.th, textAlign: "right" }}>金額</th>
              </tr>
            </thead>
            <tbody>
              {classified.map((entry, index) => (
                <tr key={index} style={entry.status === "duplicate-candidate" ? styles.dup : undefined}>
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={isSelected(index, entry)}
                      onChange={() => toggle(index)}
                    />
                  </td>
                  <td style={styles.td}>
                    {entry.status === "duplicate-candidate" ? "重複候補" : "新規"}
                  </td>
                  <td style={styles.td}>{entry.transaction.date}</td>
                  <td style={styles.td}>{entry.transaction.description}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    {YEN.format(entry.transaction.amountYen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>
            <button
              type="button"
              style={styles.primary}
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "取り込み中…" : `選択した ${selectedCount} 件を取り込む`}
            </button>
          </p>
        </>
      )}
    </section>
  );
}

function ErrorList({ errors }: { errors: RowError[] }) {
  return (
    <div style={styles.errors}>
      <strong>取り込めなかった行が {errors.length} 件あります</strong>
      <ul>
        {errors.slice(0, 10).map((e) => (
          <li key={e.rowNumber}>
            {e.rowNumber}行目：
            {e.kind === "column-out-of-range" ? "列の指定が範囲外です" : e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MappingForm({
  rows,
  mapping,
  onChange,
}: {
  rows: string[][];
  mapping: NamedColumnMapping;
  onChange: (mapping: NamedColumnMapping) => void;
}) {
  const header = rows[0] ?? [];
  const columnOptions = header.map((label, index) => ({ index, label: `${index}: ${label}` }));

  return (
    <fieldset style={styles.fieldset}>
      <legend>列の対応</legend>

      <label style={styles.label}>
        設定名
        <input
          value={mapping.name}
          onChange={(e) => onChange({ ...mapping, name: e.target.value })}
        />
      </label>

      <label style={styles.label}>
        ヘッダ行数
        <input
          type="number"
          min={0}
          value={mapping.skipRows}
          onChange={(e) => onChange({ ...mapping, skipRows: Number(e.target.value) })}
        />
      </label>

      <ColumnSelect
        label="日付の列"
        value={mapping.dateColumn}
        options={columnOptions}
        onChange={(dateColumn) => onChange({ ...mapping, dateColumn })}
      />
      <ColumnSelect
        label="金額の列"
        value={mapping.amountColumn}
        options={columnOptions}
        onChange={(amountColumn) => onChange({ ...mapping, amountColumn })}
      />
      <ColumnSelect
        label="摘要の列"
        value={mapping.descriptionColumn}
        options={columnOptions}
        onChange={(descriptionColumn) => onChange({ ...mapping, descriptionColumn })}
      />

      <label style={styles.label}>
        取り込み元
        <select
          value={mapping.source}
          onChange={(e) => onChange({ ...mapping, source: e.target.value as TransactionSource })}
        >
          <option value="card">カード</option>
          <option value="bank">銀行</option>
          <option value="cash">現金</option>
        </select>
      </label>

      <label style={styles.label}>
        <input
          type="checkbox"
          checked={mapping.invertAmount}
          onChange={(e) => onChange({ ...mapping, invertAmount: e.target.checked })}
        />
        支出が正の数で書かれている（符号を反転する）
      </label>
    </fieldset>
  );
}

function ColumnSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: { index: number; label: string }[];
  onChange: (value: number) => void;
}) {
  return (
    <label style={styles.label}>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((option) => (
          <option key={option.index} value={option.index}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const styles = {
  h2: { fontSize: 16, marginTop: 24 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", borderBottom: "2px solid var(--line)", padding: "6px 8px" },
  td: { borderBottom: "1px solid var(--line)", padding: "6px 8px" },
  dup: { background: "var(--dup)" },
  fieldset: {
    border: "1px solid var(--line)",
    borderRadius: 6,
    padding: 12,
    display: "grid",
    gap: 8,
  },
  label: { display: "flex", gap: 8, alignItems: "center", fontSize: 14 },
  message: { background: "var(--success)", padding: "8px 12px", borderRadius: 6 },
  errors: { background: "var(--error)", padding: "8px 12px", borderRadius: 6, fontSize: 14 },
  chip: { marginLeft: 8, padding: "2px 10px", borderRadius: 999 },
  primary: {
    padding: "8px 18px",
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "var(--accent)",
    borderRadius: 6,
  },
} as const;
