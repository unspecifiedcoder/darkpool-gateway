// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IEntryPoint {
    // --- Events ---
    event PoolCreated(address indexed asset, address indexed poolAddress, uint8 assetType, address verifierAddress);
    event PoolPaused(address indexed asset);
    event PoolResumed(address indexed asset);
    event DefiAdaptorListed(address indexed adaptorAddress, string adaptorName);
    event DefiAdaptorUnlisted(address indexed adaptorAddress);
    event PoolVerifierChanged(address indexed asset, address indexed newVerifier);
    event FeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    event Deposited(
        address indexed asset,
        address indexed depositor,
        uint256 amount,
        bytes32 indexed commitmentLeaf, // The new commitment leaf added to the pool's tree
        uint32 leafIndex,
        bytes32 newRoot
    );
    event Transferred( // For private transfer between users within the protocol
        address indexed asset,
        bytes32 spentNullifier,
        bytes32 senderChangeCommitmentLeaf, // Optional: if sender gets change
        bytes32 indexed noteHash, // Unique hash for the receiver to claim this transfer privately
        uint256 transferAmount,
        address indexed intendedReceiver // Hint for the receiver (e.g., their public key hash)
    );
    event Claimed( // When a receiver claims a private transfer note
        address indexed asset,
        bytes32 indexed noteHash, // The note being claimed
        bytes32 noteNullifier, // Nullifier marking the note as spent
        bytes32 indexed claimerNewCommitmentLeaf, // New commitment for the claimer in the pool
        uint32 leafIndex,
        bytes32 newRoot
    );
    event Withdrawn( // Direct withdrawal to an L1 address
        address indexed asset,
        bytes32 spentNullifier,
        bytes32 userChangeCommitmentLeaf, // Optional: if user gets change
        address indexed recipient,
        uint256 amount
    );
    event DefiExecuted(
        address indexed asset,
        address indexed adaptor,
        bytes32 spentNullifier,
        bytes32 userChangeCommitmentLeaf, // User's change commitment in the source asset pool
        uint256 sourceAmountUsed
    );

    // --- Structs ---
    // Matches public inputs of claim.nr (excluding private inputs)
    struct ClaimProofPublicInputs {
        uint256 claimValue; // Amount of the note being claimed & new commitment value (if no topup)
        uint256 noteNonce; // Nonce associated with the note being claimed
        uint256 receiverSecretHash; // Hash of receiver's secret for the *new* commitment
        // Optional fields for topping up existing commitment for claimer
        uint256 merkleRoot; // Current root of the asset pool (0 if new user)
        uint256 leafIndex; // Current leaf index of existing commitment (0 if new user)
        uint256 existingNullifier; // Nullifier of existing commitment (0 if new user)
        // Output of ZK circuit (the new commitment created for the claimer)
        uint256 newCommitment; // This is the commitment to be inserted into the tree
    }

    // Matches public inputs of withdrawOrTransfer.nr
    struct WithdrawOrTransferProofPublicInputs {
        uint256 withdrawValue; // Amount being withdrawn/transferred out
        uint256 merkleRoot; // Current root of the asset pool
        uint256 leafIndex; // Leaf index of the commitment being spent
        uint256 existingNullifier; // Nullifier of the commitment being spent
        // Output of ZK circuit (the change commitment for the sender)
        uint256 newCommitment;
    }


    // --- Governance Functions ---
    function createPool(address asset, uint8 assetType, address verifierAddress, bytes32 initialRoot, uint32 treeDepth) external;
    function pausePool(address asset) external;
    function resumePool(address asset) external;
    function listDefiAdaptor(address adaptorAddress, string calldata adaptorName, address verifierAddress) external;
    function unlistDefiAdaptor(address adaptorAddress) external;
    function setPoolVerifier(address asset, address newVerifierAddress) external;
    function setAdaptorVerifier(address adaptorAddress, address newVerifierAddress) external;
    function withdrawFees(address token, address recipient, uint256 amount) external;
    function setFeeParameters(uint256 newFeeBps, address newFeeRecipient) external;


    // --- User Actions ---
    function deposit(
        address asset,
        uint256 amount,
        bytes32 commitmentLeaf // User's new commitment
    ) external payable;

    function transfer(
        address asset,
        bytes calldata proof,
        WithdrawOrTransferProofPublicInputs calldata proofInputs,
        // Additional data for transfer note
        bytes32 receiverNoteSecretHash, // Hash of receiver's secret for the intermediate note
        uint256 noteNonce // Nonce to make the intermediate note unique
    ) external;

    function claim(
        address asset,
        bytes calldata proof,
        ClaimProofPublicInputs calldata proofInputs,
        // Data to identify and nullify the intermediate note
        uint256 originalNoteValue, // Value that was in the note
        bytes32 originalNoteReceiverHash, // The receiver hash that was on the note
        uint256 originalNoteNonce // The nonce that was on the note
    ) external;

    function withdraw(
        address asset,
        bytes calldata proof,
        WithdrawOrTransferProofPublicInputs calldata proofInputs,
        address recipient
    ) external;

    function executeDeFi(
        address sourceAsset,
        address adaptor,
        bytes calldata proof, // ZK proof of funds in the sourceAsset pool
        WithdrawOrTransferProofPublicInputs calldata proofInputs, // Proves user has sourceAmount
        bytes calldata defiCalldata // Encoded function call and parameters for the target DeFi protocol adaptor
    ) external;

    // --- View Functions ---
    function getPool(address asset) external view returns (address poolAddress);
    function getAssetPoolData(address asset) external view returns (address poolAddr, address verifierAddr, bool isPaused, uint32 treeDepth, bytes32 currentRoot);
    function getAdaptorData(address adaptor) external view returns (string memory name, address verifierAddr, bool isListed);
    function getNote(bytes32 noteHash) external view returns (address asset, uint256 value, bytes32 receiverHash, bool isClaimed, uint256 claimedTimestamp);
    function isNoteClaimed(bytes32 noteHash) external view returns (bool);
    function feeBps() external view returns (uint256);
    function feeRecipient() external view returns (address);
    function calculateFee(uint256 amount) external view returns (uint256);
}