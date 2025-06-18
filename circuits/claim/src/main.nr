global MAX_TREE_DEPTH: u32 = 32;

use helpers::{blake3Hasher::black3_hash_to_field, commitment::commitment_hasher, LeanIMTInclusionProof::lean_imt_inclusion_proof};


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
    assert(receiver_secretHash == black3_hash_to_field([receiver_secret]));

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
    assert(receiver_secretHash == black3_hash_to_field([receiver_secret]));

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
    let receiver_secretHash = 0x22de3cfbc27467b83450055a1e0ceed242b6c79af86e94f466f27406b93f1e09;
    let merkle_root = 0x1b4edc0be37c9c22f4715eaa596edb44c8e86963431782bcc80528060c003b4e;
    let leaf_index = 5;
    let existingNullifier = 5;
    let label = 0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97;
    let receiver_secret = 66666;
    let newNullifier = 601;
    let newSecret = 602;
    let existingValue = 1000000000000000000;
    let existingSecret = 10;
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

    assert(main_result == 0x12f4f2bc0e0936d688290ba5e506001f813315cff75617a035ba4cf32806b9fd);
}
