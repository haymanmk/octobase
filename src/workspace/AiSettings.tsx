import * as React from "react";
import { getAiBridge } from "./electron-bridge.ts";

export interface AiSettingsProps {
  onClose: () => void;
}

/**
 * AI settings popover: paste an OpenAI API key (stored encrypted in the main
 * process via safeStorage — it never comes back to this renderer), pick the
 * model, test the connection.
 */
export function AiSettings({ onClose }: AiSettingsProps): React.ReactElement {
  const bridge = getAiBridge();
  const [hasKey, setHasKey] = React.useState(false);
  const [keyDraft, setKeyDraft] = React.useState("");
  const [model, setModel] = React.useState("");
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void bridge?.aiStatus().then((s) => {
      setHasKey(s.hasKey);
      setModel(s.model);
    });
  }, [bridge]);

  const saveKey = async () => {
    if (!bridge || !keyDraft.trim()) return;
    setBusy(true);
    const res = await bridge.aiSetKey(keyDraft.trim());
    setBusy(false);
    if (res.ok) {
      setHasKey(true);
      setKeyDraft("");
      setStatus("Key saved to the system keychain.");
    } else {
      setStatus(res.error ?? "Could not save the key.");
    }
  };

  const clearKey = async () => {
    if (!bridge) return;
    await bridge.aiSetKey(null);
    setHasKey(false);
    setStatus("Key removed.");
  };

  const saveModel = async (value: string) => {
    setModel(value);
    await bridge?.aiSetModel(value);
  };

  const testConnection = async () => {
    if (!bridge) return;
    setBusy(true);
    setStatus("Testing…");
    const res = await bridge.aiTest();
    setBusy(false);
    setStatus(res.ok ? "Connected — the key works." : res.error ?? "Connection failed.");
  };

  return (
    <div className="ws-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws-editor" style={{ width: "min(440px, 92vw)" }}>
        <div className="ws-editor-accent" style={{ background: "var(--ws-accent)" }} />
        <div className="ws-editor-titlebar">
          <div className="ws-editor-title-input" style={{ fontSize: 22 }}>AI settings</div>
        </div>
        <div className="ws-editor-scroll" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {!bridge && <p>The in-app AI needs the Electron app.</p>}
          <label className="ws-insp-label">OpenAI API key</label>
          {hasKey && (
            <p style={{ margin: "2px 0 8px", fontSize: 12.5, color: "var(--ws-ink-soft)" }}>
              A key is stored in your keychain.{" "}
              <button className="ws-btn ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => void clearKey()}>
                Remove
              </button>
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              value={keyDraft}
              placeholder={hasKey ? "Replace key (sk-…)" : "sk-…"}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveKey(); }}
              style={{ flex: 1, padding: 8, border: "1px solid var(--ws-line)", borderRadius: 8, fontFamily: "var(--ws-font-mono)", fontSize: 12 }}
            />
            <button className="ws-btn" disabled={busy || !keyDraft.trim()} onClick={() => void saveKey()}>Save</button>
          </div>
          <label className="ws-insp-label" style={{ marginTop: 14 }}>Model</label>
          <input
            value={model}
            onChange={(e) => void saveModel(e.target.value)}
            style={{ width: "100%", padding: 8, border: "1px solid var(--ws-line)", borderRadius: 8, fontFamily: "var(--ws-font-mono)", fontSize: 12 }}
          />
          {status && (
            <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--ws-ink-soft)" }}>{status}</p>
          )}
        </div>
        <div className="ws-editor-foot" style={{ justifyContent: "space-between" }}>
          <button className="ws-btn" disabled={busy || !hasKey} onClick={() => void testConnection()}>
            Test connection
          </button>
          <button className="ws-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
