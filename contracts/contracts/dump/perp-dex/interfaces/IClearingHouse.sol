// contracts/interfaces/IClearingHouse.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPositionLedger} from "./IPositionLedger.sol"; // For PositionSide enum

interface IClearingHouse {
    // Events
    event CollateralDeposited(address indexed trader, address indexed collateralToken, uint256 amount);
    event CollateralWithdrawn(address indexed trader, address indexed collateralToken, uint256 amount);
    // Position related events will be emitted by PositionLedger, but ClearingHouse might emit summary events too.

    // errors
    error InsufficientLiquidity();

    // --- Admin Functions ---
    function setPriceOracle(address baseAsset, address newOracle) external;
    function setVirtualAmm(address baseAsset, address newAmm) external;
    function setPositionLedger(address newPositionLedger) external;
    function setCollateralToken(address _collateralToken, bool isSupported) external;
    function setFees(uint256 _takerFee, uint256 _makerFee, uint256 _liquidationFee) external; // Basis points

    // --- Collateral Management ---
    function depositCollateral(address collateralToken, uint256 amount) external;
    function withdrawCollateral(address collateralToken, uint256 amount) external;
    function getAccountBalance(address trader, address collateralToken) external view returns (uint256); // Free collateral

    // --- Trading ---
    // For simplicity, one vAMM per base asset. The quote asset is the collateral token.
    function openPosition(
        address baseAsset, // e.g., vETH
        IPositionLedger.PositionSide side,
        uint256 quoteAmount, // Amount of collateral to use for margin
        uint256 leverage, // e.g., 10x (represented as 10 * 1eN where N is precision factor)
        uint256 minBaseAmountOut // Slippage protection: min base asset amount for the given quote and leverage
    ) external;

    function closePosition(
        address baseAsset,
        uint256 minQuoteAmountOut // Slippage protection: min quote asset (collateral) to receive back
    ) external;

    function addMargin(address baseAsset, uint256 quoteAmount) external;
    function removeMargin(address baseAsset, uint256 quoteAmount) external;

    // --- Liquidation ---
    function liquidate(address trader, address baseAsset) external;

    // --- Funding ---
    // function SettleFunding(address baseAsset) external;

    // --- View Functions ---
    function getMarkPrice(address baseAsset) external view returns (uint256); // Price from vAMM
    function getIndexPrice(address baseAsset) external view returns (uint256); // Price from Oracle
    function getPosition(address trader, address baseAsset) external view returns (IPositionLedger.Position memory);
    // function getUnrealizedPnl(address trader, address baseAsset, PnlType pnlType) external view returns (int256);
}

