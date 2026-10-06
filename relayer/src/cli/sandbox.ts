// Advance the sandbox market and settle requests.
// usage: tsx src/cli/sandbox.ts <local|testnet> [steps=1]
import { sandboxMarkets, stepSandbox } from "../sandbox.ts";
import { loadDataset, loadDeployment, makeClients } from "../node.ts";

const [network = "local", stepsArg = "1"] = process.argv.slice(2);
const { clients, chainId } = makeClients(network);
const deployment = loadDeployment(chainId);
const markets = sandboxMarkets(
  deployment,
  loadDataset("sandbox/2026-10-02_000660.json"),
  loadDataset("sandbox/2026-10-02_005930.json"),
);
const res = await stepSandbox(clients, deployment, markets, Number(stepsArg));
const t = new Date((res.virtualTime + 9 * 3600) * 1000).toISOString().replace("T", " ").slice(0, 19);
console.log(`posted ${res.posted} reports, virtual time ${t} KST, closes ${res.closes}, settled`, res.settled);
