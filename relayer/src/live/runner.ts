// Live relayer: turns real-time quotes into K-Mark reports and keeps the LIVE pools settled.
//
// Posting policy (keeps testnet gas around a few MON a day):
//   - heartbeat: one window per venue every HEARTBEAT seconds while it trades
//   - fast follow: post at once when the price moved >= MOVE_BPS since the last trusted price
//   - confirmation: while the engine holds a jump or warm-up, post every FAST seconds
//   - users first: post as soon as a pool has a request waiting for its next price
//   - auctions: the 09:00 opening and 15:30 closing single-price prints (daily reset)

import type { Hex } from "viem";
import { k2xPoolAbi, kmarkEngineAbi } from "../abi.ts";
import { submitReports, type Clients } from "../engine.ts";
import { settlePending, syncPool } from "../keeper.ts";
import { Session, type EngineEvent } from "../types.ts";
import { fetchQuote, type Quote } from "./naver.ts";

export type QuoteSource = (code: string) => Promise<Quote>;

export type LiveDeployment = {
  chainId: number;
  liveEngine: Hex;
  hynixPool: Hex;
  smsnPool: Hex;
};

export type LiveMarket = { code: string; market: Hex; pool: Hex };

const VENUE_KRX = 1;
const VENUE_NXT = 2;
const KIND_CONT = 0;
const KIND_OPEN = 1;
const KIND_CLOSE = 2;

const HEARTBEAT = 540; // under the live engine's 600 s staleness, ~3 MON a day on testnet
const FAST = 10;
const MIN_GAP = 4;
const MOVE_BPS = 100;
const MAX_WINDOW = 600;

const PRE_START = 8 * 3600;
const OPEN_T = 9 * 3600;
const CONT_END = 15 * 3600 + 20 * 60;
const CLOSE_T = 15 * 3600 + 30 * 60;

type Window = {
  session: string; // engine session the window belongs to; a new session starts a new window
  start: number;
  baseVolume: number;
  baseValue: number;
  first: number;
  last: number;
  high: number;
  low: number;
};

type VenueState = { window: Window | null; lastPostAt: number; lastDecision: string };

type MarketState = {
  krx: VenueState;
  nxt: VenueState;
  openPostedDay: number;
  closePostedDay: number;
  volumeAtContEnd: number;
  lastTrustedPx: number;
};

export type LiveLog = (msg: string) => void;

export class LiveRelayer {
  private state = new Map<string, MarketState>();

  constructor(
    private clients: Clients,
    private engine: Hex,
    private markets: LiveMarket[],
    private log: LiveLog = console.log,
    private source: QuoteSource = fetchQuote,
  ) {
    for (const m of markets) {
      this.state.set(m.code, {
        krx: { window: null, lastPostAt: 0, lastDecision: "" },
        nxt: { window: null, lastPostAt: 0, lastDecision: "" },
        openPostedDay: 0,
        closePostedDay: 0,
        volumeAtContEnd: 0,
        lastTrustedPx: 0,
      });
    }
  }

  /** One polling cycle for every market. */
  async tick(): Promise<void> {
    const { publicClient } = this.clients;
    const block = await publicClient.getBlock();
    const now = Number(block.timestamp) - 1; // never ahead of the chain clock
    const [sessionIdx, day, sod] = await publicClient.readContract({
      address: this.engine,
      abi: kmarkEngineAbi,
      functionName: "sessionAt",
      args: [BigInt(now)],
    });
    const session = Session[sessionIdx];
    if (session === "CLOSED" && Number(sod) > 20 * 3600 + 600) return;

    for (const m of this.markets) {
      try {
        const q = await this.source(m.code);
        await this.tickMarket(m, q, now, session, Number(day), Number(sod));
      } catch (err) {
        this.log(`[${m.code}] ${(err as Error).message}`);
      }
    }
  }

