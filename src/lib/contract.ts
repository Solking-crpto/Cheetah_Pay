/**
 * PaymentRouter contract facts — address, ABI, chain.
 *
 * Network selection
 * ─────────────────
 * Set VITE_NETWORK=mainnet in .env to activate the Arc mainnet config.
 * Any other value (including absent) activates Arc Testnet.
 *
 * Arc Testnet  chainId 5042002  — development and staging
 * Arc Mainnet  chainId 5042     — production (real funds; independent audit required)
 *
 * Mainnet deployment address
 * ──────────────────────────
 * Set VITE_MAINNET_ROUTER_ADDRESS to the address of your mainnet-deployed
 * PaymentRouter contract. This value is not set in a fresh project because
 * Arc Studio does not deploy to mainnet on your behalf.
 *
 * Testnet deployment address
 * ──────────────────────────
 * Set by Arc Studio at deploy time. Do not edit manually.
 *
 * USDC address
 * ────────────
 * 0x3600000000000000000000000000000000000000 on both networks.
 * Source: https://docs.arc.io/arc/references/contract-addresses.md
 * Fixed at the contract level as a compile-time constant; confirmed in
 * onchain-facts registry (which also returns this address for both chains).
 *
 * Decimal handling
 * ────────────────
 * All amounts in this app use the ERC-20 interface: 6 decimals.
 * parseUsdc / formatUsdc from @/lib/utils wrap parseAmount/formatAmount
 * from @/onchain-money, which reads the decimal count from onchain-facts.
 * No decimal count is hardcoded in app code; it is always read from the
 * registry via getUsdc(chainId).decimals.
 */
import { requireChain, getUsdc, buildTxExplorerUrl } from '@/onchain-facts'

// ── Network selection ─────────────────────────────────────────────────────────
//
// One named constant controls the entire chain configuration.
// Change VITE_NETWORK in .env; never change these IDs.

const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'

/** Arc Testnet chain ID (5042002). Used for testnet-only guards. */
export const ARC_TESTNET_CHAIN_ID = 5042002 as const

/** Arc Mainnet chain ID (5042). */
export const ARC_MAINNET_CHAIN_ID  = 5042 as const

/**
 * The chain this build targets.
 * 5042 when VITE_NETWORK=mainnet, 5042002 otherwise.
 * All contract reads, writes and explorer links use this ID.
 */
export const CHAIN_ID: number = IS_MAINNET ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID

/** True when this build is configured for Arc Mainnet. */
export const IS_MAINNET_BUILD: boolean = IS_MAINNET

// ── Chain facts from the registry (never hardcode) ────────────────────────────

const chain  = requireChain(CHAIN_ID)
const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error(`USDC not found in onchain-facts for chain ${CHAIN_ID}`)

/**
 * USDC ERC-20 address.
 * Reads from onchain-facts registry: 0x3600000000000000000000000000000000000000
 * on both Arc Testnet and Arc Mainnet.
 */
export const USDC_ADDRESS   = usdcFact.address as `0x${string}`

/**
 * USDC ERC-20 decimals: 6.
 * The ERC-20 interface always uses 6 decimals.
 * The native gas view uses 18 decimals. Never mix them.
 */
export const USDC_DECIMALS  = usdcFact.decimals

export const CHAIN_NAME     = chain.name
export const EXPLORER_BASE  = chain.explorerBase

// ── Contract address ──────────────────────────────────────────────────────────
//
// Testnet address is set by Arc Studio at deploy time.
// Mainnet address must be set manually in .env after your own deploy.

const TESTNET_ROUTER_ADDRESS =
  (import.meta.env.VITE_PAYMENT_ROUTER_ADDRESS as string | undefined) ??
  '0x0000000000000000000000000000000000000000'

const MAINNET_ROUTER_ADDRESS =
  (import.meta.env.VITE_MAINNET_ROUTER_ADDRESS as string | undefined) ??
  '0x0000000000000000000000000000000000000000'

/**
 * The deployed PaymentRouter address for the active network.
 * Mainnet: set VITE_MAINNET_ROUTER_ADDRESS in .env after your own deployment.
 * Testnet: set by Arc Studio at deploy time (VITE_PAYMENT_ROUTER_ADDRESS).
 */
export const PAYMENT_ROUTER_ADDRESS = (
  IS_MAINNET ? MAINNET_ROUTER_ADDRESS : TESTNET_ROUTER_ADDRESS
) as `0x${string}`

export const IS_ROUTER_CONFIGURED =
  /^0x[0-9a-fA-F]{40}$/.test(PAYMENT_ROUTER_ADDRESS) &&
  PAYMENT_ROUTER_ADDRESS.toLowerCase() !== '0x0000000000000000000000000000000000000000'

// ── Explorer helpers ──────────────────────────────────────────────────────────

export function explorerTxUrl(hash: string): string {
  return buildTxExplorerUrl(CHAIN_ID, hash)
}

export function explorerAddrUrl(addr: string): string {
  return `${EXPLORER_BASE}/address/${addr}`
}

// ── Minimal ABI ───────────────────────────────────────────────────────────────

/** Minimal ABI — only the functions and events the UI needs. */
export const PAYMENT_ROUTER_ABI = [
  // pay(bytes32 paymentId, address token, address merchant, uint256 amount)
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentId', type: 'bytes32' },
      { name: 'token',     type: 'address' },
      { name: 'merchant',  type: 'address' },
      { name: 'amount',    type: 'uint256' },
    ],
    outputs: [],
  },
  // getPayment(bytes32) returns (Payment)
  {
    type: 'function',
    name: 'getPayment',
    stateMutability: 'view',
    inputs: [{ name: 'paymentId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'paymentId', type: 'bytes32' },
          { name: 'payer',     type: 'address' },
          { name: 'merchant',  type: 'address' },
          { name: 'amount',    type: 'uint256' },
          { name: 'status',    type: 'uint8'   }, // 0=NonExistent, 1=Paid
        ],
      },
    ],
  },
  // paused() returns (bool)
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  // event Paid(bytes32 indexed, address indexed, address indexed, address, uint256)
  {
    type: 'event',
    name: 'Paid',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true  },
      { name: 'payer',     type: 'address', indexed: true  },
      { name: 'merchant',  type: 'address', indexed: true  },
      { name: 'token',     type: 'address', indexed: false },
      { name: 'amount',    type: 'uint256', indexed: false },
    ],
  },
] as const

/** Minimal ERC-20 ABI — approve + allowance + balanceOf. */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value',   type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
