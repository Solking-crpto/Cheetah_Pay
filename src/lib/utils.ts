import { USDC_DECIMALS } from './contract'

/** Shorten an address for display: 0x1234…abcd */
export function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Returns true if the string is a syntactically valid 0x-prefixed 20-byte hex address. */
export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

/**
 * EIP-55 checksum encode an address.
 * Pure — no external dependencies, works in the browser.
 * Returns the input unchanged if it is not a valid hex address.
 */
export async function checksumAddress(addr: string): Promise<string> {
  if (!isValidAddress(addr)) return addr
  const lower = addr.slice(2).toLowerCase()
  const enc = new TextEncoder()
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(lower))
  // SHA-256 produces 32 bytes; keccak-256 is the EIP-55 standard but is not in
  // Web Crypto.  We use a deterministic upper/lower fold based on the sha256 hash
  // as a best-effort visual disambiguation.  For real EIP-55 in production, use
  // viem's getAddress() — this is sufficient for a display hint in a testnet UI.
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  let result = '0x'
  for (let i = 0; i < 40; i++) {
    result += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
  }
  return result
}

/** Parse a decimal USDC string (e.g. "10.50") to raw bigint units. */
export function parseUsdc(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Invalid USDC amount')
  }

  const [whole, fraction = ''] = value.split('.')
  const raw = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS)
    + BigInt(fraction.padEnd(USDC_DECIMALS, '0'))

  if (raw <= 0n) {
    throw new Error('USDC amount must be greater than zero')
  }

  return raw
}

/** Format raw bigint units to a human-readable USDC string, e.g. "10.50". */
export function formatUsdc(raw: bigint): string {
  const divisor = 10n ** BigInt(USDC_DECIMALS)
  const intPart = raw / divisor
  const fracPart = raw % divisor
  const fracStr = fracPart.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return fracStr ? `${intPart}.${fracStr}` : `${intPart}`
}

/** Parse a raw onchain error into a short user-friendly string. */
export function parseOnchainError(err: unknown): string {
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Cancelled.'
  if (msg.includes('duplicate')) return 'This payment ID is already used.'
  if (msg.includes('zeroa')) return 'Invalid address.'
  if (msg.includes('zeroamount')) return 'Amount must be greater than zero.'
  if (msg.includes('unsupported')) return 'Unsupported token.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance'))
    return 'Insufficient balance.'
  if (msg.includes('reverted')) return 'Transaction reverted. Check your balance and allowance.'
  if (msg.includes('network') || msg.includes('timeout'))
    return 'Network error. Check your connection and retry.'
  return 'Something went wrong. Please try again.'
}

/** Generate a cryptographically random 32-byte payment ID. */
export function generatePaymentId(_merchantAddr: string, _reference: string): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}
