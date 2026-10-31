/**
 * MerchantView — anonymous payment request creation.
 *
 * DESIGN: the checkout link is generated IMMEDIATELY client-side from the
 * validated form fields. It never depends on the backend. After the link is
 * shown, a background fetch attempts to register the request with the server
 * so the card payment option can be enabled. If that registration fails, the
 * link still works — wallet payments always work; only the card option is
 * affected.
 *
 * Wallet connection is OPTIONAL:
 *   • If connected: "Use connected wallet" fills both address fields.
 *   • If not connected: merchant types and confirms the address manually.
 */
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import {
  Copy, Check, Zap, ExternalLink, ArrowRight, AlertTriangle, Wallet,
} from 'lucide-react'
import { CHAIN_NAME, USDC_ADDRESS, PAYMENT_ROUTER_ADDRESS, IS_MAINNET_BUILD, IS_ROUTER_CONFIGURED, explorerAddrUrl } from '@/lib/contract'
import { generatePaymentId, parseUsdc, isValidAddress, checksumAddress } from '@/lib/utils'

const MAX_USDC = 5

interface Props {
  onLink: (paymentId: `0x${string}`, link: string) => void
}

export function MerchantView({ onLink }: Props) {
  const { address: connectedAddress, isConnected } = useAccount()

  const [amount, setAmount]           = useState('')
  const [reference, setReference]     = useState('')
  const [addr1, setAddr1]             = useState('')
  const [addr2, setAddr2]             = useState('')
  const [addr1Cs, setAddr1Cs]         = useState('')   // EIP-55 checksummed display
  const [copied, setCopied]           = useState(false)

  const [amountErr, setAmountErr]     = useState<string | null>(null)
  const [addr1Err, setAddr1Err]       = useState<string | null>(null)
  const [addr2Err, setAddr2Err]       = useState<string | null>(null)

  // Generated link — set immediately after client-side validation passes.
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [generatedId, setGeneratedId]     = useState<`0x${string}` | null>(null)

  // Background registration state — never blocks link generation.

  // ------------------------------------------------------------------
  // Address helpers
  // ------------------------------------------------------------------

  function updateAddr1(raw: string) {
    setAddr1(raw)
    setAddr1Err(null)
    if (!raw.trim() || !isValidAddress(raw.trim())) { setAddr1Cs(''); return }
    void checksumAddress(raw.trim()).then(setAddr1Cs)
  }

  function fillFromWallet() {
    if (!connectedAddress) return
    updateAddr1(connectedAddress)
    setAddr2(connectedAddress)
    setAddr2Err(null)
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  function validateAll(): boolean {
    let ok = true

    const num = parseFloat(amount)
    if (!amount || isNaN(num) || num <= 0) {
      setAmountErr('Enter a positive USDC amount.')
      ok = false
    } else if (!IS_MAINNET_BUILD && num > MAX_USDC) {
      // 5 USDC cap is a testnet sandbox limit only; not applied on mainnet.
      setAmountErr(`Maximum is ${MAX_USDC} USDC on the testnet sandbox.`)
      ok = false
    } else {
      try { parseUsdc(amount); setAmountErr(null) }
      catch { setAmountErr('Invalid amount format.'); ok = false }
    }

    const a1 = addr1.trim()
    if (!a1) {
      setAddr1Err('Enter the recipient wallet address.')
      ok = false
    } else if (!isValidAddress(a1)) {
      setAddr1Err('Not a valid Ethereum address (0x + 40 hex chars).')
      ok = false
    } else {
      setAddr1Err(null)
    }

    const a2 = addr2.trim()
    if (!a2) {
      setAddr2Err('Re-enter the address to confirm.')
      ok = false
    } else if (a1.toLowerCase() !== a2.toLowerCase()) {
      setAddr2Err('Addresses do not match.')
      ok = false
    } else {
      setAddr2Err(null)
    }

    return ok
  }

  // ------------------------------------------------------------------
  // Generate: client-side first, server registration in background
  // ------------------------------------------------------------------

  function handleGenerate() {
    if (!validateAll()) return

    if (!IS_ROUTER_CONFIGURED) {
      setAmountErr('The payment router is not configured for this network.')
      return
    }

    const merchant = addr1.trim().toLowerCase()
    const id = generatePaymentId(merchant, reference || 'payment')
    const params = new URLSearchParams({ id, merchant, amount, ref: reference || '' })
    const link = `${window.location.origin}${window.location.pathname}#checkout?${params.toString()}`

    setGeneratedLink(link)
    setGeneratedId(id)
    onLink(id, link)
  }
  // ------------------------------------------------------------------
  // Copy + in-app open
  // ------------------------------------------------------------------

  function handleCopy() {
    if (!generatedLink) return
    void navigator.clipboard.writeText(generatedLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  /**
   * Navigate to the checkout page within the same app by setting window.location.hash.
   * This works in the Arc Studio preview, locally, and on any deployed host — no new
   * tab, no localhost assumption, no dependency on window.location.origin being
   * reachable from outside.
   */
  function handleOpenCheckout() {
    if (!generatedId || !generatedLink) return
    // Extract just the hash fragment from the generated link (everything after '#')
    const hashIndex = generatedLink.indexOf('#')
    if (hashIndex !== -1) {
      window.location.hash = generatedLink.slice(hashIndex + 1)
    }
  }

  const addrMatch =
    addr1.trim() && addr2.trim() &&
    addr1.trim().toLowerCase() === addr2.trim().toLowerCase() &&
    isValidAddress(addr1.trim())

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="mx-auto w-full max-w-md space-y-4">

      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: 'var(--accent)' }}
        >
          <Zap size={14} color="#fff" strokeWidth={2.2} />
        </div>
        <span className="display text-base font-600" style={{ color: 'var(--ink)' }}>
          CheetahPay
        </span>
      </div>

      {/* Intro */}
      <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        No wallet connection required. Enter a recipient address, amount and
        optional reference to generate a shareable checkout link instantly.
      </p>

      {/* ── Form card ─────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 2px 16px rgba(18,45,69,0.06)',
        }}
      >
        <h2
          className="display mb-5 text-lg font-600"
          style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          Create payment request
        </h2>

        {/* Amount */}
        <div className="mb-4">
          <label
            className="mb-1.5 block text-xs font-600 uppercase tracking-widest"
            style={{ color: 'var(--subtle)' }}
          >
            Amount (USDC)
          </label>
          <div
            className="flex items-center rounded-xl px-4 py-3"
            style={{
              background: 'var(--surface-muted)',
              border: `1px solid ${amountErr ? 'var(--danger)' : 'var(--border)'}`,
            }}
          >
            <input
              type="number"
              min="0.000001"
              max={MAX_USDC}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={e => { setAmount(e.target.value); setAmountErr(null) }}
              className="w-full bg-transparent text-xl font-600 tabular-nums outline-none"
              style={{ color: 'var(--ink)' }}
            />
            <span className="ml-2 text-sm font-600" style={{ color: 'var(--muted)' }}>USDC</span>
          </div>
          {amountErr
            ? <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{amountErr}</p>
            : !IS_MAINNET_BUILD
            ? <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Testnet sandbox cap: {MAX_USDC} USDC</p>
            : <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Arc Mainnet — real funds</p>
          }
        </div>

        {/* Reference */}
        <div className="mb-4">
          <label
            className="mb-1.5 block text-xs font-600 uppercase tracking-widest"
            style={{ color: 'var(--subtle)' }}
          >
            Reference{' '}
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Invoice #1042"
            value={reference}
            onChange={e => setReference(e.target.value)}
            maxLength={80}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
            }}
          />
        </div>

        {/* Recipient address */}
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <label
              className="text-xs font-600 uppercase tracking-widest"
              style={{ color: 'var(--subtle)' }}
            >
              Recipient address
            </label>
            {/* Optional wallet fill */}
            {isConnected && connectedAddress ? (
              <button
                type="button"
                onClick={fillFromWallet}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-600"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink-2)',
                }}
              >
                <Wallet size={11} />
                Use connected wallet
              </button>
            ) : (
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <button
                    type="button"
                    onClick={show}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-600"
                    style={{
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                    }}
                  >
                    <Wallet size={11} />
                    Connect wallet to fill
                  </button>
                )}
              </ConnectKitButton.Custom>
            )}
          </div>

          <input
            type="text"
            placeholder="0x…"
            value={addr1}
            onChange={e => updateAddr1(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="mono w-full rounded-xl px-4 py-3 text-xs outline-none"
            style={{
              background: 'var(--surface-muted)',
              border: `1px solid ${addr1Err ? 'var(--danger)' : 'var(--border)'}`,
              color: 'var(--ink)',
            }}
          />
          {addr1Err && (
            <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{addr1Err}</p>
          )}
          {addr1Cs && !addr1Err && (
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
              Checksummed:{' '}
              <span className="mono font-500" style={{ color: 'var(--ink-2)' }}>{addr1Cs}</span>
            </p>
          )}
        </div>

        {/* Confirm address */}
        <div className="mb-5">
          <label
            className="mb-1.5 block text-xs font-600 uppercase tracking-widest"
            style={{ color: 'var(--subtle)' }}
          >
            Confirm address
          </label>
          <input
            type="text"
            placeholder="Re-enter recipient address"
            value={addr2}
            onChange={e => { setAddr2(e.target.value); setAddr2Err(null) }}
            spellCheck={false}
            autoComplete="off"
            className="mono w-full rounded-xl px-4 py-3 text-xs outline-none"
            style={{
              background: 'var(--surface-muted)',
              border: `1px solid ${
                addr2Err   ? 'var(--danger)' :
                addrMatch  ? 'rgba(26,128,71,0.4)' :
                'var(--border)'
              }`,
              color: 'var(--ink)',
            }}
          />
          {addr2Err && (
            <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{addr2Err}</p>
          )}
          {!addr2Err && addrMatch && (
            <p className="mt-1 text-xs" style={{ color: 'var(--success)' }}>Addresses match.</p>
          )}
        </div>

        {/* Address warning */}
        <div
          className="mb-5 flex items-start gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(180,120,0,0.06)', border: '1px solid rgba(180,120,0,0.18)' }}
        >
          <AlertTriangle size={13} style={{ color: '#8a6500', flexShrink: 0, marginTop: 2 }} />
          <p className="text-xs leading-relaxed" style={{ color: '#8a6500' }}>
            <strong>Double-check the address.</strong> USDC sent to a wrong address
            is not recoverable.{IS_MAINNET_BUILD ? ' Arc Mainnet — real funds.' : ' This link is for testnet only.'}
          </p>
        </div>

        {/* Generate button — never disabled by backend state */}
        <button
          onClick={handleGenerate}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-600 transition-colors"
          style={{ background: 'var(--accent)', color: '#fff' }}
          onMouseEnter={e => { (e.currentTarget).style.background = 'var(--accent-hover)' }}
          onMouseLeave={e => { (e.currentTarget).style.background = 'var(--accent)' }}
        >
          Generate checkout link
        </button>
      </div>

      {/* ── Generated link ─────────────────────────────────────────────────── */}
      {generatedLink && generatedId && (
        <div
          className="rounded-2xl p-5"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <p
            className="mb-3 text-xs font-600 uppercase tracking-widest"
            style={{ color: 'var(--subtle)' }}
          >
            Checkout link
          </p>

          {/* Link display */}
          <div
            className="mono mb-3 break-all rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
          >
            {generatedLink}
          </div>

          {/* Actions: Open (in-app), Copy, external Preview */}
          <div className="flex gap-2">
            {/* Primary: open checkout within the same app — works in preview, deployed, everywhere */}
            <button
              onClick={handleOpenCheckout}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-600 transition-colors"
              style={{ background: 'var(--accent)', color: '#fff' }}
              onMouseEnter={e => { (e.currentTarget).style.background = 'var(--accent-hover)' }}
              onMouseLeave={e => { (e.currentTarget).style.background = 'var(--accent)' }}
            >
              <ArrowRight size={14} />
              Open checkout
            </button>

            {/* Copy link to clipboard */}
            <button
              onClick={handleCopy}
              className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-600 transition-colors"
              style={{
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
              title="Copy link to clipboard"
            >
              {copied ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Copy size={14} />}
            </button>

            {/* External link — opens in a new tab using the full URL */}
            <a
              href={generatedLink ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 rounded-xl px-3 py-2.5 text-sm font-600"
              style={{
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
                textDecoration: 'none',
              }}
              title="Open in new tab"
            >
              <ExternalLink size={13} />
            </a>
          </div>

          <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
            Wallet payments are available on this link. Card and bank payments are not currently supported.
          </p>

          {/* Summary */}
          <div
            className="mt-4 space-y-2 rounded-xl p-3"
            style={{ background: 'var(--surface-muted)' }}
          >
            <SummaryRow label="Recipient">
              <a
                href={explorerAddrUrl(addr1.trim())}
                target="_blank" rel="noopener noreferrer"
                className="mono text-xs hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                {addr1Cs || addr1.trim()}
              </a>
            </SummaryRow>
            <SummaryRow label="Amount">
              <span className="tabular-nums font-600" style={{ color: 'var(--ink)' }}>
                {amount} USDC
              </span>
            </SummaryRow>
            <SummaryRow label="Network">
              <span style={{ color: 'var(--ink-2)' }}>{CHAIN_NAME}</span>
            </SummaryRow>
            <SummaryRow label="Payment ID">
              <span className="mono break-all text-xs" style={{ color: 'var(--ink-2)' }}>
                {generatedId}
              </span>
            </SummaryRow>
          </div>

          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--subtle)' }}>
            Share this link with your customer.{' '}
            USDC on {CHAIN_NAME} ·{' '}
            <a
              href={`https://explorer.testnet.arc.io/address/${USDC_ADDRESS}`}
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              USDC token
            </a>
            {' '}·{' '}
            <a
              href={`https://explorer.testnet.arc.io/address/${PAYMENT_ROUTER_ADDRESS}`}
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Router contract
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</span>
      {children}
    </div>
  )
}
