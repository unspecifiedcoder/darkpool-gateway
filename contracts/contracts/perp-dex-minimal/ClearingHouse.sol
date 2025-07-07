// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Oracle} from "./Oracle.sol";
import {MockERC20} from "./../mocks/MockERC20.sol"; // We need the type to call mint

contract ClearingHouse is ReentrancyGuard {
    // --- Custom Errors ---
    error InvalidAmount();
    error InsufficientFreeCollateral();
    error PositionExists();
    error PositionNotFound();
    error InvalidLeverage();
    error PositionUndercollateralized();
    error PositionNotLiquidatable();
    error CallerNotOwnerOfPosition();
    error ZeroAddress();

    // --- Events ---
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event PositionOpened(address indexed user, uint256 size, uint256 margin, bool isLong, uint256 entryPrice);
    event PositionClosed(address indexed user, int256 pnl, uint256 fee);
    event MarginAdded(address indexed user, uint256 amount);
    event MarginRemoved(address indexed user, uint256 amount);
    event PositionLiquidated(address indexed user, address indexed liquidator, uint256 liquidationFee);

    // --- Structs ---
    struct Position {
        uint256 size;       // Size of the position in base asset units (e.g., BTC, 1e18)
        uint256 margin;     // Margin in collateral tokens (e.g., USDC, 1e18)
        uint256 entryPrice; // Price at which the position was opened (1e18)
        bool isLong;        // True if the position is long, false if short
    }

    // --- State Variables ---
    Oracle public immutable oracle;
    MockERC20 public immutable collateralToken; // USDC

    mapping(address => Position) public positions;
    mapping(address => uint256) public freeCollateral;

    // --- Constants ---
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant LEVERAGE_PRECISION = 100;
    uint256 public constant MIN_LEVERAGE = 1 * LEVERAGE_PRECISION;
    uint256 public constant MAX_LEVERAGE = 100 * LEVERAGE_PRECISION;

    uint256 public constant TAKER_FEE_BPS = 10; // 0.10%
    uint256 public constant LIQUIDATION_FEE_BPS = 500; // 5% fee for liquidator
    uint256 public constant BPS_DIVISOR = 10000;

    // 6.25% maintenance margin -> 625 / 10000
    uint256 public constant MAINTENANCE_MARGIN_RATIO_BPS = 625;

    // --- Constructor ---
    constructor(address _oracleAddress, address _collateralTokenAddress) {
        if(_oracleAddress == address(0) || _collateralTokenAddress == address(0)) revert ZeroAddress();
        oracle = Oracle(_oracleAddress);
        collateralToken = MockERC20(_collateralTokenAddress);
    }

    // --- Collateral Management ---

    function depositCollateral(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        freeCollateral[msg.sender] += _amount;
        // The user must have approved this contract to spend their tokens
        require(collateralToken.transferFrom(msg.sender, address(this), _amount), "Collateral transfer failed");
        emit CollateralDeposited(msg.sender, _amount);
    }

    function withdrawCollateral(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        if (_amount > freeCollateral[msg.sender]) revert InsufficientFreeCollateral();
        freeCollateral[msg.sender] -= _amount;
        require(collateralToken.transfer(msg.sender, _amount), "Collateral transfer failed");
        emit CollateralWithdrawn(msg.sender, _amount);
    }

    // --- Position Management ---

    function openPosition(uint256 _margin, uint256 _leverage, bool _isLong) external nonReentrant {
        if (positions[msg.sender].size != 0) revert PositionExists();
        if (_margin == 0) revert InvalidAmount();
        if (_leverage < MIN_LEVERAGE || _leverage > MAX_LEVERAGE) revert InvalidLeverage();
        if (_margin > freeCollateral[msg.sender]) revert InsufficientFreeCollateral();

        freeCollateral[msg.sender] -= _margin;

        uint256 positionValue = (_margin * _leverage) / LEVERAGE_PRECISION;
        uint256 fee = (positionValue * TAKER_FEE_BPS) / BPS_DIVISOR;

        // For simplicity, fee is paid from margin. Check if margin can cover it.
        if (fee >= _margin) revert InsufficientFreeCollateral();
        uint256 marginAfterFee = _margin - fee;

        // In this model, the contract "takes" the fee, but since it can mint,
        // we can just consider it removed from the user's margin.

        uint256 entryPrice = oracle.getPrice();
        uint256 size = (positionValue * PRICE_PRECISION) / entryPrice;

        positions[msg.sender] = Position({
            size: size,
            margin: marginAfterFee,
            entryPrice: entryPrice,
            isLong: _isLong
        });

        emit PositionOpened(msg.sender, size, marginAfterFee, _isLong, entryPrice);
    }

    function closePosition() external nonReentrant {
        Position storage position = positions[msg.sender];
        if (position.size == 0) revert PositionNotFound();

        (int256 pnl, ) = _calculatePnl(msg.sender);
        
        uint256 markPrice = oracle.getPrice();
        uint256 positionValue = (position.size * markPrice) / PRICE_PRECISION;
        uint256 fee = (positionValue * TAKER_FEE_BPS) / BPS_DIVISOR;

        // Calculate the net result of the trade (P&L - closing fee)
        int256 netPnl = pnl - int256(fee);

        // The total amount to be credited back is the margin held + the net result.
        // This can be negative if the loss is greater than the margin.
        int256 amountToReturn = int256(position.margin) + netPnl;

        // If the trade was profitable net of fees, the contract needs to mint the profit.
        if (netPnl > 0) {
            collateralToken.mint(address(this), uint256(netPnl));
        }

        // If amountToReturn is positive, add it to the user's free collateral.
        // If it's negative, they lost their entire margin, so we add 0.
        if (amountToReturn > 0) {
            freeCollateral[msg.sender] += uint256(amountToReturn);
        }

        emit PositionClosed(msg.sender, pnl, fee);
        delete positions[msg.sender];
    }
    // --- Margin Management ---

    function addMargin(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        Position storage position = positions[msg.sender];
        if (position.size == 0) revert PositionNotFound();
        if (_amount > freeCollateral[msg.sender]) revert InsufficientFreeCollateral();

        freeCollateral[msg.sender] -= _amount;
        position.margin += _amount;

        emit MarginAdded(msg.sender, _amount);
    }

    function removeMargin(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        Position storage position = positions[msg.sender];
        if (position.size == 0) revert PositionNotFound();
        if (_amount > position.margin) revert InvalidAmount(); // Cannot remove more margin than exists

        position.margin -= _amount;

        // Check solvency after removing margin
        (, bool isSolvent) = _calculatePnl(msg.sender);
        if (!isSolvent) {
            // Revert the state change if position becomes undercollateralized
            position.margin += _amount;
            revert PositionUndercollateralized();
        }

        freeCollateral[msg.sender] += _amount;
        emit MarginRemoved(msg.sender, _amount);
    }

    // --- Liquidation ---

    function liquidate(address _user) external nonReentrant {
        Position memory position = positions[_user];
        if (position.size == 0) revert PositionNotFound();

        (, bool isSolvent) = _calculatePnl(_user);
        if (isSolvent) revert PositionNotLiquidatable();

        // The user's entire margin is lost.
        // A portion of the position's value is given to the liquidator.
        uint256 markPrice = oracle.getPrice();
        uint256 positionValue = (position.size * markPrice) / PRICE_PRECISION;
        uint256 liquidationFee = (positionValue * LIQUIDATION_FEE_BPS) / BPS_DIVISOR;

        // The fee cannot be more than the user's posted margin.
        if (liquidationFee > position.margin) {
            liquidationFee = position.margin;
        }

        // The contract mints the fee and sends it to the liquidator.
        // The rest of the user's margin is kept by the house (it simply disappears from circulation).
        collateralToken.mint(msg.sender, liquidationFee);
        
        emit PositionLiquidated(_user, msg.sender, liquidationFee);
        delete positions[_user];
    }


    // --- View and Helper Functions ---
    function _calculatePnl(address _user) internal view returns (int256 pnl, bool isSolvent) {
        Position memory position = positions[_user];
        if (position.size == 0) return (0, true);

        int256 currentPrice = int256(oracle.getPrice());
        int256 entryPrice = int256(position.entryPrice);

        if (position.isLong) {
            pnl = ( (currentPrice - entryPrice) * int256(position.size) ) / int256(PRICE_PRECISION);
        } else {
            pnl = ( (entryPrice - currentPrice) * int256(position.size) ) / int256(PRICE_PRECISION);
        }
        
        // Check solvency against maintenance margin
        int256 totalEquity = int256(position.margin) + pnl;
        uint256 positionValue = (position.size * uint256(currentPrice)) / PRICE_PRECISION;
        uint256 requiredMargin = (positionValue * MAINTENANCE_MARGIN_RATIO_BPS) / BPS_DIVISOR;

        isSolvent = totalEquity > int256(requiredMargin);
    }

    function calculatePnl(address _user) external view returns (int256, bool) {
        if(positions[_user].size == 0) revert PositionNotFound();
        return _calculatePnl(_user);
    }
}