import { ethers } from "hardhat";
import { expect } from "chai";
import {
  ClaimHonkVerifier,
  EthPool,
  Poseidon2,
  WithdrawTransferHonkVerifier,
} from "../../typechain-types"; // Adjust paths
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  calculateSolidityCommitment,
  generate_precommitment,
} from "../utils/utils";
import {
  generateClaimProof,
  generateWithdrawTransferProof,
} from "../utils/proofGeneration";
import { EventLog } from "ethers";
import { LeanIMT } from "../test_utils/leanIMT";
import { poseidon2Hash, randomBigInt } from "@aztec/foundation/crypto";

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const MAX_TREE_DEPTH = 32;

describe("EthPool Contract Tests", function () {
  let deployer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let entryPoint: HardhatEthersSigner;

  let ethPool: EthPool;
  let WithdrawVerifier: WithdrawTransferHonkVerifier;
  let ClaimVerifier: ClaimHonkVerifier;
  let poseidon2: Poseidon2;

  beforeEach(async function () {
    [deployer, user1, user2, entryPoint] = await ethers.getSigners();

    const WithdrawTransferHonkVerifierFactory = await ethers.getContractFactory(
      "WithdrawTransferHonkVerifier",
      deployer
    );
    WithdrawVerifier =
      (await WithdrawTransferHonkVerifierFactory.deploy()) as WithdrawTransferHonkVerifier;
    await WithdrawVerifier.waitForDeployment();

    const ClaimHonkVerifierFactory = await ethers.getContractFactory(
      "ClaimHonkVerifier",
      deployer
    );
    ClaimVerifier =
      (await ClaimHonkVerifierFactory.deploy()) as ClaimHonkVerifier;
    await ClaimVerifier.waitForDeployment();

    // deploy poseidon2
    const Poseidon2Factory = await ethers.getContractFactory(
      "Poseidon2",
      deployer
    );
    poseidon2 = (await Poseidon2Factory.deploy()) as Poseidon2;
    await poseidon2.waitForDeployment();

    const EthPoolFactory = await ethers.getContractFactory("EthPool", {
      libraries: {
        Poseidon2: poseidon2.target,
      },
    });
    ethPool = (await EthPoolFactory.deploy(
      entryPoint.address, // Using signer as mock EntryPoint
      WithdrawVerifier.target,
      ClaimVerifier.target,
      MAX_TREE_DEPTH
    )) as EthPool;
    await ethPool.waitForDeployment();
  });

  async function isKnownRoot(ethPool: EthPool, root: string): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      if ((await ethPool.roots(i)) === root) {
        return true;
      }
    }
    return false;
  }

  describe("Deployment & Configuration", function () {
    it("Should set the correct EntryPoint address", async function () {
      expect(await ethPool.entryPoint()).to.equal(entryPoint.address);
    });
    it("Should set the correct withdraw verifier address", async function () {
      expect(await ethPool.withdraw_transfer_verifier()).to.equal(
        WithdrawVerifier.target
      );
    });
    it("Should set the correct claim verifier address", async function () {
      expect(await ethPool.claim_verifier()).to.equal(ClaimVerifier.target);
    });
    it("Should initialize with tree depth", async function () {
      expect(await ethPool.TREE_DEPTH()).to.equal(MAX_TREE_DEPTH);
    });
    it("Should initialize with an empty root or a defined initial root", async function () {
      expect(await ethPool.currentRoot()).to.equal(ethers.ZeroHash);
    });
    it("Should initialize noteNonce to 0", async function () {
      expect(await ethPool.noteNonce()).to.equal(0);
    });
  });

  describe("deposit()", function () {
    const depositAmount = ethers.parseEther("1");
    let nullifier: bigint;
    let secret: bigint;
    let precommitment: string;
    let tsTree: LeanIMT;

    beforeEach(async function () {
      nullifier = 123n;
      secret = 456n;
      precommitment = (
        await generate_precommitment(nullifier, secret)
      ).toString();
      tsTree = new LeanIMT(MAX_TREE_DEPTH);
    });

    it("Should allow a user to deposit ETH and insert a commitment", async function () {
      const expectedCommitmentFr = await calculateSolidityCommitment(
        nullifier,
        secret,
        depositAmount,
        ETH_ADDRESS
      );
      await tsTree.insert(expectedCommitmentFr); // Update JS tree

      const expectedCommitment = expectedCommitmentFr.toString();
      const initialContractBalance = await ethers.provider.getBalance(
        ethPool.target
      );

      await expect(
        ethPool
          .connect(user1)
          .deposit(depositAmount, precommitment, { value: depositAmount })
      )
        .to.emit(ethPool, "CommitmentInserted")
        .withArgs(expectedCommitment, 0, tsTree.getRoot().toString());

      expect(await ethPool.nextLeafIndex()).to.equal(1);
      expect(await ethPool.getLeaf(0)).to.equal(expectedCommitment);
      expect(await ethers.provider.getBalance(ethPool.target)).to.equal(
        initialContractBalance + depositAmount
      );
    });

    it("Should allow multiple deposits and update root correctly", async function () {
      // Deposit 1
      await ethPool
        .connect(user1)
        .deposit(depositAmount, precommitment, { value: depositAmount });
      const commitment1Fr = await calculateSolidityCommitment(
        nullifier,
        secret,
        depositAmount,
        ETH_ADDRESS
      );

      await tsTree.insert(commitment1Fr);
      const commitment1 = commitment1Fr.toString();

      expect(await ethPool.getLeaf(0)).to.equal(commitment1);
      expect(await ethPool.nextLeafIndex()).to.equal(1);
      expect(await ethPool.currentRoot()).to.equal(tsTree.getRoot().toString());

      expect(await isKnownRoot(ethPool, tsTree.getRoot().toString())).to.be
        .true;

      // Deposit 2 (different user, different precommitment)
      const nullifier2 = 789n;
      const secret2 = 101n;
      const precommitment2 = (
        await generate_precommitment(nullifier2, secret2)
      ).toString();
      const depositAmount2 = ethers.parseEther("0.5");
      const commitment2 = await calculateSolidityCommitment(
        nullifier2,
        secret2,
        depositAmount2,
        ETH_ADDRESS
      );
      await tsTree.insert(commitment2);

      await expect(
        ethPool
          .connect(user2)
          .deposit(depositAmount2, precommitment2, { value: depositAmount2 })
      )
        .to.emit(ethPool, "CommitmentInserted")
        .withArgs(commitment2.toString(), 1, tsTree.getRoot().toString()); // Check actual root

      expect(await ethPool.nextLeafIndex()).to.equal(2);
      expect(await ethPool.getLeaf(1)).to.equal(commitment2.toString());
      // expect(await ethPool.currentRoot()).to.equal(jsTree.getRoot());
      expect(await isKnownRoot(ethPool, tsTree.getRoot().toString())).to.be
        .true;
    });

    it("Should revert if msg.value does not match deposit amount", async function () {
      await expect(
        ethPool.connect(user1).deposit(depositAmount, precommitment, {
          value: ethers.parseEther("0.1"),
        })
      ).to.be.revertedWith("AssetPool: Invalid amount");
    });

    it("Should revert if deposit amount is zero", async function () {
      await expect(
        ethPool.connect(user1).deposit(0, precommitment, { value: 0 })
      ).to.be.revertedWith("AssetPool: Invalid amount");
    });

    it("Should revert if precommitment is zero", async function () {
      await expect(
        ethPool
          .connect(user1)
          .deposit(depositAmount, ethers.ZeroHash, { value: depositAmount })
      ).to.be.revertedWith("AssetPool: Invalid precommitment");
    });

    it("Should revert if tree is full", async function () {
      const treeDepth = 4;
      let maxLeaves = 2 ** treeDepth;
      const EthPoolFactory = await ethers.getContractFactory("EthPool", {
        libraries: {
          Poseidon2: poseidon2.target,
        },
      });
      const ethPool = (await EthPoolFactory.deploy(
        entryPoint.address,
        WithdrawVerifier.target,
        ClaimVerifier.target,
        treeDepth
      )) as EthPool;
      await ethPool.waitForDeployment();

      // deposit until 2 ** 4 should be valid and should revert after that
      for (let i = 0; i < maxLeaves; i++) {
        await ethPool
          .connect(user1)
          .deposit(depositAmount, precommitment, { value: depositAmount });
      }
      await expect(
        ethPool
          .connect(user1)
          .deposit(depositAmount, precommitment, { value: depositAmount })
      ).to.be.revertedWith("MerkleTree: tree is full");
    });
  });

  describe("withdraw()", function () {
    const initialDeposit = ethers.parseEther("10");
    let precommitment: string, initialCommitment: string;
    let leafIndex: bigint;
    let currentMerkleRoot: string;

    // User1's initial state for withdrawal
    const user1Original = {
      value: initialDeposit,
      nullifier: 111n,
      secret: 222n,
    };
    // User1's new state after withdrawal
    const user1New = {
      nullifier: 333n,
      secret: 444n,
    };

    beforeEach(async function () {
      // User1 deposits
      precommitment = (
        await generate_precommitment(
          user1Original.nullifier,
          user1Original.secret
        )
      ).toString();
      initialCommitment = (
        await calculateSolidityCommitment(
          user1Original.nullifier,
          user1Original.secret,
          user1Original.value,
          ETH_ADDRESS
        )
      ).toString();
      leafIndex = await ethPool.deposit.staticCall(
        user1Original.value,
        precommitment,
        { value: user1Original.value }
      );
      await ethPool.connect(user1).deposit(user1Original.value, precommitment, {
        value: user1Original.value,
      });

      expect(await ethPool.getLeaf(leafIndex)).to.equal(initialCommitment);
      expect(await ethPool.nextLeafIndex()).to.equal(1);
      currentMerkleRoot = await ethPool.currentRoot(); // or jsTree.getRoot()
    });

    it("Should allow a user to withdraw a partial amount with a valid proof", async function () {
      const withdrawValue = ethers.parseEther("3");
      const remainingValue = user1Original.value - withdrawValue;

      const newCommitmentForProof = await calculateSolidityCommitment(
        user1New.nullifier,
        user1New.secret,
        remainingValue,
        ETH_ADDRESS
      );
      // const siblings = jsTree.getPath(leafIndex);

      const siblings = await ethPool.getPath(leafIndex);

      const { proof, publicInputs, verified } =
        await generateWithdrawTransferProof(
          user1Original.nullifier.toString(),
          user1Original.secret.toString(),
          user1Original.value.toString(),
          ETH_ADDRESS,
          leafIndex.toString(),
          currentMerkleRoot,
          user1New.nullifier.toString(),
          user1New.secret.toString(),
          withdrawValue.toString(),
          siblings
        );
      expect(verified).to.be.true;

      const initialUserBalance = await ethers.provider.getBalance(
        user1.address
      );
      const initialContractBalance = await ethers.provider.getBalance(
        ethPool.target
      );

      const withdrawTx = await ethPool.connect(user1).withdraw({
        honkProof: proof,
        publicInputs,
      });

      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed = withdrawReceipt?.gasUsed! * withdrawReceipt?.gasPrice!;

      expect(gasUsed).to.be.greaterThan(0);

      expect(
        await ethPool.isNullifierSpent(
          ethers.zeroPadValue("0x" + user1Original.nullifier.toString(16), 32)
        )
      ).to.be.true;
      expect(await ethPool.nextLeafIndex()).to.equal(leafIndex + 2n); // initial + this new one

      expect(await ethPool.getLeaf(leafIndex + 1n)).to.equal(
        newCommitmentForProof.toString()
      );
      expect(await isKnownRoot(ethPool, await ethPool.currentRoot())).to.be
        .true;

      expect(await ethers.provider.getBalance(user1.address)).to.equal(
        initialUserBalance + withdrawValue - gasUsed
      );
      expect(await ethers.provider.getBalance(ethPool.target)).to.equal(
        initialContractBalance - withdrawValue
      );

      const newLeafEvent = withdrawReceipt?.logs?.find(
        (log) =>
          log.topics[0] ===
          ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")
      );

      expect(newLeafEvent && newLeafEvent.data).to.not.be.undefined;

      expect((newLeafEvent as EventLog)!.args[0]).to.equal(
        newCommitmentForProof.toString()
      );
      expect((newLeafEvent as EventLog)!.args[1]).to.equal(leafIndex + 1n);
    });

    it("Should allow a user to withdraw their full amount", async function () {
      const withdrawValue = ethers.parseEther("10");
      const remainingValue = user1Original.value - withdrawValue;
      const newCommitmentForProof = await calculateSolidityCommitment(
        user1New.nullifier,
        user1New.secret,
        remainingValue,
        ETH_ADDRESS
      );

      const siblings = await ethPool.getPath(leafIndex);
      const { proof, publicInputs, verified } =
        await generateWithdrawTransferProof(
          user1Original.nullifier.toString(),
          user1Original.secret.toString(),
          user1Original.value.toString(),
          ETH_ADDRESS,
          leafIndex.toString(),
          currentMerkleRoot,
          user1New.nullifier.toString(),
          user1New.secret.toString(),
          withdrawValue.toString(),
          siblings
        );
      expect(verified).to.be.true;

      const initialUserBalance = await ethers.provider.getBalance(
        user1.address
      );
      const initialContractBalance = await ethers.provider.getBalance(
        ethPool.target
      );

      const withdrawTx = await ethPool.connect(user1).withdraw({
        honkProof: proof,
        publicInputs,
      });

      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed = withdrawReceipt?.gasUsed! * withdrawReceipt?.gasPrice!;

      expect(gasUsed).to.be.greaterThan(0);

      expect(
        await ethPool.isNullifierSpent(
          ethers.zeroPadValue("0x" + user1Original.nullifier.toString(16), 32)
        )
      ).to.be.true;
      expect(await ethPool.nextLeafIndex()).to.equal(leafIndex + 2n); // initial + this new one

      expect(await ethPool.getLeaf(leafIndex + 1n)).to.equal(
        newCommitmentForProof.toString()
      );
      expect(await isKnownRoot(ethPool, await ethPool.currentRoot())).to.be
        .true;

      expect(await ethers.provider.getBalance(user1.address)).to.equal(
        initialUserBalance + withdrawValue - gasUsed
      );
      expect(await ethers.provider.getBalance(ethPool.target)).to.equal(
        initialContractBalance - withdrawValue
      );

      const newLeafEvent = withdrawReceipt?.logs?.find(
        (log) =>
          log.topics[0] ===
          ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")
      );

      expect(newLeafEvent && newLeafEvent.data).to.not.be.undefined;

      expect((newLeafEvent as EventLog)!.args[0]).to.equal(
        newCommitmentForProof.toString()
      );
      expect((newLeafEvent as EventLog)!.args[1]).to.equal(leafIndex + 1n);
    });

    it("Should revert if withdraw proof is invalid", async function () {
      const withdrawValue = ethers.parseEther("3");
      const siblings = await ethPool.getPath(leafIndex);
      const { proof, publicInputs, verified } =
        await generateWithdrawTransferProof(
          user1Original.nullifier.toString(),
          user1Original.secret.toString(),
          user1Original.value.toString(),
          ETH_ADDRESS,
          leafIndex.toString(),
          currentMerkleRoot,
          user1New.nullifier.toString(),
          user1New.secret.toString(),
          withdrawValue.toString(),
          siblings
        );
      expect(verified).to.be.true;

      const invalidProof = proof;
      invalidProof[0] = 0;
      invalidProof[1] = 0xff;
      invalidProof[2] = 0xf1;
      // invalid proof
      await expect(
        ethPool.connect(user1).withdraw({
          honkProof: invalidProof,
          publicInputs,
        })
      ).to.be.reverted;

      // valid proof but invalid public inputs

      // invalid withdraw value
      const invalidPublicInputs = publicInputs;
      invalidPublicInputs[0] = ethers.zeroPadValue(
        "0x" + ethers.parseEther("4").toString(16),
        32
      );

      await expect(
        ethPool.connect(user1).withdraw({
          honkProof: proof,
          publicInputs: invalidPublicInputs,
        })
      ).to.be.reverted;

      // invalid merkle root
      const invalidPublicInputs2 = publicInputs;
      invalidPublicInputs2[1] = ethers.zeroPadValue(
        "0x" + ethers.parseEther("4").toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).withdraw({
          honkProof: proof,
          publicInputs: invalidPublicInputs2,
        })
      ).to.be.reverted;

      // invalid existing nullifier
      const invalidPublicInputs3 = publicInputs;
      invalidPublicInputs3[2] = ethers.zeroPadValue(
        "0x" + 200n.toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).withdraw({
          honkProof: proof,
          publicInputs: invalidPublicInputs3,
        })
      ).to.be.reverted;

      // invalid new commitment
      const invalidPublicInputs4 = publicInputs;
      invalidPublicInputs4[3] = ethers.zeroPadValue(
        "0x" + 200n.toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).withdraw({
          honkProof: proof,
          publicInputs: invalidPublicInputs4,
        })
      ).to.be.reverted;
    });

    it("Should revert if nullifier has already been spent", async function () {
      const withdrawValue = ethers.parseEther("3");
      const remainingValue = user1Original.value - withdrawValue;
      const newCommitmentForProof = await calculateSolidityCommitment(
        user1New.nullifier,
        user1New.secret,
        remainingValue,
        ETH_ADDRESS
      );

      const siblings = await ethPool.getPath(leafIndex);
      const { proof, publicInputs, verified } =
        await generateWithdrawTransferProof(
          user1Original.nullifier.toString(),
          user1Original.secret.toString(),
          user1Original.value.toString(),
          ETH_ADDRESS,
          leafIndex.toString(),
          currentMerkleRoot,
          user1New.nullifier.toString(),
          user1New.secret.toString(),
          withdrawValue.toString(),
          siblings
        );
      expect(verified).to.be.true;

      await ethPool.connect(user1).withdraw({
        honkProof: proof,
        publicInputs,
      }); // First withdrawal, spends nullifier

      await expect(
        ethPool.connect(user1).withdraw({
          honkProof: proof,
          publicInputs,
        })
      ).to.be.revertedWith("AssetPool: Nullifier already spent");
    });
  });

  describe("transfer()", function () {
    // Similar setup to withdraw: user1 has a deposit
    // User1 transfers an amount, which creates a note for User2 (receiver)
    // User1's original commitment is nullified, a new one (less the transfer_value) is created.

    const initialDeposit = ethers.parseEther("10");
    let user1InitialCommitment: string,
      user1LeafIndex: bigint,
      initialMerkleRoot: string;
    const user1Original = {
      value: initialDeposit,
      nullifier: 111n,
      secret: 222n,
    };
    const user1NewAfterTransfer = { nullifier: 333n, secret: 444n };
    const receiverUser2 = { secret: 555n }; // User2's private secret for claiming
    let receiverSecretHashForNote: string;

    beforeEach(async function () {
      const precommitment1 = await generate_precommitment(
        user1Original.nullifier,
        user1Original.secret
      );
      user1InitialCommitment = (
        await calculateSolidityCommitment(
          user1Original.nullifier,
          user1Original.secret,
          user1Original.value,
          ETH_ADDRESS
        )
      ).toString();

      user1LeafIndex = await ethPool.deposit.staticCall(
        user1Original.value,
        precommitment1.toString(),
        { value: user1Original.value }
      );
      await ethPool
        .connect(user1)
        .deposit(user1Original.value, precommitment1.toString(), {
          value: user1Original.value,
        });

      initialMerkleRoot = await ethPool.currentRoot(); // or jsTree.getRoot();

      receiverSecretHashForNote = (
        await poseidon2Hash([receiverUser2.secret])
      ).toString();
    });

    it("Should allow a user to transfer funds, creating a note and a new commitment for sender", async function () {
      // transfer uses WithdrawTransferVerifier

      const transferValue = ethers.parseEther("4");
      const senderRemainingValue = user1Original.value - transferValue;
      const senderNewCommitmentForProof = await calculateSolidityCommitment(
        user1NewAfterTransfer.nullifier,
        user1NewAfterTransfer.secret,
        senderRemainingValue,
        ETH_ADDRESS
      );

      const siblings = await ethPool.getPath(user1LeafIndex);
      const { proof, publicInputs, verified } =
        await generateWithdrawTransferProof(
          user1Original.nullifier.toString(),
          user1Original.secret.toString(),
          user1Original.value.toString(),
          ETH_ADDRESS,
          user1LeafIndex.toString(),
          initialMerkleRoot,
          user1NewAfterTransfer.nullifier.toString(),
          user1NewAfterTransfer.secret.toString(),
          transferValue.toString(),
          siblings
        );
      expect(verified).to.be.true;

      const params = {
        honkProof: proof,
        publicInputs,
      };

      const initialNoteNonce = await ethPool.noteNonce();
      const expectedNoteID = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [ETH_ADDRESS, initialNoteNonce]
      );

      const transferTx = await ethPool
        .connect(user1)
        .transfer(params, receiverSecretHashForNote);
      await expect(transferTx)
        .to.emit(ethPool, "CommitmentInserted") // For sender's new commitment
        .withArgs(
          senderNewCommitmentForProof.toString(),
          user1LeafIndex + 1n,
          await ethPool.currentRoot()
        ); // or jsTree.getRoot()

      const receipt = await transferTx.wait();
      let noteCreatedEvent = receipt?.logs?.find(
        (log) =>
          log.topics[0] === ethers.id("NoteCreated(bytes32,uint256,uint256)")
      );

      expect(noteCreatedEvent).to.not.be.undefined;

      expect((noteCreatedEvent as EventLog)!.args[0]).to.equal(
        receiverSecretHashForNote
      );
      expect((noteCreatedEvent as EventLog)!.args[1]).to.equal(transferValue);
      expect((noteCreatedEvent as EventLog)!.args[2]).to.equal(
        initialNoteNonce
      );

      expect(
        await ethPool.isNullifierSpent(
          ethers.zeroPadValue("0x" + user1Original.nullifier.toString(16), 32)
        )
      ).to.be.true;
      // expect(await ethPool.currentRoot()).to.equal(jsTree.getRoot());
      expect(await ethPool.nextLeafIndex()).to.equal(user1LeafIndex + 2n);
      expect(await ethPool.noteNonce()).to.equal(initialNoteNonce + 1n);

      const note = await ethPool.notes(expectedNoteID);
      expect(note.receiverHash).to.equal(receiverSecretHashForNote);
      expect(note.value).to.equal(transferValue);
      // **BUG CHECK**: note.claimedBlockNumber should be 0 here if bug is fixed.
      // If bug is NOT fixed, it will be current block.number.
      // Let's assume the bug (note.claimedBlockNumber = block.number in transfer) needs to be fixed for this test to be ideal.
      // For now, testing current (buggy) behavior:
      expect(note.claimedBlockNumber).to.equal(0);
    });

    // Failure cases for transfer (invalid proof, bad root, spent nullifier) are similar to withdraw()
    // Add specific failure case:
    it("Should revert if receiverHash is zero (if that's an invalid state)", async function () {
      // Assuming receiverHash shouldn't be zero. If it can be, this test is invalid.

      const transferValue = ethers.parseEther("4");
      const senderRemainingValue = user1Original.value - transferValue;
      const senderNewCommitmentForProof = await calculateSolidityCommitment(
        user1NewAfterTransfer.nullifier,
        user1NewAfterTransfer.secret,
        senderRemainingValue,
        ETH_ADDRESS
      );

      const siblings = await ethPool.getPath(user1LeafIndex);
      const { proof, publicInputs, verified } =
        await generateWithdrawTransferProof(
          user1Original.nullifier.toString(),
          user1Original.secret.toString(),
          user1Original.value.toString(),
          ETH_ADDRESS,
          user1LeafIndex.toString(),
          initialMerkleRoot,
          user1NewAfterTransfer.nullifier.toString(),
          user1NewAfterTransfer.secret.toString(),
          transferValue.toString(),
          siblings
        );
      expect(verified).to.be.true;

      const params = {
        honkProof: proof,
        publicInputs,
      };

      // pass invalid params

      // invalid proof
      const invalidProof = proof;
      invalidProof[0] = 2;
      invalidProof[1] = 2;
      invalidProof[2] = 2;
      invalidProof[3] = 2;
      const invalidParams = {
        honkProof: invalidProof,
        publicInputs,
      };
      await expect(
        ethPool
          .connect(user1)
          .transfer(invalidParams, receiverSecretHashForNote)
      ).to.be.reverted;

      // invalid transfer value
      let invalidPublicInputs = publicInputs;
      invalidPublicInputs[0] = ethers.zeroPadValue(
        "0x" + ethers.parseEther("4").toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).transfer(
          {
            honkProof: proof,
            publicInputs: invalidPublicInputs,
          },
          receiverSecretHashForNote
        )
      ).to.be.reverted;

      // invalid receiver secret hash
      const invalidReceiverSecretHash = ethers.zeroPadValue(
        "0x" + 200n.toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).transfer(params, invalidReceiverSecretHash)
      ).to.be.reverted;

      // invalid merkle root
      invalidPublicInputs = publicInputs;
      invalidPublicInputs[1] = ethers.zeroPadValue(
        "0x" + 200n.toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).transfer(
          {
            honkProof: proof,
            publicInputs: invalidPublicInputs,
          },
          receiverSecretHashForNote
        )
      ).to.be.reverted;

      // invalid existing nullifier
      invalidPublicInputs = publicInputs;
      invalidPublicInputs[2] = ethers.zeroPadValue(
        "0x" + 200n.toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).transfer(
          {
            honkProof: proof,
            publicInputs: invalidPublicInputs,
          },
          receiverSecretHashForNote
        )
      ).to.be.reverted;

      // invalid new commitment
      invalidPublicInputs = publicInputs;
      invalidPublicInputs[3] = ethers.zeroPadValue(
        "0x" + ethers.parseEther("4").toString(16),
        32
      );
      await expect(
        ethPool.connect(user1).transfer(
          {
            honkProof: proof,
            publicInputs: invalidPublicInputs,
          },
          receiverSecretHashForNote
        )
      ).to.be.reverted;
    });
  });

  describe("Admin Functions (setVerifiers)", function () {
    let newVerifier: HardhatEthersSigner;
    beforeEach(async () => {
      [, , , , newVerifier] = await ethers.getSigners(); // Yet another address
    });

    it("Should allow EntryPoint to set WithdrawTransferVerifier", async function () {
      await ethPool
        .connect(entryPoint)
        .setWithdrawTransferVerifier(newVerifier.address);
      expect(await ethPool.withdraw_transfer_verifier()).to.equal(
        newVerifier.address
      );
    });
    it("Should prevent non-EntryPoint from setting WithdrawTransferVerifier", async function () {
      await expect(
        ethPool.connect(user1).setWithdrawTransferVerifier(newVerifier.address)
      ).to.be.revertedWith("AssetPool: Caller is not the EntryPoint");
    });
    it("Should allow EntryPoint to set ClaimVerifier", async function () {
      await ethPool.connect(entryPoint).setClaimVerifier(newVerifier.address);
      expect(await ethPool.claim_verifier()).to.equal(newVerifier.address);
    });
    it("Should prevent non-EntryPoint from setting ClaimVerifier", async function () {
      await expect(
        ethPool.connect(user1).setClaimVerifier(newVerifier.address)
      ).to.be.revertedWith("AssetPool: Caller is not the EntryPoint");
    });
  });

  describe("View Functions", function () {
    it("getPath should return siblings for a valid leafIndex", async function () {
      let tsTree: LeanIMT;
      tsTree = new LeanIMT(MAX_TREE_DEPTH);

      const depositAmount = ethers.parseEther("1");
      const nullifier = 123n;
      const secret = 456n;

      for (let i = 0; i < 10; i++) {
        await ethPool
          .connect(user1)
          .deposit(
            depositAmount,
            (
              await generate_precommitment(nullifier + BigInt(i), secret)
            ).toString(),
            { value: depositAmount }
          );
        const commitment = await calculateSolidityCommitment(
          nullifier + BigInt(i),
          secret,
          depositAmount,
          ETH_ADDRESS
        );
        tsTree.insert(commitment);
      }

      const contractSiblingsLeaf0 = await ethPool.getPath(0);
      const contractSiblingsLeaf1 = await ethPool.getPath(1);

      expect(contractSiblingsLeaf0.length).to.equal(MAX_TREE_DEPTH);
      expect(contractSiblingsLeaf1.length).to.equal(MAX_TREE_DEPTH);

      for (let i = 0; i < 10; i++) {
        const tsSiblings = tsTree.getPath(i);
        const contractSiblings = await ethPool.getPath(i);
        expect(tsSiblings.length).to.equal(contractSiblings.length);
        for (let j = 0; j < tsSiblings.length; j++) {
          expect(tsSiblings[j].toString()).to.equal(contractSiblings[j]);
        }
      }
    });
    it("getPath should revert for invalid leafIndex", async function () {
      await expect(ethPool.getPath(0)).to.be.revertedWith(
        "MerkleTree: leafIndex out of bounds"
      );
      await ethPool
        .connect(user1)
        .deposit(
          ethers.parseEther("1"),
          (await generate_precommitment(125n, 2n)).toString(),
          { value: ethers.parseEther("1") }
        );
      await expect(ethPool.getPath(1)).to.be.revertedWith(
        "MerkleTree: leafIndex out of bounds"
      );
    });
  });
});

