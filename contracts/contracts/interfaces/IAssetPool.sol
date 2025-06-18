// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAssetPool {
    // --- Events ---
    event CommitmentInserted(bytes32 indexed leaf, uint32 indexed leafIndex, bytes32 newRoot);
    event NullifierSpent(bytes32 indexed nullifier);
    // Removed RootUpdated as CommitmentInserted implies this.
    // However, if there are other ways a root can change (e.g., batch updates, though not planned),
    // it might be useful. For now, simplifying.

    // --- State Modifying Functions (callable primarily by EntryPoint) ---
    function initialize(
        address _entryPoint,
        address _asset, // address(0) for ETH
        uint8 _assetType, // 0 for ETH, 1 for ERC20
        address _verifier, // Verifier for this pool's actions
        uint32 _treeDepth
    ) external;

    /**
     * @notice Handles a direct deposit into the pool.
     * @param depositor The address making the deposit.
     * @param amount The amount of the asset being deposited.
     * @param commitmentLeaf The new commitment leaf to be inserted into the Merkle tree.
     * @return newRoot The new Merkle root after inserting the commitment.
     * @return leafIndex The index at which the commitment was inserted.
     */
    function deposit(
        address depositor,
        uint256 amount,
        bytes32 commitmentLeaf
    ) external payable returns (bytes32 newRoot, uint32 leafIndex);

    /**
     * @notice Spends an existing nullifier and inserts a new commitment based on a ZK proof.
     * Used for actions like withdraw, transfer (creating change), or DeFi interaction (creating change).
     * The ZK proof verifies that:
     * 1. An old commitment (linked to `nullifierToSpend`) existed under `expectedOldMerkleRoot`.
     * 2. `newCommitmentLeaf` is correctly formed based on the operation (e.g., value - withdrawAmount).
     * @param expectedOldMerkleRoot The Merkle root against which the ZK proof was generated (current root of this pool).
     * @param newCommitmentLeaf The new commitment leaf to be inserted (e.g., change note). Can be bytes32(0) if no change.
     * @param nullifierToSpend The nullifier of the input note being spent.
     * @param valueToTransact The amount of asset being moved out of this pool's direct control
     *                       (e.g., to user's L1 address, or to a DeFi adaptor).
     * @param recipient The recipient of `valueToTransact` (user address or adaptor address).
     * @return newRoot The new Merkle root after inserting the new commitment (if any).
     * @return newLeafIndex The index of the new commitment (if any).
     */
    function spendAndInsert(
        bytes32 expectedOldMerkleRoot,
        bytes32 newCommitmentLeaf,
        bytes32 nullifierToSpend,
        uint256 valueToTransact,
        address recipient
    ) external returns (bytes32 newRoot, uint32 newLeafIndex);

    /**
     * @notice Inserts a new commitment, typically when claiming an intermediate note (e.g., from a transfer or DeFi output).
     * The ZK proof for claiming the note verifies the note's validity and the formation of `newCommitmentLeaf`.
     * This function only focuses on inserting the resulting commitment into this pool's tree.
     * @param expectedOldMerkleRoot The Merkle root against which the claim proof (related to the intermediate note, not necessarily this pool's direct state) was verified, if the claim also proves something about an *existing* balance in this pool (top-up scenario). If it's a fresh claim into an empty slot for the user, this might be less relevant for *this pool's state validation* but critical for the *claim verifier*. For simplicity here, we assume the claim proof is primarily about the note, and this function inserts the outcome.
     * @param newCommitmentLeaf The new commitment to be inserted into this pool.
     * @return newRoot The new Merkle root after inserting the commitment.
     * @return leafIndex The index at which the commitment was inserted.
     */
    function insertCommitment(
        bytes32 expectedOldMerkleRoot, // To ensure consistency if proof depended on this pool's state.
        bytes32 newCommitmentLeaf
    ) external returns (bytes32 newRoot, uint32 leafIndex);

    function setVerifier(address newVerifier) external; // Governance action from EntryPoint

    // --- View Functions ---
    function entryPoint() external view returns (address);
    function asset() external view returns (address);
    function assetType() external view returns (uint8); // 0 for ETH, 1 for ERC20
    function verifier() external view returns (address);
    function currentRoot() external view returns (bytes32);
    function nextLeafIndex() external view returns (uint32);
    function isNullifierSpent(bytes32 nullifier) external view returns (bool);
    function TREE_DEPTH() external view returns (uint32);
    function getLeaf(uint32 leafIndex) external view returns (bytes32); // To fetch a specific leaf
    function getPath(uint32 leafIndex) external view returns (bytes32[] memory siblings); // To get Merkle path for a leaf
}