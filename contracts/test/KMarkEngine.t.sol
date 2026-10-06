// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {KMarkEngine} from "../src/KMarkEngine.sol";
import {EngineBase} from "./Base.t.sol";

contract KMarkEngineTest is EngineBase {
    bytes32 internal constant ACCEPTED_SIG = keccak256("PriceAccepted(bytes32,uint64,uint64,uint64,uint8,uint8)");

    function setUp() public {
        _deployEngine(KMarkEngine.ClockMode.REPLAY);
    }

    // ─────────── Incident replays ───────────

    /// 2026-07-28 08:00 as it happened: one share printed at the lower limit (-29.99%) while the real
    /// pre-market was trading about 7.5% lower. The engine rejects the print and follows the real gap.
    function test_0728_rejectsThePrintAndFollowsTheRealGap() public {
        vm.recordLogs();
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(NXT, CONT, T0728_0800 + 1, 1, 1, 1_272_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);

        // real trades 7.5% lower: the -30% candidate is rejected, a new -7.5% candidate starts
        vm.expectEmit(true, false, false, true, address(engine));
        emit KMarkEngine.PriceRejected(HYNIX, KMarkEngine.Reason.JUMP_UNCONFIRMED, 1_272_000, T0728_0800 + 1, NXT);
        (d, why) = _send(NXT, CONT, T0728_0800 + 2, 8, 40, 1_680_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);

        // about ₩6,700만 a second keeps trading there; ₩3억 confirms the gap within seconds
        uint64 sec = 2;
        while (d != KMarkEngine.Decision.ACCEPTED) {
            ++sec;
            (d, why) = _send(NXT, CONT, T0728_0800 + sec, 8, 40, 1_678_000);
        }
        assertLe(sec, 6, "real gap followed within ~5 seconds");
        (uint64 px,) = _trusted();
        assertEq(px, 1_678_000);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ACCEPTED_SIG) continue;
            (uint64 acceptedPx,,,) = abi.decode(logs[i].data, (uint64, uint64, uint8, uint8));
            assertTrue(acceptedPx != 1_272_000, "bad print must never be accepted");
        }
    }

    /// Variant: an outlier followed by normal trading near the previous close.
    function test_outlierThenNormalTradingNeedsWarmup() public {
        vm.recordLogs();

        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(NXT, CONT, T0728_0800 + 1, 1, 1, 1_272_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);

        // the next second trades back near the previous close: the candidate is rejected
        vm.expectEmit(true, false, false, true, address(engine));
        emit KMarkEngine.PriceRejected(HYNIX, KMarkEngine.Reason.JUMP_UNCONFIRMED, 1_272_000, T0728_0800 + 1, NXT);
        (d, why) = _send(NXT, CONT, T0728_0800 + 2, 5, 30, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.WARMUP);

        // warm-up: ₩1억 and 20 trades before the pre-market price is trusted
        for (uint64 i = 3; i <= 5; ++i) {
            (d, why) = _send(NXT, CONT, T0728_0800 + i, 5, 30, 1_800_000);
        }
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);

        (uint64 px, uint64 seq) = _trusted();
        assertEq(px, 1_800_000);
        assertEq(seq, 1);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ACCEPTED_SIG) continue;
            (uint64 acceptedPx,,,) = abi.decode(logs[i].data, (uint64, uint64, uint8, uint8));
            assertTrue(acceptedPx != 1_272_000, "bad print must never be accepted");
        }
    }

    /// 2026-08-06 08:00 — eleven shares at the lower limit; same outcome.
    function test_0806_elevenSharePrintIsRejected() public {
        engine.listMarket(keccak256("000660-0806"), "SK hynix 8/6");
        bytes32 m = keccak256("000660-0806");
        engine.seedClose(m, D0805, 1_668_000);

        KMarkEngine.Report memory r = _rep(NXT, CONT, T0806_0800 + 1, 1, 11, 1_168_000);
        r.market = m;
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = engine.submit(r);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);

        for (uint64 i = 2; i <= 6; ++i) {
            r = _rep(NXT, CONT, T0806_0800 + i, 5, 40, 1_660_000);
            r.market = m;
            (d, why) = engine.submit(r);
        }
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);
        (uint64 px,,,,) = engine.latest(m);
        assertEq(px, 1_660_000);
    }

    /// A genuine crash with real volume is followed within seconds — the engine does not just filter.
    function test_realCrashIsConfirmedWithinSeconds() public {
        _openSession(1_800_000);
        uint64 t = T0728_0900 + HOUR; // 10:00

        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, t + 1, 300, 120, 1_650_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);
        (d, why) = _send(KRX, CONT, t + 2, 300, 120, 1_645_000);
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);

        (uint64 px,) = _trusted();
        assertEq(px, 1_645_000);
    }

    /// A trending sell-off keeps accumulating confirmation instead of resetting every second.
    function test_trendingDropAccumulatesConfirmation() public {
        _openSession(1_800_000);
        uint64 t = T0728_0900 + HOUR;
        _send(KRX, CONT, t + 1, 100, 60, 1_740_000); // -3.3%
        (KMarkEngine.Decision d,) = _send(KRX, CONT, t + 2, 100, 60, 1_720_000);
        assertEq(uint8(d), uint8(KMarkEngine.Decision.HELD));
        (d,) = _send(KRX, CONT, t + 3, 100, 60, 1_700_000);
        assertEq(uint8(d), uint8(KMarkEngine.Decision.ACCEPTED));
        (uint64 px,) = _trusted();
        assertEq(px, 1_700_000);
    }

    function test_unconfirmedJumpExpires() public {
        _openSession(1_800_000);
        uint64 t = T0728_0900 + HOUR;
        _send(KRX, CONT, t + 1, 1, 1, 1_700_000);
        // 61 seconds later, still at the new level but outside the confirmation window
        vm.expectEmit(true, false, false, true, address(engine));
        emit KMarkEngine.PriceRejected(HYNIX, KMarkEngine.Reason.JUMP_UNCONFIRMED, 1_700_000, t + 1, KRX);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, t + 62, 50, 50, 1_700_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);
    }

    // ─────────── Band, session, calendar ───────────

    function test_bandRejectsOutsideDailyLimit() public {
        _openSession(1_800_000);
        uint64 lo = uint64(uint256(CLOSE_0727) * 69 / 100);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, T0728_0900 + 10, 50, 50, lo);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.BAND);
        uint64 hi = uint64(uint256(CLOSE_0727) * 131 / 100);
        (d, why) = _send(KRX, CONT, T0728_0900 + 11, 50, 50, hi);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.BAND);
    }

    function test_sessionGate() public {
        // KRX does not trade continuously at 08:10
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, T0728_0800 + 10 * MIN, 5, 5, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
        // NXT is on break during the KRX opening auction (08:50–09:00)
        (d, why) = _send(NXT, CONT, T0728_0800 + 55 * MIN, 5, 5, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
        // NXT main market starts at 09:00:30
        (d, why) = _send(NXT, CONT, T0728_0900 + 10, 5, 5, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
        // nothing trades at 21:00
        (d, why) = _send(NXT, CONT, T0728_0800 + 13 * HOUR, 5, 5, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
    }

    function test_windowEndingOnTheBoundaryCountsForItsSession() public {
        // the last pre-market minute [08:49:00, 08:50:00] still belongs to the NXT pre-market
        KMarkEngine.Report memory r = _rep(NXT, CONT, T0728_0800 + 50 * MIN, 30, 60, 1_700_000);
        r.windowStart = T0728_0800 + 49 * MIN;
        (, KMarkEngine.Reason why) = engine.submit(r);
        assertTrue(why != KMarkEngine.Reason.SESSION, "boundary window accepted into its session");
    }

    function test_overlongWindowRejected() public {
        KMarkEngine.Report memory r = _rep(NXT, CONT, T0728_0800 + 40 * MIN, 30, 60, 1_700_000);
        r.windowStart = T0728_0800 + 10 * MIN;
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = engine.submit(r);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
    }

    function test_weekendAndHolidayAreClosed() public {
        engine.setHoliday(D1009, true);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, T1009_1000, 5, 5, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
        (d, why) = _send(KRX, CONT, T1010_1000, 5, 5, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
    }

    function test_dayShiftMovesTheOpen() public {
        // e.g. the college entrance exam day: the market opens an hour late
        engine.setDayShift(D0728, 1 hours);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, OPEN, T0728_0900, 900, 2_000, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.SESSION);
        (d, why) = _send(KRX, OPEN, T0728_0900 + HOUR, 900, 2_000, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);
    }

    // ─────────── Auctions, close, VI ───────────

    function test_thinOpeningAuctionIsHeld() public {
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, OPEN, T0728_0900, 1, 1, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.THIN_AUCTION);
    }

    function test_closingAuctionSetsOfficialClose() public {
        _openSession(1_800_000);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CLOSE, T0728_1530, 2_000, 3_000, 1_850_000);
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);

        assertEq(engine.closeCount(HYNIX), 2);
        KMarkEngine.CloseRec memory c = engine.closeAt(HYNIX, 1);
        assertEq(c.px, 1_850_000);
        assertEq(c.day, D0728);
        // the rest of 7/28 (NXT after-market) still uses 7/27's close as the band base
        assertEq(engine.bandBase(HYNIX, D0728), CLOSE_0727);
        // 7/29 uses 7/28's close
        assertEq(engine.bandBase(HYNIX, D0728 + 1), 1_850_000);
    }

    function test_viFreezesAndRestartsWarmup() public {
        _openSession(1_800_000);
        uint64 t = T0728_0900 + HOUR;
        KMarkEngine.Report memory r = _rep(KRX, CONT, t + 1, 50, 50, 1_700_000);
        r.flags = 1; // FLAG_VI
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = engine.submit(r);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.VI_HOLD);

        // the single-price auction that ends the VI is thin: new segment, warm-up applies
        (d, why) = _send(KRX, VI, t + 121, 3, 3, 1_790_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.WARMUP);
        for (uint64 i = 1; i <= 4; ++i) {
            (d, why) = _send(KRX, CONT, t + 121 + i, 10, 20, 1_790_000);
        }
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);
    }

    // ─────────── Sequencing and live-clock sanity ───────────

    function test_staleSequenceRejected() public {
        _openSession(1_800_000);
        _send(KRX, CONT, T0728_0900 + 10, 50, 50, 1_800_000);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, T0728_0900 + 10, 50, 50, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.STALE_SEQUENCE);
    }

    function test_onlyRelayer() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(KMarkEngine.NotRelayer.selector);
        engine.submit(_rep(KRX, CONT, T0728_0900 + 10, 50, 50, 1_800_000));
    }

    function test_liveRejectsFutureDatedAndOldReports() public {
        _deployEngine(KMarkEngine.ClockMode.LIVE);
        vm.warp(T0728_0900 + HOUR);
        // a future-dated report — the trick used in the Ostium exploit — is refused
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, T0728_0900 + HOUR + 30, 50, 50, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.FUTURE_TIMESTAMP);
        (d, why) = _send(KRX, CONT, T0728_0900 + HOUR - 120, 50, 50, 1_800_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.TOO_OLD);
    }

    function test_liveStaleness() public {
        _deployEngine(KMarkEngine.ClockMode.LIVE);
        vm.warp(T0728_0900);
        _openSession(1_800_000);
        (,,,, bool stale) = engine.latest(HYNIX);
        assertFalse(stale);
        vm.warp(T0728_0900 + 31);
        (,,,, stale) = engine.latest(HYNIX);
        assertTrue(stale);
    }

    function test_priceHistoryIsKeptForForwardPricing() public {
        _openSession(1_800_000);
        _send(KRX, CONT, T0728_0900 + 2, 50, 50, 1_801_000);
        _send(KRX, CONT, T0728_0900 + 3, 50, 50, 1_802_000);
        assertEq(engine.priceSeq(HYNIX), 3);
        assertEq(engine.priceAt(HYNIX, 1).px, 1_800_000);
        assertEq(engine.priceAt(HYNIX, 2).px, 1_801_000);
        assertEq(engine.priceAt(HYNIX, 3).at, T0728_0900 + 3);
    }

    // ─────────── Review fixes: a compromised or careless relayer stays inside the rules ───────────

    /// An auction is one price. A close whose lastPx differs from the band-checked prices is refused,
    /// so it can neither set an out-of-band official close nor a zero close that would brick the pool.
    function test_auctionMustBeOnePrice() public {
        _openSession(1_800_000);
        KMarkEngine.Report memory r = _rep(KRX, CLOSE, T0728_1530, 2_000, 3_000, 1_850_000);
        r.lastPx = 18_500_000;
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = engine.submit(r);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.MALFORMED);
        r = _rep(KRX, CLOSE, T0728_1530 + 1, 2_000, 3_000, 1_850_000);
        r.lastPx = 0;
        (d, why) = engine.submit(r);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.MALFORMED);
        assertEq(engine.closeCount(HYNIX), 1, "no close recorded");
    }

    function test_continuousPricesMustSitInsideLowHigh() public {
        _openSession(1_800_000);
        KMarkEngine.Report memory r = _rep(KRX, CONT, T0728_0900 + 10, 50, 50, 1_800_000);
        r.firstPx = 2_400_000;
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = engine.submit(r);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.MALFORMED);
    }

    /// One official close per day: repeated close prints cannot walk the band or rebase twice.
    function test_secondCloseOnTheSameDayIsRefused() public {
        _openSession(1_800_000);
        _send(KRX, CLOSE, T0728_1530, 2_000, 3_000, 1_850_000);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CLOSE, T0728_1530 + 1, 2_000, 3_000, 2_300_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.AUCTION_DONE);
        assertEq(engine.closeCount(HYNIX), 2);
        assertEq(engine.bandBase(HYNIX, D0728), CLOSE_0727, "after-market band stays on 7/27");
        assertEq(engine.bandBase(HYNIX, D0728 + 1), 1_850_000);
    }

    function test_secondOpenOnTheSameDayIsRefused() public {
        _openSession(1_800_000);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, OPEN, T0728_0900 + 1, 900, 2_000, 1_700_000);
        _assertDecision(d, why, KMarkEngine.Decision.REJECTED, KMarkEngine.Reason.AUCTION_DONE);
    }

    function test_thinCloseCanBeRetried() public {
        _openSession(1_800_000);
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CLOSE, T0728_1530, 1, 1, 1_850_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.THIN_AUCTION);
        (d, why) = _send(KRX, CLOSE, T0728_1530 + 5, 2_000, 3_000, 1_850_000);
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);
    }

    /// A missed close can be recorded afterwards, inside that day's band, so the next day's band
    /// does not stay on an old close.
    function test_recordMissedClose() public {
        _openSession(1_800_000);
        vm.expectRevert(KMarkEngine.TooEarly.selector);
        engine.recordClose(HYNIX, D0728, 2_000_000);

        _send(NXT, CONT, T0728_1530 + HOUR, 5, 5, 1_990_000); // the replay clock passes 15:35
        vm.expectRevert(KMarkEngine.OutOfBand.selector);
        engine.recordClose(HYNIX, D0728, 2_400_000);
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        engine.recordClose(HYNIX, D0728, 2_000_000);

        engine.recordClose(HYNIX, D0728, 2_000_000);
        assertEq(engine.bandBase(HYNIX, D0728 + 1), 2_000_000);
        KMarkEngine.CloseRec memory c = engine.closeAt(HYNIX, 1);
        assertEq(engine.priceAt(HYNIX, c.seq).px, 2_000_000);
        assertTrue(engine.priceAt(HYNIX, c.seq).isClose);
        vm.expectRevert(KMarkEngine.CloseExists.selector);
        engine.recordClose(HYNIX, D0728, 2_000_000);
    }

    /// While a volume-backed jump waits for confirmation, a lone print near the old price neither
    /// clears it nor becomes the trusted price.
    function test_thinPrintCannotOverruleAPendingJump() public {
        _openSession(1_800_000);
        uint64 t = T0728_0900 + HOUR;
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, CONT, t + 1, 300, 600, 1_700_000); // ₩10억, -5.6%
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);
        (d, why) = _send(NXT, CONT, t + 2, 1, 1, 1_795_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);
        (uint64 px, uint64 seq) = _trusted();
        assertEq(px, 1_800_000);
        assertEq(seq, 1);
        (d, why) = _send(KRX, CONT, t + 3, 300, 600, 1_698_000);
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);
    }

    /// The thin cold-market case: two self-crossed trades worth ₩3억 at the lower limit are not enough;
    /// a jump that sets the session's first price also needs warm-up's trade count.
    function test_twoTradesCannotConfirmALimitDown() public {
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(NXT, CONT, T0728_0800 + 1, 1, 116, 1_290_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);
        (d, why) = _send(NXT, CONT, T0728_0800 + 2, 1, 117, 1_290_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.JUMP_PENDING);
        (uint64 px,) = _trusted();
        assertEq(px, 0, "nothing trusted yet");
    }

    function test_haltResumeRestartsWarmup() public {
        _openSession(1_800_000);
        uint64 t = T0728_0900 + HOUR;
        KMarkEngine.Report memory r = _rep(KRX, CONT, t + 1, 50, 50, 1_800_000);
        r.flags = 2; // FLAG_HALT
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = engine.submit(r);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.HALT);
        (d, why) = _send(KRX, CONT, t + 3 * HOUR, 1, 1, 1_760_000);
        _assertDecision(d, why, KMarkEngine.Decision.HELD, KMarkEngine.Reason.WARMUP);
    }

    /// Pools settle only at prices formed after a request, so every price records where its data starts.
    function test_pricesRecordWhereTheirDataStarts() public {
        _openSession(1_800_000);
        assertEq(engine.priceAt(HYNIX, 1).from, T0728_0900, "auction: its match time");
        KMarkEngine.Report memory r = _rep(KRX, CONT, T0728_0900 + 40, 50, 50, 1_801_000);
        r.windowStart = T0728_0900 + 10;
        engine.submit(r);
        assertEq(engine.priceAt(HYNIX, 2).from, T0728_0900 + 10, "continuous: its window start");
    }
}
