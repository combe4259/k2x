// Offline end-to-end check of the live relayer on anvil: moves the chain clock through one KST
// trading day and feeds synthetic quotes (with a 1-share bad print at 08:00) to LiveRelayer.
// usage: tsx src/cli/live-sim.ts      (needs a local anvil with Deploy + DeployLive)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { k2xPoolAbi, k2xTokenAbi, kmarkEngineAbi, mockAusdAbi } from "../abi.ts";
import { MARKETS, localAnvil } from "../chains.ts";
import { LiveRelayer, type LiveDeployment } from "../live/runner.ts";
import type { Quote } from "../live/naver.ts";
import { ROOT, makeClients } from "../node.ts";

const { clients } = makeClients("local");
const { publicClient } = clients;
const d: LiveDeployment & { ausd: `0x${string}`; hynixToken: `0x${string}` } = JSON.parse(
  readFileSync(join(ROOT, "deployments", "31337.live.json"), "utf8"),
);

const KST = 9 * 3600;
const DAY_START = Date.UTC(2026, 9, 7) / 1000 - KST; // 2026-10-07 00:00 KST (Wednesday)
const at = (h: number, m: number, s = 0) => DAY_START + h * 3600 + m * 60 + s;
let clock = at(7, 59, 50);

async function setTime(t: number) {
  clock = t;
  await publicClient.request({ method: "evm_setNextBlockTimestamp" as any, params: [t] as any });
  await publicClient.request({ method: "evm_mine" as any, params: [] as any });
}

// ── synthetic market ──
const PREV = { "000660": 1_784_000, "005930": 273_000 } as Record<string, number>;
function quote(code: string): Quote {
  const prev = PREV[code];
  const sod = clock - DAY_START;
  const wave = (k: number) => Math.round((prev * (1 + 0.004 * Math.sin(sod / 900 + k))) / 1000) * 1000;
  const krxOpen = sod >= 9 * 3600;
  const krxClosed = sod >= 15 * 3600 + 30 * 60;
  const contSec = Math.max(0, Math.min(sod, 15 * 3600 + 20 * 60) - 9 * 3600);
  const krxVol = krxOpen ? 50_000 + contSec * 40 + (krxClosed ? 60_000 : 0) : 0;
  const krxPx = krxClosed ? Math.round((prev * 1.006) / 1000) * 1000 : wave(1);
  const pre = sod >= 8 * 3600 && sod < 8 * 3600 + 50 * 60;
  const after = sod >= 15 * 3600 + 30 * 60 && sod < 20 * 3600;
  let nxtPx = wave(2);
  let nxtVol = 0;
  if (pre) {
    const t = sod - 8 * 3600;
    nxtVol = t < 5 ? 1 : 1 + t * 30;
    if (t < 5) nxtPx = Math.round((prev * 0.7) / 1000 + 1) * 1000; // the bad print
    else nxtPx = Math.round((prev * 0.987) / 1000) * 1000;
  } else if (after) {
    nxtVol = (sod - (15 * 3600 + 30 * 60)) * 10 + 1;
  }
  return {
    code,
    name: code,
    fetchedAt: clock,
    krx: {
      price: krxPx,
      open: krxOpen ? wave(0) : 0,
      prevClose: prev,
      cumVolume: krxVol,
      cumValue: krxVol * krxPx,
      status: krxOpen && !krxClosed ? "OPEN" : "CLOSE",
      session: "regularMarket",
      halted: false,
      tradedAt: clock,
    },
    nxt: { price: nxtPx, cumVolume: nxtVol, cumValue: nxtVol * nxtPx, status: pre || after ? "OPEN" : "CLOSE", session: pre ? "PRE_MARKET" : "AFTER_MARKET", tradedAt: clock },
  };
}

const relayer = new LiveRelayer(
  clients,
  d.liveEngine,
  [
    { code: "000660", market: MARKETS.hynix, pool: d.hynixPool },
    { code: "005930", market: MARKETS.smsn, pool: d.smsnPool },
  ],
  (msg) => console.log(new Date((clock + KST) * 1000).toISOString().slice(11, 19), msg),
  async (code) => quote(code),
);

async function run(from: number, to: number, step = 5) {
  for (let t = from; t <= to; t += step) {
    await setTime(t);
    await relayer.tick();
  }
}

// a user who mints during the session
const alice = createWalletClient({
  chain: localAnvil,
  transport: http(),
  account: privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"),
});

await run(at(7, 59, 50), at(8, 3));
await run(at(8, 49, 30), at(8, 50, 30));
await run(at(8, 59, 55), at(9, 2));
await alice.writeContract({ address: d.ausd, abi: mockAusdAbi, functionName: "faucet" });
await alice.writeContract({ address: d.ausd, abi: mockAusdAbi, functionName: "approve", args: [d.hynixPool, 2n ** 255n] });
await alice.writeContract({
  address: d.hynixPool,
  abi: k2xPoolAbi,
  functionName: "requestMint",
  args: [parseUnits("1000", 6), 0n, 2n ** 63n],
});
console.log("── alice requested a 1,000 AUSD mint at 09:02");
await run(at(9, 2, 5), at(9, 3));
const bal = await publicClient.readContract({ address: d.hynixToken, abi: k2xTokenAbi, functionName: "balanceOf", args: [alice.account.address] });
console.log(`── alice HYNIX2X balance: ${formatUnits(bal, 18)}`);
await run(at(15, 19, 30), at(15, 31, 30));
await run(at(15, 35), at(15, 36));

const closes = await publicClient.readContract({ address: d.liveEngine, abi: kmarkEngineAbi, functionName: "closeCount", args: [MARKETS.hynix] });
const baseDay = await publicClient.readContract({ address: d.hynixToken, abi: k2xTokenAbi, functionName: "baseDay" });
const snap = await publicClient.readContract({ address: d.hynixPool, abi: k2xPoolAbi, functionName: "snapshot" });
console.log(`── closes recorded: ${closes}, token base day ${baseDay} (expected ${(DAY_START + KST) / 86400}), NAV ${formatUnits(snap.nav, 18)}`);
