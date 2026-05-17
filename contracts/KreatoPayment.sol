// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20Permit {
    function permit(
        address owner, address spender, uint256 value,
        uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) external;
    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

contract KreatoPayment is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_FEE_BPS     = 1000;  // hard cap 10%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    address public PLATFORM_WALLET;
    address public OWNER;

    constructor(address _platformWallet) {
        OWNER = msg.sender;
        PLATFORM_WALLET = _platformWallet;
    }

    event PaymentProcessed(
        address indexed buyer,
        address indexed creator,
        address indexed token,
        uint256 totalAmount,
        uint256 creatorAmount,
        uint256 platformFee,
        uint256 feeBpsApplied,
        bytes32 productId,
        PaymentType paymentType
    );

    enum PaymentType { PURCHASE, DONATION, SUBSCRIPTION }

    modifier onlyOwner() {
        require(msg.sender == OWNER, "Not owner");
        _;
    }

    function setPlatformWallet(address _new) external onlyOwner {
        require(_new != address(0), "Invalid address");
        PLATFORM_WALLET = _new;
    }

    // ── Internal split helper ─────────────────────────────────────────────────

    function _processTokenPayment(
        address token,
        uint256 amount,
        address creator,
        bytes32 productId,
        PaymentType pType,
        uint256 feeBps
    ) internal {
        require(amount > 0,              "amount must be > 0");
        require(token != address(0),     "invalid token");
        require(creator != address(0),   "invalid creator");
        require(creator != PLATFORM_WALLET, "creator cannot be platform");
        require(feeBps <= MAX_FEE_BPS,   "fee exceeds 10%");

        uint256 platformFee   = (amount * feeBps) / BPS_DENOMINATOR;
        uint256 creatorAmount = amount - platformFee;

        IERC20 erc20 = IERC20(token);
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        erc20.safeTransfer(creator, creatorAmount);
        if (platformFee > 0) erc20.safeTransfer(PLATFORM_WALLET, platformFee);

        emit PaymentProcessed(
            msg.sender, creator, token,
            amount, creatorAmount, platformFee, feeBps,
            productId, pType
        );
    }

    // ── ETH payment ───────────────────────────────────────────────────────────

    function payWithETH(
        address payable creator,
        bytes32 productId,
        PaymentType pType,
        uint256 feeBps
    ) external payable nonReentrant {
        require(msg.value > 0,              "amount must be > 0");
        require(creator != address(0),      "invalid creator");
        require(creator != PLATFORM_WALLET, "creator cannot be platform");
        require(feeBps <= MAX_FEE_BPS,      "fee exceeds 10%");

        uint256 platformFee   = (msg.value * feeBps) / BPS_DENOMINATOR;
        uint256 creatorAmount = msg.value - platformFee;

        (bool sentCreator, ) = creator.call{ value: creatorAmount }("");
        require(sentCreator, "ETH to creator failed");

        if (platformFee > 0) {
            (bool sentPlatform, ) = payable(PLATFORM_WALLET).call{ value: platformFee }("");
            require(sentPlatform, "ETH to platform failed");
        }

        emit PaymentProcessed(
            msg.sender, creator, address(0),
            msg.value, creatorAmount, platformFee, feeBps,
            productId, pType
        );
    }

    // ── ERC-20 (approve path) ─────────────────────────────────────────────────

    function payWithToken(
        address token,
        uint256 amount,
        address creator,
        bytes32 productId,
        PaymentType pType,
        uint256 feeBps
    ) external nonReentrant {
        _processTokenPayment(token, amount, creator, productId, pType, feeBps);
    }

    // ── ERC-20 (permit path) ──────────────────────────────────────────────────

    function payWithTokenPermit(
        address token,
        uint256 amount,
        address creator,
        bytes32 productId,
        PaymentType pType,
        uint256 feeBps,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external nonReentrant {
        IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _processTokenPayment(token, amount, creator, productId, pType, feeBps);
    }

    // ── View helper ───────────────────────────────────────────────────────────

    function calculateSplit(uint256 amount, uint256 feeBps)
        external
        pure
        returns (uint256 creatorAmount, uint256 platformFee)
    {
        require(feeBps <= MAX_FEE_BPS, "fee exceeds 10%");
        platformFee   = (amount * feeBps) / BPS_DENOMINATOR;
        creatorAmount = amount - platformFee;
    }

    // ── Safety ────────────────────────────────────────────────────────────────

    receive()  external payable { revert("use payWithETH()"); }
    fallback() external payable { revert("use payWithETH()"); }
}