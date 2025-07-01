// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPriceOracle {
    /**
     * @notice Gets the latest price of an asset.
     * @dev Price should be returned with a consistent number of decimals, e.g., 18 decimals.
     * @param baseAsset The asset for which to get the price (e.g., address of ETH representation if priced against USD)
     * @param quoteAsset The asset in which the price is denominated (e.g., address of USD representation)
     * @return price The price of the baseAsset denominated in quoteAsset.
     */
    function getPrice(address baseAsset, address quoteAsset) external view returns (uint256 price);

    // Later, we might add functionality for TWAP or specific price types (mark, index)
}