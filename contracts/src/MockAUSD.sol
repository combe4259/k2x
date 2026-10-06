// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockAUSD
/// @notice Testnet stand-in for Agora AUSD (6 decimals) with a public faucet.
///         On mainnet K2X settles in real AUSD (0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a).
contract MockAUSD is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastClaim;
    mapping(address => bool) public minter;

    error Cooldown(uint256 availableAt);
    error NotMinter();

    constructor(address owner_) ERC20("Mock AUSD", "AUSD") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        _drip(msg.sender);
    }

    /// @notice Server-side faucet for embedded demo wallets.
    function faucetTo(address to) external {
        if (!minter[msg.sender] && msg.sender != owner()) revert NotMinter();
        _drip(to);
    }

    function mint(address to, uint256 amount) external {
        if (!minter[msg.sender] && msg.sender != owner()) revert NotMinter();
        _mint(to, amount);
    }

    function setMinter(address who, bool allowed) external onlyOwner {
        minter[who] = allowed;
    }

    function _drip(address to) internal {
        uint256 next = lastClaim[to] + FAUCET_COOLDOWN;
        if (lastClaim[to] != 0 && block.timestamp < next) revert Cooldown(next);
        lastClaim[to] = block.timestamp;
        _mint(to, FAUCET_AMOUNT);
    }
}
