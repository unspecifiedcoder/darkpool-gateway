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
    withdraw_value:  Field,
    merkle_root:  Field,
    leaf_index:  Field,
    existingNullifier:  Field,
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
    let merkle_root: Field = 0x1b4edc0be37c9c22f4715eaa596edb44c8e86963431782bcc80528060c003b4e;
    let leaf_index: Field = 5;
    let existingNullifier: Field = 5;
    let label: Field = 0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97;
    let existingValue: Field = 1000000000000000000;
    let existingSecret: Field = 10;
    let newNullifier: Field = 601;
    let newSecret: Field = 602;
    let siblings: [Field; 8] = [
        0x1a31b1eeace611ea90ace4c863d9f6109fad1b373c3ce88d18139c98bfbeb42d,
        0x100b5961ef1a90bc3de703624dfd9157f13addae0bf8569925ca6475d6bfce68,
        0x08762db86e93b866046fa7567a895a089a3039a0a72b76acc098654c6d62549c,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
        0x0000000000000000000000000000000000000000000000000000000000000000,
    ];
    let _newCommitment = low_depth_main(withdraw_value, merkle_root, leaf_index, existingNullifier, label, existingValue, existingSecret, newNullifier, newSecret, siblings);

    assert(_newCommitment == 0x18f645bc8ba261608f92afad5da74e3da73de2200e058a62439690b78157bd05);
}
