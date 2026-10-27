# CheetahPay PaymentRouter — Security Review, Threat Model & Deployment Checklist

> **Status:** TESTNET DRAFT — NOT PRODUCTION-SAFE.  
> This contract has not been audited by an independent third party. It must undergo a professional security review before handling real user funds on mainnet.

---

## 1. Self-Review Findings

The following items were identified during the engineering self-review. Each was either resolved in the source or is explicitly acknowledged as a residual risk.

### 1a. Items resolved in source

| # | Category | Finding | Resolution |
|---|----------|---------|------------|
| R1 | Access control | Refund caller not verified against payment record | `NotMerchant` check added; `msg.sender` must equal `pmt.merchant` |
| R2 | Reentrancy | External `transferFrom` call in `pay` and `refund` before state is fully committed | State is written (`payments[id] = ...`) **before** the `transferFrom` call (CEI pattern); `nonReentrant` guard also applied as defense-in-depth |
| R3 | Duplicate IDs | Same `paymentId` could overwrite an existing record | `DuplicatePaymentId` guard on any `id` whose `status != NonExistent` |
| R4 | Zero-amount payment/refund | Could create a payment record or emit events with no economic effect | `ZeroAmount` error on both `pay` and `refund` |
| R5 | Zero-address merchant | Transfer to `address(0)` burns funds on most EVM chains; on Arc it reverts at protocol level | `ZeroAddress` error before any transfer |
| R6 | Unsupported token | Caller could pass an arbitrary token address to circumvent USDC restriction | `token != USDC` guard with `UnsupportedToken` error; the USDC constant is `immutable` at compile time |
| R7 | Overflow in refund accounting | `totalRefunded += amount` could overflow | Solidity 0.8 arithmetic reverts on overflow; additionally the `remaining` check always ensures `amount <= remaining` before the addition |
| R8 | Admin fund extraction | An owner `withdraw` or `rescue` function could drain user funds | No such function exists; `Ownable` grants only `pause`/`unpause` |
| R9 | Unsafe ERC-20 returns | Some ERC-20 tokens return `false` instead of reverting | `SafeERC20.safeTransferFrom` handles non-standard return values |
| R10 | Constructor zero-address owner | `Ownable` accepts `address(0)` as owner in OZ 5.x | Explicit `if (initialOwner == address(0)) revert ZeroAddress()` guard before `Ownable` stores the value |
| R11 | Overpay by refund after full refund | Merchant attempts a second refund after `FullyRefunded` | `remaining` is 0 after full refund; `amount > remaining` triggers `RefundExceedsRemaining` |

### 1b. Residual risks

| # | Severity | Category | Description |
|---|----------|----------|-------------|
| RR1 | Medium | Merchant insolvency / bad faith | The contract cannot guarantee a refund will be executed. If a merchant lacks USDC or refuses to approve allowance, a payer has no on-chain recourse. The frontend must clearly communicate this to payers. |
| RR2 | Medium | Arc blocklist | Arc enforces a protocol-level USDC blocklist. If either the payer or the merchant address is blocklisted, their `transferFrom` will revert and consume gas with no receipt. The contract cannot prevent, detect, or remediate this. |
| RR3 | Low | Payment ID collision / front-running | Payment IDs are supplied by the caller. A malicious actor who sees a pending `pay` transaction in the mempool could attempt to front-run with the same ID. The router will record the first confirmer and reject the second — meaning the original payer's transaction will revert after they paid the gas. The frontend or SDK should generate IDs from a globally-unique source (e.g. UUIDv4 → `keccak256`) and ideally include the payer address in the preimage to make front-running economically useless. |
| RR4 | Low | Owner key compromise | The owner can pause all operations globally. A compromised owner key could deny service by permanently pausing the contract. Mitigation for production: use a multi-sig or timelock as owner. |
| RR5 | Low | No protocol fee | The contract routes 100% of USDC to the merchant. There is no protocol fee mechanism. Adding one later would require redeployment (the address is immutable). |
| RR6 | Low | No payment expiry | Payments have no expiry time. A `paymentId` with `PaymentStatus.Paid` persists indefinitely. If a merchant goes away, the refundable amount is locked in the record forever (though no funds are held by the contract — USDC was already transferred to the merchant). |
| RR7 | Info | No payer-initiated dispute | There is no on-chain dispute or escrow mechanism. Dispute resolution is off-chain. This is by design for this vertical slice but should be documented in the product. |

---

## 2. Threat Model

### 2a. Actors

| Actor | Trust level | Capabilities |
|-------|-------------|-------------|
| Payer | Untrusted | Calls `pay`; controls `paymentId`; must pre-approve USDC |
| Merchant | Untrusted | Receives USDC from `pay`; may call `refund`; must pre-approve USDC for refunds |
| Owner | Semi-trusted | Calls `pause`/`unpause`; cannot move funds |
| Router contract | In scope | Routes USDC; never custodies funds |
| Arc protocol | Trusted | Enforces USDC blocklist; provides ERC-20 semantics |

