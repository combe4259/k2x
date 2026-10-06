import { formatUnits } from "viem";

export const krw = (n: number | bigint) => Number(n).toLocaleString("en-US");

export const pct = (x: number, digits = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;

export const ausd6 = (v: bigint, digits = 2) =>
  Number(formatUnits(v, 6)).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const units18 = (v: bigint, digits = 4) =>
  Number(formatUnits(v, 18)).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const usd18 = (v: bigint, digits = 0) =>
  Number(formatUnits(v, 18)).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const KST = 9 * 3600;

export function kstClock(unix: number, withSeconds = true) {
  const d = new Date((unix + KST) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

export function kstDate(unix: number) {
  const d = new Date((unix + KST) * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export const dirClass = (x: number) => (x > 0 ? "text-up" : x < 0 ? "text-down" : "text-ink-2");

export const VENUE = ["", "KRX", "NXT"] as const;
export const KIND = ["", "open auction", "close auction", "VI auction"] as const;

/** What each engine reason means, in the words a trader would use. */
export const REASON_TEXT: Record<string, string> = {
  NONE: "Trusted",
  WARMUP: "Session just opened — waiting for ₩100M and 20 trades before trusting it",
  JUMP_PENDING: "Large move — waiting for volume at the new level to confirm it",
  JUMP_UNCONFIRMED: "Large move the following trades did not confirm",
  SESSION: "This venue is not trading at this time",
  BAND: "Outside the ±30% daily price limit",
  VI_HOLD: "Volatility interruption — price frozen",
  HALT: "Trading halt",
  THIN_AUCTION: "Auction too thin to trust",
  STALE_SEQUENCE: "Out-of-order report",
  FUTURE_TIMESTAMP: "Report dated in the future",
  TOO_OLD: "Report arrived too late",
  NO_BASE: "No reference close yet",
  MALFORMED: "Inconsistent report — prices outside its own low–high, or an auction with more than one price",
  AUCTION_DONE: "Today's auction price is already set",
};

export const SESSION_TEXT: Record<string, string> = {
  CLOSED: "Closed",
  NXT_PRE: "NXT pre-market",
  AUCTION_WAIT: "KRX opening auction",
  CONTINUOUS: "KRX regular session",
  CLOSE_AUCTION: "KRX closing auction",
  NXT_AFTER: "NXT after-market",
};
