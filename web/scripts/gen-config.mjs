// Collects deployment addresses and on-chain replay results into src/generated/ for the app.
// Chain is chosen by NEXT_PUBLIC_CHAIN_ID (default: Monad testnet 10143, falls back to local 31337).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "..", "src", "generated");
mkdirSync(out, { recursive: true });

const want = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 10143);
const chainId = existsSync(join(root, "deployments", `${want}.json`)) ? want : 31337;
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

const base = read(join(root, "deployments", `${chainId}.json`));
const live = read(join(root, "deployments", `${chainId}.live.json`));
const replayDir = join(root, "data", "onchain", String(chainId));
const replays = {};
if (existsSync(replayDir)) {
  for (const f of readdirSync(replayDir).filter((f) => f.endsWith(".json"))) {
    replays[f.replace(".json", "")] = read(join(replayDir, f));
  }
}
const datasets = {};
for (const f of ["2026-07-28_000660", "2026-08-06_000660"]) {
  const d = read(join(root, "data", "replays", `${f}.json`));
  datasets[f] = { title: d.title, seedClose: d.seedClose, sources: d.sources, notes: d.notes, reports: d.reports };
}

const sandbox = {};
for (const code of ["000660", "005930"]) sandbox[code] = read(join(root, "data", "sandbox", `2026-10-02_${code}.json`));
writeFileSync(join(out, "sandbox.json"), JSON.stringify(sandbox));
writeFileSync(join(out, "deployment.json"), JSON.stringify({ chainId, base, live }, null, 1));
writeFileSync(join(out, "replays.json"), JSON.stringify(replays));
writeFileSync(join(out, "datasets.json"), JSON.stringify(datasets));
console.log(`generated config for chain ${chainId}: base=${!!base} live=${!!live} replays=${Object.keys(replays).join(",") || "none"}`);
