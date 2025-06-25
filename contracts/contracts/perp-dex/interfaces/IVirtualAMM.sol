// contracts/interfaces/IVirtualAMM.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVirtualAMM {
    // Events
    event ReservesUpdated(uint256 newBaseReserve, uint256 newQuoteReserve);
    event Swap(address indexed trader, address indexed baseToken, bool isBaseToQuote, uint256 inputAmount, uint256 outputAmount);

    // State variables (conceptual, actual implementation in VirtualAMM.sol)
    // function baseAssetReserve() external view returns (uint256);
    // function quoteAssetReserve() external view returns (uint256);
    // function k() external view returns (uint256); // x * y = k

    /**
     * @notice Get the amount of quote asset received for a given amount of base asset.
     * @param amountBaseIn The amount of base asset to swap.
     * @return amountQuoteOut The amount of quote asset received.
     */
    function getQuoteAmountOut(uint256 amountBaseIn) external view returns (uint256 amountQuoteOut);

    /**
     * @notice Get the amount of base asset received for a given amount of quote asset.
     * @param amountQuoteIn The amount of quote asset to swap.
     * @return amountBaseOut The amount of base asset received.
     */
    function getBaseAmountOut(uint256 amountQuoteIn) external view returns (uint256 amountBaseOut);

    /**
     * @notice Simulates swapping base for quote asset and returns the output amount and new reserves.
     * Does NOT change state.
     * @param amountBaseIn Amount of base asset input.
     * @return amountQuoteOut Amount of quote asset output.
     * @return newBaseReserve The new virtual base reserve after the swap.
     * @return newQuoteReserve The new virtual quote reserve after the swap.
     */
    function swapBaseForQuotePreview(uint256 amountBaseIn)
        external
        view
        returns (uint256 amountQuoteOut, uint256 newBaseReserve, uint256 newQuoteReserve);

    /**
     * @notice Simulates swapping quote for base asset and returns the output amount and new reserves.
     * Does NOT change state.
     * @param amountQuoteIn Amount of quote asset input.
     * @return amountBaseOut Amount of base asset output.
     * @return newBaseReserve The new virtual base reserve after the swap.
     * @return newQuoteReserve The new virtual quote reserve after the swap.
     */
    function swapQuoteForBasePreview(uint256 amountQuoteIn)
        external
        view
        returns (uint256 amountBaseOut, uint256 newBaseReserve, uint256 newQuoteReserve);


    /**
     * @notice Swaps base asset for quote asset, updating virtual reserves.
     * This is called by the ClearingHouse.
     * @param amountBaseIn The amount of base asset to swap (positive for long, negative for short reduction/flip).
     * @return amountQuoteOut The amount of quote asset effectively swapped.
     */
    function swapBaseForQuote(uint256 amountBaseIn) external returns (uint256 amountQuoteOut);

    /**
     * @notice Swaps quote asset for base asset, updating virtual reserves.
     * This is called by the ClearingHouse.
     * @param amountQuoteIn The amount of quote asset to swap.
     * @return amountBaseOut The amount of base asset effectively swapped.
     */
    function swapQuoteForBase(uint256 amountQuoteIn) external returns (uint256 amountBaseOut);

    /**
     * @notice Get the current spot price of the base asset in terms of the quote asset.
     * This is quoteAssetReserve / baseAssetReserve.
     * @return price The current instantaneous price.
     */
    function getSpotPrice() external view returns (uint256 price);

    /**
     * @notice Get current reserves.
     */
    function getReserves() external view returns (uint256 baseReserve, uint256 quoteReserve);

    /**
     * @notice Initialize or update the AMM's virtual reserves. Only callable by admin/ClearingHouse.
     * @param _baseAssetReserve The new virtual base asset reserve.
     * @param _quoteAssetReserve The new virtual quote asset reserve.
     */
    function setReserves(uint256 _baseAssetReserve, uint256 _quoteAssetReserve) external;

    // For simplicity, we assume one vAMM per trading pair (e.g., ETH/USD).
    // The addresses of base and quote assets (collateral) are known by the ClearingHouse.
}