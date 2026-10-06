// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KMarkEngine} from "../src/KMarkEngine.sol";
import {K2XPool} from "../src/K2XPool.sol";
import {K2XToken} from "../src/K2XToken.sol";
import {MockAUSD} from "../src/MockAUSD.sol";

/// @notice Deploys the three K2X instances:
///   - incident engine (REPLAY clock): 7/28 and 8/6 SK hynix pre-market replays
///   - sandbox engine (REPLAY clock): a real KRX session replayed minute by minute, with
///     HYNIX2X / SMSN2X pools that anyone can mint, redeem and provide liquidity to
///   - MockAUSD (testnet stand-in for Agora AUSD)
/// Roles: the operator key owns everything and records the incident replays; the web server's key
/// (WEB_SIGNER_ADDRESS, defaults to the operator) steps the sandbox and runs the AUSD faucet.
/// Writes addresses to ../deployments/<chainid>.json for the relayer and the web app.
contract Deploy is Script {
    uint256 internal constant NAV0 = 10e18; // tokens start at 10 AUSD
    uint128 internal constant SEED_LIQUIDITY = 1_000_000e6;

    struct Market {
        K2XPool pool;
        K2XToken token;
    }

    function run() external {
        uint256 pk = vm.envUint("OPERATOR_PRIVATE_KEY");
        address op = vm.addr(pk);
        address web = vm.envOr("WEB_SIGNER_ADDRESS", op);
        uint256 startBlock = block.number;

        string memory r0728 = vm.readFile("../data/replays/2026-07-28_000660.json");
        string memory r0806 = vm.readFile("../data/replays/2026-08-06_000660.json");
        string memory sbH = vm.readFile("../data/sandbox/2026-10-02_000660.json");
        string memory sbS = vm.readFile("../data/sandbox/2026-10-02_005930.json");

        bytes32 m0728 = keccak256("000660@2026-07-28");
        bytes32 m0806 = keccak256("000660@2026-08-06");
        bytes32 hynix = keccak256("000660");
        bytes32 smsn = keccak256("005930");

        vm.startBroadcast(pk);

        MockAUSD ausd = new MockAUSD(op);
        if (web != op) ausd.setMinter(web, true);

        KMarkEngine incident = new KMarkEngine(KMarkEngine.ClockMode.REPLAY, op);
        incident.setRelayer(op, true);
        incident.listMarket(m0728, "SK hynix 2026-07-28");
        incident.seedClose(m0728, _day(r0728), _px(r0728));
        incident.listMarket(m0806, "SK hynix 2026-08-06");
        incident.seedClose(m0806, _day(r0806), _px(r0806));

        KMarkEngine sandbox = new KMarkEngine(KMarkEngine.ClockMode.REPLAY, op);
        sandbox.setRelayer(op, true);
        if (web != op) sandbox.setRelayer(web, true);
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
        ) = sandbox.params();
        sandbox.setParams(
            KMarkEngine.Params({
                bandBps: bandBps,
                jumpBps: jumpBps,
                confirmBandBps: confirmBandBps,
                warmupTrades: warmupTrades,
                confirmWindow: confirmWindow * 3, // minute bars: allow a couple of bars to confirm
                staleAfter: 180, // minute bars
                maxFutureSkew: maxFutureSkew,
                maxReportAge: maxReportAge,
                warmupNotional: warmupNotional,
                confirmNotional: confirmNotional,
                auctionMinNotional: auctionMinNotional
            })
        );
        sandbox.listMarket(hynix, "SK hynix");
        sandbox.seedClose(hynix, _day(sbH), _px(sbH));
        sandbox.listMarket(smsn, "Samsung Electronics");
        sandbox.seedClose(smsn, _day(sbS), _px(sbS));

        Market memory h = _market(ausd, sandbox, hynix, "K2X SK hynix 2X", "HYNIX2X", "k2xLP-HYNIX");
        Market memory s = _market(ausd, sandbox, smsn, "K2X Samsung Electronics 2X", "SMSN2X", "k2xLP-SMSN");

        // seed LP liquidity; it settles at the first sandbox price
        ausd.mint(op, 2 * uint256(SEED_LIQUIDITY));
        ausd.approve(address(h.pool), type(uint256).max);
        ausd.approve(address(s.pool), type(uint256).max);
        h.pool.requestDeposit(SEED_LIQUIDITY, 0, type(uint64).max);
        s.pool.requestDeposit(SEED_LIQUIDITY, 0, type(uint64).max);

        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeAddress(k, "operator", op);
        vm.serializeAddress(k, "webSigner", web);
        vm.serializeAddress(k, "ausd", address(ausd));
        vm.serializeAddress(k, "incidentEngine", address(incident));
        vm.serializeAddress(k, "sandboxEngine", address(sandbox));
        vm.serializeAddress(k, "hynixPool", address(h.pool));
        vm.serializeAddress(k, "hynixToken", address(h.token));
        vm.serializeAddress(k, "smsnPool", address(s.pool));
        string memory out = vm.serializeAddress(k, "smsnToken", address(s.token));
        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("deployment written to", path);
    }

    function _market(
        MockAUSD ausd,
        KMarkEngine engine,
        bytes32 market,
        string memory name,
        string memory symbol,
        string memory lpSymbol
    ) internal returns (Market memory m) {
        m.pool = new K2XPool(
            IERC20(address(ausd)), 6, engine, market, string.concat("K2X LP ", symbol), lpSymbol, vm.addr(vm.envUint("OPERATOR_PRIVATE_KEY"))
        );
        m.token = new K2XToken(name, symbol, address(m.pool), 2e18);
        m.pool.initialize(m.token, NAV0);
    }

    function _day(string memory json) internal pure returns (uint32) {
        return uint32(vm.parseJsonUint(json, ".seedClose.day"));
    }

    function _px(string memory json) internal pure returns (uint64) {
        return uint64(vm.parseJsonUint(json, ".seedClose.px"));
    }
}
