// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAssetPool {
    // --- Events ---
    event CommitmentInserted(bytes32 indexed leaf, uint32 indexed leafIndex, bytes32 newRoot);
    event NullifierSpent(bytes32 indexed nullifier);
    event NoteIssued(address indexed receiverHash, bytes32 noteID, uint256 amount, address asset);
    event NoteSpent(address indexed receiverHash, bytes32 noteID, uint256 amount, address asset);


    // --- State Modifying Functions (callable primarily by EntryPoint) ---
    function initialize(
        address _entryPoint,
        address _asset, // address(0) for ETH
        address _withdraw_transfer_verifier,
        address _claim_verifier,
        uint32 _treeDepth
    ) external;


    function deposit(
        uint256 amount,
        bytes32 precommitment
    ) external payable returns (bytes32 newRoot, uint32 leafIndex);

    function withdraw(
        
    ) external returns (bytes32 newRoot, uint32 leafIndex);

    function setWithdrawTransferVerifier(address newVerifier) external; // Governance action from EntryPoint
    function setClaimVerifier(address newVerifier) external; // Governance action from EntryPoint

    // --- View Functions ---
    function entryPoint() external view returns (address);
    function asset() external view returns (address);
    function withdraw_transfer_verifier() external view returns (address);
    function claim_verifier() external view returns (address);
    function currentRoot() external view returns (bytes32);
    function nextLeafIndex() external view returns (uint32);
    function isNullifierSpent(bytes32 nullifier) external view returns (bool);
    function TREE_DEPTH() external view returns (uint32);
    function getLeaf(uint32 leafIndex) external view returns (bytes32); // To fetch a specific leaf
    function getPath(uint32 leafIndex) external view returns (bytes32[] memory siblings); // To get Merkle path for a leaf
}