import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePref } from "./theme.ts";

export interface AppSettingsProps {
  themePref: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
  onClose: () => void;
}

const THEME_OPTIONS: Array<{ value: ThemePref; label: string; icon: React.ReactElement }> = [
  { value: "system", label: "System", icon: <Monitor size={14} strokeWidth={2} aria-hidden /> },
  { value: "light", label: "Light", icon: <Sun size={14} strokeWidth={2} aria-hidden /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} strokeWidth={2} aria-hidden /> },
];

/** App settings dialog. Holds the theme choice; future app-wide options land here. */
export function AppSettings({ themePref, onThemeChange, onClose }: AppSettingsProps): React.ReactElement {
  return (
    <div className="ws-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws-editor" style={{ width: "min(400px, 92vw)" }}>
        <div className="ws-editor-accent" style={{ background: "var(--ws-accent)" }} />
        <div className="ws-editor-titlebar">
          <div className="ws-editor-title-input" style={{ fontSize: 22 }}>Settings</div>
        </div>
        <div className="ws-editor-scroll" style={{ fontSize: 14, lineHeight: 1.6 }}>
          <label className="ws-insp-label">Appearance</label>
          <div className="ws-theme-seg" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                role="radio"
                aria-checked={themePref === opt.value}
                className={`ws-theme-opt${themePref === opt.value ? " active" : ""}`}
                onClick={() => onThemeChange(opt.value)}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--ws-ink-soft)" }}>
            System follows your OS appearance.
          </p>
        </div>
        <div className="ws-editor-foot">
          <button className="ws-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
