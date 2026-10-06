// Leaves evidence on chain for what the contracts refuse and how a request is priced, and saves the
// transactions to data/proof/<chainId>.json (shown on the site and in the README).
// usage: tsx src/cli/proof.ts <local|testnet> [run|resolve]
//   run      send the proof transactions (refusals, a forward-priced mint, a refund, an off-hours request)
//   resolve  look up how the off-hours request settled once the next session has priced it
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEventLog, maxUint128, parseUnits, type Hex, type Log, type TransactionReceipt } from "viem";
import { k2xPoolAbi, mockAusdAbi } from "../abi.ts";
import { MARKETS } from "../chains.ts";
import { submitReports, type Clients } from "../engine.ts";
import { settleQueue } from "../keeper.ts";
import { ROOT, loadDataset, loadDeployment, makeClients } from "../node.ts";
import { sandboxMarkets, stepSandbox } from "../sandbox.ts";

type Row = { what: string; result: string; tx: Hex; block: number; note?: string };
type Proof = { chainId: number; rows: Row[]; pending?: { pool: Hex; id: string; requestTx: Hex } };

const [network = "local", mode = "run"] = process.argv.slice(2);
const op = makeClients(network);
const chainId = op.chainId;
const d = loadDeployment(chainId);
const live: { liveEngine: Hex; hynixPool: Hex } = JSON.parse(readFileSync(join(ROOT, "deployments", `${chainId}.live.json`), "utf8"));
const file = join(ROOT, "data", "proof", `${chainId}.json`);
const proof: Proof = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { chainId, rows: [] };

const KST = 9 * 3600;
const t0728 = (h: number, m: number, s = 0) => Date.UTC(2026, 6, 28) / 1000 - KST + h * 3600 + m * 60 + s;

function report(market: Hex, kind: number, end: number, px: number, overrides: Partial<Record<string, bigint | number>> = {}) {
  return {
    market,
    venue: 1,
    kind,
    windowStart: BigInt(end - 1),
    windowEnd: BigInt(end),
    trades: 200,
    volume: 2_000n,
    notional: BigInt(2_000 * px),
    firstPx: BigInt(px),
    lastPx: BigInt(px),
    highPx: BigInt(px),
    lowPx: BigInt(px),
    vwapPx: BigInt(px),
    flags: 0,
    ...overrides,
  } as const;
}

async function refusal(c: Clients, engine: Hex, what: string, r: ReturnType<typeof report>, note?: string) {
  const { receipts, events } = await submitReports(c, engine, [r]);
  const verdict = events.find((e) => e.type === "rejected" || e.type === "held" || e.type === "accepted")!;
  const result = verdict.type === "accepted" ? "ACCEPTED" : `${verdict.type.toUpperCase()} · ${"reason" in verdict ? verdict.reason : ""}`;
  console.log(`${what}: ${result}`);
  add({ what, result, tx: receipts[0].transactionHash, block: Number(receipts[0].blockNumber), note });
}

function add(row: Row) {
  proof.rows = proof.rows.filter((r) => r.what !== row.what);
  proof.rows.push(row);
}

function poolEvents(logs: Log[], pool: Hex) {
  return logs
    .filter((l) => l.address.toLowerCase() === pool.toLowerCase())
    .flatMap((l) => {
      try {
        return [decodeEventLog({ abi: k2xPoolAbi, data: l.data, topics: l.topics })];
      } catch {
        return [];
      }
    });
}

