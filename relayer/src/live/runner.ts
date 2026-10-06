// Live relayer: turns real-time quotes into K-Mark reports and keeps the LIVE pools settled.
//
// Posting policy (keeps testnet gas around a few MON a day):
//   - heartbeat: one window per venue every HEARTBEAT seconds while it trades
//   - fast follow: post at once when the price moved >= MOVE_BPS since the last trusted price
//   - confirmation: while the engine holds a jump or warm-up, post every FAST seconds
//   - users first: when a request arrives the window restarts at the request, so the price it
//     settles at holds only trades made after it, and is posted MIN_GAP seconds later
//   - auctions: the 09:00 opening and 15:30 closing single-price prints, stamped at match time
//
// A report counts as posted only when the engine judged it; if it was refused for timing (too old,
// out of order, future) the window is kept and posted again. Settlement never blocks posting.

import type { Hex } from "viem";
import { kmarkEngineAbi } from "../abi.ts";
import { submitReports, type Clients } from "../engine.ts";
import { queueState, settleQueue, syncPool } from "../keeper.ts";
import { Session, type EngineEvent } from "../types.ts";
import { fetchQuote, type Quote, type VenueQuote } from "./naver.ts";

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
const AUCTION_POST_LIMIT = 50; // the live engine refuses reports older than 60 s
const CLOSE_RETRY = 20;

const PRE_START = 8 * 3600;
const OPEN_T = 9 * 3600;
const CONT_END = 15 * 3600 + 20 * 60;
const CLOSE_T = 15 * 3600 + 30 * 60;
const CLOSE_GRACE = 300;

/** Refusals about timing, not about the price: keep the window and post it again. */
const RETRY = new Set(["TOO_OLD", "STALE_SEQUENCE", "FUTURE_TIMESTAMP"]);

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
  contEnd: { day: number; volume: number } | null; // KRX counters when continuous trading stopped
  nxtPause: { day: number; volume: number; value: number } | null; // NXT counters during its 15:20 pause
  closeTriedAt: number;
  lastTrustedPx: number;
};

type Outcome = "accepted" | "held" | "rejected" | "retry";

export type LiveLog = (msg: string) => void;

export class LiveRelayer {
  private state = new Map<string, MarketState>();

  constructor(
    private clients: Clients,
    private engine: Hex,
    private markets: LiveMarket[],
    private log: LiveLog = console.log,
    private source: QuoteSource = (code) => fetchQuote(code, AbortSignal.timeout(5_000)),
  ) {
    for (const m of markets) {
      this.state.set(m.code, {
        krx: { window: null, lastPostAt: 0, lastDecision: "" },
        nxt: { window: null, lastPostAt: 0, lastDecision: "" },
        contEnd: null,
        nxtPause: null,
        closeTriedAt: 0,
        lastTrustedPx: 0,
      });
    }
  }

