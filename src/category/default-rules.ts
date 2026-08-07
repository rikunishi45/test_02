import type { CategoryRule } from "./classify.js";

export const CATEGORIES = [
  "食費",
  "日用品",
  "光熱費",
  "通信費",
  "サブスク",
  "交通費",
  "医療",
  "娯楽",
] as const;

/**
 * 既定のカテゴリルール。**先頭から順に部分一致で判定し、最初に当たったものを採る。**
 *
 * パターンは `normalizeDescription` を通した後の形で書く。実名ではない：
 * カード会社が小書き文字を大書きで転記するため、`マックスバリュ` ではなく
 * `マツクスバリユ` が実際に現れる形になる（`normalize.ts` 参照）。
 *
 * **広いパターンを先に置かない。** 実データの摘要は
 * `楽天SP 楽天ペイセブン-イレブン 123456` のように決済経路の名前を前置きする。
 * ここで `楽天` のルールを1本作ると、コンビニも飲食も全部そちらへ吸われる。
 * 決済経路（`楽天SP` `VISA国内利用` `VS `）と店名を混同しないこと。
 *
 * 網羅は狙わない。当たらなかったものは未分類として画面に出て、人間が直せば
 * 学習に入る。むしろ**誤った分類を広く撒く方が害が大きい**ので、確信のある
 * 店名だけを置く。
 */
export const DEFAULT_CATEGORY_RULES: readonly CategoryRule[] = [
  // --- サブスク ---
  // 食費のコンビニ名より先に置く。決済経路がコンビニ名を含むことは無いが、
  // サービス名が店名を含む可能性はこちら側にしかない。
  { pattern: "openai", category: "サブスク" },
  { pattern: "chatgpt", category: "サブスク" },
  { pattern: "claude", category: "サブスク" },
  { pattern: "anthropic", category: "サブスク" },
  { pattern: "netflix", category: "サブスク" },
  { pattern: "ネットフリックス", category: "サブスク" },
  { pattern: "spotify", category: "サブスク" },
  { pattern: "アマゾンプライム", category: "サブスク" },
  { pattern: "amazon prime", category: "サブスク" },
  { pattern: "adobe", category: "サブスク" },
  { pattern: "youtube", category: "サブスク" },
  { pattern: "apple.com/bill", category: "サブスク" },

  // --- 娯楽 ---
  // `steam` 単体だと `STEAM CLEANING`（清掃業）に当たる。
  { pattern: "steamgames", category: "娯楽" },
  { pattern: "steampowered", category: "娯楽" },
  { pattern: "twitch", category: "娯楽" },
  { pattern: "nintendo", category: "娯楽" },
  { pattern: "playstation", category: "娯楽" },
  { pattern: "イオンシネマ", category: "娯楽" },

  // --- 通信費 ---
  { pattern: "biglobe", category: "通信費" },
  { pattern: "楽天モバイル", category: "通信費" },
  { pattern: "ドコモ", category: "通信費" },
  { pattern: "ソフトバンク", category: "通信費" },
  // `ntt` `ocn` は3文字で、英字列の途中に紛れる（`PRINTTECH` `LOCNESS`）。
  // `jr` を狭めた基準をここにも当てる。
  { pattern: "ntt東日本", category: "通信費" },
  { pattern: "ntt西日本", category: "通信費" },
  { pattern: "nttドコモ", category: "通信費" },
  { pattern: "ntt docomo", category: "通信費" },

  // --- 光熱費 ---
  // 「ガス」「水道」を単体で置かない。`ガスト`（飲食チェーン）が光熱費になり、
  // `水道橋店` を含む店名も同じ穴を踏む。会社名まで含めて初めて安全になる。
  { pattern: "電力", category: "光熱費" },
  { pattern: "広島ガス", category: "光熱費" },
  { pattern: "東京ガス", category: "光熱費" },
  { pattern: "大阪ガス", category: "光熱費" },
  { pattern: "東邦ガス", category: "光熱費" },
  { pattern: "西部ガス", category: "光熱費" },
  { pattern: "北海道ガス", category: "光熱費" },
  { pattern: "都市ガス", category: "光熱費" },
  { pattern: "水道局", category: "光熱費" },

  // --- 食費 ---
  { pattern: "セブン-イレブン", category: "食費" },
  { pattern: "セブンイレブン", category: "食費" },
  { pattern: "ローソン", category: "食費" },
  { pattern: "ファミリーマート", category: "食費" },
  { pattern: "ミニストップ", category: "食費" },
  { pattern: "マクドナルド", category: "食費" },
  { pattern: "すき家", category: "食費" },
  { pattern: "吉野家", category: "食費" },
  { pattern: "スターバックス", category: "食費" },
  { pattern: "ゆめタウン", category: "食費" },
  { pattern: "ガスト", category: "食費" },
  { pattern: "サイゼリヤ", category: "食費" },
  { pattern: "マツクスバリユ", category: "食費" },
  { pattern: "マックスバリュ", category: "食費" },
  // `イオン` 単体にしない。`ライオン` を含む店名（ライオン事務器、ライオンズ
  // マンション）が食費になり、`イオンカード` `イオン銀行` という決済経路まで
  // さらう。`ガス` `水道` `jr` と同じ穴。
  { pattern: "イオンモール", category: "食費" },
  { pattern: "イオンスタイル", category: "食費" },
  { pattern: "イオンリテール", category: "食費" },
  { pattern: "まいばすけっと", category: "食費" },
  { pattern: "業務スーパー", category: "食費" },

  // --- 日用品 ---
  { pattern: "ダイソー", category: "日用品" },
  { pattern: "ニトリ", category: "日用品" },
  { pattern: "コーナン", category: "日用品" },
  { pattern: "マツモトキヨシ", category: "日用品" },
  { pattern: "ウエルシア", category: "日用品" },

  // --- 交通費 ---
  // `jr` 単体は2文字なので無関係な英数字列に当たる。事業者名まで含める。
  { pattern: "jr東日本", category: "交通費" },
  { pattern: "jr西日本", category: "交通費" },
  { pattern: "jr東海", category: "交通費" },
  { pattern: "jr九州", category: "交通費" },
  { pattern: "モバイルsuica", category: "交通費" },
  { pattern: "icoca", category: "交通費" },
  { pattern: "タクシー", category: "交通費" },
  { pattern: "エネオス", category: "交通費" },
  { pattern: "eneos", category: "交通費" },

  // --- 医療 ---
  { pattern: "薬局", category: "医療" },
  { pattern: "クリニック", category: "医療" },
  { pattern: "医院", category: "医療" },
  { pattern: "病院", category: "医療" },
];
