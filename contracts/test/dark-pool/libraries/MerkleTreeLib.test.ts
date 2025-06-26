import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { Poseidon2__factory, TestMerkleTree, TestMerkleTree__factory } from "../../typechain-types"; 
import { expect } from "chai";



import { LeanIMT, verifyPath } from "../test_utils/leanIMT"; 
import { Fr } from "@aztec/foundation/fields";   


const ZERO_HASH_BYTES32 = ethers.ZeroHash;

function frToBytes32(fr: Fr): string {
    return "0x" + fr.toBigInt().toString(16).padStart(64, '0');
}

function bytes32ToFr(bytes32: string): Fr {
    return new Fr(BigInt(bytes32));
}

function bytes32ArrayToFrArray(bytes32Array: string[]): Fr[] {
    return bytes32Array.map(b32 => bytes32ToFr(b32));
}

describe("MerkleTreeLib End-to-End with LeanIMT.ts", function () {
    let deployer: HardhatEthersSigner;
    let solTree: TestMerkleTree;
    let tsTree: LeanIMT;
    
    // LeanIMT constructor requires even depth, MAX_DEPTH > 0
    const DEFAULT_TREE_DEPTH = 4; // Example depth (even number)

    before(async function () {
        [deployer] = await ethers.getSigners();
    });

    async function deployAndInitializeSolTree(depth: number): Promise<TestMerkleTree> {
        const Poseidon2Factory = (await ethers.getContractFactory("Poseidon2")) as Poseidon2__factory;
        const poseidon2 = await Poseidon2Factory.deploy();

        const TestMerkleTreeFactory = (await ethers.getContractFactory("TestMerkleTree", {
            libraries: {
                Poseidon2: await poseidon2.getAddress()
            }
        })) as TestMerkleTree__factory;
        const contract = await TestMerkleTreeFactory.deploy();
        await contract.initializeTree(depth);
        return contract;
    }

    describe(`Tree operations with depth ${DEFAULT_TREE_DEPTH}`, function () {
        beforeEach(async function () {
            // Initialize Solidity tree
            solTree = await deployAndInitializeSolTree(DEFAULT_TREE_DEPTH);
            // Initialize TypeScript tree
            tsTree = new LeanIMT(DEFAULT_TREE_DEPTH);
        });

        it("should have matching initial roots (ZERO_HASH)", async function () {
            const solRootBytes32 = await solTree.getCurrentRoot();
            const tsRootFr = tsTree.getRoot();

            // console.log("solRootBytes32", solRootBytes32, "tsRootFr", frToBytes32(tsRootFr) , "ZERO_HASH_BYTES32", ZERO_HASH_BYTES32);
            

            expect(solRootBytes32).to.equal(ZERO_HASH_BYTES32, "Initial Solidity root mismatch");
            expect(frToBytes32(tsRootFr)).to.equal(ZERO_HASH_BYTES32, "Initial TypeScript root mismatch with Solidity's zero");
        });

        it("should match roots after inserting a single leaf", async function () {
            const leafValueFr = new Fr(123n);
            const leafValueBytes32 = frToBytes32(leafValueFr);

            // Insert into TypeScript tree
            const tsLeafIndex = await tsTree.insert(leafValueFr);
            const tsRootFr = tsTree.getRoot();

            // Insert into Solidity tree
            const solLeafIndex = await solTree.insertLeaf.staticCall(leafValueBytes32);
            await solTree.insertLeaf(leafValueBytes32);
            const solRootBytes32 = await solTree.getCurrentRoot();
            
            expect(solLeafIndex).to.equal(tsLeafIndex, "Leaf indices mismatch");
            expect(solRootBytes32).to.equal(frToBytes32(tsRootFr), "Roots mismatch after one insert");
            // For a single leaf, root is the leaf itself due to propagation
            expect(solRootBytes32).to.equal(leafValueBytes32, "Solidity root is not the propagated leaf itself");
        });

        it("should match roots and leaf indices consistently after inserting multiple leaves", async function () {
            const leavesToInsertFr = [new Fr(10n), new Fr(20n), new Fr(30n), new Fr(40n)];
            
            for (let i = 0; i < leavesToInsertFr.length; i++) {
                const currentLeafFr = leavesToInsertFr[i];
                const currentLeafBytes32 = frToBytes32(currentLeafFr);

                // TypeScript action
                const tsLeafIndex = await tsTree.insert(currentLeafFr);
                const tsRootFr = tsTree.getRoot();

                // Solidity action
                const solLeafIndex = await solTree.insertLeaf.staticCall(currentLeafBytes32);
                await solTree.insertLeaf(currentLeafBytes32);
                const solRootBytes32 = await solTree.getCurrentRoot();

                expect(solLeafIndex).to.equal(tsLeafIndex, `Leaf index mismatch at insertion ${i}`);
                expect(solRootBytes32).to.equal(frToBytes32(tsRootFr), `Roots mismatch at insertion ${i}`);
            }
        });

        it("should provide matching sibling paths, and TS verifyPath should validate Solidity's path and root", async function () {
            const leavesToInsertFr = [new Fr(1n), new Fr(2n), new Fr(3n)]; // A few leaves
            for (const leafFr of leavesToInsertFr) {
                await tsTree.insert(leafFr); // Keep TS tree in sync
                await solTree.insertLeaf(frToBytes32(leafFr)); // Insert into Solidity tree
            }

            const leafIndexToTest = 1; // Test path for the second leaf (value Fr(2n))
            const targetLeafFr = leavesToInsertFr[leafIndexToTest];
            // const targetLeafBytes32 = frToBytes32(targetLeafFr); // Not directly needed for verifyPath args if we use Fr versions

            // 1. Get path and root from Solidity
            const solPathBytes32 = await solTree.getPath(leafIndexToTest);
            const solRootBytes32 = await solTree.getCurrentRoot();

            // 2. Convert Solidity data to Fr format for TS's verifyPath
            const solPathFr = bytes32ArrayToFrArray(solPathBytes32);
            const solRootFr = bytes32ToFr(solRootBytes32);

            // 3. (Optional Sanity Check) Compare Solidity path with TS path
            const tsPathFr = tsTree.getPath(leafIndexToTest);
            // console.log("solPathFr", solPathFr, "tsPathFr", tsPathFr);

            expect(solPathFr.map(fr => fr.toString())).to.deep.equal(tsPathFr.map(fr => fr.toString()), "Sibling paths from TS and Solidity do not match");

            // 4. Verify using LeanIMT.ts's verifyPath function with data from Solidity
            const isValidPathAccordingToTs = await verifyPath(
                targetLeafFr,       // The original leaf value (in Fr)
                leafIndexToTest,    // The index of the leaf
                solPathFr,          // Siblings from Solidity (converted to Fr[])
                solRootFr,          // Root from Solidity (converted to Fr)
                DEFAULT_TREE_DEPTH, // Tree height/depth
                new Fr(0n)    // Zero value used by TS tree (new Fr(0n))
            );
            // console.log("isValidPathAccordingToTs", isValidPathAccordingToTs, solRootFr);
            expect(isValidPathAccordingToTs).to.be.true;

        });

        it("should fill the tree to capacity, maintain matching roots, and then Solidity should revert on extra insert", async function () {
            const maxLeaves = 2 ** DEFAULT_TREE_DEPTH;
            for (let i = 0; i < maxLeaves; i++) {
                const leafFr = new Fr(BigInt(i + 1001)); // Use distinct leaf values

                await tsTree.insert(leafFr);
                await solTree.insertLeaf(frToBytes32(leafFr));

                // Quick root check at each step
                const tsRoot = tsTree.getRoot();
                const solRoot = await solTree.getCurrentRoot();
                expect(frToBytes32(tsRoot)).to.equal(solRoot, `Root mismatch during full tree insertion ${i}`);
            }

            // Final root check when full
            const finalTsRootFr = tsTree.getRoot();
            const finalSolRootBytes32 = await solTree.getCurrentRoot();
            expect(frToBytes32(finalTsRootFr)).to.equal(finalSolRootBytes32, "Roots mismatch when tree is full");

            // Attempt to insert one more leaf into Solidity tree (should fail)
            const extraLeafFr = new Fr(BigInt(maxLeaves + 1001));
            const extraLeafBytes32 = frToBytes32(extraLeafFr);
            
            await expect(solTree.insertLeaf(extraLeafBytes32)).to.be.revertedWith("MerkleTree: tree is full");

        });
    });

    describe("Cross-validation with Noir test case parameters using LeanIMT.ts verifyPath", function() {
        it("should validate the Noir test case proof using TS verifyPath", async function() {
            // Parameters from LeanIMT.nr test_lean_imt_inclusion_proof
            const noirMaxDepth = 8; // MAX_DEPTH in Noir test is 8
            const noirLeafFr = new Fr(4n);
            const noirLeafIndex = 3;
            const noirSiblingsFr = [
                new Fr(3n),
                new Fr(BigInt("0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383")),
                new Fr(BigInt("0x232400b3cca0da78d26295f345d21e9bf8949238bee02b285140ebf183119982")),
                new Fr(0n), new Fr(0n), new Fr(0n), new Fr(0n), new Fr(0n) // Remaining siblings are zero
            ];
            const noirExpectedRootFr = new Fr(BigInt("0x05d7e5aaddb74c086c24617065e8c97dea94b86fdae0eab7b498249e0dfee2a8"));
            
            const isValid = await verifyPath(
                noirLeafFr,
                noirLeafIndex,
                noirSiblingsFr,
                noirExpectedRootFr,
                noirMaxDepth,
                new Fr(0n) 
            );
            expect(isValid).to.be.true;
        });
    });

    // Test with a different (valid) depth
    describe(`Tree operations with depth 2`, function () {
        const SMALL_TREE_DEPTH = 2; // Must be even for LeanIMT constructor
        beforeEach(async function () {
            solTree = await deployAndInitializeSolTree(SMALL_TREE_DEPTH);
            tsTree = new LeanIMT(SMALL_TREE_DEPTH);
        });

        it("should match roots after multiple insertions", async function () {
            const leavesFr = [new Fr(55n), new Fr(66n), new Fr(77n)];
            
            for (let i = 0; i < leavesFr.length; i++) {
                const leafFr = leavesFr[i];
                await tsTree.insert(leafFr);
                await solTree.insertLeaf(frToBytes32(leafFr));
                
                expect(frToBytes32(tsTree.getRoot())).to.equal(await solTree.getCurrentRoot(), `Roots mismatch at insertion ${i} for depth ${SMALL_TREE_DEPTH}`);
            }
        });
    });
});

