import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches runtime errors anywhere in the subtree and renders a recovery UI
 * instead of a blank screen. Works with React class-component error boundary
 * semantics (required by React — no hooks equivalent for componentDidCatch).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state

    if (error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div
          className="min-h-dvh flex items-center justify-center p-6"
          style={{ background: 'var(--bg-gradient)' }}
        >
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
              Something went wrong
            </h2>

            <p
              className="mb-1 text-sm"
              style={{ color: 'var(--muted)' }}
            >
              An unexpected error occurred.
            </p>

            <p
              className="mono mb-6 rounded-lg px-3 py-2 text-xs break-all"
              style={{
                color: 'var(--danger)',
                background: 'rgba(186, 43, 76, 0.06)',
              }}
            >
              {error.message}
            </p>

            <button
              onClick={this.reset}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-600 transition-colors"
              style={{
                background: 'var(--accent)',
                color: '#ffffff',
              }}
              onMouseEnter={e =>
                ((e.currentTarget).style.background =
                  'var(--accent-hover)')
              }
              onMouseLeave={e =>
                ((e.currentTarget).style.background =
                  'var(--accent)')
              }
            >
              <RefreshCw size={15} />
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
