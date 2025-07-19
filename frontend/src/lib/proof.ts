import { UltraHonkBackend } from "@aztec/bb.js";
import { ClaimCircuit } from "./circuits/claim";
import { WithdrawTransferCircuit } from "./circuits/withdrawOrTransfer";
import { Noir } from "@noir-lang/noir_js";
import type { CompiledCircuit } from '@noir-lang/noir_js';
import acvm from '@noir-lang/acvm_js/web/acvm_js_bg.wasm?url';
import noirc from '@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url';
import initNoirC from '@noir-lang/noirc_abi';
import initACVM from '@noir-lang/acvm_js';

const _NativeWorker = window.Worker;
window.Worker = function (script: string | URL, opts?: WorkerOptions) {
  // if the library is requesting "main.worker.js", rewrite it to the public path:
  if (typeof script === "string" && script.endsWith("main.worker.js")) {
    script = "/main.worker.js";
  }
  return new _NativeWorker(script as any, opts);
} as any;


export async function generateClaimProof(
  note_nonce: string,
  claim_value: string,
  existingNullifier: string,
  existingSecret: string,
  existingValue: string,
  label: string,
  leaf_index: string,
  merkle_root: string,
  newNullifier: string,
  newSecret: string,
  receiver_secret: string,
  receiver_secretHash: string,
  siblings: string[],
): Promise<{
  proof: Uint8Array<ArrayBufferLike>;
  publicInputs: string[];
  verified: boolean;
}> {
  const noir = new Noir(ClaimCircuit as any);
  const honk = new UltraHonkBackend(ClaimCircuit.bytecode , {threads: navigator.hardwareConcurrency});
  console.log("honk loaded with threads", navigator.hardwareConcurrency);
  await Promise.all([initACVM(fetch(acvm)), initNoirC(fetch(noirc))]);

  const inputs = {
    _note_nonce: note_nonce,
    claim_value,
    existingNullifier,
    existingSecret,
    existingValue,
    label,
    leaf_index,
    merkle_root,
    newNullifier,
    newSecret,
    receiver_secret,
    receiver_secretHash,
    siblings,
  };
  const { witness } = await noir.execute(inputs);
  const { proof, publicInputs } = await honk.generateProof(witness, { keccak: true });

  const verified = await honk.verifyProof({ proof, publicInputs }, { keccak: true });

  return { proof, publicInputs, verified };
}

export const generateWithdrawTransferProof = async (
    existingNullifier: string,
    existingSecret: string,
    existingValue: string,
    label: string,
    leaf_index: string,
    merkle_root: string,
    newNullifier: string,
    newSecret: string,
    withdraw_value: string,
    siblings: string[],
) => {
    
    console.log("Generating withdraw transfer proof...");
    const noir = new Noir(WithdrawTransferCircuit as unknown as CompiledCircuit);
    console.log("WithdrawTransferCircuit loaded", WithdrawTransferCircuit.bytecode.length);
    const honk = new UltraHonkBackend(WithdrawTransferCircuit.bytecode , {threads: navigator.hardwareConcurrency});
    console.log("honk loaded with threads", navigator.hardwareConcurrency);
    await Promise.all([initACVM(fetch(acvm)), initNoirC(fetch(noirc))]);
    

    const inputs = {
        existingNullifier,
        existingSecret,
        existingValue,
        label,
        leaf_index,
        merkle_root,
        newNullifier,
        newSecret,
        withdraw_value,
        siblings,
    };
    console.log("inputs parsed", new Date().toTimeString() );
    const { witness } = await noir.execute(inputs);
    console.log("witness generated", new Date().toTimeString() );
    let proof: Uint8Array<ArrayBufferLike>;
    let publicInputs: string[];
    try {
        const proofData = await honk.generateProof(witness, { keccak: true });
        proof = proofData.proof;
        publicInputs = proofData.publicInputs;
    } catch (error) {
      console.error("Proof generation failed:", error);
      throw error;
    }
    console.log("proof generated Time Now", new Date().toTimeString() );
    const verified = await honk.verifyProof({ proof, publicInputs }, { keccak: true });
    console.log("proof verified Time Now", new Date().toTimeString() );
    
    return { proof, publicInputs, verified };
}


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