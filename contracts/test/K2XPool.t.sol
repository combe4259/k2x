// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KMarkEngine} from "../src/KMarkEngine.sol";
import {K2XPool} from "../src/K2XPool.sol";
import {K2XToken} from "../src/K2XToken.sol";
import {MockAUSD} from "../src/MockAUSD.sol";
import {EngineBase} from "./Base.t.sol";

contract K2XPoolTest is EngineBase {
    MockAUSD internal ausd;
    K2XPool internal pool;
    K2XToken internal token;

    address internal lp = address(0x1111);
    address internal alice = address(0xA11CE);

    uint64 internal clockT;
    uint64 internal lastPx;

    function setUp() public {
        _deployEngine(KMarkEngine.ClockMode.REPLAY);
        ausd = new MockAUSD(address(this));
        pool = new K2XPool(IERC20(address(ausd)), 6, engine, HYNIX, "K2X LP SK hynix", "k2xLP-HYNIX", address(this));
        token = new K2XToken("K2X SK hynix 2X", "HYNIX2X", address(pool), 2e18);
        pool.initialize(token, 10e18);

        ausd.mint(lp, 1_000_000e6);
        ausd.mint(alice, 100_000e6);
        vm.prank(lp);
        ausd.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        ausd.approve(address(pool), type(uint256).max);

        _openSession(CLOSE_0727);
        clockT = T0728_0900;
        lastPx = CLOSE_0727;
    }

    // ─────────── helpers ───────────

    /// @dev Publish a trusted KRX price one second later (a second print confirms large moves).
    function _price(uint64 px) internal returns (uint64 seq) {
        clockT += 1;
        (KMarkEngine.Decision d,) = _send(KRX, CONT, clockT, 200, 200, px);
        if (d != KMarkEngine.Decision.ACCEPTED) {
            clockT += 1;
            (d,) = _send(KRX, CONT, clockT, 200, 200, px);
        }
        assertEq(uint8(d), uint8(KMarkEngine.Decision.ACCEPTED), "price not accepted");
        lastPx = px;
        seq = engine.priceSeq(HYNIX);
    }

    function _deposit(uint128 amount) internal {
        vm.prank(lp);
        uint256 id = pool.requestDeposit(amount, 0, type(uint64).max);
        _price(lastPx);
        assertTrue(pool.settle(id));
    }

    function _mint(address who, uint128 amount) internal returns (uint256 id, bool ok) {
        vm.prank(who);
        id = pool.requestMint(amount, 0, type(uint64).max);
        _price(lastPx);
        ok = pool.settle(id);
    }

    // ─────────── forward pricing ───────────

    function test_mintWaitsForTheNextTrustedPrice() public {
        _deposit(100_000e6);
        vm.prank(alice);
        uint256 id = pool.requestMint(1_000e6, 0, type(uint64).max);

        vm.expectRevert(K2XPool.NoNewPrice.selector);
        pool.settle(id);

        uint64 firstAfter = _price(CLOSE_0727);
        _price(1_900_000); // a later, higher price must not be used
        assertTrue(pool.settle(id));

        K2XPool.Request memory q = pool.requestOf(id);
        assertEq(q.settledSeq, firstAfter);
        // NAV ≈ 10 AUSD at the base close; 0.10% fee
        assertApproxEqRel(token.balanceOf(alice), 99.9e18, 0.001e18);
    }

    function test_navIsTwiceTheMoveSinceTheClose() public {
        _deposit(100_000e6);
        _mint(alice, 1_000e6);
        _price(1_997_600); // +10% vs the 7/27 close
        K2XPool.Snapshot memory s = pool.snapshot();
        assertApproxEqRel(s.nav, 12e18, 0.002e18);
    }

    function test_redeemPaysNavMinusFee() public {
        _deposit(100_000e6);
        _mint(alice, 1_000e6);
        uint256 tokens = token.balanceOf(alice);
        uint256 before = ausd.balanceOf(alice);

        _price(1_997_600);
        vm.prank(alice);
        uint256 id = pool.requestRedeem(uint128(tokens), 0, type(uint64).max);
        assertEq(token.balanceOf(alice), 0, "tokens escrowed");
        _price(1_997_600);
        assertTrue(pool.settle(id));

        uint256 paid = ausd.balanceOf(alice) - before;
        // 99.9 tokens × 12 AUSD × (1 - 0.1%) ≈ 1,197.6 AUSD
        assertApproxEqRel(paid, 1_197.6e6, 0.003e18);
    }

    // ─────────── daily reset ───────────

    function test_dailyResetCompoundsLikeALeveragedEtf() public {
        _deposit(100_000e6);
        _mint(alice, 1_000e6);

        // 7/28 closes +10% → the token resets to 2x at NAV ≈ 12
        (KMarkEngine.Decision d,) = _send(KRX, CLOSE, T0728_1530, 2_000, 3_000, 1_997_600);
        assertEq(uint8(d), uint8(KMarkEngine.Decision.ACCEPTED));
        pool.sync();
        assertEq(token.basePx(), 1_997_600);
        assertApproxEqRel(token.navBase(), 12e18, 0.002e18);

        // 7/29 opens 9.09% lower (back to 1,816,000): the stock is flat, the 2x token is -1.8%
        (d,) = _send(KRX, OPEN, T0728_0900 + DAY, 900, 2_000, 1_816_000);
        assertEq(uint8(d), uint8(KMarkEngine.Decision.ACCEPTED));
        K2XPool.Snapshot memory s = pool.snapshot();
        assertApproxEqRel(s.nav, 9.818e18, 0.002e18);
    }

    function test_settlementAfterAResetUsesTheNewBase() public {
        _deposit(100_000e6);
        vm.prank(alice);
        uint256 id = pool.requestMint(1_000e6, 0, type(uint64).max);
        _send(KRX, CLOSE, T0728_1530, 2_000, 3_000, 1_997_600);
        pool.sync(); // reset applied before the request is settled
        assertTrue(pool.settle(id));
        // settled at the close itself, where NAV is continuous (≈ 12)
        assertApproxEqRel(token.balanceOf(alice), uint256(999e18) / 12, 0.003e18);
    }

    // ─────────── risk limits ───────────

    function test_mintBeyondCapIsRefunded() public {
        _deposit(10_000e6);
        uint256 before = ausd.balanceOf(alice);
        (uint256 id, bool ok) = _mint(alice, 3_000e6); // exposure ≈ 6,000 > 50% × 10,003
        assertFalse(ok);
        assertEq(uint8(pool.requestOf(id).status), uint8(K2XPool.Status.REFUNDED));
        assertEq(ausd.balanceOf(alice), before);

        (, ok) = _mint(alice, 2_000e6); // exposure ≈ 4,000 fits
        assertTrue(ok);
    }

    function test_lpWithdrawalCannotBreachTheCap() public {
        _deposit(10_000e6);
        _mint(alice, 2_000e6);
        uint256 shares = pool.balanceOf(lp);

        vm.prank(lp);
        uint256 id = pool.requestWithdraw(uint128(shares), 0, type(uint64).max);
        _price(lastPx);
        assertFalse(pool.settle(id)); // would leave exposure uncovered
        assertEq(pool.balanceOf(lp), shares, "shares returned");

        vm.prank(lp);
        id = pool.requestWithdraw(uint128(shares / 10), 0, type(uint64).max);
        _price(lastPx);
        assertTrue(pool.settle(id));
    }

    function test_fundingMovesValueFromHoldersToLps() public {
        _deposit(100_000e6);
        _mint(alice, 10_000e6);
        uint256 rate = token.fundingRatePerSec();
        assertGt(rate, pool.fundingBasePerSec(), "utilisation raises funding");

        uint256 navNow = token.navAt(lastPx, clockT);
        uint256 navLater = token.navAt(lastPx, clockT + 1 days);
        assertLt(navLater, navNow);
        assertApproxEqRel(navNow - navLater, navNow * rate * 1 days / 1e18, 0.01e18);
    }

    // ─────────── market hours ───────────

    function test_requestsQueueUntilTheNextSession() public {
        _deposit(100_000e6);
        // 21:00 — the market is closed; a rejected print still advances the replay clock
        _send(NXT, CONT, T0728_0800 + 13 * HOUR, 5, 5, 1_816_000);
        vm.prank(alice);
        uint256 id = pool.requestMint(1_000e6, 0, type(uint64).max);
        vm.expectRevert(K2XPool.NoNewPrice.selector);
        pool.settle(id);

        // next morning, the NXT pre-market warms up and publishes the first trusted price
        uint64 t = T0728_0800 + DAY;
        KMarkEngine.Decision d = KMarkEngine.Decision.HELD;
        for (uint64 i = 1; d != KMarkEngine.Decision.ACCEPTED && i < 20; ++i) {
            (d,) = _send(NXT, CONT, t + i, 5, 30, 1_820_000);
        }
        assertEq(uint8(d), uint8(KMarkEngine.Decision.ACCEPTED));
        assertTrue(pool.settle(id));
        assertEq(engine.priceAt(HYNIX, pool.requestOf(id).settledSeq).px, 1_820_000);
    }

    function test_expiredRequestIsRefunded() public {
        _deposit(100_000e6);
        uint64 nowT = engine.currentTime();
        vm.prank(alice);
        uint256 id = pool.requestMint(1_000e6, 0, nowT + 10);
        vm.expectRevert(K2XPool.NotExpired.selector);
        pool.cancel(id);

        _send(NXT, CONT, T0728_0800 + 13 * HOUR, 5, 5, 1_816_000); // clock moves past the expiry
        uint256 before = ausd.balanceOf(alice);
        pool.cancel(id);
        assertEq(ausd.balanceOf(alice) - before, 1_000e6);
    }

    // ─────────── NAV bounds ───────────

    /// Within the ±30% daily limit a daily-reset 2x token can never reach zero.
    function testFuzz_navStaysPositiveInsideTheBand(uint64 px) public view {
        px = uint64(bound(px, uint256(CLOSE_0727) * 70 / 100, uint256(CLOSE_0727) * 130 / 100));
        uint256 nav = token.grossNav(px);
        assertGt(nav, 0);
        int256 ret = int256(uint256(px)) * 1e18 / int256(uint256(CLOSE_0727)) - 1e18;
        assertApproxEqAbs(int256(nav), 10e18 + 20 * ret, 1e6);
    }
}
