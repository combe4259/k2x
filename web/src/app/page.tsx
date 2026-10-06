"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MiniReplay } from "@/components/MiniReplay";
import { TokenCard } from "@/components/TokenCard";
import { AUSD, CHAIN_ID, INCIDENT_ENGINE, INSTANCES, addressUrl, txUrl } from "@/lib/config";
import { useMode } from "@/lib/mode";
import proof from "@/generated/proof.json";

type ProofRow = { what: string; result: string; tx: string; block: number; note?: string };

export default function Home() {
  const { instance, mode, setDemo } = useMode();
  const router = useRouter();
  const rows = (proof as { rows: ProofRow[] }).rows;

  return (
    <>
      <section className="grid items-start gap-10 pt-10 lg:grid-cols-[1fr_1.05fr] lg:pt-14">
        <div>
          <p className="eyebrow">SK hynix · Samsung Electronics · 2x · Monad testnet</p>
          <h1 className="display mt-4 text-[2.5rem] font-bold leading-[1.02] sm:text-[3.4rem]">
            2x SK hynix and Samsung, with no liquidations.
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Mint and redeem settle at the next price a contract on Monad accepts under Korean market rules. On 28 July one
            SK hynix share traded 30% down before the open, an oracle passed it through, and about $57M of longs were
            liquidated. K2X refuses that trade as a price.
          </p>
          <ol className="mt-7 space-y-4">
            {[
              ["You are never liquidated.", "The token resets to 2x once a day at the KRX close, and Korea's ±30% daily limit keeps it above zero within a day."],
              ["Nobody picks your price.", "A request fills at the first trusted price set after it, not the one on screen when you ask."],
              ["Off-hours requests wait.", "Sent while Korea is closed, they settle at the next session's first trusted price, so last night's price can't be traded against the pool."],
            ].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[2rem_1fr] gap-x-2">
                <span className="num pt-0.5 text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <p className="text-[15px] leading-relaxed">
                  <span className="font-semibold">{t}</span> <span className="text-ink-2">{d}</span>
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => (setDemo(0), router.push("/replay"))}
              className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-sheet"
            >
              Start the 4-step demo
            </button>
            <Link href="/trade" className="rounded-md border border-ink px-4 py-2.5 text-sm font-medium">
              Mint HYNIX2X
            </Link>
          </div>
          <p className="mt-3 text-xs text-ink-3">The demo works at any hour. No wallet needed; test money has no value.</p>
        </div>

        <MiniReplay />
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display text-2xl font-semibold">The tokens</h2>
          <p className="text-sm text-ink-2">
            {mode === "replay"
              ? "Showing the replay day: the real 2 Oct KRX session, replayed minute by minute on its own copy of the contracts."
              : "Showing live Korea: real KRX and NXT trades, judged as they happen."}
          </p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TokenCard asset="hynix" instance={instance} />
          <TokenCard asset="smsn" instance={instance} />
        </div>
      </section>

      <section className="mt-16">
        <h2 className="display text-2xl font-semibold">How a request settles</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            ["You ask", "Send AUSD to mint, or tokens to redeem, with the least you'll accept. Nothing is priced yet."],
            ["Trades are judged", "A relayer reports KRX and NXT trades. The contract marks each one trusted, held or rejected, and records why."],
            ["You get the next price", "Your request fills at the first trusted price formed entirely after it. In session that is seconds away."],
            ["Daily reset", "At the 15:30 closing auction the token resets to 2x. Requests sent while Korea is closed wait for the next session."],
          ].map(([t, d], i) => (
            <li key={t} className="card p-4">
              <span className="num text-xs text-ink-3">{i + 1}</span>
              <div className="display mt-1 font-semibold">{t}</div>
              <p className="mt-2 text-sm text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16">
        <h2 className="display text-2xl font-semibold">July 2026: the price layer failed twice</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Incident
            date="15 Jul"
            who="Ostium"
            what="An attacker holding oracle signer keys posted future-dated prices and opened and closed positions in one transaction."
            cost="$18–22M drained from the LP vault"
            fix="K-Mark refuses reports dated in the future, never accepts a price outside the ±30% daily limit, and settles every request at a price formed after it."
          />
          <Incident
            date="28 Jul"
            who="trade.xyz SK hynix perp"
            what="At 08:00 KST one share printed at the lower limit on the NXT pre-market (−29.99%). The oracle passed it through; the mark fell 18.7%."
            cost="≈ $57M of longs liquidated"
            fix="K-Mark held the print, rejected it when the next trades did not confirm it, and trusted the real −6% gap six seconds later, once ₩300M and 20 trades confirmed it."
            href="/replay"
          />
        </div>
      </section>

      {rows.length > 0 && (
        <section className="mt-16">
          <h2 className="display text-2xl font-semibold">What the contracts refused, on Monad testnet</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-2">
            Each row is a transaction anyone can open. The refusals were sent on purpose, including one signed by the live relayer
            key itself, to show what even a compromised relayer cannot do.
          </p>
          <div className="card mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs text-ink-3">
                  <th className="px-4 py-2.5 font-normal">What happened</th>
                  <th className="px-4 py-2.5 font-normal">What the chain did</th>
                  <th className="px-4 py-2.5 font-normal">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((r) => (
                  <tr key={r.tx + r.what}>
                    <td className="px-4 py-3">
                      {r.what}
                      {r.note && <span className="block text-xs text-ink-3">{r.note}</span>}
                    </td>
                    <td className="num px-4 py-3 text-xs">
                      <ResultTag text={r.result} />
                    </td>
                    <td className="num px-4 py-3 text-xs">
                      {txUrl(r.tx) ? (
                        <a className="underline underline-offset-2" href={txUrl(r.tx)} target="_blank" rel="noreferrer">
                          {r.tx.slice(0, 10)}…
                        </a>
                      ) : (
                        `${r.tx.slice(0, 10)}…`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-16 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="display text-2xl font-semibold">Why Monad</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            K-Mark judges every trade window in its own transaction and writes the reason on chain, so the price your request
            settles at can be checked by anyone. That only works as a live price if judging keeps pace with the market. On Monad
            testnet a judgement costs about 150k gas and blocks arrive every 0.31 s on average (measured over 2,000 blocks); the
            28 July pre-market took 42 transactions, one per second around the open. We don&apos;t claim this is impossible elsewhere, only
            that it is practical here.
          </p>
        </div>
        <div>
          <h2 className="display text-2xl font-semibold">What we don&apos;t claim</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
            <li>No users, LPs or partners. The pools are seeded by the team with mock AUSD, which has no value.</li>
            <li>No audit. Tests and internal review only.</li>
            <li>
              No claim that holders can&apos;t lose. A 2x token can lose about 60% in a day and more over several days. No
              liquidation means no forced close, not no loss.
            </li>
            <li>The 7/28 replay is not trade.xyz&apos;s feed: the 1-share print, previous close and KRX open are observed; the trades between them are reconstructed.</li>
            <li>The replay day uses Yahoo Finance 1-minute bars; volumes and trade counts are estimates.</li>
            <li>One relayer key reports trades from a public quote feed. K-Mark limits what a bad report can do but does not verify the source.</li>
            <li>The pool is not hedged, so it is only safe at small size.</li>
            <li>Testnet only. Not an offer to residents of Korea or the United States.</li>
          </ul>
        </div>
      </section>

      <footer className="mt-20 border-t border-rule pt-6 text-xs text-ink-3">
        <div className="eyebrow mb-3">Contracts on {CHAIN_ID === 10143 ? "Monad testnet" : "a local chain"}</div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {[
            ["Live engine", INSTANCES.live?.engine],
            ["Replay-day engine", INSTANCES.sandbox?.engine],
            ["HYNIX2X pool (live)", INSTANCES.live?.pools.hynix],
            ["SMSN2X pool (live)", INSTANCES.live?.pools.smsn],
            ["Incident replay engine", INCIDENT_ENGINE],
            ["Mock AUSD", AUSD],
          ]
            .filter(([, a]) => a)
            .map(([label, a]) => (
              <li key={label} className="flex justify-between gap-3">
                <span>{label}</span>
                <a className="num truncate hover:underline" href={addressUrl(a as string)} target="_blank" rel="noreferrer">
                  {a}
                </a>
              </li>
            ))}
        </ul>
        <p className="mt-6">
          Source: <a className="underline" href="https://github.com/combe4259/k2x">github.com/combe4259/k2x</a> · Korean colour
          convention: red rises, blue falls.
        </p>
      </footer>
    </>
  );
}

function ResultTag({ text }: { text: string }) {
  const [head, ...rest] = text.split(" · ");
  const cls =
    head === "REJECTED" ? "text-rejected border-rejected" : head === "SETTLED" ? "text-accepted border-accepted" : "text-held border-held";
  return (
    <span>
      <span className={`mr-2 inline-block rounded-[3px] border px-1.5 py-[2px] text-[10px] font-semibold tracking-[0.08em] ${cls}`}>{head}</span>
      {rest.join(" · ")}
    </span>
  );
}

function Incident(p: { date: string; who: string; what: string; cost: string; fix: string; href?: string }) {
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-baseline justify-between">
        <span className="display text-lg font-semibold">{p.who}</span>
        <span className="num text-xs text-ink-3">{p.date}</span>
      </div>
      <p className="mt-3 text-sm text-ink-2">{p.what}</p>
      <p className="num mt-3 text-sm font-medium">{p.cost}</p>
      <p className="mt-4 border-t border-rule pt-3 text-sm">{p.fix}</p>
      {p.href && (
        <Link href={p.href} className="mt-3 text-sm font-medium underline underline-offset-4">
          Step through the replay
        </Link>
      )}
    </article>
  );
}
