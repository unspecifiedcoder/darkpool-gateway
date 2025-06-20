// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../MerkleTreeLib.sol";
// These are needed because MerkleTreeLib uses them.
import "../Poseidon/Poseidon2.sol";
import "../Poseidon/Field.sol";
import "../Poseidon/Poseidon2Lib.sol";

contract TestMerkleTree {
    using MerkleTreeLib for MerkleTreeLib.Tree;
    MerkleTreeLib.Tree public tree;

    function externalHash(bytes32 left, bytes32 right) external pure returns (bytes32) {
        return MerkleTreeLib._hash(left, right);
    }

    function initializeTree(uint32 depth) external {
        tree.initialize(depth);
    }

    function insertLeaf(bytes32 leaf) external returns (uint32) {
        return tree.insert(leaf);
    }

    function getCurrentRoot() external view returns (bytes32) {
        return tree.currentRoot;
    }

    function getTreeDepth() external view returns (uint32) {
        return tree.depth;
    }

    function getLeafFromTreeLevels(uint32 level, uint32 index) external view returns (bytes32) {
        return tree.tree[level][index];
    }

    function getLevelLength(uint32 level) external view returns (uint256) {
        return tree.tree[level].length;
    }

    function getPath(uint32 leafIndex) external view returns (bytes32[] memory siblings) {
        return tree.getSiblings(leafIndex);
    }
}