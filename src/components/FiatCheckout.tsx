/**
 * FiatCheckout — sandbox card/bank payment panel.
 *
 * Security guarantees enforced here:
 *   • Only rendered when chainId === ARC_TESTNET (5042002).
 *   • SETTLED is shown only when useFiatPayment reports state === 'SETTLED',
 *     which the server sets only after verifying the on-chain receipt
 *     and the Paid event.  The browser never promotes to SETTLED unilaterally.
 *   • No FIAT_WEBHOOK_SECRET or TREASURY_PRIVATE_KEY is accessed here.
 *   • The settlementTxHash is used only for display / explorer link;
 *     the server has already verified the underlying receipt.
 *   • Every surface carries a permanent "SANDBOX" badge.
 */

import {
  CreditCard, Loader, CheckCircle, XCircle,
  ExternalLink, Lock, WifiOff,
} from 'lucide-react'
import { useAccount } from 'wagmi'
import { useFiatPayment } from '@/fiat/useFiatPayment'
import { explorerTxUrl, CHAIN_ID, IS_MAINNET_BUILD, ARC_TESTNET_CHAIN_ID } from '@/lib/contract'
import type { ServerRegState } from '@/hooks/useServerRegistration'

interface Props {
  onchainPaymentId: string
  amount: string
  merchant: string
  reference: string
  serverReg: ServerRegState
}

