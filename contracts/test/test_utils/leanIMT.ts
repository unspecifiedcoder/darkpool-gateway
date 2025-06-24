import { Fr } from '@aztec/foundation/fields';
import { poseidon2Hash } from '@aztec/foundation/crypto';

export class LeanIMT {
    private root: Fr;
    public tree: Fr[][];
    private MAX_DEPTH: number;
    private zeroValue: Fr = new Fr(0);



    constructor(maxDepth: number) {
        if (maxDepth < 1 || maxDepth > 256 || maxDepth % 2 !== 0) {
            throw new Error("Invalid maxDepth");
        }
        this.root = this.zeroValue;
        this.MAX_DEPTH = maxDepth;
        this.tree = Array.from({ length: maxDepth + 1 }, () => []);
        this.tree[this.MAX_DEPTH] = [this.zeroValue]; // root
    }

    public getNextLeafIndex() : number {
        return this.tree[0].length;
    }

    public printTree() {
        console.log("LeanIMT Structure (Root to Leaves):");
        for (let level = this.MAX_DEPTH; level >= 0; level--) {
            const levelNodes = this.tree[level];
            let levelString = `Level ${level} (Nodes: ${levelNodes.length}): `;
            if (levelNodes.length === 0) {
                levelString += (level === this.MAX_DEPTH && this.root.equals(this.zeroValue)) ? `[${this.zeroValue.toString()}] (Initial Root)` : "(empty)";
            } else {
                levelString += levelNodes.map(node => node ? "..." + node.toString().substring( 58 , 67 ) : "undef").join(' | ');
            }
            console.log(levelString);
        }
        console.log(`Current Root Value: ${this.root.toString()}`);
    }


    // insert method we add the leaves only when needed, returns index
    public async insert(value: Fr) : Promise<number> {
        const leafIndex = this.tree[0].length;
        if (leafIndex > (2 ** this.MAX_DEPTH)) {
            console.log((2 ** this.MAX_DEPTH), this.MAX_DEPTH, leafIndex);
            throw new Error("Tree is full");
        }

        this.tree[0].push(value);

        let currentComputedNode = value;
        let currentIndexInLevel = leafIndex;

        for (let level = 0; level < this.MAX_DEPTH; level++) {
            const isRightChild = (currentIndexInLevel % 2) !== 0;
            const siblingIndex = isRightChild ? currentIndexInLevel - 1 : currentIndexInLevel + 1;

            let siblingNode: Fr;
            // Check if sibling exists at the current level.
            // A sibling might not exist if we are at the edge of the populated part of the tree.
            if (siblingIndex < 0 || siblingIndex >= this.tree[level].length || this.tree[level][siblingIndex] === undefined) {
                siblingNode = this.zeroValue;
            } else {
                siblingNode = this.tree[level][siblingIndex];
            }

            let parentNode: Fr;
            const siblingIsZero = siblingNode.equals(this.zeroValue);
            
            // For the very first node being inserted at this level, its counterpart might be zero.
            // The `currentComputedNode` is the one we are carrying up from the inserted leaf's path.
            if (siblingIsZero) {
                parentNode = currentComputedNode; // Propagate current node if sibling is zero
            } else {
                const leftInput = isRightChild ? siblingNode : currentComputedNode;
                const rightInput = isRightChild ? currentComputedNode : siblingNode;
                parentNode = await poseidon2Hash([leftInput, rightInput]);


            }

            const parentIndexInNextLevel = Math.floor(currentIndexInLevel / 2);

            // Ensure the next level's array is long enough
            if (this.tree[level + 1].length <= parentIndexInNextLevel) {
                this.tree[level + 1].push(parentNode); // Pad with zeroValue
            } else {
                this.tree[level + 1][parentIndexInNextLevel] = parentNode;
            }
            

            currentComputedNode = parentNode;
            currentIndexInLevel = parentIndexInNextLevel;
        }
        // add new element to the tree[0]

        this.root = currentComputedNode;
        if(this.tree[this.MAX_DEPTH] && this.tree[this.MAX_DEPTH].length > 0) {
            this.tree[this.MAX_DEPTH][0] = this.root; // Also update the tree structure
        } else {
            this.tree[this.MAX_DEPTH].push(this.root);
        }


        return leafIndex;
    }

    public getPath(leafIndex: number): Fr[] {
        const nextLeafIndex = this.tree[0].length;
        if (leafIndex < 0 || leafIndex >= nextLeafIndex) {
            throw new Error(`Invalid leafIndex: ${leafIndex}. Tree has ${nextLeafIndex} leaves.`);
        }
        if (this.tree[0][leafIndex] === undefined) {
             throw new Error(`Leaf at index ${leafIndex} does not exist or was overwritten (should not happen in append-only).`);
        }

        const siblings: Fr[] = [];
        let currentIndexInLevel = leafIndex;

        for (let level = 0; level < this.MAX_DEPTH; level++) {
            const isRightChild = (currentIndexInLevel % 2) !== 0;
            const siblingIndex = isRightChild ? currentIndexInLevel - 1 : currentIndexInLevel + 1;

            if (siblingIndex < 0 || siblingIndex >= this.tree[level].length || this.tree[level][siblingIndex] === undefined) {
                siblings.push(this.zeroValue);
            } else {
                siblings.push(this.tree[level][siblingIndex]);
            }
            currentIndexInLevel = Math.floor(currentIndexInLevel / 2);
        }
        return siblings;
    }


    public getRoot() : Fr {
        return this.root;
    }

    
}

export const verifyPath = async (
    leaf: Fr,
    leafIndex: number,
    siblings: Fr[],
    expectedRoot: Fr,
    height: number,
    zeroValue: Fr = new Fr(0n) // Provide a default zeroValue
): Promise<boolean> => {
    if (siblings.length !== height) {
        throw new Error(`Invalid sibling path length. Expected ${height}, got ${siblings.length}.`);
    }

    let currentComputedNode = leaf;
    const leafIndexBigInt = BigInt(leafIndex);

    for (let i = 0; i < height; i++) {
        const siblingNode = siblings[i];
        // 0 if currentComputedNode was left child, 1 if it was right
        const pathDirectionBit = (leafIndexBigInt >> BigInt(i)) & 1n;

        if (siblingNode.equals(zeroValue)) {
            // If sibling is zero, propagate the currentComputedNode (no hashing)
            currentComputedNode = currentComputedNode;
        } else {
            const leftInput = pathDirectionBit === 0n ? currentComputedNode : siblingNode;
            const rightInput = pathDirectionBit === 0n ? siblingNode : currentComputedNode;
            currentComputedNode = await poseidon2Hash([leftInput, rightInput]);
        }
    }
    return currentComputedNode.equals(expectedRoot);
};


const main = async () => {
    const imt = new LeanIMT(8);
    
    for (let i = 1; i < 9; i++) {
        await imt.insert(new Fr(i));
        // console.log(`Inserted leaf ${i}`);
        // imt.printTree();
    }

    const leafIndex = 3;
    const siblings = imt.getPath(leafIndex);
    const expectedRoot = imt.getRoot();
    const height = 8;
    const zeroValue = new Fr(0n);
    const leaf = imt.tree[0][leafIndex];
    const result = await verifyPath(leaf, leafIndex, siblings, expectedRoot, height, zeroValue);

    // console.log("Lean IMT params", leaf, leafIndex, siblings, expectedRoot, height, zeroValue);
    // console.log(result, "with expected root", expectedRoot);
 
};

main().then(() => console.log("done"))
    .catch((error) => console.error(error));