### 2b. Attack scenarios

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Attacker submits duplicate `paymentId` | First caller's transaction records; attacker's reverts (gas lost) | `DuplicatePaymentId` guard |
| Attacker attempts re-entrant `pay` from inside `transferFrom` | Re-entrant call reverts | `nonReentrant` + CEI pattern |
| Attacker calls `refund` for a payment they didn't receive | Reverts | `NotMerchant` guard |
| Attacker over-refunds to drain a merchant | Reverts | `RefundExceedsRemaining` guard |
| Attacker tries to pay with a fake ERC-20 | Reverts | `UnsupportedToken` guard |
| Compromised owner tries to sweep funds | No such function | No `withdraw`/`rescue` exists |
| Compromised owner pauses indefinitely | Denial of service | Owner should be a multi-sig (production requirement) |
| Front-run on `paymentId` in mempool | Original payer's `pay` reverts | Use payer-address-seeded UUIDs; mempool is sub-second on Arc |
| Blocklisted payer or merchant | `transferFrom` reverts at protocol level | Documented; not preventable at contract level |

---

## 3. Deployment / Configuration Checklist

### 3a. Pre-deploy (testnet)

- [ ] Run `forge test --match-path "contracts/test/PaymentRouter.t.sol"` and confirm **27/27 tests pass**.
- [ ] Run `forge build` to confirm clean compilation with Solc 0.8.28 + Cancun EVM.
- [ ] Confirm the `USDC` constant in `PaymentRouter.sol` equals `0x3600000000000000000000000000000000000000` (Arc testnet ERC-20 USDC address).
- [ ] Choose the `initialOwner` address. For testnet, the deployer wallet is acceptable. For mainnet, use a multi-sig.
- [ ] Confirm the deployer wallet has testnet USDC for gas (Arc gas is paid in USDC).
- [ ] Verify the `scpBlockchain` enum for testnet deployment is `ARC-TESTNET`.

### 3b. Deployment inputs

| Input | Testnet | Mainnet |
|-------|---------|---------|
| `initialOwner` | Your deployment wallet address | Multi-sig address (replace before deploying) |
| `USDC` constant (compile-time) | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` (same — verified against official Arc docs) |
| Chain ID | 5042002 | 5042 |
| RPC | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` | `https://explorer.arc.io` |

> **NEVER label a testnet deployment as mainnet.** The USDC address happens to be identical across networks, but contract code on testnet has no value and must not be mixed with production.

### 3c. Post-deploy verification

- [ ] Call `router.USDC()` and confirm it returns `0x3600000000000000000000000000000000000000`.
- [ ] Call `router.owner()` and confirm it returns the intended owner address.
- [ ] Call `router.paused()` and confirm it returns `false`.
- [ ] Send a small test payment and confirm funds arrive at the merchant immediately.
- [ ] Test a partial refund and confirm `remainingRefundable` decrements correctly.
- [ ] Test pause via owner wallet and confirm `pay` reverts.
- [ ] Test unpause and confirm `pay` succeeds again.

### 3d. Mainnet additional requirements (NOT yet applicable)

- [ ] Replace `initialOwner` with a verified multi-sig (e.g. Safe).
- [ ] Obtain an independent third-party security audit; do not deploy to mainnet before audit findings are resolved.
- [ ] Note: Arc Studio does not support mainnet deployment via `deploy_contract` tool. Use the self-deploy workflow from your own wallet with your own private key.

---

## 4. Unresolved Assumptions

| # | Assumption | Status | Impact if wrong |
|---|-----------|--------|----------------|
| A1 | The Arc USDC ERC-20 contract behaves as a standard ERC-20 for `transferFrom`, `approve`, and `allowance` on Arc Testnet | Documented in official Arc docs; **UNVERIFIED by live transaction** | If behavior diverges (e.g., blocklist silently drops transfer instead of reverting), the contract state would record a payment without funds moving |
| A2 | The Arc Testnet USDC address (`0x3600...0000`) is stable and will not change | Confirmed in official Arc docs as of Oct 2026 | If address migrates, the contract must be redeployed |
| A3 | `paymentId` uniqueness is enforced externally (client or backend generates non-colliding IDs) | Application-level requirement; not enforced on-chain beyond the duplicate check | Accidental ID reuse causes the second payer's transaction to revert |
| A4 | Merchants are reachable and cooperative for refunds | Off-chain assumption | Payers have no on-chain recourse if merchant is non-cooperative |
| A5 | The `nonReentrant` guard from OpenZeppelin 5.6.1 uses the `transient` storage slot (EIP-1153) under Cancun | OZ 5.x uses tstore/tload for reentrancy under Cancun | If Cancun tstore is not available on Arc Testnet, reentrancy guard falls back to storage — still secure, slightly higher gas |

---

## 5. Build and Test Commands

```bash
# Build (from /home/user/app)
bun run contracts:build
# or directly:
forge build

# Run all PaymentRouter tests
forge test --match-path "contracts/test/PaymentRouter.t.sol" -v

# Run with gas report
forge test --match-path "contracts/test/PaymentRouter.t.sol" --gas-report

# Run all project tests
bun run contracts:test
# or directly:
forge test

# Deploy to Arc Testnet (via Arc Studio deploy tool — no CLI setup required)
# In Arc Studio chat, say: "deploy PaymentRouter with initialOwner = <your address>"
# This targets ARC-TESTNET automatically.

# Check Arc Testnet USDC address live
cast call 0x3600000000000000000000000000000000000000 "symbol()(string)" \
  --rpc-url https://rpc.testnet.arc.io
```

---

## 6. What This Contract Does NOT Do

- Does not hold USDC at any time.
- Does not have an admin withdrawal or rescue function.
- Does not support any token other than Arc USDC (`0x3600000000000000000000000000000000000000`).
- Does not guarantee refunds (merchant must cooperate).
- Does not include dispute resolution.
- Does not include protocol fees.
- Does not include payment expiry.
- Does not support upgradeable patterns (no proxy).

This is intentional minimalism for the first vertical slice.
