// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/**
 * @title PublicFaucet
 * @author Your Name
 * @notice A public faucet that allows anyone to mint a limited amount of a specific MockERC20 token.
 * This contract must be granted the MINTER_ROLE on the target MockERC20 token.
 */
contract PublicFaucet {
    MockERC20 public immutable token;

    // To prevent abuse on a public testnet, we'll cap mints at 10,000 USDC per request.
    uint256 public constant MAX_MINT_AMOUNT = 10_000 * 1e18;

    event TokensRequested(address indexed receiver, uint256 amount);

    /**
     * @param _tokenAddress The address of the MockERC20 contract this faucet will control.
     */
    constructor(address _tokenAddress) {
        token = MockERC20(_tokenAddress);
    }

    /**
     * @notice Mints a specified amount of tokens to the original transaction sender (your wallet).
     * @dev Using tx.origin is generally discouraged in production contracts due to security risks,
     * but it is perfectly acceptable and convenient for a simple testnet faucet like this,
     * as it ensures the EOA that initiated the transaction receives the funds.
     */
    function requestTokens(uint256 _amount) external {
        require(_amount > 0, "Faucet: Amount must be positive");
        require(_amount <= MAX_MINT_AMOUNT, "Faucet: Amount exceeds maximum limit");
        
        // This contract calls the mint function on behalf of the user.
        token.mint(tx.origin, _amount);

        emit TokensRequested(tx.origin, _amount);
    }
}