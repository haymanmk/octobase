import * as React from "react";
import {
  getClipBridge,
  getViewerBridge,
  type BrowserState,
  type OctobaseViewerBridge,
} from "./electron-bridge.ts";
import { BROWSER_TAB } from "./viewer-layout.ts";
import { Reader } from "./reader/Reader.tsx";
import { PdfReader } from "./reader/PdfReader.tsx";

export interface ViewerTabInfo {
  cardId: string;
  title: string;
  /** Card kind — picks the viewer (pdf → PdfReader, else Reader). */
  kind?: string;
}

/**
 * The right-hand viewer pane: a tab strip over one shared slot. The pinned
 * 🌐 tab shows the live browser — a native WebContentsView that main.js keeps
 * glued to the slot while (and only while) that tab is active. 📖 tabs render
 * captured articles as plain DOM, so the native view hides and the whole
 * paint-above-DOM overlap problem can't occur.
 */
export interface ViewerHostProps {
  readerTabs: ViewerTabInfo[];
  /** BROWSER_TAB or a reader tab's cardId. */
  activeTab: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (cardId: string) => void;
  onClose: () => void;
  /** Clicking a highlight inside a reader selects its card on the board. */
  onOpenCard: (cardId: string) => void;
  /** Scroll the active reader to this highlight (nonce re-fires repeats). */
  focusHighlight?: { id: string; at: number } | null;
  /** A highlight was hold-dragged out of the reader and dropped at (x, y). */
  onDropHighlight?: (cardId: string, clientX: number, clientY: number) => void;
  /**
   * While the divider is being dragged the native view must get out of the
   * way (it paints above the DOM and would swallow pointer events), so the
   * slot shows a placeholder instead.
   */
  suspended: boolean;
}

