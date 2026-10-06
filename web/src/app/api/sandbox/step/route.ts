import { NextResponse } from "next/server";
import { sandboxMarkets, stepSandbox } from "@k2x/relayer";
import { deployment, operatorClients, sandboxData } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let running: Promise<unknown> | null = null;

/** Advances the sandbox market by up to 5 minute bars and settles waiting requests. */
export async function POST(req: Request) {
  const { minutes = 1 } = (await req.json().catch(() => ({}))) as { minutes?: number };
  const steps = Math.max(1, Math.min(5, Math.floor(minutes)));
  if (running) return NextResponse.json({ error: "The market is already moving — try again in a moment" }, { status: 429 });
  try {
    const clients = operatorClients();
    const markets = sandboxMarkets(deployment, sandboxData["000660"], sandboxData["005930"]);
    running = stepSandbox(clients, deployment, markets, steps);
    const res = (await running) as Awaited<ReturnType<typeof stepSandbox>>;
    return NextResponse.json({ posted: res.posted, virtualTime: res.virtualTime, settled: res.settled, closes: res.closes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 500 });
  } finally {
    running = null;
  }
}
