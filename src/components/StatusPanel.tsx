/**
 * StatusPanel — reads live on-chain payment state from PaymentRouter.getPayment().
 * Only shows "Paid" when the contract confirms it. Never uses local state as truth.
 *
 * Props:
 *   paymentId      — the bytes32 onchain payment ID (from the checkout URL)
 *   payTxHash      — optional tx hash to show an explorer link (wallet OR fiat settlement)
 *   triggerRefetch — bump this number (e.g. Date.now()) to force an immediate refetch.
 *                    Use after a fiat settlement completes so the panel doesn't wait
 *                    for the next 4-second poll cycle.
 */
import { useReadContract } from 'wagmi'
import { useEffect } from 'react'
import { CheckCircle, Clock, XCircle, ExternalLink, RefreshCw } from 'lucide-react'
import {
  PAYMENT_ROUTER_ADDRESS, PAYMENT_ROUTER_ABI, CHAIN_ID,
  explorerAddrUrl, explorerTxUrl,
} from '@/lib/contract'
import { formatUsdc as _fmtUsdc, shortAddr } from '@/lib/utils'

const formatUsdc = _fmtUsdc // still used for payment.amount display

// PaymentStatus enum: 0=NonExistent, 1=Paid
const STATUS_LABEL: Record<number, string> = {
  0: 'Not found',
  1: 'Confirmed',
}

interface Props {
  paymentId:      `0x${string}`
  payTxHash?:     `0x${string}`
  /** Bump to force an immediate refetch without waiting for the poll cycle. */
  triggerRefetch?: number
}

export function StatusPanel({ paymentId, payTxHash, triggerRefetch }: Props) {
  const {
    data: payment,
    isLoading,
    isError,
    refetch,
  } = useReadContract({
    address: PAYMENT_ROUTER_ADDRESS,
    abi: PAYMENT_ROUTER_ABI,
    functionName: 'getPayment',
    args: [paymentId],
    chainId: CHAIN_ID,
    query: {
      refetchInterval: 4000, // poll every 4 s
    },
  })

  // Immediate refetch when the parent signals a payment just completed
  // (e.g. fiat settlement confirmed server-side). Without this the panel
  // would show "Not found" for up to 4 s after a card payment settles.
  useEffect(() => {
    if (triggerRefetch) void refetch()
  }, [triggerRefetch, refetch])

  const status = payment ? Number(payment.status) : -1

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-600 uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
          Payment status
        </p>
        <button
          onClick={() => void refetch()}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-600"
          style={{ color: 'var(--accent)', background: 'var(--surface-muted)' }}
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2">
          <Clock size={16} style={{ color: 'var(--subtle)' }} className="animate-pulse" />
          <span className="text-sm" style={{ color: 'var(--muted)' }}>Reading chain…</span>
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div className="flex items-center gap-2">
          <XCircle size={16} style={{ color: 'var(--danger)' }} />
          <span className="text-sm" style={{ color: 'var(--danger)' }}>Could not read contract.</span>
        </div>
      )}

      {/* Data */}
      {!isLoading && !isError && payment && (
        <div className="space-y-3">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <StatusIcon status={status} />
            <span
              className="text-base font-600"
              style={{ color: statusColor(status) }}
            >
              {STATUS_LABEL[status] ?? 'Unknown'}
            </span>
          </div>

          {/* Fields — only render for known payments */}
          {status > 0 && (
            <>
              <Field label="Amount">
                <span className="tabular-nums font-600" style={{ color: 'var(--ink)' }}>
                  {formatUsdc(payment.amount)} USDC
                </span>
              </Field>

              <Field label="Payer">
                <a
                  href={explorerAddrUrl(payment.payer)}
                  target="_blank" rel="noopener noreferrer"
                  className="mono text-xs hover:underline"
                  style={{ color: 'var(--ink-2)' }}
                >
                  {shortAddr(payment.payer)}
                </a>
              </Field>

              <Field label="Merchant">
                <a
                  href={explorerAddrUrl(payment.merchant)}
                  target="_blank" rel="noopener noreferrer"
                  className="mono text-xs hover:underline"
                  style={{ color: 'var(--ink-2)' }}
                >
                  {shortAddr(payment.merchant)}
                </a>
              </Field>

              {/* Refund functionality removed in this version — roadmap item */}
            </>
          )}

          {/* Explorer links */}
          <div className="flex flex-wrap gap-2 pt-1">
            {payTxHash && (
              <a
                href={explorerTxUrl(payTxHash)}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                  textDecoration: 'none',
                }}
              >
                <ExternalLink size={11} /> Tx on explorer
              </a>
            )}
            <a
              href={explorerAddrUrl(PAYMENT_ROUTER_ADDRESS)}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600"
              style={{
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
                textDecoration: 'none',
              }}
            >
              <ExternalLink size={11} /> Contract
            </a>
          </div>
        </div>
      )}

      {/* Not-found state */}
      {!isLoading && !isError && payment && status === 0 && (
        <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
          No payment recorded on-chain for this ID yet.
          The page will refresh every 4 seconds.
        </p>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: number) {
  if (status === 1) return 'var(--success)'
  return 'var(--subtle)'
}

function StatusIcon({ status }: { status: number }) {
  if (status === 1) return <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
  return <Clock size={18} style={{ color: 'var(--subtle)', flexShrink: 0 }} />
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between py-2"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <span className="text-xs font-500" style={{ color: 'var(--subtle)' }}>{label}</span>
      {children}
    </div>
  )
}
