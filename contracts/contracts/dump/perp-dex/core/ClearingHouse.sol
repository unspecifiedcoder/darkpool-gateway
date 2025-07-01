// contracts/core/ClearingHouse.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IClearingHouse} from "../interfaces/IClearingHouse.sol";
import {IVirtualAMM} from "../interfaces/IVirtualAMM.sol";
import {IPositionLedger} from "../interfaces/IPositionLedger.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol"; // Using our illustrative library

// This is a simplified ClearingHouse. Many production features are omitted for clarity.
contract ClearingHouseTemp is Ownable {
    using SafeDecimalMath for uint256;

    // --- Constants ---
    uint256 public constant PRICE_PRECISION = 1e18; // For oracle and vAMM prices
    uint256 public constant MARGIN_PRECISION = 1e6; // For margin calculations if collateral is e.g. USDC (6 decimals)
    uint256 public constant LEVERAGE_PRECISION = 1e4; // Represent leverage like 10x as 100000
    uint256 public constant FEE_PRECISION = 1e5; // For fees in basis points (e.g., 10 bps = 10)

    // --- State Variables ---

    // Collateral token (e.g., USDC). For simplicity, one collateral type.
    ERC20 public collateralToken;
    uint8 public collateralDecimals;

    // Position Ledger contract
    IPositionLedger public positionLedger;

    // Mappings for different base assets (e.g., vETH, vBTC)
    mapping(address => IVirtualAMM) public virtualAmms; // baseAsset address => vAMM contract
    mapping(address => IPriceOracle) public priceOracles; // baseAsset address => Oracle contract
    mapping(address => bool) public supportedBaseAssets; // Is this base asset configured?

    // Trader balances (free collateral not tied to a position)
    // trader => collateralTokenAddress (always `collateralToken` here) => amount
    mapping(address => uint256) public traderBalances;

    // Fees (in basis points)
    uint256 public takerFeeBps; // e.g., 10 for 0.10%
    uint256 public makerFeeBps; // e.g., 5 for 0.05% (not fully implemented in this simplified version)
    uint256 public liquidationFeeBps; // e.g., 50 for 0.50%

    // Min required margin ratio for opening positions (e.g., 10% for 10x max leverage)
    // (initialMarginRatio = 1 / maxLeverage)
    // uint256 public initialMarginRatioRequirement; // e.g., 0.1 * PRICE_PRECISION for 10%
    // Min maintenance margin ratio to avoid liquidation
    // uint256 public maintenanceMarginRatioRequirement; // e.g., 0.05 * PRICE_PRECISION for 5%

    // --- Events ---
    // CollateralDeposited, CollateralWithdrawn are in IClearingHouse
    event PositionOpenedCH(
        address indexed trader,
        address indexed baseAsset,
        IPositionLedger.PositionSide side,
        uint256 positionSizeBase, // In base asset units
        uint256 positionSizeQuote, // In quote asset units (collateral * leverage)
        uint256 marginAmount, // In quote asset units
        uint256 entryPrice, // From vAMM
        uint256 feePaid
    );

    event PositionClosedCH(
        address indexed trader,
        address indexed baseAsset,
        uint256 pnl, // Profit or loss in collateral currency
        uint256 feePaid
    );

    event PositionMarginAdjusted(
        address indexed trader,
        address indexed baseAsset,
        int256 marginChange, // Positive for added, negative for removed
        uint256 newTotalMargin
    );

    event LiquidationInitiated(
        address indexed trader,
        address indexed baseAsset,
        address indexed liquidator,
        uint256 sizeLiquidatedBase,
        uint256 liquidationPrice,
        uint256 feeToLiquidator
    );

    // Custom Errors
    error InvalidCollateralToken();
    error InvalidAmount();
    error AssetNotSupported();
    error OracleNotSet();
    error AmmNotSet();
    error PositionLedgerNotSet();
    error InsufficientCollateral();
    error SlippageExceeded();
    error InvalidLeverage();
    error PositionCannotBeClosed(); // E.g. no position exists
    error MaxLeverageExceeded();
    error InsufficientFreeCollateral();
    error WithdrawExceedsFreeCollateral();
    error PositionStillOpen(); // For full collateral withdrawal

    // --- Constructor ---
    constructor(
        address _collateralTokenAddress,
        address _positionLedgerAddress
    ) Ownable(msg.sender) {
        require(
            _collateralTokenAddress != address(0),
            "CH: Invalid collateral token address"
        );
        require(
            _positionLedgerAddress != address(0),
            "CH: Invalid position ledger address"
        );

        collateralToken = ERC20(_collateralTokenAddress);
        collateralDecimals = collateralToken.decimals(); // Store for convenience
        // Ensure collateralDecimals is reasonable (e.g., 6 for USDC, 18 for DAI)
        // For MARGIN_PRECISION to work well, it should align or conversions needed.
        // If collateralDecimals is 6, MARGIN_PRECISION = 1e6. If 18, 1e18.
        // Let's assume MARGIN_PRECISION is set according to the most common collateral.
        // For this example, let's assume collateralDecimals matches the MARGIN_PRECISION scale (e.g., 6)
        // or ensure all quote amounts are normalized to PRICE_PRECISION (1e18) internally.
        // For simplicity, we'll try to keep quote amounts in their native collateral decimals and convert for vAMM.

        positionLedger = IPositionLedger(_positionLedgerAddress);

        // Set default fees (can be changed by owner)
        takerFeeBps = 10; // 0.1%
        makerFeeBps = 5; // 0.05%
        liquidationFeeBps = 100; // 1%
    }

    // --- Admin Functions ---
    function setPositionLedger(
        address newPositionLedger
    ) external  onlyOwner {
        require(
            newPositionLedger != address(0),
            "CH: Invalid position ledger address"
        );
        positionLedger = IPositionLedger(newPositionLedger);
    }

    function setCollateralToken(
        address _newCollateralToken,
        bool isSupported /* ignored */
    ) external  onlyOwner {
        require(
            _newCollateralToken != address(0),
            "CH: Invalid collateral token address"
        );
        collateralToken = ERC20(_newCollateralToken);
        collateralDecimals = collateralToken.decimals();
        // Event? Consider implications if collateral is changed mid-operation.
    }

    function setFees(
        uint256 _takerFee,
        uint256 _makerFee,
        uint256 _liquidationFee
    ) external  onlyOwner {
        takerFeeBps = _takerFee;
        makerFeeBps = _makerFee;
        liquidationFeeBps = _liquidationFee;
        // Add event
    }

    function addSupportedBaseAsset(
        address baseAsset,
        address ammAddress,
        address oracleAddress
    ) external onlyOwner {
        require(baseAsset != address(0), "CH: Invalid base asset address");
        require(ammAddress != address(0), "CH: Invalid AMM address");
        require(oracleAddress != address(0), "CH: Invalid Oracle address");

        virtualAmms[baseAsset] = IVirtualAMM(ammAddress);
        priceOracles[baseAsset] = IPriceOracle(oracleAddress);
        supportedBaseAssets[baseAsset] = true;
        // Add event
    }

    function removeSupportedBaseAsset(address baseAsset) external onlyOwner {
        require(supportedBaseAssets[baseAsset], "CH: Base asset not supported");
        delete virtualAmms[baseAsset];
        delete priceOracles[baseAsset];
        supportedBaseAssets[baseAsset] = false;
        // Add event
    }

    function setPriceOracle(
        address baseAsset,
        address newOracle
    ) external  onlyOwner {
        require(supportedBaseAssets[baseAsset], "CH: Base asset not supported");
        require(newOracle != address(0), "CH: Invalid oracle address");
        priceOracles[baseAsset] = IPriceOracle(newOracle);
    }

    function setVirtualAmm(
        address baseAsset,
        address newAmm
    ) external  onlyOwner {
        require(supportedBaseAssets[baseAsset], "CH: Base asset not supported");
        require(newAmm != address(0), "CH: Invalid AMM address");
        virtualAmms[baseAsset] = IVirtualAMM(newAmm);
    }

    // --- Collateral Management ---
    function depositCollateral(
        address,
        /*collateralTokenAddress - ignored, uses contract's*/ uint256 amount
    ) external  {
        if (amount == 0) revert InvalidAmount();
        // For this version, we only support the single `collateralToken`
        // require(collateralTokenAddress == address(collateralToken), "CH: Unsupported collateral token");

        traderBalances[msg.sender] = traderBalances[msg.sender].add(amount);

        // Pull funds from user
        bool success = collateralToken.transferFrom(
            msg.sender,
            address(this),
            amount
        );
        require(success, "CH: Collateral transfer failed");

        // emit CollateralDeposited(msg.sender, address(collateralToken), amount);
    }

    function withdrawCollateral(
        address,
        /*collateralTokenAddress - ignored*/ uint256 amount
    ) external  {
        if (amount == 0) revert InvalidAmount();
        // require(collateralTokenAddress == address(collateralToken), "CH: Unsupported collateral token");

        uint256 currentBalance = traderBalances[msg.sender];
        if (amount > currentBalance) revert WithdrawExceedsFreeCollateral();

        // Check if user has any open positions for any base asset.
        // This is a simplified check. A more robust check would iterate through all supported base assets.
        // For now, we'll disallow withdrawal if *any* position exists, which is too restrictive.
        // A better check: ensure remainingBalance >= totalMarginForAllPositions.
        // For simplicity: can't withdraw all if any position is open (ledger would need a way to check this easily)
        // IPositionLedger.Position memory pos = positionLedger.getPosition(msg.sender, someBaseAsset);
        // if (pos.size > 0 && amount == currentBalance) {
        //     revert PositionStillOpen();
        // }
        // The check below is more about free collateral vs. requested amount. Margin checks happen in removeMargin.

        traderBalances[msg.sender] = currentBalance.sub(amount);

        bool success = collateralToken.transfer(msg.sender, amount);
        require(success, "CH: Collateral transfer failed");

        // emit CollateralWithdrawn(msg.sender, address(collateralToken), amount);
    }

    function getAccountBalance(
        address trader,
        address /*_collateralToken*/
    ) external view  returns (uint256) {
        // require(_collateralToken == address(collateralToken), "CH: Unsupported collateral token");
        return traderBalances[trader];
    }

    // --- Trading Logic ---

    // /**
    //  * @notice Opens a new position or increases an existing one.
    //  * @param baseAsset The base asset to trade (e.g., vETH).
    //  * @param side LONG or SHORT.
    //  * @param marginAmount Amount of collateral (in quote asset units, e.g., USDC) to allocate as margin.
    //  * @param leverage Leverage factor (e.g., 10 * LEVERAGE_PRECISION for 10x).
    //  * @param minBaseAmountOut Slippage protection: minimum base asset amount expected for the trade.
    //  */
    // function openPosition(
    //     address baseAsset,
    //     IPositionLedger.PositionSide side,
    //     uint256 marginAmount, // In collateral's native decimals
    //     uint256 leverage, // Scaled by LEVERAGE_PRECISION
    //     uint256 minBaseAmountOut // In base asset's scaled units (e.g., 1e18 for ETH)
    // ) external  {
    //     // --- Validations ---
    //     if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
    //     if (marginAmount == 0) revert InvalidAmount();
    //     if (leverage == 0 || leverage > (100 * LEVERAGE_PRECISION))
    //         revert InvalidLeverage(); // Max 100x
    //     // Add check: initialMarginRatioRequirement (e.g., 1/leverage must be >= min threshold)

    //     IVirtualAMM amm = virtualAmms[baseAsset];
    //     if (address(amm) == address(0)) revert AmmNotSet();

    //     if (traderBalances[msg.sender] < marginAmount)
    //         revert InsufficientFreeCollateral();

    //     // --- Calculations ---
    //     // Position size in quote asset terms (e.g., USDC terms)
    //     // positionSizeQuote = marginAmount * (leverage / LEVERAGE_PRECISION)
    //     uint256 positionSizeQuote = marginAmount.mul(
    //         leverage,
    //         LEVERAGE_PRECISION
    //     );

    //     // If collateralDecimals is not 18, and vAMM expects 18-decimal quote amounts, convert.
    //     // For now, let's assume vAMM's quoteAssetReserve is scaled to PRICE_PRECISION (1e18)
    //     // and we need to convert positionSizeQuote to that scale if collateralDecimals differ.
    //     uint256 positionSizeQuoteScaledForAmm; // = positionSizeQuote * (PRICE_PRECISION / (10**collateralDecimals));
    //     if (collateralDecimals < 18) {
    //         positionSizeQuoteScaledForAmm =
    //             positionSizeQuote *
    //             (10 ** (18 - collateralDecimals));
    //     } else if (collateralDecimals > 18) {
    //         positionSizeQuoteScaledForAmm =
    //             positionSizeQuote /
    //             (10 ** (collateralDecimals - 18));
    //     } else {
    //         positionSizeQuoteScaledForAmm = positionSizeQuote; // Already 18 decimals
    //     }

    //     // Get the amount of base asset from swapping quote asset in the vAMM
    //     // This also gives us the effective entry price.
    //     uint256 actualBaseAmount; // This will be the size of the position in base asset units
    //     uint256 newAmmBaseReserve;
    //     uint256 newAmmQuoteReserve;

    //     if (side == IPositionLedger.PositionSide.LONG) {
    //         // Trader is "buying" base asset with their leveraged quote amount
    //         (actualBaseAmount, newAmmBaseReserve, newAmmQuoteReserve) = amm
    //             .swapQuoteForBasePreview(positionSizeQuoteScaledForAmm);
    //     } else {
    //         // SHORT
    //         // Trader is "selling" base asset (conceptually) for quote amount
    //         // To get base amount for a short, we see how much base we'd need to sell to get positionSizeQuoteScaledForAmm
    //         // This is effectively swapBaseForQuote, but input is quote.
    //         // A simpler way: treat short as borrowing base and selling it.
    //         // The vAMM interaction for a short: quote reserve increases, base reserve decreases.
    //         // So, for a short, the trader effectively ADDS base to the AMM and REMOVES quote from it.
    //         // The size of the short is `actualBaseAmount`. The vAMM reflects this by base increasing, quote decreasing.
    //         // So, input to AMM is actualBaseAmount, output is positionSizeQuoteScaledForAmm.
    //         // We need to find actualBaseAmount such that output is positionSizeQuoteScaledForAmm.
    //         // dy = (dx*y) / (x+dx) => positionSizeQuoteScaledForAmm = (actualBaseAmount * amm.quoteAssetReserve()) / (amm.baseAssetReserve() + actualBaseAmount)
    //         // This needs an inverse calculation or we assume `getBaseAmountOut` handles the directionality.
    //         // Let's re-verify vAMM logic for shorts.
    //         // If opening LONG: trader gives quote, takes base. AMM: quote_in, base_out. Reserves: quote_v+, base_v-
    //         // If opening SHORT: trader gives base, takes quote. AMM: base_in, quote_out. Reserves: base_v+, quote_v-
    //         (actualBaseAmount, newAmmBaseReserve, newAmmQuoteReserve) = amm
    //             .swapBaseForQuotePreview(positionSizeQuoteScaledForAmm);
    //         // ^ This is incorrect for shorting using quote_amount for leverage.
    //         // For a short, you want to determine how much *base* asset corresponds to your `positionSizeQuote`.
    //         // The vAMM movement is: base reserves increase (as if trader sold base), quote reserves decrease.
    //         // So, effectively, the trader *adds* `actualBaseAmount` to the vAMM's base side,
    //         // and the AMM gives back `positionSizeQuoteScaledForAmm`.
    //         // This means we need `getBaseAmountIn(positionSizeQuoteScaledForAmm)`
    //         // Or, using existing preview: we're effectively doing a "reverse" of swapBaseForQuote.
    //         // Let's assume for now the AMM's `swapBaseForQuotePreview` when opening short means:
    //         // input: how much base I want to short, output: how much quote I get.
    //         // But we have `marginAmount` and `leverage` (giving `positionSizeQuote`).
    //         // So, we need to find `baseAmount` such that if we sold it, we'd get `positionSizeQuote`.
    //         // This is `getBaseAmountOut` if we input `positionSizeQuote`.

    //         // Correct for short: we are defining the *size* of the position in quote terms.
    //         // The AMM interaction is as if the trader is *selling* `actualBaseAmount` of base asset.
    //         // So, the vAMM's base reserves will *increase*, and quote reserves will *decrease*.
    //         // The amount of base asset that creates this quote value is found by `getBaseAmountOut`.
    //         // (amm.swapQuoteForBasePreview is for BUYING base with quote.)
    //         // We need to calculate how much base asset corresponds to positionSizeQuoteScaledForAmm
    //         // effectively, the trader borrows `actualBaseAmount` and sells it into the AMM.
    //         // The AMM's base reserve increases by `actualBaseAmount`, quote reserve decreases by `positionSizeQuoteScaledForAmm`.
    //         // So we need to call `amm.swapBaseForQuote(actualBaseAmount)` which would return `positionSizeQuoteScaledForAmm`.
    //         // We need to find `actualBaseAmount`. This requires an inverse of `_getQuoteAmountOut`.
    //         // dx = (dy * x) / (y - dy)
            
    //         // (uint256 currentAmmBase, uint256 currentAmmQuote) = amm
    //         //     .getReserves();
    //         // uint256 numerator = positionSizeQuoteScaledForAmm * currentAmmBase;
    //         // uint256 denominator = currentAmmQuote -
    //         //     positionSizeQuoteScaledForAmm; // this is dy
    //         // if (currentAmmQuote <= positionSizeQuoteScaledForAmm)
    //         //     revert InsufficientLiquidity(); // Cannot take out more quote than available
    //         // actualBaseAmount = numerator / denominator;

    //         // // Simulate the state change for preview to get new reserves
    //         // newAmmBaseReserve = currentAmmBase + actualBaseAmount;
    //         // newAmmQuoteReserve =
    //         //     currentAmmQuote -
    //         //     positionSizeQuoteScaledForAmm;
    //         (
    //             actualBaseAmount,
    //             newAmmBaseReserve,
    //             newAmmQuoteReserve
    //         ) = _computeShortSize(amm, positionSizeQuoteScaledForAmm);
    //     }

    //     if (actualBaseAmount < minBaseAmountOut) revert SlippageExceeded();
    //     if (actualBaseAmount == 0) revert InsufficientLiquidity(); // Should be caught by AMM usually

    //     uint256 entryPrice = positionSizeQuoteScaledForAmm.mul(
    //         PRICE_PRECISION,
    //         actualBaseAmount
    //     ); // quote/base, scaled

    //     // --- Calculate Fee ---
    //     uint256 feeAmountQuoteScaled = positionSizeQuoteScaledForAmm.mul(
    //         takerFeeBps,
    //         FEE_PRECISION
    //     );
    //     // Convert fee back to collateral's native decimals
    //     uint256 feeAmountCollateralDecimals;
    //     if (collateralDecimals < 18) {
    //         feeAmountCollateralDecimals =
    //             feeAmountQuoteScaled /
    //             (10 ** (18 - collateralDecimals));
    //     } else if (collateralDecimals > 18) {
    //         feeAmountCollateralDecimals =
    //             feeAmountQuoteScaled *
    //             (10 ** (collateralDecimals - 18));
    //     } else {
    //         feeAmountCollateralDecimals = feeAmountQuoteScaled;
    //     }

    //     if (
    //         traderBalances[msg.sender] <
    //         marginAmount + feeAmountCollateralDecimals
    //     ) {
    //         revert InsufficientFreeCollateral(); // Not enough for margin + fee
    //     }

    //     // --- State Updates ---
    //     // 1. Deduct margin and fee from trader's free balance
    //     traderBalances[msg.sender] = traderBalances[msg.sender]
    //         .sub(marginAmount)
    //         .sub(feeAmountCollateralDecimals);
    //     // TODO: Send fee to treasury/insurance fund

    //     // 2. Update vAMM reserves (actually perform the swap)
    //     if (side == IPositionLedger.PositionSide.LONG) {
    //         amm.swapQuoteForBase(positionSizeQuoteScaledForAmm); // This will update reserves
    //     } else {
    //         // SHORT
    //         amm.swapBaseForQuote(actualBaseAmount); // This will update reserves
    //     }

    //     // 3. Update PositionLedger
    //     // For simplicity, if position exists, this becomes an increase. A real system might differentiate.
    //     IPositionLedger.Position memory existingPosition = positionLedger
    //         .getPosition(msg.sender, baseAsset);
    //     if (existingPosition.size == 0) {
    //         positionLedger.openPosition(
    //             msg.sender,
    //             baseAsset,
    //             side,
    //             actualBaseAmount, // Size in base asset units
    //             marginAmount, // Margin in collateral's native decimals
    //             entryPrice // Scaled by PRICE_PRECISION
    //         );
    //     } else {
    //         // Check if sides are compatible for increasing
    //         if (existingPosition.side != side) {
    //             // To simplify, disallow opening a new position in the opposite direction
    //             // User should close the existing one first.
    //             // A more advanced system could allow reducing or flipping.
    //             revert(
    //                 "CH: Position with opposite side exists. Close it first."
    //             );
    //         }
    //         positionLedger.increasePosition(
    //             msg.sender,
    //             baseAsset,
    //             actualBaseAmount, // additional size
    //             marginAmount, // additional margin
    //             entryPrice // price for this specific addition
    //         );
    //     }

    //     emit PositionOpenedCH(
    //         msg.sender,
    //         baseAsset,
    //         side,
    //         actualBaseAmount,
    //         positionSizeQuote, // Not scaled, in original collateral decimals * leverage
    //         marginAmount,
    //         entryPrice,
    //         feeAmountCollateralDecimals
    //     );
    // }

    /// @dev Given a quote-denominated positionSize, returns (baseAmountToSell, newBaseReserve, newQuoteReserve)
    // function _computeShortSize(
    //     IVirtualAMM amm,
    //     uint256 positionSizeQuoteScaled
    // )
    //     private
    //     view
    //     returns (
    //         uint256 actualBaseAmount,
    //         uint256 newAmmBaseReserve,
    //         uint256 newAmmQuoteReserve
    //     )
    // {
    //     (uint256 currentBase, uint256 currentQuote) = amm.getReserves();
    //     // Avoid stack slots: do numerator/denominator in-line
    //     require(
    //         currentQuote > positionSizeQuoteScaled,
    //         "InsufficientLiquidity"
    //     );
    //     actualBaseAmount =
    //         (positionSizeQuoteScaled * currentBase) /
    //         (currentQuote - positionSizeQuoteScaled);
    //     newAmmBaseReserve = currentBase + actualBaseAmount;
    //     newAmmQuoteReserve = currentQuote - positionSizeQuoteScaled;
    // }

    // function closePosition(
    //     address baseAsset,
    //     uint256 minQuoteAmountOut // Slippage: Min collateral to get back (after PnL, before fees)
    // ) external  {
    //     // --- Validations ---
    //     if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
    //     IVirtualAMM amm = virtualAmms[baseAsset];
    //     if (address(amm) == address(0)) revert AmmNotSet();

    //     IPositionLedger.Position memory pos = positionLedger.getPosition(
    //         msg.sender,
    //         baseAsset
    //     );
    //     if (pos.size == 0) revert PositionCannotBeClosed();

    //     // --- Calculations ---
    //     // Determine the quote value of the position at current market price (from vAMM)
    //     // This is the amount of quote asset the trader gets back by closing the position in the vAMM.
    //     uint256 quoteValueFromAmm; // Scaled by PRICE_PRECISION
    //     uint256 actualBaseAmountToTrade = pos.size; // Amount of base asset involved in closing

    //     if (pos.side == IPositionLedger.PositionSide.LONG) {
    //         // Trader sells base to get quote
    //         (quoteValueFromAmm, , ) = amm.swapBaseForQuotePreview(
    //             actualBaseAmountToTrade
    //         );
    //     } else {
    //         // SHORT
    //         // Trader buys base back with quote
    //         (quoteValueFromAmm, , ) = amm.swapQuoteForBasePreview(
    //             actualBaseAmountToTrade
    //         );
    //         // This is incorrect logic for short closing.
    //         // If short, trader needs to *buy* `actualBaseAmountToTrade` from the AMM.
    //         // The cost to do this is `costInQuote`.
    //         // (amm.swapQuoteForBasePreview returns base out for quote in)
    //         // We need how much quote it costs to buy `actualBaseAmountToTrade`. This needs an inverse function.
    //         // OR: the size of the short position was `pos.size` (base).
    //         // When closing, the trader "buys back" this `pos.size` from the AMM.
    //         // The AMM interaction: base reserves decrease, quote reserves increase.
    //         // The AMM receives `costInQuote` and gives out `pos.size` of base.
    //         // This is `getQuoteAmountIn(pos.size)` or derived from `swapBaseForQuotePreview` if interpreted as trader *providing* base.

    //         // Correct for closing SHORT:
    //         // Trader needs to buy `pos.size` of base asset from the AMM.
    //         // This means trader inputs quote into AMM, AMM outputs base.
    //         // The AMM's quote reserve increases, base reserve decreases.
    //         // We need the *cost* in quote to acquire `pos.size` base.
    //         // This requires `getQuoteAmountIn` for a `baseAmountOut`.
    //         // amountQuoteIn = (amountBaseOut * currentQuoteReserve) / (currentBaseReserve - amountBaseOut)
    //         (uint256 currentAmmBase, uint256 currentAmmQuote) = amm
    //             .getReserves();
    //         if (currentAmmBase <= actualBaseAmountToTrade)
    //             revert InsufficientLiquidity(); // Cannot buy more base than available
    //         uint256 numerator = actualBaseAmountToTrade * currentAmmQuote;
    //         uint256 denominator = currentAmmBase - actualBaseAmountToTrade;
    //         quoteValueFromAmm = numerator / denominator; // This is the *cost* to buy back base.
    //     }

    //     // --- Calculate PnL ---
    //     // PnL = (ExitValue - EntryValue) for LONG
    //     // PnL = (EntryValue - ExitValue) for SHORT
    //     // EntryValue (quote) = pos.size (base) * pos.entryPrice (quote/base)
    //     // ExitValue (quote) = quoteValueFromAmm (already in quote terms for pos.size base)
    //     // All these values should be consistently scaled (e.g., PRICE_PRECISION)

    //     uint256 entryValueQuoteScaled = pos.size.mul(
    //         pos.entryPrice,
    //         PRICE_PRECISION
    //     );
    //     // quoteValueFromAmm is already the scaled quote value of pos.size at exit.

    //     int256 pnlScaled; // Profit and Loss in quote asset, scaled by PRICE_PRECISION
    //     if (pos.side == IPositionLedger.PositionSide.LONG) {
    //         pnlScaled =
    //             int256(quoteValueFromAmm) -
    //             int256(entryValueQuoteScaled);
    //     } else {
    //         // SHORT
    //         pnlScaled =
    //             int256(entryValueQuoteScaled) -
    //             int256(quoteValueFromAmm); // Cost to buy back
    //     }

    //     // --- Calculate Fee ---
    //     // Fee is on the total position size being closed (quoteValueFromAmm)
    //     uint256 feeAmountQuoteScaled = quoteValueFromAmm.mul(
    //         takerFeeBps,
    //         FEE_PRECISION
    //     );

    //     // Convert PnL and Fee from PRICE_PRECISION scale to collateral's native decimals
    //     int256 pnlCollateralDecimals;
    //     uint256 feeCollateralDecimals;

    //     if (collateralDecimals < 18) {
    //         pnlCollateralDecimals =
    //             pnlScaled /
    //             int256(10 ** (18 - collateralDecimals));
    //         feeCollateralDecimals =
    //             feeAmountQuoteScaled /
    //             (10 ** (18 - collateralDecimals));
    //     } else if (collateralDecimals > 18) {
    //         pnlCollateralDecimals =
    //             pnlScaled *
    //             int256(10 ** (collateralDecimals - 18));
    //         feeCollateralDecimals =
    //             feeAmountQuoteScaled *
    //             (10 ** (collateralDecimals - 18));
    //     } else {
    //         pnlCollateralDecimals = pnlScaled;
    //         feeCollateralDecimals = feeAmountQuoteScaled;
    //     }

    //     // --- Slippage Check ---
    //     // Trader gets back margin + PnL - fee. This should be >= minQuoteAmountOut (which is before fee)
    //     uint256 quoteReturnedBeforeFee;
    //     if (pnlCollateralDecimals >= 0) {
    //         quoteReturnedBeforeFee =
    //             pos.margin +
    //             uint256(pnlCollateralDecimals);
    //     } else {
    //         // Loss is capped at margin for non-liquidated closure.
    //         // (A real system might allow losses > margin, covered by free collateral if available, or force liquidation)
    //         if (uint256(-pnlCollateralDecimals) > pos.margin) {
    //             // Loss exceeds margin
    //             quoteReturnedBeforeFee = 0; // Margin wiped out
    //         } else {
    //             quoteReturnedBeforeFee =
    //                 pos.margin -
    //                 uint256(-pnlCollateralDecimals);
    //         }
    //     }
    //     if (quoteReturnedBeforeFee < minQuoteAmountOut)
    //         revert SlippageExceeded();

    //     // --- State Updates ---
    //     // 1. Update vAMM reserves (actually perform the swap)
    //     if (pos.side == IPositionLedger.PositionSide.LONG) {
    //         amm.swapBaseForQuote(actualBaseAmountToTrade); // Returns quote, updates reserves
    //     } else {
    //         // SHORT
    //         amm.swapQuoteForBase(quoteValueFromAmm); // Spends quote to get base, updates reserves
    //         // This quoteValueFromAmm is the *cost*.
    //     }

    //     // 2. Update PositionLedger: Close the position
    //     // The PnL passed to ledger here is mostly for event emission by ledger.
    //     // ClearingHouse is the source of truth for PnL calculation.
    //     positionLedger.closePosition(msg.sender, baseAsset); // Returns a dummy PnL from ledger.

    //     // 3. Adjust trader's free collateral balance
    //     // Trader gets back original margin + PnL - Fee
    //     uint256 finalAmountToTrader;
    //     if (pnlCollateralDecimals >= 0) {
    //         // Profit
    //         finalAmountToTrader =
    //             pos.margin +
    //             uint256(pnlCollateralDecimals) -
    //             feeCollateralDecimals;
    //         traderBalances[msg.sender] = traderBalances[msg.sender].add(
    //             finalAmountToTrader
    //         );
    //     } else {
    //         // Loss
    //         uint256 lossAmount = uint256(-pnlCollateralDecimals);
    //         if (lossAmount + feeCollateralDecimals >= pos.margin) {
    //             // Total loss + fee >= margin. Margin is wiped. Any excess loss not covered here (would be bad debt or socialized)
    //             // This means trader gets 0 back from margin.
    //             // We already deducted fee from potential profit, here fee adds to the loss against margin.
    //         } else {
    //             finalAmountToTrader =
    //                 pos.margin -
    //                 lossAmount -
    //                 feeCollateralDecimals;
    //             traderBalances[msg.sender] = traderBalances[msg.sender].add(
    //                 finalAmountToTrader
    //             );
    //         }
    //     }
    //     // TODO: Send fee to treasury/insurance fund

    //     emit PositionClosedCH(
    //         msg.sender,
    //         baseAsset,
    //         uint256(pnlCollateralDecimals),
    //         feeCollateralDecimals
    //     );
    // }

    function addMargin(
        address baseAsset,
        uint256 quoteAmount
    ) external  {
        if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
        if (quoteAmount == 0) revert InvalidAmount();

        IPositionLedger.Position memory pos = positionLedger.getPosition(
            msg.sender,
            baseAsset
        );
        if (pos.size == 0) revert("CH: No position to add margin to");
        if (traderBalances[msg.sender] < quoteAmount)
            revert InsufficientFreeCollateral();

        traderBalances[msg.sender] = traderBalances[msg.sender].sub(
            quoteAmount
        );
        positionLedger.addMargin(msg.sender, baseAsset, quoteAmount);

        emit PositionMarginAdjusted(
            msg.sender,
            baseAsset,
            int256(quoteAmount),
            pos.margin + quoteAmount
        );
    }

    function removeMargin(
        address baseAsset,
        uint256 quoteAmount
    ) external  {
        if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
        if (quoteAmount == 0) revert InvalidAmount();

        IPositionLedger.Position memory pos = positionLedger.getPosition(
            msg.sender,
            baseAsset
        );
        if (pos.size == 0) revert("CH: No position to remove margin from");
        if (quoteAmount > pos.margin)
            revert("CH: Cannot remove more margin than available in position");

        // --- IMPORTANT: Margin Check ---
        // This is where you'd check if `pos.margin - quoteAmount` is still above
        // the maintenance margin requirement for `pos.size` at current mark price.
        // ( (pos.margin - quoteAmount) / (pos.size * markPrice) > maintenanceMarginRatio )
        // For simplicity, this check is omitted here but is CRITICAL in a real system.
        // If this check fails, the removeMargin operation should be disallowed.

        bool success = positionLedger.removeMargin(
            msg.sender,
            baseAsset,
            quoteAmount
        );
        require(success, "CH: PositionLedger failed to remove margin"); // Should not fail if checks pass

        traderBalances[msg.sender] = traderBalances[msg.sender].add(
            quoteAmount
        );

        emit PositionMarginAdjusted(
            msg.sender,
            baseAsset,
            -int256(quoteAmount),
            pos.margin - quoteAmount
        );
    }

    // --- Liquidation ---
    // This is a placeholder for a complex liquidation mechanism.
    function liquidate(address trader, address baseAsset) external  {
        if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
        // Who can call liquidate? Anyone, if position is liquidatable.
        // Or only designated liquidators.

        IPositionLedger.Position memory pos = positionLedger.getPosition(
            trader,
            baseAsset
        );
        if (pos.size == 0) revert("CH: Position not found or already closed");

        // 1. Check if liquidatable:
        //    - Get current mark price from vAMM.
        //    - Calculate current margin ratio: (pos.margin / (pos.size * markPrice)).
        //    - If margin_ratio < maintenanceMarginRatioRequirement, then liquidatable.
        //    (This requires `maintenanceMarginRatioRequirement` to be set)
        // For now, let's assume it IS liquidatable and `msg.sender` is the liquidator.

        uint256 markPrice = getMarkPrice(baseAsset); // Scaled by PRICE_PRECISION
        // Simplified check (conceptual):
        // uint256 positionValueQuote = pos.size.mul(markPrice, PRICE_PRECISION);
        // uint256 maintenanceMarginRequired = positionValueQuote.mul(maintenanceMarginRatioRequirement, PRICE_PRECISION);
        // if (pos.margin >= maintenanceMarginRequired) revert("CH: Position not liquidatable");

        // 2. Process liquidation:
        //    - The liquidator effectively takes over the position and closes it against the AMM.
        //    - Or, a portion of the position is closed to bring margin ratio back up.
        //    - The liquidated trader's margin is used to cover losses.
        //    - Liquidator receives a fee (liquidationFeeBps) from the trader's margin or position value.
        //    - Remaining funds (if any) might go to an insurance fund.

        IVirtualAMM amm = virtualAmms[baseAsset];
        uint256 liquidatedSizeBase = pos.size; // Assume full liquidation for simplicity
        uint256 quoteValueFromClosing; // Quote value from closing position in AMM, scaled PRICE_PRECISION

        if (pos.side == IPositionLedger.PositionSide.LONG) {
            // Liquidator sells base from position into AMM
            quoteValueFromClosing = amm.swapBaseForQuote(liquidatedSizeBase);
        } else {
            // SHORT
            // Liquidator buys base to close position from AMM.
            // Cost to buy `liquidatedSizeBase`. This is value *taken from* AMM.
            // The AMM's quote reserves *increase*.
            // We need the cost to acquire this base.
            (uint256 currentAmmBase, uint256 currentAmmQuote) = amm
                .getReserves();
            if (currentAmmBase <= liquidatedSizeBase) {
                /* Handle insufficient AMM liquidity for liquidation */
            }
            uint256 costToBuyBackBase = (liquidatedSizeBase * currentAmmQuote) /
                (currentAmmBase - liquidatedSizeBase);
            amm.swapQuoteForBase(costToBuyBackBase); // AMM receives costToBuyBackBase, gives out liquidatedSizeBase
            quoteValueFromClosing = costToBuyBackBase; // This is the "value" of the short closure in terms of quote spent
        }

        // Calculate PnL (from perspective of liquidated trader)
        uint256 entryValueQuoteScaled = pos.size.mul(
            pos.entryPrice,
            PRICE_PRECISION
        );
        int256 pnlScaled;
        if (pos.side == IPositionLedger.PositionSide.LONG) {
            pnlScaled =
                int256(quoteValueFromClosing) -
                int256(entryValueQuoteScaled);
        } else {
            pnlScaled =
                int256(entryValueQuoteScaled) -
                int256(quoteValueFromClosing); // (entry "sale" price - exit "buy" cost)
        }

        // Convert PnL to collateral decimals
        int256 pnlCollateralDecimals;
        if (collateralDecimals < 18)
            pnlCollateralDecimals =
                pnlScaled /
                int256(10 ** (18 - collateralDecimals));
        else if (collateralDecimals > 18)
            pnlCollateralDecimals =
                pnlScaled *
                int256(10 ** (collateralDecimals - 18));
        else pnlCollateralDecimals = pnlScaled;

        // Calculate liquidator fee from the trader's margin
        // Typically a % of the liquidated position size (value, not margin) or % of margin
        uint256 positionValueAtLiquidationQuote; // Value of position at liquidation price
        if (pos.side == IPositionLedger.PositionSide.LONG)
            positionValueAtLiquidationQuote = quoteValueFromClosing;
        else positionValueAtLiquidationQuote = entryValueQuoteScaled; // or use mark price * size. For simplicity, use quoteValueFromClosing as rough value.

        uint256 liquidatorFeeQuoteScaled = positionValueAtLiquidationQuote.mul(
            liquidationFeeBps,
            FEE_PRECISION
        );
        uint256 liquidatorFeeCollateralDecimals;
        if (collateralDecimals < 18)
            liquidatorFeeCollateralDecimals =
                liquidatorFeeQuoteScaled /
                (10 ** (18 - collateralDecimals));
        else
            liquidatorFeeCollateralDecimals =
                liquidatorFeeQuoteScaled *
                (10 ** (collateralDecimals - 18));
        // else liquidatorFeeCollateralDecimals = liquidatorFeeQuoteScaled;

        // Distribute funds:
        // Trader's remaining margin = pos.margin + pnlCollateralDecimals - liquidatorFeeCollateralDecimals
        // If this is negative, it's bad debt (Insurance Fund covers).
        // For now, liquidator fee comes from pos.margin.
        uint256 amountToLiquidator = 0;
        if (pos.margin >= liquidatorFeeCollateralDecimals) {
            amountToLiquidator = liquidatorFeeCollateralDecimals;
            // Transfer to liquidator's free balance (or directly transfer token)
            traderBalances[msg.sender] = traderBalances[msg.sender].add(
                amountToLiquidator
            );
        } else {
            amountToLiquidator = pos.margin; // Liquidator gets whatever margin is left, up to their fee.
            traderBalances[msg.sender] = traderBalances[msg.sender].add(
                amountToLiquidator
            );
        }

        // Update PositionLedger
        positionLedger.liquidatePosition(
            trader,
            baseAsset,
            msg.sender,
            liquidatedSizeBase
        );

        // TODO: Handle remaining margin/loss. If (pos.margin - amountToLiquidator + pnlCollateralDecimals) > 0, return to trader.
        // Else, if negative, draw from Insurance Fund.

        emit LiquidationInitiated(
            trader,
            baseAsset,
            msg.sender,
            liquidatedSizeBase,
            markPrice,
            amountToLiquidator
        );
        // This is highly simplified. Real liquidations are much more involved.
    }

    // --- Funding ---
    // Placeholder for funding rate settlement logic
    // function settleFunding(address baseAsset) external  {
    //     if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
    //     // 1. Get mark price (from vAMM) and index price (from Oracle).
    //     // 2. Calculate funding rate: (markPrice - indexPrice) / indexPrice / N (e.g., N=24 for hourly rate over 24h period)
    //     // 3. Iterate through all open positions for this baseAsset.
    //     // 4. For each position:
    //     //    - Calculate funding payment: position.size * fundingRate * (currentTime - position.lastFundingTimestamp)
    //     //    - If Long pays Short (mark > index, funding is positive): debit Long's margin, credit Short's margin.
    //     //    - If Short pays Long (mark < index, funding is negative): debit Short's margin, credit Long's margin.
    //     //    - Update position.lastFundingTimestamp.
    //     //    - Check for liquidations due to funding payments depleting margin.
    //     // This requires efficient iteration over positions or a per-position settlement trigger.
    // }

    // --- View Functions ---
    function getMarkPrice(
        address baseAsset
    ) public view  returns (uint256) {
        if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
        IVirtualAMM amm = virtualAmms[baseAsset];
        if (address(amm) == address(0)) return 0; // Or revert
        // vAMM spot price should already be scaled by PRICE_PRECISION
        return amm.getSpotPrice();
    }

    function getIndexPrice(
        address baseAsset
    ) public view  returns (uint256) {
        if (!supportedBaseAssets[baseAsset]) revert AssetNotSupported();
        IPriceOracle oracle = priceOracles[baseAsset];
        if (address(oracle) == address(0)) return 0; // Or revert
        // Assume oracle price is also scaled by PRICE_PRECISION
        // The quote asset for the oracle should be consistent with our collateral.
        // For simplicity, assume oracle prices baseAsset against our collateralToken's underlying (e.g. USD if collateral is USDC)
        return oracle.getPrice(baseAsset, address(collateralToken)); // Or address(0) if oracle implies quote.
    }

    function getPosition(
        address trader,
        address baseAsset
    ) public view  returns (IPositionLedger.Position memory) {
        if (
            !supportedBaseAssets[baseAsset] &&
            !positionLedger.hasPosition(trader, baseAsset)
        ) {
            // If asset not supported but position somehow exists (e.g. was removed), still allow query
            // However, a robust system would prevent this state.
            // For now, if asset not supported, just query ledger.
        }
        return positionLedger.getPosition(trader, baseAsset);
    }

    // --- Internal Helper Functions ---
    // function _getNormalizedQuoteAmount(uint256 quoteAmount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
    //     if (fromDecimals == toDecimals) return quoteAmount;
    //     if (fromDecimals < toDecimals) {
    //         return quoteAmount * (10**(uint256(toDecimals - fromDecimals)));
    //     } else {
    //         return quoteAmount / (10**(uint256(fromDecimals - toDecimals)));
    //     }
    // }

    // function _calculateFee(uint256 positionSizeQuote) internal view returns (uint256 fee) {
    //     // Assuming positionSizeQuote is already scaled (e.g. by PRICE_PRECISION)
    //     return positionSizeQuote.mul(takerFeeBps, FEE_PRECISION);
    // }
}
