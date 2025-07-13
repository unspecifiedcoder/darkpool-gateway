// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ProofLib} from "../libraries/ProofLib.sol";
import {Field} from "../libraries/Poseidon/Field.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {IAssetPool} from "../interfaces/IAssetPool.sol";
import {MerkleTreeLib} from "../libraries/MerkleTreeLib.sol";
import {Poseidon2} from "../libraries/Poseidon/Poseidon2.sol";
import {Poseidon2Lib} from "../libraries/Poseidon/Poseidon2Lib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenPool is IAssetPool {
    using SafeERC20 for IERC20;
    using ProofLib for ProofLib.WithdrawOrTransferParams;
    using ProofLib for ProofLib.ClaimParams;
    using MerkleTreeLib for MerkleTreeLib.Tree;

    using Poseidon2Lib for *;
    using Field for *;

    uint32 internal constant MAX_TREE_DEPTH = 32; // Default, can be configured
    uint32 internal constant ROOT_HISTORY_SIZE = 100;
    address public immutable entryPoint;

    uint32 public currentRootIndex;
    uint256 public noteNonce;
    IERC20 public immutable asset;

    IVerifier public claimVerifier;
    IVerifier public withdrawVerifier;
    MerkleTreeLib.Tree internal tree;

    mapping(bytes32 => bool) public isNullifierSpent;
    mapping(uint256 _index => bytes32 _root) public roots;
    mapping(bytes32 _noteID => Note _note) public notes;

    event WithdrawalApproved(address indexed spender, uint256 amount);

    struct Note {
        uint256 value;
        bytes32 receiverHash;
        uint256 claimedBlockNumber;
    }


    modifier onlyEntryPoint() {
        require(
            msg.sender == entryPoint,
            "AssetPool: Caller is not the EntryPoint"
        );
        _;
    }

    modifier validate_withdraw_proof(
        ProofLib.WithdrawOrTransferParams memory params
    ) {
        require(
            params.publicInputs.length == 4,
            "AssetPool: Invalid withdraw proof"
        );
        require(
            withdrawVerifier.verify(params.honkProof, params.publicInputs),
            "AssetPool: Invalid withdraw proof"
        );
        _;
    }

    modifier validate_claim_proof(ProofLib.ClaimParams memory params) {
        require(
            params.publicInputs.length == 6,
            "AssetPool: Invalid claim proof"
        );
        require(
            claimVerifier.verify(params.honkProof, params.publicInputs),
            "AssetPool: Invalid claim proof"
        );
        _;
    }

    constructor(
        address _entryPoint,
        address _asset,
        address _withdraw_transfer_verifier,
        address _claim_verifier,
        uint32 _treeDepth
    ) {
        entryPoint = _entryPoint;
        asset = IERC20(_asset);
        claimVerifier = IVerifier(_claim_verifier);
        withdrawVerifier = IVerifier(_withdraw_transfer_verifier);
        tree.initialize(_treeDepth);
    }

    function deposit(
        uint256 amount,
        bytes32 precommitment
    ) external payable returns (uint32 leafIndex) {
        require(amount > 0, "AssetPool: Invalid amount");
        require(precommitment != bytes32(0), "AssetPool: Invalid precommitment");
        
        bytes32 commitment = _hash_commitment(
            amount,
            address(asset),
            precommitment
        );
        leafIndex = tree.insert(commitment);
        save_root(tree.currentRoot);
        emit CommitmentInserted(commitment, leafIndex, tree.currentRoot);
        asset.safeTransferFrom(msg.sender, address(this), amount);

        return leafIndex;
    }

    function withdraw(
        address receiver,
        ProofLib.WithdrawOrTransferParams memory params
    ) external validate_withdraw_proof(params)  returns (uint32 leafIndex) {
        // validate merkle tree root exists
        require(
            isKnownRoot(params.merkle_root()),
            "AssetPool: Invalid merkle root"
        );
        // check if nullifier is spent or else spend it
        check_and_spend_nullifier(params.nullifier());
        // update tree with new commitment
        leafIndex = tree.insert(params.new_commitment());
        save_root(tree.currentRoot);
        emit CommitmentInserted(
            params.new_commitment(),
            leafIndex,
            tree.currentRoot
        );

        // transfer asset to user
        asset.safeTransfer(receiver, params.value());
        return (0);
    }

    function transfer(
        ProofLib.WithdrawOrTransferParams memory params,
        bytes32 receiverHash
    ) external validate_withdraw_proof(params)  returns (uint32 leafIndex) {
        // validate merkle tree root exists
        require(
            isKnownRoot(params.merkle_root()),
            "AssetPool: Invalid merkle root"
        );
        // check if nullifier is spent or else spend it
        check_and_spend_nullifier(params.nullifier());
        // update tree with new commitment
        leafIndex = tree.insert(params.new_commitment());
        save_root(tree.currentRoot);
        emit CommitmentInserted(
            params.new_commitment(),
            leafIndex,
            tree.currentRoot
        );

        // Issue a new note! this action represents transfer within darkpool

        // compute noteNonce with keccak(asset + Nonce)
        bytes32 noteID = keccak256(abi.encodePacked(address(asset), noteNonce));

        // add new note to notes mapping
        notes[noteID] = Note({
            value: params.value(),
            receiverHash: receiverHash,
            claimedBlockNumber: 0
        });
        emit NoteCreated(receiverHash, params.value(), noteNonce);

        // increment noteNonce
        noteNonce++;
        return (0);
    }

    function claim(
        ProofLib.ClaimParams memory params
    ) external validate_claim_proof(params)  returns (uint32 leafIndex) {
        // compute NoteID
        bytes32 noteID = keccak256(
            abi.encodePacked(address(asset), params.note_nonce())
        );
        // check if Note is not already claimed
        require(
            notes[noteID].claimedBlockNumber == 0,
            "AssetPool: Note already claimed"
        );
        // if has prev commitments then check merkle tree spend nullifier and update tree with new commitment
        if (params.has_prev_commitments()) {
            require(
                isKnownRoot(params.merkle_root()),
                "AssetPool: Invalid merkle root"
            );
            check_and_spend_nullifier(params.existingNullifier());
            leafIndex = tree.insert(params.new_commitment());
            save_root(tree.currentRoot);
            emit CommitmentInserted(
                params.new_commitment(),
                leafIndex,
                tree.currentRoot
            );
        }
        // else create new commitment and update tree
        else {
            leafIndex = tree.insert(params.new_commitment());
            save_root(tree.currentRoot);
            emit CommitmentInserted(
                params.new_commitment(),
                leafIndex,
                tree.currentRoot
            );
        }

        emit NoteClaimed(noteID, params.value());
    }


    /**
     * @notice Allows a user to prove ownership of funds and approve a third-party contract
     * (like the PrivacyProxy) to spend them. This is a crucial step for moving
     * funds from the dark pool to the perp DEX.
     * @param params The ZK proof and public inputs proving ownership of a commitment.
     * @return leafIndex The index of the new commitment for the user's remaining balance.
     */
    function approveWithdrawal(
        ProofLib.WithdrawOrTransferParams memory params
    ) external validate_withdraw_proof(params) returns (uint32 leafIndex) {
        require(isKnownRoot(params.merkle_root()), "AssetPool: Invalid merkle root");
        check_and_spend_nullifier(params.nullifier());

        leafIndex = tree.insert(params.new_commitment());
        save_root(tree.currentRoot);
        emit CommitmentInserted(params.new_commitment(), leafIndex, tree.currentRoot);

        // Instead of transferring, we approve the msg.sender (the PrivacyProxy)
        // to pull the funds.
        asset.approve(msg.sender, params.value());
        
        // We can emit a specific event for this action
        emit WithdrawalApproved(msg.sender, params.value());
        return leafIndex;
    }

    /**
     * @notice Allows a trusted contract (the PrivacyProxy) to deposit funds on behalf of a user,
     * creating a new private note for them. This is used when a user withdraws collateral
     * from the perp DEX back into the privacy of the dark pool.
     * @param receiverHash The hash identifying the ultimate recipient of the note.
     * @param amount The amount of tokens to deposit and create a note for.
     */
    function depositFor(bytes32 receiverHash, uint256 amount) external {
        // For simplicity, we can restrict this to only be callable by a trusted proxy
        // if needed, or leave it public if the proxy model is the primary interaction.
        require(amount > 0, "AssetPool: Invalid amount");

        // The proxy must have approved the TokenPool to spend its tokens,
        // so we pull them into this contract.
        asset.safeTransferFrom(msg.sender, address(this), amount);

        // Issue a new note, same logic as the transfer function
        bytes32 noteID = keccak256(abi.encodePacked(address(asset), noteNonce));
        notes[noteID] = Note({
            value: amount,
            receiverHash: receiverHash,
            claimedBlockNumber: 0
        });
        emit NoteCreated(receiverHash, amount, noteNonce);
        noteNonce++;
    }

    function setWithdrawTransferVerifier(
        address newVerifier
    ) external onlyEntryPoint {
        withdrawVerifier = IVerifier(newVerifier);
    }
    function setClaimVerifier(address newVerifier) external onlyEntryPoint {
        claimVerifier = IVerifier(newVerifier);
    }

    // --- Internal Functions --- //
    function _hash_commitment(
        uint256 _value,
        address _asset,
        bytes32 _precommitment
    ) internal pure returns (bytes32) {
        return
            bytes32(
                Field.Type.unwrap(
                    Poseidon2.hash_3(
                        _value.toField(),
                        _asset.toField(),
                        _precommitment.toField()
                    )
                )
            );
    }

    function isKnownRoot(bytes32 _root) internal view returns (bool) {
        if (_root == bytes32(0)) return false;

        uint32 _index = currentRootIndex;
        for (uint32 _i = 0; _i < ROOT_HISTORY_SIZE; _i++) {
            if (_root == roots[_index]) return true;
            _index = (_index + ROOT_HISTORY_SIZE - 1) % ROOT_HISTORY_SIZE;
        }
        return false;
    }

    function save_root(bytes32 _root) internal {
        uint32 nextIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[nextIndex] = _root;
        currentRootIndex = nextIndex;
    }

    function check_and_spend_nullifier(bytes32 _nullifier) internal {
        require(
            !isNullifierSpent[_nullifier],
            "AssetPool: Nullifier already spent"
        );
        isNullifierSpent[_nullifier] = true;
    }

    // --- View Functions --- //
    function withdraw_transfer_verifier() external view returns (address) {
        return address(withdrawVerifier);
    }
    function claim_verifier() external view returns (address) {
        return address(claimVerifier);
    }
    function currentRoot() external view returns (bytes32) {
        return tree.currentRoot;
    }
    function nextLeafIndex() external view returns (uint32) {
        return uint32(tree.tree[0].length);
    }

    function TREE_DEPTH() external view returns (uint32) {
        return tree.depth;
    }
    function getLeaf(uint32 leafIndex) external view returns (bytes32) {
        return tree.tree[0][leafIndex];
    }
    function getPath(
        uint32 leafIndex
    ) external view returns (bytes32[] memory siblings) {
        return tree.getSiblings(leafIndex);
    }
}


// TODO:
// - claim many
// - Join, split
// - Join and withdraw
// - darkpool features explained
// - user UI components with respect to darkpool
// - user private trade lifecycle
// - offchain service for commitments and user nonces
// - Final thoughts