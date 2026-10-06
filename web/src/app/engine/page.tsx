"use client";

import { useState } from "react";
import type { EngineEvent } from "@k2x/relayer";
import { AssetSwitch } from "@/components/Switches";
import { VerdictTape, toTape } from "@/components/VerdictTape";
import { INSTANCES, addressUrl, type AssetKey } from "@/lib/config";
import { useSnapshot, useTape } from "@/lib/data";
import { MODE_LABEL, useMode } from "@/lib/mode";
import datasets from "@/generated/datasets.json";
import replays from "@/generated/replays.json";

const KEY_0728 = "2026-07-28_000660";
const TAPE_0728 = toTape(((replays as Record<string, { events: EngineEvent[] } | undefined>)[KEY_0728]?.events ?? []) as EngineEvent[]);
const PREV_0728: number = (datasets as Record<string, any>)[KEY_0728]?.seedClose.px ?? 0;

const RULES = [
  ["R0", "Sequence and clock", "Reports must be newer than the last one from that venue. On the live clock a report dated in the future, or more than a minute old, is refused — the move that made the Ostium exploit possible. So is a report whose prices fall outside its own low–high, or an auction with more than one price."],
  ["R1", "Session", "NXT trades count only in its pre-market (08:00–08:50), main market (from 09:00:30) and after-market (15:30–20:00); KRX only from its 09:00 opening auction to the 15:30 close. Weekends, holidays and late opens such as exam day come from an on-chain calendar."],
  ["R2", "Halts and VI", "During a trading halt or a volatility interruption the price freezes. Trading that resumes after either one starts a new warm-up."],
  ["R3", "±30% band", "Korean stocks cannot trade beyond ±30% of the previous close, so nothing outside that band is ever accepted — even from a compromised relayer."],
  ["R4", "Warm-up", "A session's first prints are held until ₩100M and 20 trades have gone through. One share at the open is not a price."],
  ["R5", "Confirmed jumps", "A move of more than 3% becomes a candidate. It is trusted only after ₩300M trades within 2% of it, across at least two windows, within a minute; at a session's start it also needs 20 trades. A thinner print elsewhere cannot overrule it. Otherwise it is rejected."],
  ["R6", "Staleness", "Without a fresh trusted price the market is shown as waiting, and requests simply wait for the next one."],
  ["R7", "Official close", "The 15:30 closing auction sets the official close, once a day: the base for the next day's band and the moment every K2X token resets to 2x."],
];

export default function EnginePage() {
  const { instance, mode } = useMode();
  const [source, setSource] = useState<"mode" | "0728">("mode");
  const [asset, setAsset] = useState<AssetKey>("hynix");
  const [filter, setFilter] = useState<"all" | "accepted" | "held" | "rejected">("all");
  const { data: tape, error: tapeError } = useTape(instance, asset, 8000, 3000n, source === "mode");
  const { data: s } = useSnapshot(instance, asset);
  const all = source === "0728" ? TAPE_0728 : (tape ?? []);
  const rows = all.filter((r) => filter === "all" || r.verdict === filter);
  const inst = INSTANCES[instance];

  return (
    <div className="pt-10">
      <p className="eyebrow">Price log · K-Mark</p>
      <h1 className="display mt-2 text-4xl font-bold">Every price decision, with its reason</h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        A relayer only reports trades. Whether a price is trusted, held or rejected is decided by{" "}
        <a className="underline" href={inst ? addressUrl(inst.engine) : undefined} target="_blank" rel="noreferrer">
          the engine contract
        </a>
        , which records why. Filter by Rejected to see what was kept out.
      </p>

      <section className="mt-8 grid gap-3 md:grid-cols-2">
        {RULES.map(([code, title, text]) => (
          <div key={code} className="card p-4">
            <div className="flex items-baseline gap-3">
              <span className="display font-semibold">{title}</span>
            </div>
            <p className="mt-2 text-sm text-ink-2">{text}</p>
          </div>
        ))}
      </section>

      <section className="card mt-8 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display font-semibold">Decision log</h2>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-md border border-rule p-0.5 text-sm" role="tablist">
              {(["mode", "0728"] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={source === k}
                  onClick={() => setSource(k)}
                  className={`rounded px-3 py-1 ${source === k ? "bg-ink text-sheet" : "text-ink-2"}`}
                >
                  {k === "mode" ? `${MODE_LABEL[mode]} · last hour` : "28 Jul open (recorded)"}
                </button>
              ))}
            </div>
            {source === "mode" && <AssetSwitch value={asset} onChange={setAsset} />}
          </div>
        </div>
        <div className="mt-3 flex gap-1 text-sm">
          {(["all", "accepted", "held", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-tint text-ink" : "text-ink-2"}`}
            >
              {f === "all" ? "All" : f === "accepted" ? "Trusted" : f === "held" ? "Held" : "Rejected"}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <VerdictTape
            rows={rows}
            reference={source === "0728" ? PREV_0728 : s ? Number(s.basePx) : undefined}
            limit={40}
            error={source === "mode" ? tapeError : undefined}
          />
          {source === "mode" && tape && tape.length === 0 && (
            <p className="text-sm text-ink-2">
              {mode === "live"
                ? "Nothing in the last hour: the Korean market is closed or quiet. "
                : "The replay day has not moved in the last hour. It moves when someone mints or redeems. "}
              <button className="underline" onClick={() => setSource("0728")}>
                See the recorded 28 July open
              </button>
              .
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
