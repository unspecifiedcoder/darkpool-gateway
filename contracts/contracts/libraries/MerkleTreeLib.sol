// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./Pedersen.sol";

library MerkleTreeLib {
    struct Tree {
        bytes32 currentRoot; // The actual Pedersen root, updated by ZK proof logic
        bytes32[][] tree; // Stores all leaves sequentially
        uint32 depth;
    }

    
    function _hash(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return PedersenHash.hash(abi.encodePacked(left, right));
    }

   
    function initialize(Tree storage self, uint32 _depth) internal {

     }

    function insert(Tree storage self, bytes32 leaf) internal { }
       

    function root(Tree storage self) internal view returns (bytes32) {


     }

    function getSiblings(Tree storage self, uint32 leafIndex) internal view returns (bytes32[] memory siblings) {
        
    }

    

}