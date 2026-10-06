"use client";

import { useEffect, useMemo, useState } from "react";
import type { EngineEvent } from "@k2x/relayer";
import { PriceChart } from "@/components/PriceChart";
import { Stamp } from "@/components/Stamp";
import { VerdictTape, toTape } from "@/components/VerdictTape";
import { CHAIN_ID, txUrl } from "@/lib/config";
import { dirClass, kstClock, krw, pct } from "@/lib/format";
import { useMode } from "@/lib/mode";
import datasets from "@/generated/datasets.json";
import replays from "@/generated/replays.json";

const SCENARIOS = [
  { key: "2026-07-28_000660", label: "28 Jul · 1 share at 1,272,000", short: "28 Jul" },
  { key: "2026-08-06_000660", label: "6 Aug · 11 shares at 1,168,000", short: "6 Aug" },
] as const;

type ScenarioKey = (typeof SCENARIOS)[number]["key"];
type Onchain = { events: EngineEvent[]; fromBlock: number; toBlock: number };

// only scenarios replayed on this chain have K-Mark verdicts to show
const ONCHAIN = replays as Record<string, Onchain | undefined>;
const recorded = (key: string) => (ONCHAIN[key]?.events?.length ?? 0) > 0;
const FIRST: ScenarioKey = recorded("2026-07-28_000660")
  ? "2026-07-28_000660"
  : (SCENARIOS.find((s) => recorded(s.key))?.key ?? "2026-07-28_000660");

