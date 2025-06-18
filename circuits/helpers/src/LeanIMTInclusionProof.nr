use super::blake3Hasher::black3_hash_to_field;

// fn print_debug_fields<let size: u32>(fields: [Field; size]) {
//     for field in fields {
//         println(field);
//     }
// }

/**
 * @title LeanIMTInclusionProof function (Noir equivalent)
 * @dev Function for verifying inclusion proofs in a Lean Incremental Merkle Tree using BLAKE3 hashes.
*/
pub fn lean_imt_inclusion_proof<let MAX_DEPTH: u32>(
    leaf: Field,
    leaf_index: Field, // The index of the leaf.
    siblings: [Field; MAX_DEPTH],
) -> Field {
    let path_bits_bool: [u1; MAX_DEPTH] = leaf_index.to_le_bits();

    // println("path_bits_bool");
    // println(path_bits_bool);

    // `nodes` array to store computed node values at each level
    // Size is MAX_DEPTH + 1 to store the initial leaf and results of MAX_DEPTH hashing/propagation steps.
    let mut nodes: [Field; MAX_DEPTH + 1] = [0 as Field; MAX_DEPTH + 1];

    // Initialize with the leaf value
    nodes[0] = leaf;

    // For each level up to MAX_DEPTH
    for i in 0..MAX_DEPTH {
        let current_node = nodes[i];
        let sibling_node = siblings[i];

        // `path_bits_field[i]` determines if `current_node` is a left (0) or right (1) child.
        let path_direction_bit = path_bits_bool[i]; // 0 if current_node is left, 1 if current_node is right

        // LeanIMT feature: if sibling_node is empty (0), propagate current_node.
        // Otherwise, use the hash.
        // `is_sibling_empty_selector` will be 1 if sibling_node is 0, and 0 otherwise.
        let is_sibling_empty_selector = if sibling_node == 0 {
            1 as Field
        } else {
            0 as Field
        };

        // If sibling is empty (selector is 1), nodes[i+1] = current_node
        // If sibling is not empty (selector is 0), nodes[i+1] = hashed_pair
        if is_sibling_empty_selector == 1 {
            nodes[i + 1] = current_node;
        } else {
            // If path_direction_bit is 0, hash(current_node, sibling_node)
            // If path_direction_bit is 1, hash(sibling_node, current_node)
            // This selection can be done arithmetically:
            // value_if_0 * (1 - bit) + value_if_1 * bit

            let mut left_input: Field = 0 as Field;
            let mut right_input: Field = 0 as Field;
            if path_direction_bit == 0 {
                left_input = current_node;
                right_input = sibling_node;
            } else {
                left_input = sibling_node;
                right_input = current_node;
            }

            // Hash the correctly ordered pair using BLAKE3
            let hashed_pair = black3_hash_to_field([left_input, right_input]);
            nodes[i + 1] = hashed_pair;
        }
    }

    // Output the final computed root
    nodes[MAX_DEPTH]
}

#[test]
pub fn test_lean_imt_inclusion_proof() {
    let leaf: Field = (4 as u8).into();
    let leaf_index: Field = (3 as u8).into();
    let siblings: [Field; 8] = [
        3,
        0x17cb544f4d22abbae88f69c706f21367d7925abb131a13836745714dc896c150,
        0x0d2d3ef5e1cf0f40c92ec8bba3606bef845fa56761bcd04cfbf0eb68a484e3b0,
        0,
        0,
        0,
        0,
        0,
    ];
    let root = lean_imt_inclusion_proof(leaf, leaf_index, siblings);
    assert(root == 0x2a21f1699d1113da4feaff73381129499db752fdc438cb48b2c630d4dbf063e5);
}
