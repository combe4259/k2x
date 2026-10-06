"use client";

import Link from "next/link";
import { ASSETS, type AssetKey, type InstanceKey } from "@/lib/config";
import { useSnapshot } from "@/lib/data";
import { SESSION_TEXT, dirClass, krw, pct, units18 } from "@/lib/format";

export function TokenCard({ asset, instance }: { asset: AssetKey; instance: InstanceKey }) {
  const a = ASSETS[asset];
  const { data: s } = useSnapshot(instance, asset);
  const move = s && s.px > 0n && s.basePx > 0n ? Number(s.px) / Number(s.basePx) - 1 : 0;
  const navMove = s ? Number(s.nav) / 1e18 / 10 - 1 : 0;
  return (
    <Link href={`/trade?asset=${asset}&instance=${instance}`} className="card group block p-5 hover:border-ink-3">
      <div className="flex items-baseline justify-between">
        <span className="display text-lg font-semibold">{a.symbol}</span>
        <span className="text-xs text-ink-3">
          {a.name} · {a.ko}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="eyebrow">NAV</div>
          <div className="num mt-1 text-2xl">{s ? units18(s.nav, 3) : "—"}</div>
          <div className="text-xs text-ink-3">AUSD per token · started at 10</div>
        </div>
        <div>
          <div className="eyebrow">Trusted price</div>
          <div className={`num mt-1 text-2xl ${dirClass(move)}`}>{s && s.px > 0n ? krw(s.px) : "—"}</div>
          <div className={`num text-xs ${dirClass(move)}`}>
            {s && s.px > 0n ? `${pct(move)} vs close ${krw(s.basePx)} → token ${pct(2 * move)}` : "waiting for first trusted price"}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-rule pt-3 text-xs text-ink-2">
        <span>{s ? SESSION_TEXT[s.sessionName] : "…"}{s?.stale && s.sessionName !== "CLOSED" ? " · waiting for next print" : ""}</span>
        <span className={dirClass(navMove)}>since launch {s ? pct(navMove, 1) : ""}</span>
      </div>
    </Link>
  );
}
