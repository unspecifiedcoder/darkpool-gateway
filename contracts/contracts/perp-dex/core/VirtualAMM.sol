// contracts/core/VirtualAMM.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVirtualAMM} from "../interfaces/IVirtualAMM.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// Basic constant product AMM: x * y = k
// x = baseAssetReserve, y = quoteAssetReserve
contract VirtualAMM is
    IVirtualAMM,
    Ownable // Owner will be ClearingHouse or deployer
{
    uint256 public baseAssetReserve; // Virtual balance of base asset (e.g., vETH)
    uint256 public quoteAssetReserve; // Virtual balance of quote asset (e.g., vUSD)
    uint256 public constant PRECISION = 1e18; // For price calculations and internal math

    // Custom Errors
    error InsufficientLiquidity();
    error InvalidAmount();
    error OraclePriceNotAvailable(); // Though vAMM itself doesn't use oracle directly for swaps
    error SlippageTooHigh(); // For more advanced swap functions

    constructor(
        uint256 initialBaseReserve,
        uint256 initialQuoteReserve
    ) Ownable(msg.sender) {
        require(
            initialBaseReserve > 0 && initialQuoteReserve > 0,
            "Reserves must be positive"
        );
        baseAssetReserve = initialBaseReserve;
        quoteAssetReserve = initialQuoteReserve;
        // k = (initialBaseReserve * initialQuoteReserve) / PRECISION; // Adjust if reserves aren't scaled by PRECISION
        emit ReservesUpdated(baseAssetReserve, quoteAssetReserve);
    }

    /**
     * Only callable by an authorized contract (e.g., ClearingHouse or Owner)
     */
    function setReserves(
        uint256 _baseAssetReserve,
        uint256 _quoteAssetReserve
    ) external override onlyOwner {
        require(
            _baseAssetReserve > 0 && _quoteAssetReserve > 0,
            "Reserves must be positive"
        );
        baseAssetReserve = _baseAssetReserve;
        quoteAssetReserve = _quoteAssetReserve;
        // k = (_baseAssetReserve * _quoteAssetReserve) / PRECISION;
        emit ReservesUpdated(baseAssetReserve, quoteAssetReserve);
    }

    /**
     * @inheritdoc IVirtualAMM
     */
    function getReserves() external view override returns (uint256, uint256) {
        return (baseAssetReserve, quoteAssetReserve);
    }

    /**
     * Price = quoteAssetReserve / baseAssetReserve (scaled by PRECISION)
     * e.g., if quote is USDC (6 decimals) and base is ETH (18 decimals), this price is in USDC/ETH.
     * The vAMM operates on abstract units, scaling should be handled by ClearingHouse or UI.
     * For now, assume reserves are in compatible units or scaled by PRECISION.
     */
    function getSpotPrice() public view override returns (uint256 price) {
        if (baseAssetReserve == 0) return 0; // Avoid division by zero
        return (quoteAssetReserve * PRECISION) / baseAssetReserve;
    }

    // --- Internal calculation functions ---

    // Calculates output amount for swapping base for quote
    // Formula: dy = (y * dx) / (x + dx) where fee is ignored for now
    // dy = (quoteReserve * amountBaseIn) / (baseReserve + amountBaseIn)
    function _getQuoteAmountOut(
        uint256 amountBaseIn,
        uint256 currentBaseReserve,
        uint256 currentQuoteReserve
    ) internal pure returns (uint256 amountQuoteOut) {
        if (
            amountBaseIn == 0 ||
            currentBaseReserve == 0 ||
            currentQuoteReserve == 0
        ) {
            return 0;
        }
        // No fee version: (currentQuoteReserve * amountBaseIn * PRECISION) / ((currentBaseReserve + amountBaseIn) * PRECISION)
        // More precise: (currentQuoteReserve * amountBaseIn) / (currentBaseReserve + amountBaseIn)
        // With fees, it's dy = y - k/(x+dx_with_fee) = y - (x*y)/(x+dx_with_fee)
        // Simplified: amountQuoteOut = (currentQuoteReserve * amountBaseIn) / (currentBaseReserve + amountBaseIn);
        // Let's use the formula: outputAmount = (inputAmount * outputReserve) / (inputReserve + inputAmount)
        // This is based on Uniswap V1 logic without fees for simplicity.
        // amountQuoteOut = (amountBaseIn * currentQuoteReserve) / (currentBaseReserve + amountBaseIn);

        // Constant product: (x+dx)(y-dy) = k = xy
        // xy + dx*y - x*dy - dx*dy = xy
        // dx*y = dy(x+dx)
        // dy = (dx*y) / (x+dx)
        uint256 numerator = amountBaseIn * currentQuoteReserve;
        uint256 denominator = currentBaseReserve + amountBaseIn;
        if (denominator == 0) return 0; // Should not happen if currentBaseReserve > 0
        amountQuoteOut = numerator / denominator;
        if (amountQuoteOut >= currentQuoteReserve)
            revert InsufficientLiquidity(); // Cannot drain more than available
        return amountQuoteOut;
    }

    // Calculates output amount for swapping quote for base
    // dx = (x * dy) / (y + dy)
    function _getBaseAmountOut(
        uint256 amountQuoteIn,
        uint256 currentBaseReserve,
        uint256 currentQuoteReserve
    ) internal pure returns (uint256 amountBaseOut) {
        if (
            amountQuoteIn == 0 ||
            currentBaseReserve == 0 ||
            currentQuoteReserve == 0
        ) {
            return 0;
        }
        // amountBaseOut = (amountQuoteIn * currentBaseReserve) / (currentQuoteReserve + amountQuoteIn);
        uint256 numerator = amountQuoteIn * currentBaseReserve;
        uint256 denominator = currentQuoteReserve + amountQuoteIn;
        if (denominator == 0) return 0;
        amountBaseOut = numerator / denominator;

        if (amountBaseOut >= currentBaseReserve) revert InsufficientLiquidity(); // Cannot drain more than available
        return amountBaseOut;
    }

    // --- Preview Functions (View) ---
    /**
     * @inheritdoc IVirtualAMM
     */
    function getQuoteAmountOut(
        uint256 amountBaseIn
    ) external view override returns (uint256 amountQuoteOut) {
        return
            _getQuoteAmountOut(
                amountBaseIn,
                baseAssetReserve,
                quoteAssetReserve
            );
    }

    /**
     * @inheritdoc IVirtualAMM
     */
    function getBaseAmountOut(
        uint256 amountQuoteIn
    ) external view override returns (uint256 amountBaseOut) {
        return
            _getBaseAmountOut(
                amountQuoteIn,
                baseAssetReserve,
                quoteAssetReserve
            );
    }

    function swapBaseForQuotePreview(
        uint256 amountBaseIn
    )
        external
        view
        override
        returns (
            uint256 amountQuoteOut,
            uint256 newBaseReserve,
            uint256 newQuoteReserve
        )
    {
        amountQuoteOut = _getQuoteAmountOut(
            amountBaseIn,
            baseAssetReserve,
            quoteAssetReserve
        );
        newBaseReserve = baseAssetReserve + amountBaseIn;
        newQuoteReserve = quoteAssetReserve - amountQuoteOut;
        return (amountQuoteOut, newBaseReserve, newQuoteReserve);
    }

    function swapQuoteForBasePreview(
        uint256 amountQuoteIn
    )
        external
        view
        override
        returns (
            uint256 amountBaseOut,
            uint256 newBaseReserve,
            uint256 newQuoteReserve
        )
    {
        amountBaseOut = _getBaseAmountOut(
            amountQuoteIn,
            baseAssetReserve,
            quoteAssetReserve
        );
        newBaseReserve = baseAssetReserve - amountBaseOut;
        newQuoteReserve = quoteAssetReserve + amountQuoteIn;
        return (amountBaseOut, newBaseReserve, newQuoteReserve);
    }

    // --- State-Changing Swap Functions (Only callable by ClearingHouse/Owner) ---
    /**
     * Simulates trader selling base asset (going short or closing long)
     */
    function swapBaseForQuote(
        uint256 amountBaseIn
    ) external override onlyOwner returns (uint256 amountQuoteOut) {
        if (amountBaseIn == 0) revert InvalidAmount();

        amountQuoteOut = _getQuoteAmountOut(
            amountBaseIn,
            baseAssetReserve,
            quoteAssetReserve
        );
        if (amountQuoteOut == 0 && amountBaseIn > 0)
            revert InsufficientLiquidity(); // Ensure some output for non-zero input

        baseAssetReserve += amountBaseIn;
        quoteAssetReserve -= amountQuoteOut; // This was calculated to be less than current reserve

        // k should remain constant (approximately, due to integer math)
        // uint256 newK = (baseAssetReserve * quoteAssetReserve) / PRECISION;
        // require(newK >= k * (PRECISION - 100) / PRECISION && newK <= k * (PRECISION + 100) / PRECISION, "K changed too much"); // Invariant check with tolerance

        emit Swap(msg.sender, address(0), true, amountBaseIn, amountQuoteOut); // msg.sender is ClearingHouse
        emit ReservesUpdated(baseAssetReserve, quoteAssetReserve);
        return amountQuoteOut;
    }

    /**
     * Simulates trader buying base asset (going long or closing short)
     */
    function swapQuoteForBase(
        uint256 amountQuoteIn
    ) external override onlyOwner returns (uint256 amountBaseOut) {
        if (amountQuoteIn == 0) revert InvalidAmount();

        amountBaseOut = _getBaseAmountOut(
            amountQuoteIn,
            baseAssetReserve,
            quoteAssetReserve
        );
        if (amountBaseOut == 0 && amountQuoteIn > 0)
            revert InsufficientLiquidity();

        quoteAssetReserve += amountQuoteIn;
        baseAssetReserve -= amountBaseOut;

        emit Swap(msg.sender, address(0), false, amountQuoteIn, amountBaseOut); // msg.sender is ClearingHouse
        emit ReservesUpdated(baseAssetReserve, quoteAssetReserve);
        return amountBaseOut;
    }
}
