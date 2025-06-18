// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Governable} from "../utils/Governable.sol";
import {Pausable} from "../utils/Pausable.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import {IAssetPool} from "../interfaces/IAssetPool.sol";
import {AssetPool} from "./AssetPool.sol"; // For deploying new pools
import {IDefiAdaptor} from "../adaptors/IDefiAdaptor.sol";
import {IVerifier} from "../interfaces/IVerifier.sol"; // Generic, replace with actual

// Asset types from AssetPool (could be defined in a shared constants file)
uint8 internal constant ASSET_TYPE_ETH_EP = 0;
uint8 internal constant ASSET_TYPE_ERC20_EP = 1;

/**
 * @title EntryPoint
 * @dev Main entry point for the Xythum Darkpool protocol.
 * Manages asset pools, DeFi adaptors, and processes user actions involving ZK proofs.
 */
contract EntryPoint is IEntryPoint, Governable, Pausable {
    using SafeERC20 for IERC20Minimal;

    // --- State Variables ---

    // Mapping from asset address (address(0) for ETH) to its AssetPool contract address
    mapping(address => address) public assetPools;

    struct AssetPoolData {
        IAssetPool pool;
        IVerifier verifier; // Verifier for this pool's native actions (withdraw/transfer proofs)
        bool isPaused; // Specific to the pool, not global pause
        uint32 treeDepth;
        // currentRoot is fetched from the pool directly
    }
    mapping(address => AssetPoolData) internal assetPoolData;

    struct DefiAdaptorData {
        string name;
        IDefiAdaptor adaptor;
        IVerifier verifier; // Verifier for proofs required by this adaptor (e.g., proof of funds)
        bool isListed;
    }
    mapping(address => DefiAdaptorData) public defiAdaptorData;

    // Stores intermediate notes for private transfers and DeFi outputs
    // noteHash => Note details
    struct Note {
        address asset;          // Asset of the note
        uint256 value;          // Value of the note
        bytes32 receiverHash;   // Hash identifying the intended receiver (e.g., H(bob_public_key, blinding_factor))
        bool isClaimed;
        uint256 claimedTimestamp;
        // noteNonce is part of the noteHash to ensure uniqueness
    }
    mapping(bytes32 => Note) public override notes;

    uint256 public override feeBps; // Fee basis points (e.g., 25 for 0.25%)
    address public override feeRecipient;

    // Verifier contracts for specific actions (claim, withdraw/transfer)
    // These are set by governance and used to validate proofs.
    // AssetPools will also have their own verifier instances passed during creation,
    // which might be one of these global verifiers or a specific one.
    IVerifier public claimVerifier;
    IVerifier public withdrawTransferVerifier;
    // Potentially more verifiers for different proof types or versions

    // --- Constructor ---
    constructor(
        address _initialOwner,
        address _claimVerifier,
        address _withdrawTransferVerifier,
        uint256 _initialFeeBps,
        address _initialFeeRecipient
    ) {
        _transferOwnership(_initialOwner); // Transfer ownership from deployer
        require(_claimVerifier != address(0) && _withdrawTransferVerifier != address(0), "EntryPoint: Invalid verifiers");
        require(_initialFeeRecipient != address(0), "EntryPoint: Invalid fee recipient");

        claimVerifier = IVerifier(_claimVerifier);
        withdrawTransferVerifier = IVerifier(_withdrawTransferVerifier);
        feeBps = _initialFeeBps;
        feeRecipient = _initialFeeRecipient;
    }

    // --- Governance Functions ---

    /**
     * @inheritdoc IEntryPoint
     * @dev Deploys and registers a new AssetPool contract for a given asset.
     * Uses CREATE2 for deterministic pool addresses if salt is predictable.
     * For simplicity here, uses standard `new`.
     */
    function createPool(
        address asset, // address(0) for ETH
        uint8 assetType,
        address verifierAddress, // Verifier for this pool's actions (e.g., withdraw/transfer)
        bytes32 initialPedersenRoot, // Root of an empty tree for this pool
        uint32 treeDepth
    ) external override onlyOwner whenNotPaused {
        require(assetPools[asset] == address(0), "EntryPoint: Pool already exists for this asset");
        require(verifierAddress != address(0), "EntryPoint: Invalid verifier for pool");
        if (assetType == ASSET_TYPE_ERC20_EP) {
            require(asset != address(0), "EntryPoint: Invalid ERC20 asset address");
        } else if (assetType == ASSET_TYPE_ETH_EP) {
            require(asset == address(0), "EntryPoint: ETH asset must be address(0)");
        } else {
            revert("EntryPoint: Invalid asset type");
        }

        // Deploy AssetPool (constructor needs asset, assetType for immutables)
        // AssetPool newPool = new AssetPool(address(this), asset, assetType);
        // newPool.initialize(verifierAddress, initialPedersenRoot, treeDepth);
        // This deployment pattern needs AssetPool constructor to take asset, assetType.
        // And `initialize` to take the rest.
        // Let's assume AssetPool constructor is:
        // AssetPool(address _entryPoint, address _asset, uint8 _assetType)
        // And initialize is:
        // initialize(address _verifierAddress, bytes32 _initialPedersenRoot, uint32 _treeDepth)
        // This is a common pattern.

        AssetPool newPoolInstance = new AssetPool(address(this), asset, assetType);
        newPoolInstance.initialize(verifierAddress, initialPedersenRoot, treeDepth);

        address poolAddress = address(newPoolInstance);
        assetPools[asset] = poolAddress;
        assetPoolData[asset] = AssetPoolData({
            pool: IAssetPool(poolAddress),
            verifier: IVerifier(verifierAddress),
            isPaused: false,
            treeDepth: treeDepth
        });

        emit PoolCreated(asset, poolAddress, assetType, verifierAddress);
    }

    function pausePool(address asset) external override onlyOwner {
        require(assetPools[asset] != address(0), "EntryPoint: Pool does not exist");
        assetPoolData[asset].isPaused = true;
        emit PoolPaused(asset);
    }

    function resumePool(address asset) external override onlyOwner {
        require(assetPools[asset] != address(0), "EntryPoint: Pool does not exist");
        assetPoolData[asset].isPaused = false;
        emit PoolResumed(asset);
    }

    function listDefiAdaptor(address adaptorAddress, string calldata adaptorName, address verifierAddress) external override onlyOwner {
        require(adaptorAddress != address(0), "EntryPoint: Invalid adaptor address");
        require(verifierAddress != address(0), "EntryPoint: Invalid verifier for adaptor");
        require(!defiAdaptorData[adaptorAddress].isListed, "EntryPoint: Adaptor already listed");

        defiAdaptorData[adaptorAddress] = DefiAdaptorData({
            name: adaptorName,
            adaptor: IDefiAdaptor(adaptorAddress),
            verifier: IVerifier(verifierAddress),
            isListed: true
        });
        emit DefiAdaptorListed(adaptorAddress, adaptorName);
    }

    function unlistDefiAdaptor(address adaptorAddress) external override onlyOwner {
        require(defiAdaptorData[adaptorAddress].isListed, "EntryPoint: Adaptor not listed or does not exist");
        defiAdaptorData[adaptorAddress].isListed = false; // Soft unlist, data remains for history
        // delete defiAdaptorData[adaptorAddress]; // Or hard delete
        emit DefiAdaptorUnlisted(adaptorAddress);
    }

    function setPoolVerifier(address asset, address newVerifierAddress) external override onlyOwner {
        require(assetPools[asset] != address(0), "EntryPoint: Pool does not exist");
        require(newVerifierAddress != address(0), "EntryPoint: Invalid new verifier");
        assetPoolData[asset].verifier = IVerifier(newVerifierAddress);
        assetPoolData[asset].pool.setVerifier(newVerifierAddress); // Also tell the pool
        emit PoolVerifierChanged(asset, newVerifierAddress);
    }

    function setAdaptorVerifier(address adaptorAddress, address newVerifierAddress) external override onlyOwner {
         require(defiAdaptorData[adaptorAddress].isListed, "EntryPoint: Adaptor not listed or does not exist");
         require(newVerifierAddress != address(0), "EntryPoint: Invalid new verifier for adaptor");
         defiAdaptorData[adaptorAddress].verifier = IVerifier(newVerifierAddress);
         // Adaptors might need their own setVerifier if they store it, or they use this EntryPoint's stored verifier.
    }

    function setGlobalVerifiers(address _claimVerifier, address _withdrawTransferVerifier) external onlyOwner {
        require(_claimVerifier != address(0) && _withdrawTransferVerifier != address(0), "EntryPoint: Invalid global verifiers");
        claimVerifier = IVerifier(_claimVerifier);
        withdrawTransferVerifier = IVerifier(_withdrawTransferVerifier);
    }

    function setFeeParameters(uint256 newFeeBps, address newFeeRecipient) external override onlyOwner {
        require(newFeeRecipient != address(0), "EntryPoint: Invalid new fee recipient");
        // Add upper bound check for feeBps if necessary (e.g., <= 1000 for 10%)
        feeBps = newFeeBps;
        feeRecipient = newFeeRecipient;
    }

    function withdrawFees(address token, address recipient, uint256 amount) external override onlyOwner {
        require(recipient != address(0), "EntryPoint: Invalid recipient");
        if (token == address(0)) { // ETH fees
            payable(recipient).transfer(amount);
        } else { // ERC20 fees
            IERC20Minimal(token).safeTransfer(recipient, amount);
        }
        emit FeesWithdrawn(token, recipient, amount);
    }

    // --- User Actions ---

    function deposit(
        address asset,
        uint256 amount,
        bytes32 commitmentLeaf // User's new commitment (Pedersen hash)
    ) external payable override whenNotPaused {
        AssetPoolData storage poolData = assetPoolData[asset];
        require(poolAddress != address(0), "EntryPoint: Pool does not exist for this asset");
        require(!poolData.isPaused, "EntryPoint: Asset pool is paused");
        require(amount > 0, "EntryPoint: Deposit amount must be positive");

        IAssetPool pool = poolData.pool;
        uint256 fee = calculateFee(amount);
        uint256 amountAfterFee = amount - fee;
        require(amountAfterFee > 0, "EntryPoint: Amount too small after fee");

        // Transfer assets (EntryPoint receives from user, then sends to pool or collects fee)
        if (poolData.pool.assetType() == ASSET_TYPE_ETH_EP) {
            require(msg.value == amount, "EntryPoint: Incorrect ETH sent");
            if (fee > 0) payable(feeRecipient).transfer(fee);
            // AssetPool's deposit is payable
            (bytes32 poolCurrentRoot, uint32 leafIndex) = pool.deposit{value: amountAfterFee}(msg.sender, amountAfterFee, commitmentLeaf);
             emit Deposited(asset, msg.sender, amountAfterFee, commitmentLeaf, leafIndex, poolCurrentRoot /* root before this deposit*/);
        } else { // ERC20
            require(msg.value == 0, "EntryPoint: ETH sent for ERC20 deposit");
            IERC20Minimal token = IERC20Minimal(asset);
            token.safeTransferFrom(msg.sender, address(this), amount);
            if (fee > 0) token.safeApprove(feeRecipient, fee); // Should be transfer not approve
            if (fee > 0) token.safeTransfer(feeRecipient, fee);
            token.safeApprove(address(pool), amountAfterFee); // Approve pool to pull
            token.safeTransfer(address(pool), amountAfterFee); // Or transfer directly to pool
            // AssetPool's deposit function will then handle it (or this EntryPoint transfers to it)
            // If EntryPoint transfers to pool, then pool's deposit is not payable for ERC20.
            // Let's assume pool's deposit takes responsibility for pulling from EntryPoint or user.
            // For now, EntryPoint transfers to Pool:
            // IERC20Minimal(asset).safeTransfer(address(pool), amountAfterFee);
            // (bytes32 poolCurrentRoot, uint32 leafIndex) = pool.deposit(msg.sender, amountAfterFee, commitmentLeaf);
            // This deposit to pool needs to be non-payable for ERC20.
            // Let's adjust AssetPool's deposit to handle this.
            // For now, keeping it simple: EntryPoint gets funds, sends to pool.

            // Simpler: pool.deposit expects funds to be there or pulls them.
            // If EntryPoint holds funds temporarily:
            IERC20Minimal(pool.asset()).safeApprove(address(pool), amountAfterFee); // Approve pool to take from EntryPoint
             (bytes32 poolCurrentRoot, uint32 leafIndex) = pool.deposit(address(this), amountAfterFee, commitmentLeaf); // Pool pulls from EntryPoint
            emit Deposited(asset, msg.sender, amountAfterFee, commitmentLeaf, leafIndex, poolCurrentRoot);
        }
    }


    function transfer(
        address asset,
        bytes calldata proof,
        WithdrawOrTransferProofPublicInputs calldata proofInputs,
        bytes32 receiverNoteSecretHash, // For the new intermediate note
        uint256 noteNonce // For the new intermediate note
    ) external override whenNotPaused {
        AssetPoolData storage poolData = assetPoolData[asset];
        IAssetPool pool = poolData.pool;
        require(address(pool) != address(0), "EntryPoint: Pool does not exist");
        require(!poolData.isPaused, "EntryPoint: Asset pool is paused");

        // Verify proof against the pool's designated withdraw/transfer verifier
        // The proofInputs.merkleRoot must match pool.currentRoot()
        require(proofInputs.merkleRoot == pool.currentRoot(), "EntryPoint: Stale Merkle root for transfer proof");
        // Using global withdrawTransferVerifier, or could be poolData.verifier
        bool isValid = withdrawTransferVerifier.verifyProof(proof, _encodeWithdrawOrTransferInputs(proofInputs));
        require(isValid, "EntryPoint: Invalid ZK proof for transfer");

        // The ZK proof ensures value conservation.
        // proofInputs.newCommitment is the sender's change commitment.
        // proofInputs.withdrawValue is the amount for the transfer note.

        // Calculate the new Pedersen root that results from this operation
        // This is complex: the ZK circuit *itself* should implicitly or explicitly
        // validate the new root if proofInputs.newCommitment (change) is inserted.
        // For now, let's assume the new root is correctly implied by the proof.
        // The AssetPool needs to be told this new root.
        bytes32 newRootAfterSpend; // This needs to come from the ZK proof's implications or be calculated.
                               // For now, placeholder. The ZK team needs to confirm how new root is derived/passed.
                               // Ideally, ZK proof output contains new root.
        uint32 changeLeafIndex;

        // Update AssetPool state (spend nullifier, insert change commitment)
        // AssetPool's spendAndInsert needs the newValidatedRoot
        // (newRootAfterSpend, changeLeafIndex) = pool.spendAndInsert(
        //     proofInputs.merkleRoot,
        //     proofInputs.newCommitment, // Sender's change commitment
        //     proofInputs.existingNullifier,
        //     0, // No value transferred out of pool directly for internal transfer
        //     address(0) // No direct recipient for the pool's assets
        //     // newValidatedRoot needs to be passed here
        // );
        // The above call is problematic if `valueToTransact` is 0, as it's for external movement.
        // We need a way for AssetPool to just update nullifier, insert commitment, and update root.
        // Let's refine AssetPool's interface:
        // Option: IAssetPool.processInternalSpend(oldRoot, nullifier, newCommitment, newValidatedRoot)
        // For now, using _updateRoot and individual calls:
        pool.spendNullifier(proofInputs.existingNullifier); // New function needed in IAssetPool/AssetPool
        if (proofInputs.newCommitment != bytes32(0)) {
            changeLeafIndex = pool.insertCommitmentOnly(proofInputs.newCommitment); // New function
        }
        // pool._updateRoot(newRootAfterSpend); // Internal update by AssetPool

        // Create the intermediate transfer note
        bytes32 noteHash = keccak256(abi.encodePacked(asset, proofInputs.withdrawValue, receiverNoteSecretHash, noteNonce));
        require(notes[noteHash].value == 0, "EntryPoint: Note already exists (nonce reuse?)"); // Prevent replay

        notes[noteHash] = Note({
            asset: asset,
            value: proofInputs.withdrawValue,
            receiverHash: receiverNoteSecretHash,
            isClaimed: false,
            claimedTimestamp: 0
        });

        emit Transferred(
            asset,
            proofInputs.existingNullifier,
            proofInputs.newCommitment, // Sender's change commitment leaf
            noteHash,
            proofInputs.withdrawValue, // Value in the note
            receiverNoteSecretHash // Using this as intendedReceiver hint
        );
    }

    function claim(
        address asset,
        bytes calldata proof,
        ClaimProofPublicInputs calldata proofInputs,
        uint256 originalNoteValue,
        bytes32 originalNoteReceiverHash,
        uint256 originalNoteNonce
    ) external override whenNotPaused {
        AssetPoolData storage poolData = assetPoolData[asset];
        IAssetPool pool = poolData.pool;
        require(address(pool) != address(0), "EntryPoint: Pool does not exist");
        require(!poolData.isPaused, "EntryPoint: Asset pool is paused");

        // Reconstruct and validate the note
        bytes32 noteHash = keccak256(abi.encodePacked(asset, originalNoteValue, originalNoteReceiverHash, originalNoteNonce));
        Note storage noteToClaim = notes[noteHash];
        require(noteToClaim.value > 0, "EntryPoint: Note does not exist");
        require(!noteToClaim.isClaimed, "EntryPoint: Note already claimed");
        require(noteToClaim.asset == asset, "EntryPoint: Note asset mismatch");
        require(noteToClaim.value == proofInputs.claimValue || noteToClaim.value == (proofInputs.claimValue - proofInputs.existingValueFromOldCommitmentIfExists), "EntryPoint: Note value mismatch with proof"); // Simplified, needs exact logic for top-up
        require(noteToClaim.receiverHash == originalNoteReceiverHash, "EntryPoint: Note receiver hash mismatch"); // proofInputs.receiverSecretHash is for the *new* commitment

        // Verify ZK proof for claiming the note and creating a new commitment in the pool
        // The proofInputs.merkleRoot for claim might be 0 if it's a new user, or current pool root if topping up.
        // The ZK circuit for `claim` needs to handle this.
        if (proofInputs.existingNullifier != 0) { // If topping up existing commitment
            require(proofInputs.merkleRoot == pool.currentRoot(), "EntryPoint: Stale Merkle root for claim top-up proof");
        }
        // Using global claimVerifier, or could be poolData.verifier if claim proofs are pool-specific
        bool isValid = claimVerifier.verifyProof(proof, _encodeClaimInputs(proofInputs));
        require(isValid, "EntryPoint: Invalid ZK proof for claim");

        // Mark note as claimed
        noteToClaim.isClaimed = true;
        noteToClaim.claimedTimestamp = block.timestamp;

        // The ZK proof output `proofInputs.newCommitment` is the leaf to be inserted into the pool.
        // It also validated the new root if `existingNullifier` was involved.
        bytes32 newRootAfterClaim; // This new root must be derived/validated by the ZK proof system.
        uint32 newLeafIndex;

        // Update AssetPool: spend old nullifier (if top-up), insert new commitment, update root.
        // This needs a refined AssetPool function.
        // (newRootAfterClaim, newLeafIndex) = pool.insertCommitment(
        //     proofInputs.merkleRoot, // The root against which the claim proof (if any part involved pool state) was made
        //     proofInputs.newCommitment
        //     // newValidatedRoot needs to be passed here
        // );
        // If proofInputs.existingNullifier != 0, then that nullifier also needs to be spent in the pool.
        // AssetPool needs a function like:
        // claimUpdate(oldRoot, existingNullifierToSpend (if any), newCommitment, newValidatedRoot)
        if (proofInputs.existingNullifier != 0) {
            pool.spendNullifier(proofInputs.existingNullifier); // New func in AssetPool
        }
        newLeafIndex = pool.insertCommitmentOnly(proofInputs.newCommitment); // New func in AssetPool
        // pool._updateRoot(newRootAfterClaim); // Update with validated root

        // Nullify the intermediate note itself (conceptually, by marking it claimed)
        // The noteHash can act as a "nullifier" for the note system.

        emit Claimed(
            asset,
            noteHash,
            noteHash, // Using noteHash as its own nullifier in this event
            proofInputs.newCommitment,
            newLeafIndex,
            newRootAfterClaim
        );
    }


    function withdraw(
        address asset,
        bytes calldata proof,
        WithdrawOrTransferProofPublicInputs calldata proofInputs,
        address recipient
    ) external override whenNotPaused {
        require(recipient != address(0), "EntryPoint: Invalid recipient address");
        AssetPoolData storage poolData = assetPoolData[asset];
        IAssetPool pool = poolData.pool;
        require(address(pool) != address(0), "EntryPoint: Pool does not exist");
        require(!poolData.isPaused, "EntryPoint: Asset pool is paused");

        require(proofInputs.merkleRoot == pool.currentRoot(), "EntryPoint: Stale Merkle root for withdraw proof");
        bool isValid = withdrawTransferVerifier.verifyProof(proof, _encodeWithdrawOrTransferInputs(proofInputs));
        require(isValid, "EntryPoint: Invalid ZK proof for withdraw");

        // proofInputs.newCommitment is the user's change commitment.
        // proofInputs.withdrawValue is the amount to be withdrawn to L1.
        bytes32 newRootAfterWithdraw; // Must be derived/validated from ZK proof.
        uint32 changeLeafIndex;

        // Update AssetPool: spend nullifier, insert change commitment, transfer funds out, update root.
        (newRootAfterWithdraw, changeLeafIndex) = pool.spendAndInsert(
            proofInputs.merkleRoot,
            proofInputs.newCommitment, // User's change commitment
            proofInputs.existingNullifier,
            proofInputs.withdrawValue, // Amount to transfer to L1 recipient
            recipient
            // newValidatedRoot (newRootAfterWithdraw) needs to be passed here
        );
        // pool._updateRoot(newRootAfterWithdraw); // Ensure root is updated correctly

        emit Withdrawn(
            asset,
            proofInputs.existingNullifier,
            proofInputs.newCommitment,
            recipient,
            proofInputs.withdrawValue
        );
    }

    function executeDeFi(
        address sourceAsset,
        address adaptorAddress,
        bytes calldata proof,
        WithdrawOrTransferProofPublicInputs calldata proofInputs, // Proves user has sourceAmount in sourceAsset pool
        bytes calldata defiCalldata
    ) external override whenNotPaused {
        AssetPoolData storage sourcePoolData = assetPoolData[sourceAsset];
        IAssetPool sourcePool = sourcePoolData.pool;
        require(address(sourcePool) != address(0), "EntryPoint: Source pool does not exist");
        require(!sourcePoolData.isPaused, "EntryPoint: Source pool is paused");

        DefiAdaptorData storage adaptorInfo = defiAdaptorData[adaptorAddress];
        require(adaptorInfo.isListed, "EntryPoint: DeFi adaptor not listed or does not exist");
        IDefiAdaptor adaptor = adaptorInfo.adaptor;

        // Verify proof of funds in sourceAsset pool using the adaptor's or source pool's verifier
        require(proofInputs.merkleRoot == sourcePool.currentRoot(), "EntryPoint: Stale Merkle root for DeFi proof");
        // The verifier here should be appropriate for the `proofInputs` structure (WithdrawOrTransfer)
        bool isValid = adaptorInfo.verifier.verifyProof(proof, _encodeWithdrawOrTransferInputs(proofInputs)); // Or sourcePoolData.verifier
        require(isValid, "EntryPoint: Invalid ZK proof for DeFi execution");

        // `proofInputs.withdrawValue` is the amount to be used in the DeFi action.
        // `proofInputs.newCommitment` is the user's change in the sourceAsset pool.
        bytes32 newRootAfterSpendInSourcePool; // Must be derived/validated from ZK proof.
        uint32 changeLeafIndex;

        // 1. Update source AssetPool: spend nullifier, insert change commitment, transfer funds to adaptor
        (newRootAfterSpendInSourcePool, changeLeafIndex) = sourcePool.spendAndInsert(
            proofInputs.merkleRoot,
            proofInputs.newCommitment, // User's change commitment in source pool
            proofInputs.existingNullifier,
            proofInputs.withdrawValue, // Amount to transfer to the DeFi adaptor
            adaptorAddress // DeFi adaptor is the recipient from the source pool
            // newValidatedRoot (newRootAfterSpendInSourcePool) needs to be passed here
        );
        // sourcePool._updateRoot(newRootAfterSpendInSourcePool);

        emit DefiExecuted(
            sourceAsset,
            adaptorAddress,
            proofInputs.existingNullifier,
            proofInputs.newCommitment,
            proofInputs.withdrawValue
        );

        // 2. Call the DeFi adaptor to perform the interaction
        // The adaptor will receive `proofInputs.withdrawValue` of `sourceAsset`.
        // It performs the DeFi op and should return the output asset details and a new note commitment for the user.
        (address outputAsset, uint256 outputAmount, bytes32 newOutputNoteCommitment) = adaptor.execute(
            msg.sender, // Original user
            sourceAsset,
            proofInputs.withdrawValue,
            keccak256(abi.encodePacked(msg.sender, block.timestamp)), // Placeholder receiverSecretHash for the output note, user needs to derive this properly
            defiCalldata
        );

        // 3. Create a new intermediate note for the user for the output of the DeFi action
        // This output note needs to be claimed by the user via the `claim` function.
        // The `newOutputNoteCommitment` is what the user will use to generate their claim proof.
        // However, the `claim` function currently inserts `proofInputs.newCommitment` (from ClaimProofPublicInputs).
        // This `newOutputNoteCommitment` from the adaptor *is* the `proofInputs.newCommitment` for a subsequent claim.
        // The adaptor's `execute` function should provide the `receiverSecretHash` that was used to create this `newOutputNoteCommitment`.

        // For now, let's assume the adaptor interaction itself creates a commitment in an output pool if same protocol,
        // or this EntryPoint creates a claimable note.
        // If the adaptor returns a commitment to be inserted into a *Xythum pool*, it needs to specify which one.
        // The current `IDefiAdaptor.execute` returns `newNoteCommitment`. This should be the actual Pedersen leaf.
        // The user then claims this leaf into the target asset pool.

        // This part needs more thought: how does the user claim the DeFi output?
        // If the adaptor gives a `newOutputNoteCommitment`, the user needs to `claim` it.
        // The `claim` function takes `ClaimProofPublicInputs`.
        // The `newOutputNoteCommitment` from adaptor becomes `proofInputs.newCommitment` for the claim.
        // The `receiverSecretHash` used by adaptor for this output becomes `proofInputs.receiverSecretHash` for the claim.

        // For now, `executeDeFi` just logs the event. The user would then call `claim`
        // with a proof for `newOutputNoteCommitment` against the `outputAsset` pool.
        // This implies the adaptor must provide enough info for user to make that claim.
        // The event from `IDefiAdaptor.InteractionExecuted` should contain this.
    }


    // --- Helper functions to encode public inputs for verifiers ---
    // These must exactly match the order and type your Noir verifiers expect.
    // These are placeholders and need to be precise.

    function _encodeClaimInputs(ClaimProofPublicInputs memory inputs) internal pure returns (uint256[] memory) {
        uint256[] memory publicInputs = new uint256[](7); // Based on struct fields
        publicInputs[0] = inputs.claimValue;
        publicInputs[1] = inputs.noteNonce;
        publicInputs[2] = inputs.receiverSecretHash;
        publicInputs[3] = inputs.merkleRoot; // Option types in Noir are tricky. solidity doesn't have them.
                                           // Circuit must handle 0 as "None".
        publicInputs[4] = inputs.leafIndex;
        publicInputs[5] = inputs.existingNullifier;
        publicInputs[6] = inputs.newCommitment; // This is an output of the ZK circuit.
        return publicInputs;
    }

    function _encodeWithdrawOrTransferInputs(WithdrawOrTransferProofPublicInputs memory inputs) internal pure returns (uint256[] memory) {
        uint256[] memory publicInputs = new uint256[](5); // Based on struct fields
        publicInputs[0] = inputs.withdrawValue;
        publicInputs[1] = inputs.merkleRoot;
        publicInputs[2] = inputs.leafIndex;
        publicInputs[3] = inputs.existingNullifier;
        publicInputs[4] = inputs.newCommitment; // This is an output of the ZK circuit.
        return publicInputs;
    }


    // --- View Functions ---

    function getPool(address asset) external view override returns (address poolAddress) {
        return assetPools[asset];
    }

    function getAssetPoolData(address asset) external view override returns (address poolAddr, address verifierAddr, bool isPaused, uint32 treeDepthVal, bytes32 currentRootVal) {
        AssetPoolData storage data = assetPoolData[asset];
        poolAddr = address(data.pool);
        if (poolAddr == address(0)) return (address(0), address(0), false, 0, bytes32(0));
        verifierAddr = address(data.verifier);
        isPaused = data.isPaused;
        treeDepthVal = data.treeDepth; // Or data.pool.TREE_DEPTH()
        currentRootVal = data.pool.currentRoot();
    }

    function getAdaptorData(address adaptor) external view override returns (string memory name, address verifierAddr, bool isListedVal) {
        DefiAdaptorData storage data = defiAdaptorData[adaptor];
        // require(data.isListed, "EntryPoint: Adaptor not listed"); // or return empty
        if (!data.isListed && data.adaptor == IDefiAdaptor(address(0))) return ("", address(0), false);
        name = data.name;
        verifierAddr = address(data.verifier);
        isListedVal = data.isListed;
    }

    function isNoteClaimed(bytes32 noteHash) external view override returns (bool) {
        return notes[noteHash].isClaimed;
    }

    function calculateFee(uint256 amount) public view override returns (uint256) {
        if (feeBps == 0) return 0;
        return (amount * feeBps) / 10000;
    }

    // --- Pausable Overrides ---
    function pause() external onlyOwner { // Changed from _pause to be callable
        super._pause();
    }

    function unpause() external onlyOwner { // Changed from _unpause to be callable
        super._unpause();
    }

    // Fallback and receive for ETH deposits to pools
    receive() external payable {
        // Could be used for direct ETH deposits if EntryPoint is designed to forward,
        // but explicit deposit function is safer.
    }
}