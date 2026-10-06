"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { erc20Abi, parseUnits } from "viem";
import { k2xPoolAbi } from "@k2x/relayer";
import { AssetSwitch } from "@/components/Switches";
import { publicClient } from "@/lib/client";
import { ASSETS, AUSD, INSTANCES, txUrl, type AssetKey, type InstanceKey } from "@/lib/config";
import { requestExpiry, useSnapshot } from "@/lib/data";
import { usePoll } from "@/lib/hooks";
import { MODE_LABEL, useMode } from "@/lib/mode";
import { pct, usd18 } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

export default function PoolPage() {
  return (
    <Suspense>
      <Pool />
    </Suspense>
  );
}

// pool defaults (K2XPool capBps / withdrawCapBps): share of LP equity a limit move may cost
const MINT_CAP = 0.15;
const WITHDRAW_CAP = 0.3;

function Pool() {
  const params = useSearchParams();
  const router = useRouter();
  const asset = (params.get("asset") as AssetKey) || "hynix";
  const { instance, mode, completeDemo } = useMode();
  const poolAddr = INSTANCES[instance]!.pools[asset];
  // AUSD escrowed by requests that wait for their price (e.g. the seed deposit before the first trusted price)
  const { data: pending } = usePoll(
    () => publicClient.readContract({ address: poolAddr, abi: k2xPoolAbi, functionName: "pendingAusd" }),
    5000,
    [poolAddr],
  );
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    p.set(k, v);
    router.replace(`/pool?${p.toString()}`);
  };
  const { data: s, refresh } = useSnapshot(instance, asset, 2500);
  const { wallet } = useWallet();
  useEffect(() => completeDemo("pool"), [completeDemo]);
  const tokenAddr = INSTANCES[instance]!.tokens[asset];
  const { data: mine } = usePoll(
    async () => (wallet ? publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }) : 0n),
    5000,
    [wallet?.address, tokenAddr],
  );
  const mineUsd = s && mine ? (Number(mine) / 1e18) * (Number(s.nav) / 1e18) : 0;
  const equity = s ? Number(s.equity) / 1e18 : 0;
  const exposure = s ? Number(s.exposure) / 1e18 : 0;
  const liabilities = s ? Number(s.liabilities) / 1e18 : 0;
  const stress = s ? Number(s.stressLoss) / 1e18 : 0;
  const util = s ? Number(s.utilizationBps) / 10_000 : 0;
  const apr = s ? (Number(s.fundingRatePerSec) / 1e18) * 365 * 86400 : 0;
  const sharePrice = s && s.lpSupply > 0n ? equity / (Number(s.lpSupply) / 1e18) : 1;

  return (
    <div className="pt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">
            Pool · {MODE_LABEL[mode]} · counterparty to {ASSETS[asset].symbol}
          </p>
          <h1 className="display mt-2 text-4xl font-bold">The pool on the other side</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <AssetSwitch value={asset} onChange={(v) => set("asset", v)} />
        </div>
      </div>
      {s && s.lpSupply === 0n && (pending ?? 0n) > 0n && (
        <p className="mt-4 rounded-md bg-tint p-3 text-sm text-ink-2">
          Not priced yet: <span className="num">{(Number(pending) / 1e6).toLocaleString("en-US")}</span> AUSD is deposited and
          waiting for the first trusted price{instance === "live" ? " after the Korean market opens" : ""}. Until then the pool
          has no settled equity, so the figures below read zero.
        </p>
      )}
      <p className="mt-3 max-w-2xl text-ink-2">
        Token holders&apos; claims come first; LPs own what is left. The pool loses when the stock rises, and the most it
        can rise today is to its +30% daily limit. New mints stop once that move would cost LPs {MINT_CAP * 100}% of their
        equity; LP withdrawals stop at {WITHDRAW_CAP * 100}%. After a sell-off there is more room left to the limit, so the
        same holdings count for more. Holders pay a funding rate that rises with utilisation.
      </p>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <Stat label="LP equity" value={`$${usd18(s?.equity ?? 0n)}`} sub={`share price ${sharePrice.toFixed(4)} AUSD`} />
        <Stat
          label="Owed to holders"
          value={`$${usd18(s?.liabilities ?? 0n)}`}
          sub={mineUsd > 0 ? `token supply × NAV · $${mineUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} of it is yours` : "token supply × NAV"}
        />
        <Stat label="Stock exposure" value={`$${usd18(s?.exposure ?? 0n)}`} sub="how much stock the pool is effectively short" />
        <Stat label="Funding rate" value={pct(apr, 2)} sub="a year, paid by holders to LPs" />
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="display font-semibold">Loss at today&apos;s limit, against the mint cap</h2>
          <span className="num text-sm">{(util * 100).toFixed(1)}% used</span>
        </div>
        <div className="relative mt-4 h-4 overflow-hidden rounded-[3px] bg-tint">
          <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${Math.min(100, util * 100)}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-ink-3">
          <span>0</span>
          <span>
            new mints stop at 100% (${(equity * MINT_CAP).toLocaleString("en-US", { maximumFractionDigits: 0 })})
          </span>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Scenario label="Stock closes at today's +30% limit" loss={stress} equity={equity} />
          <Scenario label="Worst 5 days of the last 2 years (+46%)" loss={liabilities * 1.07} equity={equity} note="2x token +107% (4–11 May 2026)" />
          <Scenario label="Hedge that neutralises the pool" loss={exposure} equity={equity} hedge />
        </div>
        <p className="mt-4 text-xs text-ink-3">
          An unhedged pool is only safe at small size — SK hynix rose 408% in the last year. Larger pools assume LPs that
          hedge on KRX or perps; every number here is read from the pool contract, so they can.
        </p>
      </section>

      <LpActions instance={instance} asset={asset} onDone={refresh} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="eyebrow">{label}</div>
      <div className="num mt-2 text-2xl">{value}</div>
      <div className="mt-1 text-xs text-ink-3">{sub}</div>
    </div>
  );
}

