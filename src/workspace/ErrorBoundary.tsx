import * as React from "react";

interface State {
  error: Error | null;
}

/**
 * Last-resort catch for render/effect crashes. Without it a single throw
 * unmounts the entire tree and the window goes silently white — with it the
 * user sees what broke and can reload without losing data (the store saves
 * on every mutation).
 */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("octobase crashed:", error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        position: "fixed", inset: 0, display: "grid", placeItems: "center",
        background: "#f5f6f7", fontFamily: "ui-sans-serif, system-ui", color: "#1f2126",
      }}>
        <div style={{ maxWidth: 560, padding: 24 }}>
          <h2 style={{ margin: "0 0 8px" }}>Something broke</h2>
          <p style={{ color: "#4c505a" }}>
            Your data is safe — it saves on every change. Reload to continue.
          </p>
          <pre style={{
            background: "#fff", border: "1px solid #e0e2e6", borderRadius: 8,
            padding: 12, fontSize: 12, overflow: "auto", maxHeight: 240,
          }}>{String(this.state.error.stack || this.state.error)}</pre>
          <button
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #1f2126",
              background: "#1f2126", color: "#fff", cursor: "pointer", fontSize: 13,
            }}
            onClick={() => window.location.reload()}
          >Reload</button>
        </div>
      </div>
    );
  }
}
