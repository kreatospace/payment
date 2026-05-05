// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title KreatoPayment
 * @notice Splits every payment between the creator and Kreato platform.
 *         Fee is hardcoded at 250 basis points (2.5%).
 *
 * Supported payment types:
 *   1. Native ETH          — payWithETH()
 *   2. ERC-20 (approve)    — payWithToken()         [two wallet popups]
 *   3. ERC-20 (permit)     — payWithTokenPermit()   [ONE wallet popup — preferred]
 *
 * EIP-2612 permit flow (payWithTokenPermit):
 *   Frontend signs a permit off-chain (no gas, no popup except the signature itself
 *   which MetaMask shows as a simple "Sign" — not a transaction).
 *   Then calls payWithTokenPermit() which applies the permit + transfers in one tx.
 *   Result: user sees ONE MetaMask popup instead of two.
 *
 *   Supported by: USDC on Base, USDC on Ethereum (native permit), DAI, most modern ERC-20s.
 *   NOT supported by: old USDT on Ethereum (use payWithToken for those).
 */

/// @dev Minimal EIP-2612 permit interface
interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

contract KreatoPayment is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant FEE_BPS = 250;
    uint256 public constant BPS_DENOMINATOR = 10000;

    address public PLATFORM_WALLET;
    address public OWNER;

    constructor(address _platformWallet) {
        OWNER = msg.sender;
        PLATFORM_WALLET = _platformWallet;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event PaymentProcessed(
        address indexed buyer,
        address indexed creator,
        address indexed token,
        uint256 totalAmount,
        uint256 creatorAmount,
        uint256 platformFee,
        bytes32 productId,
        PaymentType paymentType
    );

    enum PaymentType { PURCHASE, DONATION, SUBSCRIPTION }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setPlatformWallet(address _new) external {
        require(msg.sender == OWNER, "Not owner");
        require(_new != address(0), "Invalid address");
        PLATFORM_WALLET = _new;
    }

    // ── Internal split helper ─────────────────────────────────────────────────

    function _processTokenPayment(
        address token,
        uint256 amount,
        address creator,
        bytes32 productId,
        PaymentType pType
    ) internal {
        require(amount > 0, "KreatoPayment: amount must be > 0");
        require(token != address(0), "KreatoPayment: invalid token address");
        require(creator != address(0), "KreatoPayment: invalid creator address");
        require(creator != PLATFORM_WALLET, "KreatoPayment: creator cannot be platform");

        uint256 platformFee   = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorAmount = amount - platformFee;

        IERC20 erc20 = IERC20(token);

        // Pull full amount from buyer → contract
        erc20.safeTransferFrom(msg.sender, address(this), amount);

        // Forward to creator
        erc20.safeTransfer(creator, creatorAmount);

        // Forward fee to platform
        erc20.safeTransfer(PLATFORM_WALLET, platformFee);

        emit PaymentProcessed(
            msg.sender,
            creator,
            token,
            amount,
            creatorAmount,
            platformFee,
            productId,
            pType
        );
    }

    // ── ETH payment ───────────────────────────────────────────────────────────

    /**
     * @notice Pay with native ETH. Single wallet popup.
     */
    function payWithETH(
        address payable creator,
        bytes32 productId,
        PaymentType pType
    ) external payable nonReentrant {
        require(msg.value > 0, "KreatoPayment: amount must be > 0");
        require(creator != address(0), "KreatoPayment: invalid creator address");
        require(creator != PLATFORM_WALLET, "KreatoPayment: creator cannot be platform");

        uint256 totalAmount   = msg.value;
        uint256 platformFee   = (totalAmount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorAmount = totalAmount - platformFee;

        (bool sentCreator, ) = creator.call{ value: creatorAmount }("");
        require(sentCreator, "KreatoPayment: ETH transfer to creator failed");

        (bool sentPlatform, ) = payable(PLATFORM_WALLET).call{ value: platformFee }("");
        require(sentPlatform, "KreatoPayment: ETH transfer to platform failed");

        emit PaymentProcessed(
            msg.sender,
            creator,
            address(0),
            totalAmount,
            creatorAmount,
            platformFee,
            productId,
            pType
        );
    }

    // ── ERC-20 payment (approve path) ─────────────────────────────────────────

    /**
     * @notice Pay with ERC-20. Requires prior approve() — TWO wallet popups.
     *         Use payWithTokenPermit() instead when the token supports EIP-2612.
     */
    function payWithToken(
        address token,
        uint256 amount,
        address creator,
        bytes32 productId,
        PaymentType pType
    ) external nonReentrant {
        _processTokenPayment(token, amount, creator, productId, pType);
    }

    // ── ERC-20 payment (permit path — ONE popup) ──────────────────────────────

    /**
     * @notice Pay with ERC-20 using EIP-2612 permit. ONE wallet popup total.
     *
     * The frontend:
     *   1. Calls signTypedData (eth_signTypedData_v4) — shows as a MetaMask
     *      "signature request", NOT a transaction. No gas. No separate popup.
     *   2. Calls this function with the signature — ONE transaction popup.
     *
     * @param token     ERC-20 token address (must support EIP-2612 permit).
     * @param amount    Total amount in token units.
     * @param creator   Creator wallet address.
     * @param productId Off-chain reference id (bytes32).
     * @param pType     Payment type enum.
     * @param deadline  Unix timestamp after which the permit expires.
     * @param v         Permit signature v.
     * @param r         Permit signature r.
     * @param s         Permit signature s.
     */
    function payWithTokenPermit(
        address token,
        uint256 amount,
        address creator,
        bytes32 productId,
        PaymentType pType,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        // Apply the permit — this sets the allowance without a separate tx
        // If the token doesn't support permit, this will revert here safely
        // before any funds move.
        IERC20Permit(token).permit(
            msg.sender,     // owner
            address(this),  // spender
            amount,
            deadline,
            v, r, s
        );

        // Now process payment exactly like payWithToken
        _processTokenPayment(token, amount, creator, productId, pType);
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function calculateSplit(uint256 amount)
        external
        pure
        returns (uint256 creatorAmount, uint256 platformFee)
    {
        platformFee   = (amount * FEE_BPS) / BPS_DENOMINATOR;
        creatorAmount = amount - platformFee;
    }

    // ── Safety ────────────────────────────────────────────────────────────────

    receive() external payable {
        revert("KreatoPayment: use payWithETH()");
    }

    fallback() external payable {
        revert("KreatoPayment: use payWithETH()");
    }
}
