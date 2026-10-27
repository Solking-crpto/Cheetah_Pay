// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title PaymentRouter
 * @author CheetahPay
 *
 * @notice Non-custodial USDC checkout router for Arc.
 *
 * ─── Design principles ────────────────────────────────────────────────────────
 *
 * 1.  NON-CUSTODIAL.  The router never holds user funds.  On `pay`, USDC is
 *     pulled from the payer and forwarded directly to the merchant in the same
 *     transaction.
 *
 * 2.  IMMUTABLE USDC ADDRESS.  The accepted token is fixed at compile time to
 *     the official Arc USDC ERC-20 contract.  No governance function can change
 *     it.
 *
 * 3.  NO ADMIN WITHDRAWAL.  There is no function that moves user or merchant
 *     funds to an admin address.
 *
 * 4.  ROADMAP.  Refund functionality is not present in this version.  A future
 *     version may introduce an opt-in merchant refund flow as a separate module.
 *
 * ─── Pause mechanics ──────────────────────────────────────────────────────────
 *
 * The contract owner (set at deploy time, transferable via Ownable) may call
 * `pause()` to stop all new payments.  `unpause()` resumes normal operation.
 * Only the owner may pause or unpause.  Pause does NOT affect previously
 * recorded payment state — it only prevents new `pay` calls from executing.
 *
 * ─── Arc-specific notes ───────────────────────────────────────────────────────
 *
 * On Arc, USDC simultaneously acts as the native gas token (18 dec) and
 * satisfies IERC20 (6 dec) through a single protocol-level contract at address
 * 0x3600000000000000000000000000000000000000.  This contract uses only the
 * ERC-20 interface (6-decimal amounts) and never interacts with native value.
 *
 * Arc enforces a blocklist at the protocol level: `transferFrom` involving a
 * blocklisted address will revert and consume gas.  This contract cannot prevent
 * that revert; see the threat model in the project documentation.
 *
 * ─── NOT production-safe ──────────────────────────────────────────────────────
 *
 * This contract has NOT been audited by an independent third party.  It is
 * provided as a functional reference implementation and must undergo a
 * professional security review before handling real user funds on mainnet.
 */
contract PaymentRouter is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /**
     * @notice The official USDC ERC-20 contract on Arc (mainnet and testnet).
     * @dev    Address is identical on both networks per official Arc docs:
     *         https://docs.arc.io/arc/references/contract-addresses.md
     *         Fixed at compile time; cannot be changed after deployment.
     */
    address public constant USDC =
        0x3600000000000000000000000000000000000000;

    /**
     * @notice USDC ERC-20 decimals on Arc (6 decimals via the ERC-20 interface).
     * @dev    The native gas token uses 18 decimals.  All amounts in this
     *         contract are in 6-decimal ERC-20 units.  Never mix with native.
     */
    uint8 public constant USDC_DECIMALS = 6;

    // ─── Types ────────────────────────────────────────────────────────────────

    /// @notice Lifecycle states of a payment record.
    enum PaymentStatus {
        /// Slot is empty (default zero value — do not use as a real state).
        NonExistent,
        /// Payment confirmed on-chain.
        Paid
    }

    /// @notice Immutable payment record stored per paymentId.
    struct Payment {
        /// Unique identifier supplied by the caller.
        bytes32 paymentId;
        /// Address that sent the payment.
        address payer;
        /// Address that received the payment.
        address merchant;
        /// Payment amount in USDC (6-decimal units).
        uint256 amount;
        /// Current lifecycle status.
        PaymentStatus status;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @notice All confirmed payments keyed by their unique paymentId.
    mapping(bytes32 => Payment) public payments;

    // ─── Errors ───────────────────────────────────────────────────────────────

    /// @notice The paymentId has already been used.
    error DuplicatePaymentId(bytes32 paymentId);

    /// @notice The amount supplied is zero.
    error ZeroAmount();

    /// @notice The address supplied is the zero address.
    error ZeroAddress();

    /// @notice The token supplied is not the accepted USDC contract.
    error UnsupportedToken(address token);

    // ─── Events ───────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a payment is confirmed on-chain.
     * @param paymentId Unique identifier for this payment.
     * @param payer     Address that sent the funds.
     * @param merchant  Address that received the funds.
     * @param token     ERC-20 token address (always USDC on Arc).
     * @param amount    Amount transferred in 6-decimal USDC units.
     */
    event Paid(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploy the PaymentRouter.
     * @dev    Sets msg.sender as owner (via Ownable).  The accepted token is
     *         hard-coded to the official Arc USDC address and cannot be changed.
     * @param  initialOwner  Address to receive the owner role.  Must be non-zero.
     */
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    // ─── External functions ───────────────────────────────────────────────────

    /**
     * @notice Execute a USDC payment from `msg.sender` to `merchant`.
     *
     * Requirements:
     *   - Contract is not paused.
     *   - `paymentId` must be unique (never used before in this contract).
     *   - `token` must be the official Arc USDC address.
     *   - `merchant` must be a non-zero address.
     *   - `amount` must be > 0.
     *   - `msg.sender` must have pre-approved this contract for at least `amount`
     *     USDC via `IERC20.approve`.
     *
     * Effects:
     *   - Transfers `amount` USDC from `msg.sender` directly to `merchant`.
     *   - Records the payment with `PaymentStatus.Paid`.
     *   - Emits {Paid}.
     *
     * @param paymentId  Caller-supplied unique payment identifier.
     * @param token      Must equal the USDC constant; present for explicit
     *                   on-chain verification and future interface compatibility.
     * @param merchant   Recipient of the funds.
     * @param amount     Payment amount in 6-decimal USDC units.
     */
    function pay(
        bytes32 paymentId,
        address token,
        address merchant,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        // ── Checks ────────────────────────────────────────────────────────────
        if (token != USDC) revert UnsupportedToken(token);
        if (merchant == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (payments[paymentId].status != PaymentStatus.NonExistent) {
            revert DuplicatePaymentId(paymentId);
        }

        // ── Effects ───────────────────────────────────────────────────────────
        payments[paymentId] = Payment({
            paymentId: paymentId,
            payer:     msg.sender,
            merchant:  merchant,
            amount:    amount,
            status:    PaymentStatus.Paid
        });

        // ── Interactions ──────────────────────────────────────────────────────
        // SafeERC20 handles non-standard ERC-20 return values.
        // Transfers directly payer → merchant; the router never holds funds.
        IERC20(USDC).safeTransferFrom(msg.sender, merchant, amount);

        emit Paid(paymentId, msg.sender, merchant, token, amount);
    }

    // ─── Admin functions ──────────────────────────────────────────────────────

    /**
     * @notice Pause all `pay` operations.
     * @dev    Only the contract owner may call this.
     *         Existing payment records are preserved and remain readable.
     *         Emits {Paused} (from OpenZeppelin Pausable).
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume `pay` operations after a pause.
     * @dev    Only the contract owner may call this.
     *         Emits {Unpaused} (from OpenZeppelin Pausable).
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns the full payment record for a given paymentId.
     * @param  paymentId  Payment identifier to query.
     * @return The Payment struct (zero-valued fields, NonExistent status if
     *         the paymentId has never been used).
     */
    function getPayment(
        bytes32 paymentId
    ) external view returns (Payment memory) {
        return payments[paymentId];
    }
}
