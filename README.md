# CheetahPay

A non-custodial USDC checkout application for Arc. Merchants create shareable payment links with a fixed recipient address and amount. Customers pay in USDC directly from their wallet — no intermediary ever holds the funds.

Built with [Arc Studio](https://studio.arc.io)

---

## What it does

| Feature | Status |
|---|---|
| Merchant creates a payment link (no wallet required) | Live |
| Customer pays in USDC via wallet (approve + pay) | Live |
| On-chain payment status panel | Live |
| Sandbox card/bank payment option (testnet only) | Sandbox — not built for production |
| Refunds | Not built — roadmap |

**Wallet path:** the customer approves the USDC amount, then calls `pay()` on the PaymentRouter contract. USDC flows directly from payer to merchant in one transaction. Nothing is marked paid until the on-chain receipt confirms it.

**Sandbox card path:** testnet only. A local backend server signs a simulated webhook, then a funded treasury wallet calls `approve()` + `pay()` on-chain. The server verifies the receipt and the `Paid` event before writing `SETTLED`. This path is disabled at build time when `VITE_NETWORK=mainnet`.

---

## Tech stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS v3, wagmi v2, ConnectKit, viem
- **Contract:** Solidity 0.8.28, OpenZeppelin 5.6.1, Foundry
- **Backend (sandbox only):** Bun HTTP server, viem
- **Network:** Arc (USDC-native EVM chain); Arc Testnet for development

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Foundry](https://getfoundry.sh) (`forge`, `cast`)
- A browser wallet (MetaMask or any injected wallet)

---

## Install

```bash
bun install
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `VITE_NETWORK` | Yes | `testnet` (default) or `mainnet`. Controls the active chain, contract address, and feature flags for the entire build. |
| `VITE_PAYMENT_ROUTER_ADDRESS` | Yes (testnet) | Address of the deployed PaymentRouter on Arc Testnet. Set by Arc Studio at deploy time. |
| `VITE_MAINNET_ROUTER_ADDRESS` | Yes (mainnet) | Address of your mainnet-deployed PaymentRouter. Set manually after your own deployment. |
| `FIAT_WEBHOOK_SECRET` | Backend only | 32-byte hex secret for HMAC-signing sandbox webhooks. Generate: `openssl rand -hex 32`. Never add a `VITE_` prefix. |
| `TREASURY_PRIVATE_KEY` | Backend only | Arc Testnet private key for the treasury wallet. Must hold test USDC. Never add a `VITE_` prefix. Never use a mainnet key. |
| `RPC_PROXY_BASE_URL` | Optional | Provisioned by Arc Studio. Outside Arc Studio the backend falls back to public RPC. |
| `RPC_PROXY_TOKEN` | Optional | Provisioned by Arc Studio. |
| `RPC_PROXY_CHAINS` | Optional | Provisioned by Arc Studio. |

`FIAT_WEBHOOK_SECRET` and `TREASURY_PRIVATE_KEY` have no `VITE_` prefix and are therefore never included in the frontend bundle by Vite. The production bundle audit confirms zero occurrences of either name as a runtime value.

---

## Run

```bash
# Frontend only (wallet payments work without the backend)
bun run dev

# Backend (required for the sandbox card option only)
bun run server

# Both together (for full local testing)
bun run dev &
bun run server
```

Verify both are up:
```bash
curl -s http://localhost:5173/        # frontend
curl -s http://localhost:3001/api/health   # backend
curl -s http://localhost:5173/api/health   # backend through Vite proxy
```

---

## Test

```bash
# Contract tests (Foundry — fresh compile, 15 tests)
forge clean && forge test --match-path "contracts/test/PaymentRouter.t.sol" -v

# Frontend lint + typecheck
bun run check

# Production build (testnet)
bunx vite build

# Production build (mainnet — disables all sandbox features)
VITE_NETWORK=mainnet VITE_MAINNET_ROUTER_ADDRESS=0x<your_address> bunx vite build

# Bundle secret audit (run after build)
grep -r "TREASURY_PRIVATE_KEY\|FIAT_WEBHOOK_SECRET" dist/    # must return nothing
grep -r "import\.meta\.env" dist/                             # must return nothing
```

---

## Network settings

### Arc Testnet (development)

| Setting | Value |
|---|---|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.io |
| Explorer | https://explorer.testnet.arc.io |
| USDC address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 (ERC-20 interface) |
| PaymentRouter | `0xdb2f8ad94d8b66ad212375f7dd7ad31cca4aea42` |

### Arc Mainnet (production)

| Setting | Value |
|---|---|
| Chain ID | 5042 |
| RPC | https://rpc.mainnet.arc.io |
| Explorer | https://explorer.arc.io |
| USDC address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 (ERC-20 interface) |
| PaymentRouter | — not yet deployed — |
| Deploy tx hash | — not yet deployed — |

Set `VITE_NETWORK=mainnet` and `VITE_MAINNET_ROUTER_ADDRESS=0x<address>` in `.env` to activate the mainnet build.

---

## Contract

**File:** `contracts/PaymentRouter.sol`  
**Compiler:** Solidity 0.8.28 (exact, auto-detect disabled)  
**OpenZeppelin:** 5.6.1 (ReentrancyGuard, Pausable, Ownable, SafeERC20)

### Constructor

```solidity
constructor(address initialOwner)
```

One argument: the address that receives the `Ownable` owner role (pause/unpause only — no fund access). Use a hardware wallet or multi-sig for production.

### Deploy to Arc Mainnet (from your own machine)

```bash
# Import your key once — stored encrypted, never in a file
cast wallet import cheetahpay-deployer --interactive

# Deploy
forge create contracts/PaymentRouter.sol:PaymentRouter \
  --rpc-url https://rpc.mainnet.arc.io \
  --account cheetahpay-deployer \
  --broadcast \
  --constructor-args <your_owner_address>

# After deploy: add the contract address to .env
# VITE_MAINNET_ROUTER_ADDRESS=0x<deployed_address>
# VITE_NETWORK=mainnet
```

### Key functions

| Function | Caller | Description |
|---|---|---|
| `pay(paymentId, token, merchant, amount)` | Anyone (payer) | Pulls USDC from caller, forwards to merchant atomically. |
| `pause()` / `unpause()` | Owner only | Stops / resumes `pay`. No effect on recorded payment state. |
| `getPayment(paymentId)` | Anyone | Returns the full payment record. |

### What the contract does NOT have

- No admin withdrawal or sweep function.
- No upgradeability.
- No arbitrary external calls.
- No refund function in this version.

---

## Limitations

### Security

**This contract has not been independently audited.** It must undergo a professional third-party security review before being used to handle real user funds on mainnet. Do not deploy to mainnet without an audit.

### Backend

The fiat sandbox backend uses an **in-memory store**. All payment records are lost on restart. This is intentional for a sandbox; a production fiat integration would require a persistent database and a licensed payment processor.

### Fiat sandbox

The card/bank payment option is a **sandbox simulation** only. It uses a treasury wallet funded with test USDC; no real fiat money is processed. It is disabled at build time on mainnet builds and is not a substitute for a real payment processor.

### Refunds

Refunds are not implemented in this version. A future version may introduce an opt-in merchant refund module as a separate, independently auditable contract.

### Merchant non-cooperation

The contract cannot guarantee a refund if the merchant has insufficient USDC or refuses to authorise one. This is a consequence of the non-custodial design and must be disclosed to customers.

### Arc blocklist

Arc enforces a USDC blocklist at the protocol level. A `transferFrom` involving a blocklisted address reverts and consumes gas without a payment receipt. The contract cannot detect or prevent this.
