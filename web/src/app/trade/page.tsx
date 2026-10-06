"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { erc20Abi, formatUnits, parseEventLogs, parseUnits, type Address, type TransactionReceipt } from "viem";
import { k2xPoolAbi, kmarkEngineAbi } from "@k2x/relayer";
import { SessionBand } from "@/components/SessionBand";
import { AssetSwitch, InstanceSwitch } from "@/components/Switches";
import { publicClient, sleep, type RefundReason } from "@/lib/client";
import { ASSETS, AUSD, INSTANCES, txUrl, type AssetKey, type InstanceKey } from "@/lib/config";
import {
  defaultInstance,
  knownRefundReason,
  lookupRefundReason,
  notePending,
  requestExpiry,
  useEngineClock,
  useSnapshot,
} from "@/lib/data";
import { SESSION_TEXT, ausd6, dirClass, kstClock, kstDate, krw, pct, units18 } from "@/lib/format";
import { useNow, usePoll } from "@/lib/hooks";
import { kstParts, nextOpen } from "@/lib/session";
import { useWallet } from "@/lib/wallet";

export default function TradePage() {
  return (
    <Suspense>
      <Trade />
    </Suspense>
  );
}

const KINDS = ["Mint", "Redeem", "LP deposit", "LP withdraw"];
const STATUS = ["", "Waiting for the next trusted price", "Settled", "Refunded"];
const REFUND_TEXT: Record<RefundReason, string> = {
  NONE: "funds returned",
  EXPIRED: "expired — no trusted price before the deadline",
  SLIPPAGE: "slippage — the price moved past your limit",
  CAP: "pool cap — no room for more exposure",
  INSOLVENT: "pool short of funds",
};
/** Slippage limits offered, in percent. */
const TOLERANCES = [1, 3, 10, 25];

function Trade() {
  const params = useSearchParams();
  const router = useRouter();
  const asset = (params.get("asset") as AssetKey) || "hynix";
  const instance = ((params.get("instance") as InstanceKey) || defaultInstance) as InstanceKey;
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    p.set(k, v);
    router.replace(`/trade?${p.toString()}`);
  };
  const inst = INSTANCES[instance]!;
  const a = ASSETS[asset];
  const pool = inst.pools[asset];
  const token = inst.tokens[asset];
  const now = useNow();
  const { data: engineNow } = useEngineClock(instance);
  const { data: s, error: snapError, refresh } = useSnapshot(instance, asset, 2000);
  const clock = instance === "live" ? now : engineNow || now;
  const move = s && s.px > 0n ? Number(s.px) / Number(s.basePx) - 1 : 0;
  // the engine marks its price stale when no trusted print arrived recently or the session is closed
  const stale = !!s && s.px > 0n && s.stale;
  const at = s ? Number(s.priceAt) : 0;
  const atText = kstParts(at).day === kstParts(clock).day ? kstClock(at) : `${kstDate(at)} ${kstClock(at)}`;
  const funding = s ? (Number(s.fundingRatePerSec) / 1e18) * 365 * 86400 : 0;

  return (
    <div className="pt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Mint & redeem · {inst.label}</p>
          <h1 className="display mt-2 text-4xl font-bold">{a.symbol}</h1>
          <p className="mt-1 text-sm text-ink-2">
            2x {a.name} ({a.ko}, {a.code}) · no liquidation · resets to 2x at each 15:30 KRX close
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <InstanceSwitch value={instance} onChange={(v) => set("instance", v)} />
          <AssetSwitch value={asset} onChange={(v) => set("asset", v)} />
        </div>
      </div>

      <div className="mt-6">
        <SessionBand now={clock} clockLabel={instance === "live" ? "KST" : "Sandbox clock"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="card p-5">
          <h2 className="eyebrow">How today's NAV is built</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Line k="Last official close (P₀)" v={s ? `${krw(s.basePx)} KRW` : "—"} />
            <Line
              k={stale ? `Last trusted price (P) · ${atText}` : "Trusted price now (P)"}
              v={s && s.px > 0n ? `${krw(s.px)} KRW` : !s && snapError ? "unavailable" : "waiting for the first trusted price"}
              cls={dirClass(move)}
            />
            <Line k="Move since the close" v={s && s.px > 0n ? pct(move) : "—"} cls={dirClass(move)} />
            <Line k="× 2 leverage" v={s && s.px > 0n ? pct(2 * move) : "—"} cls={dirClass(move)} />
            <Line k="Funding paid to LPs (this rate, a year)" v={s ? pct(-funding, 1) : "—"} />
            <div className="border-t border-rule pt-3">
              <Line k="NAV per token" v={s ? `${units18(s.nav, 4)} AUSD` : "—"} big />
            </div>
          </dl>
          {stale && (
            <p className="mt-4 rounded-md bg-tint p-3 text-xs text-ink-2">
              No fresh trusted price since <span className="num">{atText}</span> KST, so the NAV above uses that price. A
              request settles at the next trusted price, not this one.
            </p>
          )}
          {!s && snapError && <p className="mt-4 text-xs text-up">Could not read the pool from the Monad RPC. Retrying…</p>}
          <p className="mt-4 text-xs text-ink-3">
            {s ? SESSION_TEXT[s.sessionName] : ""} · price seq {s ? s.priceSeq.toString() : "—"} · supply{" "}
            {s ? units18(s.tokenSupply, 2) : "—"}
          </p>
        </section>

        <ActionPanel instance={instance} asset={asset} pool={pool} token={token} snapshot={s} clock={clock} onDone={refresh} />
      </div>

      <MyRequests instance={instance} pool={pool} clock={clock} />
    </div>
  );
}

