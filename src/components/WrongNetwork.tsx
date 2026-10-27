import { useSwitchChain } from 'wagmi'
import { AlertTriangle } from 'lucide-react'
import { CHAIN_ID, CHAIN_NAME } from '@/lib/contract'

export function WrongNetwork() {
  const { switchChain, isPending } = useSwitchChain()

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div
        className="w-full max-w-sm rounded-2xl p-8 text-center"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: 'rgba(186, 43, 76, 0.10)' }}
        >
          <AlertTriangle size={22} style={{ color: 'var(--danger)' }} />
        </div>
        <h2
          className="display mb-2 text-xl font-600"
          style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          Wrong network
        </h2>
        <p className="mb-6 text-sm" style={{ color: 'var(--muted)' }}>
          CheetahPay runs on <strong>{CHAIN_NAME}</strong>. Please switch your
          wallet to continue.
        </p>
        <button
          onClick={() => switchChain({ chainId: CHAIN_ID })}
          disabled={isPending}
          className="w-full rounded-xl px-4 py-3 text-sm font-600 transition-colors disabled:opacity-60"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {isPending ? 'Switching…' : `Switch to ${CHAIN_NAME}`}
        </button>
      </div>
    </div>
  )
}
