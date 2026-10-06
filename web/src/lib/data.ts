"use client";

import { k2xPoolAbi, kmarkEngineAbi, Session } from "@k2x/relayer";
import type { Address, Hex } from "viem";
import { toTape } from "@/components/VerdictTape";
import {
  REFUND_REASON,
  engineTime,
  findRefundReason,
  firstBlock,
  publicClient,
  recentEngineEvents,
  type RefundReason,
} from "./client";
import { ASSETS, CHAIN_ID, INSTANCES, type AssetKey, type InstanceKey } from "./config";
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
  return usePoll(async () => (inst ? engineTime(inst.engine) : 0), ms, [instance]);
}

/** Recent verdicts for one market of an instance. While `enabled` is false it returns [] without reading the chain. */
export function useTape(instance: InstanceKey, asset: AssetKey, ms = 4000, lookback = 900n, enabled = true) {
  const inst = INSTANCES[instance];
  return usePoll(
    async () => {
      if (!inst || !enabled) return [];
      const events = await recentEngineEvents(inst.engine, lookback, BigInt(inst.startBlock));
      const market = ASSETS[asset].market.toLowerCase();
      return toTape(events.filter((e) => e.market.toLowerCase() === market));
    },
    ms,
    [instance, asset, enabled],
  );
}

/**
 * Expiry for a new request, `ttl` seconds ahead on the engine's clock. The pool compares expiry with engine
 * time, and sandbox engines run a replay clock that can be far from wall time.
 */
export async function requestExpiry(instance: InstanceKey, ttl: number): Promise<bigint> {
  const inst = INSTANCES[instance];
  const now = instance === "live" || !inst ? Math.floor(Date.now() / 1000) : await engineTime(inst.engine);
  return BigInt(now + ttl);
}

// ─────────────────────────────── Refund reasons ───────────────────────────────

/** Blocks searched for a Refunded log once we know roughly where it is (about ten minutes on Monad testnet). */
const REFUND_SPAN = 1500n;

const storeKey = (kind: string, pool: Address, id: bigint) => `k2x.${kind}.${CHAIN_ID}.${pool.toLowerCase()}.${id}`;

function load(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the in-memory cache still covers this visit
  }
}

/** Remember that request `id` was still pending at `block`, so a later refund is searched for after it. */
export function notePending(pool: Address, id: bigint, block: bigint) {
  const key = storeKey("pending", pool, id);
  const prev = load(key);
  if (!prev || BigInt(prev) < block) save(key, block.toString());
}

export type RefundQuery = {
  instance: InstanceKey;
  pool: Address;
  market: Hex;
  id: bigint;
  request: { user: Address; settledSeq: bigint; expiry: bigint };
};

async function searchRefund({ instance, pool, market, id, request: r }: RefundQuery): Promise<RefundReason | undefined> {
  // cancel() is the only refund that leaves settledSeq at 0, and it only refunds expired requests
  if (r.settledSeq === 0n) return "EXPIRED";
  const inst = INSTANCES[instance]!;
  const p = await publicClient.readContract({ address: inst.engine, abi: kmarkEngineAbi, functionName: "priceAt", args: [market, r.settledSeq] });
  if (p.at > r.expiry) return "EXPIRED";

  // the refund came right after the price at settledSeq was posted: find that moment, then read the log
  const head = await publicClient.getBlockNumber();
  const seenStr = load(storeKey("pending", pool, id));
  const seen = seenStr ? BigInt(seenStr) : undefined;
  let from: bigint;
  if (seen !== undefined && head - seen <= REFUND_SPAN) {
    from = seen;
  } else {
    const lo = seen !== undefined && seen > BigInt(inst.startBlock) ? seen : BigInt(inst.startBlock);
    const t = Number(p.at) - 5;
    from = await firstBlock(lo, head, async (b) =>
      instance === "live"
        ? Number((await publicClient.getBlock({ blockNumber: b })).timestamp) >= t // live engine time is block time
        : (await engineTime(inst.engine, b)) >= t,
    );
  }
  const to = from + REFUND_SPAN > head ? head : from + REFUND_SPAN;
  return findRefundReason(pool, r.user, id, from, to);
}

const found = new Map<string, RefundReason>();
const lookups = new Map<string, Promise<RefundReason | undefined>>();
const tries = new Map<string, number>();

function cached(key: string): RefundReason | undefined {
  const v = found.get(key) ?? load(key);
  return REFUND_REASON.includes(v as RefundReason) ? (v as RefundReason) : undefined;
}

/** Why request `id` was refunded, from its Refunded log. Cached once found; undefined if it could not be found. */
export function lookupRefundReason(q: RefundQuery): Promise<RefundReason | undefined> {
  const key = storeKey("refund", q.pool, q.id);
  const known = cached(key);
  if (known) return Promise.resolve(known);
  let p = lookups.get(key);
  if (!p) {
    tries.set(key, (tries.get(key) ?? 0) + 1);
    // a miss (or an RPC failure) may be a lagging node: allow another try a little later
    const retryLater = () => setTimeout(() => lookups.delete(key), 30_000);
    p = searchRefund(q).then(
      (reason) => {
        if (reason) {
          found.set(key, reason);
          save(key, reason);
        } else retryLater();
        return reason;
      },
      () => {
        retryLater();
        return undefined;
      },
    );
    lookups.set(key, p);
  }
  return p;
}

/** The refund reason if already known; otherwise starts looking for it (a few tries) and returns undefined. */
export function knownRefundReason(q: RefundQuery): RefundReason | undefined {
  const key = storeKey("refund", q.pool, q.id);
  const known = cached(key);
  if (!known && !lookups.has(key) && (tries.get(key) ?? 0) < 3) void lookupRefundReason(q);
  return known;
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
