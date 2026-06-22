// Content script: lets the user highlight a selection or capture the article on
// any page, then hands the payload to the background worker for delivery.

import { describeAnchorFromRange } from "../lib/anchor/text-anchor.ts";
import { extractArticle } from "../lib/extract/extract-article.ts";
import { HIGHLIGHT_COLORS } from "../types/highlight.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import type { HighlightColor } from "../types/highlight.ts";

let toolbar: HTMLElement | null = null;
let lastRange: Range | null = null;

function removeToolbar() {
  toolbar?.remove();
  toolbar = null;
}

function showToolbar(range: Range) {
  removeToolbar();
  const rect = range.getBoundingClientRect();
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:${rect.left + rect.width / 2}px;top:${rect.top - 6}px;transform:translate(-50%,-100%);z-index:2147483647;`;
  const shadow = host.attachShadow({ mode: "open" });
  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;gap:7px;padding:7px 9px;background:#211d17;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35);font-family:system-ui,sans-serif;";
  for (const color of HIGHLIGHT_COLORS) {
    const dot = document.createElement("span");
    dot.title = `Highlight ${color}`;
    dot.style.cssText = `width:18px;height:18px;border-radius:50%;cursor:pointer;border:1.5px solid rgba(255,255,255,.25);background:${PALETTE[color].underline};`;
    dot.addEventListener("mousedown", (e) => e.preventDefault());
    dot.addEventListener("click", () => saveHighlight(color));
    bar.appendChild(dot);
  }
  shadow.appendChild(bar);
  document.documentElement.appendChild(host);
  toolbar = host;
}

function paintLocally(range: Range, color: HighlightColor) {
  const w = window as unknown as { Highlight?: new (...r: Range[]) => unknown };
  const cssAny = CSS as unknown as { highlights?: Map<string, unknown> };
  if (!w.Highlight || !cssAny.highlights) return;
  const key = `octo-hl-${color}`;
  const existing = cssAny.highlights.get(key) as { add?: (r: Range) => void } | undefined;
  if (existing && typeof existing.add === "function") existing.add(range);
  else cssAny.highlights.set(key, new w.Highlight(range));
  injectHighlightStyles();
}

let stylesInjected = false;
function injectHighlightStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = HIGHLIGHT_COLORS.map(
    (c) => `::highlight(octo-hl-${c}){background-color:${PALETTE[c].fill};}`,
  ).join("");
  document.head.appendChild(style);
}

async function saveHighlight(color: HighlightColor) {
  const range = lastRange;
  removeToolbar();
  if (!range) return;
  const anchor = describeAnchorFromRange(document.body, range);
  if (!anchor || !anchor.exact.trim()) return;
  paintLocally(range, color);
  window.getSelection()?.removeAllRanges();
  const result = await chrome.runtime.sendMessage({
    type: "send",
    path: "/highlight",
    body: { url: location.href, title: document.title, color, anchor, exact: anchor.exact },
  });
  flash(result?.queued ? "Highlight queued (app offline)" : result?.ok ? "Highlighted ✓" : "Highlight failed");
}

async function captureArticle() {
  const clone = document.cloneNode(true) as Document;
  const article = extractArticle(clone, { url: location.href });
  if (!article) {
    flash("Couldn't extract an article here");
    return;
  }
  const result = await chrome.runtime.sendMessage({
    type: "send",
    path: "/capture",
    body: {
      url: location.href,
      title: article.title || document.title,
      markdown: article.markdown,
      byline: article.byline,
      siteName: article.siteName,
    },
  });
  flash(result?.queued ? "Capture queued (app offline)" : result?.ok ? "Article captured ✓" : "Capture failed");
}

function flash(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText =
    "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#211d17;color:#f4efe6;padding:10px 16px;border-radius:10px;font:14px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);";
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function registerListeners() {
  document.addEventListener("mouseup", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (!toolbar) return;
        removeToolbar();
        return;
      }
      lastRange = sel.getRangeAt(0).cloneRange();
      showToolbar(lastRange);
    }, 0);
  });
  document.addEventListener("scroll", removeToolbar, true);

  chrome.runtime.onMessage.addListener((msg: { type: string }) => {
    if (msg.type === "capture") void captureArticle();
    if (msg.type === "highlight-selection") {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        lastRange = sel.getRangeAt(0).cloneRange();
        void saveHighlight("yellow");
      }
    }
  });
}

// This file is both a declared content script AND injected on demand by the
// popup/context-menu (so capture works on tabs that were already open before the
// extension loaded). Guard so re-injection doesn't double-bind listeners.
const loadFlag = window as unknown as { __octobaseContentLoaded?: boolean };
if (!loadFlag.__octobaseContentLoaded) {
  loadFlag.__octobaseContentLoaded = true;
  registerListeners();
}
