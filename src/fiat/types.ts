/**
 * FiatPaymentProvider — shared types.
 *
 * These types are imported by both the frontend (adapter calls) and the
 * backend (webhook verification + state machine).  They contain no Node- or
 * browser-specific APIs so they can be used in either environment.
 *
 * SANDBOX LABELLING RULE: every UI surface that originates from a sandbox
 * adapter MUST carry a isSandbox:true flag in its payload.  The server
 * re-asserts this flag and never treats a sandbox payment as real.
 */

// ─── Payment lifecycle ────────────────────────────────────────────────────────

/**
 * State machine for a fiat-initiated payment.
 *
 *   INITIATED             customer started the fiat flow
 *     │
 *   WEBHOOK_RECEIVED      backend received + verified the provider webhook
 *     │
 *   CONVERSION_PENDING    treasury USDC transfer submitted to chain
 *     │
 *   SETTLED               on-chain receipt confirmed by backend + re-verified
 *                         by the frontend via useWaitForTransactionReceipt
 *     │
 *   FAILED                any unrecoverable error in the pipeline
 *
 * Nothing moves to SETTLED without an on-chain tx hash stored in
 * FiatPaymentRecord.settlementTxHash AND the frontend verifying that hash
 * with wagmi's useWaitForTransactionReceipt.
 */
export type FiatPaymentState =
  | 'INITIATED'
  | 'WEBHOOK_RECEIVED'
  | 'CONVERSION_PENDING'
  | 'SETTLED'
  | 'FAILED'

/** Full payment record stored server-side and returned by the status API. */
export interface FiatPaymentRecord {
  /** Unique fiat-payment identifier (server-generated UUID). */
  fiatPaymentId: string
  /** The CheetahPay paymentId this fiat payment settles. Hex bytes32. */
  onchainPaymentId: string
  /** USDC amount as a decimal string, e.g. "12.50". */
  amount: string
  /** Merchant address (checksummed hex). */
  merchant: string
  /** Human-readable reference from the checkout link. */
  reference: string
  /** Current lifecycle state. */
  state: FiatPaymentState
  /** Always true for sandbox payments — never false on this adapter. */
  isSandbox: true
  /**
   * On-chain tx hash written by the backend treasury transfer.
   * Present only when state >= CONVERSION_PENDING.
   * The frontend MUST verify this hash independently via
   * useWaitForTransactionReceipt before rendering SETTLED.
   */
  settlementTxHash?: `0x${string}`
  /** ISO-8601 timestamp when the record was created. */
  createdAt: string
  /** ISO-8601 timestamp of the last state transition. */
  updatedAt: string
  /** Human-readable failure reason when state === FAILED. */
  failureReason?: string
}

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Payload the sandbox adapter returns to the backend to simulate a
 * provider webhook.  A real provider would POST this to your webhook
 * endpoint over HTTPS with their own HMAC signature.
 */
export interface FiatWebhookPayload {
  /** Fiat-payment identifier issued by the provider (or sandbox). */
  providerId: string
  /** The CheetahPay paymentId being settled. */
  onchainPaymentId: string
  /** USDC amount as a decimal string. */
  amount: string
  /** Merchant address. */
  merchant: string
  /** Sandbox flag — backend MUST assert this is true before processing. */
  isSandbox: true
  /** ISO-8601 timestamp when the event was created. */
  eventTimestamp: string
  /**
   * HMAC-SHA256 signature of the canonical payload string.
   * Computed with the shared FIAT_WEBHOOK_SECRET.
   * The backend verifies this before changing any state.
   * The sandbox adapter does NOT produce a real transaction hash — only the
   * backend treasury wallet does after webhook verification passes.
   */
  signature: string
}

/**
 * FiatPaymentProvider — interface every adapter must implement.
 *
 * The sandbox adapter is the only implementation here.  A real adapter would
 * wrap a live provider SDK (e.g. Stripe, Checkout.com) behind this same
 * interface so the rest of the app never changes.
 */
export interface FiatPaymentProvider {
  /** Human-readable name shown in the UI. */
  readonly name: string
  /**
   * True when this adapter is a sandbox.  UI components MUST display a
   * clearly labelled sandbox badge when this is true.
   */
  readonly isSandbox: true

  /**
   * Initiate a fiat payment.  Returns a webhook payload the frontend POSTs
   * to /api/fiat/webhook.  The adapter MUST NOT produce or embed any
   * blockchain transaction hash — that is exclusively the backend's job.
   *
   * @param params  The checkout parameters for this payment.
   * @returns       A signed webhook payload ready to POST to the backend.
   */
  initiate(params: InitiateParams): Promise<FiatWebhookPayload>
}

export interface InitiateParams {
  fiatPaymentId: string
  onchainPaymentId: string
  amount: string
  merchant: string
  reference: string
}
