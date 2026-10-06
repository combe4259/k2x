"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { k2xPoolAbi, kmarkEngineAbi } from "@k2x/relayer";
import { SessionBand } from "@/components/SessionBand";
import { AssetSwitch, InstanceSwitch } from "@/components/Switches";
import { publicClient } from "@/lib/client";
import { ASSETS, AUSD, INSTANCES, txUrl, type AssetKey, type InstanceKey } from "@/lib/config";
import { defaultInstance, useEngineClock, useSnapshot } from "@/lib/data";
import { SESSION_TEXT, ausd6, dirClass, kstClock, kstDate, krw, pct, units18 } from "@/lib/format";
import { useNow, usePoll } from "@/lib/hooks";
import { nextOpen } from "@/lib/session";
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
  const { data: s, refresh } = useSnapshot(instance, asset, 2000);
  const clock = instance === "live" ? now : engineNow || now;
  const move = s && s.px > 0n ? Number(s.px) / Number(s.basePx) - 1 : 0;
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
              k="Trusted price now (P)"
              v={s && s.px > 0n ? `${krw(s.px)} KRW` : "waiting for the first trusted price"}
              cls={dirClass(move)}
            />
            <Line k="Move since the close" v={s && s.px > 0n ? pct(move) : "—"} cls={dirClass(move)} />
            <Line k="× 2 leverage" v={s && s.px > 0n ? pct(2 * move) : "—"} cls={dirClass(move)} />
            <Line k="Funding paid to LPs (this rate, a year)" v={s ? pct(-funding, 1) : "—"} />
            <div className="border-t border-rule pt-3">
              <Line k="NAV per token" v={s ? `${units18(s.nav, 4)} AUSD` : "—"} big />
            </div>
          </dl>
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
  const nav = s ? Number(s.nav) / 1e18 : 10;
  const n = Number(amount) || 0;
  const estimate = mode === "mint" ? (n * 0.999) / nav : n * nav * 0.999;
  const session = s?.sessionName ?? "CLOSED";
  const open = session === "NXT_PRE" || session === "CONTINUOUS" || session === "NXT_AFTER";

  async function submit() {
    if (!wallet) return;
    setMsg(undefined);
    try {
      const expiry = BigInt(clock + 7 * 86400);
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
        const minOut = parseUnits(((n * 0.999 * 0.97) / nav).toFixed(6), 18);
        setMsg({ text: "Sending mint request…" });
        const r = await write({ address: pool, abi: k2xPoolAbi, functionName: "requestMint", args: [amt, minOut, expiry] });
        setMsg({ text: "Requested. It settles at the next trusted price.", tx: r.transactionHash });
      } else {
        const amt = parseUnits(amount, 18);
        const minOut = parseUnits((n * nav * 0.999 * 0.97).toFixed(6), 6);
        setMsg({ text: "Sending redeem request…" });
        const r = await write({ address: pool, abi: k2xPoolAbi, functionName: "requestRedeem", args: [amt, minOut, expiry] });
        setMsg({ text: "Requested. It settles at the next trusted price.", tx: r.transactionHash });
      }
      if (instance === "sandbox") {
        setMsg((m) => ({ ...m!, text: "Requested. Moving the sandbox market one minute…" }));
        const res = await fetch("/api/sandbox/step", { method: "POST", body: JSON.stringify({ minutes: 1 }) });
        const body = await res.json();
        setMsg((m) => ({ ...m!, text: res.ok ? "Settled at the next trusted price." : body.error }));
      }
      onDone();
    } catch (e) {
      setMsg({ text: (e as Error).message.split("\n")[0], error: true });
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
        {mode === "mint" ? "Pay (AUSD)" : `Redeem (${ASSETS[asset].symbol})`}
      </label>
      <div className="mt-1 flex items-center rounded-md border border-rule bg-paper px-3 focus-within:border-ink">
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="num w-full bg-transparent py-2.5 text-xl outline-none"
        />
        <span className="text-sm text-ink-3">{mode === "mint" ? "AUSD" : ASSETS[asset].symbol}</span>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        ≈ <span className="num">{estimate.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>{" "}
        {mode === "mint" ? ASSETS[asset].symbol : "AUSD"} at today&apos;s NAV, after the 0.10% fee. The final amount uses
        the next trusted price.
      </p>
      {wallet && balances.data && (
        <p className="num mt-1 text-xs text-ink-3">
          Balance {ausd6(balances.data.ausd)} AUSD · {units18(balances.data.tok, 4)} {ASSETS[asset].symbol}
        </p>
      )}

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
              disabled={busy || n <= 0}
              onClick={submit}
              className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-sheet disabled:opacity-50"
            >
              {busy ? "Waiting for Monad…" : mode === "mint" ? "Request mint" : "Request redeem"}
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
          className="mt-4 text-xs text-ink-2 underline"
          onClick={async () => {
            const res = await fetch("/api/sandbox/step", { method: "POST", body: JSON.stringify({ minutes: 5 }) });
            const body = await res.json();
            setMsg({ text: res.ok ? `Sandbox moved to ${kstClock(body.virtualTime)}.` : body.error, error: !res.ok });
            onDone();
          }}
        >
          Move the sandbox market 5 minutes
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
      const ids = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "userRequests", args: [wallet.address] });
      const recent = [...ids].reverse().slice(0, 8);
      const reqs = await Promise.all(
        recent.map((id) => publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestOf", args: [id] })),
      );
      const market = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "market" });
      return Promise.all(
        reqs.map(async (r, i) => ({
          id: recent[i],
          r,
          px:
            r.settledSeq > 0n
              ? (await publicClient.readContract({ address: inst.engine, abi: kmarkEngineAbi, functionName: "priceAt", args: [market, r.settledSeq] })).px
              : 0n,
        })),
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
        {data.map(({ id, r, px }) => {
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
                  <span className="text-ink-3">Refunded — funds returned (cap, slippage or expiry)</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
