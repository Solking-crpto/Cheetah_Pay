# CheetahPay — PaymentRouter

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

CheetahPay is a non-custodial USDC checkout and refund application for Arc. The first vertical slice is `PaymentRouter.sol` — a permissionless, non-custodial routing contract that moves USDC directly from payer to merchant on `pay`, and from merchant back to original payer on `refund`. No funds are ever custodied in the router.

## Contract Deployments

| Contract | Network | Address | Status |
|----------|---------|---------|--------|
| PaymentRouter | Arc Testnet | 0xdb2f8ad94d8b66ad212375f7dd7ad31cca4aea42 | Deployed — https://explorer.testnet.arc.io/address/0xdb2f8ad94d8b66ad212375f7dd7ad31cca4aea42 |

## Key Security Facts

- USDC address (testnet + mainnet): `0x3600000000000000000000000000000000000000`
- USDC ERC-20 decimals: 6
- Owner (deployer): to be set at deploy time
- Pause: owner-only; stops `pay` and `refund`
- No admin withdrawal or sweep function
- Full self-review and 27/27 Foundry tests passing
- NOT independently audited — do not use on mainnet without a third-party audit

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
