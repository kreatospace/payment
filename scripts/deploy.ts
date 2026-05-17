import { ethers, network, run } from "hardhat";
import { isAddress } from "ethers";

function getEnvKeys(networkName: string) {
  switch (networkName) {
    case "sepolia":
      return {
        payment: "NEXT_PUBLIC_KREATO_CONTRACT_SEPOLIA",
        usdc: "NEXT_PUBLIC_USDC_SEPOLIA",
      };
    case "baseSepolia":
      return {
        payment: "NEXT_PUBLIC_KREATO_CONTRACT_BASE_SEPOLIA",
        usdc: "NEXT_PUBLIC_USDC_BASE_SEPOLIA",
      };
    case "mainnet":
      return {
        payment: "NEXT_PUBLIC_KREATO_CONTRACT_ETH",
        usdc: "NEXT_PUBLIC_USDC_ETH",
      };
    case "base":
      return {
        payment: "NEXT_PUBLIC_KREATO_CONTRACT_BASE",
        usdc: "NEXT_PUBLIC_USDC_BASE",
      };
    default:
      throw new Error(`Unsupported network: ${networkName}`);
  }
}

async function main() {
  const platformWallet = process.env.PLATFORM_WALLET;
  const [deployer] = await ethers.getSigners();

  console.log("Network    :", network.name);
  console.log("Deployer   :", deployer.address);
  console.log("Platform   :", platformWallet);
  console.log("Fee model  : dynamic (feeBps passed per call, MAX 10%)");

  if (!platformWallet || !isAddress(platformWallet)) {
    throw new Error("Invalid or missing PLATFORM_WALLET");
  }

  let usdcAddress: string;

  if (network.name === "mainnet") {
    usdcAddress = process.env.USDC_MAINNET!;
    console.log("Using real USDC:", usdcAddress);
  } else if (network.name === "base") {
    usdcAddress = process.env.USDC_BASE!;
    console.log("Using real USDC (Base):", usdcAddress);
  } else {
    // ─── Deploy Mock USDC ─────────────────────────────
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    usdcAddress = await usdc.getAddress();
    console.log("\nMock USDC deployed to:", usdcAddress);

    const mintAmount = ethers.parseUnits("1000", 6);
    const mintTx = await usdc.mint(deployer.address, mintAmount);
    await mintTx.wait();
    console.log("Minted 1000 USDC to:", deployer.address);
  }

  // ─── Deploy KreatoPayment ─────────────────────────
  const KreatoPayment = await ethers.getContractFactory("KreatoPayment");
  let paymentAddress: string;

  try {
    const payment = await KreatoPayment.deploy(platformWallet);
    await payment.waitForDeployment();
    paymentAddress = await payment.getAddress();
    console.log("\nKreatoPayment deployed to:", paymentAddress);
  } catch (e: any) {
    // Known hardhat-ethers v3 bug: getTransaction() throws BAD_DATA for
    // deployment txs because ethers v6 rejects null "to" field.
    if (e?.code === "BAD_DATA" && e?.shortMessage?.includes("value.to")) {
      const [signer] = await ethers.getSigners();
      const nonce = await signer.getNonce() - 1;
      paymentAddress = ethers.getCreateAddress({ from: signer.address, nonce });
      console.warn("⚠️  Caught known hardhat-ethers bug — recovered address from CREATE derivation");
      console.log("\nKreatoPayment deployed to:", paymentAddress);
    } else {
      throw e;
    }
  }

  // ─── Verify on Etherscan (mainnet / base only) ────
  if (network.name === "mainnet" || network.name === "base") {
    console.log("\nVerifying KreatoPayment on Etherscan...");
    try {
      await run("verify:verify", {
        address: paymentAddress,
        constructorArguments: [platformWallet],
      });
      console.log("✅ Verified");
    } catch (e: any) {
      if (e?.message?.includes("Already Verified")) {
        console.log("ℹ️  Already verified");
      } else {
        console.warn("⚠️  Verify failed:", e?.message);
      }
    }
  }

  // ─── ENV output ───────────────────────────────────
  const keys = getEnvKeys(network.name);

  console.log("\n─── ENV ───────────────────────────────────────────");
  console.log(`${keys.payment}=${paymentAddress}`);
  console.log(`${keys.usdc}=${usdcAddress}`);
  console.log(`PLATFORM_WALLET=${platformWallet}`);
  console.log("───────────────────────────────────────────────────");
  console.log("NOTE: feeBps dikirim per-call dari frontend (0–1000 bps)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});