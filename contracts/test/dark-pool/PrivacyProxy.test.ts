import { ethers } from "hardhat";
import { expect } from "chai";
import {
  TokenPool,
  ClearingHouseV2,
  MockERC20,
  Oracle,
  WithdrawTransferHonkVerifier,
  ClaimHonkVerifier,
  PrivacyProxy,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { EventLog, hashMessage, HDNodeWallet, Log, randomBytes } from "ethers";
import { LeanIMT } from "./test_utils/leanIMT";
import {
  calculateSolidityCommitment,
  generate_precommitment,
} from "./utils/utils";
import {
  generateClaimProof,
  generateWithdrawTransferProof,
} from "./utils/proofGeneration";
import { Fr } from "@aztec/bb.js";
import { poseidon2Hash } from "@aztec/foundation/crypto";

const MAX_TREE_DEPTH = 32;
const parseUSDC = (amount: string) => ethers.parseUnits(amount, 18);

describe("PrivacyProxy & Dark Pool Integration Tests", function () {
  // --- Signers ---
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner; // Our main private user
  let bob: HardhatEthersSigner; // A second user
  let entryPoint: HardhatEthersSigner; // Mock EntryPoint for TokenPool

  // --- Contracts ---
  let usdcToken: MockERC20;
  let oracle: Oracle;
  let tokenPool: TokenPool;
  let clearingHouse: ClearingHouseV2;
  let privacyProxy: PrivacyProxy;

  // --- ZK Verifiers ---
  let withdrawVerifier: WithdrawTransferHonkVerifier;
  let claimVerifier: ClaimHonkVerifier;

  // --- User-specific variables for Alice ---
  let aliceDarkPoolSecret: HDNodeWallet; // A wallet to represent her "secret"
  let alicePubKey: string; // Her public key for the proxy

  // --- Test Helpers ---
  let tsTree: LeanIMT;

  beforeEach(async function () {
    // 1. Get Signers
    [deployer, alice, bob, entryPoint] = await ethers.getSigners();

    // 2. Setup Alice's private identity
    aliceDarkPoolSecret = ethers.Wallet.createRandom(); // This wallet's private key is her "secret"
    // For our simplified signature check, the "public key" is the hash of the address
    alicePubKey = ethers.solidityPackedKeccak256(
      ["address"],
      [aliceDarkPoolSecret.address]
    );

    // 3. Deploy ZK Verifiers
    const WithdrawVerifierFactory = await ethers.getContractFactory(
      "WithdrawTransferHonkVerifier",
      deployer
    );
    withdrawVerifier = await WithdrawVerifierFactory.deploy();
    const ClaimVerifierFactory = await ethers.getContractFactory(
      "ClaimHonkVerifier",
      deployer
    );
    claimVerifier = await ClaimVerifierFactory.deploy();
    const Poseidon2Factory = await ethers.getContractFactory(
      "Poseidon2",
      deployer
    );
    const poseidon2 = await Poseidon2Factory.deploy();

    // 4. Deploy Core Contracts
    const MockERC20Factory = await ethers.getContractFactory(
      "MockERC20",
      deployer
    );
    usdcToken = await MockERC20Factory.deploy("USD Coin", "USDC");
    const OracleFactory = await ethers.getContractFactory("Oracle", deployer);
    oracle = await OracleFactory.deploy(parseUSDC("100000"));

    // 5. Deploy V2 Contracts
    const TokenPoolFactory = await ethers.getContractFactory("TokenPool", {
      libraries: { Poseidon2: await poseidon2.getAddress() },
    });
    tokenPool = await TokenPoolFactory.deploy(
      entryPoint.address,
      await usdcToken.getAddress(),
      await withdrawVerifier.getAddress(),
      await claimVerifier.getAddress(),
      MAX_TREE_DEPTH
    );

    const ClearingHouseV2Factory = await ethers.getContractFactory(
      "ClearingHouseV2",
      deployer
    );
    clearingHouse = await ClearingHouseV2Factory.deploy(
      await oracle.getAddress(),
      await usdcToken.getAddress()
    );

    // 6. Deploy the PrivacyProxy
    const PrivacyProxyFactory = await ethers.getContractFactory(
      "PrivacyProxy",
      deployer
    );
    privacyProxy = await PrivacyProxyFactory.deploy(
      await clearingHouse.getAddress(),
      await tokenPool.getAddress()
    );

    // 7. Grant MINTER_ROLE to ClearingHouse
    const MINTER_ROLE = await usdcToken.MINTER_ROLE();
    await usdcToken.grantRole(MINTER_ROLE, await clearingHouse.getAddress());

    // 8. Mint initial funds for Alice's EOA and Bob's EOA
    await usdcToken.mint(alice.address, parseUSDC("10000"));
    await usdcToken.mint(bob.address, parseUSDC("10000"));

    // 9. Initialize Merkle Tree
    tsTree = new LeanIMT(MAX_TREE_DEPTH);
  });

  // =================================================================================================
  // == SCENARIO 1: COLLATERAL MANAGEMENT VIA PROXY
  // =================================================================================================
  describe("Scenario 1: Collateral Management", function () {
    it("should allow Alice to deposit collateral directly from her EOA", async function () {
      const depositAmount = parseUSDC("1000");
      // Alice approves the proxy to spend her USDC
      await usdcToken
        .connect(alice)
        .approve(await privacyProxy.getAddress(), depositAmount);

      // Alice calls the proxy, identifying herself with her public key
      await privacyProxy
        .connect(alice)
        .depositCollateralFromEOA(alicePubKey, depositAmount);

      // Verify state changes
      // 1. ClearingHouse now holds the collateral (owned by the proxy)
      expect(
        await clearingHouse.freeCollateral(await privacyProxy.getAddress())
      ).to.equal(depositAmount);
      // 2. Proxy now tracks this collateral for Alice's private account
      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        depositAmount
      );
    });

    it("should allow Alice to deposit collateral from her private TokenPool balance", async function () {
      // Step A: Alice first deposits into the TokenPool to get a private balance
      const darkPoolDepositAmount = parseUSDC("5000");
      const aliceInitialCommitment = {
        value: darkPoolDepositAmount,
        nullifier: 123n,
        secret: 456n,
      };
      const precommitment = await generate_precommitment(
        aliceInitialCommitment.nullifier,
        aliceInitialCommitment.secret
      );
      const commitment = await calculateSolidityCommitment(
        aliceInitialCommitment.nullifier,
        aliceInitialCommitment.secret,
        aliceInitialCommitment.value,
        await usdcToken.getAddress()
      );
      await tsTree.insert(commitment);

      await usdcToken
        .connect(alice)
        .approve(await tokenPool.getAddress(), darkPoolDepositAmount);
      await tokenPool
        .connect(alice)
        .deposit(darkPoolDepositAmount, precommitment.toString());

      // Step B: Alice generates a ZK proof to withdraw/approve funds for the proxy
      const withdrawalAmount = parseUSDC("2000");
      const remainingValue = darkPoolDepositAmount - withdrawalAmount;
      const aliceNewCommitment = { nullifier: 789n, secret: 101n };
      const newCommitmentProof = await calculateSolidityCommitment(
        aliceNewCommitment.nullifier,
        aliceNewCommitment.secret,
        remainingValue,
        await usdcToken.getAddress()
      );

      const { proof, publicInputs } = await generateWithdrawTransferProof(
        aliceInitialCommitment.nullifier.toString(),
        aliceInitialCommitment.secret.toString(),
        aliceInitialCommitment.value.toString(),
        await usdcToken.getAddress(),
        "0", // leafIndex
        tsTree.getRoot().toString(),
        aliceNewCommitment.nullifier.toString(),
        aliceNewCommitment.secret.toString(),
        withdrawalAmount.toString(),
        tsTree.getPath(0).map((x) => x.toString())
      );

      // Step C: Alice calls the PrivacyProxy, which will in turn call the TokenPool
      // The proxy acts as the msg.sender to the TokenPool
      await privacyProxy
        .connect(alice)
        .depositCollateralFromDarkPool(alicePubKey, {
          honkProof: proof,
          publicInputs,
        });

      // Verify state changes
      // 1. Proxy's internal balance for Alice is credited
      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        withdrawalAmount
      );
      // 2. ClearingHouse now holds the collateral for the proxy's account
      expect(
        await clearingHouse.freeCollateral(await privacyProxy.getAddress())
      ).to.equal(withdrawalAmount);
      // 3. TokenPool's balance should have decreased
      expect(await usdcToken.balanceOf(await tokenPool.getAddress())).to.equal(
        remainingValue
      );
    });

    it("should allow Alice to withdraw collateral back to the TokenPool as a private note", async function () {
      // Step A: Alice deposits from her EOA first to fund her proxy account
      const depositAmount = parseUSDC("3000");
      await usdcToken
        .connect(alice)
        .approve(await privacyProxy.getAddress(), depositAmount);
      await privacyProxy
        .connect(alice)
        .depositCollateralFromEOA(alicePubKey, depositAmount);
      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        depositAmount
      );

      // Step B: Alice wants to withdraw 1000 USDC back to the dark pool.
      // She generates a receiver hash for herself.
      const withdrawAmount = parseUSDC("1000");
      const aliceReceiverSecret = 999n;
      const aliceReceiverHash = ethers.solidityPackedKeccak256(
        ["uint256"],
        [aliceReceiverSecret]
      );

      // Step C: Alice signs a message authorizing this withdrawal with her dark pool secret key
      const messageHash = ethers.solidityPackedKeccak256(
        ["string", "uint256", "bytes32"],
        ["WITHDRAW_COLLATERAL", withdrawAmount, aliceReceiverHash]
      );
      const signature = await aliceDarkPoolSecret.signMessage(
        ethers.getBytes(messageHash)
      );

      const initialProxyBalanceInCH = await clearingHouse.freeCollateral(
        await privacyProxy.getAddress()
      );

      // Step D: Alice calls the proxy to execute the withdrawal
      await expect(
        privacyProxy
          .connect(alice)
          .withdrawCollateralToDarkPool(
            alicePubKey,
            withdrawAmount,
            aliceReceiverHash,
            signature
          )
      ).to.emit(tokenPool, "NoteCreated");

      // Verify state changes
      // 1. Alice's internal collateral in the proxy is debited
      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        depositAmount - withdrawAmount
      );
      // 2. The proxy's free collateral in the ClearingHouse is reduced
      expect(
        await clearingHouse.freeCollateral(await privacyProxy.getAddress())
      ).to.equal(initialProxyBalanceInCH - withdrawAmount);
      // 3. The TokenPool now holds the withdrawn funds
      expect(await usdcToken.balanceOf(await tokenPool.getAddress())).to.equal(
        withdrawAmount
      );

      // 4. A new note should exist in the TokenPool
      const noteNonce = 0; // First note
      const noteId = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [await usdcToken.getAddress(), noteNonce]
      );
      const note = await tokenPool.notes(noteId);
      expect(note.value).to.equal(withdrawAmount);
      expect(note.receiverHash).to.equal(aliceReceiverHash);
    });
  });
  describe("Scenario 2: Private Trading and Position Management", function () {
    let positionId: string;

    beforeEach(async function () {
      // Alice deposits 2000 USDC from her EOA to fund her private trading account
      const depositAmount = parseUSDC("2000");
      await usdcToken
        .connect(alice)
        .approve(await privacyProxy.getAddress(), depositAmount);
      await privacyProxy
        .connect(alice)
        .depositCollateralFromEOA(alicePubKey, depositAmount);

      // Generate a unique ID for her position
      positionId = ethers.hexlify(randomBytes(32));
    });

    it("should allow Alice to open a position with a valid signature", async function () {
      const margin = parseUSDC("500");
      const leverage = 10n * 100n; // 10x
      const isLong = true;

      // Alice signs the message to authorize opening the position
      const messageHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "uint256", "uint256", "bool"],
        ["OPEN_POSITION", positionId, margin, leverage, isLong]
      );
      const signature = await aliceDarkPoolSecret.signMessage(
        ethers.getBytes(messageHash)
      );

      // Alice (or a relayer) submits the transaction to the proxy
      await privacyProxy
        .connect(alice)
        .openPosition(
          alicePubKey,
          positionId,
          margin,
          leverage,
          isLong,
          signature
        );

      // Verify state changes
      // 1. The position should now exist in the ClearingHouse, owned by the proxy
      const position = await clearingHouse.positions(positionId);
      expect(position.owner).to.equal(await privacyProxy.getAddress());
      expect(position.size).to.be.gt(0);

      // 2. The proxy should record Alice as the owner of this positionId
      expect(await privacyProxy.positionOwner(positionId)).to.equal(
        alicePubKey
      );

      // 3. Alice's free collateral within the proxy should be debited
      const expectedFreeCollateral = parseUSDC("2000") - margin;
      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        expectedFreeCollateral
      );
    });

    it("should REVERT if Bob tries to open a position using Alice's pubKey but his own signature", async function () {
      const margin = parseUSDC("500");
      const leverage = 10n * 100n;
      const isLong = true;

      // Bob creates the message hash, but for Alice's pubKey
      const messageHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "uint256", "uint256", "bool"],
        ["OPEN_POSITION", positionId, margin, leverage, isLong]
      );

      // Bob signs with HIS secret, not Alice's
      const bobSecret = ethers.Wallet.createRandom();
      const signature = await bobSecret.signMessage(
        ethers.getBytes(messageHash)
      );

      // Bob tries to open the position, pretending to be Alice
      await expect(
        privacyProxy
          .connect(bob)
          .openPosition(
            alicePubKey,
            positionId,
            margin,
            leverage,
            isLong,
            signature
          )
      ).to.be.revertedWithCustomError(privacyProxy, "InvalidSignature");
    });

    it("should allow Alice to add and remove margin from her open position", async function () {
      // First, open the position
      const margin = parseUSDC("500");
      const openMessageHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "uint256", "uint256", "bool"],
        ["OPEN_POSITION", positionId, margin, 1000n, true]
      );
      const openSignature = await aliceDarkPoolSecret.signMessage(
        ethers.getBytes(openMessageHash)
      );
      await privacyProxy
        .connect(alice)
        .openPosition(
          alicePubKey,
          positionId,
          margin,
          1000n,
          true,
          openSignature
        );

      const positionBefore = await clearingHouse.positions(positionId);

      // --- Add Margin ---
      const marginToAdd = parseUSDC("200");
      const addMessageHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["ADD_MARGIN", positionId]
      );
      const addSignature = await aliceDarkPoolSecret.signMessage(
        ethers.getBytes(addMessageHash)
      );

      await privacyProxy
        .connect(alice)
        .addMargin(positionId, marginToAdd, addSignature);
      const positionAfterAdd = await clearingHouse.positions(positionId);
      expect(positionAfterAdd.margin).to.equal(
        positionBefore.margin + marginToAdd
      );

      // --- Remove Margin ---
      const marginToRemove = parseUSDC("100");
      const removeMessageHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["REMOVE_MARGIN", positionId]
      );
      const removeSignature = await aliceDarkPoolSecret.signMessage(
        ethers.getBytes(removeMessageHash)
      );

      await privacyProxy
        .connect(alice)
        .removeMargin(positionId, marginToRemove, removeSignature);
      const positionAfterRemove = await clearingHouse.positions(positionId);
      expect(positionAfterRemove.margin).to.equal(
        positionAfterAdd.margin - marginToRemove
      );

      // Check that the removed margin was credited back to Alice's free collateral in the proxy
      const expectedFreeCollateral =
        parseUSDC("2000") - margin - marginToAdd + marginToRemove;
      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        expectedFreeCollateral
      );
    });

    it("should allow Alice to close her position", async function () {
      // Open the position
      const margin = parseUSDC("500");
      const openMessageHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "uint256", "uint256", "bool"],
        ["OPEN_POSITION", positionId, margin, 1000n, true]
      );
      const openSignature = await aliceDarkPoolSecret.signMessage(
        ethers.getBytes(openMessageHash)
      );
      await privacyProxy
        .connect(alice)
        .openPosition(
          alicePubKey,
          positionId,
          margin,
          1000n,
          true,
          openSignature
        );

      // Price moves slightly in her favor
      await oracle.setPrice(parseUSDC("101000"));

      const collateralBeforeClose = await privacyProxy.userFreeCollateral(
        alicePubKey
      );

      // Alice signs the close message
      const closeMessageHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["CLOSE_POSITION", positionId]
      );
      const closeSignature = await aliceDarkPoolSecret.signMessage(
        ethers.getBytes(closeMessageHash)
      );

      await privacyProxy
        .connect(alice)
        .closePosition(positionId, closeSignature);

      // Verify state
      // 1. The position should be deleted from the ClearingHouse
      const positionAfter = await clearingHouse.positions(positionId);
      expect(positionAfter.owner).to.equal(ethers.ZeroAddress);

      // 2. The position ownership should be deleted from the proxy
      expect(await privacyProxy.positionOwner(positionId)).to.equal(
        ethers.ZeroHash
      );
    });
  });

  // =================================================================================================
  // == SCENARIO 3: FULL END-TO-END USER JOURNEY (ALICE VS BOB)
  // =================================================================================================
  describe("Scenario 3: Full End-to-End User Journey", function () {
    // --- User Identities ---
    let bobDarkPoolSecret: HDNodeWallet;
    let bobPubKey: string;

    // --- Position IDs ---
    let aliceLongPosId: string;
    let aliceShortPosId: string; // Alice will manage multiple positions
    let bobShortPosId: string;

    // --- ZK Note/Claim variables ---
    let bobReceiverHash: string;
    let bobClaimNoteNonce: bigint;

    beforeEach(async function () {
      // Setup Bob's identity
      bobDarkPoolSecret = HDNodeWallet.createRandom();
      bobPubKey = ethers.solidityPackedKeccak256(
        ["address"],
        [bobDarkPoolSecret.address]
      );

      // Generate position IDs
      aliceLongPosId = ethers.hexlify(randomBytes(32));
      aliceShortPosId = ethers.hexlify(randomBytes(32));
      bobShortPosId = ethers.hexlify(randomBytes(32));
    });

    it("should handle the full lifecycle: Dark Pool -> Trade -> Settle -> Withdraw", async function () {
      // =================================================
      // STEP 1: Both users deposit into the TokenPoolV2
      // =================================================
      console.log("    Step 1: Alice and Bob enter the Dark Pool...");
      // Alice deposits 5000 USDC
      const aliceDPDeposit = parseUSDC("5000");
      const aliceDPCommitment = {
        value: aliceDPDeposit,
        nullifier: 111n,
        secret: 222n,
      };
      await usdcToken
        .connect(alice)
        .approve(await tokenPool.getAddress(), aliceDPDeposit);
      await tokenPool
        .connect(alice)
        .deposit(
          aliceDPDeposit,
          (
            await generate_precommitment(
              aliceDPCommitment.nullifier,
              aliceDPCommitment.secret
            )
          ).toString()
        );
      await tsTree.insert(
        await calculateSolidityCommitment(
          aliceDPCommitment.nullifier,
          aliceDPCommitment.secret,
          aliceDPCommitment.value,
          await usdcToken.getAddress()
        )
      );

      // Bob deposits 5000 USDC
      const bobDPDeposit = parseUSDC("5000");
      const bobDPCommitment = {
        value: bobDPDeposit,
        nullifier: 333n,
        secret: 444n,
      };
      await usdcToken
        .connect(bob)
        .approve(await tokenPool.getAddress(), bobDPDeposit);
      await tokenPool
        .connect(bob)
        .deposit(
          bobDPDeposit,
          (
            await generate_precommitment(
              bobDPCommitment.nullifier,
              bobDPCommitment.secret
            )
          ).toString()
        );
      await tsTree.insert(
        await calculateSolidityCommitment(
          bobDPCommitment.nullifier,
          bobDPCommitment.secret,
          bobDPCommitment.value,
          await usdcToken.getAddress()
        )
      );
      expect(await tokenPool.nextLeafIndex()).to.equal(2);

      // ============================================================
      // STEP 2: Both users move collateral from Dark Pool to Proxy
      // ============================================================
      console.log(
        "    Step 2: Alice and Bob fund their private trading accounts..."
      );
      // Alice moves 2000 USDC
      const aliceCollateral = parseUSDC("2000");
      const aliceRemainingDP = aliceDPDeposit - aliceCollateral;
      const aliceNewDPCommitment = { nullifier: 555n, secret: 666n };
      const { proof: aliceProof, publicInputs: alicePI } =
        await generateWithdrawTransferProof(
          aliceDPCommitment.nullifier.toString(),
          aliceDPCommitment.secret.toString(),
          aliceDPCommitment.value.toString(),
          await usdcToken.getAddress(),
          "0",
          tsTree.getRoot().toString(),
          aliceNewDPCommitment.nullifier.toString(),
          aliceNewDPCommitment.secret.toString(),
          aliceCollateral.toString(),
          tsTree.getPath(0).map((x) => x.toString())
        );

      await privacyProxy
        .connect(alice)
        .depositCollateralFromDarkPool(alicePubKey, {
          honkProof: aliceProof,
          publicInputs: alicePI,
        });
      await tsTree.insert(
        await calculateSolidityCommitment(
          aliceNewDPCommitment.nullifier,
          aliceNewDPCommitment.secret,
          aliceRemainingDP,
          await usdcToken.getAddress()
        )
      );

      // Bob moves 2000 USDC
      const bobCollateral = parseUSDC("2000");
      const bobRemainingDP = bobDPDeposit - bobCollateral;
      const bobNewDPCommitment = { nullifier: 777n, secret: 888n };
      const { proof: bobProof, publicInputs: bobPI } =
        await generateWithdrawTransferProof(
          bobDPCommitment.nullifier.toString(),
          bobDPCommitment.secret.toString(),
          bobDPCommitment.value.toString(),
          await usdcToken.getAddress(),
          "1",
          tsTree.getRoot().toString(),
          bobNewDPCommitment.nullifier.toString(),
          bobNewDPCommitment.secret.toString(),
          bobCollateral.toString(),
          tsTree.getPath(1).map((x) => x.toString())
        );
      await privacyProxy.connect(bob).depositCollateralFromDarkPool(bobPubKey, {
        honkProof: bobProof,
        publicInputs: bobPI,
      });
      await tsTree.insert(
        await calculateSolidityCommitment(
          bobNewDPCommitment.nullifier,
          bobNewDPCommitment.secret,
          bobRemainingDP,
          await usdcToken.getAddress()
        )
      );


      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        aliceCollateral
      );
      expect(await privacyProxy.userFreeCollateral(bobPubKey)).to.equal(
        bobCollateral
      );

      // ============================================================
      // STEP 3: Alice opens TWO positions, Bob opens ONE
      // ============================================================
      console.log("    Step 3: Alice opens two positions, Bob opens one...");
      // Alice opens a 10x LONG with 800 USDC
      const aliceLongMargin = parseUSDC("800");
      const aliceLongLeverage = 10n * 100n;
      let msgHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "uint256", "uint256", "bool"],
        [
          "OPEN_POSITION",
          aliceLongPosId,
          aliceLongMargin,
          aliceLongLeverage,
          true,
        ]
      );
      let sig = await aliceDarkPoolSecret.signMessage(ethers.getBytes(msgHash));
      await privacyProxy
        .connect(alice)
        .openPosition(
          alicePubKey,
          aliceLongPosId,
          aliceLongMargin,
          aliceLongLeverage,
          true,
          sig
        );

      // Alice opens a 5x SHORT with 400 USDC
      const aliceShortMargin = parseUSDC("400");
      const aliceShortLeverage = 5n * 100n;
      msgHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "uint256", "uint256", "bool"],
        [
          "OPEN_POSITION",
          aliceShortPosId,
          aliceShortMargin,
          aliceShortLeverage,
          false,
        ]
      );
      sig = await aliceDarkPoolSecret.signMessage(ethers.getBytes(msgHash));
      await privacyProxy
        .connect(alice)
        .openPosition(
          alicePubKey,
          aliceShortPosId,
          aliceShortMargin,
          aliceShortLeverage,
          false,
          sig
        );

      // Bob opens a 10x SHORT with 1000 USDC
      const bobShortMargin = parseUSDC("1000");
      const bobShortLeverage = 10n * 100n;
      msgHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "uint256", "uint256", "bool"],
        [
          "OPEN_POSITION",
          bobShortPosId,
          bobShortMargin,
          bobShortLeverage,
          false,
        ]
      );
      sig = await bobDarkPoolSecret.signMessage(ethers.getBytes(msgHash));
      await privacyProxy
        .connect(bob)
        .openPosition(
          bobPubKey,
          bobShortPosId,
          bobShortMargin,
          bobShortLeverage,
          false,
          sig
        );

      expect((await clearingHouse.positions(aliceLongPosId)).owner).to.equal(
        await privacyProxy.getAddress()
      );
      expect((await clearingHouse.positions(aliceShortPosId)).owner).to.equal(
        await privacyProxy.getAddress()
      );
      expect((await clearingHouse.positions(bobShortPosId)).owner).to.equal(
        await privacyProxy.getAddress()
      );
      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(
        parseUSDC("800")
      ); // 2000 - 800 - 400
      expect(await privacyProxy.userFreeCollateral(bobPubKey)).to.equal(
        parseUSDC("1000")
      ); // 2000 - 1000

      // ============================================================
      // STEP 4: Price moves DOWN. Alice's LONG loses, her SHORT wins. Bob's SHORT wins.
      // ============================================================
      console.log("    Step 4: Price moves down, creating PnL...");
      await oracle.setPrice(parseUSDC("95000")); // 5% drop from 100k

      const aliceCollateralBeforeClose = await privacyProxy.userFreeCollateral(
        alicePubKey
      ); // 800
      const bobCollateralBeforeClose = await privacyProxy.userFreeCollateral(
        bobPubKey
      ); // 1000

      // Let's get a snapshot of the PnL for our assertions later
      const [aliceLongPnl] = await clearingHouse.calculatePnl(aliceLongPosId);
      const [aliceShortPnl] = await clearingHouse.calculatePnl(aliceShortPosId);
      const [bobShortPnl] = await clearingHouse.calculatePnl(bobShortPosId);

      expect(aliceLongPnl).to.be.lt(0); // Alice's long position has a loss
      expect(aliceShortPnl).to.be.gt(0); // Alice's short position has a profit
      expect(bobShortPnl).to.be.gt(0); // Bob's short position has a profit

      // ============================================================
      // STEP 5: All users close their positions via the PrivacyProxy.
      // ============================================================
      console.log(
        "    Step 5: All users close positions, PnL is reconciled automatically..."
      );

      // Close Alice's profitable short position
      msgHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["CLOSE_POSITION", aliceShortPosId]
      );
      sig = await aliceDarkPoolSecret.signMessage(ethers.getBytes(msgHash));
      await privacyProxy.connect(alice).closePosition(aliceShortPosId, sig);

      // Close Alice's losing long position
      msgHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["CLOSE_POSITION", aliceLongPosId]
      );
      sig = await aliceDarkPoolSecret.signMessage(ethers.getBytes(msgHash));
      await privacyProxy.connect(alice).closePosition(aliceLongPosId, sig);

      // Close Bob's profitable short position
      msgHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["CLOSE_POSITION", bobShortPosId]
      );
      sig = await bobDarkPoolSecret.signMessage(ethers.getBytes(msgHash));
      await privacyProxy.connect(bob).closePosition(bobShortPosId, sig);

      // Verify that all positions are now deleted from the ClearingHouse and the Proxy
      expect((await clearingHouse.positions(aliceLongPosId)).owner).to.equal(
        ethers.ZeroAddress
      );
      expect((await clearingHouse.positions(aliceShortPosId)).owner).to.equal(
        ethers.ZeroAddress
      );
      expect((await clearingHouse.positions(bobShortPosId)).owner).to.equal(
        ethers.ZeroAddress
      );
      expect(await privacyProxy.positionOwner(aliceLongPosId)).to.equal(
        ethers.ZeroHash
      );
      expect(await privacyProxy.positionOwner(aliceShortPosId)).to.equal(
        ethers.ZeroHash
      );
      expect(await privacyProxy.positionOwner(bobShortPosId)).to.equal(
        ethers.ZeroHash
      );

      // Verify final collateral balances in the proxy. The proxy should have automatically credited the returned amounts.
      let aliceCollateralAfterClose = await privacyProxy.userFreeCollateral(
        alicePubKey
      );
      const bobCollateralAfterClose = await privacyProxy.userFreeCollateral(
        bobPubKey
      );

      expect(aliceCollateralAfterClose).to.gt(aliceCollateralBeforeClose);
      expect(bobCollateralAfterClose).to.gt(bobCollateralBeforeClose);

      // Alice's final balance = Initial Free Collateral + Return from Long (Loss) + Return from Short (Profit)
      // We check that the final balance reflects the net outcome of her trades.
      // Her total PnL is aliceLongPnl + aliceShortPnl. Her starting collateral was 2000.
      const expectedAliceFinal =
        parseUSDC("2000") + aliceLongPnl + aliceShortPnl; // Ignoring fees for test simplicity
      expect(aliceCollateralAfterClose).to.be.closeTo(
        expectedAliceFinal,
        parseUSDC("20")
      ); // Allow tolerance for fees

      // Bob's final balance = Initial Free Collateral + Return from Short (Profit)
      const expectedBobFinal = parseUSDC("2000") + bobShortPnl; // Ignoring fees
      expect(bobCollateralAfterClose).to.be.closeTo(
        expectedBobFinal,
        parseUSDC("20")
      );

      // ============================================================
      // STEP 6: Alice withdraws her final balance back to the Dark Pool as a note
      // ============================================================
      console.log(
        "    Step 6: Alice withdraws her trading profits back to the Dark Pool as a private note..."
      );

      aliceCollateralAfterClose = await privacyProxy.userFreeCollateral(
        alicePubKey
      );
      let aliceReceiverSecret = 12345_2n; // Alice's secret to claim the note
      let tries = 0;
      while (
        BigInt(
          ethers.solidityPackedKeccak256(["uint256"], [aliceReceiverSecret])
        ) > Fr.MODULUS
      ) {
        aliceReceiverSecret++;
        tries++;
      }
      
      const aliceReceiverHash = await poseidon2Hash([aliceReceiverSecret]);

      msgHash = ethers.solidityPackedKeccak256(
        ["string", "uint256", "bytes32"],
        ["WITHDRAW_COLLATERAL", aliceCollateralAfterClose, aliceReceiverHash.toString()]
      );
      sig = await aliceDarkPoolSecret.signMessage(ethers.getBytes(msgHash));

      const tx = await privacyProxy
        .connect(alice)
        .withdrawCollateralToDarkPool(
          alicePubKey,
          aliceCollateralAfterClose,
          aliceReceiverHash.toString(),
          sig
        );

      const receipt = await tx.wait();
      // console.log("receipt?.logs: ", receipt?.logs);

      const noteCreatedLog = receipt?.logs?.find((log) => {
        // The first topic is the event signature
        return (
          log.topics[0] === ethers.id("NoteCreated(bytes32,uint256,uint256)")
        );
      });

      expect(noteCreatedLog).to.not.be.undefined;

      // 2. Parse the log using the tokenPool's interface
      const tokenPoolInterface = tokenPool.interface;
      const parsedNoteCreatedLog = tokenPoolInterface.parseLog({
        data: noteCreatedLog!.data,
        topics: noteCreatedLog!.topics.map((topic) => topic.toString()),
      });

      const aliceClaimNoteNonce = parsedNoteCreatedLog!.args[2];

      expect(await privacyProxy.userFreeCollateral(alicePubKey)).to.equal(0);

      // ============================================================
      // STEP 7: Alice CLAIMS her note, merging it with her existing private funds
      // ============================================================
      console.log(
        "    Step 7: Alice claims her profit note to consolidate her private balance..."
      );

      // Alice's existing commitment in the dark pool is her `aliceNewDPCommitment` from Step 2.
      // Her new balance will be the sum of her remaining funds AND the note she just created.
      const consolidatedValue = aliceRemainingDP + aliceCollateralAfterClose;
      const aliceConsolidatedCommitment = { nullifier: 2020n, secret: 2121n };

      const currentRootAfterProxyDeposits = await tokenPool.currentRoot();
      expect(currentRootAfterProxyDeposits).to.equal(
        tsTree.getRoot().toString()
      );
      const aliceExistingLeafIndex = 2; // Her commitment from Step 2 was the 3rd leaf

      
      const { proof: claimProof, publicInputs: claimPI } =
        await generateClaimProof(
          aliceClaimNoteNonce.toString(),
          aliceCollateralAfterClose.toString(),
          aliceNewDPCommitment.nullifier.toString(),
          aliceNewDPCommitment.secret.toString(),
          aliceRemainingDP.toString(),
          await usdcToken.getAddress(),
          aliceExistingLeafIndex.toString(),
          currentRootAfterProxyDeposits,
          aliceConsolidatedCommitment.nullifier.toString(),
          aliceConsolidatedCommitment.secret.toString(),
          aliceReceiverSecret.toString(),
          aliceReceiverHash.toString(),
          tsTree.getPath(aliceExistingLeafIndex).map((x) => x.toString())
        );

      await tokenPool
        .connect(alice)
        .claim({ honkProof: claimProof, publicInputs: claimPI });

      // Update our local tree to match the on-chain state
      await tsTree.insert(
        await calculateSolidityCommitment(
          aliceConsolidatedCommitment.nullifier,
          aliceConsolidatedCommitment.secret,
          consolidatedValue,
          await usdcToken.getAddress()
        )
      );

      expect(await tokenPool.currentRoot()).to.equal(
        tsTree.getRoot().toString()
      );

      // ======================================================================
      // STEP 8: Alice withdraws her FULL consolidated funds from the Dark Pool to her EOA
      // ======================================================================
      console.log(
        "    Step 8: Alice withdraws her full consolidated balance to her EOA..."
      );

      const aliceFinalWithdrawAmount = consolidatedValue;
      const aliceFinalNewCommitment = {
        nullifier: 3030n,
        secret: 3131n,
        value: 0n,
      }; // Final commitment has 0 value

      const finalRoot = await tokenPool.currentRoot();
      const aliceConsolidatedLeafIndex =
        Number(await tokenPool.nextLeafIndex()) - 1;

      const { proof: finalProof, publicInputs: finalPI } =
        await generateWithdrawTransferProof(
          aliceConsolidatedCommitment.nullifier.toString(),
          aliceConsolidatedCommitment.secret.toString(),
          consolidatedValue.toString(),
          await usdcToken.getAddress(),
          aliceConsolidatedLeafIndex.toString(),
          finalRoot,
          aliceFinalNewCommitment.nullifier.toString(),
          aliceFinalNewCommitment.secret.toString(),
          aliceFinalWithdrawAmount.toString(),
          tsTree.getPath(aliceConsolidatedLeafIndex).map((x) => x.toString())
        );

      const aliceEOABalanceBefore = await usdcToken.balanceOf(alice.address);

      await tokenPool
        .connect(alice)
        .withdraw(alice.address, {
          honkProof: finalProof,
          publicInputs: finalPI,
        });

      const aliceEOABalanceAfter = await usdcToken.balanceOf(alice.address);

      // The final balance should be the starting EOA balance + the full consolidated amount
      expect(aliceEOABalanceAfter).to.equal(
        aliceEOABalanceBefore + aliceFinalWithdrawAmount
      );

      console.log("    ✅ Full lifecycle test completed successfully!");
    });
  });
});