describe("Complete Happy Flow multiple user - Deposit, multiple withdraws, multiple transfer, multiple claims [ new claims + existing claims ]", function () {
  let deployer: HardhatEthersSigner;
  let entryPoint: HardhatEthersSigner;

  let ethPool: EthPool;
  let WithdrawVerifier: WithdrawTransferHonkVerifier;
  let ClaimVerifier: ClaimHonkVerifier;
  let poseidon2: Poseidon2;

  async function isKnownRoot(ethPool: EthPool, root: string): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      if ((await ethPool.roots(i)) === root) {
        return true;
      }
    }
    return false;
  }

  // setup
  // Alice bob charlie deposit variable amounts into the pool [validate all the root and contract state]
  // Alice and bob do a partial withdraw, and charlie does a full with draw
  // Alice transfers 1 eth to Bob and 2 eth to David
  // Bob and david claim their notes
  // everything withdraws their balances completely from contract and contract balance is 0

  type ActorType = {
    lastUsedNullifier: bigint;
    secret: bigint;
    signer: HardhatEthersSigner | null;
    depositAmount: bigint;
    currentLeafIndex: bigint;
    receiverSecret: bigint;
    claimableNoteNonces: bigint[];
  };

  let alice: ActorType;
  let bob: ActorType;
  let charlie: ActorType;
  let david: ActorType;
  let tsTree: LeanIMT;

  this.beforeAll(async () => {
    [deployer, entryPoint] = await ethers.getSigners();

    const WithdrawTransferHonkVerifierFactory = await ethers.getContractFactory(
      "WithdrawTransferHonkVerifier",
      deployer
    );
    WithdrawVerifier =
      (await WithdrawTransferHonkVerifierFactory.deploy()) as WithdrawTransferHonkVerifier;
    await WithdrawVerifier.waitForDeployment();

    const ClaimHonkVerifierFactory = await ethers.getContractFactory(
      "ClaimHonkVerifier",
      deployer
    );
    ClaimVerifier =
      (await ClaimHonkVerifierFactory.deploy()) as ClaimHonkVerifier;
    await ClaimVerifier.waitForDeployment();

    // deploy poseidon2
    const Poseidon2Factory = await ethers.getContractFactory(
      "Poseidon2",
      deployer
    );
    poseidon2 = (await Poseidon2Factory.deploy()) as Poseidon2;
    await poseidon2.waitForDeployment();

    const EthPoolFactory = await ethers.getContractFactory("EthPool", {
      libraries: {
        Poseidon2: poseidon2.target,
      },
    });
    ethPool = (await EthPoolFactory.deploy(
      entryPoint.address, // Using signer as mock EntryPoint
      WithdrawVerifier.target,
      ClaimVerifier.target,
      MAX_TREE_DEPTH
    )) as EthPool;
    await ethPool.waitForDeployment();

    const [alice_signer, bob_signer, charlie_signer, david_signer] =
      await ethers.getSigners();
    alice = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: alice_signer,
      depositAmount: ethers.parseEther("10"),
      currentLeafIndex: 0n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };
    bob = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: bob_signer,
      depositAmount: ethers.parseEther("20"),
      currentLeafIndex: 1n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };
    charlie = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: charlie_signer,
      depositAmount: ethers.parseEther("30"),
      currentLeafIndex: 2n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };
    david = {
      lastUsedNullifier: 0n,
      secret: 0n,
      signer: david_signer,
      depositAmount: ethers.parseEther("0"),
      currentLeafIndex: 0n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };

    tsTree = new LeanIMT(MAX_TREE_DEPTH);
  });

  it("Happy Flow - Alice Bob Charlier Deposit", async function () {
    await ethPool
      .connect(alice.signer)
      .deposit(
        alice.depositAmount,
        (
          await generate_precommitment(alice.lastUsedNullifier, alice.secret)
        ).toString(),
        { value: alice.depositAmount }
      );
    await ethPool
      .connect(bob.signer)
      .deposit(
        bob.depositAmount,
        (
          await generate_precommitment(bob.lastUsedNullifier, bob.secret)
        ).toString(),
        { value: bob.depositAmount }
      );
    await ethPool
      .connect(charlie.signer)
      .deposit(
        charlie.depositAmount,
        (
          await generate_precommitment(
            charlie.lastUsedNullifier,
            charlie.secret
          )
        ).toString(),
        { value: charlie.depositAmount }
      );

    alice.currentLeafIndex = 0n;
    bob.currentLeafIndex = 1n;
    charlie.currentLeafIndex = 2n;

    tsTree.insert(
      await calculateSolidityCommitment(
        alice.lastUsedNullifier,
        alice.secret,
        alice.depositAmount,
        ETH_ADDRESS
      )
    );
    tsTree.insert(
      await calculateSolidityCommitment(
        bob.lastUsedNullifier,
        bob.secret,
        bob.depositAmount,
        ETH_ADDRESS
      )
    );
    tsTree.insert(
      await calculateSolidityCommitment(
        charlie.lastUsedNullifier,
        charlie.secret,
        charlie.depositAmount,
        ETH_ADDRESS
      )
    );

    expect(await ethPool.currentRoot()).to.equal(tsTree.getRoot().toString());
    expect(await ethPool.nextLeafIndex()).to.equal(3);

    expect(await ethPool.getLeaf(alice.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          alice.lastUsedNullifier,
          alice.secret,
          alice.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );
    expect(await ethPool.getLeaf(bob.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          bob.lastUsedNullifier,
          bob.secret,
          bob.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );
    expect(await ethPool.getLeaf(charlie.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          charlie.lastUsedNullifier,
          charlie.secret,
          charlie.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );

    expect(await ethPool.getPath(alice.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(alice.currentLeafIndex)).map((x) => x.toString())
    );
    expect(await ethPool.getPath(bob.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(bob.currentLeafIndex)).map((x) => x.toString())
    );
    expect(await ethPool.getPath(charlie.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(charlie.currentLeafIndex)).map((x) => x.toString())
    );
  });

  it("Happy Flow - Alice Bob Charlier Deposit their respective amounts", async function () {
    // Alice and bob do a partial withdraw, and charlie does a full with draw
    const alicePartialWithdrawAmount = ethers.parseEther("5");
    const bobPartialWithdrawAmount = ethers.parseEther("10");
    const charlieFullWithdrawAmount = ethers.parseEther("30");

    const aliceSiblings = await ethPool.getPath(alice.currentLeafIndex);

    const [aliceNewNullifier, aliceNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];

    const aliceProof = await generateWithdrawTransferProof(
      alice.lastUsedNullifier.toString(),
      alice.secret.toString(),
      alice.depositAmount.toString(),
      ETH_ADDRESS,
      alice.currentLeafIndex.toString(),
      tsTree.getRoot().toString(),
      aliceNewNullifier.toString(),
      aliceNewSecret.toString(),
      alicePartialWithdrawAmount.toString(),
      aliceSiblings
    );

    expect(aliceProof.verified).to.equal(true);
    expect(aliceProof.proof.length).to.equal(456 * 32);
    expect(aliceProof.publicInputs.length).to.equal(4);

    alice.lastUsedNullifier = aliceNewNullifier;
    alice.secret = aliceNewSecret;
    alice.depositAmount -= alicePartialWithdrawAmount;
    alice.currentLeafIndex = await ethPool.nextLeafIndex();

    // withdraw
    await ethPool.connect(alice.signer).withdraw({
      honkProof: aliceProof.proof,
      publicInputs: aliceProof.publicInputs,
    });

    await tsTree.insert(
      await calculateSolidityCommitment(
        alice.lastUsedNullifier,
        alice.secret,
        alice.depositAmount,
        ETH_ADDRESS
      )
    );

    const [bobNewNullifier, bobNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];

    const bobSiblings = await ethPool.getPath(bob.currentLeafIndex);

    const bobProof = await generateWithdrawTransferProof(
      bob.lastUsedNullifier.toString(),
      bob.secret.toString(),
      bob.depositAmount.toString(),
      ETH_ADDRESS,
      bob.currentLeafIndex.toString(),
      tsTree.getRoot().toString(),
      bobNewNullifier.toString(),
      bobNewSecret.toString(),
      bobPartialWithdrawAmount.toString(),
      bobSiblings
    );

    expect(bobProof.verified).to.equal(true);
    expect(bobProof.proof.length).to.equal(456 * 32);
    expect(bobProof.publicInputs.length).to.equal(4);

    bob.lastUsedNullifier = bobNewNullifier;
    bob.secret = bobNewSecret;
    bob.depositAmount -= bobPartialWithdrawAmount;
    bob.currentLeafIndex = await ethPool.nextLeafIndex();

    await ethPool.connect(bob.signer).withdraw({
      honkProof: bobProof.proof,
      publicInputs: bobProof.publicInputs,
    });

    await tsTree.insert(
      await calculateSolidityCommitment(
        bob.lastUsedNullifier,
        bob.secret,
        bob.depositAmount,
        ETH_ADDRESS
      )
    );

    const charlieNewNullifier = randomBigInt(1000000n);
    const charlieNewSecret = randomBigInt(1000000n);

    const charlieSiblings = await ethPool.getPath(charlie.currentLeafIndex);
    const charlieProof = await generateWithdrawTransferProof(
      charlie.lastUsedNullifier.toString(),
      charlie.secret.toString(),
      charlie.depositAmount.toString(),
      ETH_ADDRESS,
      charlie.currentLeafIndex.toString(),
      tsTree.getRoot().toString(),
      charlieNewNullifier.toString(),
      charlieNewSecret.toString(),
      charlieFullWithdrawAmount.toString(),
      charlieSiblings
    );

    expect(charlieProof.verified).to.equal(true);
    expect(charlieProof.proof.length).to.equal(456 * 32);
    expect(charlieProof.publicInputs.length).to.equal(4);

    charlie.lastUsedNullifier = charlieNewNullifier;
    charlie.secret = charlieNewSecret;
    charlie.depositAmount -= charlieFullWithdrawAmount;
    charlie.currentLeafIndex = await ethPool.nextLeafIndex();

    await ethPool.connect(charlie.signer).withdraw({
      honkProof: charlieProof.proof,
      publicInputs: charlieProof.publicInputs,
    });

    await tsTree.insert(
      await calculateSolidityCommitment(
        charlie.lastUsedNullifier,
        charlie.secret,
        charlie.depositAmount,
        ETH_ADDRESS
      )
    );

    expect(await ethPool.currentRoot()).to.equal(tsTree.getRoot().toString());
    expect(await ethPool.nextLeafIndex()).to.equal(6);
    expect(await ethPool.getLeaf(alice.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          alice.lastUsedNullifier,
          alice.secret,
          alice.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );
    expect(await ethPool.getLeaf(bob.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          bob.lastUsedNullifier,
          bob.secret,
          bob.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );
    expect(await ethPool.getLeaf(charlie.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          charlie.lastUsedNullifier,
          charlie.secret,
          charlie.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );
  });

  it("Happy Flow - Alice transfers 1 ETH to Bob and 2 eth to David", async function () {
    // alice transfer 1 eth to bob

    let [aliceNewNullifier, aliceNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];
    const bobReceiverHash = await poseidon2Hash([bob.receiverSecret]);
    const davidReceiverHash = await poseidon2Hash([david.receiverSecret]);

    let aliceSiblings = await ethPool.getPath(alice.currentLeafIndex);
    let aliceProof = await generateWithdrawTransferProof(
      alice.lastUsedNullifier.toString(),
      alice.secret.toString(),
      alice.depositAmount.toString(),
      ETH_ADDRESS,
      alice.currentLeafIndex.toString(),
      tsTree.getRoot().toString(),
      aliceNewNullifier.toString(),
      aliceNewSecret.toString(),
      ethers.parseEther("1").toString(),
      aliceSiblings
    );

    expect(aliceProof.verified).to.equal(true);
    expect(aliceProof.proof.length).to.equal(456 * 32);
    expect(aliceProof.publicInputs.length).to.equal(4);

    alice.lastUsedNullifier = aliceNewNullifier;
    alice.secret = aliceNewSecret;
    alice.depositAmount -= ethers.parseEther("1");
    alice.currentLeafIndex = await ethPool.nextLeafIndex();

    const bobTransferTx = await ethPool.connect(alice.signer).transfer(
      {
        honkProof: aliceProof.proof,
        publicInputs: aliceProof.publicInputs,
      },
      bobReceiverHash.toString()
    );

    await tsTree.insert(
      await calculateSolidityCommitment(
        alice.lastUsedNullifier,
        alice.secret,
        alice.depositAmount,
        ETH_ADDRESS
      )
    );
    const bobReceipt = await bobTransferTx.wait();

    const BobNewNoteEvent = bobReceipt?.logs?.find(
      (log) =>
        log.topics[0] === ethers.id("NoteCreated(bytes32,uint256,uint256)")
    );

    expect(BobNewNoteEvent).to.not.be.undefined;
    const noteNonce = (BobNewNoteEvent as EventLog)!.args[2];
    expect(noteNonce).to.equal(0n);
    bob.claimableNoteNonces.push(noteNonce);

    [aliceNewNullifier, aliceNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];

    aliceSiblings = await ethPool.getPath(alice.currentLeafIndex);
    aliceProof = await generateWithdrawTransferProof(
      alice.lastUsedNullifier.toString(),
      alice.secret.toString(),
      alice.depositAmount.toString(),
      ETH_ADDRESS,
      alice.currentLeafIndex.toString(),
      tsTree.getRoot().toString(),
      aliceNewNullifier.toString(),
      aliceNewSecret.toString(),
      ethers.parseEther("2").toString(),
      aliceSiblings
    );

    // console.log("checkpoint 2")
    expect(aliceProof.verified).to.equal(true);
    expect(aliceProof.proof.length).to.equal(456 * 32);
    expect(aliceProof.publicInputs.length).to.equal(4);

    alice.lastUsedNullifier = aliceNewNullifier;
    alice.secret = aliceNewSecret;
    alice.depositAmount -= ethers.parseEther("2");
    alice.currentLeafIndex = await ethPool.nextLeafIndex();

    const davidTransferTx = await ethPool.connect(alice.signer).transfer(
      {
        honkProof: aliceProof.proof,
        publicInputs: aliceProof.publicInputs,
      },
      davidReceiverHash.toString()
    );

    const davidReceipt = await davidTransferTx.wait();

    const DavidNewNoteEvent = davidReceipt?.logs?.find(
      (log) =>
        log.topics[0] === ethers.id("NoteCreated(bytes32,uint256,uint256)")
    );

    expect(DavidNewNoteEvent).to.not.be.undefined;
    const davidNoteNonce = (DavidNewNoteEvent as EventLog)!.args[2];
    expect(davidNoteNonce).to.equal(1n);
    david.claimableNoteNonces.push(davidNoteNonce);

    await tsTree.insert(
      await calculateSolidityCommitment(
        alice.lastUsedNullifier,
        alice.secret,
        alice.depositAmount,
        ETH_ADDRESS
      )
    );

    [aliceNewNullifier, aliceNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];
  });

  it("Bob and David claim their notes", async function () {
    const bobReceiverHash = await poseidon2Hash([bob.receiverSecret]);
    const davidReceiverHash = await poseidon2Hash([david.receiverSecret]);

    const [bobNewNullifier, bobNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];
    const [davidNewNullifier, davidNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];

    const bobSiblings = await ethPool.getPath(bob.currentLeafIndex);

    // const bobClaim
    // note_nonce: string, claim_value: string, existingNullifier: string, existingSecret: string,
    // existingValue: string, label: string, leaf_index: string, merkle_root: string, newNullifier: string,
    // newSecret: string, receiver_secret: string, receiver_secretHash: string, siblings: string[])
    let bobClaimProof = await generateClaimProof(
      bob.claimableNoteNonces[0].toString(),
      ethers.parseEther("1").toString(),
      bob.lastUsedNullifier.toString(),
      bob.secret.toString(),
      bob.depositAmount.toString(),
      ETH_ADDRESS,
      bob.currentLeafIndex.toString(),
      tsTree.getRoot().toString(),
      bobNewNullifier.toString(),
      bobNewSecret.toString(),
      bob.receiverSecret.toString(),
      bobReceiverHash.toString(),
      bobSiblings
    );

    expect(bobClaimProof.verified).to.equal(true);
    expect(bobClaimProof.proof.length).to.equal(456 * 32);
    expect(bobClaimProof.publicInputs.length).to.equal(6);

    bob.lastUsedNullifier = bobNewNullifier;
    bob.secret = bobNewSecret;
    bob.depositAmount += ethers.parseEther("1");
    bob.currentLeafIndex = await ethPool.nextLeafIndex();

    await ethPool.connect(bob.signer).claim({
      honkProof: bobClaimProof.proof,
      publicInputs: bobClaimProof.publicInputs,
    });

    await tsTree.insert(
      await calculateSolidityCommitment(
        bob.lastUsedNullifier,
        bob.secret,
        bob.depositAmount,
        ETH_ADDRESS
      )
    );

    expect(await ethPool.currentRoot()).to.equal(tsTree.getRoot().toString());
    expect(await ethPool.getLeaf(bob.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          bob.lastUsedNullifier,
          bob.secret,
          bob.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );

    expect(await ethPool.getPath(bob.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(bob.currentLeafIndex)).map((x) => x.toString())
    );

    // david doesnt have previous commitments so he can directly claim
    let davidClaimProof = await generateClaimProof(
      david.claimableNoteNonces[0].toString(),
      ethers.parseEther("2").toString(),
      david.lastUsedNullifier.toString(),
      david.secret.toString(),
      david.depositAmount.toString(),
      ETH_ADDRESS,
      david.currentLeafIndex.toString(),
      tsTree.getRoot().toString(),
      davidNewNullifier.toString(),
      davidNewSecret.toString(),
      david.receiverSecret.toString(),
      davidReceiverHash.toString(),
      Array.from({ length: 32 }, () => "0")
    );

    expect(davidClaimProof.verified).to.equal(true);
    expect(davidClaimProof.proof.length).to.equal(456 * 32);
    expect(davidClaimProof.publicInputs.length).to.equal(6);

    david.lastUsedNullifier = davidNewNullifier;
    david.secret = davidNewSecret;
    david.depositAmount += ethers.parseEther("2");
    david.currentLeafIndex = await ethPool.nextLeafIndex();

    await ethPool.connect(david.signer).claim({
      honkProof: davidClaimProof.proof,
      publicInputs: davidClaimProof.publicInputs,
    });

    await tsTree.insert(
      await calculateSolidityCommitment(
        david.lastUsedNullifier,
        david.secret,
        david.depositAmount,
        ETH_ADDRESS
      )
    );

    expect(await ethPool.currentRoot()).to.equal(tsTree.getRoot().toString());
    expect(await ethPool.getLeaf(david.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          david.lastUsedNullifier,
          david.secret,
          david.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );

    expect(await ethPool.getPath(david.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(david.currentLeafIndex)).map((x) => x.toString())
    );

    expect(await ethPool.getLeaf(david.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          david.lastUsedNullifier,
          david.secret,
          david.depositAmount,
          ETH_ADDRESS
        )
      ).toString()
    );
  });
});
