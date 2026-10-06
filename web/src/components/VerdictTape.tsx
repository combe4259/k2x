import type { EngineEvent } from "@k2x/relayer";
import { txUrl } from "@/lib/config";
import { KIND, REASON_TEXT, VENUE, dirClass, kstClock, krw, pct } from "@/lib/format";
import { Stamp } from "./Stamp";

export type TapeRow = {
  key: string;
  at: number;
  venue: number;
  kind: number;
  px: number;
  low: number;
  trades: number;
  notional: number;
  verdict: "accepted" | "held" | "rejected";
  reason: string;
  txHash: string;
  note?: string;
};

/** Pair each RawPrint with the verdict emitted in the same transaction. */
export function toTape(events: EngineEvent[]): TapeRow[] {
  const rows: TapeRow[] = [];
  const byTx = new Map<string, EngineEvent[]>();
  for (const e of events) byTx.set(e.txHash, [...(byTx.get(e.txHash) ?? []), e]);
  for (const [tx, list] of byTx) {
    const raw = list.find((e) => e.type === "raw");
    if (!raw || raw.type !== "raw") continue;
    for (const e of list) {
      if (e.type === "rejected" && e.reason === "JUMP_UNCONFIRMED") {
        rows.push({
          key: `${tx}-cand`,
          at: e.at,
          venue: e.venue,
          kind: 0,
          px: e.px,
          low: e.px,
          trades: 0,
          notional: 0,
          verdict: "rejected",
          reason: e.reason,
          txHash: tx,
          note: "earlier print, not confirmed by the trades that followed",
        });
      }
    }
    const decision = list.find(
      (e) => e.type === "accepted" || e.type === "held" || (e.type === "rejected" && e.reason !== "JUMP_UNCONFIRMED"),
    );
    rows.push({
      key: tx,
      at: raw.windowEnd,
      venue: raw.venue,
      kind: raw.kind,
      px: raw.kind === 0 ? raw.vwapPx : raw.lastPx,
      low: raw.lowPx,
      trades: raw.trades,
      notional: raw.notional,
      verdict: decision?.type === "accepted" ? "accepted" : decision?.type === "held" ? "held" : decision ? "rejected" : "accepted",
      reason: decision && "reason" in decision ? decision.reason : "NONE",
      txHash: tx,
    });
  }
  return rows.sort((a, b) => b.at - a.at || (a.key.endsWith("-cand") ? 1 : -1));
}

export function VerdictTape({ rows, reference, limit = 12 }: { rows: TapeRow[]; reference?: number; limit?: number }) {
  if (rows.length === 0) {
    return <p className="py-6 text-sm text-ink-2">No prints yet. Verdicts appear here as the relayer posts trades.</p>;
  }
  return (
    <ol className="divide-y divide-rule">
      {rows.slice(0, limit).map((r) => {
        const move = reference ? r.px / reference - 1 : 0;
        const url = txUrl(r.txHash);
        return (
          <li key={r.key} className="tape-in grid grid-cols-[4.5rem_2.5rem_1fr_auto] items-center gap-x-3 py-2.5">
            <span className="num text-xs text-ink-3">{kstClock(r.at)}</span>
            <span className="num text-[11px] text-ink-2">{VENUE[r.venue]}</span>
            <span className="min-w-0">
              <span className={`num text-sm ${reference ? dirClass(move) : ""}`}>{krw(r.px)}</span>
              {reference ? <span className={`num ml-2 text-xs ${dirClass(move)}`}>{pct(move, 1)}</span> : null}
              <span className="block truncate text-xs text-ink-3">
                {r.note ?? (r.kind ? KIND[r.kind] : `${r.trades.toLocaleString()} trades · ₩${(r.notional / 1e8).toFixed(1)}억`)}
                {r.reason !== "NONE" ? ` · ${REASON_TEXT[r.reason] ?? r.reason}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Stamp verdict={r.verdict} small />
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-ink-3 underline-offset-2 hover:underline">
                  tx
                </a>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
