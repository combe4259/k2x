import type { Hex } from "viem";
import { k2xPoolAbi, kmarkEngineAbi } from "./abi.ts";
import type { Clients } from "./engine.ts";

/** Settle every request of `pool` that already has a trusted price after it. Returns settled ids. */
export async function settlePending({ publicClient, walletClient }: Clients, pool: Hex): Promise<bigint[]> {
  const count = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestCount" });
  if (count === 0n) return [];
  const pending = await publicClient.readContract({
    address: pool,
    abi: k2xPoolAbi,
    functionName: "pendingIds",
    args: [0n, count],
  });
  if (pending.length === 0) return [];

  const [engine, market] = await Promise.all([
    publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "engine" }),
    publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "market" }),
  ]);
  const priceSeq = await publicClient.readContract({
    address: engine,
    abi: kmarkEngineAbi,
    functionName: "priceSeq",
    args: [market],
  });

  const requests = await Promise.all(
    pending.map((id) =>
      publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestOf", args: [id] }),
    ),
  );
  const ready = pending.filter((_, i) => requests[i].seq < priceSeq);
  if (ready.length === 0) return [];

  const call = { address: pool, abi: k2xPoolAbi, functionName: "settleMany", args: [ready] } as const;
  const gas = await publicClient.estimateContractGas({ ...call, account: walletClient.account });
  const hash = await walletClient.writeContract({ ...call, gas: (gas * 120n) / 100n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`settleMany reverted: ${hash}`);
  return ready;
}

/** Apply official closes (daily reset) and re-price funding. */
export async function syncPool({ publicClient, walletClient }: Clients, pool: Hex): Promise<Hex> {
  const call = { address: pool, abi: k2xPoolAbi, functionName: "sync" } as const;
  const gas = await publicClient.estimateContractGas({ ...call, account: walletClient.account });
  const hash = await walletClient.writeContract({ ...call, gas: (gas * 120n) / 100n });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