export function ViewerHost({
  readerTabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onClose,
  onOpenCard,
  focusHighlight,
  onDropHighlight,
  suspended,
}: ViewerHostProps): React.ReactElement {
  const bridge = React.useMemo<OctobaseViewerBridge | undefined>(() => getViewerBridge(), []);
  const slotRef = React.useRef<HTMLDivElement>(null);
  const urlInputRef = React.useRef<HTMLInputElement>(null);
  const [browser, setBrowser] = React.useState<BrowserState | null>(null);
  const [urlDraft, setUrlDraft] = React.useState("");
  /** Pending "open original" that would replace the browser tab's page. */
  const [confirmNav, setConfirmNav] = React.useState<string | null>(null);

  const browserActive = activeTab === BROWSER_TAB;

  const navigateBrowserTab = (url: string) => {
    bridge?.browserNavigate(url);
    onSelectTab(BROWSER_TAB);
  };

  const openOriginal = (url: string) => {
    if (!bridge) {
      window.open(url, "_blank", "noreferrer");
      return;
    }
    // Reuse the browser tab. If it's already there (or blank), go straight;
    // if the user is reading something else, ask before replacing it.
    if (browser?.url && browser.url !== url) {
      setConfirmNav(url);
    } else {
      navigateBrowserTab(url);
    }
  };

  // Dock the native view while the browser tab is front: stream the slot's
  // rectangle to main. Any other tab (or suspension) hides it.
  React.useEffect(() => {
    if (!bridge || suspended || !browserActive) return;
    const el = slotRef.current;
    if (!el) return;
    let raf = 0;
    const report = () => {
      const r = el.getBoundingClientRect();
      bridge.paneSetBounds({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule);
    report();
    bridge.paneSetVisible(true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
      bridge.paneSetVisible(false);
    };
  }, [bridge, suspended, browserActive]);

  // Navigation state → URL bar (unless the user is mid-edit).
  React.useEffect(() => {
    if (!bridge) return;
    bridge.onBrowserState((s) => {
      setBrowser(s);
      if (document.activeElement !== urlInputRef.current) setUrlDraft(s.url);
    });
  }, [bridge]);

  const navigate = () => {
    bridge?.browserNavigate(urlDraft);
    urlInputRef.current?.blur();
  };

  const browserTitle = browser?.title?.trim() || "Browser";

  return (
    <aside className="ws-viewer" aria-label="Viewer pane">
      <div className="ws-viewer-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={browserActive}
          className={`ws-vtab${browserActive ? " active" : ""}`}
          title={browser?.url || "Live browser"}
          onClick={() => onSelectTab(BROWSER_TAB)}
        >
          <span className="ws-vtab-ico">🌐</span>
          <span className="ws-vtab-label">{browserTitle}</span>
        </button>
        {readerTabs.map((t) => {
          const active = activeTab === t.cardId;
          return (
            <button
              key={t.cardId}
              role="tab"
              aria-selected={active}
              className={`ws-vtab${active ? " active" : ""}`}
              title={t.title}
              onClick={() => onSelectTab(t.cardId)}
            >
              <span className="ws-vtab-ico">{t.kind === "pdf" ? "📄" : "📖"}</span>
              <span className="ws-vtab-label">{t.title}</span>
              <span
                className="ws-vtab-close"
                title="Close tab"
                onClick={(e) => { e.stopPropagation(); onCloseTab(t.cardId); }}
              >✕</span>
            </button>
          );
        })}
        <div className="ws-topbar-spacer" />
        <button className="ws-icon-btn" title="Close viewer pane" onClick={onClose}>✕</button>
      </div>

      {browserActive && (
        <header className="ws-viewer-bar">
          <button className="ws-tb-btn" title="Back" disabled={!browser?.canGoBack}
            onClick={() => bridge?.browserBack()}>←</button>
          <button className="ws-tb-btn" title="Forward" disabled={!browser?.canGoForward}
            onClick={() => bridge?.browserForward()}>→</button>
          <button className="ws-tb-btn" title="Reload" onClick={() => bridge?.browserReload()}>
            {browser?.loading ? "…" : "⟳"}
          </button>
          {getClipBridge() && (
            <button
              className="ws-tb-btn"
              title="Clip a region as an image card (drag a rectangle · esc cancels)"
              onClick={() => getClipBridge()?.clipStart()}
            >✂</button>
          )}
          <input
            ref={urlInputRef}
            className="ws-viewer-url"
            value={urlDraft}
            placeholder="Search or enter address"
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate();
              if (e.key === "Escape") { setUrlDraft(browser?.url ?? ""); urlInputRef.current?.blur(); }
            }}
            onFocus={(e) => e.target.select()}
          />
        </header>
      )}

      <div ref={slotRef} className="ws-viewer-slot">
        {browserActive && !bridge && (
          <div className="ws-viewer-placeholder">
            Live web viewing needs the Electron app.
          </div>
        )}
        {browserActive && bridge && suspended && (
          <div className="ws-viewer-placeholder">{browserTitle}</div>
        )}
        {!browserActive && (
          readerTabs.find((t) => t.cardId === activeTab)?.kind === "pdf" ? (
            <PdfReader key={activeTab} cardId={activeTab}
              focusHighlight={focusHighlight}
              onDropHighlight={onDropHighlight} />
          ) : (
            <Reader key={activeTab} cardId={activeTab} onOpenCard={onOpenCard}
              onOpenOriginal={openOriginal}
              focusHighlight={focusHighlight}
              onDropHighlight={onDropHighlight} />
          )
        )}
      </div>

      {confirmNav && (
        <div className="ws-pane-confirm" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmNav(null); }}>
          <div className="ws-pane-confirm-card">
            <h4>Open the original page?</h4>
            <p>
              The browser tab is currently on{" "}
              <strong>{browser?.title?.trim() || browser?.url || "another page"}</strong>.
              Opening the original will replace it.
            </p>
            <div className="ws-pane-confirm-foot">
              <button className="ws-btn ghost" onClick={() => setConfirmNav(null)}>Cancel</button>
              <button className="ws-btn primary"
                onClick={() => { navigateBrowserTab(confirmNav); setConfirmNav(null); }}>Open</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
