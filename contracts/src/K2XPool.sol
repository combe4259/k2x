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
///         first trusted K-Mark price published after the request (forward pricing), so no one
///         can trade against a stale or same-transaction price. Outside market hours requests
///         simply wait for the next session's first trusted price.
/// @dev    Token holders' claims (supply × NAV) are senior; LP equity is what remains.
///         Leveraged exposure is capped relative to LP equity and holders pay a funding rate
///         that is re-priced from pool utilisation on every interaction.
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
        uint256 exposure; // 1e18 AUSD of leveraged exposure
        uint256 utilizationBps; // exposure / cap
        uint256 fundingRatePerSec;
        uint256 pendingRequests;
        uint32 baseDay;
        uint64 basePx;
    }

    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;

    IERC20 public immutable ausd;
    uint256 public immutable ausdScale; // 10 ** (18 - AUSD decimals)
    KMarkEngine public immutable engine;
    bytes32 public immutable market;
    K2XToken public token;

    uint16 public feeBps = 10; // 0.10% on mint and redeem, kept by LPs
    uint16 public capBps = 5_000; // leveraged exposure ≤ 50% of LP equity
    uint256 public fundingBasePerSec = uint256(0.05e18) / YEAR; // 5% a year
    uint256 public fundingMaxPerSec = uint256(0.2e18) / YEAR; // 20% a year at full utilisation

    uint256 public pendingAusd; // escrowed AUSD of pending MINT / DEPOSIT requests
    uint256 public pendingCount;
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
    event ParamsUpdated(uint16 feeBps, uint16 capBps, uint256 fundingBasePerSec, uint256 fundingMaxPerSec);

    error AlreadyInitialized();
    error WrongPool();
    error NotSeeded();
    error ZeroAmount();
    error NotPending();
    error NoNewPrice();
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

    function setParams(uint16 feeBps_, uint16 capBps_, uint256 basePerSec, uint256 maxPerSec) external onlyOwner {
        if (feeBps_ > 100 || capBps_ == 0 || capBps_ > BPS || basePerSec > maxPerSec) revert BadParams();
        feeBps = feeBps_;
        capBps = capBps_;
        fundingBasePerSec = basePerSec;
        fundingMaxPerSec = maxPerSec;
        emit ParamsUpdated(feeBps_, capBps_, basePerSec, maxPerSec);
    }

    // ─────────────────────────────── Requests ───────────────────────────────

    function requestMint(uint128 ausdIn, uint128 minTokensOut, uint64 expiry) external nonReentrant returns (uint256) {
        if (ausdIn == 0) revert ZeroAmount();
        ausd.safeTransferFrom(msg.sender, address(this), ausdIn);
        pendingAusd += ausdIn;
        return _push(Kind.MINT, ausdIn, minTokensOut, expiry);
    }

    function requestRedeem(uint128 tokensIn, uint128 minAusdOut, uint64 expiry) external nonReentrant returns (uint256) {
        if (tokensIn == 0) revert ZeroAmount();
        token.pull(msg.sender, tokensIn);
        return _push(Kind.REDEEM, tokensIn, minAusdOut, expiry);
    }

    function requestDeposit(uint128 ausdIn, uint128 minSharesOut, uint64 expiry) external nonReentrant returns (uint256) {
        if (ausdIn == 0) revert ZeroAmount();
        ausd.safeTransferFrom(msg.sender, address(this), ausdIn);
        pendingAusd += ausdIn;
        return _push(Kind.DEPOSIT, ausdIn, minSharesOut, expiry);
    }

    function requestWithdraw(uint128 sharesIn, uint128 minAusdOut, uint64 expiry) external nonReentrant returns (uint256) {
        if (sharesIn == 0) revert ZeroAmount();
        _transfer(msg.sender, address(this), sharesIn);
        return _push(Kind.WITHDRAW, sharesIn, minAusdOut, expiry);
    }

    /// @notice Settle a request at the first trusted price after it was made. Anyone may call.
    function settle(uint256 id) external nonReentrant returns (bool) {
        return _settle(id);
    }

    /// @notice Keeper helper: settle every request in `ids` that can be settled now.
    function settleMany(uint256[] calldata ids) external nonReentrant returns (uint256 settled) {
        uint64 latestSeq = engine.priceSeq(market);
        for (uint256 i; i < ids.length; ++i) {
            Request storage q = _requests[ids[i]];
            if (q.status != Status.PENDING || q.seq >= latestSeq) continue;
            if (_settle(ids[i])) ++settled;
        }
    }

    /// @notice Refund a request whose expiry passed before any trusted price arrived.
    function cancel(uint256 id) external nonReentrant {
        Request storage q = _requests[id];
        if (q.status != Status.PENDING) revert NotPending();
        if (engine.currentTime() <= q.expiry) revert NotExpired();
        if (engine.priceSeq(market) > q.seq) {
            KMarkEngine.PricePoint memory p = engine.priceAt(market, q.seq + 1);
            if (p.at <= q.expiry) revert SettleInstead();
        }
        _refund(id, q, RefundReason.EXPIRED);
    }

    /// @notice Apply official closes (daily leverage reset) and re-price funding. Anyone may call.
    function sync() external nonReentrant {
        uint64 seq = engine.priceSeq(market);
        _applyClosesUpTo(seq);
        if (seq == 0) return;
        KMarkEngine.PricePoint memory p = engine.priceAt(market, seq);
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
        s.nav = s.px == 0 ? token.navBase() : token.navAt(s.px, t);
        s.tokenSupply = token.totalSupply();
        s.lpSupply = totalSupply();
        s.assets = (ausd.balanceOf(address(this)) - pendingAusd) * ausdScale;
        s.liabilities = s.tokenSupply * s.nav / 1e18;
        s.equity = int256(s.assets) - int256(s.liabilities);
        s.exposure = _exposure(s.liabilities);
        s.utilizationBps = _utilization(s.assets, s.liabilities);
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
                amountIn: amountIn,
                minOut: minOut,
                amountOut: 0
            })
        );
        ++pendingCount;
        _userRequests[msg.sender].push(id);
        emit Requested(id, msg.sender, k, amountIn, minOut, seq, expiry);
    }

    function _settle(uint256 id) internal returns (bool ok) {
        Request storage q = _requests[id];
        if (q.status != Status.PENDING) revert NotPending();
        uint64 useSeq = q.seq + 1;
        if (useSeq > engine.priceSeq(market)) revert NoNewPrice();

        // daily resets that happened up to the settlement price must be applied first
        _applyClosesUpTo(useSeq);
        uint64 baseSeq = token.baseSeq();
        if (useSeq < baseSeq) useSeq = baseSeq; // NAV is continuous across a reset

        KMarkEngine.PricePoint memory p = engine.priceAt(market, useSeq);
        q.settledSeq = useSeq;
        if (p.at > q.expiry) {
            _refund(id, q, RefundReason.EXPIRED);
            return false;
        }

        token.accrue(p.at, token.fundingRatePerSec());
        uint256 nav = token.navAt(p.px, p.at);

        if (q.kind == Kind.MINT) ok = _settleMint(id, q, p, nav);
        else if (q.kind == Kind.REDEEM) ok = _settleRedeem(id, q, p, nav);
        else if (q.kind == Kind.DEPOSIT) ok = _settleDeposit(id, q, p);
        else ok = _settleWithdraw(id, q, p);

        _updateFunding(p.px, p.at);
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
        uint256 liabAfter = (token.totalSupply() + out) * nav / 1e18;
        if (assetsAfter <= liabAfter) return _refund(id, q, RefundReason.CAP);
        if (_exposure(liabAfter) * BPS > (assetsAfter - liabAfter) * capBps) {
            return _refund(id, q, RefundReason.CAP);
        }

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
        if (_exposure(liab) * BPS > (equity - out18) * capBps) return _refund(id, q, RefundReason.CAP);
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

    function _applyClosesUpTo(uint64 seq) internal {
        uint256 n = engine.closeCount(market);
        uint256 idx = token.closeIdx();
        for (uint256 steps; idx + 1 < n && steps < 32; ++steps) {
            KMarkEngine.CloseRec memory c = engine.closeAt(market, idx + 1);
            if (c.seq > seq) break;
            token.rebase(c.px, c.seq, c.at, c.day, idx + 1);
            ++idx;
        }
    }

    function _balances(uint64 px, uint64 t) internal view returns (uint256 assets, uint256 liab) {
        assets = (ausd.balanceOf(address(this)) - pendingAusd) * ausdScale;
        liab = token.totalSupply() * token.navAt(px, t) / 1e18;
    }

    function _exposure(uint256 liab) internal view returns (uint256) {
        int256 lev = token.leverage();
        uint256 absLev = uint256(lev >= 0 ? lev : -lev);
        return liab * absLev / 1e18;
    }

    function _utilization(uint256 assets, uint256 liab) internal view returns (uint256) {
        if (assets <= liab) return BPS;
        uint256 capExposure = (assets - liab) * capBps / BPS;
        if (capExposure == 0) return BPS;
        uint256 u = _exposure(liab) * BPS / capExposure;
        return u > BPS ? BPS : u;
    }

    function _updateFunding(uint64 px, uint64 t) internal {
        (uint256 assets, uint256 liab) = _balances(px, t);
        uint256 util = _utilization(assets, liab);
        uint256 rate = fundingBasePerSec + (fundingMaxPerSec - fundingBasePerSec) * util / BPS;
        token.accrue(t, rate);
        emit FundingUpdated(rate, util);
    }
}