  /** One polling cycle for every market. */
  async tick(): Promise<void> {
    for (const m of this.markets) {
      try {
        await this.tickMarket(m);
      } catch (err) {
        this.log(`[${m.code}] ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }

  /** Chain time, read fresh for every market so a slow market cannot age the next one's report. */
  private async chainNow(): Promise<number> {
    const block = await this.clients.publicClient.getBlock();
    return Number(block.timestamp) - 1; // never ahead of the chain clock
  }

  private async tickMarket(m: LiveMarket) {
    const { publicClient } = this.clients;
    const now = await this.chainNow();
    const [sessionIdx, dayB, sodB] = await publicClient.readContract({
      address: this.engine,
      abi: kmarkEngineAbi,
      functionName: "sessionAt",
      args: [BigInt(now)],
    });
    const session = Session[sessionIdx];
    if (session === "CLOSED") return;
    const day = Number(dayB);
    const sod = Number(sodB);
    const at = (s: number) => now - sod + s; // unix time of second-of-day `s` today

    const st = this.state.get(m.code)!;
    const ms = await publicClient.readContract({
      address: this.engine,
      abi: kmarkEngineAbi,
      functionName: "marketState",
      args: [m.market],
    });
    st.lastTrustedPx = Number(ms.trustedPx);
    const queue = await queueState(this.clients, m.pool, this.engine, m.market);
    // fetched after the queue was read, so a window restarted for a request holds only later trades
    const q = await this.source(m.code);

    // 09:00 opening single-price auction, stamped at its match time
    if (session === "CONTINUOUS" && ms.openDay !== day && sod >= OPEN_T && sod < OPEN_T + AUCTION_POST_LIMIT) {
      if (q.krx.status === "OPEN" && q.krx.cumVolume > 0 && q.krx.open > 0) {
        await this.post(m, st.krx, VENUE_KRX, KIND_OPEN, at(OPEN_T), this.auction(q.krx.cumVolume, q.krx.open, at(OPEN_T)));
        st.krx.window = this.freshWindow(now, q.krx, `${day}:${session}`);
        await this.settle(m);
      }
      return;
    }

    // counters when trading pauses at 15:20: the closing auction adds to KRX's, NXT resumes at 15:30
    if (sod >= CONT_END && sod < CLOSE_T) {
      if (st.contEnd?.day !== day) st.contEnd = { day, volume: q.krx.cumVolume };
      if (q.nxt) st.nxtPause = { day, volume: q.nxt.cumVolume, value: q.nxt.cumValue };
    }

    // 15:30 closing single-price auction → official close → daily reset; retried until the engine has it
    if (sod >= CLOSE_T && sod < CLOSE_T + CLOSE_GRACE && now - st.closeTriedAt >= CLOSE_RETRY) {
      if (await this.closeMissing(m.market, day)) {
        await this.postClose(m, st, q, day, now, at(CLOSE_T));
        return;
      }
    }

    if (session === "CONTINUOUS" && sod >= OPEN_T && sod < CONT_END) {
      await this.continuous(m, st.krx, VENUE_KRX, now, q.krx, queue, `${day}:${session}`, null);
    } else if ((session === "NXT_PRE" || session === "NXT_AFTER") && q.nxt) {
      const baseline = this.nxtBaseline(st, q.nxt, session, day, now, at);
      await this.continuous(m, st.nxt, VENUE_NXT, now, q.nxt, queue, `${day}:${session}`, baseline);
    }
    // a request that already has its price but was not settled (e.g. an earlier settle failed)
    if (queue.ready) await this.settle(m);
  }

  /**
   * Where a fresh NXT window may start counting. NXT counters cover the whole day (pre-market,
   * main market and after-market), so they are zero only at the start of the pre-market, and
   * the after-market starts from the counters seen while NXT paused for the KRX close.
   * Returns null when the start of the session is unknown (the window then starts now).
   */
  private nxtBaseline(st: MarketState, nq: VenueQuote, session: string, day: number, now: number, at: (s: number) => number) {
    if (session === "NXT_PRE") {
      const today = nq.tradedAt >= at(PRE_START) && nq.tradedAt <= now + 60;
      return today && now - at(PRE_START) < 60 ? { start: at(PRE_START), volume: 0, value: 0 } : null;
    }
    if (st.nxtPause?.day === day && now - at(CLOSE_T) < 60) {
      return { start: at(CLOSE_T), volume: st.nxtPause.volume, value: st.nxtPause.value };
    }
    return null;
  }

  private async closeMissing(market: Hex, day: number): Promise<boolean> {
    const { publicClient } = this.clients;
    const n = await publicClient.readContract({ address: this.engine, abi: kmarkEngineAbi, functionName: "closeCount", args: [market] });
    if (n === 0n) return true;
    const last = await publicClient.readContract({
      address: this.engine,
      abi: kmarkEngineAbi,
      functionName: "closeAt",
      args: [market, n - 1n],
    });
    return last.day < day;
  }

  private async postClose(m: LiveMarket, st: MarketState, q: Quote, day: number, now: number, closeAt: number) {
    if (q.krx.status !== "CLOSE" || q.krx.tradedAt < closeAt) return; // the close is not in the feed yet
    if (st.contEnd?.day !== day) {
      // without the 15:20 counters the auction volume is unknown; the owner can record the close later
      if (!st.closeTriedAt) this.log(`[${m.code}] missed the 15:20 volume; record today's close with recordClose`);
      st.closeTriedAt = now;
      return;
    }
    st.closeTriedAt = now;
    const volume = Math.max(1, q.krx.cumVolume - st.contEnd.volume);
    const t = Math.max(closeAt, now - AUCTION_POST_LIMIT);
    const outcome = await this.post(m, st.krx, VENUE_KRX, KIND_CLOSE, t, this.auction(volume, q.krx.price, t));
    // requests made before the close settle first, then the reset is applied
    await this.settle(m);
    if (outcome === "accepted") await syncPool(this.clients, m.pool).catch((e) => this.log(`[${m.code}] sync: ${e.message}`));
  }

  private auction(volume: number, px: number, t: number) {
    return { volume, value: volume * px, first: px, last: px, high: px, low: px, start: t };
  }

  private freshWindow(now: number, q: { cumVolume: number; cumValue: number; price: number }, session: string): Window {
    return this.windowAt(now, q.cumVolume, q.cumValue, q.price, session);
  }

  private windowAt(start: number, volume: number, value: number, px: number, session: string): Window {
    return { session, start, baseVolume: volume, baseValue: value, first: px, last: px, high: px, low: px };
  }

  private async continuous(
    m: LiveMarket,
    v: VenueState,
    venue: number,
    now: number,
    q: { price: number; cumVolume: number; cumValue: number },
    queue: { waiting: boolean; since: number },
    sessionKey: string,
    sessionStart: { start: number; volume: number; value: number } | null,
  ) {
    if (!(q.price > 0)) return;
    // new session, or the venue's counters were reset: start a new window
    if (!v.window || v.window.session !== sessionKey || q.cumVolume < v.window.baseVolume) {
      if (sessionStart && q.cumVolume >= sessionStart.volume) {
        // the session just opened and its starting counters are known: keep the very first prints
        v.window = this.windowAt(sessionStart.start, sessionStart.volume, sessionStart.value, q.price, sessionKey);
      } else {
        v.window = this.freshWindow(now, q, sessionKey);
        return;
      }
    }
    // a request arrived after this window began: restart the window at the request so the price it
    // settles at holds only trades made after it (the quote was read after the request)
    if (queue.waiting && v.window.start < queue.since && now - v.lastPostAt < HEARTBEAT) {
      v.window = this.windowAt(Math.max(now, queue.since), q.cumVolume, q.cumValue, q.price, sessionKey);
      return;
    }
    const w = v.window;
    w.last = q.price;
    w.high = Math.max(w.high, q.price);
    w.low = Math.min(w.low, q.price);
    const volume = q.cumVolume - w.baseVolume;
    if (volume <= 0) return;

    const since = now - v.lastPostAt;
    const ref = this.state.get(m.code)!.lastTrustedPx || q.price;
    const moved = Math.abs(q.price - ref) * 10_000 >= MOVE_BPS * ref;
    const confirming = v.lastDecision === "JUMP_PENDING" || v.lastDecision === "WARMUP";
    const age = now - w.start;
    const due =
      since >= HEARTBEAT ||
      (since >= MIN_GAP && moved) ||
      (age >= MIN_GAP && queue.waiting) ||
      (since >= FAST && confirming);
    if (!due || now <= w.start) return;

    const outcome = await this.post(m, v, venue, KIND_CONT, now, {
      volume,
      value: q.cumValue - w.baseValue,
      first: w.first,
      last: w.last,
      high: w.high,
      low: w.low,
      start: Math.max(w.start, now - MAX_WINDOW),
    });
    if (outcome !== "retry") v.window = this.freshWindow(now, q, sessionKey);
    if (outcome === "accepted") await this.settle(m);
  }

  private async post(
    m: LiveMarket,
    v: VenueState,
    venue: number,
    kind: number,
    end: number,
    a: { volume: number; value: number; first: number; last: number; high: number; low: number; start: number },
  ): Promise<Outcome> {
    const volume = Math.max(1, Math.round(a.volume));
    const value = Math.max(a.value, volume * a.low);
    const vwap = kind === KIND_CONT ? Math.round(value / volume) : a.last;
    const report = {
      market: m.market,
      venue,
      kind,
      windowStart: BigInt(Math.min(a.start, end)),
      windowEnd: BigInt(end),
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
    const outcome = this.summarize(m, events);
    if (outcome.result !== "retry") {
      v.lastPostAt = end;
      v.lastDecision = outcome.reason;
    }
    return outcome.result;
  }

  /** Settle whatever the new price made ready; failures are logged, never block posting. */
  private async settle(m: LiveMarket) {
    try {
      const n = await settleQueue(this.clients, m.pool);
      if (n) this.log(`[${m.code}] settled ${n} request${n > 1 ? "s" : ""}`);
    } catch (err) {
      this.log(`[${m.code}] settle: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  private summarize(m: LiveMarket, events: EngineEvent[]): { result: Outcome; reason: string } {
    for (const e of events) {
      if (e.type === "accepted") {
        this.log(`[${m.code}] ✓ ${e.px.toLocaleString()} KRW (seq ${e.seq})`);
        return { result: "accepted", reason: "ACCEPTED" };
      }
      if (e.type === "held" || (e.type === "rejected" && e.reason !== "JUMP_UNCONFIRMED")) {
        this.log(`[${m.code}] ${e.type} ${e.reason} ${e.px.toLocaleString()} KRW`);
        if (e.type === "held") return { result: "held", reason: e.reason };
        return { result: RETRY.has(e.reason) ? "retry" : "rejected", reason: e.reason };
      }
    }
    return { result: "rejected", reason: "" };
  }
}
