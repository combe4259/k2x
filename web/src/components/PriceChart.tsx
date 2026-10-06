import { kstClock, krw } from "@/lib/format";

export type Series = { points: [number, number][]; color: string; width?: number; dash?: string; step?: boolean; label: string };
export type Marker = { t: number; px: number; color: string; label?: string };

const W = 800;
const H = 260;
const PAD = { l: 64, r: 12, t: 12, b: 24 };

/** Minimal time/price chart. Prices on the right of the axis read as KRW. */
export function PriceChart({
  series,
  markers = [],
  xDomain,
  reference,
  cursor,
}: {
  series: Series[];
  markers?: Marker[];
  xDomain: [number, number];
  reference?: { px: number; label: string };
  cursor?: number;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p[1])).concat(markers.map((m) => m.px));
  if (reference) all.push(reference.px);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (!isFinite(lo) || !isFinite(hi)) return <div className="h-[260px]" />;
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  lo -= pad;
  hi += pad;
  const x = (t: number) => PAD.l + ((t - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = (s: Series) =>
    s.points
      .map(([t, p], i) => {
        if (i === 0) return `M${x(t)},${y(p)}`;
        return s.step ? `H${x(t)}V${y(p)}` : `L${x(t)},${y(p)}`;
      })
      .join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const tticks = [0, 0.5, 1].map((f) => xDomain[0] + f * (xDomain[1] - xDomain[0]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="price chart">
      {ticks.map((p) => (
        <g key={p}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--rule)" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(p) + 3} textAnchor="end" className="num" fontSize="10" fill="var(--ink-3)">
            {krw(Math.round(p / 1000) * 1000)}
          </text>
        </g>
      ))}
      {tticks.map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="num" fontSize="10" fill="var(--ink-3)">
          {kstClock(Math.round(t))}
        </text>
      ))}
      {reference && (
        <g>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(reference.px)}
            y2={y(reference.px)}
            stroke="var(--ink-3)"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <text x={W - PAD.r} y={y(reference.px) - 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
            {reference.label}
          </text>
        </g>
      )}
      {series.map((s) => (
        <path
          key={s.label}
          d={path(s)}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width ?? 1.5}
          strokeDasharray={s.dash}
          strokeLinejoin="round"
        />
      ))}
      {markers.map((m, i) => (
        <g key={i}>
          <circle cx={x(m.t)} cy={y(m.px)} r="4.5" fill="var(--sheet)" stroke={m.color} strokeWidth="2" />
          {m.label && (
            <text x={x(m.t) + 8} y={y(m.px) + 4} fontSize="11" fill={m.color}>
              {m.label}
            </text>
          )}
        </g>
      ))}
      {cursor !== undefined && (
        <line x1={x(cursor)} x2={x(cursor)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeOpacity="0.35" />
      )}
    </svg>
  );
}
