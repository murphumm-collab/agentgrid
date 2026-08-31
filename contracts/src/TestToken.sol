// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet-only token. This contract is not a production token sale.
contract TestToken is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    mapping(address => uint256) public lastFaucetAt;

    error FaucetCoolingDown(uint256 availableAt);

    constructor(address initialOwner) ERC20("AgentGrid Test Token", "tAGT") Ownable(initialOwner) {}

    function faucet() external {
        uint256 availableAt = lastFaucetAt[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucetAt[msg.sender] != 0 && block.timestamp < availableAt) {
            revert FaucetCoolingDown(availableAt);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mintRewardReserve(address recipient, uint256 amount) external onlyOwner {
        _mint(recipient, amount);
    }
}
