import type { Hex } from "viem";
import { kmarkEngineAbi } from "./abi.ts";
import { MARKETS } from "./chains.ts";
import { submitReports, toReport, type Clients } from "./engine.ts";
import { settlePending, syncPool } from "./keeper.ts";
import type { Dataset, Deployment, EngineEvent } from "./types.ts";

/** The sandbox replays one real trading day; each loop is shifted a week so time only moves forward. */
export const LOOP_SHIFT = 7 * 86_400;

export type SandboxMarket = { key: "hynix" | "smsn"; market: Hex; pool: Hex; dataset: Dataset };

export function sandboxMarkets(d: Deployment, hynix: Dataset, smsn: Dataset): SandboxMarket[] {
  return [
    { key: "hynix", market: MARKETS.hynix, pool: d.hynixPool, dataset: hynix },
    { key: "smsn", market: MARKETS.smsn, pool: d.smsnPool, dataset: smsn },
  ];
}

type Cursor = { loop: number; index: number; lastAt: number };

/** Where the replay of `m` stands, derived from the engine's last KRX report time (stateless). */
export async function cursorOf({ publicClient }: Clients, engine: Hex, m: SandboxMarket): Promise<Cursor> {
  const st = await publicClient.readContract({
    address: engine,
    abi: kmarkEngineAbi,
    functionName: "marketState",
    args: [m.market],
  });
  const lastAt = Number(st.lastKrxAt);
  const reports = m.dataset.reports;
  if (lastAt === 0) return { loop: 0, index: 0, lastAt };
  const loop = Math.max(0, Math.floor((lastAt - reports[0].windowEnd) / LOOP_SHIFT));
  const shift = loop * LOOP_SHIFT;
  const index = reports.findIndex((r) => r.windowEnd + shift > lastAt);
  return index === -1 ? { loop: loop + 1, index: 0, lastAt } : { loop, index, lastAt };
}

export type StepResult = {
  posted: number;
  virtualTime: number;
  settled: Record<string, string[]>;
  closes: number;
  events: EngineEvent[];
};

/**
 * Advance the sandbox market by `steps` report times (one minute bar each during the session),
 * keeping all markets in lockstep, then settle every request that now has a price.
 */
export async function stepSandbox(
  clients: Clients,
  deployment: Deployment,
  markets: SandboxMarket[],
  steps: number,
): Promise<StepResult> {
  const engine = deployment.sandboxEngine;
  const events: EngineEvent[] = [];
  let posted = 0;
  let closes = 0;
  let virtualTime = 0;

  for (let s = 0; s < steps; s++) {
    const cursors = await Promise.all(markets.map((m) => cursorOf(clients, engine, m)));
    const nextTimes = markets.map((m, i) => {
      const c = cursors[i];
      return m.dataset.reports[c.index].windowEnd + c.loop * LOOP_SHIFT;
    });
    const target = Math.min(...nextTimes);
    virtualTime = target;

    for (let i = 0; i < markets.length; i++) {
      const m = markets[i];
      const c = cursors[i];
      const batch = [];
      let idx = c.index;
      while (idx < m.dataset.reports.length && m.dataset.reports[idx].windowEnd + c.loop * LOOP_SHIFT <= target) {
        batch.push(toReport(m.dataset.reports[idx], m.market, c.loop * LOOP_SHIFT));
        if (m.dataset.reports[idx].kind === 2) closes++;
        idx++;
      }
      if (batch.length === 0) continue;
      const res = await submitReports(clients, engine, batch);
      posted += batch.length;
      events.push(...res.events);
    }
  }

  // settle first: each settlement applies the daily resets up to its own price, in order
  const settled: Record<string, string[]> = {};
  for (const m of markets) {
    settled[m.key] = (await settlePending(clients, m.pool)).map(String);
    if (closes > 0) await syncPool(clients, m.pool);
  }
  return { posted, virtualTime, settled, closes, events };
}