export default function ReplayPage() {
  const [key, setKey] = useState<ScenarioKey>(FIRST);
  const [zoom, setZoom] = useState<"open" | "hour">("open");
  const ds = (datasets as Record<string, any>)[key];
  const onchain = ONCHAIN[key];
  const events = onchain?.events ?? [];
  const prevClose: number = ds.seedClose.px;
  const t0: number = ds.reports[0].windowStart;
  const tEnd: number = ds.reports[ds.reports.length - 1].windowEnd;
  const span: [number, number] = zoom === "open" ? [t0, t0 + 90] : [t0, tEnd];

  const [cursor, setCursor] = useState(span[0]);
  const [playing, setPlaying] = useState(false);
  const { completeDemo } = useMode();
  useEffect(() => {
    setCursor(span[0]);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, zoom]);
  useEffect(() => {
    if (!playing) return;
    const step = zoom === "open" ? 1 : 30;
    const t = setInterval(() => {
      setCursor((c) => {
        if (c + step >= span[1]) {
          setPlaying(false);
          completeDemo("watch");
          return span[1];
        }
        return c + step;
      });
    }, zoom === "open" ? 220 : 120);
    return () => clearInterval(t);
  }, [playing, zoom, span, completeDemo]);

  const raw = events.filter((e): e is Extract<EngineEvent, { type: "raw" }> => e.type === "raw");
  const accepted = events.filter((e): e is Extract<EngineEvent, { type: "accepted" }> => e.type === "accepted");
  type Verdict = Extract<EngineEvent, { reason: string }>;
  const badPrint = events.find(
    (e): e is Verdict => e.type === "rejected" && "reason" in e && e.reason === "JUMP_UNCONFIRMED",
  );
  // the bad print is held when it arrives and rejected by a later transaction: show the rejection at that one's window end
  const rejectedAt = badPrint ? (raw.find((r) => r.txHash === badPrint.txHash)?.windowEnd ?? badPrint.at + 1) : Infinity;

  const rawSeries = useMemo<[number, number][]>(
    () => (raw.length ? raw : (ds.reports as { windowEnd: number; lastPx: number }[])).map((r) => [r.windowEnd, r.lastPx]),
    [raw, ds],
  );
  const trustedSeries = accepted.map((a) => [a.at, a.px] as [number, number]);
  const inView = (p: [number, number]) => p[0] >= span[0] && p[0] <= span[1];
  const upTo = (p: [number, number]) => p[0] <= cursor;

  const naiveNow = [...rawSeries].filter(upTo).at(-1)?.[1];
  const naiveLow = Math.min(...rawSeries.filter(upTo).map((p) => p[1]), Infinity);
  const trustedNow = trustedSeries.filter(upTo).at(-1)?.[1];
  const trustedLow = Math.min(...trustedSeries.filter(upTo).map((p) => p[1]), Infinity);
  const firstTrusted = accepted[0];
  const tape = toTape(events).filter((r) => r.at <= cursor);

  return (
    <div className="pt-10">
      <p className="eyebrow">The 7/28 print · recorded on {CHAIN_ID === 10143 ? "Monad testnet" : "a local chain"}</p>
      <h1 className="display mt-3 text-4xl font-bold leading-tight sm:text-5xl">One share at −30%. Rejected.</h1>
      <p className="mt-4 max-w-2xl text-ink-2">
        The 28 July SK hynix pre-market, fed to two price layers: an oracle that takes every trade, and K-Mark. Every K-Mark
        verdict below is a transaction on Monad. Press Play.
      </p>
      <p className="mt-2 max-w-2xl text-xs text-ink-3">
        Observed: the {key === "2026-07-28_000660" ? "1-share" : "11-share"} print, the previous close and the KRX open.
        Reconstructed (and labelled in the data): the trades between them.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {SCENARIOS.map((s) =>
          recorded(s.key) ? (
            <button
              key={s.key}
              onClick={() => setKey(s.key)}
              className={`rounded-md border px-3 py-1.5 text-sm ${key === s.key ? "border-ink bg-ink text-sheet" : "border-rule text-ink-2"}`}
            >
              {s.label}
            </button>
          ) : (
            <button key={s.key} disabled className="rounded-md border border-dashed border-rule px-3 py-1.5 text-sm text-ink-3">
              {s.short} · not recorded on this network
            </button>
          ),
        )}
        <span className="mx-2 h-5 w-px bg-rule" />
        {(["open", "hour"] as const).map((z) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            className={`rounded-md px-3 py-1.5 text-sm ${zoom === z ? "bg-tint text-ink" : "text-ink-2"}`}
          >
            {z === "open" ? "First 90 seconds" : "08:00–09:00"}
          </button>
        ))}
      </div>

      <div className="card mt-4 p-4">
        <PriceChart
          xDomain={span}
          reference={{ px: prevClose, label: `prev close ${krw(prevClose)}` }}
          cursor={cursor}
          series={[
            { label: "pass-through", points: rawSeries.filter(inView).filter(upTo), color: "var(--ink-3)", width: 1.25, step: true },
            { label: "K-Mark", points: trustedSeries.filter(inView).filter(upTo), color: "var(--accepted)", width: 2.5, step: true },
          ]}
          markers={
            badPrint && badPrint.at <= cursor && inView([badPrint.at, badPrint.px])
              ? [
                  rejectedAt <= cursor
                    ? { t: badPrint.at, px: badPrint.px, color: "var(--rejected)", label: "rejected by K-Mark" }
                    : { t: badPrint.at, px: badPrint.px, color: "var(--held)", label: "held by K-Mark" },
                ]
              : []
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              if (cursor >= span[1]) setCursor(span[0]);
              setPlaying((p) => !p);
            }}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-sheet"
          >
            {playing ? "Pause" : cursor >= span[1] ? "Replay" : "Play"}
          </button>
          <input
            type="range"
            min={span[0]}
            max={span[1]}
            value={cursor}
            onChange={(e) => (setPlaying(false), setCursor(Number(e.target.value)))}
            className="min-w-[200px] flex-1 accent-[var(--ink)]"
            aria-label="replay time"
          />
          <span className="num text-sm">{kstClock(cursor)} KST</span>
          <span className="flex items-center gap-3 text-xs text-ink-3">
            <span className="inline-block h-0.5 w-5 bg-[var(--ink-3)]" /> pass-through
            <span className="inline-block h-1 w-5 bg-accepted" /> K-Mark trusted
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="eyebrow">An oracle that takes every trade</div>
          <Row label="Price now" value={naiveNow ? krw(naiveNow) : "—"} move={naiveNow ? naiveNow / prevClose - 1 : 0} />
          <Row label="Lowest price used" value={isFinite(naiveLow) ? krw(naiveLow) : "—"} move={isFinite(naiveLow) ? naiveLow / prevClose - 1 : 0} />
          <Row
            label="2x token marked at that price"
            value={isFinite(naiveLow) ? pct(2 * (naiveLow / prevClose - 1), 1) : "—"}
            move={isFinite(naiveLow) ? naiveLow / prevClose - 1 : 0}
          />
          <p className="mt-4 border-t border-rule pt-3 text-sm text-ink-2">
            {key === "2026-07-28_000660"
              ? "On trade.xyz the mark fell 18.7% (it blends oracle, book and an EMA), and about $57M of longs were liquidated before the price recovered."
              : "By 6 Aug trade.xyz excluded 08:00–08:10 from its oracle, so this print passed it by — along with the first ten minutes of real trading."}
          </p>
        </div>
        <div className="card p-5">
          <div className="eyebrow">K-Mark</div>
          <Row label="Trusted price now" value={trustedNow ? krw(trustedNow) : "waiting"} move={trustedNow ? trustedNow / prevClose - 1 : 0} />
          <Row label="Lowest trusted price" value={isFinite(trustedLow) ? krw(trustedLow) : "—"} move={isFinite(trustedLow) ? trustedLow / prevClose - 1 : 0} />
          <Row
            label="2x token marked at that price"
            value={isFinite(trustedLow) ? pct(2 * (trustedLow / prevClose - 1), 1) : "—"}
            move={isFinite(trustedLow) ? trustedLow / prevClose - 1 : 0}
          />
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-2">The {key === "2026-07-28_000660" ? "1-share" : "11-share"} print</span>
            {badPrint && rejectedAt <= cursor ? (
              <span className="flex items-center gap-2">
                <Stamp verdict="rejected" small />
                {txUrl(badPrint.txHash) && (
                  <a className="text-xs underline" href={txUrl(badPrint.txHash)} target="_blank" rel="noreferrer">
                    tx
                  </a>
                )}
              </span>
            ) : badPrint && badPrint.at <= cursor ? (
              <Stamp verdict="held" small />
            ) : (
              <span className="text-xs text-ink-3">not printed yet</span>
            )}
          </div>
          <p className="mt-4 border-t border-rule pt-3 text-sm text-ink-2">
            {firstTrusted
              ? `The real gap was trusted ${firstTrusted.at - t0} seconds after the open, once ₩300M and 20 trades went through near the new level. A patch that ignores the first ten minutes would have ignored it too.`
              : onchain
                ? "Waiting for the on-chain replay."
                : "This scenario has not been replayed on this network."}
          </p>
        </div>
      </div>

      <div className="card mt-4 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="display font-semibold">Verdicts up to {kstClock(cursor)}</h2>
          {onchain && <span className="num text-xs text-ink-3">blocks {onchain.fromBlock}–{onchain.toBlock}</span>}
        </div>
        <VerdictTape rows={tape} reference={prevClose} limit={14} />
      </div>

      <details className="mt-4 text-sm text-ink-2">
        <summary className="cursor-pointer">Where this data comes from</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {Object.entries(ds.sources as Record<string, string>).map(([k, v]) => (
            <li key={k}>
              <span className="num text-xs text-ink-3">{k}</span> — {v}
            </li>
          ))}
        </ul>
        <p className="mt-2">{ds.notes}</p>
      </details>
    </div>
  );
}

function Row({ label, value, move }: { label: string; value: string; move: number }) {
  return (
    <div className="mt-3 flex items-baseline justify-between gap-3">
      <span className="text-sm text-ink-2">{label}</span>
      <span className={`num text-lg ${dirClass(move)}`}>
        {value}
        {move ? <span className="ml-2 text-xs">{pct(move, 1)}</span> : null}
      </span>
    </div>
  );
}
