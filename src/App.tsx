/**
 * App.tsx — hash-based routing shell.
 *
 * Routes:
 *   #             Merchant view (create payment request — no wallet required)
 *   #checkout?…   Customer checkout (wallet needed only to sign the tx)
 */
import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MerchantView } from './components/MerchantView'
import { CheckoutPage } from './components/CheckoutPage'
import { StatusPanel } from './components/StatusPanel'
import { WrongNetwork } from './components/WrongNetwork'
import { CHAIN_ID, IS_ROUTER_CONFIGURED } from './lib/contract'
import { isValidAddress, parseUsdc } from './lib/utils'

// ── URL helpers ────────────────────────────────────────────────────────────────

type Route =
  | { view: 'merchant' }
  | { view: 'checkout'; params: URLSearchParams }
  | { view: 'invalid' }

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash.startsWith('checkout?')) {
    return { view: 'checkout', params: new URLSearchParams(hash.slice('checkout?'.length)) }
  }
  return { view: 'merchant' }
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-md space-y-4">
        <div className="mb-8 flex items-center justify-between">
          <div className="h-6 w-32 animate-pulse rounded-lg" style={{ background: 'var(--border)' }} />
          <div className="h-9 w-28 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
        </div>
        <div
          className="rounded-2xl p-6"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', backdropFilter: 'blur(12px)' }}
        >
          {[1, 2, 3].map(i => (
            <div key={i} className="mb-3 h-10 w-full animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Invalid link screen ───────────────────────────────────────────────────────

function InvalidLink({ message }: { message: string }) {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div
        className="w-full max-w-sm rounded-2xl p-8 text-center"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--danger)' }}>{message}</p>
        <a
          href="#"
          className="mt-4 inline-block text-xs font-600"
          style={{ color: 'var(--accent)' }}
        >
          ← Create a payment request
        </a>
      </div>
    </div>
  )
}

// ── Router ────────────────────────────────────────────────────────────────────

function Router() {
  const { isConnected, isConnecting, isReconnecting, chainId } = useAccount()
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const handler = () => setRoute(parseHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  // Loading while wagmi reconnects
  if (isConnecting || isReconnecting) return <LoadingSkeleton />

  // ── Checkout ─────────────────────────────────────────────────────────────────
  if (route.view === 'checkout') {
    const p = route.params
    const id       = p.get('id') as `0x${string}` | null
    const merchant = p.get('merchant')
    const amount   = p.get('amount')
    const ref      = p.get('ref') ?? ''

    const validId = !!id && /^0x[0-9a-fA-F]{64}$/.test(id)
    const validMerchant = !!merchant && isValidAddress(merchant)
    let validAmount = false

    if (amount && /^\d+(?:\.\d{1,6})?$/.test(amount)) {
      try {
        validAmount = parseUsdc(amount) > 0n
      } catch {
        validAmount = false
      }
    }

    if (!validId || !validMerchant || !validAmount) {
      return <InvalidLink message="This checkout link is invalid or contains invalid payment details." />
    }

    if (!id || !merchant || !amount) {
      return <InvalidLink message="This checkout link is missing required payment details." />
    }

    if (!IS_ROUTER_CONFIGURED) {
      return <InvalidLink message="Checkout is unavailable because the payment router is not configured for this network." />
    }
    if (isConnected && chainId !== CHAIN_ID) return <WrongNetwork />

       return (
     <div className="min-h-dvh px-4 py-6">
       <div className="mx-auto w-full max-w-md space-y-4">
         <CheckoutPage params={{ id, merchant, amount, ref }} />
         <StatusPanel paymentId={id} />
       </div>
     </div>
   )
  }

  // ── Merchant (anonymous) ─────────────────────────────────────────────────────
  // No wallet connection required to create a payment request.
  return (
    <div className="min-h-dvh px-4 py-6">
      <MerchantView
        onLink={() => {
          // Navigation is handled via the Preview / Copy buttons inside MerchantView.
        }}
      />
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <Router />
    </ErrorBoundary>
  )
}
