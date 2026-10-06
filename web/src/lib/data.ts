"use client";

import { k2xPoolAbi, kmarkEngineAbi, Session } from "@k2x/relayer";
import type { Address } from "viem";
import { toTape } from "@/components/VerdictTape";
import { publicClient, recentEngineEvents } from "./client";
import { ASSETS, INSTANCES, type AssetKey, type InstanceKey } from "./config";
import { usePoll } from "./hooks";

export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;

export async function readSnapshot(pool: Address) {
  const s = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "snapshot" });
  return { ...s, sessionName: Session[s.session] ?? "CLOSED" };
}

export function useSnapshot(instance: InstanceKey, asset: AssetKey, ms = 3000) {
  const inst = INSTANCES[instance];
  return usePoll(async () => (inst ? readSnapshot(inst.pools[asset]) : null), ms, [instance, asset]);
}

export function useEngineClock(instance: InstanceKey, ms = 3000) {
  const inst = INSTANCES[instance];
  return usePoll(
    async () =>
      inst ? Number(await publicClient.readContract({ address: inst.engine, abi: kmarkEngineAbi, functionName: "currentTime" })) : 0,
    ms,
    [instance],
  );
}

/** Recent verdicts for one market of an instance. */
export function useTape(instance: InstanceKey, asset: AssetKey, ms = 4000, lookback = 900n) {
  const inst = INSTANCES[instance];
  return usePoll(
    async () => {
      if (!inst) return [];
      const events = await recentEngineEvents(inst.engine, lookback, BigInt(inst.startBlock));
      const market = ASSETS[asset].market.toLowerCase();
      return toTape(events.filter((e) => e.market.toLowerCase() === market));
    },
    ms,
    [instance, asset],
  );
}

export type LiveQuote = {
  code: string;
  krx: { price: number; prevClose: number; status: string };
  nxt: { price: number; status: string; session: string } | null;
};

export function useQuotes(ms = 5000) {
  return usePoll(async () => {
    const res = await fetch("/api/quote", { cache: "no-store" });
    if (!res.ok) throw new Error("quote unavailable");
    return (await res.json()) as Record<string, LiveQuote>;
  }, ms);
}

export const defaultInstance: InstanceKey = INSTANCES.live ? "live" : "sandbox";