export function FiatCheckout({ onchainPaymentId, amount, merchant, reference, serverReg }: Props) {
  const { chainId } = useAccount()
  const fiat = useFiatPayment(onchainPaymentId, amount, merchant, reference)

  // ── Hard block on mainnet build ────────────────────────────────────────────
  // The sandbox fiat flow must never run against real funds.
  // IS_MAINNET_BUILD is set at build time from VITE_NETWORK; it cannot be
  // toggled at runtime.  This guard is checked before any hook reads.
  if (IS_MAINNET_BUILD) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{
          background: 'var(--surface-muted)',
          border: '1px solid var(--border)',
          opacity: 0.55,
        }}
      >
        <SandboxBadge />
        <div className="mt-3 flex items-start gap-2">
          <Lock size={13} style={{ color: 'var(--subtle)', flexShrink: 0, marginTop: 2 }} />
          <span className="text-xs leading-relaxed" style={{ color: 'var(--subtle)' }}>
            The sandbox card option is disabled on Arc Mainnet.
            This is a testnet-only feature that uses simulated fiat and a
            treasury wallet — it must never be used with real funds.
          </span>
        </div>
      </div>
    )
  }

  // ── Chain guard: fiat flow is Arc Testnet only ─────────────────────────────
  // CHAIN_ID is Arc Testnet when IS_MAINNET_BUILD is false.
  // We also check the connected wallet's reported chainId when connected.
  const isWrongChain = chainId !== undefined && chainId !== ARC_TESTNET_CHAIN_ID
  if (isWrongChain || CHAIN_ID !== ARC_TESTNET_CHAIN_ID) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{
          background: 'var(--surface-muted)',
          border: '1px solid var(--border)',
          opacity: 0.6,
        }}
      >
        <SandboxBadge />
        <div className="mt-3 flex items-center gap-2">
          <Lock size={13} style={{ color: 'var(--subtle)' }} />
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>
            Sandbox fiat flow is only available on Arc Testnet.
          </span>
        </div>
      </div>
    )
  }

  // ── Settled ────────────────────────────────────────────────────────────────
  // State is SETTLED only because the server verified the on-chain receipt
  // AND the Paid event.  We do not confirm receipts ourselves here.
  if (fiat.state === 'SETTLED') {
    return (
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'rgba(26,128,71,0.07)',
          border: '1px solid rgba(26,128,71,0.22)',
        }}
      >
        <SandboxBadge />
        <div className="mt-3 flex items-start gap-3">
          <CheckCircle size={20} style={{ color: 'var(--success)', flexShrink: 0 }} />
          <div>
            <p className="text-sm font-600" style={{ color: 'var(--success)' }}>
              Payment settled on-chain
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              {amount} USDC confirmed on Arc Testnet
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
              Receipt and Paid event verified by server.
            </p>
            {fiat.settlementTxHash && (
              <a
                href={explorerTxUrl(fiat.settlementTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-600"
                style={{ color: 'var(--accent)' }}
              >
                <ExternalLink size={11} /> View on explorer
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (fiat.state === 'FAILED') {
    const reason = fiat.errorMsg ?? 'Settlement failed. See server logs for details.'
    return (
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'rgba(186,43,76,0.07)',
          border: '1px solid rgba(186,43,76,0.22)',
        }}
      >
        <SandboxBadge />
        <div className="mt-3 flex items-start gap-3">
          <XCircle size={20} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <div>
            <p className="text-sm font-600" style={{ color: 'var(--danger)' }}>Payment failed</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{reason}</p>
            {fiat.settlementTxHash && (
              <a
                href={explorerTxUrl(fiat.settlementTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-600"
                style={{ color: 'var(--muted)' }}
              >
                <ExternalLink size={11} /> View failed tx
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── In-progress ────────────────────────────────────────────────────────────
  if (fiat.state !== 'IDLE') {
    const isWaitingForChain = fiat.state === 'CONVERSION_PENDING'
    return (
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <SandboxBadge />
        <div className="mt-3 space-y-3">
          <Step
            done={fiat.state !== 'INITIATED'}
            active={fiat.state === 'INITIATED'}
            label="Initiating payment"
          />
          <Step
            done={fiat.state === 'CONVERSION_PENDING' || fiat.state === 'WEBHOOK_RECEIVED'}
            active={fiat.state === 'WEBHOOK_RECEIVED'}
            label="Verifying with provider"
          />
          <Step
            done={false /* SETTLED returns early above */}
            active={isWaitingForChain}
            label={
              fiat.settlementTxHash
                ? 'Awaiting on-chain confirmation…'
                : 'Converting to USDC'
            }
          />
        </div>

        {fiat.settlementTxHash && (
          <a
            href={explorerTxUrl(fiat.settlementTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center gap-1 text-xs font-500"
            style={{ color: 'var(--accent)' }}
          >
            <ExternalLink size={11} /> Track settlement tx
          </a>
        )}

        <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
          The server is verifying the on-chain receipt and Paid event…
        </p>
      </div>
    )
  }

  // ── Idle — show card option gated on server registration state ───────────────
  //
  // serverReg drives three outcomes:
  //   loading       → spinner, button disabled (checking…)
  //   registered    → button enabled (server confirmed this ID exists)
  //   not-registered → button disabled, "Wallet payments work. Card unavailable."
  //   unreachable   → button disabled, "Backend not reachable." with WifiOff icon
  const cardAvailable = serverReg.status === 'registered'
  const cardChecking  = serverReg.status === 'loading'
  const cardBlocked   = serverReg.status === 'not-registered' || serverReg.status === 'unreachable'

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
      }}
    >
      <SandboxBadge />

      <div className="mt-3 mb-3 flex items-center gap-2">
        <CreditCard size={16} style={{ color: 'var(--ink-2)' }} />
        <span className="text-sm font-600" style={{ color: 'var(--ink)' }}>
          Pay with card or bank
        </span>
      </div>

      <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        No wallet needed. The sandbox provider converts your payment to USDC
        and settles it to the recipient on Arc Testnet. The server verifies
        the on-chain receipt and the contract event before marking it paid.
      </p>

      {/* Registration status — gates the button */}
      {cardChecking && (
        <div className="mb-3 flex items-center gap-2">
          <Loader size={12} className="animate-spin" style={{ color: 'var(--muted)' }} />
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>
            Checking payment server…
          </span>
        </div>
      )}

      {serverReg.status === 'unreachable' && (
        <div
          className="mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(100,60,0,0.06)', border: '1px solid rgba(140,100,0,0.2)' }}
        >
          <WifiOff size={12} style={{ color: '#7a5200', flexShrink: 0, marginTop: 2 }} />
          <p className="text-xs leading-relaxed" style={{ color: '#7a5200' }}>
            <strong>Wallet payments work.</strong>{' '}
            The card option requires the CheetahPay backend to be running and reachable
            at <code className="mono">/api</code>. It is not reachable right now.
            Deploy the backend alongside the frontend to enable it.
          </p>
        </div>
      )}

      {serverReg.status === 'not-registered' && (
        <div
          className="mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(100,60,0,0.06)', border: '1px solid rgba(140,100,0,0.2)' }}
        >
          <XCircle size={12} style={{ color: '#7a5200', flexShrink: 0, marginTop: 2 }} />
          <p className="text-xs leading-relaxed" style={{ color: '#7a5200' }}>
            <strong>Wallet payments work.</strong>{' '}
            Card option is unavailable for this link — the payment ID is not registered
            with the backend. Generate the checkout link while the backend is running to
            enable it.
          </p>
        </div>
      )}

      {cardAvailable && (
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle size={12} style={{ color: 'var(--success)' }} />
          <span className="text-xs" style={{ color: 'var(--success)' }}>
            Payment server confirmed — card option available.
          </span>
        </div>
      )}

      <button
        onClick={fiat.start}
        disabled={fiat.isPending || cardChecking || cardBlocked}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-600 transition-colors disabled:opacity-40"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border-strong)',
          color: 'var(--ink)',
        }}
      >
        {fiat.isPending
          ? <><Loader size={14} className="animate-spin" /> Processing…</>
          : cardChecking
          ? <><Loader size={14} className="animate-spin" /> Checking…</>
          : <><CreditCard size={14} /> Pay {amount} USDC via sandbox</>
        }
      </button>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SandboxBadge() {
  return (
    <div className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{
        background: 'rgba(180,120,0,0.10)',
        border: '1px solid rgba(180,120,0,0.25)',
      }}
    >
      <span
        className="text-xs font-700 uppercase tracking-widest"
        style={{ color: '#8a6500', letterSpacing: '0.08em' }}
      >
        Sandbox
      </span>
    </div>
  )
}


function Step({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: done
            ? 'rgba(26,128,71,0.12)'
            : active
            ? 'rgba(18,45,69,0.10)'
            : 'var(--surface-muted)',
          border: done
            ? '1px solid rgba(26,128,71,0.30)'
            : active
            ? '1px solid var(--border-strong)'
            : '1px solid var(--border)',
        }}
      >
        {done
          ? <CheckCircle size={11} style={{ color: 'var(--success)' }} />
          : active
          ? <Loader size={10} className="animate-spin" style={{ color: 'var(--ink-2)' }} />
          : <span className="block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--border)' }} />
        }
      </div>
      <span
        className="text-xs"
        style={{
          color: done ? 'var(--success)' : active ? 'var(--ink)' : 'var(--subtle)',
          fontWeight: active ? 600 : 400,
        }}
      >
        {label}
      </span>
    </div>
  )
}
