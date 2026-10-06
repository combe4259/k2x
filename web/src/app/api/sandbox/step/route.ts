import { NextResponse } from "next/server";
import { parseAbiItem } from "viem";
import { sandboxMarkets, stepSandbox } from "@k2x/relayer";
import { deployment, sandboxData, signerClients } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Minimum wall time between sandbox moves, shared by every visitor and server instance. */
const PACE_SECONDS = 15;
const RAW_PRINT = parseAbiItem(
  "event RawPrint(bytes32 indexed market, uint8 venue, uint8 kind, uint64 windowStart, uint64 windowEnd, uint64 lastPx, uint64 lowPx, uint64 highPx, uint64 vwapPx, uint64 volume, uint128 notional, uint32 trades)",
);

let running: Promise<unknown> | null = null;

/**
 * Advances the sandbox market by up to 3 minute bars and settles waiting requests. The pace is
 * read from the chain (the last sandbox print), so calling faster cannot fast-forward the market.
 */
export async function POST(req: Request) {
  const { minutes = 1 } = (await req.json().catch(() => ({}))) as { minutes?: number };
  const steps = Math.max(1, Math.min(3, Math.floor(minutes)));
  if (running) return NextResponse.json({ error: "The sandbox market is moving. Try again in a moment." }, { status: 429 });
  try {
    const clients = signerClients();
    const { publicClient } = clients;
    const latest = await publicClient.getBlock();
    const logs = await publicClient.getLogs({
      address: deployment.sandboxEngine,
      event: RAW_PRINT,
      fromBlock: latest.number > 60n ? latest.number - 60n : 0n,
      toBlock: latest.number,
    });
    if (logs.length) {
      const last = await publicClient.getBlock({ blockNumber: logs[logs.length - 1].blockNumber! });
      const wait = PACE_SECONDS - Number(latest.timestamp - last.timestamp);
      if (wait > 0) {
        return NextResponse.json(
          { error: `The sandbox market moved ${PACE_SECONDS - wait}s ago. It moves at most once every ${PACE_SECONDS}s.`, retryIn: wait },
          { status: 429 },
        );
      }
    }
    const markets = sandboxMarkets(deployment, sandboxData["000660"], sandboxData["005930"]);
    running = stepSandbox(clients, deployment, markets, steps, process.env.SANDBOX_SEED);
    const res = (await running) as Awaited<ReturnType<typeof stepSandbox>>;
    return NextResponse.json({ posted: res.posted, virtualTime: res.virtualTime, settled: res.settled, closes: res.closes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 500 });
  } finally {
    running = null;
  }
}
