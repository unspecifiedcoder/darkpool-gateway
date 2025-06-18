
import { Fr } from '@aztec/foundation/fields';
import { pedersenHash } from '@aztec/foundation/crypto';
import { ethers } from 'ethers'; // For ethers.parseEther and address handling

// --- Helper Functions ---

/**
 * Converts a bigint, number, or numeric string to an Fr element.
 */
export function toFr(value: bigint | number | string): Fr {
    if (typeof value === 'string') {
        // Detect if it's a hex string
        if (value.startsWith('0x')) {
            return new Fr(BigInt(value));
        }
        // Assume decimal string otherwise
        return new Fr(BigInt(value));
    }
    return new Fr(BigInt(value));
}

/**
 * Converts an Ethereum address string to an Fr element.
 * The address (20 bytes) is interpreted as a BigInt.
 */
export function addressToFr(address: string): Fr {
    // ethers.getAddress will validate and checksum the address
    return new Fr(BigInt(ethers.getAddress(address)));
}

// --- Existing Commitment Hasher (Adapted) ---
export const commitmentHasherTS = async (nullifier: bigint, secret: bigint, value: bigint, labelAddr: string) => {

    const nullifierFr = toFr(nullifier);
    const secretFr = toFr(secret);
    const valueFr = toFr(value);
    const labelFr = addressToFr(labelAddr);

    // console.log("--- Commitment Hasher ---");
    // console.log("Inputs (Fr):");
    // console.log("  Nullifier:", nullifierFr.toString());
    // console.log("  Secret:   ", secretFr.toString());
    // console.log("  Value:    ", valueFr.toString());
    // console.log("  Label:    ", labelFr.toString(), `(from ${labelAddr})`);
    
    const precommitment = await pedersenHash([nullifierFr, secretFr]);
    // console.log("Precommitment (hex):", precommitment.toBuffer().toString('hex'));

    const commitment = await pedersenHash([valueFr, labelFr, precommitment]);
    // console.log("Commitment (hex):   ", commitment.toBuffer().toString('hex'));
    // console.log("--- End Commitment Hasher ---");
    return commitment;
};

const main = async () => {
    const commitment = await commitmentHasherTS(1n, 2n, ethers.parseEther("1"), "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97");
    console.log("Commitment (hex):   ", commitment.toBuffer().toString('hex'));
    return commitment;
};

main().then(() => console.log("done"))
    .catch((error) => console.error(error));
