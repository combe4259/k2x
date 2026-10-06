// Run the live relayer.  usage: tsx src/cli/live.ts <local|testnet> [--minutes N] [--interval S]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETS } from "../chains.ts";
import { LiveRelayer, type LiveDeployment } from "../live/runner.ts";
import { ROOT, makeClients } from "../node.ts";

const args = process.argv.slice(2);
const network = args[0] ?? "testnet";
const minutes = Number(args[args.indexOf("--minutes") + 1] ?? 0) || 0;
const interval = Number(args[args.indexOf("--interval") + 1] ?? 0) || 5;

const { clients, chainId } = makeClients(network, "LIVE_RELAYER_PRIVATE_KEY");
const d: LiveDeployment = JSON.parse(readFileSync(join(ROOT, "deployments", `${chainId}.live.json`), "utf8"));
const relayer = new LiveRelayer(clients, d.liveEngine, [
  { code: "000660", market: MARKETS.hynix, pool: d.hynixPool },
  { code: "005930", market: MARKETS.smsn, pool: d.smsnPool },
], (msg) => console.log(new Date().toISOString(), msg));

const stopAt = minutes > 0 ? Date.now() + minutes * 60_000 : Infinity;
console.log(`live relayer on chain ${chainId}, engine ${d.liveEngine}, every ${interval}s` + (minutes ? `, for ${minutes} min` : ""));
while (Date.now() < stopAt) {
  const started = Date.now();
  try {
    await relayer.tick();
  } catch (err) {
    console.error(new Date().toISOString(), "tick failed:", (err as Error).message);
  }
  const wait = interval * 1000 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
console.log("live relayer stopped");
