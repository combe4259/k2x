"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DEMO_STEPS, useMode } from "@/lib/mode";
import { useWallet } from "@/lib/wallet";

/** The four-step guided demo, pinned under the status strip while it runs. Works at any hour. */
export function DemoGuide() {
  const { demo, setDemo, completeDemo } = useMode();
  const { startDemo } = useWallet();
  const path = usePathname();
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>();
  const [working, setWorking] = useState(false);
  if (demo === null) return null;

  if (demo >= DEMO_STEPS.length) {
    return (
      <Bar>
        <span className="font-medium">Demo complete.</span>
        <span className="text-ink-2">
          You watched a bad print get rejected, minted at a price set after you asked, and saw the pool that pays you.
        </span>
        <button onClick={() => setDemo(null)} className="ml-auto rounded-md border border-rule px-3 py-1 text-ink-2 hover:text-ink">
          Close
        </button>
      </Bar>
    );
  }

  const step = DEMO_STEPS[demo];
  const here = step.href !== null && path.startsWith(step.href);
  async function fund() {
    setWorking(true);
    setMsg({ text: "Creating your test wallet and sending test money…" });
    try {
      setMsg({ text: await startDemo() });
      completeDemo("fund");
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setWorking(false);
    }
  }

  return (
    <Bar>
      <span className="num shrink-0 rounded bg-ink px-1.5 py-0.5 text-[11px] text-sheet">
        Demo {demo + 1}/{DEMO_STEPS.length}
      </span>
      <span className="font-medium">{step.title}</span>
      <span className="min-w-0 basis-full text-ink-2 sm:basis-0 sm:flex-1">{msg?.text ? <span className={msg.error ? "text-up" : ""}>{msg.text}</span> : step.hint}</span>
      <span className="flex shrink-0 items-center gap-2">
        {step.key === "fund" ? (
          <button disabled={working} onClick={fund} className="rounded-md bg-ink px-3 py-1 font-medium text-sheet disabled:opacity-50">
            {working ? "Sending…" : "Get test money"}
          </button>
        ) : !here && step.href ? (
          <Link href={step.href} className="rounded-md bg-ink px-3 py-1 font-medium text-sheet">
            Go to step {demo + 1}
          </Link>
        ) : null}
        <button onClick={() => (setMsg(undefined), setDemo(demo + 1))} className="rounded-md border border-rule px-3 py-1 text-ink-2 hover:text-ink">
          {step.key === "fund" ? "Skip" : "Next"}
        </button>
        <button onClick={() => setDemo(null)} className="px-1 text-ink-3 hover:text-ink" aria-label="Exit the demo">
          Exit
        </button>
      </span>
    </Bar>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-ink/15 bg-sheet">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm">{children}</div>
    </div>
  );
}
