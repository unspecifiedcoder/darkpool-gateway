// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MockERC20
 * @author Your Name
 * @notice A mock ERC20 token with minting capabilities controlled by AccessControl.
 * This will be used for both the collateral (USDC) and base (BTC) assets.
 */
contract MockERC20 is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @notice Creates `amount` tokens for `to`, only callable by addresses with MINTER_ROLE.
     */
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}