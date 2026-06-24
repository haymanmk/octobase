// Content script: highlight a selection, capture the article, and edit existing
// highlights (recolor / note / delete) right on the page. Highlights are cached
// locally (so they re-render on reload) and synced to the app by a shared id.

import { describeAnchorFromRange } from "../lib/anchor/text-anchor.ts";
import { paintAnchors, offsetFromPoint, type Placement } from "../lib/anchor/highlight-dom.ts";
import { extractArticle } from "../lib/extract/extract-article.ts";
import { HIGHLIGHT_COLORS } from "../types/highlight.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import type { HighlightColor } from "../types/highlight.ts";
import type { TextAnchor } from "../lib/model/types.ts";

interface SavedHighlight {
  id: string;
  color: HighlightColor;
  anchor: TextAnchor;
  exact: string;
  note?: string;
}

const HL_PREFIX = "octo-hl-";
const SYNCED_KEY = "octo:synced";

let selToolbar: HTMLElement | null = null;
let popover: HTMLElement | null = null;
let lastRange: Range | null = null;
let currentSaved: SavedHighlight[] = [];
let placements: Placement[] = [];

function uid(): string {
  return "hl_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── local cache ────────────────────────────────────────────────────────────
function pageKey(): string {
  return "hl:" + location.href.split("#")[0];
}
async function loadSaved(): Promise<SavedHighlight[]> {
  try {
    const stored = await chrome.storage.local.get(pageKey());
    const v = stored[pageKey()];
    return Array.isArray(v) ? (v as SavedHighlight[]) : [];
  } catch {
    return [];
  }
}
async function saveAll(list: SavedHighlight[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [pageKey()]: list });
  } catch {
    /* storage unavailable */
  }
}
async function getSynced(): Promise<Set<string>> {
  try {
    const s = await chrome.storage.local.get(SYNCED_KEY);
    return new Set(Array.isArray(s[SYNCED_KEY]) ? (s[SYNCED_KEY] as string[]) : []);
  } catch {
    return new Set();
  }
}
async function markSynced(id: string, synced: boolean): Promise<void> {
  const set = await getSynced();
  if (synced) set.add(id);
  else set.delete(id);
  try {
    await chrome.storage.local.set({ [SYNCED_KEY]: [...set] });
  } catch {
    /* ignore */
  }
}

// ── painting ───────────────────────────────────────────────────────────────
let stylesInjected = false;
function injectHighlightStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = HIGHLIGHT_COLORS.map(
    (c) => `::highlight(octo-hl-${c}){background-color:${PALETTE[c].fill};}`,
  ).join("");
  (document.head ?? document.documentElement).appendChild(style);
}
async function renderSaved(): Promise<void> {
  currentSaved = await loadSaved();
  injectHighlightStyles();
  placements = paintAnchors(document.body, currentSaved, HL_PREFIX);
}

// ── sync to app ──────────────────────────────────────────────────────────────
function sendUpsert(item: SavedHighlight) {
  return chrome.runtime.sendMessage({
    type: "send",
    path: "/highlight",
    body: {
      id: item.id,
      url: location.href,
      title: document.title,
      color: item.color,
      anchor: item.anchor,
      exact: item.exact,
      note: item.note,
    },
  });
}

// ── create / edit / delete ───────────────────────────────────────────────────
async function saveHighlight(color: HighlightColor) {
  const range = lastRange;
  removeSelToolbar();
  if (!range) return;
  const anchor = describeAnchorFromRange(document.body, range);
  if (!anchor || !anchor.exact.trim()) return;
  window.getSelection()?.removeAllRanges();
  const item: SavedHighlight = { id: uid(), color, anchor, exact: anchor.exact };
  const list = await loadSaved();
  list.push(item);
  await saveAll(list);
  await renderSaved();
  const result = await sendUpsert(item);
  if (result?.ok && !result?.queued) await markSynced(item.id, true);
  flash(result?.queued ? "Highlight queued (app offline)" : result?.ok ? "Highlighted ✓" : "Highlight failed");
}

async function updateHighlight(id: string, patch: Partial<Pick<SavedHighlight, "color" | "note">>) {
  const list = await loadSaved();
  const item = list.find((h) => h.id === id);
  if (!item) return;
  Object.assign(item, patch);
  await saveAll(list);
  await renderSaved();
  const result = await sendUpsert(item);
  if (result?.ok && !result?.queued) await markSynced(id, true);
}

async function deleteHighlight(id: string) {
  await saveAll((await loadSaved()).filter((h) => h.id !== id));
  await markSynced(id, false);
  closePopover();
  await renderSaved();
  await chrome.runtime.sendMessage({ type: "send", path: "/highlight/delete", body: { id } });
}

// ── reverse sync (app → page on load) ────────────────────────────────────────
async function reconcileFromApp(): Promise<void> {
  let appItems: SavedHighlight[] | null = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "listHighlights", url: pageKey().slice(3) });
    if (resp?.ok && Array.isArray(resp.highlights)) appItems = resp.highlights as SavedHighlight[];
  } catch {
    appItems = null;
  }
  if (appItems) {
    const appById = new Map(appItems.map((a) => [a.id, a]));
    const local = await loadSaved();
    const synced = await getSynced();
    const out: SavedHighlight[] = [];
    for (const h of local) {
      const a = appById.get(h.id);
      if (a) out.push({ ...h, color: a.color, anchor: a.anchor, exact: a.exact ?? a.anchor.exact });
      else if (!synced.has(h.id)) out.push(h); // local-only, not yet synced → keep
      // else: was synced and the app no longer has it → deleted in app → drop
    }
    for (const a of appItems) {
      if (!local.some((h) => h.id === a.id)) {
        out.push({ id: a.id, color: a.color, anchor: a.anchor, exact: a.exact ?? a.anchor.exact });
        await markSynced(a.id, true);
      }
    }
    await saveAll(out);
  }
  await renderSaved();
}

