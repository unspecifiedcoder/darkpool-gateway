// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library ProofLib {
    struct WithdrawOrTransferParams {
        bytes honkProof;
        bytes32[] publicInputs; 
    }

    function value(
        WithdrawOrTransferParams memory params
    ) internal pure returns (uint256) {
        return uint256(params.publicInputs[0]);
    }

    function merkle_root(
        WithdrawOrTransferParams memory params
    ) internal pure returns (bytes32) {
        return params.publicInputs[1];
    }


    function nullifier(
        WithdrawOrTransferParams memory params
    ) internal pure returns (bytes32) {
        return params.publicInputs[2];
    }

    function new_commitment(
        WithdrawOrTransferParams memory params
    ) internal pure returns (bytes32) {
        return params.publicInputs[3];
    }

    struct ClaimParams {
        bytes honkProof;
        bytes32[] publicInputs; 
    }

    function has_prev_commitments(ClaimParams memory params) internal pure returns (bool) {
        return  params.publicInputs[4] != bytes32(0);
    }

    function value(ClaimParams memory params) internal pure returns (uint256) {
        return uint256(params.publicInputs[0]);
    }

    function note_nonce(
        ClaimParams memory params
    ) internal pure returns (uint256) {
        return uint256(params.publicInputs[1]);
    }

    function receiver_secretHash(
        ClaimParams memory params
    ) internal pure returns (bytes32) {
        return params.publicInputs[2];
    }

    function merkle_root(
        ClaimParams memory params
    ) internal pure returns (bytes32) {
        return params.publicInputs[3];
    }

    function existingNullifier(
        ClaimParams memory params
    ) internal pure returns (bytes32) {
        return params.publicInputs[4];
    }

    function new_commitment(
        ClaimParams memory params
    ) internal pure returns (bytes32) {
        return params.publicInputs[5];
    }
}
