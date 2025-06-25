// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Poseidon2} from "./Poseidon/Poseidon2.sol";
import {Field} from "./Poseidon/Field.sol";
import {Poseidon2Lib} from "./Poseidon/Poseidon2Lib.sol";

library MerkleTreeLib {
    using Field for *;
    using Poseidon2Lib for *;

    struct Tree {
        bytes32 currentRoot; // The actual Pedersen root, updated by ZK proof logic
        bytes32[][] tree; // Stores all leaves sequentially
        uint32 depth;
    }

    function _hash(
        bytes32 left,
        bytes32 right
    ) internal pure returns (bytes32) {
        return
            bytes32(
                Field.Type.unwrap(
                    Poseidon2.hash_2(
                        uint256(left).toField(),
                        uint256(right).toField()
                    )
                )
            );
    }

    function initialize(Tree storage self, uint32 _depth) internal {
        require(_depth > 0, "MerkleTree: depth must be greater than 0");
        self.depth = _depth;
        self.tree = new bytes32[][](_depth + 1);
        self.currentRoot = bytes32(0);
    }

    function insert(
        Tree storage self,
        bytes32 leaf
    ) internal returns (uint32 leafIndex) {
        require(self.depth > 0, "MerkleTree: tree is not initialized");

        leafIndex = uint32(self.tree[0].length);
        if (leafIndex >= (1 << self.depth)) {
            revert("MerkleTree: tree is full");
        }

        self.tree[0].push(leaf);

        bytes32 currentComputedNode = leaf;
        uint32 currentIndexInLevel = leafIndex;

        for (uint32 level = 0; level < self.depth; level++) {
            bool isRightChild = (currentIndexInLevel % 2) != 0;
            uint32 siblingIndex = isRightChild
                ? currentIndexInLevel - 1
                : currentIndexInLevel + 1;

            bytes32 siblingNode;
            if (siblingIndex < self.tree[level].length) {
                siblingNode = self.tree[level][siblingIndex];
            } else {
                siblingNode = bytes32(0);
            }

            bytes32 parentNode;

            // For the very first node being inserted at this level, its counterpart might be zero.
            // The `currentComputedNode` is the one we are carrying up from the inserted leaf's path.
            if (siblingNode == bytes32(0)) {
                parentNode = currentComputedNode; // Propagate current node if sibling is zero
            } else {
                bytes32 leftInput = isRightChild
                    ? siblingNode
                    : currentComputedNode;
                bytes32 rightInput = isRightChild
                    ? currentComputedNode
                    : siblingNode;
                parentNode = _hash(leftInput, rightInput);
            }

            uint32 parentIndexInNextLevel = currentIndexInLevel / 2;

            // Ensure the next level's array is long enough
            if (parentIndexInNextLevel >= self.tree[level + 1].length) {
                self.tree[level + 1].push(parentNode);
            } else {
                self.tree[level + 1][parentIndexInNextLevel] = parentNode;
            }

            currentComputedNode = parentNode;
            currentIndexInLevel = parentIndexInNextLevel;
        }
        // add new element to the tree[0]

        self.currentRoot = currentComputedNode;
        if (self.tree[self.depth].length > 0) { 
            self.tree[self.depth][0] = self.currentRoot;
        } else {
            self.tree[self.depth].push(self.currentRoot);
        } 

        return leafIndex;
    }

    function root(Tree storage self) internal view returns (bytes32) {
        return self.currentRoot;
    }

    function getSiblings(
        Tree storage self,
        uint32 leafIndex
    ) internal view returns (bytes32[] memory siblings) {
        require(
            leafIndex < self.tree[0].length && leafIndex >= 0,
            "MerkleTree: leafIndex out of bounds"
        );

        siblings = new bytes32[](self.depth);
        uint32 currentIndexInLevel = leafIndex;

        for (uint32 level = 0; level < self.depth; level++) {
            bool isRightChild = (currentIndexInLevel % 2) != 0;
            uint32 siblingIndex = isRightChild
                ? currentIndexInLevel - 1
                : currentIndexInLevel + 1;

            bytes32 siblingNode;
            if (siblingIndex < self.tree[level].length) {
                siblingNode = self.tree[level][siblingIndex];
            } else {
                siblingNode = bytes32(0);
            }
            siblings[level] = siblingNode;
            currentIndexInLevel = currentIndexInLevel / 2;
        }
        return siblings;
    }
}
