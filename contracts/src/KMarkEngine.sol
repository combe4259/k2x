// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title KMarkEngine
/// @notice On-chain price judge for Korean equities. Relayers post per-window trade
///         summaries from KRX and NXT. The engine decides, by Korean market rules,
///         which prices are trustworthy and emits the reason for every decision.
/// @dev    Rules (see docs): R0 sequencing/time, R1 session, R2 halt/VI, R3 ±30% band,
///         R4 warm-up, R5 jump confirmation, R7 staleness (view), R8 official close.
contract KMarkEngine is Ownable {
    // ─────────────────────────────── Types ───────────────────────────────

    enum ClockMode {
        LIVE, // time = block.timestamp, reports must not be future-dated
        REPLAY // time = latest report time (historical or virtual clock)
    }

    enum Session {
        CLOSED,
        NXT_PRE, // 08:00–08:50 NXT pre-market
        AUCTION_WAIT, // 08:50–09:00 KRX opening call auction, NXT break
        CONTINUOUS, // 09:00–15:20 KRX continuous (+ NXT main from 09:00:30)
        CLOSE_AUCTION, // 15:20–15:30 KRX closing call auction
        NXT_AFTER // 15:30–20:00 NXT after-market
    }

    enum Decision {
        ACCEPTED,
        HELD,
        REJECTED
    }

    enum Reason {
        NONE,
        STALE_SEQUENCE, // report is not newer than the last one from this venue
        FUTURE_TIMESTAMP, // report claims a time after the current block (LIVE)
        TOO_OLD, // report older than maxReportAge (LIVE)
        SESSION, // venue/kind not allowed in the current market session
        BAND, // price outside the ±30% daily limit band
        WARMUP, // not enough volume yet since the session (or VI) started
        JUMP_PENDING, // large move waiting for volume confirmation
        JUMP_UNCONFIRMED, // large move that the following trades did not confirm
        VI_HOLD, // volatility interruption in progress
        HALT, // trading halt
        THIN_AUCTION, // auction print with too little volume
        NO_BASE // no reference close for the band
    }

    uint8 public constant VENUE_KRX = 1;
    uint8 public constant VENUE_NXT = 2;

    uint8 public constant KIND_CONTINUOUS = 0;
    uint8 public constant KIND_OPEN_AUCTION = 1;
    uint8 public constant KIND_CLOSE_AUCTION = 2;
    uint8 public constant KIND_VI_AUCTION = 3;

    uint16 public constant FLAG_VI = 1;
    uint16 public constant FLAG_HALT = 2;

    /// @notice Trade summary for one venue over [windowStart, windowEnd]. Prices in KRW.
    struct Report {
        bytes32 market;
        uint8 venue;
        uint8 kind;
        uint64 windowStart;
        uint64 windowEnd;
        uint32 trades;
        uint64 volume;
        uint128 notional;
        uint64 firstPx;
        uint64 lastPx;
        uint64 highPx;
        uint64 lowPx;
        uint64 vwapPx;
        uint16 flags;
    }

    struct Params {
        uint16 bandBps; // daily limit band, 3000 = ±30%
        uint16 jumpBps; // move vs reference that needs confirmation
        uint32 warmupTrades; // trades needed before a new segment is trusted
        uint32 confirmWindow; // seconds a jump candidate may wait for confirmation
        uint32 staleAfter; // seconds without a trusted update before the price is stale
        uint32 maxFutureSkew; // LIVE: allowed clock skew for report time
        uint32 maxReportAge; // LIVE: oldest acceptable report
        uint128 warmupNotional; // KRW traded before a new segment is trusted
        uint128 confirmNotional; // KRW traded at the new level to confirm a jump
        uint128 auctionMinNotional; // KRW an auction print needs to be trusted
    }

    struct PricePoint {
        uint64 px;
        uint64 at;
        uint32 day;
        bool isClose;
    }

    struct CloseRec {
        uint64 px;
        uint64 at;
        uint64 seq;
        uint32 day;
    }

    struct MarketState {
        bool listed;
        bool viHold;
        bool halted;
        bool segWarm;
        uint32 trustedDay;
        uint32 segTrades;
        uint32 viEpoch;
        uint32 candWindows;
        uint64 trustedPx;
        uint64 trustedAt;
        uint64 priceSeq;
        uint64 segKey;
        uint64 candPx;
        uint64 candAt;
        uint64 lastKrxAt;
        uint64 lastNxtAt;
        uint128 segNotional;
        uint128 candNotional;
    }

    // ─────────────────────────────── Constants ───────────────────────────────

    uint256 internal constant BPS = 10_000;
    uint256 internal constant KST_OFFSET = 9 hours;
    int256 internal constant PRE_START = 8 hours;
    int256 internal constant PRE_END = 8 hours + 50 minutes;
    int256 internal constant OPEN_T = 9 hours;
    int256 internal constant NXT_MAIN_START = 9 hours + 30;
    int256 internal constant CONT_END = 15 hours + 20 minutes;
    int256 internal constant CLOSE_T = 15 hours + 30 minutes;
    int256 internal constant AFTER_END = 20 hours;
    int256 internal constant AUCTION_GRACE = 60;

    // ─────────────────────────────── Storage ───────────────────────────────

    ClockMode public immutable mode;
    uint64 public clock; // REPLAY mode: latest report time

    Params public params;
    mapping(address => bool) public relayer;
    mapping(bytes32 => MarketState) internal _markets;
    mapping(bytes32 => mapping(uint64 => PricePoint)) internal _prices;
    mapping(bytes32 => CloseRec[]) internal _closes;

    mapping(uint32 => bool) public holiday; // KST day number => market closed
    mapping(uint32 => int32) public dayShift; // KST day number => seconds every session is shifted

    // ─────────────────────────────── Events ───────────────────────────────

    event RawPrint(
        bytes32 indexed market,
        uint8 venue,
        uint8 kind,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 lastPx,
        uint64 lowPx,
        uint64 highPx,
        uint64 vwapPx,
        uint64 volume,
        uint128 notional,
        uint32 trades
    );
    event PriceAccepted(bytes32 indexed market, uint64 indexed seq, uint64 px, uint64 at, uint8 venue, uint8 kind);
    event PriceHeld(bytes32 indexed market, Reason reason, uint64 px, uint64 at, uint8 venue);
    event PriceRejected(bytes32 indexed market, Reason reason, uint64 px, uint64 at, uint8 venue);
    event CloseSet(bytes32 indexed market, uint32 indexed day, uint64 px, uint64 seq);
    event MarketListed(bytes32 indexed market, string symbol);
    event RelayerSet(address indexed relayer, bool allowed);
    event ParamsSet(Params params);
    event HolidaySet(uint32 indexed day, bool closed);
    event DayShiftSet(uint32 indexed day, int32 shiftSeconds);

    error NotRelayer();
    error UnknownMarket();
    error EmptyReport();
    error AlreadySeeded();

    constructor(ClockMode mode_, address owner_) Ownable(owner_) {
        mode = mode_;
        params = Params({
            bandBps: 3000,
            jumpBps: 300,
            warmupTrades: 20,
            confirmWindow: 30,
            staleAfter: 30,
            maxFutureSkew: 2,
            maxReportAge: 60,
            warmupNotional: 100_000_000, // ₩1억
            confirmNotional: 300_000_000, // ₩3억
            auctionMinNotional: 500_000_000 // ₩5억
        });
    }

    // ─────────────────────────────── Admin ───────────────────────────────

    function listMarket(bytes32 market, string calldata symbol) external onlyOwner {
        _markets[market].listed = true;
        emit MarketListed(market, symbol);
    }

    /// @notice Seed the first official close so the ±30% band has a base.
    function seedClose(bytes32 market, uint32 day, uint64 px) external onlyOwner {
        if (!_markets[market].listed) revert UnknownMarket();
        if (_closes[market].length != 0) revert AlreadySeeded();
        uint64 at = uint64(uint256(day) * 1 days + uint256(CLOSE_T) - KST_OFFSET);
        _closes[market].push(CloseRec({px: px, at: at, seq: _markets[market].priceSeq, day: day}));
        emit CloseSet(market, day, px, _markets[market].priceSeq);
    }

    function setRelayer(address who, bool allowed) external onlyOwner {
        relayer[who] = allowed;
        emit RelayerSet(who, allowed);
    }

    function setParams(Params calldata p) external onlyOwner {
        params = p;
        emit ParamsSet(p);
    }

    function setHoliday(uint32 day, bool closed) external onlyOwner {
        holiday[day] = closed;
        emit HolidaySet(day, closed);
    }

    function setDayShift(uint32 day, int32 shiftSeconds) external onlyOwner {
        dayShift[day] = shiftSeconds;
        emit DayShiftSet(day, shiftSeconds);
    }

    // ─────────────────────────────── Calendar ───────────────────────────────

    function currentTime() public view returns (uint64) {
        return mode == ClockMode.LIVE ? uint64(block.timestamp) : clock;
    }

    function kstDay(uint64 ts) public pure returns (uint32) {
        return uint32((uint256(ts) + KST_OFFSET) / 1 days);
    }

    /// @return s session at `ts`, `day` KST day number, `sod` seconds of the (shifted) KST day
    function sessionAt(uint64 ts) public view returns (Session s, uint32 day, int256 sod) {
        day = kstDay(ts);
        sod = int256((uint256(ts) + KST_OFFSET) % 1 days) - int256(dayShift[day]);
        uint32 weekday = (day + 3) % 7; // 0 = Monday
        if (weekday >= 5 || holiday[day]) return (Session.CLOSED, day, sod);
        if (sod >= PRE_START && sod < PRE_END) s = Session.NXT_PRE;
        else if (sod >= PRE_END && sod < OPEN_T) s = Session.AUCTION_WAIT;
        else if (sod >= OPEN_T && sod < CONT_END) s = Session.CONTINUOUS;
        else if (sod >= CONT_END && sod < CLOSE_T) s = Session.CLOSE_AUCTION;
        else if (sod >= CLOSE_T && sod < AFTER_END) s = Session.NXT_AFTER;
        else s = Session.CLOSED;
    }

    // ─────────────────────────────── Core ───────────────────────────────

    function submit(Report calldata r) external returns (Decision, Reason) {
        if (!relayer[msg.sender]) revert NotRelayer();
        MarketState storage m = _markets[r.market];
        if (!m.listed) revert UnknownMarket();
        if (r.trades == 0 || r.vwapPx == 0 || r.lowPx == 0) revert EmptyReport();

        uint64 t = r.windowEnd;
        emit RawPrint(
            r.market, r.venue, r.kind, r.windowStart, t, r.lastPx, r.lowPx, r.highPx, r.vwapPx, r.volume, r.notional, r.trades
        );

        // R0 — sequencing and time sanity
        uint64 lastAt = r.venue == VENUE_KRX ? m.lastKrxAt : m.lastNxtAt;
        if (t <= lastAt || r.windowStart > t) return _reject(r, Reason.STALE_SEQUENCE, r.vwapPx, t);
        Params memory p = params;
        if (mode == ClockMode.LIVE) {
            if (t > block.timestamp + p.maxFutureSkew) return _reject(r, Reason.FUTURE_TIMESTAMP, r.vwapPx, t);
            if (uint256(t) + p.maxReportAge < block.timestamp) return _reject(r, Reason.TOO_OLD, r.vwapPx, t);
        } else if (t > clock) {
            clock = t;
        }
        if (r.venue == VENUE_KRX) m.lastKrxAt = t;
        else m.lastNxtAt = t;

        // R1 — session gate
        (Session s, uint32 day, int256 sod) = sessionAt(t);
        if (!_sessionAllows(s, sod, r.venue, r.kind)) return _reject(r, Reason.SESSION, r.vwapPx, t);

        // R2 — halt / volatility interruption
        if (r.flags & FLAG_HALT != 0) {
            m.halted = true;
            _clearCandidate(m);
            return _hold(r, Reason.HALT, r.vwapPx, t);
        }
        m.halted = false;
        if (r.flags & FLAG_VI != 0) {
            m.viHold = true;
            _clearCandidate(m);
            return _hold(r, Reason.VI_HOLD, r.vwapPx, t);
        }
        if (m.viHold || r.kind == KIND_VI_AUCTION) {
            // VI ended: the market restarts price discovery, so warm-up starts over
            m.viHold = false;
            m.viEpoch++;
        }

        // R3 — ±30% daily limit band around the trading day's base price
        uint64 base = _bandBase(r.market, day);
        if (base == 0) return _reject(r, Reason.NO_BASE, r.vwapPx, t);
        {
            uint256 lo = uint256(base) * (BPS - p.bandBps) / BPS;
            uint256 hi = uint256(base) * (BPS + p.bandBps) / BPS;
            if (r.lowPx < lo || r.highPx > hi || r.vwapPx < lo || r.vwapPx > hi) {
                return _reject(r, Reason.BAND, r.vwapPx, t);
            }
        }

        // segment bookkeeping (warm-up restarts per session segment and after each VI)
        uint64 key = _segKey(day, s, r.kind, m.viEpoch);
        if (key != m.segKey) {
            m.segKey = key;
            m.segNotional = 0;
            m.segTrades = 0;
            m.segWarm = false;
            _clearCandidate(m);
        }

        // R8 — auction prints (deep single-price auctions) are trusted on their own
        if (r.kind == KIND_OPEN_AUCTION || r.kind == KIND_CLOSE_AUCTION) {
            if (r.notional < p.auctionMinNotional) return _hold(r, Reason.THIN_AUCTION, r.lastPx, t);
            m.segNotional += r.notional;
            m.segTrades += r.trades;
            m.segWarm = true;
            _clearCandidate(m);
            uint64 seq = _accept(r, r.lastPx, t, day);
            if (r.kind == KIND_CLOSE_AUCTION) _setClose(r.market, r.lastPx, t, seq, day);
            return (Decision.ACCEPTED, Reason.NONE);
        }

        uint64 px = r.vwapPx;
        uint64 ref = (m.trustedDay == day && m.trustedPx != 0) ? m.trustedPx : base;
        bool jump = !_within(px, ref, p.jumpBps);

        // R5 — a pending jump candidate is confirmed only by volume in the same direction
        if (m.candPx != 0) {
            bool sameSide = (px < ref) == (m.candPx < ref);
            if (jump && sameSide && t <= m.candAt + p.confirmWindow) {
                m.candNotional += r.notional;
                m.candWindows += 1;
                m.candPx = px;
                m.segNotional += r.notional;
                m.segTrades += r.trades;
                if (m.candNotional >= p.confirmNotional && m.candWindows >= 2) {
                    _clearCandidate(m);
                    m.segWarm = true;
                    _accept(r, px, t, day);
                    return (Decision.ACCEPTED, Reason.NONE);
                }
                return _hold(r, Reason.JUMP_PENDING, px, t);
            }
            emit PriceRejected(r.market, Reason.JUMP_UNCONFIRMED, m.candPx, m.candAt, r.venue);
            _clearCandidate(m);
        }

        m.segNotional += r.notional;
        m.segTrades += r.trades;

        if (jump) {
            m.candPx = px;
            m.candAt = t;
            m.candNotional = r.notional;
            m.candWindows = 1;
            return _hold(r, Reason.JUMP_PENDING, px, t);
        }

        // R4 — warm-up: a new segment is trusted only after enough real trading
        if (!m.segWarm) {
            if (m.segNotional >= p.warmupNotional && m.segTrades >= p.warmupTrades) {
                m.segWarm = true;
            } else {
                return _hold(r, Reason.WARMUP, px, t);
            }
        }

        _accept(r, px, t, day);
        return (Decision.ACCEPTED, Reason.NONE);
    }

    // ─────────────────────────────── Views ───────────────────────────────

    /// @notice Latest trusted price and whether it can be used right now (R7).
    function latest(bytes32 market)
        external
        view
        returns (uint64 px, uint64 at, uint64 seq, Session session, bool stale)
    {
        MarketState storage m = _markets[market];
        uint64 nowTs = currentTime();
        (session,,) = sessionAt(nowTs);
        px = m.trustedPx;
        at = m.trustedAt;
        seq = m.priceSeq;
        bool open = session == Session.NXT_PRE || session == Session.CONTINUOUS || session == Session.NXT_AFTER;
        stale = !open || px == 0 || nowTs > uint256(at) + params.staleAfter;
    }

    function priceSeq(bytes32 market) external view returns (uint64) {
        return _markets[market].priceSeq;
    }

    function priceAt(bytes32 market, uint64 seq) external view returns (PricePoint memory) {
        return _prices[market][seq];
    }

    function closeCount(bytes32 market) external view returns (uint256) {
        return _closes[market].length;
    }

    function closeAt(bytes32 market, uint256 i) external view returns (CloseRec memory) {
        return _closes[market][i];
    }

    function bandBase(bytes32 market, uint32 day) external view returns (uint64) {
        return _bandBase(market, day);
    }

    function marketState(bytes32 market) external view returns (MarketState memory) {
        return _markets[market];
    }

    // ─────────────────────────────── Internals ───────────────────────────────

    function _sessionAllows(Session s, int256 sod, uint8 venue, uint8 kind) internal pure returns (bool) {
        if (kind == KIND_OPEN_AUCTION) return venue == VENUE_KRX && sod >= OPEN_T && sod < OPEN_T + AUCTION_GRACE;
        if (kind == KIND_CLOSE_AUCTION) return venue == VENUE_KRX && sod >= CLOSE_T && sod < CLOSE_T + AUCTION_GRACE;
        if (kind == KIND_VI_AUCTION) {
            return s == Session.NXT_PRE || s == Session.CONTINUOUS || s == Session.NXT_AFTER;
        }
        if (s == Session.NXT_PRE || s == Session.NXT_AFTER) return venue == VENUE_NXT;
        if (s == Session.CONTINUOUS) return venue == VENUE_KRX || (venue == VENUE_NXT && sod >= NXT_MAIN_START);
        return false;
    }

    function _segKey(uint32 day, Session s, uint8 kind, uint32 viEpoch) internal pure returns (uint64) {
        uint64 seg;
        if (kind == KIND_OPEN_AUCTION || kind == KIND_CLOSE_AUCTION || s == Session.CONTINUOUS) seg = 2;
        else if (s == Session.NXT_PRE) seg = 1;
        else seg = 3;
        return (uint64(day) << 32) | (seg << 24) | uint64(viEpoch & 0xFFFFFF);
    }

    function _bandBase(bytes32 market, uint32 day) internal view returns (uint64) {
        CloseRec[] storage cs = _closes[market];
        uint256 n = cs.length;
        if (n == 0) return 0;
        if (cs[n - 1].day < day) return cs[n - 1].px;
        if (n >= 2) return cs[n - 2].px;
        return 0;
    }

    function _within(uint64 a, uint64 b, uint16 bps) internal pure returns (bool) {
        uint256 diff = a > b ? a - b : b - a;
        return diff * BPS <= uint256(b) * bps;
    }

    function _clearCandidate(MarketState storage m) internal {
        m.candPx = 0;
        m.candAt = 0;
        m.candNotional = 0;
        m.candWindows = 0;
    }

    function _accept(Report calldata r, uint64 px, uint64 t, uint32 day) internal returns (uint64 seq) {
        MarketState storage m = _markets[r.market];
        seq = ++m.priceSeq;
        m.trustedPx = px;
        m.trustedAt = t;
        m.trustedDay = day;
        _prices[r.market][seq] = PricePoint({px: px, at: t, day: day, isClose: false});
        emit PriceAccepted(r.market, seq, px, t, r.venue, r.kind);
    }

    function _setClose(bytes32 market, uint64 px, uint64 t, uint64 seq, uint32 day) internal {
        _prices[market][seq].isClose = true;
        _closes[market].push(CloseRec({px: px, at: t, seq: seq, day: day}));
        emit CloseSet(market, day, px, seq);
    }

    function _hold(Report calldata r, Reason why, uint64 px, uint64 t) internal returns (Decision, Reason) {
        emit PriceHeld(r.market, why, px, t, r.venue);
        return (Decision.HELD, why);
    }

    function _reject(Report calldata r, Reason why, uint64 px, uint64 t) internal returns (Decision, Reason) {
        emit PriceRejected(r.market, why, px, t, r.venue);
        return (Decision.REJECTED, why);
    }
}
