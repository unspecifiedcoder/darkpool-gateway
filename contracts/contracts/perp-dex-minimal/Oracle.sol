// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Oracle
 * @author Your Name
 * @notice A simple price oracle controlled by an authorized updater.
 * In a real system, this would be replaced by a solution like Chainlink.
 */
contract Oracle is AccessControl {
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    // Price is stored with 18 decimals of precision (e.g., $50,000 is 50000 * 1e18)
    uint256 public price;

    event PriceUpdated(uint256 newPrice, uint256 timestamp);

    constructor(uint256 _initialPrice) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPDATER_ROLE, msg.sender); // The deployer can initially update the price
        setPrice(_initialPrice);
    }

    /**
     * @notice Returns the latest price from the oracle.
     */
    function getPrice() external view returns (uint256) {
        return price;
    }

    /**
     * @notice Allows an account with the UPDATER_ROLE to update the asset price.
     * @param _newPrice The new price for the asset, scaled by 1e18.
     */
    function setPrice(uint256 _newPrice) public onlyRole(UPDATER_ROLE) {
        require(_newPrice > 0, "Oracle: Price must be positive");
        price = _newPrice;
        emit PriceUpdated(_newPrice, block.timestamp);
    }
}