import {
  decodeEventLog,
  type Account,
  type Chain,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from "viem";
import { kmarkEngineAbi } from "./abi.ts";
import { Reason, type DatasetReport, type EngineEvent } from "./types.ts";

export type Clients = {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
};

/** Convert a dataset row into the on-chain Report struct; `shift` moves it in time (sandbox loops). */
export function toReport(r: DatasetReport, market: Hex, shift = 0) {
  return {
    market,
    venue: r.venue,
    kind: r.kind,
    windowStart: BigInt(r.windowStart + shift),
    windowEnd: BigInt(r.windowEnd + shift),
    trades: r.trades,
    volume: BigInt(r.volume),
    notional: BigInt(r.notional),
    firstPx: BigInt(r.firstPx),
    lastPx: BigInt(r.lastPx),
    highPx: BigInt(r.highPx),
    lowPx: BigInt(r.lowPx),
    vwapPx: BigInt(r.vwapPx),
    flags: r.flags,
  } as const;
}

/**
 * Submit reports one by one. Monad charges the gas limit, so each transaction is estimated
 * against the latest state (sequential) rather than sent with a generous fixed limit.
 */
export async function submitReports(
  { publicClient, walletClient }: Clients,
  engine: Hex,
  reports: ReturnType<typeof toReport>[],
  onEvent?: (e: EngineEvent) => void,
): Promise<{ receipts: TransactionReceipt[]; events: EngineEvent[] }> {
  const receipts: TransactionReceipt[] = [];
  const events: EngineEvent[] = [];
  for (const report of reports) {
    const call = { address: engine, abi: kmarkEngineAbi, functionName: "submit", args: [report] } as const;
    const gas = await publicClient.estimateContractGas({ ...call, account: walletClient.account });
    const hash = await walletClient.writeContract({ ...call, gas: (gas * 115n) / 100n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`submit reverted: ${hash}`);
    receipts.push(receipt);
    for (const e of decodeEngineLogs(receipt.logs, engine)) {
      events.push(e);
      onEvent?.(e);
    }
  }
  return { receipts, events };
}

export function decodeEngineLogs(logs: Log[], engine: Hex): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== engine.toLowerCase()) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: kmarkEngineAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const base = { txHash: log.transactionHash as Hex, blockNumber: Number(log.blockNumber) };
    const a = decoded.args as Record<string, unknown>;
    switch (decoded.eventName) {
      case "RawPrint":
        out.push({
          type: "raw",
          market: a.market as Hex,
          venue: Number(a.venue),
          kind: Number(a.kind),
          windowStart: Number(a.windowStart),
          windowEnd: Number(a.windowEnd),
          lastPx: Number(a.lastPx),
          lowPx: Number(a.lowPx),
          highPx: Number(a.highPx),
          vwapPx: Number(a.vwapPx),
          volume: Number(a.volume),
          notional: Number(a.notional),
          trades: Number(a.trades),
          ...base,
        });
        break;
      case "PriceAccepted":
        out.push({
          type: "accepted",
          market: a.market as Hex,
          seq: Number(a.seq),
          px: Number(a.px),
          at: Number(a.at),
          venue: Number(a.venue),
          kind: Number(a.kind),
          ...base,
        });
        break;
      case "PriceHeld":
      case "PriceRejected":
        out.push({
          type: decoded.eventName === "PriceHeld" ? "held" : "rejected",
          market: a.market as Hex,
          reason: Reason[Number(a.reason)] ?? "NONE",
          px: Number(a.px),
          at: Number(a.at),
          venue: Number(a.venue),
          ...base,
        });
        break;
      case "CloseSet":
        out.push({
          type: "close",
          market: a.market as Hex,
          day: Number(a.day),
          px: Number(a.px),
          seq: Number(a.seq),
          ...base,
        });
        break;
    }
  }
  return out;
}
