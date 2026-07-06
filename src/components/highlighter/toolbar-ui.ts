/**
 * Single source of truth for the highlighter's shared UI: the selection pill
 * (color swatches + "+ note") and the edit popover (recolor / note / delete).
 *
 * Three surfaces consume these styles so they can never drift apart again:
 *  - the Lit widget injected into the live browser pane (highlighter.ts)
 *  - the Chrome extension's content script (src/extension/content.ts)
 *  - the in-app captured-article Reader (src/workspace/reader/Reader.tsx)
 *
 * Positioning (fixed/left/top/z-index) stays with each caller; these styles
 * cover look and feel only.
 */

export const SWATCH_SIZE = 22;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export function pillCss(): string {
  return `
.octo-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: #fff; border-radius: 24px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.12); border: 1px solid #eee;
  pointer-events: auto;
  font-family: ${FONT};
}
.octo-swatch {
  width: ${SWATCH_SIZE}px; height: ${SWATCH_SIZE}px; flex: none;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.06); cursor: pointer; padding: 0;
  box-sizing: border-box;
  transition: transform 0.1s;
}
.octo-swatch:hover { transform: scale(1.12); }
.octo-swatch.current { outline: 2px solid #1f2126; outline-offset: 1px; }
.octo-divider { width: 1px; height: 20px; background: #e5e5e5; margin: 0 2px; }
.octo-add-note {
  font-size: 11px; color: #666; cursor: pointer; user-select: none;
  background: transparent; border: none; padding: 4px; white-space: nowrap;
  font-family: inherit;
}
.octo-add-note:hover { color: #111; }
.octo-pill.pulse .octo-swatch { animation: octo-swatch-pulse 0.6s ease 2; }
@keyframes octo-swatch-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}`;
}

export function popoverCss(): string {
  return `
.octo-pop {
  min-width: 240px; background: #fff;
  border: 1px solid #e4e4e7; border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.22);
  padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: ${FONT};
  color: #1f2126;
}
.octo-pop-row { display: flex; gap: 7px; padding: 2px 2px 0; }
.octo-pop-input {
  width: 100%; box-sizing: border-box;
  border: 1px solid #e4e4e7; border-radius: 8px;
  padding: 7px 8px;
  font: 400 12.5px ${FONT};
  color: #1f2126; background: #fff;
  outline: none; resize: vertical;
}
.octo-pop-input:focus { border-color: #4f7dc9; }
.octo-pop-foot { display: flex; justify-content: space-between; align-items: center; }
.octo-pop-delete {
  border: none; background: none; color: #b4452f; cursor: pointer;
  font: 500 12.5px ${FONT}; padding: 4px 2px;
}
.octo-pop-delete:hover { text-decoration: underline; }
.octo-pop-primary {
  border: 1px solid #1f2126; background: #1f2126; color: #fff;
  border-radius: 8px; cursor: pointer;
  font: 500 12.5px ${FONT}; padding: 6px 12px;
}`;
}

export function toolbarCss(): string {
  return pillCss() + "\n" + popoverCss();
}

const STYLE_ID = "octo-toolbar-ui-styles";

/** Idempotently install the shared styles into a document (or shadow root). */
export function ensureToolbarStyles(root: Document | ShadowRoot = document): void {
  const host = root instanceof Document ? root.head : root;
  if (root instanceof Document && root.getElementById(STYLE_ID)) return;
  const style = (root instanceof Document ? root : root.ownerDocument ?? document)
    .createElement("style");
  if (root instanceof Document) style.id = STYLE_ID;
  style.textContent = toolbarCss();
  host.appendChild(style);
}
