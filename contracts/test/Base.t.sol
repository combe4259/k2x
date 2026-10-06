// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KMarkEngine} from "../src/KMarkEngine.sol";

abstract contract EngineBase is Test {
    bytes32 internal constant HYNIX = keccak256("000660");

    uint8 internal constant KRX = 1;
    uint8 internal constant NXT = 2;
    uint8 internal constant CONT = 0;
    uint8 internal constant OPEN = 1;
    uint8 internal constant CLOSE = 2;
    uint8 internal constant VI = 3;

    // KST calendar fixtures (day = days since epoch in KST)
    uint32 internal constant D0727 = 20661; // Mon, close 1,816,000
    uint32 internal constant D0728 = 20662; // Tue, the 1-share print
    uint32 internal constant D0805 = 20670; // Wed
    uint32 internal constant D1009 = 20735; // Fri, Hangul Day (holiday)
    uint64 internal constant T0728_0800 = 1785193200; // 2026-07-28 08:00:00 KST
    uint64 internal constant T0728_0900 = 1785196800; // 2026-07-28 09:00:00 KST
    uint64 internal constant T0728_1530 = 1785220200; // 2026-07-28 15:30:00 KST
    uint64 internal constant T0806_0800 = 1785970800; // 2026-08-06 08:00:00 KST
    uint64 internal constant T1009_1000 = 1791507600; // 2026-10-09 10:00:00 KST
    uint64 internal constant T1010_1000 = 1791594000; // 2026-10-10 10:00:00 KST (Saturday)
    uint64 internal constant MIN = 60;
    uint64 internal constant HOUR = 3600;
    uint64 internal constant DAY = 86400;

    uint64 internal constant CLOSE_0727 = 1_816_000;

    KMarkEngine internal engine;

    function _deployEngine(KMarkEngine.ClockMode mode) internal {
        engine = new KMarkEngine(mode, address(this));
        engine.setRelayer(address(this), true);
        engine.listMarket(HYNIX, "SK hynix");
        engine.seedClose(HYNIX, D0727, CLOSE_0727);
    }

    function _rep(uint8 venue, uint8 kind, uint64 end_, uint32 trades, uint64 vol, uint64 px)
        internal
        pure
        returns (KMarkEngine.Report memory r)
    {
        r = KMarkEngine.Report({
            market: HYNIX,
            venue: venue,
            kind: kind,
            windowStart: end_ - 1,
            windowEnd: end_,
            trades: trades,
            volume: vol,
            notional: uint128(vol) * px,
            firstPx: px,
            lastPx: px,
            highPx: px,
            lowPx: px,
            vwapPx: px,
            flags: 0
        });
    }

    function _send(uint8 venue, uint8 kind, uint64 end_, uint32 trades, uint64 vol, uint64 px)
        internal
        returns (KMarkEngine.Decision d, KMarkEngine.Reason why)
    {
        return engine.submit(_rep(venue, kind, end_, trades, vol, px));
    }

    function _assertDecision(
        KMarkEngine.Decision d,
        KMarkEngine.Reason why,
        KMarkEngine.Decision wantD,
        KMarkEngine.Reason wantWhy
    ) internal pure {
        assertEq(uint8(d), uint8(wantD), "decision");
        assertEq(uint8(why), uint8(wantWhy), "reason");
    }

    function _trusted() internal view returns (uint64 px, uint64 seq) {
        (px,, seq,,) = engine.latest(HYNIX);
    }

    /// @dev Open the KRX session on 7/28 with a deep opening auction at `px`.
    function _openSession(uint64 px) internal {
        (KMarkEngine.Decision d, KMarkEngine.Reason why) = _send(KRX, OPEN, T0728_0900, 900, 2_000, px);
        _assertDecision(d, why, KMarkEngine.Decision.ACCEPTED, KMarkEngine.Reason.NONE);
    }
}
