// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ProofLib } from "../libraries/ProofLib.sol";
interface IEntryPoint {
    // --- Events ---
    event PoolCreated(address indexed asset, address indexed poolAddress);
    event DefiAdaptorListed(address indexed adaptorAddress, string adaptorName);
    event DefiAdaptorUnlisted(address indexed adaptorAddress);
    
    event Deposit(address indexed asset, uint256 amount);
    event Withdraw(address indexed asset, uint256 amount);
    
    event NoteCreated(bytes32 indexed receiverHash, address indexed asset, uint256 amount, uint256 noteNonce);
    event NoteClaimed(bytes32 indexed noteID, address indexed asset, uint256 amount);


    // --- Governance Functions ---
    function createPool(address asset) external;
    
    // --- User Actions ---
    function deposit(
        address asset,
        uint256 amount,
        bytes32 precommitment
    ) external payable;

    function withdraw(
        address asset,
        address receiver,
        ProofLib.WithdrawOrTransferParams memory params
    ) external  returns (uint32 leafIndex);

    function transfer(
        address asset,
        ProofLib.WithdrawOrTransferParams memory params, bytes32 receiverHash
    ) external returns (uint32 leafIndex);

    function claim(
        address asset,
        ProofLib.ClaimParams memory params
    ) external returns (uint32 leafIndex);

    // --- View Functions ---
}