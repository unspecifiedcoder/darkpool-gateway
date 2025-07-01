import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  ClaimHonkVerifier,
  EntryPoint,
  EthPool,
  MockERC20,
  TokenPool,
  WithdrawTransferHonkVerifier,
} from "../../../typechain-types";
import { expect } from "chai";
import { LeanIMT } from "../test_utils/leanIMT";
import { poseidon2Hash, randomBigInt } from "@aztec/foundation/crypto";
import {
  calculateSolidityCommitment,
  generate_precommitment,
} from "../utils/utils";
import {
  generateClaimProof,
  generateWithdrawTransferProof,
} from "../utils/proofGeneration";
import { EventLog } from "ethers";

const MAX_TREE_DEPTH = 32;
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

describe("Entrypoint Contract Tests - happy flow", function () {
  let deployer: HardhatEthersSigner;

  let WithdrawVerifier: WithdrawTransferHonkVerifier;
  let ClaimVerifier: ClaimHonkVerifier;
  let entryPoint: EntryPoint;

  beforeEach(async function () {
    [deployer] = await ethers.getSigners();

    WithdrawVerifier = (await (
      await ethers.getContractFactory("WithdrawTransferHonkVerifier", deployer)
    ).deploy()) as WithdrawTransferHonkVerifier;
    await WithdrawVerifier.waitForDeployment();

    ClaimVerifier = (await (
      await ethers.getContractFactory("ClaimHonkVerifier", deployer)
    ).deploy()) as ClaimHonkVerifier;
    await ClaimVerifier.waitForDeployment();

    const poseidon2 = await (
      await ethers.getContractFactory("Poseidon2", deployer)
    ).deploy();
    await poseidon2.waitForDeployment();

    entryPoint = (await (
      await ethers.getContractFactory("EntryPoint", {
        libraries: {
          Poseidon2: poseidon2.target,
        },
      })
    ).deploy(
      deployer.address,
      ClaimVerifier.target,
      WithdrawVerifier.target,
      MAX_TREE_DEPTH
    )) as EntryPoint;
    await entryPoint.waitForDeployment();
  });

  describe("Deployment & Configuration", function () {
    it("Should set the correct owner address", async function () {
      expect(await entryPoint.owner()).to.equal(deployer.address);
    });
    it("Should set the correct claim verifier address", async function () {
      expect(await entryPoint.claimVerifier()).to.equal(ClaimVerifier.target);
    });
    it("Should set the correct withdraw transfer verifier address", async function () {
      expect(await entryPoint.withdrawTransferVerifier()).to.equal(
        WithdrawVerifier.target
      );
    });
    it("Should initialize with tree depth", async function () {
      expect(await entryPoint.treeDepth()).to.equal(MAX_TREE_DEPTH);
    });
    it("EthPool should be initialized", async function () {
      expect(await entryPoint.assetToPool(ETH_ADDRESS)).to.not.equal(
        ethers.ZeroAddress
      );
    });
  });
});

