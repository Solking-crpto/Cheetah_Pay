import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ArrowRight, Loader, CheckCircle, XCircle, ExternalLink, Zap, AlertTriangle } from 'lucide-react'
import {
  PAYMENT_ROUTER_ADDRESS, PAYMENT_ROUTER_ABI,
  USDC_ADDRESS, ERC20_ABI, CHAIN_ID, CHAIN_NAME,
  IS_MAINNET_BUILD,
  explorerTxUrl, explorerAddrUrl,
} from '@/lib/contract'
import { parseUsdc, formatUsdc as _formatUsdc, shortAddr, parseOnchainError } from '@/lib/utils'
import { WrongNetwork } from './WrongNetwork'

// re-export so StatusPanel can import from here without a circular dep
export { _formatUsdc as formatUsdc }

interface CheckoutParams {
  id: `0x${string}`
  merchant: string
  amount: string
  ref: string
}

interface Props {
  params: CheckoutParams
}

export function CheckoutPage({ params }: Props) {
  const { address, isConnected, chainId } = useAccount()

  const amountRaw = parseUsdc(params.amount)
  const merchantAddr = params.merchant as `0x${string}`

  // Check whether the server has this payment ID registered.
  // Used to decide whether the card option is available.

  // ── Read: current allowance ────────────────────────────────────────────────
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address ?? '0x0000000000000000000000000000000000000000', PAYMENT_ROUTER_ADDRESS],
    chainId: CHAIN_ID,
    query: { enabled: isConnected && !!address },
  })

  // ── Read: existing payment record (prevents re-paying) ─────────────────────
  const { data: existingPayment } = useReadContract({
    address: PAYMENT_ROUTER_ADDRESS,
    abi: PAYMENT_ROUTER_ABI,
    functionName: 'getPayment',
    args: [params.id],
    chainId: CHAIN_ID,
  })

  // ── Read: contract paused ──────────────────────────────────────────────────
  const { data: isPaused } = useReadContract({
    address: PAYMENT_ROUTER_ADDRESS,
    abi: PAYMENT_ROUTER_ABI,
    functionName: 'paused',
    chainId: CHAIN_ID,
  })

  // ── Approve ───────────────────────────────────────────────────────────────
  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: approveWalletPending,
    isError: approveSubmitError,
    error: approveSubmitErr,
  } = useWriteContract()

  const {
    isLoading: approveConfirming,
    isSuccess: approveSuccess,
  } = useWaitForTransactionReceipt({ hash: approveHash })

  // ── Pay ───────────────────────────────────────────────────────────────────
  const {
    writeContract: writePay,
    data: payHash,
    isPending: payWalletPending,
    isError: paySubmitError,
    error: paySubmitErr,
  } = useWriteContract()

  const {
    isLoading: payConfirming,
    isSuccess: paySuccess,
    isError: payReceiptError,
    error: payReceiptErr,
  } = useWaitForTransactionReceipt({ hash: payHash })

  // ── Derived state (no effects needed) ─────────────────────────────────────
  const alreadyPaid = existingPayment && existingPayment.status !== 0
  const hasAllowance = allowance !== undefined && allowance >= amountRaw
  const isWrongChain = isConnected && chainId !== CHAIN_ID

  const isBusy =
    approveWalletPending || approveConfirming ||
    payWalletPending    || payConfirming

  // Step labels: derive from hook states, no separate step state
  const statusLine: string | null =
    approveWalletPending  ? 'Waiting for wallet approval…'    :
    approveConfirming     ? 'Confirming allowance on-chain…'  :
    payWalletPending      ? 'Waiting for wallet confirmation…':
    payConfirming         ? 'Broadcasting payment…'           :
    null

  // Error: first error that materialized
  const errorMsg: string | null =
    approveSubmitError  ? parseOnchainError(approveSubmitErr)              :
    paySubmitError      ? parseOnchainError(paySubmitErr)                  :
    payReceiptError     ? parseOnchainError(payReceiptErr)                 :
    null

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleApprove() {
    writeApprove({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PAYMENT_ROUTER_ADDRESS, amountRaw],
      chainId: CHAIN_ID,
    })
  }

  function handlePay() {
    writePay({
      address: PAYMENT_ROUTER_ADDRESS,
      abi: PAYMENT_ROUTER_ABI,
      functionName: 'pay',
      args: [params.id, USDC_ADDRESS, merchantAddr, amountRaw],
      chainId: CHAIN_ID,
    })
  }

  // After approve success, refetch allowance so Step 2 unlocks without a page reload
  if (approveSuccess) void refetchAllowance()

  // ── Guards ────────────────────────────────────────────────────────────────
  if (isWrongChain) return <WrongNetwork />

  // ── Success screen ────────────────────────────────────────────────────────
  if (paySuccess) {
    return (
      <div
        className="w-full rounded-2xl p-8 text-center"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: 'rgba(26,128,71,0.12)' }}
        >
          <CheckCircle size={28} style={{ color: 'var(--success)' }} />
        </div>
        <h2
          className="display mb-1 text-2xl font-700"
          style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}
        >
          Payment sent
        </h2>
        <p className="mb-1 text-sm" style={{ color: 'var(--muted)' }}>
          {params.amount} USDC → {shortAddr(params.merchant)}
        </p>
        {params.ref && (
          <p className="mb-5 text-xs" style={{ color: 'var(--subtle)' }}>{params.ref}</p>
        )}
        {payHash && (
          <a
            href={explorerTxUrl(payHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-600"
            style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={14} />
            View on explorer
          </a>
        )}
      </div>
    )
  }

  // ── Main checkout UI ──────────────────────────────────────────────────────
  return (
    <>
      {/* Brand */}
      <div className="flex items-center justify-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--accent)' }}>
          <Zap size={14} color="#fff" strokeWidth={2.2} />
        </div>
        <span className="display text-base font-600" style={{ color: 'var(--ink)' }}>CheetahPay</span>
      </div>

      {/* Mainnet warning — shown prominently above the order card */}
      {IS_MAINNET_BUILD && (
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3"
          style={{
            background: 'rgba(186,43,76,0.07)',
            border:     '1px solid rgba(186,43,76,0.28)',
          }}
        >
          <AlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--danger)' }}>
            <strong>Arc Mainnet — real funds.</strong>{' '}
            Payments are irreversible. Verify the recipient address and amount
            before approving. This contract has not been independently audited.
          </p>
        </div>
      )}

      {/* Order summary */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'var(--surface-strong)',
          border: IS_MAINNET_BUILD
            ? '1px solid rgba(186,43,76,0.30)'
            : '1px solid var(--border)',
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* Network badge — prominent, at the top of the card */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-600 uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Amount due
          </p>
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5"
            style={{
              background: IS_MAINNET_BUILD
                ? 'rgba(186,43,76,0.09)'
                : 'rgba(18,45,69,0.07)',
              border: IS_MAINNET_BUILD
                ? '1px solid rgba(186,43,76,0.30)'
                : '1px solid var(--border)',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: IS_MAINNET_BUILD ? 'var(--danger)' : 'var(--success)' }}
            />
            <span
              className="text-xs font-600"
              style={{ color: IS_MAINNET_BUILD ? 'var(--danger)' : 'var(--ink-2)' }}
            >
              {CHAIN_NAME}
            </span>
          </div>
        </div>

        <p
          className="display mb-4 text-4xl font-700 tabular-nums"
          style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}
        >
          {params.amount}
          <span className="ml-2 text-lg font-500" style={{ color: 'var(--muted)' }}>USDC</span>
        </p>

        <div className="space-y-0">
          {/* Recipient — full address, always visible */}
          <Row label="Recipient">
            <a
              href={explorerAddrUrl(params.merchant)}
              target="_blank" rel="noopener noreferrer"
              className="mono block text-xs font-500 hover:underline break-all"
              style={{ color: 'var(--ink-2)' }}
            >
              {params.merchant}
            </a>
          </Row>

          {params.ref && (
            <Row label="Ref">
              <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{params.ref}</span>
            </Row>
          )}

          {/* Contract address — full address, linked to explorer */}
          <Row label="Contract">
            <a
              href={explorerAddrUrl(PAYMENT_ROUTER_ADDRESS)}
              target="_blank" rel="noopener noreferrer"
              className="mono block text-xs font-500 hover:underline break-all"
              style={{ color: 'var(--accent)' }}
            >
              {PAYMENT_ROUTER_ADDRESS}
            </a>
          </Row>
        </div>
      </div>

      {/* Already-paid notice */}
      {alreadyPaid && (
        <Notice kind="success">This payment ID is already confirmed on-chain.</Notice>
      )}

      {/* Paused notice */}
      {isPaused && !alreadyPaid && (
        <Notice kind="warn">The payment contract is currently paused. Try again later.</Notice>
      )}

      {/* Error */}
      {errorMsg && !isBusy && (
        <Notice kind="error">{errorMsg}</Notice>
      )}

      {/* Progress */}
      {isBusy && statusLine && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-3"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <Loader size={15} className="animate-spin" style={{ color: 'var(--accent)' }} />
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{statusLine}</span>
        </div>
      )}

      {/* Approve tx link after success */}
      {approveHash && approveSuccess && !approveWalletPending && !approveConfirming && (
        <div
          className="flex items-center justify-between rounded-xl px-4 py-3"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Allowance set</span>
          <a
            href={explorerTxUrl(approveHash)}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-600"
            style={{ color: 'var(--accent)' }}
          >
            <ExternalLink size={11} /> View
          </a>
        </div>
      )}

      {/* CTA area */}
      {!isConnected && (
        <ConnectKitButton.Custom>
          {({ show, isConnecting }) => (
            <button
              onClick={show}
              disabled={isConnecting}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-600 disabled:opacity-60"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {isConnecting ? 'Connecting…' : 'Connect wallet to pay'}
            </button>
          )}
        </ConnectKitButton.Custom>
      )}

      {isConnected && !alreadyPaid && !isPaused && (
        <div className="space-y-2">
          {/* Step 1 — Approve */}
          <button
            onClick={handleApprove}
            disabled={isBusy || hasAllowance}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-600 transition-colors disabled:opacity-50"
            style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: hasAllowance ? 'var(--success)' : 'var(--ink)',
            }}
          >
            {hasAllowance
              ? <><CheckCircle size={15} style={{ color: 'var(--success)' }} /> Allowance approved</>
              : <>1 — Approve {params.amount} USDC</>
            }
          </button>

          {/* Step 2 — Pay */}
          <button
            onClick={handlePay}
            disabled={isBusy || !hasAllowance}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-600 transition-colors disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
            onMouseEnter={e => {
              if (hasAllowance && !isBusy)
                (e.currentTarget).style.background = 'var(--accent-hover)'
            }}
            onMouseLeave={e => {
              (e.currentTarget).style.background = 'var(--accent)'
            }}
          >
            {payWalletPending || payConfirming
              ? <><Loader size={14} className="animate-spin" /> Processing…</>
              : <>2 — Pay {params.amount} USDC <ArrowRight size={14} /></>
            }
          </button>
        </div>
      )}

      {isConnected && (
        <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
          Connected: {address ? shortAddr(address) : ''}
        </p>
      )}

      {/* ── Divider ──────────────────────────────────────────────────────── */}

      {/* ── Fiat option ────────────────────────────────────────────────── */}
    </>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-start justify-between gap-3 py-1.5"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      {/* shrink-0 stops the label from being squashed on narrow screens */}
      <span className="shrink-0 text-xs font-500 pt-0.5" style={{ color: 'var(--subtle)' }}>{label}</span>
      {/* min-w-0 lets break-all / overflow actually work inside flex */}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Notice({ kind, children }: { kind: 'success' | 'warn' | 'error'; children: React.ReactNode }) {
  const colors = {
    success: { bg: 'rgba(26,128,71,0.08)',  border: 'rgba(26,128,71,0.25)',  text: 'var(--success)' },
    warn:    { bg: 'rgba(180,120,0,0.08)',   border: 'rgba(180,120,0,0.25)',   text: '#8a6500'        },
    error:   { bg: 'rgba(186,43,76,0.08)',   border: 'rgba(186,43,76,0.25)',   text: 'var(--danger)'  },
  }[kind]
  const Icon = kind === 'success' ? CheckCircle : XCircle
  return (
    <div
      className="flex items-start gap-2 rounded-xl px-4 py-3"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <Icon size={14} style={{ color: colors.text, marginTop: 2, flexShrink: 0 }} />
      <span className="text-sm" style={{ color: colors.text }}>{children}</span>
    </div>
  )
}