// ── selection toolbar (create) ───────────────────────────────────────────────
function removeSelToolbar() {
  selToolbar?.remove();
  selToolbar = null;
}
function showSelToolbar(range: Range) {
  removeSelToolbar();
  const rect = range.getBoundingClientRect();
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:${rect.left + rect.width / 2}px;top:${rect.top - 6}px;transform:translate(-50%,-100%);z-index:2147483647;`;
  const shadow = host.attachShadow({ mode: "open" });
  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;gap:7px;padding:7px 9px;background:#211d17;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35);";
  for (const color of HIGHLIGHT_COLORS) {
    bar.appendChild(colorDot(color, () => void saveHighlight(color)));
  }
  shadow.appendChild(bar);
  document.documentElement.appendChild(host);
  selToolbar = host;
}

// ── edit popover (recolor / note / delete) ───────────────────────────────────
function closePopover() {
  popover?.remove();
  popover = null;
}
function colorDot(color: HighlightColor, onClick: () => void): HTMLElement {
  const dot = document.createElement("span");
  dot.title = color;
  dot.style.cssText = `width:18px;height:18px;border-radius:50%;cursor:pointer;border:1.5px solid rgba(255,255,255,.25);background:${PALETTE[color].underline};`;
  dot.addEventListener("mousedown", (e) => e.preventDefault());
  dot.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return dot;
}
function showEditPopover(h: SavedHighlight, x: number, y: number) {
  closePopover();
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:${x}px;top:${y + 12}px;transform:translateX(-50%);z-index:2147483647;`;
  const shadow = host.attachShadow({ mode: "open" });
  const box = document.createElement("div");
  box.style.cssText =
    "min-width:230px;background:#fffdf8;border:1px solid #ddd3c1;border-radius:12px;box-shadow:0 10px 30px rgba(30,24,12,.28);padding:10px;font-family:system-ui,sans-serif;color:#211d17;";

  const dots = document.createElement("div");
  dots.style.cssText = "display:flex;gap:7px;padding:2px 2px 8px;";
  for (const color of HIGHLIGHT_COLORS) {
    const d = colorDot(color, () => { void updateHighlight(h.id, { color }); closePopover(); });
    if (color === h.color) {
      d.style.outline = "2px solid #211d17";
      d.style.outlineOffset = "1px";
    }
    dots.appendChild(d);
  }
  box.appendChild(dots);

  const note = document.createElement("textarea");
  note.value = h.note ?? "";
  note.placeholder = "Add a note…";
  note.rows = 2;
  note.style.cssText =
    "width:100%;box-sizing:border-box;resize:vertical;border:1px solid #ddd3c1;border-radius:8px;padding:7px 8px;font:13px system-ui;background:#fff;color:#211d17;";
  note.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitNote(); }
    if (e.key === "Escape") closePopover();
  });
  const commitNote = () => {
    const v = note.value.trim();
    if (v !== (h.note ?? "")) void updateHighlight(h.id, { note: v });
    closePopover();
  };
  box.appendChild(note);

  const foot = document.createElement("div");
  foot.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding-top:8px;";
  const del = document.createElement("button");
  del.textContent = "Delete";
  del.style.cssText = "border:none;background:none;color:#b4452f;cursor:pointer;font:500 13px system-ui;padding:4px 2px;";
  del.addEventListener("click", () => void deleteHighlight(h.id));
  const save = document.createElement("button");
  save.textContent = "Save note";
  save.style.cssText = "border:1px solid #211d17;background:#211d17;color:#f4efe6;border-radius:8px;cursor:pointer;font:500 13px system-ui;padding:6px 12px;";
  save.addEventListener("click", commitNote);
  foot.append(del, save);
  box.appendChild(foot);

  shadow.appendChild(box);
  document.documentElement.appendChild(host);
  popover = host;
  setTimeout(() => note.focus(), 0);
}

// ── capture ──────────────────────────────────────────────────────────────────
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

function highlightAtPoint(x: number, y: number): SavedHighlight | null {
  const off = offsetFromPoint(document.body, x, y);
  if (off == null) return null;
  let hit: Placement | null = null;
  for (const p of placements) if (off >= p.start && off < p.end) hit = p;
  return hit ? currentSaved[hit.index] ?? null : null;
}

function registerListeners() {
  document.addEventListener("mouseup", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        removeSelToolbar();
        return;
      }
      lastRange = sel.getRangeAt(0).cloneRange();
      showSelToolbar(lastRange);
    }, 0);
  });

  // Click an existing highlight to edit it.
  document.addEventListener("click", (e) => {
    if (popover && e.composedPath().includes(popover)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const h = highlightAtPoint(e.clientX, e.clientY);
    if (h) showEditPopover(h, e.clientX, e.clientY);
    else closePopover();
  });

  document.addEventListener("scroll", () => { removeSelToolbar(); closePopover(); }, true);

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

// Declared content script AND injected on demand; guard against double-binding.
const loadFlag = window as unknown as { __octobaseContentLoaded?: boolean };
if (!loadFlag.__octobaseContentLoaded) {
  loadFlag.__octobaseContentLoaded = true;
  registerListeners();
  void reconcileFromApp();
  setTimeout(() => { void renderSaved(); }, 1200);
}
