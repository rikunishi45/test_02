import type { ReactNode } from "react";

export interface NavItem {
  id: string;
  label: string;
  /** 項目の右に出す件数。undefined なら出さない */
  count?: number;
  /** この項目の前に区切り線を入れる */
  separatorBefore?: boolean;
}

/**
 * サイドバーと本文の骨格。
 *
 * 画面の切り替えは呼び出し側（`App`）が持つ。ここは受け取った項目を並べて、
 * 選ばれているものに印を付けるだけ。
 *
 * レイアウトのクラスは `index.html` にある。メディアクエリと `:hover` は
 * インラインスタイルでは書けないため、骨格だけクラスで書いている。
 */
export function AppShell({
  items,
  active,
  onSelect,
  title,
  banner,
  children,
}: {
  items: readonly NavItem[];
  active: string;
  onSelect: (id: string) => void;
  title: string;
  /** 画面によらず常に出す警告。無ければ null */
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <nav className="rail" aria-label="メインメニュー">
        <div className="rail-brand">
          <span className="rail-mark" aria-hidden="true">
            ¥
          </span>
          家計簿
        </div>
        {items.map((item) => (
          <ItemButton
            key={item.id}
            item={item}
            active={item.id === active}
            onSelect={onSelect}
          />
        ))}
      </nav>

      <div className="pane">
        <header className="topbar">
          <h1>{title}</h1>
        </header>
        <main className="content">
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}

function ItemButton({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const button = (
    <button
      type="button"
      className="rail-item"
      // 選択状態は色だけで示さない。読み上げと、色が区別できない環境のため。
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(item.id)}
    >
      {item.label}
      {item.count !== undefined && <span className="rail-count">{item.count}</span>}
    </button>
  );

  if (item.separatorBefore !== true) {
    return button;
  }
  return (
    <>
      <hr className="rail-sep" />
      {button}
    </>
  );
}
