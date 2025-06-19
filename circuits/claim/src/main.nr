global MAX_TREE_DEPTH: u32 = 32;

use helpers::{commitment::commitment_hasher, LeanIMTInclusionProof::lean_imt_inclusion_proof};
use poseidon;

// Claims funds from one of existing notes, note_nonce is used to prevent replay attacks
// if existing nullifiers and secrets are null then we can assume user is new to system and we can create a new commitment.
// if existing nullifiers and secrets are not null then we topup/update balance of user accordingly
fn main(
    // Public inputs
    claim_value: pub Field,
    _note_nonce: pub Field,
    receiver_secretHash: pub Field,
    // could be null
    merkle_root: pub Option<Field>,
    leaf_index: pub Option<Field>,
    existingNullifier: pub Option<Field>,
    // Private inputs
    label: Field,
    receiver_secret: Field,
    newNullifier: Field,
    newSecret: Field,
    // could be null
    existingValue: Option<Field>,
    existingSecret: Option<Field>,
    siblings: Option<[Field; MAX_TREE_DEPTH]>,
) -> pub Field {
    assert(receiver_secretHash == poseidon::poseidon2::Poseidon2::hash([receiver_secret], 1));

    let mut final_balance = claim_value;
    if (existingNullifier.is_some() | (existingNullifier.expect(f"existingNullifier is none") != 0))
         {
            let existingCommitment = commitment_hasher(
                existingNullifier.expect(f"existingNullifier is none"),
                existingValue.expect(f"existingValue is none"),
                label,
                existingSecret.expect(f"existingSecret is none"),
            );
            let computed_merkle_root = lean_imt_inclusion_proof(
                existingCommitment,
                leaf_index.expect(f"leaf_index is none"),
                siblings.expect(f"siblings is none"),
            );

            assert_eq(computed_merkle_root, merkle_root.expect(f"merkle_root is none"));

            final_balance += existingValue.expect(f"existingValue is none");
        }

        let newCommitment = commitment_hasher(newNullifier, final_balance, label, newSecret);

        newCommitment
    }

fn low_depth_main(
    // Public inputs
    claim_value: Field,
    _note_nonce: Field,
    receiver_secretHash: Field,
    // could be null
    merkle_root: Option<Field>,
    leaf_index: Option<Field>,
    existingNullifier: Option<Field>,
    // Private inputs
    label: Field,
    receiver_secret: Field,
    newNullifier: Field,
    newSecret: Field,
    // could be null
    existingValue: Option<Field>,
    existingSecret: Option<Field>,
    siblings: Option<[Field; 8]>,
) -> Field {
    assert(receiver_secretHash == poseidon::poseidon2::Poseidon2::hash([receiver_secret], 1));

    let mut final_balance = claim_value;
    if existingNullifier.is_some() {
        let existingCommitment = commitment_hasher(
            existingNullifier.expect(f"existingNullifier is none"),
            existingValue.expect(f"existingValue is none"),
            label,
            existingSecret.expect(f"existingSecret is none"),
        );
        let computed_merkle_root = lean_imt_inclusion_proof(
            existingCommitment,
            leaf_index.expect(f"leaf_index is none"),
            siblings.expect(f"siblings is none"),
        );

        assert_eq(computed_merkle_root, merkle_root.expect(f"merkle_root is none"));

        final_balance += existingValue.expect(f"existingValue is none");
    }

    let newCommitment = commitment_hasher(newNullifier, final_balance, label, newSecret);

    newCommitment
}

#[test]
fn test_main() {
    let claim_value = 500000000000000000;
    let note_nonce = 12345;
    let receiver_secretHash = 0x29d532dfd7450897f3a457becb789ab8aaa85aa057c39805a609471519b68a16;
    let merkle_root = 0x29da4e4ec147bbf7985be365959ba23ed1183d97bfe8c72a67867c7b76d6a20f;
    let leaf_index = 5;
    let existingNullifier = 5;
    let label = 0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97;
    let receiver_secret = 66666;
    let newNullifier = 601;
    let newSecret = 602;
    let existingValue = 1000000000000000000;
    let existingSecret = 10;
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

    let main_result = low_depth_main(
        claim_value,
        note_nonce,
        receiver_secretHash,
        Option::some(merkle_root),
        Option::some(leaf_index),
        Option::some(existingNullifier),
        label,
        receiver_secret,
        newNullifier,
        newSecret,
        Option::some(existingValue),
        Option::some(existingSecret),
        Option::some(siblings),
    );

    assert(main_result == 0x29159b8cb187abd88dbc88851d73b10f8e898dd814d164b3da914959a018bb96);
}
