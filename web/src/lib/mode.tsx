"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { INSTANCES, type InstanceKey } from "./config";
import { sessionOf } from "./session";

/**
 * Which copy of the contracts the site shows. Both run the same code on Monad testnet:
 *   replay — a separate engine replaying the real 2 Oct KRX session minute by minute, so it works at any hour
 *   live   — real SK hynix and Samsung trades, 08:00–20:00 KST on weekdays
 * The default follows the Korean clock; a choice made here lasts for the visit.
 */
export type Mode = "replay" | "live";

export const MODE_LABEL: Record<Mode, string> = { replay: "Replay day", live: "Live Korea" };

const DEMO_KEY = "k2x.demo";
export const DEMO_STEPS = [
  { key: "watch", title: "Watch the bad print get rejected", href: "/replay", hint: "Press Play. At 08:00:01 one share prints 30% down; K-Mark holds it, then rejects it." },
  { key: "fund", title: "Get test money", href: null, hint: "Creates a test wallet in this browser with test MON for gas and 10,000 test AUSD. They have no value." },
  { key: "mint", title: "Mint HYNIX2X on the replay day", href: "/trade", hint: "Request a mint. It fills at the first price set after you ask, not the one on screen." },
  { key: "pool", title: "See who is on the other side", href: "/pool", hint: "LPs take the other side. See what your mint added and what a limit-up day would cost them." },
] as const;

type Ctx = {
  mode: Mode;
  instance: InstanceKey;
  koreaOpen: boolean;
  setMode: (m: Mode) => void;
  /** current guided-demo step (0-based), or null when the demo is not running */
  demo: number | null;
  setDemo: (step: number | null) => void;
  /** mark a demo step done; moves on only if it is the current step */
  completeDemo: (key: (typeof DEMO_STEPS)[number]["key"]) => void;
};

const ModeCtx = createContext<Ctx | null>(null);

const koreaOpenNow = () => sessionOf(Math.floor(Date.now() / 1000)) !== "CLOSED";

export function ModeProvider({ children }: { children: ReactNode }) {
  const [koreaOpen, setKoreaOpen] = useState(false);
  const [picked, setPicked] = useState<Mode | null>(null);
  const [demo, setDemoState] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setKoreaOpen(koreaOpenNow());
    tick();
    const t = setInterval(tick, 30_000);
    const q = new URLSearchParams(window.location.search).get("mode");
    if (q === "replay" || q === "live") setPicked(q);
    try {
      const d = localStorage.getItem(DEMO_KEY);
      if (d !== null) setDemoState(Number(d));
    } catch {}
    return () => clearInterval(t);
  }, []);

  const setDemo = useCallback((step: number | null) => {
    setDemoState(step);
    try {
      if (step === null) localStorage.removeItem(DEMO_KEY);
      else localStorage.setItem(DEMO_KEY, String(step));
    } catch {}
  }, []);

  const completeDemo = useCallback<Ctx["completeDemo"]>(
    (key) => {
      const i = DEMO_STEPS.findIndex((s) => s.key === key);
      if (demo === i) setDemo(i + 1);
    },
    [demo, setDemo],
  );

  // the guided demo always runs on the replay day, so it works at any hour
  const auto: Mode = koreaOpen && INSTANCES.live ? "live" : "replay";
  const mode: Mode = picked ?? (demo !== null && demo < DEMO_STEPS.length ? "replay" : auto);
  const instance: InstanceKey = mode === "live" && INSTANCES.live ? "live" : "sandbox";

  return (
    <ModeCtx.Provider value={{ mode, instance, koreaOpen, setMode: setPicked, demo, setDemo, completeDemo }}>
      {children}
    </ModeCtx.Provider>
  );
}

export function useMode() {
  const ctx = useContext(ModeCtx);
  if (!ctx) throw new Error("useMode outside ModeProvider");
  return ctx;
}
