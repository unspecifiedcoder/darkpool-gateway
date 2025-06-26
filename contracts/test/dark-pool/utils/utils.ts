
import { Fr } from '@aztec/foundation/fields';
import { poseidon2Hash } from '@aztec/foundation/crypto';
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
export const calculateSolidityCommitment = async (nullifier: bigint, secret: bigint, value: bigint, labelAddr: string) => {

    const nullifierFr = toFr(nullifier);
    const secretFr = toFr(secret);
    const valueFr = toFr(value);
    const labelFr = addressToFr(labelAddr);

    
    const precommitment = await poseidon2Hash([nullifierFr, secretFr]);
    const commitment = await poseidon2Hash([valueFr, labelFr, precommitment]);
    return commitment;
};

export const generate_precommitment = async (nullifier: bigint, secret: bigint) => {
    const nullifierFr = toFr(nullifier);
    const secretFr = toFr(secret);
    return await poseidon2Hash([nullifierFr, secretFr]);
}