async function write(c: Clients, call: Parameters<Clients["walletClient"]["writeContract"]>[0]): Promise<TransactionReceipt> {
  const hash = await c.walletClient.writeContract(call);
  const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

/** The settleQueue transaction (and its events) that settled request `id` of `pool`, searching recent blocks. */
async function settlementOf(c: Clients, pool: Hex, id: bigint, fromBlock: bigint) {
  const latest = await c.publicClient.getBlockNumber();
  for (let from = fromBlock; from <= latest; from += 100n) {
    const logs = await c.publicClient.getLogs({ address: pool, fromBlock: from, toBlock: from + 99n > latest ? latest : from + 99n });
    for (const l of logs) {
      const [e] = poolEvents([l], pool);
      if (e && (e.eventName === "Settled" || e.eventName === "Refunded") && (e.args as { id: bigint }).id === id) {
        return { tx: l.transactionHash as Hex, block: Number(l.blockNumber), event: e };
      }
    }
  }
  return null;
}

if (mode === "run") {
  // 1. refusals on the incident engine's 7/28 market (after its recorded replay, so the replay is untouched)
  await refusal(op.clients, d.incidentEngine, "A price outside the ±30% daily limit", report(MARKETS.incident0728, 0, t0728(9, 1), 2_400_000), "2,400,000 KRW vs a 2,360,800 upper limit");
  await refusal(
    op.clients,
    d.incidentEngine,
    "A closing auction whose official close differs from its band-checked price",
    report(MARKETS.incident0728, 2, t0728(15, 30), 1_850_000, { lastPx: 18_500_000n }),
    "lastPx 18,500,000 vs vwap 1,850,000",
  );

  // 2. a future-dated report on the live engine (the Ostium trick), sent by the live relayer key
  const relayer = makeClients(network, "LIVE_RELAYER_PRIVATE_KEY");
  const now = Number((await relayer.clients.publicClient.getBlock()).timestamp);
  await refusal(relayer.clients, live.liveEngine, "A report dated an hour in the future", report(MARKETS.hynix, 0, now + 3600, 1_784_000), "sent by the live relayer key itself");

  // 3. a forward-priced mint and a slippage refund on the replay day (sandbox)
  const c = op.clients;
  const pool = d.hynixPool;
  const account = c.walletClient.account.address;
  const bal = await c.publicClient.readContract({ address: d.ausd, abi: mockAusdAbi, functionName: "balanceOf", args: [account] });
  if (bal < parseUnits("1100", 6)) await write(c, { address: d.ausd, abi: mockAusdAbi, functionName: "mint", args: [account, parseUnits("10000", 6)] } as never);
  await write(c, { address: d.ausd, abi: mockAusdAbi, functionName: "approve", args: [pool, maxUint128] } as never);
  const far = BigInt(now + 365 * 86400 * 5);
  const mintRx = await write(c, { address: pool, abi: k2xPoolAbi, functionName: "requestMint", args: [parseUnits("1000", 6), 0n, far] } as never);
  const refundRx = await write(c, { address: pool, abi: k2xPoolAbi, functionName: "requestMint", args: [parseUnits("100", 6), maxUint128, far] } as never);
  const mintId = (poolEvents(mintRx.logs, pool).find((e) => e.eventName === "Requested")!.args as { id: bigint; seq: bigint }).id;
  const refundId = (poolEvents(refundRx.logs, pool).find((e) => e.eventName === "Requested")!.args as { id: bigint }).id;
  const askedSeq = (poolEvents(mintRx.logs, pool).find((e) => e.eventName === "Requested")!.args as { seq: bigint }).seq;
  const markets = sandboxMarkets(d, loadDataset("sandbox/2026-10-02_000660.json"), loadDataset("sandbox/2026-10-02_005930.json"));
  await stepSandbox(c, d, markets, 1, process.env.SANDBOX_SEED);
  await settleQueue(c, pool);
  const settled = await settlementOf(c, pool, mintId, mintRx.blockNumber);
  const refunded = await settlementOf(c, pool, refundId, refundRx.blockNumber);
  if (!settled || !refunded) throw new Error("sandbox requests did not settle");
  const s = settled.event.args as { priceSeq: bigint; px: bigint };
  add({ what: "Mint requested on the replay day (price #" + askedSeq + " on screen)", result: "REQUESTED · 1,000 AUSD", tx: mintRx.transactionHash, block: Number(mintRx.blockNumber) });
  add({
    what: "…settled at the first price formed after the request",
    result: `SETTLED · price #${s.priceSeq} = ${Number(s.px).toLocaleString()} KRW`,
    tx: settled.tx,
    block: settled.block,
  });
  add({ what: "A mint asking for more tokens than the price allows", result: "REFUNDED · SLIPPAGE", tx: refunded.tx, block: refunded.block });

  // 4. a request made while Korea is closed, on the live pool: it waits for the next session
  const livePool = live.hynixPool;
  await write(c, { address: d.ausd, abi: mockAusdAbi, functionName: "approve", args: [livePool, maxUint128] } as never);
  const offRx = await write(c, { address: livePool, abi: k2xPoolAbi, functionName: "requestMint", args: [parseUnits("1000", 6), 0n, BigInt(now + 3 * 86400)] } as never);
  const offId = (poolEvents(offRx.logs, livePool).find((e) => e.eventName === "Requested")!.args as { id: bigint }).id;
  add({ what: "Mint requested while Korea is closed (live)", result: "QUEUED · waits for the next session", tx: offRx.transactionHash, block: Number(offRx.blockNumber) });
  proof.pending = { pool: livePool, id: String(offId), requestTx: offRx.transactionHash };
} else {
  const p = proof.pending;
  if (!p) throw new Error("nothing pending");
  const rx = await op.clients.publicClient.getTransactionReceipt({ hash: p.requestTx });
  const settled = await settlementOf(op.clients, p.pool, BigInt(p.id), rx.blockNumber);
  if (!settled) {
    console.log("not settled yet");
    process.exit(0);
  }
  const a = settled.event.args as { priceSeq: bigint; px: bigint };
  add({
    what: "…settled at the next session's first trusted price",
    result: `${settled.event.eventName.toUpperCase()} · price #${a.priceSeq} = ${Number(a.px).toLocaleString()} KRW`,
    tx: settled.tx,
    block: settled.block,
  });
  delete proof.pending;
}

mkdirSync(join(ROOT, "data", "proof"), { recursive: true });
writeFileSync(file, JSON.stringify(proof, null, 1));
console.log(`saved ${proof.rows.length} rows → data/proof/${chainId}.json`);
