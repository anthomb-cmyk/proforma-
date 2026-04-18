// Minimal ErrorBoundary for lazy-loaded pages.
//
// Two failure modes this catches in practice:
//   1. React.lazy() chunk-load rejects (network blip, stale cache-busting
//      hash, ad blocker). Without a boundary the whole app white-screens.
//   2. Render throws inside a page (bad row shape in localStorage, etc).
//
// Kept intentionally small: no telemetry hook, no fancy UI. The primary
// affordance is a single "Réessayer" button that resets the boundary +
// forces the child subtree to remount. If the retry happens immediately
// after a transient network error, the browser will re-request the
// failed chunk and usually succeed.
//
// Error boundaries still need to be class components — there's no hook
// equivalent for componentDidCatch / getDerivedStateFromError as of
// React 19.

import { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", this.props.label || "unknown", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const msg = String(this.state.error?.message || this.state.error || "Erreur inconnue");
    const fallback = this.props.fallback;

    // Custom fallback takes precedence — callers pass a tailored UI when
    // the boundary sits over a small sub-region (e.g. a card). The
    // default below fills its container with a neutral recoverable
    // message sized for a full page.
    if (typeof fallback === "function") {
      return fallback({ error: this.state.error, retry: this.handleRetry });
    }
    if (fallback) return fallback;

    return (
      <div style={{
        padding: 40,
        display: "grid",
        placeItems: "center",
        minHeight: 280,
        textAlign: "center",
      }}>
        <div style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
            {this.props.label ? `Impossible de charger ${this.props.label}` : "Une erreur s'est produite"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14, wordBreak: "break-word" }}>
            {msg}
          </div>
          <button className="btn btn-sm btn-gold" onClick={this.handleRetry}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
