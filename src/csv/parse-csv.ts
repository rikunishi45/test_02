/**
 * RFC4180に沿ったCSVパーサ。ただし引用符の位置には寛容で、
 * `a,"b"c,d` のように非引用部と引用部が混ざったフィールドは連結して読む
 * （`["a","bc","d"]`）。実CSVの揺れを取り込み時に弾かないため。
 * フィールド数は保存されるので、列がずれることはない。
 * 引用符が閉じられないまま入力が終わる場合だけは例外を投げる。
 *
 * 行ごとのフィールド数が揃っているかは検証しない。どの列が何かを知っているのは
 * 上位層（column-mapping）であって、ここは構文だけを扱う。
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // 引用符だけで構成された空フィールド（""）を、入力の終端で取りこぼさないための印。
  // field が空文字のままでもフィールドが存在したことを示す。
  let fieldPending = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
    fieldPending = false;
  };

  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      fieldPending = true;
      i += 1;
      continue;
    }

    if (char === ",") {
      // endField が row に push するので、末尾がカンマでも下の row.length > 0 で
      // 最終行が確定する。ここで fieldPending を立てる必要はない。
      endField();
      i += 1;
      continue;
    }

    if (char === "\r" && input[i + 1] === "\n") {
      endRow();
      i += 2;
      continue;
    }

    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new Error("parseCsv: 閉じられていない引用符がある");
  }

  // 改行で終わった入力はここで何も残らない（endRow直後に入力が尽きる）。
  // それ以外は最後の行が未確定なので確定させる。
  if (field !== "" || row.length > 0 || fieldPending) {
    endRow();
  }

  return rows;
}
