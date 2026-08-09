import type { PersistenceState } from "../storage/persistence.js";

const WARNING: Record<Exclude<PersistenceState, "persisted">, string> = {
  denied:
    "このブラウザは永続化を許可していません。ストレージが逼迫すると、ここのデータは予告なく消えることがあります。",
  unsupported:
    "このブラウザでは永続化を要求できません（HTTPS でないページでは無効です）。データは予告なく消えることがあります。",
};

/**
 * 永続化されていないことを、どの画面にいても伝える帯。
 *
 * **バックアップ画面の中に置かない。** データが揮発し得ることは、書き出しを
 * 見に行った人だけでなく全員に伝わる必要がある。実際に一度、この状態のまま
 * 全ストアが消えている（2026-08-09）。
 */
export function PersistenceBanner({ state }: { state: PersistenceState | null }) {
  // 要求が返る前（null）と、許可された場合は何も出さない。
  if (state === null || state === "persisted") {
    return null;
  }
  return (
    <p style={styles.banner} role="status">
      {WARNING[state]}
    </p>
  );
}

const styles = {
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--error)",
    border: "1px solid var(--danger)",
    borderRadius: 8,
    color: "var(--danger)",
    fontSize: 13,
    padding: "9px 13px",
    margin: "0 0 16px",
  },
} as const;
