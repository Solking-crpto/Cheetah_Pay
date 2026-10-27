/**
 * useServerRegistration
 *
 * Checks whether a payment ID is registered with the CheetahPay backend.
 * Used by CheckoutPage to decide whether the card payment option can be enabled.
 *
 * Behaviour:
 *   - Issues GET /api/payment-request/:id once on mount (and whenever id changes).
 *   - 200 → registered = true  (card option enabled)
 *   - 404 → registered = false (card option disabled with explanation)
 *   - Network error → unreachable = true (card option shows "backend not reachable")
 *   - Does NOT block the wallet payment path; result is advisory only.
 */
import { useState, useEffect } from 'react'

export type ServerRegState =
  | { status: 'loading' }
  | { status: 'registered' }
  | { status: 'not-registered' }   // backend up but ID not found
  | { status: 'unreachable' }      // network error or health check failed

export function useServerRegistration(onchainPaymentId: string): ServerRegState {
  // Derive initial status synchronously — avoids a setState call inside the effect
  // for the empty-ID case, which the linter flags as a cascade-render risk.
  const [state, setState] = useState<ServerRegState>(
    () => onchainPaymentId
      ? { status: 'loading' }
      : { status: 'not-registered' },
  )

  useEffect(() => {
    // onchainPaymentId is constant per checkout page (comes from URL params).
    // The loading state is already set by the useState initializer above,
    // so we do not call setState synchronously here.
    if (!onchainPaymentId) return

    let cancelled = false

    void (async () => {
      try {
        // First do a fast health check so we can distinguish "backend down"
        // from "backend up but ID not registered".
        const health = await fetch('/api/health', { signal: AbortSignal.timeout(3000) })
        if (!health.ok) { if (!cancelled) setState({ status: 'unreachable' }); return }

        const resp = await fetch(
          `/api/payment-request/${encodeURIComponent(onchainPaymentId)}`,
          { signal: AbortSignal.timeout(5000) },
        )
        if (cancelled) return

        if (resp.ok) {
          setState({ status: 'registered' })
        } else if (resp.status === 404) {
          setState({ status: 'not-registered' })
        } else {
          setState({ status: 'unreachable' })
        }
      } catch {
        if (!cancelled) setState({ status: 'unreachable' })
      }
    })()

    return () => { cancelled = true }
  }, [onchainPaymentId])

  return state
}
