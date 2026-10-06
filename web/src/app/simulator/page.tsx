"use client";

import { useMemo, useState } from "react";
import { dirClass, pct } from "@/lib/format";

type Path = { key: string; label: string; moves: number[]; note: string };

const PATHS: Path[] = [
  { key: "chop", label: "Up 10%, back down", moves: [0.1, -1 / 11], note: "The stock ends flat. The 2x token does not." },
  { key: "saw", label: "±5% for ten days", moves: Array.from({ length: 10 }, (_, i) => (i % 2 ? -0.05 : 0.05)), note: "Sideways markets cost leveraged tokens." },
  { key: "trend", label: "Up 5% five days running", moves: Array(5).fill(0.05), note: "Trends compound in the token's favour." },
  { key: "crash", label: "Down 8% three days running", moves: Array(3).fill(-0.08), note: "Daily resets cut exposure as it falls — no liquidation." },
];

/** NAV after a sequence of daily moves for a token that resets to `lev` each day. */
const dailyReset = (moves: number[], lev: number) => moves.reduce((nav, r) => nav * (1 + lev * r), 1);
const total = (moves: number[]) => moves.reduce((p, r) => p * (1 + r), 1) - 1;

export default function SimulatorPage() {
  const [pathKey, setPathKey] = useState("chop");
  const [gap, setGap] = useState(3.1);
  const path = PATHS.find((p) => p.key === pathKey)!;
  const stock = total(path.moves);
  const token = dailyReset(path.moves, 2) - 1;
  const naive2x = 2 * stock;

  const series = useMemo(() => {
    let s = 1;
    let t = 1;
    return [[1, 1], ...path.moves.map((r) => [(s *= 1 + r), (t *= 1 + 2 * r)])] as [number, number][];
  }, [path]);

  return (
    <div className="pt-10">
      <p className="eyebrow">Risk simulator · read this before you mint</p>
      <h1 className="display mt-2 text-4xl font-bold">What 2x really does</h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        HYNIX2X doubles each day&apos;s move, measured close to close. Over several days that is not the same as twice
        the total move. These paths are illustrations, not forecasts.
      </p>

      <section className="card mt-8 p-5">
        <div className="flex flex-wrap gap-2">
          {PATHS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPathKey(p.key)}
              className={`rounded-md border px-3 py-1.5 text-sm ${pathKey === p.key ? "border-ink bg-ink text-sheet" : "border-rule text-ink-2"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1.2fr]">
          <dl className="space-y-3">
            <Out label="The stock" v={stock} />
            <Out label="Twice the stock's total move" v={naive2x} muted />
            <Out label="HYNIX2X (daily reset)" v={token} big />
            <p className="border-t border-rule pt-3 text-sm text-ink-2">{path.note}</p>
          </dl>
          <MiniChart series={series} />
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="display font-semibold">Why not reset every block?</h2>
          <p className="mt-2 text-sm text-ink-2">
            A bad print that appears for one second and disappears does no harm to a token that resets once a day. A
            token that resets on every print locks it in.
          </p>
          <table className="mt-4 w-full text-sm">
            <tbody>
              <tr className="border-b border-rule">
                <td className="py-2 text-ink-2">−30% print, then back to normal</td>
                <td className="num py-2 text-right">stock 0%</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2">Reset on every print</td>
                <td className="num py-2 text-right text-down">{pct(0.4 * (1 + 2 * (1 / 0.7 - 1)) - 1, 1)}</td>
              </tr>
              <tr>
                <td className="py-2">Reset at the daily close (K2X)</td>
                <td className="num py-2 text-right">0.0%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <h2 className="display font-semibold">Why requests wait outside market hours</h2>
          <p className="mt-2 text-sm text-ink-2">
            If anyone could redeem at last night&apos;s price, whoever knows which way the morning will gap takes the pool&apos;s
            money. Drag the overnight gap:
          </p>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.1}
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
            className="mt-4 w-full accent-[var(--ink)]"
            aria-label="overnight gap"
          />
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-ink-2">Overnight gap {gap.toFixed(1)}%</span>
            <span className="num text-up">pool loses {(2 * gap).toFixed(1)}% of exposure per night</span>
          </div>
          <p className="mt-3 text-xs text-ink-3">
            SK hynix over the last year: average gap 3.1%, worst 5% of nights 8.6%. K2X settles off-hours requests at the
            next session&apos;s first trusted price, so this trade does not exist.
          </p>
        </div>
      </section>
    </div>
  );
}

function Out({ label, v, big, muted }: { label: string; v: number; big?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? "text-ink-3" : "text-ink-2"}>{label}</dt>
      <dd className={`num ${big ? "text-3xl" : "text-lg"} ${muted ? "text-ink-3" : dirClass(v)}`}>{pct(v, 1)}</dd>
    </div>
  );
}

function MiniChart({ series }: { series: [number, number][] }) {
  const W = 420;
  const H = 180;
  const vals = series.flat();
  const lo = Math.min(...vals) * 0.97;
  const hi = Math.max(...vals) * 1.03;
  const x = (i: number) => 20 + (i / (series.length - 1)) * (W - 40);
  const y = (v: number) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 30);
  const line = (k: 0 | 1) => series.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[k])}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="stock vs 2x token path">
      <line x1="20" x2={W - 20} y1={y(1)} y2={y(1)} stroke="var(--rule)" strokeDasharray="4 4" />
      <path d={line(0)} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" />
      <path d={line(1)} fill="none" stroke="var(--ink)" strokeWidth="2.5" />
      <text x={W - 20} y={H - 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
        grey: stock · ink: 2x token
      </text>
    </svg>
  );
}
