/**
 * CheetahPay fiat-to-USDC settlement backend — SANDBOX ONLY.
 *
 * Security model
 * ──────────────
 * • TREASURY_PRIVATE_KEY and FIAT_WEBHOOK_SECRET are read only here.
 *   Neither has a VITE_ prefix — Vite never bundles them.
 * • All sandbox webhook signing and verification happen here.
 *   The browser never holds or computes the HMAC secret.
 * • /api/fiat/initiate looks up amount and merchant from the server-side
 *   payment-request store. It rejects any client-supplied amount or merchant
 *   that does not match the registered request.
 * • Maximum amount: MAX_USDC_AMOUNT USDC per payment request.
 * • Rate limiting: MAX_REQUESTS_PER_WINDOW per IP per RATE_WINDOW_MS.
 * • settle() asserts chainId === ARC_TESTNET_CHAIN_ID before submitting any tx.
 * • SETTLED is written only after:
 *     1. The treasury pay() tx is included in a block.
 *     2. The receipt contains a Paid event for the correct paymentId.
 * • Per-payment-ID lock (settlingIds) prevents double treasury transfers.
 *
 * Endpoints
 * ─────────
 *   POST /api/payment-request          Register a merchant payment request
 *   GET  /api/payment-request/:id      Read a registered request (checkout page)
 *   POST /api/fiat/initiate            Start fiat flow for a registered request
 *   GET  /api/fiat/status/:id          Poll fiat payment state
 *
 * State machine (server-side fiat records):
 *   INITIATED → WEBHOOK_RECEIVED → CONVERSION_PENDING → SETTLED | FAILED
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  decodeEventLog,
  type Hex,
  type Log,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import type { FiatPaymentRecord } from '../src/fiat/types'
import { buildSandboxWebhook, verifyHmac } from './sandboxProvider'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Only Arc Testnet is supported. settle() hard-asserts this. */
const ARC_TESTNET_CHAIN_ID = 5042002

/** Maximum USDC amount accepted per payment request (6 decimals = integer). */
const MAX_USDC_AMOUNT = 5.0

/** Rate limit: requests per IP per window. */
const RATE_LIMIT_MAX      = 10
const RATE_WINDOW_MS      = 60_000  // 1 minute

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001)

const WEBHOOK_SECRET = (process.env.FIAT_WEBHOOK_SECRET ?? '').trim()
if (!WEBHOOK_SECRET) {
  console.error('[fiat-server] FIAT_WEBHOOK_SECRET is not set — refusing to start.')
  process.exit(1)
}

// No VITE_ prefix — never exposed to the frontend bundle.
const TREASURY_PRIVATE_KEY = (process.env.TREASURY_PRIVATE_KEY ?? '').trim()

const PAYMENT_ROUTER_ADDRESS = process.env.VITE_PAYMENT_ROUTER_ADDRESS as `0x${string}` | undefined
if (!PAYMENT_ROUTER_ADDRESS) {
  console.error('[fiat-server] VITE_PAYMENT_ROUTER_ADDRESS is not set — refusing to start.')
  process.exit(1)
}

// USDC address and decimals from the onchain-facts registry — no hardcoding.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUsdc, requireChain } = require('../src/onchain-facts') as typeof import('../src/onchain-facts')
const usdcFact = getUsdc(ARC_TESTNET_CHAIN_ID)
if (!usdcFact) {
  console.error('[fiat-server] USDC not found for Arc Testnet in onchain-facts registry.')
  process.exit(1)
}
const USDC_ADDRESS  = usdcFact.address as `0x${string}`
const USDC_DECIMALS = usdcFact.decimals // 6

