import type { Hex } from "viem";
import { kmarkEngineAbi } from "./abi.ts";
import { MARKETS } from "./chains.ts";
import { submitReports, toReport, type Clients } from "./engine.ts";
import { settleQueue, syncPool } from "./keeper.ts";
import type { Dataset, DatasetReport, Deployment, EngineEvent } from "./types.ts";

/** The sandbox replays one real trading day; each loop is shifted a week so time only moves forward. */
export const LOOP_SHIFT = 7 * 86_400;

/** Largest per-bar move of the secret random walk laid over each loop (±0.3%). */
const NOISE = 0.003;

/**
 * The replayed day is public, so on its own the next bar is known in advance. Each loop therefore
 * multiplies the day by a random walk drawn from a secret seed: the shape stays real, the path
 * cannot be predicted. Without a seed (local runs) the day is replayed as recorded.
 */
async function noiseLevels(seed: string | undefined, key: string, loop: number, n: number): Promise<number[]> {
  const levels = new Array<number>(n).fill(1);
  if (!seed) return levels;
  const mac = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey("raw", new TextEncoder().encode(seed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    new TextEncoder().encode(`${key}:${loop}`),
  );
  let a = new DataView(mac).getUint32(0); // mulberry32
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let level = 1;
  for (let i = 0; i < n; i++) {
    if (i > 0) level *= 1 + (rand() * 2 - 1) * NOISE;
    levels[i] = level;
  }
  return levels;
}

function scaled(r: DatasetReport, k: number): DatasetReport {
  if (k === 1) return r;
  const px = (v: number) => Math.round(v * k);
  return {
    ...r,
    firstPx: px(r.firstPx),
    lastPx: px(r.lastPx),
    highPx: px(r.highPx),
    lowPx: px(r.lowPx),
    vwapPx: px(r.vwapPx),
    notional: Math.round(r.notional * k),
  };
}

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
  settled: Record<string, number>;
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
  seed?: string,
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
      const levels = await noiseLevels(seed, m.key, c.loop, m.dataset.reports.length);
      let idx = c.index;
      while (idx < m.dataset.reports.length && m.dataset.reports[idx].windowEnd + c.loop * LOOP_SHIFT <= target) {
        batch.push(toReport(scaled(m.dataset.reports[idx], levels[idx]), m.market, c.loop * LOOP_SHIFT));
        if (m.dataset.reports[idx].kind === 2) closes++;
        idx++;
      }
      if (batch.length === 0) continue;
      const res = await submitReports(clients, engine, batch);
      posted += batch.length;
      events.push(...res.events);
    }
  }

  // settle first, in request order: each settlement applies the daily resets up to its own price
  const settled: Record<string, number> = {};
  for (const m of markets) {
    settled[m.key] = await settleQueue(clients, m.pool);
    if (closes > 0) await syncPool(clients, m.pool);
  }
  return { posted, virtualTime, settled, closes, events };
}
