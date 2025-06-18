global MAX_TREE_DEPTH: u32 = 32;

use helpers::{commitment::commitment_hasher, LeanIMTInclusionProof::lean_imt_inclusion_proof};

fn main(
    // Public inputs
    withdraw_value: pub Field,
    merkle_root: pub Field,
    leaf_index: pub Field,
    existingNullifier: pub Field,
    // Private inputs
    label: Field,
    existingValue: Field,
    existingSecret: Field,
    newNullifier: Field,
    newSecret: Field,
    siblings: [Field; MAX_TREE_DEPTH],
) -> pub Field {
    let existingCommitment =
        commitment_hasher(existingValue, label, existingNullifier, existingSecret);
    let computed_merkle_root = lean_imt_inclusion_proof(existingCommitment, leaf_index, siblings);

    assert_eq(computed_merkle_root, merkle_root);

    let newCommitment = commitment_hasher(
        newNullifier,
        existingValue - withdraw_value,
        label,
        newSecret,
    );
    newCommitment
}

fn low_depth_main(
    // Public inputs
    withdraw_value: Field,
    merkle_root: Field,
    leaf_index: Field,
    existingNullifier: Field,
    // Private inputs
    label: Field,
    existingValue: Field,
    existingSecret: Field,
    newNullifier: Field,
    newSecret: Field,
    siblings: [Field; 8],
) -> Field {
    let existingCommitment =
        commitment_hasher(existingNullifier, existingValue, label, existingSecret);
    let computed_merkle_root = lean_imt_inclusion_proof(existingCommitment, leaf_index, siblings);

    assert_eq(computed_merkle_root, merkle_root);

    let newCommitment = commitment_hasher(
        newNullifier,
        existingValue - withdraw_value,
        label,
        newSecret,
    );

    newCommitment
}

#[test]
pub fn test_main() {
    let withdraw_value: Field = (500000000000000000).into();
    let merkle_root: Field = 0x29da4e4ec147bbf7985be365959ba23ed1183d97bfe8c72a67867c7b76d6a20f;
    let leaf_index: Field = 5;
    let existingNullifier: Field = 5;
    let label: Field = 0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97;
    let existingValue: Field = 1000000000000000000;
    let existingSecret: Field = 10;
    let newNullifier: Field = 601;
    let newSecret: Field = 602;
    let siblings: [Field; 8] = [
        0x01a266bea8075ed4764fca5aa9b814960c483ccd158250bd39be32cf7601f85e,
        0x08d3fc1b356a70549258380c0a14fa88e867fae608de826c52e2dd4ac6925991,
        0x10f1429fb1ead8599a0983333927e3808984c2adbf461680fba56df177bd716b,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
    ];
    let _newCommitment = low_depth_main(
        withdraw_value,
        merkle_root,
        leaf_index,
        existingNullifier,
        label,
        existingValue,
        existingSecret,
        newNullifier,
        newSecret,
        siblings,
    );

    assert(_newCommitment == 0x21adcd4c0b79b79f4564706cce1f55dad4f3211aa1d4b533ada3f4b1edbd41d6);
}