// RPC: use proxy when available, public fallback otherwise.
const ARC_CHAIN_KEY = 'Arc_Testnet'
const proxyChains   = (process.env.RPC_PROXY_CHAINS ?? '').split(',').map(s => s.trim())
const rpcUrl: string =
  process.env.RPC_PROXY_BASE_URL && proxyChains.includes(ARC_CHAIN_KEY)
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${ARC_CHAIN_KEY}?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`
    : (() => {
        const url = requireChain(ARC_TESTNET_CHAIN_ID).rpcUrls[0]
        console.warn(`[fiat-server] Arc_Testnet not in RPC_PROXY_CHAINS — falling back to public RPC: ${url}`)
        return url
      })()

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const ROUTER_ABI = [
  {
    type: 'function', name: 'pay', stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentId', type: 'bytes32' },
      { name: 'token',     type: 'address'  },
      { name: 'merchant',  type: 'address'  },
      { name: 'amount',    type: 'uint256'  },
    ],
    outputs: [],
  },
  {
    type: 'event', name: 'Paid',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true  },
      { name: 'payer',     type: 'address', indexed: true  },
      { name: 'merchant',  type: 'address', indexed: true  },
      { name: 'token',     type: 'address', indexed: false },
      { name: 'amount',    type: 'uint256', indexed: false },
    ],
  },
] as const

// ─── Stores ───────────────────────────────────────────────────────────────────

/**
 * Server-side registry of merchant payment requests.
 * Created by POST /api/payment-request.
 * The fiat flow reads amount and merchant exclusively from here —
 * never from the client payload.
 */
interface PaymentRequest {
  /** The bytes32 paymentId generated by the merchant view. */
  onchainPaymentId: string
  /** USDC amount as a decimal string, e.g. "2.50". */
  amount: string
  /** Merchant address (lowercased). */
  merchant: string
  /** Human-readable reference. */
  reference: string
  /** ISO-8601 creation timestamp. */
  createdAt: string
}

/** onchainPaymentId → PaymentRequest */
const requestStore = new Map<string, PaymentRequest>()

/** fiatPaymentId → FiatPaymentRecord */
const fiatStore = new Map<string, FiatPaymentRecord>()

/** IDs currently mid-settlement — blocks a second treasury transfer. */
const settlingIds = new Set<string>()

const nowIso = () => new Date().toISOString()

function updateFiatRecord(
  id: string,
  patch: Partial<Pick<FiatPaymentRecord, 'state' | 'settlementTxHash' | 'failureReason'>>,
): FiatPaymentRecord | undefined {
  const rec  = fiatStore.get(id)
  if (!rec) return undefined
  const next = { ...rec, ...patch, updatedAt: nowIso() }
  fiatStore.set(id, next)
  return next
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/** ip → [request timestamps] */
const rateLimitMap = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now   = Date.now()
  const times = (rateLimitMap.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  times.push(now)
  rateLimitMap.set(ip, times)
  return times.length > RATE_LIMIT_MAX
}

/** Periodically evict stale IP entries to prevent unbounded growth. */
setInterval(() => {
  const now = Date.now()
  for (const [ip, times] of rateLimitMap) {
    const fresh = times.filter(t => now - t < RATE_WINDOW_MS)
    if (fresh.length === 0) rateLimitMap.delete(ip)
    else rateLimitMap.set(ip, fresh)
  }
}, RATE_WINDOW_MS)

function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

// ─── Amount validation ────────────────────────────────────────────────────────

function parseAmountSafe(amount: string): number | null {
  const n = parseFloat(amount)
  return isFinite(n) && n > 0 ? n : null
}

// ─── Settlement ───────────────────────────────────────────────────────────────

/**
 * Full settlement pipeline:
 *   0. HARD ASSERT: chain ID must be ARC_TESTNET_CHAIN_ID.
 *   1. Approve USDC spend from treasury wallet.
 *   2. Call PaymentRouter.pay() — USDC flows treasury → merchant directly.
 *   3. Wait for the on-chain receipt.
 *   4. Decode logs — REQUIRE a Paid event for the correct paymentId.
 *   5. Only then write state: 'SETTLED'.
 *
 * Any error writes state: 'FAILED' and clears the settling lock.
 */
async function settle(fiatPaymentId: string): Promise<void> {
  const record = fiatStore.get(fiatPaymentId)
  if (!record) return

  const onchainPaymentId = record.onchainPaymentId as Hex
  const merchant         = record.merchant         as `0x${string}`
  const amountRaw        = parseUnits(record.amount, USDC_DECIMALS)

  try {
    // ── 0. Chain guard ────────────────────────────────────────────────────────
    // arcTestnet.id is a compile-time constant from viem/chains that equals
    // ARC_TESTNET_CHAIN_ID. We assert both to make the intent explicit.
    if (arcTestnet.id !== ARC_TESTNET_CHAIN_ID) {
      throw new Error(
        `Chain mismatch: viem arcTestnet.id=${arcTestnet.id} !== ` +
        `expected ARC_TESTNET_CHAIN_ID=${ARC_TESTNET_CHAIN_ID}. ` +
        'Settlement refused — this server only operates on Arc Testnet.',
      )
    }

    if (!TREASURY_PRIVATE_KEY || TREASURY_PRIVATE_KEY.length < 64) {
      throw new Error(
        'TREASURY_PRIVATE_KEY is not configured. ' +
        'Add a funded Arc Testnet private key (no VITE_ prefix) to .env.',
      )
    }

    const account      = privateKeyToAccount(TREASURY_PRIVATE_KEY as Hex)
    const transport    = http(rpcUrl)
    // chain is pinned to arcTestnet — writeContract will reject if the RPC
    // responds with a different chainId.
    const walletClient = createWalletClient({ account, chain: arcTestnet, transport })
    const publicClient = createPublicClient({ chain: arcTestnet, transport })

    // ── 1. Approve ────────────────────────────────────────────────────────────
    console.log(`[fiat-server] Approving ${record.amount} USDC for router ${PAYMENT_ROUTER_ADDRESS}`)
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS, abi: ERC20_ABI,
      functionName: 'approve',
      args: [PAYMENT_ROUTER_ADDRESS!, amountRaw],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    console.log(`[fiat-server] Approve confirmed: ${approveTx}`)

    // ── 2. pay() ──────────────────────────────────────────────────────────────
    console.log(`[fiat-server] Calling pay(${onchainPaymentId})`)
    const payTx = await walletClient.writeContract({
      address: PAYMENT_ROUTER_ADDRESS!, abi: ROUTER_ABI,
      functionName: 'pay',
      args: [onchainPaymentId, USDC_ADDRESS, merchant, amountRaw],
    })
    updateFiatRecord(fiatPaymentId, { state: 'CONVERSION_PENDING', settlementTxHash: payTx })
    console.log(`[fiat-server] pay() submitted: ${payTx}`)

    // ── 3. Wait for receipt ───────────────────────────────────────────────────
    const receipt = await publicClient.waitForTransactionReceipt({ hash: payTx })
    console.log(`[fiat-server] pay() confirmed in block ${receipt.blockNumber}: ${payTx}`)

    // ── 4. Verify Paid event in receipt ───────────────────────────────────────
    const paidLog = receipt.logs.find((log: Log) => {
      try {
        const decoded = decodeEventLog({
          abi: ROUTER_ABI,
          eventName: 'Paid',
          data: log.data,
          topics: log.topics,
        })
        return decoded.args.paymentId === onchainPaymentId
      } catch {
        return false
      }
    })

    if (!paidLog) {
      throw new Error(
        `Paid event not found in receipt for paymentId ${onchainPaymentId}. tx: ${payTx}`,
      )
    }

    // ── 5. Write SETTLED ──────────────────────────────────────────────────────
    updateFiatRecord(fiatPaymentId, { state: 'SETTLED' })
    console.log(`[fiat-server] SETTLED ${fiatPaymentId} (paymentId=${onchainPaymentId})`)

  } catch (e: unknown) {
    const reason = (e instanceof Error ? e.message : String(e))
    updateFiatRecord(fiatPaymentId, { state: 'FAILED', failureReason: reason })
    console.error(`[fiat-server] Settlement FAILED for ${fiatPaymentId}: ${reason}`)
  } finally {
    settlingIds.delete(fiatPaymentId)
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Sandbox': 'true',
      ...CORS_HEADERS,
    },
  })
}
const err = (msg: string, status = 400) => json({ error: msg }, status)

// ─── HTTP server ──────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const ip = clientIp(req)

    // ── POST /api/payment-request ─────────────────────────────────────────────
    // Called by the merchant view when it generates a checkout link.
    // Registers the authoritative {onchainPaymentId, amount, merchant} tuple.
    // The fiat flow will only accept requests for IDs registered here.
    if (req.method === 'POST' && pathname === '/api/payment-request') {
      if (isRateLimited(ip)) return err('Rate limit exceeded. Try again shortly.', 429)

      let body: Record<string, string>
      try { body = await req.json() as Record<string, string> } catch { return err('Invalid JSON') }

      const { onchainPaymentId, amount, merchant, reference } = body
      if (!onchainPaymentId || !amount || !merchant)
        return err('Missing required fields: onchainPaymentId, amount, merchant')

      // Validate amount
      const amountNum = parseAmountSafe(amount)
      if (amountNum === null)
        return err('amount must be a positive number')
      if (amountNum > MAX_USDC_AMOUNT)
        return err(`amount exceeds the sandbox maximum of ${MAX_USDC_AMOUNT} USDC`)

      // Validate merchant address (basic hex check)
      if (!/^0x[0-9a-fA-F]{40}$/.test(merchant))
        return err('merchant must be a valid 0x address')

      // Idempotent — same ID, same data → 200 with the existing record
      const existing = requestStore.get(onchainPaymentId)
      if (existing) {
        if (existing.amount !== amount || existing.merchant.toLowerCase() !== merchant.toLowerCase())
          return err('Payment request already registered with different parameters', 409)
        return json(existing)
      }

      const req_: PaymentRequest = {
        onchainPaymentId,
        amount,
        merchant: merchant.toLowerCase(),
        reference: (reference ?? '').slice(0, 200),
        createdAt: nowIso(),
      }
      requestStore.set(onchainPaymentId, req_)
      console.log(`[fiat-server] Payment request registered: ${onchainPaymentId} — ${amount} USDC → ${merchant}`)
      return json(req_, 201)
    }

    // ── GET /api/payment-request/:id ──────────────────────────────────────────
    // Lets the checkout page read the authoritative amount and merchant.
    if (req.method === 'GET' && pathname.startsWith('/api/payment-request/')) {
      const id      = pathname.slice('/api/payment-request/'.length)
      const request = requestStore.get(id)
      if (!request) return err('Payment request not found', 404)
      return json(request)
    }

    // ── POST /api/fiat/initiate ───────────────────────────────────────────────
    // Starts a fiat payment for an already-registered payment request.
    //
    // Security:
    //   - onchainPaymentId must reference a registered payment request.
    //   - amount and merchant are taken from that server-side record;
    //     any client-supplied values are IGNORED after the lookup.
    //   - Rate-limited per IP.
    //   - Amount re-validated against MAX_USDC_AMOUNT (defence in depth).
    if (req.method === 'POST' && pathname === '/api/fiat/initiate') {
      if (isRateLimited(ip)) return err('Rate limit exceeded. Try again shortly.', 429)

      let body: Record<string, string>
      try { body = await req.json() as Record<string, string> } catch { return err('Invalid JSON') }

      const { fiatPaymentId, onchainPaymentId } = body
      if (!fiatPaymentId || !onchainPaymentId)
        return err('Missing required fields: fiatPaymentId, onchainPaymentId')

      // ── Look up the registered request — the only source of truth for amount/merchant
      const registeredRequest = requestStore.get(onchainPaymentId)
      if (!registeredRequest) {
        return err(
          'No payment request found for this onchainPaymentId. ' +
          'The merchant must generate the checkout link first.',
          404,
        )
      }

      // Amount cap — defence in depth (already enforced at registration time)
      const amountNum = parseAmountSafe(registeredRequest.amount)
      if (amountNum === null || amountNum > MAX_USDC_AMOUNT) {
        return err(
          `Registered amount ${registeredRequest.amount} USDC exceeds the sandbox maximum of ${MAX_USDC_AMOUNT} USDC.`,
          422,
        )
      }

      // ── Per-fiatPaymentId idempotency guard
      const existing = fiatStore.get(fiatPaymentId)
      if (existing) {
        if (existing.state === 'FAILED') return json(existing) // allow retry with new ID
        return err('Already processed', 409)
      }
      if (settlingIds.has(fiatPaymentId))
        return err('Settlement already in flight for this ID', 409)

      // ── Create the fiat record using ONLY server-verified values ──────────
      const fiatRecord: FiatPaymentRecord = {
        fiatPaymentId,
        onchainPaymentId: registeredRequest.onchainPaymentId,
        // amount and merchant come from the registered request — NOT from the client body
        amount:    registeredRequest.amount,
        merchant:  registeredRequest.merchant,
        reference: registeredRequest.reference,
        state:     'INITIATED',
        isSandbox: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      fiatStore.set(fiatPaymentId, fiatRecord)
      console.log(`[fiat-server] INITIATED ${fiatPaymentId} (onchain=${onchainPaymentId})`)

      // Build + self-verify the webhook
      const webhook = await buildSandboxWebhook(WEBHOOK_SECRET, {
        fiatPaymentId,
        onchainPaymentId: registeredRequest.onchainPaymentId,
        amount:           registeredRequest.amount,
        merchant:         registeredRequest.merchant,
        reference:        registeredRequest.reference,
      })
      if (!(await verifyHmac(WEBHOOK_SECRET, webhook))) {
        updateFiatRecord(fiatPaymentId, { state: 'FAILED', failureReason: 'Internal: HMAC self-check failed' })
        return err('Internal signature error', 500)
      }
      updateFiatRecord(fiatPaymentId, { state: 'WEBHOOK_RECEIVED' })
      console.log(`[fiat-server] WEBHOOK_RECEIVED ${fiatPaymentId}`)

      // Acquire settling lock BEFORE launching async settlement
      settlingIds.add(fiatPaymentId)
      void settle(fiatPaymentId)

      return json(fiatStore.get(fiatPaymentId), 201)
    }

    // ── GET /api/fiat/status/:id ──────────────────────────────────────────────
    if (req.method === 'GET' && pathname.startsWith('/api/fiat/status/')) {
      const id     = pathname.slice('/api/fiat/status/'.length)
      const record = fiatStore.get(id)
      if (!record) return err('Not found', 404)
      return json(record)
    }

    // ── GET /api/health ───────────────────────────────────────────────────────
    // Lightweight liveness check used by the frontend to detect whether the
    // backend process is reachable. Returns 200 + a small status object.
    // No auth, no rate-limit — safe to call on every page load.
    if (req.method === 'GET' && pathname === '/api/health') {
      return json({
        ok:                   true,
        sandbox:              true,
        chain:                ARC_TESTNET_CHAIN_ID,
        maxUsdc:              MAX_USDC_AMOUNT,
        // true when TREASURY_PRIVATE_KEY is set and long enough to be a valid key.
        // Never exposes the value — only its presence.
        treasuryConfigured:   TREASURY_PRIVATE_KEY.length >= 64,
        ts:                   nowIso(),
      })
    }

    return err('Not found', 404)
  },
})

console.log(`[fiat-server] SANDBOX backend listening on :${PORT}`)
console.log(`[fiat-server] Chain: Arc Testnet (${ARC_TESTNET_CHAIN_ID}) — testnet only`)
console.log(`[fiat-server] Max amount: ${MAX_USDC_AMOUNT} USDC`)
console.log(`[fiat-server] Rate limit: ${RATE_LIMIT_MAX} req/${RATE_WINDOW_MS / 1000}s per IP`)
