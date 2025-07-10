// contracts/proxy/PrivacyProxy.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ClearingHouseV2} from "../../perp-dex-minimal/ClearingHouseV2.sol";
import {TokenPool} from "../core/TokenPool.sol";
import {ProofLib} from "../libraries/ProofLib.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {console} from "hardhat/console.sol";

/**
 * @title PrivacyProxy
 * @author Your Name
 * @notice A proxy contract that enables users of a TokenPool (dark pool) to trade
 * on a perpetuals DEX (ClearingHouse) privately. All positions on the ClearingHouse
 * are owned by this contract, while the true ownership is managed internally
 * via ECDSA signatures derived from a user's private "dark pool secret".
 */
contract PrivacyProxy {
    using SafeERC20 for IERC20;
    using ProofLib for ProofLib.WithdrawOrTransferParams;
    using ProofLib for ProofLib.ClaimParams;

    // --- State ---
    ClearingHouseV2 public immutable clearingHouse;
    TokenPool public immutable tokenPool;
    IERC20 public immutable collateralToken;

    // Mapping from user's public key (derived from their secret) to their free collateral held by the proxy.
    mapping(bytes32 => uint256) public userFreeCollateral;

    // Mapping from a positionId on the ClearingHouse to the owner's public key.
    mapping(bytes32 => bytes32) public positionOwner;

    // --- Errors ---
    error InvalidSignature();
    error InsufficientProxyCollateral();
    error NotPositionOwner();

    // --- Events ---
    event CollateralDeposited(bytes32 indexed ownerPubKey, uint256 amount, bool fromDarkPool);
    event CollateralWithdrawn(bytes32 indexed ownerPubKey, bytes32 receiverHash, uint256 amount);
    event PositionOpened(bytes32 indexed ownerPubKey, bytes32 positionId);
    event PositionClosed(bytes32 indexed ownerPubKey, bytes32 positionId);

    constructor(address _clearingHouse, address _tokenPool) {
        clearingHouse = ClearingHouseV2(_clearingHouse);
        tokenPool = TokenPool(_tokenPool);
        collateralToken = clearingHouse.collateralToken();

        // The proxy needs to approve the ClearingHouse to spend its collateral
        collateralToken.approve(address(clearingHouse), type(uint256).max);
    }

    // --- Collateral Management ---

    /**
     * @notice Deposits collateral from a user's EOA into their private trading account.
     */
    function depositCollateralFromEOA(bytes32 _ownerPubKey, uint256 _amount) external {
        // 1. Pull funds from the user's wallet into this proxy contract.
        collateralToken.safeTransferFrom(msg.sender, address(this), _amount);
        
        // 2. Deposit those funds from the proxy into the ClearingHouse.
        clearingHouse.depositCollateral(_amount);

        // 3. Credit the user's private account within the proxy.
        userFreeCollateral[_ownerPubKey] += _amount;

        emit CollateralDeposited(_ownerPubKey, _amount, false);
    }

    /**
     * @notice Deposits collateral from a user's private balance in the TokenPool.
     */
    function depositCollateralFromDarkPool(bytes32 _ownerPubKey, ProofLib.WithdrawOrTransferParams memory _params) external {
        // 1. User proves ownership of funds. The TokenPool approves this proxy to spend them.
        tokenPool.approveWithdrawal(_params);

        // 2. Pull the approved funds from the TokenPool into this proxy contract.
        uint256 amount = _params.value();
        collateralToken.safeTransferFrom(address(tokenPool), address(this), amount);
        
        // 3. Deposit funds from the proxy into the ClearingHouse.
        clearingHouse.depositCollateral(amount);

        // 4. Credit the user's private account.
        userFreeCollateral[_ownerPubKey] += amount;

        emit CollateralDeposited(_ownerPubKey, amount, true);
    }
    
    /**
     * @notice Withdraws collateral from the user's private account back into the TokenPool as a new note.
     */
    function withdrawCollateralToDarkPool(bytes32 _ownerPubKey, uint256 _amount, bytes32 _receiverHash, bytes memory _signature) external {
        bytes32 messageHash = keccak256(abi.encodePacked("WITHDRAW_COLLATERAL", _amount, _receiverHash));
        _verifySignature(_ownerPubKey, messageHash, _signature);


        
        if (_amount > userFreeCollateral[_ownerPubKey]) revert InsufficientProxyCollateral();

        // 1. Withdraw from the ClearingHouse into this proxy contract.
        clearingHouse.withdrawCollateral(_amount);

        // 2. Deposit into the TokenPool to create a private note for the user.
        // The TokenPool will pull the funds from this contract.
        collateralToken.approve(address(tokenPool), _amount);
        tokenPool.depositFor(_receiverHash, _amount);

        // 3. Debit the user's private account.
        userFreeCollateral[_ownerPubKey] -= _amount;

        emit CollateralWithdrawn(_ownerPubKey, _receiverHash, _amount);
    }

    // --- Trading Functions ---
    // All trading functions require an ECDSA signature to prove ownership.

    function openPosition(
        bytes32 _ownerPubKey,
        bytes32 _positionId,
        uint256 _margin,
        uint256 _leverage,
        bool _isLong,
        bytes memory _signature
    ) external {
        bytes32 messageHash = keccak256(abi.encodePacked("OPEN_POSITION", _positionId, _margin, _leverage, _isLong));
        _verifySignature(_ownerPubKey, messageHash, _signature);

        if (_margin > userFreeCollateral[_ownerPubKey]) revert InsufficientProxyCollateral();

        // 1. Debit user's collateral and record ownership of the position.
        userFreeCollateral[_ownerPubKey] -= _margin;
        positionOwner[_positionId] = _ownerPubKey;

        // 2. Open the position on the ClearingHouse. msg.sender is this proxy contract.
        clearingHouse.openPosition(_positionId, _margin, _leverage, _isLong);

        emit PositionOpened(_ownerPubKey, _positionId);
    }

    function closePosition(bytes32 _positionId, bytes memory _signature) external {
        bytes32 ownerPubKey = _validatePositionOwner(_positionId, "CLOSE_POSITION", _signature);
        
        // 1. Close the position on the ClearingHouse and CAPTURE the returned amount.
        uint256 amountReturned = clearingHouse.closePosition(_positionId);

        // 2. Immediately and accurately credit the user's private balance.
        // The original margin was debited on open, so we credit the full return.
        if (amountReturned > 0) {
            userFreeCollateral[ownerPubKey] += amountReturned;
        }

        // 3. Clean up the position ownership record.
        delete positionOwner[_positionId];
        
        emit PositionClosed(ownerPubKey, _positionId);
    }

    function addMargin(bytes32 _positionId, uint256 _amount, bytes memory _signature) external {
        bytes32 ownerPubKey = _validatePositionOwner(_positionId, "ADD_MARGIN", _signature);
        if (_amount > userFreeCollateral[ownerPubKey]) revert InsufficientProxyCollateral();
        
        userFreeCollateral[ownerPubKey] -= _amount;
        clearingHouse.addMargin(_positionId, _amount);
    }

    function removeMargin(bytes32 _positionId, uint256 _amount, bytes memory _signature) external {
        _validatePositionOwner(_positionId, "REMOVE_MARGIN", _signature);

        // When margin is removed, it goes from the position back to the ClearingHouse's free collateral pool
        // (which is owned by this proxy). We then credit the user's internal account.
        clearingHouse.removeMargin(_positionId, _amount);
        userFreeCollateral[positionOwner[_positionId]] += _amount;
    }

    // --- Internal Helpers ---

    function _verifySignature(bytes32 _pubKey, bytes32 _messageHash, bytes memory _signature) internal pure {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(_messageHash);
        address recoveredAddress = ECDSA.recover(digest, _signature);
        
        if (keccak256(abi.encodePacked(recoveredAddress)) != _pubKey) {
            revert InvalidSignature();
        }
    }
    
    function _validatePositionOwner(bytes32 _positionId, string memory _action, bytes memory _signature) internal view returns (bytes32) {
        bytes32 ownerPubKey = positionOwner[_positionId];
        if(ownerPubKey == bytes32(0)) revert NotPositionOwner(); // Or PositionNotFound
        
        bytes32 messageHash = keccak256(abi.encodePacked(_action, _positionId));
        _verifySignature(ownerPubKey, messageHash, _signature);
        
        return ownerPubKey;
    }
}