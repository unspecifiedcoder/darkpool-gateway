// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ProofLib } from "../libraries/ProofLib.sol";

interface IAssetPool {
    

    
    // --- Events ---
    event CommitmentInserted(bytes32 indexed leaf, uint32 indexed leafIndex, bytes32 newRoot);

    event NoteCreated(bytes32 indexed receiverHash, uint256 amount, uint256 noteNonce);
    event NoteClaimed(bytes32 indexed noteID, uint256 amount);

    

    // --- State Modifying Functions (callable primarily by EntryPoint) ---
    function deposit(
        uint256 amount,
        bytes32 precommitment
    ) external payable returns (uint32 leafIndex);

    function withdraw(
        address receiver,
        ProofLib.WithdrawOrTransferParams memory params
    ) external returns (uint32 leafIndex);

    function transfer(
        ProofLib.WithdrawOrTransferParams memory params, bytes32 receiverHash
    ) external returns (uint32 leafIndex);

    function claim(
        ProofLib.ClaimParams memory params
    ) external returns (uint32 leafIndex);

    function setWithdrawTransferVerifier(address newVerifier) external; // Governance action from EntryPoint
    function setClaimVerifier(address newVerifier) external; // Governance action from EntryPoint

    // --- View Functions ---
    function entryPoint() external view returns (address);
    function noteNonce() external view returns (uint256);
    function withdraw_transfer_verifier() external view returns (address);
    function claim_verifier() external view returns (address);
    function currentRoot() external view returns (bytes32);
    function nextLeafIndex() external view returns (uint32);
    function isNullifierSpent(bytes32 nullifier) external view returns (bool);
    function TREE_DEPTH() external view returns (uint32);
    function getLeaf(uint32 leafIndex) external view returns (bytes32); // To fetch a specific leaf
    function getPath(uint32 leafIndex) external view returns (bytes32[] memory siblings); // To get Merkle path for a leaf
}