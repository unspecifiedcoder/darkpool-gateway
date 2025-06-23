import { UltraHonkBackend, Barretenberg } from "@aztec/bb.js";
import { ClaimCircuit } from "../circuits/claim";
import { WithdrawTransferCircuit } from "../circuits/withdrawOrTransfer";
import { Noir } from "@noir-lang/noir_js";
import fs from "fs";

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
  const honk = new UltraHonkBackend(ClaimCircuit.bytecode, { threads: 8 });

  // generate and write verifier to file
  // const verifier = await honk.getSolidityVerifier();
  // fs.writeFileSync("./verifier.sol", verifier);
  // console.log("Verifier written to file");

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
    
    const noir = new Noir(WithdrawTransferCircuit as any);
    const honk = new UltraHonkBackend(WithdrawTransferCircuit.bytecode, { threads: 8 });
    
    // // generate and write verifier to file
    // const verifier = await honk.getSolidityVerifier();
    // fs.writeFileSync("./verifier.sol", verifier);
    // console.log("Verifier written to file");
    

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
    const { witness } = await noir.execute(inputs);
    const { proof, publicInputs } = await honk.generateProof(witness, { keccak: true });

    const verified = await honk.verifyProof({ proof, publicInputs }, { keccak: true });

    // console.log("Proof: <Proof Gen circuit>", proof, proof.length);
    // write proof in hex to a file
    // fs.writeFileSync("./proof.hex", Buffer.from(proof).toString("hex"));
    // console.log("Public Inputs: <Public Inputs>", publicInputs, publicInputs.length);
    
    return { proof, publicInputs, verified };
}