describe("Happy flow testing - Ethpool", function () {
  type ActorType = {
    lastUsedNullifier: bigint;
    secret: bigint;
    signer: HardhatEthersSigner;
    depositAmount: bigint;
    currentLeafIndex: bigint;
    receiverSecret: bigint;
    claimableNoteNonces: bigint[];
  };

  let alice: ActorType;
  let bob: ActorType;
  let charlie: ActorType;
  let tsTree: LeanIMT;

  let WithdrawVerifier: WithdrawTransferHonkVerifier;
  let ClaimVerifier: ClaimHonkVerifier;
  let ethPool: EthPool;
  let entryPoint: EntryPoint;

  this.beforeAll(async () => {
    const [aliceSigner, bobSigner, charlieSigner] = await ethers.getSigners();
    tsTree = new LeanIMT(MAX_TREE_DEPTH);

    WithdrawVerifier = (await (
      await ethers.getContractFactory(
        "WithdrawTransferHonkVerifier",
        aliceSigner
      )
    ).deploy()) as WithdrawTransferHonkVerifier;
    await WithdrawVerifier.waitForDeployment();

    ClaimVerifier = (await (
      await ethers.getContractFactory("ClaimHonkVerifier", aliceSigner)
    ).deploy()) as ClaimHonkVerifier;
    await ClaimVerifier.waitForDeployment();

    const poseidon2 = await (
      await ethers.getContractFactory("Poseidon2", aliceSigner)
    ).deploy();
    await poseidon2.waitForDeployment();

    entryPoint = (await (
      await ethers.getContractFactory("EntryPoint", {
        libraries: {
          Poseidon2: poseidon2.target,
        },
      })
    ).deploy(
      aliceSigner.address,
      ClaimVerifier.target,
      WithdrawVerifier.target,
      MAX_TREE_DEPTH
    )) as EntryPoint;
    await entryPoint.waitForDeployment();

    alice = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: aliceSigner,
      depositAmount: ethers.parseEther("10"),
      currentLeafIndex: 0n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };
    bob = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: bobSigner,
      depositAmount: ethers.parseEther("20"),
      currentLeafIndex: 1n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };
    charlie = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: charlieSigner,
      depositAmount: ethers.parseEther("30"),
      currentLeafIndex: 2n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };

    ethPool = await ethers.getContractAt(
      "EthPool",
      await entryPoint.assetToPool(ETH_ADDRESS)
    );
  });

  it("Happy Flow - Alice Bob Charlier Deposit", async function () {
    for (const actor of [alice, bob, charlie]) {
      actor.currentLeafIndex = BigInt(tsTree.getNextLeafIndex());
      await entryPoint
        .connect(actor.signer!)
        .deposit(
          ETH_ADDRESS,
          actor.depositAmount,
          (
            await generate_precommitment(actor.lastUsedNullifier, actor.secret)
          ).toString(),
          {
            value: actor.depositAmount,
          }
        );

      await tsTree.insert(
        await calculateSolidityCommitment(
          actor.lastUsedNullifier,
          actor.secret,
          actor.depositAmount,
          ETH_ADDRESS
        )
      );
    }

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

  it("Happy Flow - Alice Bob Charlier withdraw their respective amounts", async function () {
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
    await entryPoint
      .connect(alice.signer)
      .withdraw(ETH_ADDRESS, alice.signer.address, {
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

    // withdraw
    await entryPoint
      .connect(bob.signer)
      .withdraw(ETH_ADDRESS, bob.signer.address, {
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

    // withdraw
    await entryPoint
      .connect(charlie.signer)
      .withdraw(ETH_ADDRESS, charlie.signer.address, {
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

  it("Happy Flow - Alice transfers 1 ETH to Bob ", async function () {
    // alice transfer 1 eth to bob

    let [aliceNewNullifier, aliceNewSecret] = [
      randomBigInt(1000000n),
      randomBigInt(1000000n),
    ];
    const bobReceiverHash = await poseidon2Hash([bob.receiverSecret]);

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

    const bobTransferTx = await entryPoint.connect(alice.signer).transfer(
      ETH_ADDRESS,
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
        log.topics[0] ===
        ethers.id("NoteCreated(bytes32,address,uint256,uint256)")
    );

    expect(BobNewNoteEvent).to.not.be.undefined;
    const noteNonce = (BobNewNoteEvent as EventLog)!.args[3];
    expect(noteNonce).to.equal(0n);
    bob.claimableNoteNonces.push(noteNonce);
  });

  it("Bob claims his notes", async function () {
    const bobReceiverHash = await poseidon2Hash([bob.receiverSecret]);

    const [bobNewNullifier, bobNewSecret] = [
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

    const bobChaimTx = await entryPoint.connect(bob.signer).claim(ETH_ADDRESS, {
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

    let claimReceipt = await bobChaimTx.wait();

    expect(claimReceipt).not.to.be.null;

    let NoteClaimEvent = claimReceipt?.logs?.find(
      (log) =>
        log.topics[0] === ethers.id("NoteClaimed(bytes32,address,uint256)")
    );

    expect(NoteClaimEvent).to.not.be.undefined;

    const expectedNoteID = ethers.solidityPackedKeccak256(
      ["address", "uint256"],
      [ETH_ADDRESS, 0]
    );

    expect((NoteClaimEvent as EventLog)!.args[0]).to.equal(expectedNoteID);
    expect((NoteClaimEvent as EventLog)!.args[1]).to.equal(ETH_ADDRESS);
    expect((NoteClaimEvent as EventLog)!.args[2]).to.equal(
      ethers.parseEther("1")
    );
  });
});

describe("Happy flow testing - TokenPool", function () {
  type ActorType = {
    lastUsedNullifier: bigint;
    secret: bigint;
    signer: HardhatEthersSigner;
    depositAmount: bigint;
    currentLeafIndex: bigint;
    receiverSecret: bigint;
    claimableNoteNonces: bigint[];
  };

  let alice: ActorType;
  let bob: ActorType;
  let charlie: ActorType;
  let tsTree: LeanIMT;

  let WithdrawVerifier: WithdrawTransferHonkVerifier;
  let ClaimVerifier: ClaimHonkVerifier;
  let mockToken: MockERC20;
  let entryPoint: EntryPoint;
  let tokenPool: TokenPool;

  this.beforeAll(async () => {
    const [aliceSigner, bobSigner, charlieSigner] = await ethers.getSigners();
    tsTree = new LeanIMT(MAX_TREE_DEPTH);

    WithdrawVerifier = (await (
      await ethers.getContractFactory(
        "WithdrawTransferHonkVerifier",
        aliceSigner
      )
    ).deploy()) as WithdrawTransferHonkVerifier;
    await WithdrawVerifier.waitForDeployment();

    ClaimVerifier = (await (
      await ethers.getContractFactory("ClaimHonkVerifier", aliceSigner)
    ).deploy()) as ClaimHonkVerifier;
    await ClaimVerifier.waitForDeployment();

    const poseidon2 = await (
      await ethers.getContractFactory("Poseidon2", aliceSigner)
    ).deploy();
    await poseidon2.waitForDeployment();

    entryPoint = (await (
      await ethers.getContractFactory("EntryPoint", {
        libraries: {
          Poseidon2: poseidon2.target,
        },
      })
    ).deploy(
      aliceSigner.address,
      ClaimVerifier.target,
      WithdrawVerifier.target,
      MAX_TREE_DEPTH
    )) as EntryPoint;
    await entryPoint.waitForDeployment();

    alice = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: aliceSigner,
      depositAmount: ethers.parseEther("10"),
      currentLeafIndex: 0n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };
    bob = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: bobSigner,
      depositAmount: ethers.parseEther("20"),
      currentLeafIndex: 1n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };
    charlie = {
      lastUsedNullifier: randomBigInt(1000000n),
      secret: randomBigInt(1000000n),
      signer: charlieSigner,
      depositAmount: ethers.parseEther("30"),
      currentLeafIndex: 2n,
      receiverSecret: randomBigInt(1000000n),
      claimableNoteNonces: [],
    };

    mockToken = await (await ethers.getContractFactory("MockERC20", aliceSigner)).deploy(
      "MockERC20",
      "MockERC20",
      18
    );
    await mockToken.waitForDeployment();

    // create pool for mock token
    await entryPoint.createPool(mockToken.target);

    tokenPool = await ethers.getContractAt(
      "TokenPool",
      await entryPoint.assetToPool(mockToken.target)
    );

    await mockToken.mint(alice.signer!.address, ethers.parseEther("100"));
    await mockToken.mint(bob.signer!.address, ethers.parseEther("100"));
    await mockToken.mint(charlie.signer!.address, ethers.parseEther("100"));
  });

  it("Happy Flow - Alice Bob Charlier Deposit", async function () {

    for (const actor of [alice, bob, charlie]) {
      await mockToken.connect(actor.signer).approve(entryPoint.target, actor.depositAmount);
      await entryPoint.connect(actor.signer).deposit(mockToken.target, actor.depositAmount, (
        await generate_precommitment(actor.lastUsedNullifier, actor.secret)
      ).toString());
      
      
      actor.currentLeafIndex = BigInt(tsTree.getNextLeafIndex());
      tsTree.insert(
        await calculateSolidityCommitment(
          actor.lastUsedNullifier,
          actor.secret,
          actor.depositAmount,
          mockToken.target.toString()
        )
      );
    }
      

    expect(await tokenPool.currentRoot()).to.equal(tsTree.getRoot().toString());
    expect(await tokenPool.nextLeafIndex()).to.equal(3);

    expect(await tokenPool.getLeaf(alice.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          alice.lastUsedNullifier,
          alice.secret,
          alice.depositAmount,
          mockToken.target.toString()
        )
      ).toString()
    );
    expect(await tokenPool.getLeaf(bob.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          bob.lastUsedNullifier,
          bob.secret,
          bob.depositAmount,
          mockToken.target.toString()
        )
      ).toString()
    );
    expect(await tokenPool.getLeaf(charlie.currentLeafIndex)).to.equal(
      (
        await calculateSolidityCommitment(
          charlie.lastUsedNullifier,
          charlie.secret,
          charlie.depositAmount,
          mockToken.target.toString()
        )
      ).toString()
    );

    expect(await tokenPool.getPath(alice.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(alice.currentLeafIndex)).map((x) => x.toString())
    );
    expect(await tokenPool.getPath(bob.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(bob.currentLeafIndex)).map((x) => x.toString())
    );
    expect(await tokenPool.getPath(charlie.currentLeafIndex)).to.deep.equal(
      tsTree.getPath(Number(charlie.currentLeafIndex)).map((x) => x.toString())
    );
  });


})