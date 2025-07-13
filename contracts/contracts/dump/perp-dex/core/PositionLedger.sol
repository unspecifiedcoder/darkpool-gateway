// contracts/core/PositionLedger.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPositionLedger} from  "../interfaces/IPositionLedger.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract PositionLedger is IPositionLedger, Ownable {
    // Mapping: trader => baseAsset => Position
    mapping(address => mapping(address => Position)) public positions;

    // Custom Errors
    error PositionNotFound();
    error PositionAlreadyExists();
    error InsufficientMargin();
    error InvalidSize();
    error NotAuthorized(); // If not called by ClearingHouse
    error InvalidDecreaseSize();

    // The address of the ClearingHouse contract that is authorized to call these functions.
    // Set this during deployment or with a setter function.
    address public clearingHouseAddress;

    modifier onlyClearingHouse() {
        require(msg.sender == clearingHouseAddress, "PositionLedger: Caller is not the ClearingHouse");
        _;
    }

    constructor(address _clearingHouseAddress) Ownable(msg.sender) {
        clearingHouseAddress = _clearingHouseAddress;
        // Consider transferring ownership to _clearingHouseAddress if it's a contract
        // Or make clearingHouseAddress an "operator" role.
        // For simplicity with Ownable, the deployer is owner,
        // and clearingHouseAddress check is separate.
    }

    function setClearingHouseAddress(address _newClearingHouseAddress) public onlyOwner {
        clearingHouseAddress = _newClearingHouseAddress;
    }


    function openPosition(
        address trader,
        address baseAsset,
        PositionSide side,
        uint256 size,
        uint256 margin,
        uint256 entryPrice
    ) external override onlyClearingHouse {
        Position storage existingPosition = positions[trader][baseAsset];
        // This simple model assumes one position per trader per baseAsset.
        // If a position exists, it should be handled by `increasePosition`.
        // For `openPosition`, we expect no prior position.
        require(existingPosition.size == 0, "PositionLedger: Position already exists, use increasePosition");
        require(size > 0, "PositionLedger: Size must be positive");
        require(margin > 0, "PositionLedger: Margin must be positive");

        positions[trader][baseAsset] = Position({
            trader: trader,
            baseAsset: baseAsset,
            side: side,
            size: size,
            margin: margin,
            entryPrice: entryPrice,
            lastFundingTimestamp: block.timestamp // Initialize funding timestamp
        });

        emit PositionOpened(trader, baseAsset, side, size, margin, entryPrice);
    }

    // A more complex closePosition would calculate PnL based on exitPrice from vAMM
    // and transfer funds. Here, we assume ClearingHouse handles PnL and just marks closed.
    // The returned PnL is more of a signal from ClearingHouse that it calculated.
    function closePosition(address trader, address baseAsset) external override onlyClearingHouse returns (uint256 pnl) {
        Position storage position = positions[trader][baseAsset];
        if (position.size == 0) revert PositionNotFound();

        // PnL calculation and settlement is primarily ClearingHouse's job.
        // This function mainly deletes the position state.
        // The `pnl` parameter could be passed in by ClearingHouse after calculating it.
        // For now, we'll just delete and let ClearingHouse emit a more detailed event.

        // uint256 closedSize = position.size; // Store before deleting for event
        // Simulate PnL being passed (or ClearingHouse will calculate it before calling this)
        // For the event, let's assume PnL is 0 here as this contract doesn't know the exit price.
        // The actual PnL should come from ClearingHouse.

        delete positions[trader][baseAsset];
        emit PositionClosed(trader, baseAsset, 0); // Placeholder PnL
        return 0; // Placeholder PnL
    }


    function increasePosition(
        address trader,
        address baseAsset,
        uint256 additionalSize,
        uint256 additionalMargin,
        uint256 priceForAddition // The price at which this additional chunk is being added
    ) external override onlyClearingHouse {
        Position storage position = positions[trader][baseAsset];
        if (position.size == 0) revert PositionNotFound(); // Should exist to be increased
        require(additionalSize > 0, "PositionLedger: Additional size must be positive");
        // additionalMargin can be 0 if leverage is adjusted or existing margin covers it.

        // Recalculate average entry price:
        // (oldSize * oldEntryPrice + additionalSize * priceForAddition) / (oldSize + additionalSize)
        uint256 newTotalSize = position.size + additionalSize;
        uint256 newAverageEntryPrice = ((position.size * position.entryPrice) + (additionalSize * priceForAddition)) / newTotalSize;

        position.size = newTotalSize;
        position.margin += additionalMargin;
        position.entryPrice = newAverageEntryPrice;
        // position.lastFundingTimestamp remains, or updated if funding occurred

        emit PositionIncreased(trader, baseAsset, additionalSize, additionalMargin, newAverageEntryPrice);
    }

    // To decrease a position, the ClearingHouse would first interact with the vAMM
    // to realize PnL on the part being decreased, then call this.
    function decreasePosition(
        address trader,
        address baseAsset,
        uint256 sizeToDecrease,
        uint256 pnlOnReducedSize // Calculated by ClearingHouse and passed in
    ) external override onlyClearingHouse returns (uint256 /*pnl*/) {
        Position storage position = positions[trader][baseAsset];
        if (position.size == 0) revert PositionNotFound();
        if (sizeToDecrease == 0 ) revert InvalidDecreaseSize();
        if (sizeToDecrease > position.size) revert InvalidDecreaseSize(); // Cannot decrease more than exists

        if (sizeToDecrease == position.size) {
            // Fully closing the position through decrease
            delete positions[trader][baseAsset];
            emit PositionClosed(trader, baseAsset, pnlOnReducedSize); // This is effectively a close
        } else {
            position.size -= sizeToDecrease;
            // Margin adjustment for the decreased part should be handled by ClearingHouse
            // (e.g., realized PnL + proportional margin part returned to free collateral)
            // For now, we assume ClearingHouse adjusts margin externally or in a separate call.
            // Entry price remains the same for the remaining portion.
            emit PositionDecreased(trader, baseAsset, sizeToDecrease, pnlOnReducedSize);
        }
        return pnlOnReducedSize;
    }


    function addMargin(address trader, address baseAsset, uint256 marginToAdd) external override onlyClearingHouse {
        Position storage position = positions[trader][baseAsset];
        if (position.size == 0) revert PositionNotFound();
        require(marginToAdd > 0, "PositionLedger: Margin to add must be positive");

        position.margin += marginToAdd;
        emit MarginAdded(trader, baseAsset, marginToAdd);
    }

    function removeMargin(address trader, address baseAsset, uint256 marginToRemove)
        external override onlyClearingHouse returns (bool success)
    {
        Position storage position = positions[trader][baseAsset];
        if (position.size == 0) revert PositionNotFound();
        require(marginToRemove > 0, "PositionLedger: Margin to remove must be positive");

        // IMPORTANT: ClearingHouse must check if removing this margin keeps the position solvent
        // (i.e., above maintenance margin requirements) BEFORE calling this.
        // This contract simply updates the number.
        if (position.margin < marginToRemove) {
            // This should ideally be caught by ClearingHouse's checks
            revert InsufficientMargin();
        }
        position.margin -= marginToRemove;
        emit MarginRemoved(trader, baseAsset, marginToRemove);
        return true;
    }

    function getPosition(address trader, address baseAsset) public view override returns (Position memory) {
        // Return a copy to prevent unintended modifications to storage directly if not careful
        return positions[trader][baseAsset];
    }

    function hasPosition(address trader, address baseAsset) external view override returns (bool) {
        return positions[trader][baseAsset].size > 0;
    }

    function liquidatePosition(
        address trader,
        address baseAsset,
        address liquidator, // Address of the account initiating the liquidation
        uint256 sizeToLiquidate // How much of the position is being liquidated
    ) external override onlyClearingHouse {
        Position storage position = positions[trader][baseAsset];
        if (position.size == 0) revert PositionNotFound();
        if (sizeToLiquidate == 0 || sizeToLiquidate > position.size) revert InvalidSize();

        // Logic for partial vs full liquidation:
        // If sizeToLiquidate == position.size, it's a full liquidation.
        // Otherwise, it's partial.
        // The ClearingHouse will handle the vAMM interaction and PnL calculation for the liquidated part.
        // This function updates the position state.

        uint256 remainingSize = position.size - sizeToLiquidate;

        if (remainingSize == 0) {
            delete positions[trader][baseAsset];
        } else {
            position.size = remainingSize;
            // Margin is typically wiped out or significantly reduced in a liquidation.
            // ClearingHouse will determine new margin or if position should be fully closed.
            // For now, let's assume margin for liquidated part is gone.
            // A more sophisticated model would adjust margin proportionally or based on loss.
            // This simplification implies the liquidated part's margin is lost.
            // If it's a partial liquidation, the remaining margin should still cover the remainingSize.
            // This needs careful handling in ClearingHouse. For now, we don't change margin here.
        }

        emit PositionLiquidated(trader, baseAsset, liquidator, sizeToLiquidate, remainingSize);
    }

    function updateFundingTimestamp(address trader, address baseAsset, uint256 timestamp) external onlyClearingHouse {
        Position storage position = positions[trader][baseAsset];
        if (position.size == 0) revert PositionNotFound();
        position.lastFundingTimestamp = timestamp;
    }
}