// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title K2XToken
/// @notice Constant-leverage token with no liquidation. Leverage is reset once a day at the
///         KRX official close; between resets NAV = navBase × (1 + L × (P / P0 − 1)) × funding.
///         Only its pool can mint, burn or move escrowed balances.
contract K2XToken is ERC20 {
    error OnlyPool();
    error AlreadyInitialized();

    address public immutable pool;
    /// @notice Leverage in 1e18 units (2e18 = 2x long, -1e18 = 1x inverse).
    int256 public immutable leverage;

    uint256 public navBase; // NAV at the base close, 1e18 = 1 AUSD
    uint64 public basePx; // KRW close the NAV is measured from
    uint64 public baseSeq; // engine price sequence of that close
    uint64 public baseAt;
    uint32 public baseDay;
    uint256 public closeIdx; // index of the base close in the engine's close list

    uint256 public fundingFactor = 1e18; // decays as holders pay funding to the pool
    uint64 public lastAccrual;
    uint256 public fundingRatePerSec; // 1e18 = 100% per second

    event Rebased(uint32 indexed day, uint64 px, uint256 nav, uint64 seq);
    event FundingAccrued(uint64 at, uint256 factor, uint256 ratePerSec);

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(string memory name_, string memory symbol_, address pool_, int256 leverage_) ERC20(name_, symbol_) {
        pool = pool_;
        leverage = leverage_;
    }

    function init(uint64 px, uint64 seq, uint64 at, uint32 day, uint256 idx, uint256 nav0) external onlyPool {
        if (navBase != 0) revert AlreadyInitialized();
        navBase = nav0;
        basePx = px;
        baseSeq = seq;
        baseAt = at;
        baseDay = day;
        closeIdx = idx;
        lastAccrual = at;
        emit Rebased(day, px, nav0, seq);
    }

    // ─────────────────────────────── NAV ───────────────────────────────

    /// @notice Leveraged NAV before funding, at KRW price `px`.
    function grossNav(uint64 px) public view returns (uint256) {
        int256 ret = int256(uint256(px)) * 1e18 / int256(uint256(basePx)) - 1e18;
        int256 g = 1e18 + leverage * ret / 1e18;
        if (g <= 0) return 0;
        return navBase * uint256(g) / 1e18;
    }

    function factorAt(uint64 t) public view returns (uint256) {
        if (t <= lastAccrual) return fundingFactor;
        uint256 decay = fundingRatePerSec * (t - lastAccrual);
        if (decay >= 1e18) return 0;
        return fundingFactor * (1e18 - decay) / 1e18;
    }

    /// @notice NAV per token (1e18 = 1 AUSD) at KRW price `px` and time `t`.
    function navAt(uint64 px, uint64 t) public view returns (uint256) {
        return grossNav(px) * factorAt(t) / 1e18;
    }

    // ─────────────────────────────── Pool hooks ───────────────────────────────

    function accrue(uint64 t, uint256 newRatePerSec) external onlyPool {
        if (t > lastAccrual) {
            fundingFactor = factorAt(t);
            lastAccrual = t;
        }
        fundingRatePerSec = newRatePerSec;
        emit FundingAccrued(t, fundingFactor, newRatePerSec);
    }

    /// @notice Daily reset at an official close: fold leverage P&L and funding into navBase.
    function rebase(uint64 px, uint64 seq, uint64 at, uint32 day, uint256 idx) external onlyPool {
        uint256 nav = navAt(px, at);
        navBase = nav;
        basePx = px;
        baseSeq = seq;
        baseAt = at;
        baseDay = day;
        closeIdx = idx;
        fundingFactor = 1e18;
        if (at > lastAccrual) lastAccrual = at;
        emit Rebased(day, px, nav, seq);
    }

    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }

    /// @notice Escrow tokens for a redeem request without a separate approval.
    function pull(address from, uint256 amount) external onlyPool {
        _transfer(from, pool, amount);
    }

    /// @notice Return escrowed tokens when a redeem request is refunded.
    function push(address to, uint256 amount) external onlyPool {
        _transfer(pool, to, amount);
    }
}
