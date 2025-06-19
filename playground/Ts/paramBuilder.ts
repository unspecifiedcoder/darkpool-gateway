import { pedersenHash, poseidon2Hash } from "@aztec/foundation/crypto";
import { commitmentHasherTS } from "./commitment.play";
import { LeanIMT, verifyPath } from "./leanIMT";

import { Fr } from "@aztec/foundation/fields";
import { ethers } from "ethers"; // For ethers.parseEther and address handling

const computeWithdrawParams = async () => {
  const imt = new LeanIMT(32);

  for (let i = 0; i < 50; i++) {
    let commitment = await commitmentHasherTS(
      BigInt(i),
      BigInt(2 * i),
      ethers.parseEther("1"),
      "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97"
    );
    await imt.insert(commitment);
  }

  let withdrawValue = ethers.parseEther("0.5");
  let merkleRoot = imt.getRoot();
  let leafIndex = 17;
  let existingNullifier = BigInt(17);

  let label = "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97";
  let existingValue = ethers.parseEther("1");
  let existingSecret = BigInt(2n * existingNullifier);
  let newNullifier = BigInt(601);
  let newSecret = BigInt(602);
  let siblings = imt.getPath(leafIndex);

  console.log(
    "Withdraw params",
    withdrawValue,
    merkleRoot,
    leafIndex,
    existingNullifier,
    label,
    existingValue,
    existingSecret,
    newNullifier,
    newSecret,
    siblings
  );

  const verify_commitment = await commitmentHasherTS(
    existingNullifier,
    existingSecret,
    existingValue,
    label
  );

  console.log("Verify commitment", verify_commitment);

  const local_verify = await verifyPath(
    verify_commitment,
    leafIndex,
    siblings,
    merkleRoot,
    32,
    new Fr(0n)
  );
  console.log("Local verify", local_verify);

  siblings[3] = new Fr(3n);
  const local_verify2 = await verifyPath(
    verify_commitment,
    leafIndex,
    siblings,
    merkleRoot,
    32,
    new Fr(0n)
  );
  console.log("Local verify2", local_verify2);

  const newCommitment = await commitmentHasherTS(
    newNullifier,
    newSecret,
    existingValue - withdrawValue,
    label
  );
  console.log("New commitment", newCommitment);
};

const computeClaimParams = async () => {
  const imt = new LeanIMT(8);

  for (let i = 0; i < 8; i++) {
    let commitment = await commitmentHasherTS(
      BigInt(i),
      BigInt(2 * i),
      ethers.parseEther("1"),
      "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97"
    );
    await imt.insert(commitment);
  }

  let claimValue = ethers.parseEther("0.5");
  let merkleRoot = imt.getRoot();
  let leafIndex = 5;
  let existingNullifier = BigInt(5);
  let label = "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97";
  let existingValue = ethers.parseEther("1");
  let existingSecret = BigInt(10);
  let newNullifier = BigInt(601);
  let newSecret = BigInt(602);
  let siblings = imt.getPath(leafIndex);

  let receiverSecret = 66666;
  let receiverSecretHash = await poseidon2Hash([receiverSecret]);
  let noteNonce = 12345;

  console.log(
    "Claim params",
    claimValue,
    noteNonce,
    receiverSecretHash,
    merkleRoot,
    leafIndex,
    existingNullifier,
    label,
    receiverSecret,
    newNullifier,
    newSecret,

    existingValue,
    existingSecret,
    siblings
  );

  const verify_commitment = await commitmentHasherTS(
    existingNullifier,
    existingSecret,
    existingValue,
    label
  );
  const local_verify = await verifyPath(
    verify_commitment,
    leafIndex,
    siblings,
    merkleRoot,
    8,
    new Fr(0n)
  );
  console.log("Local verify", local_verify);

  const newCommitment = await commitmentHasherTS(
    newNullifier,
    newSecret,
    existingValue + claimValue,
    label
  );
  console.log("New commitment", newCommitment , (existingValue + claimValue).toString(16));
};

computeWithdrawParams();

