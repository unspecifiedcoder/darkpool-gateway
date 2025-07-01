// test/ClearingHouse.test.ts
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ClearingHouse, ClearingHouse__factory, MockERC20, MockERC20__factory, Oracle, Oracle__factory } from "../../typechain-types";

// Helper function to parse units correctly
const parseUSDC = (amount: string) => ethers.parseUnits(amount, 18);
const parsePrice = (amount: string) => ethers.parseUnits(amount, 18);

describe("ClearingHouse Contract Tests", function () {
    // Actors
    let deployer: HardhatEthersSigner;
    let alice: HardhatEthersSigner;
    let bob: HardhatEthersSigner;
    let charlie: HardhatEthersSigner;
    let david: HardhatEthersSigner; // The liquidator

    // Contracts
    let usdcToken: MockERC20;
    let oracle: Oracle;
    let clearingHouse: ClearingHouse;

    // Constants
    const INITIAL_USDC_MINT = parseUSDC("100000");
    const INITIAL_BTC_PRICE = parsePrice("50000"); // $50,000
    const LEVERAGE = 10n * 100n; // 10x leverage (leverage is scaled by 100)

    beforeEach(async function () {
        // 1. Get signers
        [deployer, alice, bob, charlie, david] = await ethers.getSigners();

        // 2. Deploy MockERC20 for USDC
        const MockERC20Factory = (await ethers.getContractFactory("MockERC20", deployer)) as MockERC20__factory;
        usdcToken = await MockERC20Factory.deploy("USD Coin", "USDC");
        await usdcToken.waitForDeployment();
        const usdcTokenAddress = await usdcToken.getAddress();

        // 3. Deploy Oracle
        const OracleFactory = (await ethers.getContractFactory("Oracle", deployer)) as Oracle__factory;
        oracle = await OracleFactory.deploy(INITIAL_BTC_PRICE);
        await oracle.waitForDeployment();
        const oracleAddress = await oracle.getAddress();

        // 4. Deploy ClearingHouse
        const ClearingHouseFactory = (await ethers.getContractFactory("ClearingHouse", deployer)) as ClearingHouse__factory;
        clearingHouse = await ClearingHouseFactory.deploy(oracleAddress, usdcTokenAddress);
        await clearingHouse.waitForDeployment();
        const clearingHouseAddress = await clearingHouse.getAddress();

        // 5. Grant MINTER_ROLE to ClearingHouse
        const MINTER_ROLE = await usdcToken.MINTER_ROLE();
        await usdcToken.connect(deployer).grantRole(MINTER_ROLE, clearingHouseAddress);

        // 6. Mint initial USDC for traders and approve ClearingHouse to spend it
        for (const trader of [alice, bob, charlie]) {
            await usdcToken.connect(deployer).mint(trader.address, INITIAL_USDC_MINT);
            await usdcToken.connect(trader).approve(clearingHouseAddress, ethers.MaxUint256);
        }
    });

    describe("Deployment & Configuration", function () {
        it("Should set the correct oracle and collateral token addresses", async function () {
            expect(await clearingHouse.oracle()).to.equal(await oracle.getAddress());
            expect(await clearingHouse.collateralToken()).to.equal(await usdcToken.getAddress());
        });

        it("Should grant MINTER_ROLE to the ClearingHouse contract", async function () {
            const MINTER_ROLE = await usdcToken.MINTER_ROLE();
            expect(await usdcToken.hasRole(MINTER_ROLE, await clearingHouse.getAddress())).to.be.true;
        });
    });

    describe("Collateral Management", function () {
        it("Should allow Alice to deposit and withdraw collateral", async function () {
            const depositAmount = parseUSDC("1000");

            // Deposit
            await expect(clearingHouse.connect(alice).depositCollateral(depositAmount))
                .to.emit(clearingHouse, "CollateralDeposited")
                .withArgs(alice.address, depositAmount);

            expect(await clearingHouse.freeCollateral(alice.address)).to.equal(depositAmount);
            expect(await usdcToken.balanceOf(await clearingHouse.getAddress())).to.equal(depositAmount);

            // Withdraw
            const withdrawAmount = parseUSDC("500");
            await expect(clearingHouse.connect(alice).withdrawCollateral(withdrawAmount))
                .to.emit(clearingHouse, "CollateralWithdrawn")
                .withArgs(alice.address, withdrawAmount);

            expect(await clearingHouse.freeCollateral(alice.address)).to.equal(depositAmount - withdrawAmount);
            expect(await usdcToken.balanceOf(await clearingHouse.getAddress())).to.equal(depositAmount - withdrawAmount);
        });

        it("Should revert when withdrawing more than available free collateral", async function () {
            const depositAmount = parseUSDC("100");
            await clearingHouse.connect(alice).depositCollateral(depositAmount);

            const withdrawAmount = parseUSDC("101");
            await expect(clearingHouse.connect(alice).withdrawCollateral(withdrawAmount))
                .to.be.revertedWithCustomError(clearingHouse, "InsufficientFreeCollateral");
        });
    });

    describe("Long Position Scenarios", function () {
        beforeEach(async function () {
            // Alice deposits collateral for her trade
            await clearingHouse.connect(alice).depositCollateral(parseUSDC("1000"));
        });

        it("Should open a long position and update state correctly", async function () {
            const margin = parseUSDC("100"); // Using 100 USDC as margin
            await clearingHouse.connect(alice).openPosition(margin, LEVERAGE, true); // true for long

            const position = await clearingHouse.positions(alice.address);
            expect(position.size).to.be.gt(0);
            expect(position.isLong).to.be.true;
            expect(position.entryPrice).to.equal(INITIAL_BTC_PRICE);

            // Fee is 0.1% of position value (100 * 10 = 1000) -> 1 USDC fee
            const expectedMarginAfterFee = parseUSDC("99");
            expect(position.margin).to.equal(expectedMarginAfterFee);
            expect(await clearingHouse.freeCollateral(alice.address)).to.equal(parseUSDC("900"));
        });

        it("Should close a profitable long position and mint profits", async function () {
            const margin = parseUSDC("100");
            await clearingHouse.connect(alice).openPosition(margin, LEVERAGE, true);

            // Price goes up by 10% -> $55,000
            const newPrice = parsePrice("55000");
            await oracle.connect(deployer).setPrice(newPrice);
            
            const [pnl, isSolvent] = await clearingHouse.calculatePnl(alice.address);
            expect(pnl).to.be.gt(0); // Profit!
            expect(isSolvent).to.be.true;
            // PNL = (newPrice - oldPrice) * size / price_precision
            // PNL approx 10% of position value = 100 USDC
            expect(pnl).to.be.closeTo(parseUSDC("100"), parseUSDC("1"));

            const aliceFreeCollateralBefore = await clearingHouse.freeCollateral(alice.address);
            await clearingHouse.connect(alice).closePosition();
            const aliceFreeCollateralAfter = await clearingHouse.freeCollateral(alice.address);

            // FIX: The original test used the initial `margin` (100) in its final calculation.
            // We must use the margin that was actually stored in the position (99), which
            // is the initial margin minus the opening fee.

            const positionValueOnOpen = margin * LEVERAGE / 100n;
            const openingFee = positionValueOnOpen * 10n / 10000n; // 1 USDC

            const positionValueOnClose = positionValueOnOpen * newPrice / INITIAL_BTC_PRICE;
            const closingFee = positionValueOnClose * 10n / 10000n;

            // The correct amount returned to free collateral is:
            // (margin - openingFee) + pnl - closingFee
            const amountReturned = (margin - openingFee) + pnl - closingFee;

            const finalCollateral = aliceFreeCollateralBefore + amountReturned;

            // Using a smaller delta for more precision.
            expect(aliceFreeCollateralAfter).to.be.closeTo(finalCollateral, parseUSDC("0.001"));
            
            const position = await clearingHouse.positions(alice.address);
            expect(position.size).to.equal(0);

            console.log("Alice balance before and after:", {
               before: aliceFreeCollateralBefore,
               after: aliceFreeCollateralAfter
            });
        });
        
        it("Should close a losing long position and deduct from margin", async function () {
            const margin = parseUSDC("100");
            await clearingHouse.connect(alice).openPosition(margin, LEVERAGE, true);

            // Price goes down by 5% -> $47,500
            const newPrice = parsePrice("47500");
            await oracle.connect(deployer).setPrice(newPrice);
            
            const [pnl, ] = await clearingHouse.calculatePnl(alice.address);
            expect(pnl).to.be.lt(0); // Loss
            // PNL approx -5% of position value = -50 USDC
            expect(pnl).to.be.closeTo(parseUSDC("-50"), parseUSDC("1"));

            const aliceFreeCollateralBefore = await clearingHouse.freeCollateral(alice.address);
            await clearingHouse.connect(alice).closePosition();
            const aliceFreeCollateralAfter = await clearingHouse.freeCollateral(alice.address);
            
            // FIX: We must account for the opening fee in our expected calculation.
            const positionValueOnOpen = margin * LEVERAGE / 100n;                                   
            const openingFee = positionValueOnOpen * 10n / 10000n; // 10 BPS Taker Fee
            
            const positionValueOnClose = positionValueOnOpen * newPrice / INITIAL_BTC_PRICE;
            const closingFee = positionValueOnClose * 10n / 10000n;
            
            // The margin returned is the initial margin MINUS the opening fee, plus PnL, minus closing fee.
            const expectedAmountReturned = margin - openingFee + pnl - closingFee;
            const finalCollateral = aliceFreeCollateralBefore + expectedAmountReturned;

            expect(aliceFreeCollateralAfter).to.be.closeTo(finalCollateral, parseUSDC("0.001"));

            console.log("Alice balance before and after:", {
               before: aliceFreeCollateralBefore,
               after: aliceFreeCollateralAfter
            });
        });
    });

    describe("Short Position Scenarios", function () {
        beforeEach(async function () {
            await clearingHouse.connect(bob).depositCollateral(parseUSDC("2000"));
        });

        it("Should open a short position correctly", async function () {
             const margin = parseUSDC("200");
            await clearingHouse.connect(bob).openPosition(margin, LEVERAGE, false); // false for short

            const position = await clearingHouse.positions(bob.address);
            expect(position.isLong).to.be.false;
            expect(position.entryPrice).to.equal(INITIAL_BTC_PRICE);
        });

        it("Should close a profitable short position", async function () {
            const margin = parseUSDC("200");
            await clearingHouse.connect(bob).openPosition(margin, LEVERAGE, false);

            // Price goes down by 20% -> $40,000. Bob's short is profitable.
            const newPrice = parsePrice("40000");
            await oracle.connect(deployer).setPrice(newPrice);

            const [pnl, ] = await clearingHouse.calculatePnl(bob.address);
            // PNL approx 20% of position value (2000) = 400 USDC
            expect(pnl).to.be.closeTo(parseUSDC("400"), parseUSDC("1"));

            const bobCollateralBefore = await clearingHouse.freeCollateral(bob.address);
            await clearingHouse.connect(bob).closePosition();
            const bobCollateralAfter = await clearingHouse.freeCollateral(bob.address);
            
            // FIX: We must account for the opening fee in our expected calculation.
            const positionValueOnOpen = margin * LEVERAGE / 100n;
            const openingFee = positionValueOnOpen * 10n / 10000n;

            const positionValueOnClose = positionValueOnOpen * newPrice / INITIAL_BTC_PRICE;
            const closingFee = positionValueOnClose * 10n / 10000n;
            
            const expectedAmountReturned = margin - openingFee + pnl - closingFee;
            const expectedFinalCollateral = bobCollateralBefore + expectedAmountReturned;
            
            expect(bobCollateralAfter).to.be.closeTo(expectedFinalCollateral, parseUSDC("0.001"));

            console.log("Bob balance before and after:", {
               before: bobCollateralBefore,
               after: bobCollateralAfter
            });
        });
    });



    describe("Liquidation Scenarios", function () {
        it("Should allow David to liquidate Alice's underwater long position", async function () {
            await clearingHouse.connect(alice).depositCollateral(parseUSDC("100"));
            const margin = parseUSDC("100");
            await clearingHouse.connect(alice).openPosition(margin, LEVERAGE, true); // 10x long on 100 USDC margin

            // Price drops significantly by 10% -> $45,000
            // Loss = 10% of 1000 = 100 USDC. Margin is ~99. Total equity is now negative.
            const newPrice = parsePrice("45000");
            await oracle.connect(deployer).setPrice(newPrice);
            
            const [, isSolvent] = await clearingHouse.calculatePnl(alice.address);
            expect(isSolvent).to.be.false;

            const davidBalanceBefore = await usdcToken.balanceOf(david.address);

            // David liquidates Alice
            await expect(clearingHouse.connect(david).liquidate(alice.address))
                .to.emit(clearingHouse, "PositionLiquidated")
                .withArgs(alice.address, david.address, (fee: bigint) => fee > 0);

            const position = await clearingHouse.positions(alice.address);
            expect(position.size).to.equal(0); // Position deleted

            // David gets a fee (5% of position value)
            // Position value = size * price. Size = (1000 * 1e18) / 50000 = 20. Value = 20 * 45000 = 900
            const positionValue = parseUSDC("1000") * newPrice / INITIAL_BTC_PRICE;
            const liquidationFee = positionValue * 500n / 10000n; // 5%

            const davidBalanceAfter = await usdcToken.balanceOf(david.address);
            expect(davidBalanceAfter - davidBalanceBefore).to.equal(liquidationFee);

            console.log("David balance before and after:", {
               before: davidBalanceBefore,
               after: davidBalanceAfter
            });
        });

        it("Should allow a user to add margin to avoid liquidation", async function () {
            await clearingHouse.connect(charlie).depositCollateral(parseUSDC("150"));
            const margin = parseUSDC("100");
            await clearingHouse.connect(charlie).openPosition(margin, LEVERAGE, true);

            // Price drops by 9% -> $45,500. Charlie is close to liquidation.
            const liquidationPrice = parsePrice("45500");
            await oracle.connect(deployer).setPrice(liquidationPrice);

            const [, isSolventBefore] = await clearingHouse.calculatePnl(charlie.address);
            expect(isSolventBefore).to.be.false; // Should be insolvent

            // Charlie quickly adds more margin
            const additionalMargin = parseUSDC("50");
            await clearingHouse.connect(charlie).addMargin(additionalMargin);
            
            const position = await clearingHouse.positions(charlie.address);
            expect(position.margin).to.equal(parseUSDC("99") + additionalMargin); // Initial margin after fee + new margin

            const [, isSolventAfter] = await clearingHouse.calculatePnl(charlie.address);
            expect(isSolventAfter).to.be.true; // Saved!

            // David's attempt to liquidate should now fail
            await expect(clearingHouse.connect(david).liquidate(charlie.address))
                .to.be.revertedWithCustomError(clearingHouse, "PositionNotLiquidatable");

            console.log("margin changes:", {
               before: margin,
               after: position.margin
            });
        });
    });
});