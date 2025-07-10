// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Oracle} from "./Oracle.sol";
import {MockERC20} from "./../mocks/MockERC20.sol";

contract ClearingHouseV2 is ReentrancyGuard {
    // --- Custom Errors ---
    error InvalidAmount();
    error InsufficientFreeCollateral();
    error PositionExists();
    error PositionNotFound();
    error InvalidLeverage();
    error PositionUndercollateralized();
    error PositionNotLiquidatable();
    error NotPositionOwner(); 
    error ZeroAddress();

    // --- Events ---
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event PositionOpened(address indexed user, bytes32 indexed positionId, uint256 size, uint256 margin, bool isLong, uint256 entryPrice);
    event PositionClosed(address indexed user, bytes32 indexed positionId, int256 pnl, uint256 fee);
    event MarginAdded(address indexed user, bytes32 indexed positionId, uint256 amount);
    event MarginRemoved(address indexed user, bytes32 indexed positionId, uint256 amount);
    event PositionLiquidated(address indexed user, bytes32 indexed positionId, address liquidator, uint256 liquidationFee);

    // --- Structs ---
    struct Position {
        address owner;      
        uint256 size;       
        uint256 margin;     
        uint256 entryPrice; 
        bool isLong;        
    }

    // --- State Variables ---
    Oracle public immutable oracle;
    MockERC20 public immutable collateralToken; // USDC

    mapping(bytes32 => Position) public positions;
    mapping(address => uint256) public freeCollateral; 

    // --- Constants ---
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant LEVERAGE_PRECISION = 100;
    uint256 public constant MIN_LEVERAGE = 1 * LEVERAGE_PRECISION;
    uint256 public constant MAX_LEVERAGE = 100 * LEVERAGE_PRECISION;
    uint256 public constant TAKER_FEE_BPS = 10;
    uint256 public constant LIQUIDATION_FEE_BPS = 500;
    uint256 public constant BPS_DIVISOR = 10000;
    uint256 public constant MAINTENANCE_MARGIN_RATIO_BPS = 245; // can trade up to 40x leverage

    // --- Constructor ---
    constructor(address _oracleAddress, address _collateralTokenAddress) {
        if(_oracleAddress == address(0) || _collateralTokenAddress == address(0)) revert ZeroAddress();
        oracle = Oracle(_oracleAddress);
        collateralToken = MockERC20(_collateralTokenAddress);
    }

    // --- Collateral Management (Unchanged) ---
    function depositCollateral(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        freeCollateral[msg.sender] += _amount;
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

    // --- Position Management (V2 Updates) ---
    function openPosition(bytes32 _positionId, uint256 _margin, uint256 _leverage, bool _isLong) external nonReentrant {
        if (positions[_positionId].owner != address(0)) revert PositionExists();
        if (_margin == 0) revert InvalidAmount();
        if (_leverage < MIN_LEVERAGE || _leverage > MAX_LEVERAGE) revert InvalidLeverage();
        if (_margin > freeCollateral[msg.sender]) revert InsufficientFreeCollateral();

        freeCollateral[msg.sender] -= _margin;
        uint256 positionValue = (_margin * _leverage) / LEVERAGE_PRECISION;
        uint256 fee = (positionValue * TAKER_FEE_BPS) / BPS_DIVISOR;
        if (fee >= _margin) revert InsufficientFreeCollateral();
        uint256 marginAfterFee = _margin - fee;
        uint256 entryPrice = oracle.getPrice();
        uint256 size = (positionValue * PRICE_PRECISION) / entryPrice;

        positions[_positionId] = Position({
            owner: msg.sender,
            size: size,
            margin: marginAfterFee,
            entryPrice: entryPrice,
            isLong: _isLong
        });

        emit PositionOpened(msg.sender, _positionId, size, marginAfterFee, _isLong, entryPrice);
    }

    function closePosition(bytes32 _positionId)
        external
        nonReentrant
        returns (uint256 amountReturned) 
    {
        Position storage position = positions[_positionId];
        if (position.owner != msg.sender) revert NotPositionOwner();

        (int256 pnl, ) = _calculatePnl(_positionId);
        uint256 markPrice = oracle.getPrice();
        uint256 positionValue = (position.size * markPrice) / PRICE_PRECISION;
        uint256 fee = (positionValue * TAKER_FEE_BPS) / BPS_DIVISOR;

        int256 netPnl = pnl - int256(fee);
        int256 totalAmount = int256(position.margin) + netPnl;

        // If the trade was profitable, the house mints the profit.
        if (netPnl > 0) {
            collateralToken.mint(address(this), uint256(netPnl));
        }
        
        // If totalAmount is positive, add it to the caller's free collateral.
        if (totalAmount > 0) {
            freeCollateral[msg.sender] += uint256(totalAmount);
            amountReturned = uint256(totalAmount); // <-- V3: Set the return value
        } else {
            amountReturned = 0; // If they lost everything, 0 is returned.
        }

        emit PositionClosed(msg.sender, _positionId, pnl, fee);
        delete positions[_positionId];
    }

    // --- Margin Management (V2 Updates) ---
    function addMargin(bytes32 _positionId, uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        Position storage position = positions[_positionId];
        if (position.owner != msg.sender) revert NotPositionOwner();
        if (_amount > freeCollateral[msg.sender]) revert InsufficientFreeCollateral();

        freeCollateral[msg.sender] -= _amount;
        position.margin += _amount;

        emit MarginAdded(msg.sender, _positionId, _amount);
    }

    function removeMargin(bytes32 _positionId, uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        Position storage position = positions[_positionId];
        if (position.owner != msg.sender) revert NotPositionOwner();
        if (_amount > position.margin) revert InvalidAmount();

        position.margin -= _amount;
        (, bool isSolvent) = _calculatePnl(_positionId);
        if (!isSolvent) {
            position.margin += _amount;
            revert PositionUndercollateralized();
        }

        freeCollateral[msg.sender] += _amount;
        emit MarginRemoved(msg.sender, _positionId, _amount);
    }

    // --- Liquidation (V2 Updates) ---
    function liquidate(bytes32 _positionId) external nonReentrant {
        Position memory position = positions[_positionId];
        if (position.owner == address(0)) revert PositionNotFound();

        (, bool isSolvent) = _calculatePnl(_positionId);
        if (isSolvent) revert PositionNotLiquidatable();

        uint256 markPrice = oracle.getPrice();
        uint256 positionValue = (position.size * markPrice) / PRICE_PRECISION;
        uint256 liquidationFee = (positionValue * LIQUIDATION_FEE_BPS) / BPS_DIVISOR;

        if (liquidationFee > position.margin) {
            liquidationFee = position.margin;
        }

        collateralToken.mint(msg.sender, liquidationFee);
        
        emit PositionLiquidated(position.owner, _positionId, msg.sender, liquidationFee);
        delete positions[_positionId];
    }

    // --- View and Helper Functions (V2 Updates) ---
    function _calculatePnl(bytes32 _positionId) internal view returns (int256 pnl, bool isSolvent) {
        Position memory position = positions[_positionId];
        if (position.owner == address(0)) return (0, true);

        int256 currentPrice = int256(oracle.getPrice());
        int256 entryPrice = int256(position.entryPrice);

        if (position.isLong) {
            pnl = ( (currentPrice - entryPrice) * int256(position.size) ) / int256(PRICE_PRECISION);
        } else {
            pnl = ( (entryPrice - currentPrice) * int256(position.size) ) / int256(PRICE_PRECISION);
        }
        
        int256 totalEquity = int256(position.margin) + pnl;
        uint256 positionValue = (position.size * uint256(currentPrice)) / PRICE_PRECISION;
        uint256 requiredMargin = (positionValue * MAINTENANCE_MARGIN_RATIO_BPS) / BPS_DIVISOR;

        isSolvent = totalEquity > int256(requiredMargin);
    }

    function calculatePnl(bytes32 _positionId) external view returns (int256 pnl, bool isSolvent) {
        if(positions[_positionId].owner == address(0)) revert PositionNotFound();
        return _calculatePnl(_positionId);
    }
}



