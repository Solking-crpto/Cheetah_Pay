/**
 * useFiatPayment — React hook for the sandbox fiat flow.
 *
 * Security model:
 *   • The browser sends only {fiatPaymentId, onchainPaymentId, amount,
 *     merchant, reference} to POST /api/fiat/initiate.
 *   • The server handles signing, webhook verification, treasury transfer,
 *     receipt confirmation, and Paid-event verification.
 *   • SETTLED is never set locally. This hook reflects SETTLED only when the
 *     server record at GET /api/fiat/status/:id reports state === 'SETTLED'.
 *   • The browser never holds FIAT_WEBHOOK_SECRET or TREASURY_PRIVATE_KEY.
 *
 * State flow (mirrors server state machine):
 *   IDLE → INITIATED → WEBHOOK_RECEIVED → CONVERSION_PENDING → SETTLED | FAILED
 */

import { useState, useCallback, useRef } from 'react'
import type { FiatPaymentRecord, FiatPaymentState } from './types'

export interface FiatPaymentHookResult {
  /** Current lifecycle state, mirrored from the server record. */
  state: FiatPaymentState | 'IDLE'
  /** True while any async step is in flight. */
  isPending: boolean
  /**
   * Settlement tx hash from the server record.
   * Present once the server has submitted the treasury tx.
   * For display / explorer link only — the server verifies the receipt,
   * not the frontend.
   */
  settlementTxHash: `0x${string}` | undefined
  /** Human-readable status line for the current state. */
  statusLabel: string
  /** Error message when state === 'FAILED'. */
  errorMsg: string | undefined
  /** Kick off the fiat payment flow. */
  start: () => void
  /** Always true — this hook is sandbox-only. */
  isSandbox: true
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const STATE_LABELS: Record<FiatPaymentState | 'IDLE', string> = {
  IDLE:               'Pay with card or bank',
  INITIATED:          'Starting payment…',
  WEBHOOK_RECEIVED:   'Payment received — verifying…',
  CONVERSION_PENDING: 'Converting to USDC — waiting for on-chain confirmation…',
  SETTLED:            'Payment settled on-chain',
  FAILED:             'Payment failed',
}

const POLL_INTERVAL_MS = 2_500
const POLL_TIMEOUT_MS  = 120_000

export function useFiatPayment(
  onchainPaymentId: string,
  amount: string,
  merchant: string,
  reference: string,
): FiatPaymentHookResult {
  const [state,            setState]            = useState<FiatPaymentState | 'IDLE'>('IDLE')
  const [settlementTxHash, setSettlementTxHash] = useState<`0x${string}` | undefined>()
  const [errorMsg,         setErrorMsg]         = useState<string | undefined>()
  const [isPending,        setIsPending]        = useState(false)

  const fiatPaymentIdRef = useRef<string | undefined>()
  const pollTimerRef     = useRef<ReturnType<typeof setInterval> | undefined>()
  const pollStartRef     = useRef<number>(0)

  function stopPolling() {
    if (pollTimerRef.current !== undefined) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = undefined
    }
  }

  function startPolling(fiatPaymentId: string) {
    pollStartRef.current = Date.now()
    pollTimerRef.current = setInterval(() => {
      void (async () => {
        if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
          stopPolling()
          setState('FAILED')
          setErrorMsg('Timed out waiting for on-chain settlement. Please contact support.')
          setIsPending(false)
          return
        }

        try {
          const resp = await fetch(`/api/fiat/status/${fiatPaymentId}`)
          if (!resp.ok) return // transient — keep polling

          const record = await resp.json() as FiatPaymentRecord
          setState(record.state)

          if (record.failureReason && !errorMsg) setErrorMsg(record.failureReason)

          if (record.settlementTxHash && !settlementTxHash) {
            setSettlementTxHash(record.settlementTxHash)
          }

          // Terminal states — stop polling
          if (record.state === 'SETTLED' || record.state === 'FAILED') {
            stopPolling()
            setIsPending(false)
          }
        } catch {
          // network hiccup — keep polling
        }
      })()
    }, POLL_INTERVAL_MS)
  }

  const start = useCallback(() => {
    if (isPending || state !== 'IDLE') return
    setIsPending(true)
    setErrorMsg(undefined)

    void (async () => {
      try {
        const fiatPaymentId = uuidv4()
        fiatPaymentIdRef.current = fiatPaymentId

        // Single call — server handles signing, webhook, and settlement.
        const initResp = await fetch('/api/fiat/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fiatPaymentId, onchainPaymentId, amount, merchant, reference,
          }),
        })

        if (!initResp.ok) {
          const body = await initResp.json().catch(() => ({ error: 'Initiate failed' })) as { error?: string }
          throw new Error(body.error ?? 'Initiate failed')
        }

        const record = await initResp.json() as FiatPaymentRecord
        setState(record.state)

        // Poll until SETTLED or FAILED (the server confirms the receipt)
        startPolling(fiatPaymentId)

      } catch (e: unknown) {
        const msg = (e instanceof Error ? e.message : 'Something went wrong')
        setErrorMsg(msg)
        setState('FAILED')
        setIsPending(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, state, onchainPaymentId, amount, merchant, reference])

  return {
    state,
    isPending,
    settlementTxHash,
    statusLabel: STATE_LABELS[state],
    errorMsg,
    start,
    isSandbox: true,
  }
}
