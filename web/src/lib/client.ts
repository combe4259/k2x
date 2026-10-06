import { createPublicClient, http, type Address, type Hex } from "viem";
import { decodeEngineLogs, type EngineEvent } from "@k2x/relayer";
import { RPC_URL, chain } from "./config";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 500 });

const CHUNK = 100n;

/** Engine events from the last `lookback` blocks, fetched in small ranges (public RPCs cap getLogs). */
export async function recentEngineEvents(engine: Address, lookback = 600n, floor = 0n): Promise<EngineEvent[]> {
  const head = await publicClient.getBlockNumber();
  let from = head > lookback ? head - lookback : 0n;
  if (from < floor) from = floor;
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= head; start += CHUNK) {
    const end = start + CHUNK - 1n > head ? head : start + CHUNK - 1n;
    ranges.push([start, end]);
  }
  const results = await Promise.all(
    ranges.map(([fromBlock, toBlock]) =>
      publicClient.getLogs({ address: engine, fromBlock, toBlock }).catch(() => []),
    ),
  );
  return decodeEngineLogs(results.flat(), engine as Hex);
}
