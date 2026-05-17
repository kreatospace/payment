import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { KreatoPayment } from "../typechain-types";

const PLATFORM_WALLET = process.env.PLATFORM_WALLET as `0x${string}`;
const BPS_DENOM = 10000n;
const DEFAULT_FEE_BPS = 250n; // 2.5% — nilai yang dipakai di test sebagai default
const LOW_FEE_BPS = 100n; // 1%  — untuk test fee custom

function encodeProductId(id: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(id));
}

describe("KreatoPayment", () => {

  if (!PLATFORM_WALLET) throw new Error("Missing PLATFORM_WALLET");

  // ── Fixture ────────────────────────────────────────────────────────────────

  async function deployFixture() {
    const [deployer, buyer, creator, other] = await ethers.getSigners();

    const KreatoPayment = await ethers.getContractFactory("KreatoPayment");
    const contract = await KreatoPayment.deploy(PLATFORM_WALLET) as KreatoPayment;
    await contract.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    await usdc.mint(buyer.address, 1_000_000_000n); // 1000 USDC

    return { contract, usdc, deployer, buyer, creator, other };
  }

  // ── Constants ──────────────────────────────────────────────────────────────

  describe("Constants", () => {
    // FEE_BPS dihapus dari contract, diganti MAX_FEE_BPS
    it("has correct MAX_FEE_BPS (1000 = 10%)", async () => {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.MAX_FEE_BPS()).to.equal(1000n);
    });

    it("has correct PLATFORM_WALLET", async () => {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.PLATFORM_WALLET()).to.equal(PLATFORM_WALLET);
    });
  });

  // ── calculateSplit ─────────────────────────────────────────────────────────

  describe("calculateSplit", () => {
    it("correctly splits 1 USDC at 2.5% fee", async () => {
      const { contract } = await loadFixture(deployFixture);
      const [creatorAmt, fee] = await contract.calculateSplit(1_000_000n, DEFAULT_FEE_BPS);
      expect(creatorAmt).to.equal(975_000n);
      expect(fee).to.equal(25_000n);
    });

    it("correctly splits 1 USDC at 1% fee", async () => {
      const { contract } = await loadFixture(deployFixture);
      const [creatorAmt, fee] = await contract.calculateSplit(1_000_000n, LOW_FEE_BPS);
      expect(creatorAmt).to.equal(990_000n);
      expect(fee).to.equal(10_000n);
    });

    it("correctly splits at 0% fee (gratis)", async () => {
      const { contract } = await loadFixture(deployFixture);
      const [creatorAmt, fee] = await contract.calculateSplit(1_000_000n, 0n);
      expect(creatorAmt).to.equal(1_000_000n);
      expect(fee).to.equal(0n);
    });

    it("correctly splits 100 USDC at 2.5% fee", async () => {
      const { contract } = await loadFixture(deployFixture);
      const [creatorAmt, fee] = await contract.calculateSplit(100_000_000n, DEFAULT_FEE_BPS);
      expect(creatorAmt).to.equal(97_500_000n);
      expect(fee).to.equal(2_500_000n);
    });

    it("creatorAmount + platformFee = totalAmount always", async () => {
      const { contract } = await loadFixture(deployFixture);
      const amounts = [1n, 100n, 999n, 1_000_000n, 123_456_789n];
      for (const amount of amounts) {
        const [creatorAmt, fee] = await contract.calculateSplit(amount, DEFAULT_FEE_BPS);
        expect(creatorAmt + fee).to.equal(amount);
      }
    });

    it("reverts if feeBps exceeds MAX_FEE_BPS", async () => {
      const { contract } = await loadFixture(deployFixture);
      await expect(
        contract.calculateSplit(1_000_000n, 1001n)
      ).to.be.revertedWith("fee exceeds 10%");
    });
  });

  // ── payWithETH ─────────────────────────────────────────────────────────────

  describe("payWithETH", () => {
    it("splits ETH correctly at 2.5% fee", async () => {
      const { contract, buyer, creator } = await loadFixture(deployFixture);
      const productId = encodeProductId("product-123");
      const amount = ethers.parseEther("1.0");
      const feeBps = DEFAULT_FEE_BPS;

      const expectedPlatform = (amount * feeBps) / BPS_DENOM;
      const expectedCreator = amount - expectedPlatform;

      const creatorBefore = await ethers.provider.getBalance(creator.address);
      const platformBefore = await ethers.provider.getBalance(PLATFORM_WALLET);

      await contract.connect(buyer).payWithETH(
        creator.address, productId, 0, feeBps, { value: amount }
      );

      expect(await ethers.provider.getBalance(creator.address) - creatorBefore).to.equal(expectedCreator);
      expect(await ethers.provider.getBalance(PLATFORM_WALLET) - platformBefore).to.equal(expectedPlatform);
    });

    it("splits ETH correctly at 1% fee", async () => {
      const { contract, buyer, creator } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1.0");
      const feeBps = LOW_FEE_BPS;

      const expectedPlatform = (amount * feeBps) / BPS_DENOM;
      const expectedCreator = amount - expectedPlatform;

      const creatorBefore = await ethers.provider.getBalance(creator.address);
      const platformBefore = await ethers.provider.getBalance(PLATFORM_WALLET);

      await contract.connect(buyer).payWithETH(
        creator.address, encodeProductId("product-low-fee"), 0, feeBps, { value: amount }
      );

      expect(await ethers.provider.getBalance(creator.address) - creatorBefore).to.equal(expectedCreator);
      expect(await ethers.provider.getBalance(PLATFORM_WALLET) - platformBefore).to.equal(expectedPlatform);
    });

    it("sends full amount to creator at 0% fee", async () => {
      const { contract, buyer, creator } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1.0");

      const creatorBefore = await ethers.provider.getBalance(creator.address);
      const platformBefore = await ethers.provider.getBalance(PLATFORM_WALLET);

      await contract.connect(buyer).payWithETH(
        creator.address, encodeProductId("product-free"), 0, 0n, { value: amount }
      );

      expect(await ethers.provider.getBalance(creator.address) - creatorBefore).to.equal(amount);
      expect(await ethers.provider.getBalance(PLATFORM_WALLET) - platformBefore).to.equal(0n);
    });

    it("emits PaymentProcessed event with feeBpsApplied", async () => {
      const { contract, buyer, creator } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1.0");
      const feeBps = DEFAULT_FEE_BPS;
      const productId = encodeProductId("product-456");

      const expectedPlatform = (amount * feeBps) / BPS_DENOM;
      const expectedCreator = amount - expectedPlatform;

      await expect(
        contract.connect(buyer).payWithETH(creator.address, productId, 0, feeBps, { value: amount })
      ).to.emit(contract, "PaymentProcessed")
        .withArgs(
          buyer.address,
          creator.address,
          ethers.ZeroAddress,
          amount,
          expectedCreator,
          expectedPlatform,
          feeBps,           // 👈 feeBpsApplied di event
          productId,
          0
        );
    });

    it("reverts if feeBps exceeds MAX_FEE_BPS", async () => {
      const { contract, buyer, creator } = await loadFixture(deployFixture);
      await expect(
        contract.connect(buyer).payWithETH(
          creator.address, ethers.ZeroHash, 0, 1001n, { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("fee exceeds 10%");
    });

    it("reverts if amount is 0", async () => {
      const { contract, buyer, creator } = await loadFixture(deployFixture);
      await expect(
        contract.connect(buyer).payWithETH(creator.address, ethers.ZeroHash, 0, DEFAULT_FEE_BPS, { value: 0 })
      ).to.be.revertedWith("amount must be > 0");
    });

    it("reverts if creator is zero address", async () => {
      const { contract, buyer } = await loadFixture(deployFixture);
      await expect(
        contract.connect(buyer).payWithETH(
          ethers.ZeroAddress, ethers.ZeroHash, 0, DEFAULT_FEE_BPS, { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("invalid creator");
    });

    it("reverts if creator is platform wallet", async () => {
      const { contract, buyer } = await loadFixture(deployFixture);
      await expect(
        contract.connect(buyer).payWithETH(
          PLATFORM_WALLET, ethers.ZeroHash, 0, DEFAULT_FEE_BPS, { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("creator cannot be platform");
    });

    it("reverts on direct ETH send", async () => {
      const { contract, buyer } = await loadFixture(deployFixture);
      await expect(
        buyer.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("1") })
      ).to.be.revertedWith("use payWithETH()");
    });
  });

  // ── payWithToken ───────────────────────────────────────────────────────────

  describe("payWithToken", () => {
    it("splits USDC correctly at 2.5% fee", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      const amount = 1_000_000n;
      const feeBps = DEFAULT_FEE_BPS;
      const productId = encodeProductId("product-789");

      const expectedPlatform = (amount * feeBps) / BPS_DENOM;
      const expectedCreator = amount - expectedPlatform;

      await usdc.connect(buyer).approve(await contract.getAddress(), amount);

      const creatorBefore = await usdc.balanceOf(creator.address);
      const platformBefore = await usdc.balanceOf(PLATFORM_WALLET);
      const buyerBefore = await usdc.balanceOf(buyer.address);

      await contract.connect(buyer).payWithToken(
        await usdc.getAddress(), amount, creator.address, productId, 0, feeBps
      );

      expect(await usdc.balanceOf(creator.address) - creatorBefore).to.equal(expectedCreator);
      expect(await usdc.balanceOf(PLATFORM_WALLET) - platformBefore).to.equal(expectedPlatform);
      expect(buyerBefore - await usdc.balanceOf(buyer.address)).to.equal(amount);
    });

    it("splits USDC correctly at 1% fee", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      const amount = 1_000_000n;
      const feeBps = LOW_FEE_BPS;

      const expectedPlatform = (amount * feeBps) / BPS_DENOM;
      const expectedCreator = amount - expectedPlatform;

      await usdc.connect(buyer).approve(await contract.getAddress(), amount);

      const creatorBefore = await usdc.balanceOf(creator.address);
      const platformBefore = await usdc.balanceOf(PLATFORM_WALLET);

      await contract.connect(buyer).payWithToken(
        await usdc.getAddress(), amount, creator.address,
        encodeProductId("product-1pct"), 0, feeBps
      );

      expect(await usdc.balanceOf(creator.address) - creatorBefore).to.equal(expectedCreator);
      expect(await usdc.balanceOf(PLATFORM_WALLET) - platformBefore).to.equal(expectedPlatform);
    });

    it("sends full amount to creator at 0% fee", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      const amount = 1_000_000n;

      await usdc.connect(buyer).approve(await contract.getAddress(), amount);

      const creatorBefore = await usdc.balanceOf(creator.address);
      const platformBefore = await usdc.balanceOf(PLATFORM_WALLET);

      await contract.connect(buyer).payWithToken(
        await usdc.getAddress(), amount, creator.address,
        encodeProductId("product-free"), 0, 0n
      );

      expect(await usdc.balanceOf(creator.address) - creatorBefore).to.equal(amount);
      expect(await usdc.balanceOf(PLATFORM_WALLET) - platformBefore).to.equal(0n);
    });

    it("emits PaymentProcessed event with feeBpsApplied", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      const amount = 5_000_000n;
      const feeBps = DEFAULT_FEE_BPS;
      const productId = encodeProductId("membership-abc");

      await usdc.connect(buyer).approve(await contract.getAddress(), amount);

      await expect(
        contract.connect(buyer).payWithToken(
          await usdc.getAddress(), amount, creator.address, productId, 2, feeBps
        )
      ).to.emit(contract, "PaymentProcessed")
        .withArgs(
          buyer.address,
          creator.address,
          await usdc.getAddress(),
          amount,
          (amount * (BPS_DENOM - feeBps)) / BPS_DENOM,
          (amount * feeBps) / BPS_DENOM,
          feeBps,           // 👈 feeBpsApplied
          productId,
          2
        );
    });

    it("reverts if feeBps exceeds MAX_FEE_BPS", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      await usdc.connect(buyer).approve(await contract.getAddress(), 1_000_000n);
      await expect(
        contract.connect(buyer).payWithToken(
          await usdc.getAddress(), 1_000_000n, creator.address, ethers.ZeroHash, 0, 1001n
        )
      ).to.be.revertedWith("fee exceeds 10%");
    });

    it("reverts if amount is 0", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      await expect(
        contract.connect(buyer).payWithToken(
          await usdc.getAddress(), 0, creator.address, ethers.ZeroHash, 0, DEFAULT_FEE_BPS
        )
      ).to.be.revertedWith("amount must be > 0");
    });

    it("reverts if token is zero address", async () => {
      const { contract, buyer, creator } = await loadFixture(deployFixture);
      await expect(
        contract.connect(buyer).payWithToken(
          ethers.ZeroAddress, 1_000_000n, creator.address, ethers.ZeroHash, 0, DEFAULT_FEE_BPS
        )
      ).to.be.revertedWith("invalid token");
    });

    it("reverts if creator is zero address", async () => {
      const { contract, usdc, buyer } = await loadFixture(deployFixture);
      await usdc.connect(buyer).approve(await contract.getAddress(), 1_000_000n);
      await expect(
        contract.connect(buyer).payWithToken(
          await usdc.getAddress(), 1_000_000n, ethers.ZeroAddress, ethers.ZeroHash, 0, DEFAULT_FEE_BPS
        )
      ).to.be.revertedWith("invalid creator");
    });

    it("reverts if buyer has insufficient allowance", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      await expect(
        contract.connect(buyer).payWithToken(
          await usdc.getAddress(), 1_000_000n, creator.address, ethers.ZeroHash, 0, DEFAULT_FEE_BPS
        )
      ).to.be.reverted;
    });

    it("reverts if buyer has insufficient balance", async () => {
      const { contract, usdc, other, creator } = await loadFixture(deployFixture);
      await usdc.connect(other).approve(await contract.getAddress(), 1_000_000n);
      await expect(
        contract.connect(other).payWithToken(
          await usdc.getAddress(), 1_000_000n, creator.address, ethers.ZeroHash, 0, DEFAULT_FEE_BPS
        )
      ).to.be.reverted;
    });

    it("handles subscription payment type correctly", async () => {
      const { contract, usdc, buyer, creator } = await loadFixture(deployFixture);
      const amount = 8_000_000n;
      await usdc.connect(buyer).approve(await contract.getAddress(), amount);

      await expect(
        contract.connect(buyer).payWithToken(
          await usdc.getAddress(), amount, creator.address,
          encodeProductId("membership-xyz"), 2, DEFAULT_FEE_BPS
        )
      ).to.emit(contract, "PaymentProcessed");
    });
  });
});