import type { Hex } from "viem";
import { k2xPoolAbi, kmarkEngineAbi } from "./abi.ts";
import type { Clients } from "./engine.ts";

/** Requests a single settleQueue transaction looks at; keeps every transaction well under the gas limit. */
const CHUNK = 25n;

/**
 * Settle the pool's queue in request order, in bounded transactions. A request settles only at a
 * price formed after it, so the queue stops at the first request still waiting. Returns how many settled.
 */
export async function settleQueue({ publicClient, walletClient }: Clients, pool: Hex, maxTx = 4): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxTx; i++) {
    const call = { address: pool, abi: k2xPoolAbi, functionName: "settleQueue", args: [CHUNK] } as const;
    const [head, count] = await Promise.all([
      publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "head" }),
      publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestCount" }),
    ]);
    if (head >= count) break;
    const { result: done } = await publicClient.simulateContract({ ...call, account: walletClient.account });
    if (done === 0n) break;
    const gas = await publicClient.estimateContractGas({ ...call, account: walletClient.account });
    const hash = await walletClient.writeContract({ ...call, gas: (gas * 120n) / 100n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`settleQueue reverted: ${hash}`);
    total += Number(done);
    if (done < CHUNK) break;
  }
  return total;
}

export type QueueState = {
  /** the newest request has no price formed after it yet; `since` is when it was made */
  waiting: boolean;
  since: number;
  /** the oldest pending request already has its price and can be settled now */
  ready: boolean;
};

/** Where the pool's request queue stands (a few reads; no transactions). */
export async function queueState({ publicClient }: Clients, pool: Hex, engine: Hex, market: Hex): Promise<QueueState> {
  const read = <T>(functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName, args } as never) as Promise<T>;
  const [head, count] = await Promise.all([read<bigint>("head"), read<bigint>("requestCount")]);
  if (head >= count) return { waiting: false, since: 0, ready: false };
  const seq = await publicClient.readContract({ address: engine, abi: kmarkEngineAbi, functionName: "priceSeq", args: [market] });
  const latest =
    seq === 0n ? null : await publicClient.readContract({ address: engine, abi: kmarkEngineAbi, functionName: "priceAt", args: [market, seq] });
  const priced = (q: { seq: bigint; createdAt: bigint }) => seq > q.seq && latest !== null && latest.from >= q.createdAt;

  const [first, last] = await Promise.all([read<PoolRequest>("requestOf", [head]), read<PoolRequest>("requestOf", [count - 1n])]);
  const waiting = last.status === 1 && !priced(last); // 1 = PENDING
  // the oldest is ready if a price formed after it exists (the pool finds the earliest such price)
  const ready = first.status === 1 && priced(first);
  return { waiting, since: waiting ? Number(last.createdAt) : 0, ready };
}

type PoolRequest = { status: number; seq: bigint; createdAt: bigint };

/** Apply official closes (daily reset) and re-price funding. */
export async function syncPool({ publicClient, walletClient }: Clients, pool: Hex): Promise<Hex> {
  const call = { address: pool, abi: k2xPoolAbi, functionName: "sync" } as const;
  const gas = await publicClient.estimateContractGas({ ...call, account: walletClient.account });
  const hash = await walletClient.writeContract({ ...call, gas: (gas * 120n) / 100n });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return hash;
}
