import { createPublicClient, getAbiItem, http, type Address, type Hex } from "viem";
import { decodeEngineLogs, k2xPoolAbi, kmarkEngineAbi, type EngineEvent } from "@k2x/relayer";
import { RPC_URL, chain } from "./config";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 500 });

const CHUNK = 100n;
const PARALLEL = 4;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One retry after a short pause: the public RPC drops the odd call under load. */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await sleep(400);
    return fn();
  }
}

/**
 * getLogs over [from, to] in CHUNK-block ranges (public RPCs cap the range), PARALLEL ranges at a time.
 * A range that fails twice throws, so a gap is never mistaken for "no events". `done` ends the scan early.
 */
export async function scanLogs<T>(
  from: bigint,
  to: bigint,
  get: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  done?: (found: T[]) => boolean,
): Promise<T[]> {
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += CHUNK) {
    ranges.push([start, start + CHUNK - 1n > to ? to : start + CHUNK - 1n]);
  }
  const out: T[] = [];
  for (let i = 0; i < ranges.length; i += PARALLEL) {
    const wave = await Promise.all(ranges.slice(i, i + PARALLEL).map(([a, b]) => retryOnce(() => get(a, b))));
    out.push(...wave.flat());
    if (done?.(out)) break;
  }
  return out;
}

/** Engine events from the last `lookback` blocks. Throws if part of the range could not be read. */
export async function recentEngineEvents(engine: Address, lookback = 600n, floor = 0n): Promise<EngineEvent[]> {
  const head = await publicClient.getBlockNumber();
  let from = head > lookback ? head - lookback : 0n;
  if (from < floor) from = floor;
  const logs = await scanLogs(from, head, (fromBlock, toBlock) => publicClient.getLogs({ address: engine, fromBlock, toBlock }));
  return decodeEngineLogs(logs, engine as Hex);
}

/** The engine's clock: block time on the live engine, the latest report time on replay engines. */
export async function engineTime(engine: Address, blockNumber?: bigint): Promise<number> {
  return Number(await publicClient.readContract({ address: engine, abi: kmarkEngineAbi, functionName: "currentTime", blockNumber }));
}

/** First block in [lo, hi] at which `reached` holds, for a condition that only turns true once. */
export async function firstBlock(lo: bigint, hi: bigint, reached: (block: bigint) => Promise<boolean>): Promise<bigint> {
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (await reached(mid)) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

/** K2XPool.RefundReason, in contract order. */
export const REFUND_REASON = ["NONE", "EXPIRED", "SLIPPAGE", "CAP", "INSOLVENT"] as const;
export type RefundReason = (typeof REFUND_REASON)[number];

const refundedEvent = getAbiItem({ abi: k2xPoolAbi, name: "Refunded" });

/** The reason in request `id`'s Refunded log, searched in [from, to]; undefined if the log is not there. */
export async function findRefundReason(pool: Address, user: Address, id: bigint, from: bigint, to: bigint) {
  const logs = await scanLogs(
    from,
    to,
    (fromBlock, toBlock) => publicClient.getLogs({ address: pool, event: refundedEvent, args: { id, user }, fromBlock, toBlock }),
    (found) => found.length > 0,
  );
  const reason = logs[0]?.args.reason;
  return reason === undefined ? undefined : (REFUND_REASON[reason] ?? "NONE");
}
