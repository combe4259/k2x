"use client";

import { CHAIN_ID } from "@/lib/config";
import { kstClock, kstDate, SESSION_TEXT } from "@/lib/format";
import { useNow, usePoll } from "@/lib/hooks";
import { publicClient } from "@/lib/client";
import { MODE_LABEL, useMode, type Mode } from "@/lib/mode";
import { nextOpen, sessionOf } from "@/lib/session";

function until(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Where you are: the chain, the Korean clock, and which copy of the contracts the page shows. */
export function StatusStrip() {
  const now = useNow();
  const { mode, setMode } = useMode();
  const { data: block } = usePoll(() => publicClient.getBlockNumber(), 4000);
  const session = sessionOf(now);
  const open = session !== "CLOSED";
  const opensAt = nextOpen(now);

  return (
    <div className="border-b border-rule bg-tint/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 text-xs text-ink-2">
        <span className="num flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${block ? "bg-accepted" : "bg-ink-3"}`} aria-hidden />
          {CHAIN_ID === 10143 ? "Monad testnet" : "local chain"} · block {block ? block.toLocaleString() : "…"}
        </span>
        <span className="num">{kstClock(now)} KST</span>
        <span>
          {open ? (
            <>
              Korea open · {SESSION_TEXT[session]}
            </>
          ) : (
            <>
              Korea closed · opens {kstDate(opensAt)} 08:00 KST <span className="num">(in {until(opensAt - now)})</span>
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline">Showing</span>
          <div className="inline-flex rounded-md border border-rule bg-sheet p-0.5" role="tablist" aria-label="Which market to show">
            {(["replay", "live"] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                title={m === "replay" ? "The real 2 Oct KRX session, replayed minute by minute. Works at any hour." : "Real trades, 08:00–20:00 KST on weekdays."}
                className={`rounded px-2.5 py-1 ${mode === m ? "bg-ink text-sheet" : "text-ink-2 hover:text-ink"}`}
              >
                {MODE_LABEL[m]}
                <span className="hidden md:inline">{m === "replay" ? " · always on" : open ? " · open now" : " · closed"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
