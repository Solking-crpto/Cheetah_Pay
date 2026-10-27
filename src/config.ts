/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Both Arc Testnet and Arc Mainnet are registered so a connected wallet
 * can be asked to switch to either network. The active network for
 * contract calls is controlled by VITE_NETWORK in .env (see lib/contract.ts).
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// ── Arc Mainnet chain definition ──────────────────────────────────────────────
// Facts read from onchain-facts registry: chainId 5042, RPC https://rpc.mainnet.arc.io
// USDC: 0x3600000000000000000000000000000000000000 (same address as testnet)
const arcMainnet = {
  id:          5042,
  name:        'Arc',
  nativeCurrency: {
    name:     'USD Coin',
    symbol:   'USDC',
    decimals: 18,   // native gas view; ERC-20 view uses 6 decimals
  },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
  testnet: false,
} as const

// Pre-register chain RPC URLs so trace events show correct chain names
registerChain(arcTestnet.id,  arcTestnet.rpcUrls.default.http[0])
registerChain(arcMainnet.id,  arcMainnet.rpcUrls.default.http[0])

export const config = createConfig({
  // Both Arc networks registered so the wallet can switch between them.
  // Ethereum mainnet is present only for ENS resolution.
  chains:     [arcTestnet, arcMainnet, mainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]:  http(),
    [arcMainnet.id]:  http(),
    [mainnet.id]:     http(),   // ENS resolution
  },
})
