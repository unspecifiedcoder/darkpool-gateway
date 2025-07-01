// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title vAMM
 * @author Your Name
 * @notice A virtual automated market maker for price discovery in a perpetuals DEX.
 * It does not hold any real assets. The ClearingHouse will be its owner and primary user.
 */
contract vAMM is Ownable {
    using Math for uint256;

    // Virtual reserves of the two assets, scaled by 1e18
    uint256 public reserve0; // Virtual base asset reserve (e.g., vETH)
    uint256 public reserve1; // Virtual quote asset reserve (e.g., vUSD)

    // The constant product k = reserve0 * reserve1
    uint256 public k;

    // The address of the ClearingHouse contract, which is the only authorized interactor
    address public clearingHouse;

    modifier onlyClearingHouse() {
        require(msg.sender == clearingHouse, "vAMM: Caller is not the ClearingHouse");
        _;
    }

    /**
     * @notice Sets the initial reserves. The ratio of reserves determines the initial price.
     * @param _initialReserve0 The initial virtual reserve of the base asset.
     * @param _initialReserve1 The initial virtual reserve of the quote asset.
     */
    constructor(uint256 _initialReserve0, uint256 _initialReserve1) Ownable(msg.sender) {
        require(_initialReserve0 > 0 && _initialReserve1 > 0, "vAMM: Reserves must be positive");
        reserve0 = _initialReserve0;
        reserve1 = _initialReserve1;
        k = _initialReserve0 * _initialReserve1;
    }

    /**
     * @notice Sets the ClearingHouse contract address. Can only be called once by the deployer.
     * @param _clearingHouse The address of the ClearingHouse contract.
     */
    function setClearingHouse(address _clearingHouse) external onlyOwner {
        require(clearingHouse == address(0), "vAMM: ClearingHouse already set");
        clearingHouse = _clearingHouse;
    }

    /**
     * @notice Returns the current spot price of the base asset in terms of the quote asset.
     * @return The price of reserve0 in terms of reserve1, scaled by 1e18.
     */
    function getPrice() public view returns (uint256) {
        if (reserve0 == 0) return 0;
        return (reserve1 * 1e18) / reserve0;
    }

    /**
     * @notice Simulates a swap to update the virtual reserves and returns the effective price.
     * This function is called by the ClearingHouse to open and close positions.
     * @param _amount1In The amount of the quote asset being traded.
     * @return The average price of the base asset received per unit of quote asset.
     */
    function swap(uint256 _amount1In) external onlyClearingHouse returns (uint256) {
        require(_amount1In > 0, "vAMM: Input amount must be positive");

        uint256 amount1InWithFee = (_amount1In * 997) / 1000; // A 0.3% fee can be represented here
        uint256 newReserve1 = reserve1 + amount1InWithFee;
        uint256 newReserve0 = k / newReserve1;

        uint256 amount0Out = reserve0 - newReserve0;
        
        reserve0 = newReserve0;
        reserve1 = newReserve1;

        // Return the average price for this trade: total quote out / total base in
        return (amount0Out * 1e18) / _amount1In;
    }
}