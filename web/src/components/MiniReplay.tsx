"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EngineEvent } from "@k2x/relayer";
import { PriceChart } from "@/components/PriceChart";
import { Stamp } from "@/components/Stamp";
import { CHAIN_ID, txUrl } from "@/lib/config";
import { kstClock, krw, pct } from "@/lib/format";
import datasets from "@/generated/datasets.json";
import replays from "@/generated/replays.json";

const KEY = "2026-07-28_000660";
const SPAN = 12; // seconds of the open shown
const HOLD = 6; // seconds the finished frame stays before looping

type Raw = Extract<EngineEvent, { type: "raw" }>;
type Accepted = Extract<EngineEvent, { type: "accepted" }>;

/** The 28 July open, looping: the recorded on-chain verdicts against an oracle that takes every trade. */
export function MiniReplay() {
  const ds = (datasets as Record<string, any>)[KEY];
  const events = ((replays as Record<string, { events: EngineEvent[] } | undefined>)[KEY]?.events ?? []) as EngineEvent[];
  const prev: number = ds.seedClose.px;
  const t0: number = ds.reports[0].windowStart;
  const [cursor, setCursor] = useState(t0 + 1);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const r = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(r);
    if (r) return setCursor(t0 + SPAN);
    const t = setInterval(() => setCursor((c) => (c >= t0 + SPAN + HOLD ? t0 + 1 : c + 1)), 700);
    return () => clearInterval(t);
  }, [t0]);

  if (!events.length) return null;
  const raw = events.filter((e): e is Raw => e.type === "raw");
  const accepted = events.filter((e): e is Accepted => e.type === "accepted");
  const bad = events.find((e) => e.type === "rejected" && "reason" in e && e.reason === "JUMP_UNCONFIRMED") as
    | Extract<EngineEvent, { reason: string }>
    | undefined;
  const rejectedAt = bad ? (raw.find((r) => r.txHash === bad.txHash)?.windowEnd ?? bad.at + 1) : Infinity;
  const first = accepted[0];
  const view = Math.min(cursor, t0 + SPAN);
  const upTo = (p: [number, number]) => p[0] <= view;
  const rawSeries = raw.filter((r) => r.windowEnd <= t0 + SPAN).map((r) => [r.windowEnd, r.lastPx] as [number, number]);
  const trusted = accepted.filter((a) => a.at <= t0 + SPAN).map((a) => [a.at, a.px] as [number, number]);
  const badMove = bad ? bad.px / prev - 1 : 0;
  const firstMove = first ? first.px / prev - 1 : 0;

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="display text-base font-semibold">28 July, 08:00 KST · SK hynix</h2>
        <span className="num text-xs text-ink-3">{kstClock(view)} KST</span>
      </div>
      <div className="mt-3">
        <PriceChart
          xDomain={[t0, t0 + SPAN]}
          reference={{ px: prev, label: `prev close ${krw(prev)}` }}
          cursor={reduced ? undefined : view}
          series={[
            // the full path, invisible, keeps the price axis still while the replay plays
            { label: "", points: [...rawSeries, ...trusted], color: "transparent", width: 0 },
            { label: "takes every trade", points: rawSeries.filter(upTo), color: "var(--ink-3)", width: 1.25, step: true },
            { label: "K-Mark", points: trusted.filter(upTo), color: "var(--accepted)", width: 3, step: true },
          ]}
          markers={
            bad && bad.at <= view
              ? [{ t: bad.at, px: bad.px, color: rejectedAt <= view ? "var(--rejected)" : "var(--held)", label: rejectedAt <= view ? "1 share · rejected" : "1 share · held" }]
              : []
          }
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-rule pt-4 text-sm">
        <div>
          <dt className="eyebrow">An oracle that takes every trade</dt>
          <dd className="num mt-1.5 text-2xl">{pct(2 * badMove, 1)}</dd>
          <dd className="mt-1 text-xs text-ink-2">
            2x token marked at the 1-share print ({krw(bad?.px ?? 0)}). On a perp venue that day, about $57M of longs were liquidated.
          </dd>
        </div>
        <div>
          <dt className="eyebrow">K-Mark on Monad</dt>
          <dd className="num mt-1.5 text-2xl">{pct(2 * firstMove, 1)}</dd>
          <dd className="mt-1 text-xs text-ink-2">
            2x token at the first trusted price, {krw(first?.px ?? 0)} at {kstClock(first?.at ?? t0)}, after ₩300M and 20 trades
            confirmed the real gap.
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule pt-3 text-xs text-ink-2">
        <span className="flex items-center gap-2">
          The 1-share print <Stamp verdict="rejected" small />
          {bad && txUrl(bad.txHash) && (
            <a className="underline underline-offset-2" href={txUrl(bad.txHash)} target="_blank" rel="noreferrer">
              transaction
            </a>
          )}
        </span>
        <Link href="/replay" className="ml-auto font-medium text-ink underline underline-offset-4">
          Step through it
        </Link>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
        Replayed on {CHAIN_ID === 10143 ? "Monad testnet" : "a local chain"}. The 1-share print, the previous close and the KRX
        open are observed; the trades between them are reconstructed.
      </p>
    </div>
  );
}
