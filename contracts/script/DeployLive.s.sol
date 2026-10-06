// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KMarkEngine} from "../src/KMarkEngine.sol";
import {K2XPool} from "../src/K2XPool.sol";
import {K2XToken} from "../src/K2XToken.sol";
import {MockAUSD} from "../src/MockAUSD.sol";

/// @notice Deploys the LIVE instance: an engine on the real clock fed by real-time KRX/NXT data,
///         with HYNIX2X and SMSN2X pools. Reuses MockAUSD from deployments/<chainid>.json.
///         Seed closes come from the environment (LIVE_HYNIX_DAY/PX, LIVE_SMSN_DAY/PX), fetched
///         by `relayer/src/cli/live-seed.ts` right before deploying. Only LIVE_RELAYER_ADDRESS (defaults
///         to the operator) may post prices; the operator keeps ownership.
contract DeployLive is Script {
    uint256 internal constant NAV0 = 10e18;
    uint128 internal constant SEED_LIQUIDITY = 1_000_000e6;

    function run() external {
        uint256 pk = vm.envUint("OPERATOR_PRIVATE_KEY");
        address op = vm.addr(pk);
        address relayer = vm.envOr("LIVE_RELAYER_ADDRESS", op);
        string memory base = vm.readFile(string.concat("../deployments/", vm.toString(block.chainid), ".json"));
        MockAUSD ausd = MockAUSD(vm.parseJsonAddress(base, ".ausd"));
        uint256 startBlock = block.number;

        bytes32 hynix = keccak256("000660");
        bytes32 smsn = keccak256("005930");

        vm.startBroadcast(pk);

        KMarkEngine live = new KMarkEngine(KMarkEngine.ClockMode.LIVE, op);
        live.setRelayer(relayer, true);
        _liveParams(live);
        _calendar(live);
        live.listMarket(hynix, "SK hynix");
        live.seedClose(hynix, uint32(vm.envUint("LIVE_HYNIX_DAY")), uint64(vm.envUint("LIVE_HYNIX_PX")));
        live.listMarket(smsn, "Samsung Electronics");
        live.seedClose(smsn, uint32(vm.envUint("LIVE_SMSN_DAY")), uint64(vm.envUint("LIVE_SMSN_PX")));

        (K2XPool hPool, K2XToken hTok) = _market(ausd, live, hynix, "K2X SK hynix 2X", "HYNIX2X", "k2xLP-HYNIX", op);
        (K2XPool sPool, K2XToken sTok) =
            _market(ausd, live, smsn, "K2X Samsung Electronics 2X", "SMSN2X", "k2xLP-SMSN", op);

        ausd.mint(op, 2 * uint256(SEED_LIQUIDITY));
        ausd.approve(address(hPool), type(uint256).max);
        ausd.approve(address(sPool), type(uint256).max);
        hPool.requestDeposit(SEED_LIQUIDITY, 0, type(uint64).max);
        sPool.requestDeposit(SEED_LIQUIDITY, 0, type(uint64).max);

        vm.stopBroadcast();

        string memory k = "live";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeAddress(k, "operator", op);
        vm.serializeAddress(k, "relayer", relayer);
        vm.serializeAddress(k, "ausd", address(ausd));
        vm.serializeAddress(k, "liveEngine", address(live));
        vm.serializeAddress(k, "hynixPool", address(hPool));
        vm.serializeAddress(k, "hynixToken", address(hTok));
        vm.serializeAddress(k, "smsnPool", address(sPool));
        string memory out = vm.serializeAddress(k, "smsnToken", address(sTok));
        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".live.json");
        vm.writeJson(out, path);
        console2.log("live deployment written to", path);
    }

    /// Real-time data arrives as minute-ish windows with a heartbeat, so staleness is looser than
    /// the per-second default; everything else keeps the default rules.
    function _liveParams(KMarkEngine e) internal {
        (
            uint16 bandBps,
            uint16 jumpBps,
            uint16 confirmBandBps,
            uint32 warmupTrades,
            uint32 confirmWindow,
            ,
            uint32 maxFutureSkew,
            uint32 maxReportAge,
            uint128 warmupNotional,
            uint128 confirmNotional,
            uint128 auctionMinNotional
        ) = e.params();
        e.setParams(
            KMarkEngine.Params({
                bandBps: bandBps,
                jumpBps: jumpBps,
                confirmBandBps: confirmBandBps,
                warmupTrades: warmupTrades,
                confirmWindow: confirmWindow,
                staleAfter: 600,
                maxFutureSkew: maxFutureSkew,
                maxReportAge: maxReportAge,
                warmupNotional: warmupNotional,
                confirmNotional: confirmNotional,
                auctionMinNotional: auctionMinNotional
            })
        );
    }

    /// KRX holidays and special sessions through the judging period and the rest of 2026.
    function _calendar(KMarkEngine e) internal {
        e.setHoliday(20735, true); // 2026-10-09 Hangul Day
        e.setHoliday(20812, true); // 2026-12-25 Christmas
        e.setHoliday(20818, true); // 2026-12-31 year-end closing day
        e.setHoliday(20819, true); // 2027-01-01 New Year's Day
        e.setDayShift(20776, 1 hours); // 2026-11-19 college entrance exam: sessions start an hour late
    }

    function _market(
        MockAUSD ausd,
        KMarkEngine engine,
        bytes32 market,
        string memory name,
        string memory symbol,
        string memory lpSymbol,
        address op
    ) internal returns (K2XPool pool, K2XToken token) {
        pool = new K2XPool(IERC20(address(ausd)), 6, engine, market, string.concat("K2X LP ", symbol), lpSymbol, op);
        token = new K2XToken(name, symbol, address(pool), 2e18);
        pool.initialize(token, NAV0);
    }
}
