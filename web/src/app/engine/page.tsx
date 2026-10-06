"use client";

import { useState } from "react";
import { AssetSwitch, InstanceSwitch } from "@/components/Switches";
import { VerdictTape } from "@/components/VerdictTape";
import { INSTANCES, addressUrl, type AssetKey, type InstanceKey } from "@/lib/config";
import { defaultInstance, useSnapshot, useTape } from "@/lib/data";

const RULES = [
  ["R0", "Sequence and clock", "Reports must be newer than the last one from that venue. On the live clock a report dated in the future, or more than a minute old, is refused — the move that made the Ostium exploit possible."],
  ["R1", "Session", "NXT trades count only in its pre-market (08:00–08:50), main market (from 09:00:30) and after-market (15:30–20:00); KRX only from its 09:00 opening auction to the 15:30 close. Weekends, holidays and late opens such as exam day come from an on-chain calendar."],
  ["R2", "Halts and VI", "During a trading halt or a volatility interruption the price freezes. The single-price auction that ends a VI starts a new warm-up."],
  ["R3", "±30% band", "Korean stocks cannot trade beyond ±30% of the previous close, so nothing outside that band is ever accepted — even from a compromised relayer."],
  ["R4", "Warm-up", "A session's first prints are held until ₩100M and 20 trades have gone through. One share at the open is not a price."],
  ["R5", "Confirmed jumps", "A move of more than 3% becomes a candidate. It is trusted only after ₩300M trades within 2% of it, across at least two windows, within a minute. Otherwise it is rejected."],
  ["R7", "Staleness", "Without a fresh trusted price the market is shown as waiting, and requests simply wait for the next one."],
  ["R8", "Official close", "The 15:30 closing auction sets the official close: the base for the next day's band and the moment every K2X token resets to 2x."],
];

export default function EnginePage() {
  const [instance, setInstance] = useState<InstanceKey>(defaultInstance);
  const [asset, setAsset] = useState<AssetKey>("hynix");
  const [filter, setFilter] = useState<"all" | "accepted" | "held" | "rejected">("all");
  const { data: tape } = useTape(instance, asset, 4000, 3000n);
  const { data: s } = useSnapshot(instance, asset);
  const rows = (tape ?? []).filter((r) => filter === "all" || r.verdict === filter);
  const inst = INSTANCES[instance];

  return (
    <div className="pt-10">
      <p className="eyebrow">K-Mark engine</p>
      <h1 className="display mt-2 text-4xl font-bold">The rules, and every decision they made</h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        The rules are code in{" "}
        <a className="underline" href={inst ? addressUrl(inst.engine) : undefined} target="_blank" rel="noreferrer">
          the engine contract
        </a>
        . A relayer can only report trades; whether a price is trusted is decided on-chain, with the reason emitted for
        anyone to audit.
      </p>

      <section className="mt-8 grid gap-3 md:grid-cols-2">
        {RULES.map(([code, title, text]) => (
          <div key={code} className="card p-4">
            <div className="flex items-baseline gap-3">
              <span className="num text-xs text-ink-3">{code}</span>
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
            <InstanceSwitch value={instance} onChange={setInstance} />
            <AssetSwitch value={asset} onChange={setAsset} />
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
          <VerdictTape rows={rows} reference={s ? Number(s.basePx) : undefined} limit={40} />
        </div>
      </section>
    </div>
  );
}