  private async tickMarket(m: LiveMarket, q: Quote, now: number, session: string, day: number, sod: number) {
    const st = this.state.get(m.code)!;
    const latest = await this.clients.publicClient.readContract({
      address: this.engine,
      abi: kmarkEngineAbi,
      functionName: "latest",
      args: [m.market],
    });
    st.lastTrustedPx = Number(latest[0]);
    const { waiting, ready } = await this.requests(m.pool, latest[2]);
    if (ready) {
      const settled = await settlePending(this.clients, m.pool);
      if (settled.length) this.log(`[${m.code}] settled requests ${settled.join(", ")}`);
    }

    // 09:00 opening single-price auction
    if (session === "CONTINUOUS" && st.openPostedDay !== day && sod >= OPEN_T && sod < OPEN_T + 300) {
      if (q.krx.status === "OPEN" && q.krx.cumVolume > 0 && q.krx.open > 0) {
        await this.post(m, st.krx, VENUE_KRX, KIND_OPEN, now, {
          volume: q.krx.cumVolume,
          value: q.krx.cumValue,
          first: q.krx.open,
          last: q.krx.open,
          high: q.krx.open,
          low: q.krx.open,
          start: now - 1,
        });
        st.openPostedDay = day;
        st.krx.window = this.freshWindow(now, q.krx.cumVolume, q.krx.cumValue, q.krx.price, `${day}:${session}`);
      }
      return;
    }

    // remember KRX volume when continuous trading stops at 15:20 (the closing auction adds to it)
    if (sod >= CONT_END && sod < CLOSE_T && st.volumeAtContEnd === 0) st.volumeAtContEnd = q.krx.cumVolume;

    // 15:30 closing single-price auction → official close → daily reset
    if (st.closePostedDay !== day && sod >= CLOSE_T && sod < CLOSE_T + 300 && q.krx.status === "CLOSE") {
      const auctionVolume = Math.max(1, q.krx.cumVolume - (st.volumeAtContEnd || q.krx.cumVolume));
      await this.post(m, st.krx, VENUE_KRX, KIND_CLOSE, now, {
        volume: auctionVolume,
        value: auctionVolume * q.krx.price,
        first: q.krx.price,
        last: q.krx.price,
        high: q.krx.price,
        low: q.krx.price,
        start: now - 1,
      });
      st.closePostedDay = day;
      st.volumeAtContEnd = 0;
      await syncPool(this.clients, m.pool);
      return;
    }

    if (session === "CONTINUOUS" && sod >= OPEN_T && sod < CONT_END) {
      await this.continuous(m, st.krx, VENUE_KRX, now, q.krx, waiting, `${day}:${session}`, sod - OPEN_T);
    } else if ((session === "NXT_PRE" || session === "NXT_AFTER") && q.nxt) {
      const sessionStart = session === "NXT_PRE" ? PRE_START : CLOSE_T;
      await this.continuous(m, st.nxt, VENUE_NXT, now, q.nxt, waiting, `${day}:${session}`, sod - sessionStart);
    }
  }

  private freshWindow(now: number, volume: number, value: number, px: number, session = ""): Window {
    return { session, start: now, baseVolume: volume, baseValue: value, first: px, last: px, high: px, low: px };
  }