function Scenario({ label, loss, equity, note, hedge }: { label: string; loss: number; equity: number; note?: string; hedge?: boolean }) {
  const share = equity > 0 ? loss / equity : 0;
  return (
    <div className="rounded-md border border-rule p-4">
      <div className="text-sm text-ink-2">{label}</div>
      <div className={`num mt-2 text-xl ${hedge ? "" : "text-up"}`}>
        {hedge ? "short " : "−"}${loss.toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </div>
      <div className="mt-1 text-xs text-ink-3">{hedge ? "of the underlying, to neutralise the pool" : `${(share * 100).toFixed(1)}% of LP equity`}</div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}

function LpActions({ instance, asset, onDone }: { instance: InstanceKey; asset: AssetKey; onDone: () => void }) {
  const { wallet, write, busy, connectDemo } = useWallet();
  const [amount, setAmount] = useState("5000");
  const [msg, setMsg] = useState<{ text: string; tx?: string }>();
  const pool = INSTANCES[instance]!.pools[asset];

  async function deposit() {
    if (!wallet) return;
    try {
      const amt = parseUnits(amount, 6);
      const allowance = await publicClient.readContract({ address: AUSD, abi: erc20Abi, functionName: "allowance", args: [wallet.address, pool] });
      if (allowance < amt) await write({ address: AUSD, abi: erc20Abi, functionName: "approve", args: [pool, 2n ** 255n] });
      // on the engine's clock: sandbox engines run a replay clock, not wall time
      const expiry = await requestExpiry(instance, 30 * 86400);
      const r = await write({ address: pool, abi: k2xPoolAbi, functionName: "requestDeposit", args: [amt, 0n, expiry] });
      setMsg({ text: "Deposit requested. It settles at the next trusted price.", tx: r.transactionHash });
      if (instance === "sandbox") {
        const res = await fetch("/api/sandbox/step", { method: "POST", body: JSON.stringify({ minutes: 1 }) }).catch(() => null);
        const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
        if (!res?.ok) {
          setMsg({
            text: `Deposit requested. ${body.error ?? "The sandbox market did not move yet"}; it settles when the market next moves.`,
            tx: r.transactionHash,
          });
        }
      }
      onDone();
    } catch (e) {
      setMsg({ text: (e as Error).message.split("\n")[0] });
    }
  }

  return (
    <section className="card mt-4 p-5">
      <h2 className="display font-semibold">Provide liquidity</h2>
      <p className="mt-1 text-sm text-ink-2">
        Deposits and withdrawals also settle at the next trusted price and only during market hours, so LPs cannot step
        out ahead of an overnight gap either.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="num w-40 rounded-md border border-rule bg-paper px-3 py-2"
          aria-label="deposit amount in AUSD"
        />
        <span className="text-sm text-ink-3">AUSD</span>
        {wallet ? (
          <button disabled={busy} onClick={deposit} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-sheet disabled:opacity-50">
            {busy ? "Waiting for Monad…" : "Request deposit"}
          </button>
        ) : (
          <button onClick={() => connectDemo()} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-sheet">
            Use demo wallet
          </button>
        )}
      </div>
      {msg && (
        <p className="mt-3 text-sm text-ink-2">
          {msg.text}{" "}
          {msg.tx && txUrl(msg.tx) && (
            <a className="underline" href={txUrl(msg.tx)} target="_blank" rel="noreferrer">
              view tx
            </a>
          )}
        </p>
      )}
    </section>
  );
}
