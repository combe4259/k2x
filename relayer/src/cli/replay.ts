// Post an incident replay to the incident engine and save the decoded on-chain events.
// usage: tsx src/cli/replay.ts <local|testnet> <2026-07-28_000660|2026-08-06_000660>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETS } from "../chains.ts";
import { submitReports, toReport } from "../engine.ts";
import { ROOT, loadDataset, loadDeployment, makeClients } from "../node.ts";

const [network = "local", scenario = "2026-07-28_000660"] = process.argv.slice(2);
const market = scenario.startsWith("2026-07-28") ? MARKETS.incident0728 : MARKETS.incident0806;

const { clients, chainId } = makeClients(network);
const deployment = loadDeployment(chainId);
const dataset = loadDataset(`replays/${scenario}.json`);
const reports = dataset.reports.map((r) => toReport(r, market));

console.log(`posting ${reports.length} reports for ${scenario} to ${deployment.incidentEngine} (chain ${chainId})`);
let i = 0;
const { receipts, events } = await submitReports(clients, deployment.incidentEngine, reports, (e) => {
  if (e.type === "accepted") console.log(`  ✓ accepted ${e.px.toLocaleString()} @${e.at}`);
  if (e.type === "rejected") console.log(`  ✗ rejected ${e.reason} ${e.px.toLocaleString()}`);
  if (e.type === "raw" && ++i % 25 === 0) console.log(`  … ${i}/${reports.length}`);
});

const outDir = join(ROOT, "data", "onchain", String(chainId));
mkdirSync(outDir, { recursive: true });
const out = {
  scenario,
  chainId,
  engine: deployment.incidentEngine,
  market,
  fromBlock: Number(receipts[0].blockNumber),
  toBlock: Number(receipts.at(-1)!.blockNumber),
  gasUsed: receipts.reduce((a, r) => a + Number(r.gasUsed), 0),
  events,
};
writeFileSync(join(outDir, `${scenario}.json`), JSON.stringify(out, null, 1));
console.log(`saved ${events.length} events → data/onchain/${chainId}/${scenario}.json (gas ${out.gasUsed.toLocaleString()})`);
