"use client";

import Link from "next/link";
import { SessionBand } from "@/components/SessionBand";
import { TokenCard } from "@/components/TokenCard";
import { VerdictTape } from "@/components/VerdictTape";
import { AUSD, CHAIN_ID, INCIDENT_ENGINE, INSTANCES, addressUrl } from "@/lib/config";
import { defaultInstance, useEngineClock, useSnapshot, useTape } from "@/lib/data";
import { useNow } from "@/lib/hooks";
import { sessionOf } from "@/lib/session";

export default function Home() {
  const instance = defaultInstance;
  const now = useNow();
  // while the Korean market is closed, show the sandbox replay instead of an empty tape. Decided by the
  // calendar, not by how many rows came back, so a failed RPC read cannot flip the panel.
  const live = instance === "live" && sessionOf(now) !== "CLOSED";
  const tapeInstance = live ? instance : "sandbox";
  const liveTape = useTape(instance, "hynix", 4000, 900n, live);
  const sandboxTape = useTape("sandbox", "hynix", 4000, 900n, !live);
  const { data: tape, error: tapeError } = live ? liveTape : sandboxTape;
  const { data: engineNow } = useEngineClock(tapeInstance);
  const { data: snap } = useSnapshot(tapeInstance, "hynix");

  return (
    <>
      <section className="grid gap-10 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div>
          <p className="eyebrow">Monad Metropolis · Track 1 · Onchain Finance & Trading</p>
          <h1 className="display mt-4 text-[2.6rem] font-bold leading-[1.02] sm:text-6xl">
            Every Korean print,
            <br />
            judged <span className="whitespace-nowrap">on-chain.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
            K-Mark reads SK hynix and Samsung trades from KRX and NXT and judges each one by Korean market rules:
            sessions, the ±30% daily limit, a warm-up after every open, and volume-confirmed jumps. Its verdicts live
            on Monad. <span className="text-ink">HYNIX2X</span> and <span className="text-ink">SMSN2X</span>, 2x tokens
            with no liquidation, settle only at prices it trusts.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/replay" className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-sheet">
              Replay the 7/28 one-share print
            </Link>
            <Link href="/trade" className="rounded-md border border-ink px-4 py-2.5 text-sm font-medium">
              Mint HYNIX2X
            </Link>
          </div>
          <p className="mt-6 text-xs text-ink-3">
            Korean convention: <span className="text-up">red rises</span>, <span className="text-down">blue falls</span>.
          </p>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="display text-base font-semibold">{live ? "Live verdicts · SK hynix" : "Sandbox verdicts · SK hynix"}</h2>
            <span className="eyebrow">{CHAIN_ID === 10143 ? "Monad testnet" : "local chain"}</span>
          </div>
          <SessionBand now={live ? now : engineNow || now} clockLabel={live ? "KST" : "Sandbox clock"} />
          <div className="mt-4">
            <VerdictTape rows={tape ?? []} reference={snap ? Number(snap.basePx) : undefined} limit={9} error={tapeError} />
          </div>
          {!live && (
            <p className="mt-3 border-t border-rule pt-3 text-xs text-ink-3">
              {instance === "live" ? "The Korean market is closed right now. " : ""}The sandbox replays the real KRX session
              of 2 Oct 2026 minute by minute, so you can mint at any hour.
            </p>
          )}
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-2">
        <TokenCard asset="hynix" instance={instance} />
        <TokenCard asset="smsn" instance={instance} />
      </section>

      <section className="mt-20">
        <h2 className="display text-2xl font-semibold">July 2026: the price layer failed twice</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Incident
            date="15 Jul"
            who="Ostium"
            what="An attacker holding oracle signer keys posted future-dated prices and opened and closed positions in one transaction."
            cost="$18–22M drained from the LP vault"
            fix="K-Mark rejects future-dated reports, never accepts a price outside the ±30% daily limit, and settles every mint or redeem at the next trusted price, never the current one."
          />
          <Incident
            date="28 Jul"
            who="trade.xyz SK hynix perp"
            what="At 08:00 KST one share printed at the lower limit on the NXT pre-market (−29.99%). The oracle passed it through; the mark fell 18.7%."
            cost="≈ $57M of longs liquidated"
            fix="K-Mark held the print, rejected it when the next trades did not confirm it, and followed the real −6% gap six seconds later, once 20 trades had confirmed it."
            href="/replay"
          />
        </div>
      </section>

      <section className="mt-20">
        <h2 className="display text-2xl font-semibold">How a mint settles</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            ["Request", "You send AUSD and a minimum amount. Nothing is priced yet."],
            ["Judge", "The relayer posts the next KRX or NXT trades. K-Mark accepts, holds or rejects them on-chain."],
            ["Settle", "Your mint fills at the first trusted price after your request — about two seconds in session."],
            ["Reset", "At the 15:30 closing auction the token resets to 2x. Outside hours, requests wait for the next session."],
          ].map(([t, d], i) => (
            <li key={t} className="card p-4">
              <span className="num text-xs text-ink-3">{i + 1}</span>
              <div className="display mt-1 font-semibold">{t}</div>
              <p className="mt-2 text-sm text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-20 border-t border-rule pt-6 text-xs text-ink-3">
        <div className="eyebrow mb-3">Contracts</div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {[
            ["Incident engine (replay clock)", INCIDENT_ENGINE],
            ["Sandbox engine", INSTANCES.sandbox?.engine],
            ["Live engine", INSTANCES.live?.engine],
            ["Mock AUSD", AUSD],
            ["HYNIX2X pool (live)", INSTANCES.live?.pools.hynix],
            ["SMSN2X pool (live)", INSTANCES.live?.pools.smsn],
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
          Testnet prototype. Quotes come from a public real-time feed for demonstration; not an offer to residents of Korea
          or the United States.
        </p>
      </footer>
    </>
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
      <p className="num mt-3 text-sm text-up">{p.cost}</p>
      <p className="mt-4 border-t border-rule pt-3 text-sm">{p.fix}</p>
      {p.href && (
        <Link href={p.href} className="mt-3 text-sm font-medium underline underline-offset-4">
          Watch the replay
        </Link>
      )}
    </article>
  );
}
