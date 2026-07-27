import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../lib/health';
import { EmptyMark } from './editorial/Editorial';

/** App-wide error boundary. Renders a recoverable fallback instead of a blank
 *  screen, and records a structured client error (no wallet data). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError('react-render', error, { componentStack: info.componentStack?.slice(0, 500) });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <div className="empty-state">
            <EmptyMark />
            <h2>Something went wrong</h2>
            <p className="muted">The interface hit an unexpected error. Your funds and on-chain state are unaffected.</p>
            <div className="hero-cta">
              <button onClick={() => window.location.reload()}>Reload</button>
              <a href="/" className="btn-ghost">Back to dashboard</a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
