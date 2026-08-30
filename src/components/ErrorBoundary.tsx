import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset)
      return (
        <div className="min-h-screen bg-neutral-950 text-white p-6 flex flex-col items-center justify-center gap-4">
          <p className="text-red-400 font-bold text-lg">Error al cargar la página</p>
          <pre className="text-xs text-neutral-400 bg-neutral-900 rounded-xl p-4 max-w-sm w-full overflow-auto whitespace-pre-wrap break-all">
            {error.message}
          </pre>
          <button
            onClick={this.reset}
            className="px-6 py-2 bg-orange-500 hover:bg-orange-600 rounded-full font-semibold transition"
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
