"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/replay", label: "Replay 7/28" },
  { href: "/trade", label: "Mint & redeem" },
  { href: "/pool", label: "LP pool" },
  { href: "/engine", label: "Engine" },
  { href: "/simulator", label: "Risk simulator" },
];

export function Header() {
  const path = usePathname();
  return (
    <header className="border-b border-rule bg-sheet/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="display text-xl font-bold">K2X</span>
          <span className="eyebrow hidden sm:inline">K-Mark engine</span>
        </Link>
        <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 ${active ? "bg-tint font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

function WalletButton() {
  const { wallet, connectDemo, connectInjected, disconnect, fund } = useWallet();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string>();

  if (!wallet) {
    return (
      <div className="flex gap-2">
        <button onClick={() => connectDemo()} className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-sheet">
          Use demo wallet
        </button>
        <button
          onClick={() => connectInjected().catch((e) => alert(e.message))}
          className="rounded-md border border-rule px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
        >
          Browser wallet
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="num rounded-md border border-rule px-3 py-1.5 text-sm">
        {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        <span className="ml-2 text-xs text-ink-3">{wallet.kind === "demo" ? "demo" : "wallet"}</span>
      </button>
      {open && (
        <div className="card absolute right-0 z-20 mt-2 w-64 p-3 text-sm shadow-lg">
          <button
            className="w-full rounded-md bg-ink px-3 py-2 text-left font-medium text-sheet"
            onClick={async () => {
              setMsg("Sending test MON and 10,000 AUSD…");
              try {
                setMsg(await fund());
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
          >
            Get test MON + 10,000 AUSD
          </button>
          {msg && <p className="mt-2 text-xs text-ink-2">{msg}</p>}
          {wallet.kind === "demo" && (
            <p className="mt-2 text-xs text-ink-3">
              The demo wallet's key lives only in this browser. Testnet funds only.
            </p>
          )}
          <button className="mt-3 text-xs text-ink-2 underline" onClick={() => (disconnect(), setOpen(false))}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
