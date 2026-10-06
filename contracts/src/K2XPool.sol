// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {KMarkEngine} from "./KMarkEngine.sol";
import {K2XToken} from "./K2XToken.sol";

/// @title K2XPool
/// @notice AUSD liquidity pool that is the counterparty of one K2X leveraged token.
///         Every mint, redeem, LP deposit and LP withdrawal is a request that settles at the
///         first trusted K-Mark price formed entirely after the request (forward pricing), so no
///         one can trade against a stale or same-transaction price. Outside market hours requests
///         simply wait for the next session's first trusted price.
/// @dev    Requests settle strictly in the order they were made, so each one sees the pool as the
///         requests before it left it, and a daily reset is applied only after every request made
///         before it has settled. Token holders' claims (supply × NAV) are senior; LP equity is
///         what remains. The pool's loss if the stock runs to its daily limit is capped relative
///         to LP equity, and holders pay a funding rate re-priced from that utilisation.
contract K2XPool is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        MINT,
        REDEEM,
        DEPOSIT,
        WITHDRAW
    }

    enum Status {
        NONE,
        PENDING,
        SETTLED,
        REFUNDED
    }

    enum RefundReason {
        NONE,
        EXPIRED,
        SLIPPAGE,
        CAP,
        INSOLVENT
    }

    struct Request {
        address user;
        Kind kind;
        Status status;
        uint64 seq; // engine price sequence at request time; settles at seq + 1 or later
        uint64 createdAt; // engine time
        uint64 expiry; // engine time
        uint64 settledSeq;
        uint64 scanSeq; // next price seq to check while pending
        uint128 amountIn; // AUSD (token decimals) for MINT/DEPOSIT, 18-dp units for REDEEM/WITHDRAW
        uint128 minOut;
        uint128 amountOut;
    }

    struct Snapshot {
        uint64 px;
        uint64 priceAt;
        uint64 priceSeq;
        KMarkEngine.Session session;
        bool stale;
        uint256 nav; // 1e18 = 1 AUSD
        uint256 tokenSupply;
        uint256 lpSupply;
        uint256 assets; // 1e18 AUSD, excludes pending escrow
        uint256 liabilities; // 1e18 AUSD
        int256 equity; // 1e18 AUSD
        uint256 exposure; // 1e18 AUSD of stock exposure the pool is short (dollar delta)
        uint256 stressLoss; // 1e18 AUSD the pool loses if the stock reaches today's limit against it
        uint256 utilizationBps; // stressLoss / (equity × capBps)
        uint256 fundingRatePerSec;
        uint256 pendingRequests;
        uint32 baseDay;
        uint64 basePx;
    }

    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant MAX_SCAN = 16; // prices checked per request per call
    uint256 internal constant MAX_CLOSES = 32; // daily resets applied per call

    IERC20 public immutable ausd;
    uint256 public immutable ausdScale; // 10 ** (18 - AUSD decimals)
    KMarkEngine public immutable engine;
    bytes32 public immutable market;
    K2XToken public token;

    uint16 public feeBps = 10; // 0.10% on mint and redeem, kept by LPs
    uint16 public capBps = 1_500; // mints stop when a limit move would cost LPs over 15% of equity
    uint16 public withdrawCapBps = 3_000; // LP withdrawals stop at 30%, so LPs can leave a busy pool
    uint256 public minRequest = 10e18; // 10 AUSD; smaller requests only to close out a balance
    uint256 public fundingBasePerSec = uint256(0.05e18) / YEAR; // 5% a year
    uint256 public fundingMaxPerSec = uint256(0.2e18) / YEAR; // 20% a year at full utilisation

    uint256 public pendingAusd; // escrowed AUSD of pending MINT / DEPOSIT requests
    uint256 public pendingCount;
    uint256 public head; // requests before `head` are no longer pending
    Request[] internal _requests;
    mapping(address => uint256[]) internal _userRequests;

    event Requested(
        uint256 indexed id, address indexed user, Kind kind, uint256 amountIn, uint256 minOut, uint64 seq, uint64 expiry
    );
    event Settled(
        uint256 indexed id, address indexed user, Kind kind, uint256 amountIn, uint256 amountOut, uint64 priceSeq, uint64 px, uint256 nav
    );
    event Refunded(uint256 indexed id, address indexed user, Kind kind, uint256 amountIn, RefundReason reason);
    event FundingUpdated(uint256 ratePerSec, uint256 utilizationBps);
    event ParamsUpdated(
        uint16 feeBps, uint16 capBps, uint16 withdrawCapBps, uint256 minRequest, uint256 fundingBasePerSec, uint256 fundingMaxPerSec
    );

    error AlreadyInitialized();
    error WrongPool();
    error NotSeeded();
    error TooSmall();
    error NotPending();
    error NotExpired();
    error SettleInstead();
    error BadParams();

    constructor(
        IERC20 ausd_,
        uint8 ausdDecimals,
        KMarkEngine engine_,
        bytes32 market_,
        string memory lpName,
        string memory lpSymbol,
        address owner_
    ) ERC20(lpName, lpSymbol) Ownable(owner_) {
        ausd = ausd_;
        ausdScale = 10 ** (18 - ausdDecimals);
        engine = engine_;
        market = market_;
    }

    /// @notice Bind the leveraged token and start its NAV at `nav0` from the latest official close.
    function initialize(K2XToken token_, uint256 nav0) external onlyOwner {
        if (address(token) != address(0)) revert AlreadyInitialized();
        if (token_.pool() != address(this)) revert WrongPool();
        uint256 n = engine.closeCount(market);
        if (n == 0) revert NotSeeded();
        KMarkEngine.CloseRec memory c = engine.closeAt(market, n - 1);
        token = token_;
        token_.init(c.px, c.seq, c.at, c.day, n - 1, nav0);
        token_.accrue(c.at, fundingBasePerSec);
    }

    function setParams(
        uint16 feeBps_,
        uint16 capBps_,
        uint16 withdrawCapBps_,
        uint256 minRequest_,
        uint256 basePerSec,
        uint256 maxPerSec
    ) external onlyOwner {
        if (feeBps_ > 100 || capBps_ == 0 || withdrawCapBps_ < capBps_ || withdrawCapBps_ > BPS || basePerSec > maxPerSec) {
            revert BadParams();
        }
        feeBps = feeBps_;
        capBps = capBps_;
        withdrawCapBps = withdrawCapBps_;
        minRequest = minRequest_;
        fundingBasePerSec = basePerSec;
        fundingMaxPerSec = maxPerSec;
        emit ParamsUpdated(feeBps_, capBps_, withdrawCapBps_, minRequest_, basePerSec, maxPerSec);
    }

    // ─────────────────────────────── Requests ───────────────────────────────

    function requestMint(uint128 ausdIn, uint128 minTokensOut, uint64 expiry) external nonReentrant returns (uint256) {
        if (uint256(ausdIn) * ausdScale < minRequest) revert TooSmall();
        ausd.safeTransferFrom(msg.sender, address(this), ausdIn);
        pendingAusd += ausdIn;
        return _push(Kind.MINT, ausdIn, minTokensOut, expiry);
    }

    function requestRedeem(uint128 tokensIn, uint128 minAusdOut, uint64 expiry) external nonReentrant returns (uint256) {
        uint256 bal = token.balanceOf(msg.sender);
        if (tokensIn == 0 || (uint256(tokensIn) * token.navBase() / 1e18 < minRequest && tokensIn != bal)) revert TooSmall();
        token.pull(msg.sender, tokensIn);
        return _push(Kind.REDEEM, tokensIn, minAusdOut, expiry);
    }

    function requestDeposit(uint128 ausdIn, uint128 minSharesOut, uint64 expiry) external nonReentrant returns (uint256) {
        if (uint256(ausdIn) * ausdScale < minRequest) revert TooSmall();
        ausd.safeTransferFrom(msg.sender, address(this), ausdIn);
        pendingAusd += ausdIn;
        return _push(Kind.DEPOSIT, ausdIn, minSharesOut, expiry);
    }

    function requestWithdraw(uint128 sharesIn, uint128 minAusdOut, uint64 expiry) external nonReentrant returns (uint256) {
        if (sharesIn == 0 || (sharesIn < minRequest && sharesIn != balanceOf(msg.sender))) revert TooSmall();
        _transfer(msg.sender, address(this), sharesIn);
        return _push(Kind.WITHDRAW, sharesIn, minAusdOut, expiry);
    }

    /// @notice Settle pending requests in the order they were made, looking at up to `max`
    ///         requests. Stops at the first request whose price has not been published yet,
    ///         since every later request is newer. Anyone may call.
    function settleQueue(uint256 max) external nonReentrant returns (uint256 done) {
        uint256 n = _requests.length;
        uint256 i = head;
        for (uint256 steps; i < n && steps < max; ++steps) {
            Request storage q = _requests[i];
            if (q.status == Status.PENDING) {
                (bool found, uint64 useSeq) = _priceFor(q);
                if (!found) break;
                if (!_settleAt(i, q, useSeq)) break; // too many daily resets to apply in one call
                ++done;
            }
            ++i;
        }
        head = i;
    }

    /// @notice Refund a request whose expiry passed before any price formed after it arrived.
    function cancel(uint256 id) external nonReentrant {
        Request storage q = _requests[id];
        if (q.status != Status.PENDING) revert NotPending();
        if (engine.currentTime() <= q.expiry) revert NotExpired();
        (bool found, uint64 useSeq) = _priceFor(q);
        if (found && engine.priceAt(market, useSeq).at <= q.expiry) revert SettleInstead();
        if (!found && q.scanSeq <= engine.priceSeq(market)) revert SettleInstead(); // not fully scanned yet
        _refund(id, q, RefundReason.EXPIRED);
    }

    /// @notice Apply official closes (daily leverage reset) and re-price funding. Anyone may call.
    /// @dev    A close is applied only once every request made before it has settled, so no
    ///         request can be moved from its own price to a later close.
    function sync() external nonReentrant {
        uint64 latestSeq = engine.priceSeq(market);
        bool idle = head == _requests.length;
        _applyClosesUpTo(idle ? latestSeq : _requests[head].seq);
        if (!idle || latestSeq == 0) return;
        KMarkEngine.PricePoint memory p = engine.priceAt(market, latestSeq);
        token.accrue(p.at, token.fundingRatePerSec());
        _updateFunding(p.px, p.at);
    }

    // ─────────────────────────────── Views ───────────────────────────────

    function requestCount() external view returns (uint256) {
        return _requests.length;
    }

    function requestOf(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function userRequests(address user) external view returns (uint256[] memory) {
        return _userRequests[user];
    }

    /// @notice Pending request ids in [start, start + limit); used by keepers and the UI.
    function pendingIds(uint256 start, uint256 limit) external view returns (uint256[] memory ids) {
        uint256 end = start + limit;
        if (end > _requests.length) end = _requests.length;
        uint256 n;
        for (uint256 i = start; i < end; ++i) {
            if (_requests[i].status == Status.PENDING) ++n;
        }
        ids = new uint256[](n);
        n = 0;
        for (uint256 i = start; i < end; ++i) {
            if (_requests[i].status == Status.PENDING) ids[n++] = i;
        }
    }

    function snapshot() external view returns (Snapshot memory s) {
        (s.px, s.priceAt, s.priceSeq, s.session, s.stale) = engine.latest(market);
        uint64 t = engine.currentTime();
        if (t < s.priceAt) t = s.priceAt;
        uint64 px = s.px == 0 ? token.basePx() : s.px;
        s.nav = token.navAt(px, t);
        s.tokenSupply = token.totalSupply();
        s.lpSupply = totalSupply();
        s.assets = (ausd.balanceOf(address(this)) - pendingAusd) * ausdScale;
        s.liabilities = s.tokenSupply * s.nav / 1e18;
        s.equity = int256(s.assets) - int256(s.liabilities);
        (s.exposure, s.stressLoss) = _risk(s.tokenSupply, px, t);
        s.utilizationBps = _utilization(s.assets, s.liabilities, s.stressLoss);
        s.fundingRatePerSec = token.fundingRatePerSec();
        s.pendingRequests = pendingCount;
        s.baseDay = token.baseDay();
        s.basePx = token.basePx();
    }

    // ─────────────────────────────── Settlement ───────────────────────────────

    function _push(Kind k, uint128 amountIn, uint128 minOut, uint64 expiry) internal returns (uint256 id) {
        id = _requests.length;
        uint64 seq = engine.priceSeq(market);
        _requests.push(
            Request({
                user: msg.sender,
                kind: k,
                status: Status.PENDING,
                seq: seq,
                createdAt: engine.currentTime(),
                expiry: expiry,
                settledSeq: 0,
                scanSeq: seq + 1,
                amountIn: amountIn,
                minOut: minOut,
                amountOut: 0
            })
        );
        ++pendingCount;
        _userRequests[msg.sender].push(id);
        emit Requested(id, msg.sender, k, amountIn, minOut, seq, expiry);
    }

    /// @dev First price at or after seq + 1 that was formed entirely after the request, or the
    ///      first price past the request's expiry. Progress is kept in `scanSeq`.
    function _priceFor(Request storage q) internal returns (bool found, uint64 useSeq) {
        uint64 latestSeq = engine.priceSeq(market);
        uint64 s = q.scanSeq;
        for (uint256 k; s <= latestSeq && k < MAX_SCAN; ++k) {
            KMarkEngine.PricePoint memory p = engine.priceAt(market, s);
            if (p.from >= q.createdAt || p.at > q.expiry) return (true, s);
            ++s;
        }
        q.scanSeq = s;
    }

    /// @return false if daily resets up to `useSeq` could not all be applied in this call
    function _settleAt(uint256 id, Request storage q, uint64 useSeq) internal returns (bool) {
        KMarkEngine.PricePoint memory p = engine.priceAt(market, useSeq);
        q.settledSeq = useSeq;
        if (p.at > q.expiry) {
            _refund(id, q, RefundReason.EXPIRED);
            return true;
        }
        // daily resets up to the settlement price come first; NAV is continuous across a reset
        if (!_applyClosesUpTo(useSeq)) return false;

        token.accrue(p.at, token.fundingRatePerSec());
        uint256 nav = token.navAt(p.px, p.at);

        if (q.kind == Kind.MINT) _settleMint(id, q, p, nav);
        else if (q.kind == Kind.REDEEM) _settleRedeem(id, q, p, nav);
        else if (q.kind == Kind.DEPOSIT) _settleDeposit(id, q, p);
        else _settleWithdraw(id, q, p);

        _updateFunding(p.px, p.at);
        return true;
    }

    function _settleMint(uint256 id, Request storage q, KMarkEngine.PricePoint memory p, uint256 nav)
        internal
        returns (bool)
    {
        if (nav == 0) return _refund(id, q, RefundReason.INSOLVENT);
        uint256 in18 = uint256(q.amountIn) * ausdScale;
        uint256 fee = in18 * feeBps / BPS;
        uint256 out = (in18 - fee) * 1e18 / nav;
        if (out < q.minOut) return _refund(id, q, RefundReason.SLIPPAGE);

        (uint256 assets,) = _balances(p.px, p.at);
        uint256 assetsAfter = assets + in18;
        uint256 supplyAfter = token.totalSupply() + out;
        uint256 liabAfter = supplyAfter * nav / 1e18;
        if (assetsAfter <= liabAfter) return _refund(id, q, RefundReason.CAP);
        (, uint256 stress) = _risk(supplyAfter, p.px, p.at);
        if (stress * BPS > (assetsAfter - liabAfter) * capBps) return _refund(id, q, RefundReason.CAP);

        pendingAusd -= q.amountIn;
        _close(q, out);
        token.mint(q.user, out);
        emit Settled(id, q.user, Kind.MINT, q.amountIn, out, q.settledSeq, p.px, nav);
        return true;
    }

    function _settleRedeem(uint256 id, Request storage q, KMarkEngine.PricePoint memory p, uint256 nav)
        internal
        returns (bool)
    {
        uint256 tokens = q.amountIn;
        uint256 gross = tokens * nav / 1e18;
        uint256 pay18 = gross - gross * feeBps / BPS;
        (uint256 assets, uint256 liab) = _balances(p.px, p.at);
        if (liab > assets) pay18 = pay18 * assets / liab; // pro-rata if LP capital is exhausted
        uint256 pay = pay18 / ausdScale;
        if (pay < q.minOut) return _refund(id, q, RefundReason.SLIPPAGE);

        _close(q, pay);
        token.burn(address(this), tokens);
        ausd.safeTransfer(q.user, pay);
        emit Settled(id, q.user, Kind.REDEEM, tokens, pay, q.settledSeq, p.px, nav);
        return true;
    }

    function _settleDeposit(uint256 id, Request storage q, KMarkEngine.PricePoint memory p) internal returns (bool) {
        uint256 in18 = uint256(q.amountIn) * ausdScale;
        uint256 supply = totalSupply();
        uint256 shares;
        if (supply == 0) {
            shares = in18;
        } else {
            (uint256 assets, uint256 liab) = _balances(p.px, p.at);
            if (assets <= liab) return _refund(id, q, RefundReason.INSOLVENT);
            shares = in18 * supply / (assets - liab);
        }
        if (shares < q.minOut) return _refund(id, q, RefundReason.SLIPPAGE);

        pendingAusd -= q.amountIn;
        _close(q, shares);
        _mint(q.user, shares);
        emit Settled(id, q.user, Kind.DEPOSIT, q.amountIn, shares, q.settledSeq, p.px, 0);
        return true;
    }

    function _settleWithdraw(uint256 id, Request storage q, KMarkEngine.PricePoint memory p) internal returns (bool) {
        uint256 shares = q.amountIn;
        (uint256 assets, uint256 liab) = _balances(p.px, p.at);
        if (assets <= liab) return _refund(id, q, RefundReason.INSOLVENT);
        uint256 equity = assets - liab;
        uint256 out18 = shares * equity / totalSupply();
        (, uint256 stress) = _risk(token.totalSupply(), p.px, p.at);
        if (stress * BPS > (equity - out18) * withdrawCapBps) return _refund(id, q, RefundReason.CAP);
        uint256 out = out18 / ausdScale;
        if (out < q.minOut) return _refund(id, q, RefundReason.SLIPPAGE);

        _close(q, out);
        _burn(address(this), shares);
        ausd.safeTransfer(q.user, out);
        emit Settled(id, q.user, Kind.WITHDRAW, shares, out, q.settledSeq, p.px, 0);
        return true;
    }

    function _close(Request storage q, uint256 out) internal {
        q.status = Status.SETTLED;
        q.amountOut = uint128(out);
        --pendingCount;
    }

    function _refund(uint256 id, Request storage q, RefundReason why) internal returns (bool) {
        q.status = Status.REFUNDED;
        --pendingCount;
        if (q.kind == Kind.MINT || q.kind == Kind.DEPOSIT) {
            pendingAusd -= q.amountIn;
            ausd.safeTransfer(q.user, q.amountIn);
        } else if (q.kind == Kind.REDEEM) {
            token.push(q.user, q.amountIn);
        } else {
            _transfer(address(this), q.user, q.amountIn);
        }
        emit Refunded(id, q.user, q.kind, q.amountIn, why);
        return false;
    }

    // ─────────────────────────────── Accounting ───────────────────────────────

    /// @return caughtUp true when every close up to `seq` has been applied
    function _applyClosesUpTo(uint64 seq) internal returns (bool caughtUp) {
        uint256 n = engine.closeCount(market);
        uint256 idx = token.closeIdx();
        for (uint256 steps; idx + 1 < n; ++steps) {
            KMarkEngine.CloseRec memory c = engine.closeAt(market, idx + 1);
            if (c.seq > seq) return true;
            if (steps == MAX_CLOSES) return false;
            token.rebase(c.px, c.seq, c.at, c.day, idx + 1);
            ++idx;
        }
        return true;
    }

    function _balances(uint64 px, uint64 t) internal view returns (uint256 assets, uint256 liab) {
        assets = (ausd.balanceOf(address(this)) - pendingAusd) * ausdScale;
        liab = token.totalSupply() * token.navAt(px, t) / 1e18;
    }

    /// @notice The pool's price risk for `supply` tokens at KRW price `px` and time `t`.
    /// @return exposure dollar value of the stock position the pool is effectively short
    /// @return stress   what the pool loses if the stock moves to today's daily limit against it
    function _risk(uint256 supply, uint64 px, uint64 t) internal view returns (uint256 exposure, uint256 stress) {
        int256 lev = token.leverage();
        uint256 absLev = uint256(lev >= 0 ? lev : -lev);
        uint256 basePx = token.basePx();
        // d(liabilities)/d(price) is constant between resets: L × supply × navBase × funding / P0
        uint256 perPx = supply * token.navBase() / 1e18 * token.factorAt(t) / 1e18 * absLev / 1e18;
        exposure = perPx * px / basePx;
        (uint16 bandBps,,,,,,,,,,) = engine.params();
        uint256 limit = lev >= 0 ? basePx * (BPS + bandBps) / BPS : basePx * (BPS - bandBps) / BPS;
        uint256 move = lev >= 0 ? (limit > px ? limit - px : 0) : (px > limit ? px - limit : 0);
        stress = perPx * move / basePx;
    }

    function _utilization(uint256 assets, uint256 liab, uint256 stress) internal view returns (uint256) {
        if (assets <= liab) return BPS;
        uint256 room = (assets - liab) * capBps / BPS;
        if (room == 0) return BPS;
        uint256 u = stress * BPS / room;
        return u > BPS ? BPS : u;
    }

    function _updateFunding(uint64 px, uint64 t) internal {
        (uint256 assets, uint256 liab) = _balances(px, t);
        (, uint256 stress) = _risk(token.totalSupply(), px, t);
        uint256 util = _utilization(assets, liab, stress);
        uint256 rate = fundingBasePerSec + (fundingMaxPerSec - fundingBasePerSec) * util / BPS;
        token.accrue(t, rate);
        emit FundingUpdated(rate, util);
    }
}
