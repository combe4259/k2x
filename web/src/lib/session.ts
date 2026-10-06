// Client-side mirror of the engine calendar, for drawing the session band.

export const KST = 9 * 3600;
export const HOLIDAYS = new Set([20735, 20812, 20818, 20819]); // 10/9, 12/25, 12/31, 1/1

export type Segment = { key: string; label: string; from: number; to: number; venue: "NXT" | "KRX" | "AUCTION" };

/** Seconds of the KST day. */
export const SEGMENTS: Segment[] = [
  { key: "NXT_PRE", label: "NXT pre", from: 8 * 3600, to: 8 * 3600 + 50 * 60, venue: "NXT" },
  { key: "AUCTION_WAIT", label: "open auction", from: 8 * 3600 + 50 * 60, to: 9 * 3600, venue: "AUCTION" },
  { key: "CONTINUOUS", label: "KRX + NXT regular", from: 9 * 3600, to: 15 * 3600 + 20 * 60, venue: "KRX" },
  { key: "CLOSE_AUCTION", label: "close", from: 15 * 3600 + 20 * 60, to: 15 * 3600 + 30 * 60, venue: "AUCTION" },
  { key: "NXT_AFTER", label: "NXT after", from: 15 * 3600 + 30 * 60, to: 20 * 3600, venue: "NXT" },
];

export const BAND_START = 8 * 3600;
export const BAND_END = 20 * 3600;

export function kstParts(unix: number) {
  const day = Math.floor((unix + KST) / 86_400);
  const sod = (unix + KST) % 86_400;
  return { day, sod, weekday: (day + 3) % 7 };
}

export function isTradingDay(day: number) {
  return (day + 3) % 7 < 5 && !HOLIDAYS.has(day);
}

export function sessionOf(unix: number): string {
  const { day, sod } = kstParts(unix);
  if (!isTradingDay(day)) return "CLOSED";
  return SEGMENTS.find((s) => sod >= s.from && sod < s.to)?.key ?? "CLOSED";
}

/** Unix time of the next NXT pre-market open (08:00 KST on the next trading day). */
export function nextOpen(unix: number): number {
  const { day, sod } = kstParts(unix);
  let d = sod < 8 * 3600 && isTradingDay(day) ? day : day + 1;
  while (!isTradingDay(d)) d++;
  return d * 86_400 - KST + 8 * 3600;
}