function Line({ k, v, cls = "", big = false }: { k: string; v: string; cls?: string; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-2">{k}</dt>
      <dd className={`num ${big ? "text-2xl" : ""} ${cls}`}>{v}</dd>
    </div>
  );
}

type Step = { ok: true; virtualTime: number } | { ok: false; busy: boolean; error: string };

/** Move the sandbox market. Never throws: a timed-out step comes back as an HTML 504 page, not JSON. */
async function stepSandbox(minutes: number): Promise<Step> {
  try {
    const res = await fetch("/api/sandbox/step", { method: "POST", body: JSON.stringify({ minutes }) });
    const body = (await res.json().catch(() => null)) as { error?: string; virtualTime?: number } | null;
    if (res.ok && typeof body?.virtualTime === "number") return { ok: true, virtualTime: body.virtualTime };
    if (res.status === 429) return { ok: false, busy: true, error: "Someone else is moving the sandbox market right now." };
    if (body?.error) return { ok: false, busy: false, error: `The sandbox could not move: ${body.error}.` };
    return { ok: false, busy: false, error: `The sandbox step did not finish (HTTP ${res.status}); the market may have moved part of the way.` };
  } catch {
    return { ok: false, busy: false, error: "Could not reach the sandbox server." };
  }
}

/** The id from the pool's Requested event in a request receipt. */
function requestIdIn(r: TransactionReceipt, pool: Address): bigint | undefined {
  const logs = parseEventLogs({ abi: k2xPoolAbi, eventName: "Requested", logs: r.logs });
  return logs.find((l) => l.address.toLowerCase() === pool.toLowerCase())?.args.id;
}

