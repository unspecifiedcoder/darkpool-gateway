// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EthPool} from "./EthPool.sol";
import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import { ProofLib } from "../libraries/ProofLib.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {IAssetPool} from "../interfaces/IAssetPool.sol";
import {TokenPool} from "./TokenPool.sol";

contract EntryPoint is IEntryPoint {
    using ProofLib for ProofLib.WithdrawOrTransferParams;
    using ProofLib for ProofLib.ClaimParams;

    enum AssetType {
        ETH,
        ERC20
    }

    uint32 public immutable treeDepth;
    

    address public owner;
    address public claimVerifier;
    address public withdrawTransferVerifier;
    
    mapping(address _asset => IAssetPool _pool) public assetToPool;


    modifier onlyOwner() {
        require(msg.sender == owner, "EntryPoint: Caller is not the owner");
        _;
    }

    modifier isPool(address asset) {
        require(address(assetToPool[asset]) != address(0), "EntryPoint: Pool does not exist");
        _;
    }


    constructor(
        address _owner,
        address _claimVerifier,
        address _withdrawTransferVerifier,
        uint32 _treeDepth
    ) {
        owner = _owner;
        claimVerifier = _claimVerifier;
        withdrawTransferVerifier = _withdrawTransferVerifier;
        treeDepth = _treeDepth;

        IAssetPool ethPool = new EthPool(
            address(this),
            withdrawTransferVerifier,
            claimVerifier,
            treeDepth
        );
        assetToPool[address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)] = ethPool;
    }

    // --- Governance Functions ---
    function createPool(address asset) external onlyOwner {
        // check if asset pool already exists else create it
        require(address(assetToPool[asset]) == address(0), "EntryPoint: Pool already exists");
        require(asset == address(0), "EntryPoint: Invalid asset");

        IAssetPool tokenPool = new TokenPool(
            address(this),
            asset,
            withdrawTransferVerifier,
            claimVerifier,
            treeDepth
        );
        assetToPool[asset] = tokenPool;
    }

    // --- User Actions ---
    function deposit(
        address asset,
        uint256 amount,
        bytes32 precommitment
    ) external payable isPool(asset) {
        if (isEthPool(asset)) {
            assetToPool[asset].deposit{value: amount}(amount, precommitment);
        } else {
            assetToPool[asset].deposit(amount, precommitment);
        }
        emit Deposit(asset, amount);
    }

    function withdraw(
        address asset,
        ProofLib.WithdrawOrTransferParams memory params
    ) external isPool(asset) returns (uint32 leafIndex) {
        
        leafIndex = assetToPool[asset].withdraw(params);
        if (isEthPool(asset)) {
            payable(msg.sender).transfer(params.value());
        }
        emit Withdraw(asset, params.value());
    }

    function transfer(
        address asset,
        ProofLib.WithdrawOrTransferParams memory params,
        bytes32 receiverHash
    ) external isPool(asset) returns (uint32 leafIndex) {
        
        leafIndex = assetToPool[asset].transfer(params, receiverHash);
        uint256 noteNonce = assetToPool[asset].noteNonce();
        emit NoteCreated(receiverHash, asset, params.value(), noteNonce-1);
    }

    function claim(
        address asset,
        ProofLib.ClaimParams memory params
    ) external isPool(asset) returns (uint32 leafIndex) {

        leafIndex = assetToPool[asset].claim(params);
        uint256 noteNonce = assetToPool[asset].noteNonce();

        bytes32 noteID = keccak256(
            abi.encodePacked(address(asset), noteNonce-1)
        );
        emit NoteClaimed(noteID, asset, params.value());
    }

    function isEthPool(address asset) internal pure returns (bool) {
        return asset == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    }

    // --- View Functions ---
    function getPool(address asset) external view returns (address poolAddress) {
        return address(assetToPool[asset]);
    }
}
