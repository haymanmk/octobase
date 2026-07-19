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

const FONT = "'Spline Sans', ui-sans-serif, system-ui, sans-serif";

export function pillCss(): string {
  return `
.octo-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: #fff; border-radius: 24px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.12); border: 1px solid #e3e3e3;
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
.octo-swatch.current { outline: 2px solid #212123; outline-offset: 1px; }
.octo-divider { width: 1px; height: 20px; background: #e3e3e3; margin: 0 2px; }
.octo-add-note {
  font-size: 11px; color: #56565a; cursor: pointer; user-select: none;
  background: transparent; border: none; padding: 4px; white-space: nowrap;
  font-family: inherit;
}
.octo-add-note:hover { color: #212123; }
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
  border: 1px solid #e3e3e3; border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.22);
  padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: ${FONT};
  color: #212123;
}
.octo-pop-row { display: flex; gap: 7px; padding: 2px 2px 0; }
.octo-pop-input {
  width: 100%; box-sizing: border-box;
  border: 1px solid #e3e3e3; border-radius: 8px;
  padding: 7px 8px;
  font: 400 12.5px ${FONT};
  color: #212123; background: #fff;
  outline: none; resize: vertical;
}
.octo-pop-input:focus { border-color: #4f7dc9; }
.octo-pop-foot { display: flex; justify-content: space-between; align-items: center; }
.octo-pop-delete {
  border: none; background: none; color: #b4452f; cursor: pointer;
  font: 500 12.5px ${FONT}; padding: 4px 2px;
}
/* Lucide trash-2, embedded (no remote fetch in MV3 content scripts). */
.octo-pop-delete::before {
  content: ""; display: inline-block; width: 13px; height: 13px;
  margin-right: 5px; vertical-align: -2px; background-color: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 6h18'/%3E%3Cpath d='M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'/%3E%3Cpath d='M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'/%3E%3Cline x1='10' x2='10' y1='11' y2='17'/%3E%3Cline x1='14' x2='14' y1='11' y2='17'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 6h18'/%3E%3Cpath d='M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'/%3E%3Cpath d='M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'/%3E%3Cline x1='10' x2='10' y1='11' y2='17'/%3E%3Cline x1='14' x2='14' y1='11' y2='17'/%3E%3C/svg%3E") center / contain no-repeat;
}
.octo-pop-delete:hover { text-decoration: underline; }
.octo-pop-primary {
  border: 1px solid #212123; background: #212123; color: #fff;
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