function ActionPanel({
  instance,
  asset,
  pool,
  token,
  snapshot: s,
  clock,
  onDone,
}: {
  instance: InstanceKey;
  asset: AssetKey;
  pool: Address;
  token: Address;
  snapshot: ReturnType<typeof useSnapshot>["data"];
  clock: number;
  onDone: () => void;
}) {
  const { wallet, write, busy, connectDemo, fund } = useWallet();
  const [mode, setMode] = useState<"mint" | "redeem">("mint");
  const [amount, setAmount] = useState("1000");
  const [tolPick, setTolPick] = useState<number>();
  const [stepping, setStepping] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tx?: string; error?: boolean }>();
  const balances = usePoll(
    async () => {
      if (!wallet) return null;
      const [ausd, tok] = await Promise.all([
        publicClient.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
      ]);
      return { ausd, tok };
    },
    3000,
    [wallet?.address, token],
  );
  const inst = INSTANCES[instance]!;
  const market = ASSETS[asset].market;
  const symbol = ASSETS[asset].symbol;
  const nav = s ? Number(s.nav) / 1e18 : 10;
  const n = Number(amount) || 0;
  const estimate = mode === "mint" ? (n * 0.999) / nav : n * nav * 0.999;
  const session = s?.sessionName ?? "CLOSED";
  const open = session === "NXT_PRE" || session === "CONTINUOUS" || session === "NXT_AFTER";
  const stale = !!s && s.px > 0n && s.stale;
  // a request made while the market is closed fills after the overnight gap, so the default limit is wider
  const tol = tolPick ?? (open ? 3 : 25);
  const minOut = estimate * (1 - tol / 100);
  const outUnit = mode === "mint" ? symbol : "AUSD";
  const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 4 });

  /** What happened to request `id` after the sandbox moved, read back from the pool rather than assumed. */
  async function afterStep(id: bigint | undefined, step: Step): Promise<{ text: string; error?: boolean }> {
    const waiting = "your request is still waiting for the next trusted price";
    if (id !== undefined) {
      const read = () => publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestOf", args: [id] });
      let r = await read();
      // the browser's RPC node can be a block behind the one the sandbox wrote to
      if (r.status === 1 && step.ok) {
        await sleep(1500);
        r = await read();
      }
      if (r.status === 2) {
        const p = await publicClient.readContract({
          address: inst.engine,
          abi: kmarkEngineAbi,
          functionName: "priceAt",
          args: [market, r.settledSeq],
        });
        const out = r.kind === 0 ? `${units18(r.amountOut, 4)} ${symbol}` : `${ausd6(r.amountOut)} AUSD`;
        return { text: `Settled at ${krw(p.px)} KRW: ${out}.` };
      }
      if (r.status === 3) {
        const reason = await lookupRefundReason({ instance, pool, market, id, request: r });
        return {
          text: `Refunded · ${REFUND_TEXT[reason ?? "NONE"]}. Your ${r.kind === 0 ? "AUSD" : symbol} is back in your wallet.`,
          error: true,
        };
      }
    }
    if (step.ok) return { text: `The sandbox moved to ${kstClock(step.virtualTime)}, but ${waiting}.` };
    if (step.busy) return { text: `${step.error} Until it finishes, ${waiting}.` };
    return { text: `${step.error} Your request is still waiting; try moving the sandbox market again.`, error: true };
  }

  async function submit() {
    if (!wallet || !s) return;
    setMsg(undefined);
    try {
      const expiry = await requestExpiry(instance, 7 * 86400);
      let r: TransactionReceipt;
      if (mode === "mint") {
        const amt = parseUnits(amount, 6);
        const allowance = await publicClient.readContract({
          address: AUSD,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet.address, pool],
        });
        if (allowance < amt) {
          setMsg({ text: "Approving AUSD…" });
          await write({ address: AUSD, abi: erc20Abi, functionName: "approve", args: [pool, 2n ** 255n] });
        }
        setMsg({ text: "Sending mint request…" });
        const min = parseUnits(minOut.toFixed(6), 18);
        r = await write({ address: pool, abi: k2xPoolAbi, functionName: "requestMint", args: [amt, min, expiry] });
      } else {
        const amt = parseUnits(amount, 18);
        setMsg({ text: "Sending redeem request…" });
        const min = parseUnits(minOut.toFixed(6), 6);
        r = await write({ address: pool, abi: k2xPoolAbi, functionName: "requestRedeem", args: [amt, min, expiry] });
      }
      const tx = r.transactionHash;
      const id = requestIdIn(r, pool);
      if (id !== undefined) notePending(pool, id, r.blockNumber);
      setMsg({ text: "Requested. It settles at the next trusted price.", tx });
      if (instance === "sandbox") {
        setStepping(true);
        setMsg({ text: "Requested. Moving the sandbox market one minute…", tx });
        const step = await stepSandbox(1);
        const outcome = await afterStep(id, step).catch((e: Error) => ({
          text: `Requested, but its status could not be read (${e.message.split("\n")[0]}). Check your requests below.`,
          error: true,
        }));
        setMsg({ ...outcome, tx });
      }
      onDone();
    } catch (e) {
      setMsg((m) => ({ text: (e as Error).message.split("\n")[0], tx: m?.tx, error: true }));
    } finally {
      setStepping(false);
    }
  }

  async function moveSandbox() {
    setStepping(true);
    setMsg({ text: "Moving the sandbox market 5 minutes…" });
    try {
      const step = await stepSandbox(5);
      if (step.ok) setMsg({ text: `Sandbox moved to ${kstClock(step.virtualTime)}.` });
      else if (step.busy) setMsg({ text: `${step.error} Try again in a moment.` });
      else setMsg({ text: step.error, error: true });
    } finally {
      setStepping(false);
      onDone();
    }
  }

  return (
    <section className="card p-5">
      <div className="inline-flex rounded-md bg-tint p-0.5 text-sm">
        {(["mint", "redeem"] as const).map((m) => (
          <button
            key={m}
            onClick={() => (setMode(m), setAmount(m === "mint" ? "1000" : "10"))}
            className={`rounded px-4 py-1.5 ${mode === m ? "bg-sheet font-medium shadow-sm" : "text-ink-2"}`}
          >
            {m === "mint" ? "Mint" : "Redeem"}
          </button>
        ))}
      </div>
      <label className="mt-5 block text-sm text-ink-2" htmlFor="amount">
        {mode === "mint" ? "Pay (AUSD)" : `Redeem (${symbol})`}
      </label>
      <div className="mt-1 flex items-center rounded-md border border-rule bg-paper px-3 focus-within:border-ink">
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="num w-full bg-transparent py-2.5 text-xl outline-none"
        />
        <span className="text-sm text-ink-3">{mode === "mint" ? "AUSD" : symbol}</span>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        ≈ <span className="num">{fmt(estimate)}</span> {outUnit} at {stale ? "the last trusted" : "today's"} NAV, after
        the 0.10% fee. The final amount uses the next trusted price.
      </p>
      {wallet && balances.data && (
        <p className="num mt-1 text-xs text-ink-3">
          Balance {ausd6(balances.data.ausd)} AUSD · {units18(balances.data.tok, 4)} {symbol}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-2">Slippage limit</span>
        <div className="inline-flex rounded-md bg-tint p-0.5 text-xs">
          {TOLERANCES.map((t) => (
            <button
              key={t}
              onClick={() => setTolPick(t)}
              aria-pressed={tol === t}
              className={`num rounded px-2.5 py-1 ${tol === t ? "bg-sheet font-medium shadow-sm" : "text-ink-2"}`}
            >
              {t}%
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-3">
        Refunded if it would pay less than <span className="num">{fmt(minOut)}</span> {outUnit}.
        {s && !open && " The default is wider while the market is closed: you fill after the overnight gap, and the token moves twice as much as the stock."}
      </p>

      {!open && instance === "live" && (
        <p className="mt-4 rounded-md bg-tint p-3 text-sm text-ink-2">
          The Korean market is closed. Your request will wait and settle at the first trusted price of the next session (
          <span className="num">{kstDate(nextOpen(clock))} 08:00 KST</span>). This is on purpose: a price from yesterday
          would let anyone trade the overnight gap against the pool.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {!wallet ? (
          <button onClick={() => connectDemo()} className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-sheet">
            Use demo wallet
          </button>
        ) : (
          <>
            <button
              disabled={busy || stepping || !s || n <= 0}
              onClick={submit}
              className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-sheet disabled:opacity-50"
            >
              {busy
                ? "Waiting for Monad…"
                : stepping
                  ? "Moving the sandbox…"
                  : mode === "mint"
                    ? "Request mint"
                    : "Request redeem"}
            </button>
            {balances.data && balances.data.ausd === 0n && (
              <button
                onClick={() => fund().then((m) => setMsg({ text: m })).catch((e) => setMsg({ text: e.message, error: true }))}
                className="rounded-md border border-rule px-4 py-2.5 text-sm"
              >
                Get test funds
              </button>
            )}
          </>
        )}
      </div>
      {msg && (
        <p className={`mt-3 text-sm ${msg.error ? "text-up" : "text-ink-2"}`}>
          {msg.text}{" "}
          {msg.tx && txUrl(msg.tx) && (
            <a className="underline" href={txUrl(msg.tx)} target="_blank" rel="noreferrer">
              view tx
            </a>
          )}
        </p>
      )}
      {instance === "sandbox" && (
        <button
          disabled={stepping || busy}
          className="mt-4 text-xs text-ink-2 underline disabled:no-underline disabled:opacity-50"
          onClick={moveSandbox}
        >
          {stepping ? "Moving the sandbox market…" : "Move the sandbox market 5 minutes"}
        </button>
      )}
    </section>
  );
}

function MyRequests({ instance, pool, clock }: { instance: InstanceKey; pool: Address; clock: number }) {
  const { wallet } = useWallet();
  const inst = INSTANCES[instance]!;
  const { data } = usePoll(
    async () => {
      if (!wallet) return [];
      // read before the statuses: a request still pending below was pending at this block, so its refund comes later
      const head = await publicClient.getBlockNumber();
      const ids = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "userRequests", args: [wallet.address] });
      const recent = [...ids].reverse().slice(0, 8);
      const reqs = await Promise.all(
        recent.map((id) => publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestOf", args: [id] })),
      );
      const market = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "market" });
      return Promise.all(
        reqs.map(async (r, i) => {
          const id = recent[i];
          // a few blocks of slack for RPC nodes that lag behind the head
          if (r.status === 1) notePending(pool, id, head > 10n ? head - 10n : 0n);
          return {
            id,
            r,
            px:
              r.status === 2 && r.settledSeq > 0n
                ? (await publicClient.readContract({ address: inst.engine, abi: kmarkEngineAbi, functionName: "priceAt", args: [market, r.settledSeq] })).px
                : 0n,
            reason: r.status === 3 ? knownRefundReason({ instance, pool, market, id, request: r }) : undefined,
          };
        }),
      );
    },
    2500,
    [wallet?.address, pool],
  );
  if (!wallet || !data || data.length === 0) return null;
  return (
    <section className="card mt-4 p-5">
      <h2 className="display font-semibold">Your requests</h2>
      <ul className="mt-3 divide-y divide-rule text-sm">
        {data.map(({ id, r, px, reason }) => {
          const isAusdIn = r.kind === 0 || r.kind === 2;
          const inAmt = isAusdIn ? `${formatUnits(r.amountIn, 6)} AUSD` : `${Number(formatUnits(r.amountIn, 18)).toFixed(4)}`;
          const outAmt =
            r.status === 2
              ? r.kind === 0
                ? `${Number(formatUnits(r.amountOut, 18)).toFixed(4)} tokens`
                : r.kind === 1 || r.kind === 3
                  ? `${Number(formatUnits(r.amountOut, 6)).toFixed(2)} AUSD`
                  : `${Number(formatUnits(r.amountOut, 18)).toFixed(2)} LP`
              : "";
          return (
            <li key={id.toString()} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>
                <span className="font-medium">{KINDS[r.kind]}</span> <span className="num text-ink-2">{inAmt}</span>
              </span>
              <span className="text-ink-2">
                {r.status === 1 ? (
                  <span className="text-held">
                    {STATUS[1]} · {Math.max(0, clock - Number(r.createdAt))}s
                  </span>
                ) : r.status === 2 ? (
                  <span>
                    <span className="text-accepted">Settled</span> at <span className="num">{krw(px)}</span> → <span className="num">{outAmt}</span>
                  </span>
                ) : (
                  <span className="text-ink-3">Refunded · {REFUND_TEXT[reason ?? "NONE"]}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
