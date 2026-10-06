// Real-time KRX + NXT quotes from Naver Finance's public polling endpoint (no key, no delay).
// Used for the testnet demo; a licensed feed (e.g. a broker Open API or Pyth) replaces it in production.

export type VenueQuote = {
  price: number;
  cumVolume: number; // shares since the venue's session start
  cumValue: number; // KRW since the venue's session start (exact)
  status: string; // OPEN | CLOSE
  session: string; // regularMarket / PRE_MARKET / AFTER_MARKET ...
  tradedAt: number; // unix seconds of the last trade
};

export type Quote = {
  code: string;
  name: string;
  fetchedAt: number;
  krx: VenueQuote & { open: number; prevClose: number; halted: boolean };
  nxt: VenueQuote | null;
};

const URL = "https://polling.finance.naver.com/api/realtime/domestic/stock/";

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/,/g, ""));
  return NaN;
};

const ts = (v: unknown): number => (typeof v === "string" ? Math.floor(Date.parse(v) / 1000) : 0);

export async function fetchQuote(code: string, signal?: AbortSignal): Promise<Quote> {
  const res = await fetch(URL + code, {
    headers: { "User-Agent": "Mozilla/5.0 (K2X relayer)", Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`quote ${code}: HTTP ${res.status}`);
  const body = (await res.json()) as { datas?: Record<string, any>[] };
  const d = body.datas?.[0];
  if (!d) throw new Error(`quote ${code}: empty`);

  const price = num(d.closePriceRaw ?? d.closePrice);
  const change = num(d.compareToPreviousClosePriceRaw ?? d.compareToPreviousClosePrice);
  const krx = {
    price,
    open: num(d.openPriceRaw ?? d.openPrice),
    prevClose: price - change,
    cumVolume: num(d.accumulatedTradingVolumeRaw),
    cumValue: num(d.accumulatedTradingValueRaw),
    status: String(d.marketStatus ?? ""),
    session: String(d.marketSessionType ?? ""),
    halted: String(d.tradeStopType?.code ?? "1") !== "1",
    tradedAt: ts(d.localTradedAt),
  };

  const o = d.overMarketPriceInfo;
  const nxt: VenueQuote | null = o
    ? {
        price: num(o.overPrice),
        cumVolume: num(o.accumulatedTradingVolumeRaw),
        cumValue: num(o.accumulatedTradingValueRaw),
        status: String(o.overMarketStatus ?? ""),
        session: String(o.tradingSessionType ?? ""),
        tradedAt: ts(o.localTradedAt),
      }
    : null;

  return { code, name: String(d.stockName ?? code), fetchedAt: Math.floor(Date.now() / 1000), krx, nxt };
}
