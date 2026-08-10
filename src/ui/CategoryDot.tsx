/** カテゴリ名の前に置く色の点。色は設定画面のマスタで変えられる */
export function CategoryDot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ ...style, background: color }} />;
}

const style = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: 4,
  marginRight: 6,
  verticalAlign: "middle",
} as const;
