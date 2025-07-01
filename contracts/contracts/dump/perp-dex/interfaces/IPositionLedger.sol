// contracts/interfaces/IPositionLedger.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPositionLedger {
    enum PositionSide { LONG, SHORT }

    struct Position {
        address trader;
        address baseAsset; // The asset being traded (e.g. vETH)
        PositionSide side;
        uint256 size; // Size of the position in baseAsset units (e.g., 10 ETH)
        uint256 margin; // Collateral allocated to this position in quoteAsset units (e.g., USDC)
        uint256 entryPrice; // Average entry price in quoteAsset units per baseAsset unit
        uint256 lastFundingTimestamp; // Timestamp of the last funding payment applied
        // Potentially add: leverage, liquidationPrice etc.
    }

    event PositionOpened(address indexed trader, address indexed baseAsset, PositionSide side, uint256 size, uint256 margin, uint256 entryPrice);
    event PositionClosed(address indexed trader, address indexed baseAsset, uint256 pnl); // PnL in quote asset
    event PositionIncreased(address indexed trader, address indexed baseAsset, uint256 addedSize, uint256 addedMargin, uint256 newAverageEntryPrice);
    event PositionDecreased(address indexed trader, address indexed baseAsset, uint256 reducedSize, uint256 pnlOnReducedSize);
    event MarginAdded(address indexed trader, address indexed baseAsset, uint256 amountAdded);
    event MarginRemoved(address indexed trader, address indexed baseAsset, uint256 amountRemoved);
    event PositionLiquidated(address indexed trader, address indexed baseAsset, address indexed liquidator, uint256 liquidatedSize, uint256 remainingSize);

    function openPosition(
        address trader,
        address baseAsset,
        PositionSide side,
        uint256 size,
        uint256 margin,
        uint256 entryPrice
    ) external;

    function closePosition(address trader, address baseAsset) external returns (uint256 pnl);

    function increasePosition(
        address trader,
        address baseAsset,
        uint256 additionalSize,
        uint256 additionalMargin,
        uint256 newEntryPriceForAdditional // Price for this specific addition
    ) external;

    function decreasePosition(
        address trader,
        address baseAsset,
        uint256 sizeToDecrease,
        uint256 currentMarketPrice // To calculate PnL on the part being closed
    ) external returns (uint256 pnl);

    function addMargin(address trader, address baseAsset, uint256 marginToAdd) external;
    function removeMargin(address trader, address baseAsset, uint256 marginToRemove) external returns (bool success);

    function getPosition(address trader, address baseAsset) external view returns (Position memory);
    function hasPosition(address trader, address baseAsset) external view returns (bool);

    function liquidatePosition(
        address trader,
        address baseAsset,
        address liquidator,
        uint256 sizeToLiquidate
    ) external;

    // function updateFundingTimestamp(address trader, address baseAsset, uint256 timestamp) external;
}