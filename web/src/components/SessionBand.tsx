import { kstClock, kstDate, SESSION_TEXT } from "@/lib/format";
import { BAND_END, BAND_START, SEGMENTS, isTradingDay, kstParts, nextOpen, sessionOf } from "@/lib/session";

const span = BAND_END - BAND_START;
const pos = (sod: number) => `${((sod - BAND_START) / span) * 100}%`;

const FILL: Record<string, string> = {
  NXT: "bg-[color-mix(in_oklab,var(--nxt)_30%,transparent)]",
  KRX: "bg-[color-mix(in_oklab,var(--krx)_26%,transparent)]",
  AUCTION:
    "bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--held)_35%,transparent)_0_3px,transparent_3px_6px)]",
};

/** The Korean trading day 08:00–20:00 KST, with a needle at `now`. */
export function SessionBand({ now, clockLabel = "KST" }: { now: number; clockLabel?: string }) {
  const { day, sod } = kstParts(now);
  const session = sessionOf(now);
  const open = isTradingDay(day) && sod >= BAND_START && sod < BAND_END;
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">{clockLabel}</span>
          <span className="num text-sm">{kstClock(now)}</span>
          <span className="text-xs text-ink-3">{kstDate(now)}</span>
        </div>
        <div className="text-xs text-ink-2">
          {session === "CLOSED" ? (
            <>
              Closed · next session <span className="num">{kstDate(nextOpen(now))} 08:00</span>
            </>
          ) : (
            SESSION_TEXT[session]
          )}
        </div>
      </div>
      <div className="relative h-5 overflow-hidden rounded-[3px] border border-rule bg-sheet">
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            title={`${s.label} ${kstClock(s.from - 9 * 3600, false)}–${kstClock(s.to - 9 * 3600, false)}`}
            className={`absolute inset-y-0 ${FILL[s.venue]} ${s.key === session ? "ring-2 ring-inset ring-up/60" : ""}`}
            style={{ left: pos(s.from), width: `${((s.to - s.from) / span) * 100}%` }}
          >
            {s.to - s.from > 3600 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-2">{s.label}</span>
            )}
          </div>
        ))}
        {open && (
          <div className="absolute inset-y-0 w-[2px] bg-up" style={{ left: pos(sod) }} aria-label="now" />
        )}
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-ink-3">
        {[8, 12, 15.5, 20].map((h) => (
          <span
            key={h}
            className={`num absolute ${h === 8 ? "" : h === 20 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: pos(h * 3600) }}
          >
            {h === 15.5 ? "15:30" : `${String(h).padStart(2, "0")}:00`}
          </span>
        ))}
      </div>
    </div>
  );
}
