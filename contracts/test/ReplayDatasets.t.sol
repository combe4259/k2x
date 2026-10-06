// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {KMarkEngine} from "../src/KMarkEngine.sol";
import {EngineBase} from "./Base.t.sol";

/// @notice Feeds the exact datasets the demo uses (data/replays, data/sandbox) through the engine.
contract ReplayDatasetsTest is EngineBase {
    bytes32 internal constant ACCEPTED_SIG = keccak256("PriceAccepted(bytes32,uint64,uint64,uint64,uint8,uint8)");
    bytes32 internal constant REJECTED_SIG = keccak256("PriceRejected(bytes32,uint8,uint64,uint64,uint8)");

    struct Outcome {
        uint256 accepted;
        uint256 unconfirmed;
        uint64 firstAcceptedAt;
        uint64 minAccepted;
        uint64 maxAccepted;
        bool badPrintAccepted;
        bool badPrintRejected;
    }

    function _replay(string memory path, bytes32 market, uint64 badPx) internal returns (Outcome memory o) {
        string memory json = vm.readFile(path);
        engine = new KMarkEngine(KMarkEngine.ClockMode.REPLAY, address(this));
        engine.setRelayer(address(this), true);
        engine.listMarket(market, "dataset");
        engine.seedClose(
            market, uint32(vm.parseJsonUint(json, ".seedClose.day")), uint64(vm.parseJsonUint(json, ".seedClose.px"))
        );

        uint256 n = vm.parseJsonUint(json, ".count");
        vm.recordLogs();
        for (uint256 i; i < n; ++i) {
            engine.submit(_report(json, i, market));
        }

        o.minAccepted = type(uint64).max;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == ACCEPTED_SIG) {
                (uint64 px, uint64 at,,) = abi.decode(logs[i].data, (uint64, uint64, uint8, uint8));
                ++o.accepted;
                if (o.firstAcceptedAt == 0) o.firstAcceptedAt = at;
                if (px < o.minAccepted) o.minAccepted = px;
                if (px > o.maxAccepted) o.maxAccepted = px;
                if (px == badPx) o.badPrintAccepted = true;
            } else if (logs[i].topics[0] == REJECTED_SIG) {
                (uint8 reason, uint64 px,,) = abi.decode(logs[i].data, (uint8, uint64, uint64, uint8));
                if (reason == uint8(KMarkEngine.Reason.JUMP_UNCONFIRMED)) {
                    ++o.unconfirmed;
                    if (px == badPx) o.badPrintRejected = true;
                }
            }
        }
    }

    function _report(string memory json, uint256 i, bytes32 market) internal pure returns (KMarkEngine.Report memory r) {
        string memory k = string.concat(".reports[", vm.toString(i), "]");
        r.market = market;
        r.venue = uint8(vm.parseJsonUint(json, string.concat(k, ".venue")));
        r.kind = uint8(vm.parseJsonUint(json, string.concat(k, ".kind")));
        r.windowStart = uint64(vm.parseJsonUint(json, string.concat(k, ".windowStart")));
        r.windowEnd = uint64(vm.parseJsonUint(json, string.concat(k, ".windowEnd")));
        r.trades = uint32(vm.parseJsonUint(json, string.concat(k, ".trades")));
        r.volume = uint64(vm.parseJsonUint(json, string.concat(k, ".volume")));
        r.notional = uint128(vm.parseJsonUint(json, string.concat(k, ".notional")));
        r.firstPx = uint64(vm.parseJsonUint(json, string.concat(k, ".firstPx")));
        r.lastPx = uint64(vm.parseJsonUint(json, string.concat(k, ".lastPx")));
        r.highPx = uint64(vm.parseJsonUint(json, string.concat(k, ".highPx")));
        r.lowPx = uint64(vm.parseJsonUint(json, string.concat(k, ".lowPx")));
        r.vwapPx = uint64(vm.parseJsonUint(json, string.concat(k, ".vwapPx")));
        r.flags = uint16(vm.parseJsonUint(json, string.concat(k, ".flags")));
    }

    function test_dataset_0728() public {
        Outcome memory o = _replay("../data/replays/2026-07-28_000660.json", HYNIX, 1_272_000);
        assertFalse(o.badPrintAccepted, "1-share print never trusted");
        assertTrue(o.badPrintRejected, "1-share print explicitly rejected");
        assertLe(o.firstAcceptedAt, T0728_0800 + 10, "real gap followed within 10 seconds");
        assertGe(o.minAccepted, 1_600_000);
        assertLe(o.maxAccepted, 1_760_000);
        (uint64 px,,,,) = engine.latest(HYNIX);
        assertEq(px, 1_662_000, "KRX opening auction is the last trusted price");
    }

    function test_dataset_0806() public {
        uint64 t0 = T0806_0800;
        Outcome memory o = _replay("../data/replays/2026-08-06_000660.json", HYNIX, 1_168_000);
        assertFalse(o.badPrintAccepted);
        assertTrue(o.badPrintRejected);
        assertLe(o.firstAcceptedAt, t0 + 10);
        assertGe(o.minAccepted, 1_550_000);
    }

    function test_dataset_sandboxDay() public {
        Outcome memory o = _replay("../data/sandbox/2026-10-02_000660.json", keccak256("000660"), 0);
        assertGt(o.accepted, 300, "most minute bars are trusted");
        assertEq(engine.closeCount(keccak256("000660")), 2, "closing auction recorded");
    }
}