  private async continuous(
    m: LiveMarket,
    v: VenueState,
    venue: number,
    now: number,
    q: { price: number; cumVolume: number; cumValue: number },
    waiting: boolean,
    sessionKey: string,
    sinceSessionStart: number,
  ) {
    if (!(q.price > 0)) return;
    // new session, or the venue's cumulative counters were reset: start a new window
    if (!v.window || v.window.session !== sessionKey || q.cumVolume < v.window.baseVolume) {
      if (sinceSessionStart < 60) {
        // the session just opened: counters start at zero, so the very first prints are kept
        v.window = this.freshWindow(now - sinceSessionStart, 0, 0, q.price, sessionKey);
      } else {
        v.window = this.freshWindow(now, q.cumVolume, q.cumValue, q.price, sessionKey);
        return;
      }
    }
    const w = v.window;
    w.last = q.price;
    w.high = Math.max(w.high, q.price);
    w.low = Math.min(w.low, q.price);
    const volume = q.cumVolume - w.baseVolume;
    if (volume <= 0) return;

    const since = now - v.lastPostAt;
    const ref = this.lastTrusted(m) || q.price;
    const moved = Math.abs(q.price - ref) * 10_000 >= MOVE_BPS * ref;
    const confirming = v.lastDecision === "JUMP_PENDING" || v.lastDecision === "WARMUP";
    const due =
      since >= HEARTBEAT || (since >= MIN_GAP && (moved || waiting)) || (since >= FAST && confirming);
    if (!due) return;

    await this.post(m, v, venue, KIND_CONT, now, {
      volume,
      value: q.cumValue - w.baseValue,
      first: w.first,
      last: w.last,
      high: w.high,
      low: w.low,
      start: Math.max(w.start, now - MAX_WINDOW),
    });
    v.window = this.freshWindow(now, q.cumVolume, q.cumValue, q.price, sessionKey);
  }

  private lastTrusted(m: LiveMarket): number {
    return this.state.get(m.code)!.lastTrustedPx;
  }

  private async post(
    m: LiveMarket,
    v: VenueState,
    venue: number,
    kind: number,
    now: number,
    a: { volume: number; value: number; first: number; last: number; high: number; low: number; start: number },
  ) {
    const volume = Math.max(1, Math.round(a.volume));
    const value = Math.max(a.value, volume * a.low);
    const vwap = Math.round(value / volume);
    const report = {
      market: m.market,
      venue,
      kind,
      windowStart: BigInt(Math.min(a.start, now - 1)),
      windowEnd: BigInt(now),
      trades: Math.max(1, Math.round(volume / 20)),
      volume: BigInt(volume),
      notional: BigInt(Math.round(value)),
      firstPx: BigInt(a.first),
      lastPx: BigInt(a.last),
      highPx: BigInt(Math.max(a.high, vwap)),
      lowPx: BigInt(Math.min(a.low, vwap)),
      vwapPx: BigInt(vwap),
      flags: 0,
    } as const;
    const { events } = await submitReports(this.clients, this.engine, [report]);
    v.lastPostAt = now;
    v.lastDecision = this.summarize(m, events);
    if (events.some((e) => e.type === "accepted")) {
      const settled = await settlePending(this.clients, m.pool);
      if (settled.length) this.log(`[${m.code}] settled requests ${settled.join(", ")}`);
    }
  }

  private summarize(m: LiveMarket, events: EngineEvent[]): string {
    for (const e of events) {
      if (e.type === "accepted") {
        this.log(`[${m.code}] ✓ ${e.px.toLocaleString()} KRW (seq ${e.seq})`);
        return "ACCEPTED";
      }
      if (e.type === "held" || e.type === "rejected") {
        this.log(`[${m.code}] ${e.type} ${e.reason} ${e.px.toLocaleString()} KRW`);
        if (e.type === "held") return e.reason;
      }
    }
    return "";
  }

  /** waiting: a request needs the next price; ready: a request can be settled right now. */
  private async requests(pool: Hex, priceSeq: bigint): Promise<{ waiting: boolean; ready: boolean }> {
    const { publicClient } = this.clients;
    const count = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestCount" });
    if (count === 0n) return { waiting: false, ready: false };
    const from = count > 100n ? count - 100n : 0n;
    const ids = await publicClient.readContract({
      address: pool,
      abi: k2xPoolAbi,
      functionName: "pendingIds",
      args: [from, count - from],
    });
    let waiting = false;
    let ready = false;
    for (const id of ids) {
      const r = await publicClient.readContract({ address: pool, abi: k2xPoolAbi, functionName: "requestOf", args: [id] });
      if (r.seq >= priceSeq) waiting = true;
      else ready = true;
    }
    return { waiting, ready };
  }
}
