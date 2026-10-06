// Print sandbox pool snapshots.  usage: tsx src/cli/status.ts <local|testnet>
import { formatUnits } from "viem";
import { k2xPoolAbi } from "../abi.ts";
import { Session } from "../types.ts";
import { loadDeployment, makeClients } from "../node.ts";

const [network = "local"] = process.argv.slice(2);
const { clients, chainId } = makeClients(network);
const d = loadDeployment(chainId);
for (const [name, pool] of [["HYNIX2X", d.hynixPool], ["SMSN2X", d.smsnPool]] as const) {
  const s = await clients.publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "snapshot" });
  console.log(
    `${name}: px ${s.px.toLocaleString()} KRW (${Session[s.session]}${s.stale ? ", stale" : ""}) nav ${formatUnits(s.nav, 18)} ` +
      `supply ${formatUnits(s.tokenSupply, 18)} equity ${formatUnits(s.equity, 18)} util ${Number(s.utilizationBps) / 100}% pending ${s.pendingRequests}`,
  );
}
