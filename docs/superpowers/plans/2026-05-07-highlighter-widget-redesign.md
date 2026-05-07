# Highlighter Widget Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the redesigned highlighter widget per `docs/superpowers/specs/2026-05-07-highlighter-widget-design.md` — six pastel colors, free-text tags with autocomplete, notes, hover edit panel with delete + undo, JSON persistence, and bidirectional sync between highlights and whiteboard cards.

**Architecture:** Renderer-side widget (Lit components in shadow DOM, injected into the right-view page) calls the main process via IPC for all reads/writes. Main process owns `highlights.json` and `whiteboard.json` in `app.getPath('userData')` and broadcasts changes to all renderers after each write. Whiteboard sync is one-way (highlight → card) for content fields; cards are read-only this round except for `x/y`.

**Tech Stack:** Electron 39, Lit 3, Rangy 1.3, TypeScript, React 19 (whiteboard), `node:test` for pure-function unit tests.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/types/highlight.ts` | Shared `Highlight`, `Card`, `HighlightColor` types |
| `src/components/highlighter/colors.ts` | Pastel palette constants + per-color CSS string generator |
| `src/components/highlighter/widget-styles.ts` | Pill / panel / chip CSS string (host-DOM injection) |
| `src/components/highlighter/tag-input.ts` | Lit component: chip input with autocomplete dropdown |
| `src/components/highlighter/edit-form.ts` | Lit component: color row + tag-input + notes textarea (used by both creation expansion and edit panel) |
| `src/components/highlighter/undo-toast.ts` | Lit component: bottom-of-view undo toast |
| `src/electron/highlights-store.js` | Main-process I/O: load/save/delete on `highlights.json` and `whiteboard.json`; tag list aggregator |
| `test/highlights-store.test.ts` | Unit tests for the store |
| `test/colors.test.ts` | Unit tests for the palette |

**Modified files:**

| Path | Changes |
|---|---|
| `src/components/highlighter/highlighter.ts` | Replace single applier with six per-color appliers; replace yellow-only widget with new pill + expanded form; add hover ⋯ affordance + edit panel; re-apply highlights on load via `highlights:load` |
| `src/electron/preload-highlighter.js` | Expose new IPC: `loadHighlights`, `saveHighlight`, `deleteHighlight`, `listTags`, listeners for `highlight:updated` / `highlight:deleted` |
| `src/electron/preload.js` | Expose new IPC: `loadCards`, `saveCard`, `deleteCard`, listeners for `card:updated` / `card:deleted` |
| `src/electron/main.js` | Wire IPC handlers via `highlights-store`; extend `highlight-dropped` to persist a synced Card and broadcast |
| `src/app/whiteboard.tsx` | Load cards on mount; listen for `card:updated` / `card:deleted`; render color/tags/notes; persist position + delete |
| `package.json` | Add `test` script if not present (currently absent) |

---

## Task 1: Define shared types

**Files:**
- Create: `src/types/highlight.ts`

- [ ] **Step 1: Write `src/types/highlight.ts`**

```ts
export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "pink",
  "blue",
  "purple",
  "orange",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export type HighlightId = string;

export interface RangyAnchor {
  serialized: string;
}

export interface Highlight {
  id: HighlightId;
  text: string;
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  anchor: RangyAnchor;
  createdAt: number;
  updatedAt: number;
}

export interface Card {
  id: HighlightId;
  text: string;
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  x: number;
  y: number;
  updatedAt: number;
}

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/highlight.ts
git commit -m "feat(types): add Highlight and Card shared types"
```

---

## Task 2: Pastel palette + CSS generator

**Files:**
- Create: `src/components/highlighter/colors.ts`
- Create: `test/colors.test.ts`

- [ ] **Step 1: Write the failing test**

`test/colors.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { PALETTE, classNameFor, paletteCss } from "../src/components/highlighter/colors.ts";

test("palette has the six declared colors with fill and underline values", () => {
  assert.deepEqual(Object.keys(PALETTE).sort(), ["blue", "green", "orange", "pink", "purple", "yellow"]);
  for (const entry of Object.values(PALETTE)) {
    assert.match(entry.fill, /^#[0-9a-f]{6}$/i);
    assert.match(entry.underline, /^#[0-9a-f]{6}$/i);
  }
});

test("classNameFor returns the expected class per color", () => {
  assert.equal(classNameFor("yellow"), "octo-hl-yellow");
  assert.equal(classNameFor("orange"), "octo-hl-orange");
});

test("paletteCss includes a rule for every color with fill and underline", () => {
  const css = paletteCss();
  for (const color of Object.keys(PALETTE)) {
    assert.match(css, new RegExp(`\\.octo-hl-${color}\\b`));
  }
  for (const entry of Object.values(PALETTE)) {
    assert.ok(css.includes(entry.fill), `expected fill ${entry.fill} in css`);
    assert.ok(css.includes(entry.underline), `expected underline ${entry.underline} in css`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/colors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/components/highlighter/colors.ts`**

```ts
import type { HighlightColor } from "../../types/highlight.ts";

export const PALETTE: Record<HighlightColor, { fill: string; underline: string }> = {
  yellow: { fill: "#fff3b0", underline: "#f59e0b" },
  green:  { fill: "#c8e6c9", underline: "#16a34a" },
  pink:   { fill: "#fbcfe8", underline: "#ec4899" },
  blue:   { fill: "#bfdbfe", underline: "#2563eb" },
  purple: { fill: "#e9d5ff", underline: "#9333ea" },
  orange: { fill: "#fed7aa", underline: "#ea580c" },
};

export function classNameFor(color: HighlightColor): string {
  return `octo-hl-${color}`;
}

export function paletteCss(): string {
  return (Object.entries(PALETTE) as Array<[HighlightColor, { fill: string; underline: string }]>)
    .map(
      ([color, { fill, underline }]) => `.${classNameFor(color)} {
  background-color: ${fill};
  border-bottom: 3px solid ${underline};
  border-radius: 3px;
  padding: 2px 4px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.${classNameFor(color)}:hover { filter: brightness(0.97); }`,
    )
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/colors.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/highlighter/colors.ts test/colors.test.ts
git commit -m "feat(highlighter): add pastel palette and per-color CSS generator"
```

---

## Task 3: Highlights store (main-process I/O)

**Files:**
- Create: `src/electron/highlights-store.js`
- Create: `test/highlights-store.test.ts`

- [ ] **Step 1: Write the failing test**

`test/highlights-store.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStore } from "../src/electron/highlights-store.js";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "octobase-store-"));
}

test("loadHighlightsForUrl returns [] when file missing", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    assert.deepEqual(await store.loadHighlightsForUrl("https://x"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveHighlight upserts by id and returns the saved record", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    const a = sampleHighlight({ id: "hl-1", color: "yellow", tags: ["read"] });
    const b = { ...a, color: "green" };
    await store.saveHighlight(a);
    await store.saveHighlight(b);
    const records = await store.loadHighlightsForUrl(a.sourceUrl);
    assert.equal(records.length, 1);
    assert.equal(records[0].color, "green");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteHighlight removes by id; missing id is a no-op", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveHighlight(sampleHighlight({ id: "hl-1" }));
    await store.deleteHighlight("hl-2"); // no-op
    await store.deleteHighlight("hl-1");
    assert.deepEqual(await store.loadHighlightsForUrl("https://x"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listTags dedupes lowercase across all highlights and sorts ascending", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveHighlight(sampleHighlight({ id: "hl-1", tags: ["Read", "todo"] }));
    await store.saveHighlight(sampleHighlight({ id: "hl-2", tags: ["read", "Important"] }));
    assert.deepEqual(await store.listTags(), ["important", "read", "todo"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveCard upserts by id; loadCards returns all", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveCard(sampleCard({ id: "hl-1", x: 10 }));
    await store.saveCard(sampleCard({ id: "hl-1", x: 20 }));
    await store.saveCard(sampleCard({ id: "hl-2", x: 30 }));
    const cards = await store.loadCards();
    assert.equal(cards.length, 2);
    assert.equal(cards.find(c => c.id === "hl-1").x, 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncCardFromHighlight updates content fields but preserves x/y", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveCard(sampleCard({ id: "hl-1", x: 99, y: 42, color: "yellow" }));
    const updated = await store.syncCardFromHighlight(
      sampleHighlight({ id: "hl-1", color: "blue", tags: ["new"] }),
    );
    assert.equal(updated.x, 99);
    assert.equal(updated.y, 42);
    assert.equal(updated.color, "blue");
    assert.deepEqual(updated.tags, ["new"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncCardFromHighlight returns null when no matching card exists", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    const result = await store.syncCardFromHighlight(sampleHighlight({ id: "hl-missing" }));
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sampleHighlight(overrides) {
  return {
    id: "hl-1",
    text: "selected text",
    sourceUrl: "https://x",
    color: "yellow",
    tags: [],
    notes: "",
    anchor: { serialized: "anchor-string" },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function sampleCard(overrides) {
  return {
    id: "hl-1",
    text: "selected text",
    sourceUrl: "https://x",
    color: "yellow",
    tags: [],
    notes: "",
    x: 0,
    y: 0,
    updatedAt: 1,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/highlights-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/electron/highlights-store.js`**

```js
import { promises as fs } from "node:fs";
import path from "node:path";

const HIGHLIGHTS_FILE = "highlights.json";
const CARDS_FILE = "whiteboard.json";

async function readJson(filePath) {
  try {
    const buf = await fs.readFile(filePath, "utf8");
    return JSON.parse(buf);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export function createStore(dataDir) {
  const highlightsPath = path.join(dataDir, HIGHLIGHTS_FILE);
  const cardsPath = path.join(dataDir, CARDS_FILE);

  async function loadAllHighlights() {
    return await readJson(highlightsPath);
  }

  async function loadHighlightsForUrl(url) {
    const all = await loadAllHighlights();
    return all.filter((h) => h.sourceUrl === url);
  }

  async function saveHighlight(highlight) {
    const all = await loadAllHighlights();
    const idx = all.findIndex((h) => h.id === highlight.id);
    if (idx >= 0) all[idx] = highlight;
    else all.push(highlight);
    await writeJson(highlightsPath, all);
    return highlight;
  }

  async function deleteHighlight(id) {
    const all = await loadAllHighlights();
    const next = all.filter((h) => h.id !== id);
    if (next.length !== all.length) await writeJson(highlightsPath, next);
  }

  async function listTags() {
    const all = await loadAllHighlights();
    const set = new Set();
    for (const h of all) for (const t of h.tags || []) set.add(String(t).toLowerCase());
    return [...set].sort();
  }

  async function loadCards() {
    return await readJson(cardsPath);
  }

  async function saveCard(card) {
    const all = await loadCards();
    const idx = all.findIndex((c) => c.id === card.id);
    if (idx >= 0) all[idx] = card;
    else all.push(card);
    await writeJson(cardsPath, all);
    return card;
  }

  async function deleteCard(id) {
    const all = await loadCards();
    const next = all.filter((c) => c.id !== id);
    if (next.length !== all.length) await writeJson(cardsPath, next);
  }

  async function syncCardFromHighlight(highlight) {
    const all = await loadCards();
    const idx = all.findIndex((c) => c.id === highlight.id);
    if (idx < 0) return null;
    const updated = {
      ...all[idx],
      text: highlight.text,
      sourceUrl: highlight.sourceUrl,
      color: highlight.color,
      tags: highlight.tags,
      notes: highlight.notes,
      updatedAt: highlight.updatedAt,
    };
    all[idx] = updated;
    await writeJson(cardsPath, all);
    return updated;
  }

  return {
    loadAllHighlights,
    loadHighlightsForUrl,
    saveHighlight,
    deleteHighlight,
    listTags,
    loadCards,
    saveCard,
    deleteCard,
    syncCardFromHighlight,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/highlights-store.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Add `test` script to package.json**

Read `package.json` and ensure the `scripts` block contains:

```json
"test": "node --test test/**/*.test.ts"
```

If `test` already exists, leave it alone. Run `npm test` once to confirm nothing else breaks.

- [ ] **Step 6: Commit**

```bash
git add src/electron/highlights-store.js test/highlights-store.test.ts package.json
git commit -m "feat(electron): add highlights/cards JSON store"
```

---

## Task 4: Wire IPC handlers in main.js

**Files:**
- Modify: `src/electron/main.js`

- [ ] **Step 1: Import the store at the top of `main.js`**

Add after the existing imports:

```js
import { createStore } from './highlights-store.js';
```

- [ ] **Step 2: Initialize the store inside `app.whenReady().then(...)`, before the `ipcMain.on` calls**

```js
const store = createStore(app.getPath('userData'));
```

- [ ] **Step 3: Replace the existing `highlight-dropped` handler with the persistence-aware version**

Old (lines ~167–201):

```js
ipcMain.on('highlight-dropped', (event, data) => { /* ... */ });
```

Replace with:

```js
ipcMain.on('highlight-dropped', async (event, data) => {
  console.log('Highlight Dropped:', data);
  overlayView.setBackgroundColor('#00000000');
  try { parentWin.contentView.removeChildView(overlayView); } catch (e) { /* already removed */ }

  if (!data || !leftView) return;

  const leftBounds = leftView.getBounds();
  const dropX = data.x;
  const dropY = data.y;
  if (
    dropX < leftBounds.x || dropX > leftBounds.x + leftBounds.width ||
    dropY < leftBounds.y || dropY > leftBounds.y + leftBounds.height
  ) {
    console.log('Drop outside whiteboard, discarding.');
    return;
  }

  const localX = dropX - leftBounds.x;
  const localY = dropY - leftBounds.y;

  // Look up the existing highlight to copy color/tags/notes onto the card.
  const all = await store.loadAllHighlights();
  const highlight = all.find((h) => h.id === data.highlightId);
  const now = Date.now();

  const card = {
    id: data.highlightId,
    text: highlight?.text ?? data.text,
    sourceUrl: highlight?.sourceUrl ?? data.sourceUrl,
    color: highlight?.color ?? 'yellow',
    tags: highlight?.tags ?? [],
    notes: highlight?.notes ?? '',
    x: localX,
    y: localY,
    updatedAt: now,
  };
  await store.saveCard(card);

  leftView.webContents.send('card:updated', card);
});
```

- [ ] **Step 4: Add IPC handlers for highlights (right-view → main → reply / broadcast)**

Add inside `app.whenReady().then(...)` after the store is created:

```js
ipcMain.handle('highlights:load', async (_event, { url }) => {
  return await store.loadHighlightsForUrl(url);
});

ipcMain.handle('highlights:save', async (_event, highlight) => {
  await store.saveHighlight(highlight);
  rightView?.webContents.send('highlight:updated', highlight);
  const card = await store.syncCardFromHighlight(highlight);
  if (card) leftView?.webContents.send('card:updated', card);
  return { ok: true };
});

ipcMain.handle('highlights:delete', async (_event, { id }) => {
  await store.deleteHighlight(id);
  rightView?.webContents.send('highlight:deleted', { id });
  return { ok: true };
});

ipcMain.handle('tags:list', async () => await store.listTags());
```

- [ ] **Step 5: Add IPC handlers for cards (left-view → main → reply / broadcast)**

```js
ipcMain.handle('cards:load', async () => await store.loadCards());

ipcMain.handle('cards:save', async (_event, card) => {
  await store.saveCard(card);
  leftView?.webContents.send('card:updated', card);
  return { ok: true };
});

ipcMain.handle('cards:delete', async (_event, { id }) => {
  await store.deleteCard(id);
  leftView?.webContents.send('card:deleted', { id });
  return { ok: true };
});
```

- [ ] **Step 6: Manual verification — start the app, watch the console for store initialization**

Run: `npm run electron-dev`
Expected: app launches; main process console logs show no errors. Quit the app.

- [ ] **Step 7: Commit**

```bash
git add src/electron/main.js
git commit -m "feat(electron): wire highlights/cards IPC handlers"
```

---

## Task 5: Update `preload-highlighter.js`

**Files:**
- Modify: `src/electron/preload-highlighter.js`

- [ ] **Step 1: Replace file contents with the extended API**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // existing drag APIs
  sendDragText: (data) => ipcRenderer.send('drag-drop-text-selection', data),
  sendDragPosition: (data) => ipcRenderer.send('drag-drop-text-position', data),
  sendDragEnd: (data) => ipcRenderer.send('drag-drop-text-end', data),

  // new persistence APIs
  loadHighlights: (url) => ipcRenderer.invoke('highlights:load', { url }),
  saveHighlight: (highlight) => ipcRenderer.invoke('highlights:save', highlight),
  deleteHighlight: (id) => ipcRenderer.invoke('highlights:delete', { id }),
  listTags: () => ipcRenderer.invoke('tags:list'),

  // broadcast listeners
  onHighlightUpdated: (callback) => {
    ipcRenderer.removeAllListeners('highlight:updated');
    ipcRenderer.on('highlight:updated', (_event, data) => callback(data));
  },
  onHighlightDeleted: (callback) => {
    ipcRenderer.removeAllListeners('highlight:deleted');
    ipcRenderer.on('highlight:deleted', (_event, data) => callback(data));
  },
});

console.log('Preload-highlighter script loaded');
```

- [ ] **Step 2: Commit**

```bash
git add src/electron/preload-highlighter.js
git commit -m "feat(preload): expose highlights persistence + broadcast APIs"
```

---

## Task 6: Update `preload.js` (whiteboard side)

**Files:**
- Modify: `src/electron/preload.js`

- [ ] **Step 1: Replace file contents with the extended API**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // existing
  onHighlightDropped: (callback) => {
    ipcRenderer.on('highlight-dropped', (_event, data) => callback(data));
  },
  removeHighlightDroppedListener: () => {
    ipcRenderer.removeAllListeners('highlight-dropped');
  },

  // new card APIs
  loadCards: () => ipcRenderer.invoke('cards:load'),
  saveCard: (card) => ipcRenderer.invoke('cards:save', card),
  deleteCard: (id) => ipcRenderer.invoke('cards:delete', { id }),

  // broadcast listeners
  onCardUpdated: (callback) => {
    ipcRenderer.removeAllListeners('card:updated');
    ipcRenderer.on('card:updated', (_event, data) => callback(data));
  },
  onCardDeleted: (callback) => {
    ipcRenderer.removeAllListeners('card:deleted');
    ipcRenderer.on('card:deleted', (_event, data) => callback(data));
  },
});

console.log('Preload script loaded');
```

- [ ] **Step 2: Commit**

```bash
git add src/electron/preload.js
git commit -m "feat(preload): expose cards persistence + broadcast APIs"
```

---

## Task 7: Six color appliers + global widget styles

**Files:**
- Modify: `src/components/highlighter/highlighter.ts`
- Create: `src/components/highlighter/widget-styles.ts`

- [ ] **Step 1: Write `src/components/highlighter/widget-styles.ts`**

```ts
import { paletteCss } from "./colors.ts";

export function injectGlobalStyles(): void {
  const id = "octobase-highlighter-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.innerHTML = paletteCss();
  document.head.appendChild(style);
}
```

- [ ] **Step 2: In `highlighter.ts`, import `HIGHLIGHT_COLORS`, `classNameFor`, and `injectGlobalStyles`**

Add at the top:

```ts
import { HIGHLIGHT_COLORS, type HighlightColor } from "../../types/highlight.ts";
import { classNameFor } from "./colors.ts";
import { injectGlobalStyles } from "./widget-styles.ts";
```

- [ ] **Step 3: Replace `addStylesToBody` calls and the single `'highlighted-text'` applier with per-color appliers**

Find the IIFE at the bottom that calls `addStylesToBody()` and replace it with `injectGlobalStyles()`. Then replace the single `rangy.createClassApplier('highlighted-text', { onElementCreate: ... })` with a per-color factory:

```ts
function makeApplier(color: HighlightColor) {
  return rangy.createClassApplier(classNameFor(color), {
    onElementCreate: (el: Element) => attachFragmentBehavior(el as HTMLElement),
  });
}

const appliers: Record<HighlightColor, ReturnType<typeof rangy.createClassApplier>> = Object.fromEntries(
  HIGHLIGHT_COLORS.map((c) => [c, makeApplier(c)]),
) as Record<HighlightColor, ReturnType<typeof rangy.createClassApplier>>;
```

`attachFragmentBehavior` wraps the existing `pointerdown` listener that today lives inside `onElementCreate` — extract it into a top-level function so all color appliers can share it. Move the existing pointerdown / hold-drag code from inside `handleHighlightClick` to this function unchanged.

- [ ] **Step 4: Update `handleHighlightClick` to take a color and use that color's applier**

```ts
handleHighlightClick(color: HighlightColor) {
  const highlighter = rangy.createHighlighter();
  highlighter.addClassApplier(appliers[color]);
  highlighter.highlightSelection(classNameFor(color));
  rangy.getSelection().removeAllRanges();
}
```

- [ ] **Step 5: Manual verification — temporarily wire a debug button to test all six colors**

In the widget's render, replace the single button with six test buttons:

```ts
return this.visible
  ? html`<div class="base-style">
    ${HIGHLIGHT_COLORS.map(c => html`<button @click=${() => this.handleHighlightClick(c)}>${c}</button>`)}
  </div>`
  : html``;
```

Run: `npm run electron-dev`
Expected: select text, see six buttons, click each — text becomes that color with matching underline. Quit.

- [ ] **Step 6: Commit**

```bash
git add src/components/highlighter/widget-styles.ts src/components/highlighter/highlighter.ts
git commit -m "feat(highlighter): six per-color appliers"
```

---

## Task 8: Persist on create + re-apply on load (still using debug buttons)

**Files:**
- Modify: `src/components/highlighter/highlighter.ts`

The shared highlight-id helper at `src/components/highlighter/highlight-id.ts` already exists; reuse `stampHighlightGroup` to mark all fragments produced from one selection.

- [ ] **Step 1: Capture the selection's serialized anchor before applying Rangy**

In `handleHighlightClick(color)`:

```ts
async handleHighlightClick(color: HighlightColor) {
  const selection = rangy.getSelection();
  if (selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const text = selection.toString();
  const serialized = rangy.serializeRange(range, true, document.body);
  const id = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const highlighter = rangy.createHighlighter();
  highlighter.addClassApplier(appliers[color]);
  highlighter.highlightSelection(classNameFor(color));

  // Stamp all produced fragments with shared id + text.
  const fragments = Array.from(document.querySelectorAll(`.${classNameFor(color)}:not([data-octobase-highlight-id])`)) as HTMLElement[];
  for (const el of fragments) {
    el.dataset.octobaseHighlightId = id;
    el.dataset.octobaseHighlightText = text;
  }

  selection.removeAllRanges();

  const now = Date.now();
  const record: import("../../types/highlight.ts").Highlight = {
    id,
    text,
    sourceUrl: window.location.href,
    color,
    tags: [],
    notes: "",
    anchor: { serialized },
    createdAt: now,
    updatedAt: now,
  };
  await window.electronAPI.saveHighlight(record);
}
```

Note the type-only import path (`../../types/highlight.ts`) — TypeScript erases it at build time so there's no runtime cost.

- [ ] **Step 2: Update the global `Window` typing**

Replace the existing `electronAPI` declaration block in `highlighter.ts` with:

```ts
import type { Highlight } from "../../types/highlight.ts";

declare global {
  interface Window {
    electronAPI?: {
      sendDragText: (data: { text: string; sourceUrl: string; cursorX: number; cursorY: number; highlightId: string }) => void;
      sendDragPosition: (data: { x: number; y: number }) => void;
      sendDragEnd: (data: { x: number; y: number }) => void;
      loadHighlights: (url: string) => Promise<Highlight[]>;
      saveHighlight: (highlight: Highlight) => Promise<{ ok: true }>;
      deleteHighlight: (id: string) => Promise<{ ok: true }>;
      listTags: () => Promise<string[]>;
      onHighlightUpdated: (callback: (h: Highlight) => void) => void;
      onHighlightDeleted: (callback: (data: { id: string }) => void) => void;
    };
  }
}
```

- [ ] **Step 3: Add re-application on page load**

At the end of the IIFE (after `monitorTextSelection()` and `injectGlobalStyles()` and the `shadowRoot.appendChild(highlighterWidget)`):

```ts
async function reapplyOnLoad() {
  const records = (await window.electronAPI?.loadHighlights(window.location.href)) ?? [];
  for (const r of records) {
    try {
      const range = rangy.deserializeRange(r.anchor.serialized, document.body);
      const sel = rangy.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const highlighter = rangy.createHighlighter();
      highlighter.addClassApplier(appliers[r.color]);
      highlighter.highlightSelection(classNameFor(r.color));
      sel.removeAllRanges();

      // Stamp re-applied fragments with the highlight's id + text.
      const fragments = Array.from(document.querySelectorAll(`.${classNameFor(r.color)}:not([data-octobase-highlight-id])`)) as HTMLElement[];
      for (const el of fragments) {
        el.dataset.octobaseHighlightId = r.id;
        el.dataset.octobaseHighlightText = r.text;
      }
    } catch (err) {
      console.warn("Failed to re-apply highlight", r.id, err);
    }
  }
}
reapplyOnLoad();
```

- [ ] **Step 4: Manual verification**

Run: `npm run electron-dev`
1. Select text, click "yellow" → highlight appears.
2. Select another, click "blue" → highlight appears.
3. Quit and re-launch the app.
4. Wait for the page to load. Both highlights re-appear.
5. Inspect `~/Library/Application Support/<app-name>/highlights.json` — has two records.

Quit.

- [ ] **Step 5: Commit**

```bash
git add src/components/highlighter/highlighter.ts
git commit -m "feat(highlighter): persist highlights and re-apply on load"
```

---

## Task 9: Tag input component (with autocomplete)

**Files:**
- Create: `src/components/highlighter/tag-input.ts`

- [ ] **Step 1: Write `src/components/highlighter/tag-input.ts`**

```ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("octo-tag-input")
export class TagInput extends LitElement {
  static styles = css`
    :host { display: block; font-family: inherit; }
    .wrap {
      display: flex; flex-wrap: wrap; gap: 4px;
      padding: 6px;
      background: #fafafa; border: 1px solid #e5e5e5; border-radius: 6px;
      min-height: 24px; align-items: center;
    }
    .chip {
      font-size: 11px; padding: 2px 8px;
      background: #e0e7ff; color: #3730a3; border-radius: 10px;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .chip-x { cursor: pointer; opacity: 0.5; }
    .chip-x:hover { opacity: 1; }
    input {
      border: none; outline: none; background: transparent;
      font-size: 12px; min-width: 80px; flex: 1;
      font-family: inherit;
    }
    .dropdown {
      position: absolute; background: white; border: 1px solid #e5e5e5;
      border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.1);
      max-height: 160px; overflow-y: auto; min-width: 140px;
      z-index: 10000;
    }
    .suggest {
      padding: 4px 8px; font-size: 12px; cursor: pointer;
    }
    .suggest.active { background: #e0e7ff; color: #3730a3; }
  `;

  @property({ type: Array }) tags: string[] = [];
  @property({ type: Array }) suggestions: string[] = [];

  @state() private input = "";
  @state() private activeIndex = -1;

  private get filteredSuggestions(): string[] {
    const q = this.input.trim().toLowerCase();
    if (!q) return [];
    return this.suggestions
      .filter((s) => s.includes(q) && !this.tags.includes(s))
      .slice(0, 6);
  }

  private commit(value: string) {
    const v = value.trim().toLowerCase();
    if (!v) return;
    if (!this.tags.includes(v)) {
      this.tags = [...this.tags, v];
      this.dispatchEvent(new CustomEvent("tags-changed", { detail: { tags: this.tags } }));
    }
    this.input = "";
    this.activeIndex = -1;
  }

  private removeTag(t: string) {
    this.tags = this.tags.filter((x) => x !== t);
    this.dispatchEvent(new CustomEvent("tags-changed", { detail: { tags: this.tags } }));
  }

  private onKeyDown(e: KeyboardEvent) {
    const sugg = this.filteredSuggestions;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const pick = this.activeIndex >= 0 && sugg[this.activeIndex] ? sugg[this.activeIndex] : this.input;
      this.commit(pick);
    } else if (e.key === "Backspace" && this.input === "" && this.tags.length > 0) {
      this.removeTag(this.tags[this.tags.length - 1]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, sugg.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, -1);
    } else if (e.key === "Tab" && this.activeIndex >= 0 && sugg[this.activeIndex]) {
      e.preventDefault();
      this.commit(sugg[this.activeIndex]);
    } else if (e.key === "Escape") {
      if (this.activeIndex >= 0 || this.input) {
        e.stopPropagation();
        this.input = "";
        this.activeIndex = -1;
      }
    }
  }

  private onInput(e: Event) {
    this.input = (e.target as HTMLInputElement).value;
    this.activeIndex = -1;
  }

  private onBlur() {
    if (this.input.trim()) this.commit(this.input);
  }

  render() {
    const sugg = this.filteredSuggestions;
    return html`
      <div class="wrap">
        ${this.tags.map(
          (t) => html`<span class="chip">${t}<span class="chip-x" @click=${() => this.removeTag(t)}>×</span></span>`
        )}
        <input
          .value=${this.input}
          @input=${this.onInput}
          @keydown=${this.onKeyDown}
          @blur=${this.onBlur}
          placeholder="${this.tags.length ? "" : "+ tag…"}"
        />
        ${sugg.length > 0 ? html`
          <div class="dropdown">
            ${sugg.map(
              (s, i) => html`<div
                class="suggest ${i === this.activeIndex ? "active" : ""}"
                @mousedown=${(e: MouseEvent) => { e.preventDefault(); this.commit(s); }}
              >${s}</div>`
            )}
          </div>
        ` : ""}
      </div>
    `;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/highlighter/tag-input.ts
git commit -m "feat(highlighter): tag input component with autocomplete"
```

---

## Task 10: Edit form component (color row + tags + notes + delete)

**Files:**
- Create: `src/components/highlighter/edit-form.ts`

- [ ] **Step 1: Write `src/components/highlighter/edit-form.ts`**

```ts
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

import { HIGHLIGHT_COLORS, type HighlightColor } from "../../types/highlight.ts";
import { PALETTE } from "./colors.ts";
import "./tag-input.ts";

@customElement("octo-edit-form")
export class EditForm extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      border: 1px solid #eee;
      padding: 14px;
      min-width: 300px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .row { display: flex; gap: 8px; align-items: center; }
    .label {
      font-size: 10px; color: #888; margin: 0 0 6px 0;
      letter-spacing: 0.5px; text-transform: uppercase;
    }
    .header { display: flex; justify-content: space-between; align-items: center; }
    .swatch {
      width: 22px; height: 22px; border-radius: 50%;
      border: 1px solid rgba(0,0,0,0.06); cursor: pointer; padding: 0;
    }
    .swatch.active { border: 2px solid #333; }
    .delete {
      background: transparent; border: none; cursor: pointer;
      color: #888; font-size: 14px; padding: 0 4px;
    }
    .delete:hover { color: #ef4444; }
    textarea {
      width: 100%; min-height: 60px;
      border: 1px solid #e5e5e5; border-radius: 6px;
      padding: 6px; font-size: 12px; resize: vertical;
      box-sizing: border-box; font-family: inherit;
    }
    .colors { display: flex; gap: 8px; margin-bottom: 12px; }
    .pulse { animation: pulse 0.6s ease 2; }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
  `;

  @property({ type: String }) color: HighlightColor | null = null;
  @property({ type: Array }) tags: string[] = [];
  @property({ type: String }) notes: string = "";
  @property({ type: Array }) suggestions: string[] = [];
  @property({ type: Boolean }) showDelete: boolean = false;
  @property({ type: Boolean }) pulseColors: boolean = false;

  private onColorClick(c: HighlightColor) {
    this.color = c;
    this.pulseColors = false;
    this.dispatchEvent(new CustomEvent("color-changed", { detail: { color: c } }));
  }

  private onTagsChanged(e: CustomEvent) {
    this.tags = e.detail.tags;
    this.dispatchEvent(new CustomEvent("tags-changed", { detail: { tags: this.tags } }));
  }

  private onNotesBlur(e: FocusEvent) {
    const v = (e.target as HTMLTextAreaElement).value;
    if (v !== this.notes) {
      this.notes = v;
      this.dispatchEvent(new CustomEvent("notes-changed", { detail: { notes: v } }));
    }
  }

  private onDelete() {
    this.dispatchEvent(new CustomEvent("delete-requested"));
  }

  render() {
    return html`
      <div class="header">
        <p class="label">Color</p>
        ${this.showDelete ? html`<button class="delete" title="Delete highlight" @click=${this.onDelete}>🗑</button>` : ""}
      </div>
      <div class="colors ${this.pulseColors ? "pulse" : ""}">
        ${HIGHLIGHT_COLORS.map((c) => html`
          <button
            class="swatch ${this.color === c ? "active" : ""}"
            style="background:${PALETTE[c].fill}"
            title=${c}
            @click=${() => this.onColorClick(c)}
          ></button>
        `)}
      </div>
      <p class="label">Tags</p>
      <octo-tag-input
        .tags=${this.tags}
        .suggestions=${this.suggestions}
        @tags-changed=${this.onTagsChanged}
        style="margin-bottom: 12px"
      ></octo-tag-input>
      <p class="label">Notes</p>
      <textarea
        .value=${this.notes}
        placeholder="Notes…"
        @blur=${this.onNotesBlur}
      ></textarea>
    `;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/highlighter/edit-form.ts
git commit -m "feat(highlighter): edit form (color row + tags + notes + delete)"
```

---

## Task 11: Compact creation pill + wire to edit form

**Files:**
- Modify: `src/components/highlighter/highlighter.ts`

This task replaces the test-buttons render from Task 7 with the real two-step pill UX.

- [ ] **Step 1: Import the form and palette in highlighter.ts**

```ts
import "./edit-form.ts";
import { PALETTE } from "./colors.ts";
```

- [ ] **Step 2: Replace `HighlighterWidget`'s state and render with the pill state machine**

Replace the existing `HighlighterWidget` class body (keep `updateWidgetPosition`, `show`, `hide`):

```ts
@customElement('highlighter-widget')
export class HighlighterWidget extends LitElement {
  static styles = css`
    :host { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 10px; background: white; border-radius: 24px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.12); border: 1px solid #eee;
    }
    .swatch {
      width: 22px; height: 22px; border-radius: 50%;
      border: 1px solid rgba(0,0,0,0.06); cursor: pointer; padding: 0;
    }
    .divider { width: 1px; height: 20px; background: #e5e5e5; margin: 0 2px; }
    .add-note {
      font-size: 11px; color: #666; cursor: pointer; user-select: none;
      background: transparent; border: none; padding: 4px;
    }
    .add-note:hover { color: #111; }
  `;

  @property({ type: Boolean }) visible = false;

  // step state
  @state() private mode: "pill" | "expanded" = "pill";
  @state() private pulseColors = false;
  @state() private currentId: string | null = null;
  @state() private currentColor: import("../../types/highlight.ts").HighlightColor | null = null;
  @state() private currentTags: string[] = [];
  @state() private currentNotes: string = "";
  @state() private suggestions: string[] = [];

  updateWidgetPosition(rect: DOMRect) {
    this.style.position = 'absolute';
    this.style.top = `${rect.bottom + window.scrollY + 10}px`;
    this.style.left = `${rect.left + window.scrollX}px`;
    this.style.zIndex = '9999';
  }

  show() { this.visible = true; this.mode = "pill"; this.requestUpdate(); }
  hide() { this.visible = false; this.requestUpdate(); }

  private async onSwatch(color: import("../../types/highlight.ts").HighlightColor) {
    if (!this.currentId) {
      // First color click — apply highlight + persist + expand to edit form.
      const id = await applyHighlightFromSelection(color);
      if (!id) return;
      this.currentId = id;
      this.currentColor = color;
      this.currentTags = [];
      this.currentNotes = "";
      this.suggestions = (await window.electronAPI?.listTags()) ?? [];
      this.mode = "expanded";
    } else {
      // Color change after first save — re-apply with new color.
      await changeHighlightColor(this.currentId, color);
      this.currentColor = color;
    }
  }

  private async onAddNote() {
    if (this.currentId) { this.mode = "expanded"; return; }
    // No color picked yet — pulse colors and stay in pill.
    this.pulseColors = true;
    setTimeout(() => { this.pulseColors = false; }, 1300);
  }

  private async onTagsChanged(e: CustomEvent) {
    this.currentTags = e.detail.tags;
    await this.persist();
  }

  private async onNotesChanged(e: CustomEvent) {
    this.currentNotes = e.detail.notes;
    await this.persist();
  }

  private async onColorChangedFromForm(e: CustomEvent) {
    const c = e.detail.color as import("../../types/highlight.ts").HighlightColor;
    if (this.currentId) {
      await changeHighlightColor(this.currentId, c);
      this.currentColor = c;
    }
  }

  private async persist() {
    if (!this.currentId || !this.currentColor) return;
    const record = await loadHighlightById(this.currentId);
    if (!record) return;
    const updated = { ...record, color: this.currentColor, tags: this.currentTags, notes: this.currentNotes, updatedAt: Date.now() };
    await window.electronAPI?.saveHighlight(updated);
  }

  reset() {
    this.currentId = null;
    this.currentColor = null;
    this.currentTags = [];
    this.currentNotes = "";
    this.mode = "pill";
  }

  render() {
    if (!this.visible) return html``;
    if (this.mode === "expanded") {
      return html`<octo-edit-form
        .color=${this.currentColor}
        .tags=${this.currentTags}
        .notes=${this.currentNotes}
        .suggestions=${this.suggestions}
        .pulseColors=${this.pulseColors}
        @color-changed=${this.onColorChangedFromForm}
        @tags-changed=${this.onTagsChanged}
        @notes-changed=${this.onNotesChanged}
      ></octo-edit-form>`;
    }
    return html`
      <div class="pill ${this.pulseColors ? "pulse" : ""}">
        ${HIGHLIGHT_COLORS.map((c) => html`
          <button class="swatch" style="background:${PALETTE[c].fill}" title=${c}
                  @click=${() => this.onSwatch(c)}></button>
        `)}
        <div class="divider"></div>
        <button class="add-note" @click=${this.onAddNote}>+ note</button>
      </div>
    `;
  }
}
```

- [ ] **Step 3: Add helper functions `applyHighlightFromSelection`, `changeHighlightColor`, and `loadHighlightById` near the top of the module**

```ts
async function applyHighlightFromSelection(color: HighlightColor): Promise<string | null> {
  const sel = rangy.getSelection();
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const text = sel.toString();
  if (!text.trim()) return null;
  const serialized = rangy.serializeRange(range, true, document.body);
  const id = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const highlighter = rangy.createHighlighter();
  highlighter.addClassApplier(appliers[color]);
  highlighter.highlightSelection(classNameFor(color));

  // Stamp fragments with the shared id + text.
  for (const el of document.querySelectorAll(`.${classNameFor(color)}:not([data-octobase-highlight-id])`)) {
    const html = el as HTMLElement;
    html.dataset.octobaseHighlightId = id;
    html.dataset.octobaseHighlightText = text;
  }
  sel.removeAllRanges();

  const now = Date.now();
  await window.electronAPI?.saveHighlight({
    id, text, sourceUrl: window.location.href, color,
    tags: [], notes: "",
    anchor: { serialized },
    createdAt: now, updatedAt: now,
  });
  return id;
}

async function changeHighlightColor(id: string, color: HighlightColor): Promise<void> {
  // Remove old class from all fragments of this id; replace with new class; re-stamp.
  const fragments = Array.from(document.querySelectorAll(`[data-octobase-highlight-id="${id}"]`)) as HTMLElement[];
  if (fragments.length === 0) return;
  for (const el of fragments) {
    for (const c of HIGHLIGHT_COLORS) el.classList.remove(classNameFor(c));
    el.classList.add(classNameFor(color));
  }
  const record = await loadHighlightById(id);
  if (record) {
    await window.electronAPI?.saveHighlight({ ...record, color, updatedAt: Date.now() });
  }
}

async function loadHighlightById(id: string): Promise<Highlight | null> {
  const all = await window.electronAPI?.loadHighlights(window.location.href);
  return all?.find((h) => h.id === id) ?? null;
}
```

(Add the matching imports of `Highlight` and `HighlightColor` types to `highlighter.ts`.)

- [ ] **Step 4: Wire click-outside / Escape to reset and hide the widget**

In the IIFE that monitors text selection, add:

```ts
document.addEventListener("mousedown", (e) => {
  const target = e.target as Node;
  // The widget itself sits in shadow DOM; if the click is outside its host element, hide.
  if (!hostElement.contains(target) && highlighterWidget.visible && highlighterWidget.mode === "expanded") {
    highlighterWidget.reset();
    highlighterWidget.hide();
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && highlighterWidget.visible) {
    highlighterWidget.reset();
    highlighterWidget.hide();
  }
});
```

Note: existing `handleTextSelection` re-shows the widget on the next selection.

- [ ] **Step 5: Manual verification**

Run: `npm run electron-dev`
1. Select text → pill appears under selection.
2. Click yellow swatch → highlight applied, pill expands into edit form, yellow ringed.
3. Type "research" + Enter in tag input → chip appears.
4. Type "First reference to highlighters" in notes → blur → saves silently.
5. Click outside → form closes; highlight stays in DOM.
6. Quit and re-launch. Highlight reappears with the same color. Open devtools and check: `await window.electronAPI.loadHighlights(window.location.href)` returns the record with tags + notes intact.

- [ ] **Step 6: Commit**

```bash
git add src/components/highlighter/highlighter.ts
git commit -m "feat(highlighter): two-step pill creation flow"
```

---

## Task 12: Hover-revealed ⋯ button on highlights

**Files:**
- Modify: `src/components/highlighter/highlighter.ts`

- [ ] **Step 1: Add a single shared menu-button element (one in the document, repositioned per hover)**

Near the IIFE that injects styles, add:

```ts
let menuButton: HTMLButtonElement | null = null;
let menuButtonHideTimer: number | null = null;
let menuButtonTargetId: string | null = null;

function ensureMenuButton(): HTMLButtonElement {
  if (menuButton) return menuButton;
  const btn = document.createElement("button");
  btn.className = "octo-hl-menubtn";
  btn.textContent = "⋯";
  btn.style.position = "absolute";
  btn.style.display = "none";
  btn.style.zIndex = "9998";
  btn.style.width = "22px";
  btn.style.height = "22px";
  btn.style.borderRadius = "50%";
  btn.style.border = "1px solid #ddd";
  btn.style.background = "white";
  btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
  btn.style.fontSize = "11px";
  btn.style.color = "#666";
  btn.style.cursor = "pointer";
  btn.style.padding = "0";
  btn.style.lineHeight = "1";
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuButtonTargetId) openEditPanel(menuButtonTargetId, btn.getBoundingClientRect());
  });
  document.body.appendChild(btn);
  menuButton = btn;
  return btn;
}

function showMenuButton(target: HTMLElement) {
  const btn = ensureMenuButton();
  if (menuButtonHideTimer) { clearTimeout(menuButtonHideTimer); menuButtonHideTimer = null; }
  const rect = target.getBoundingClientRect();
  btn.style.top = `${rect.top + window.scrollY - 6}px`;
  btn.style.left = `${rect.right + window.scrollX - 12}px`;
  btn.style.display = "inline-block";
  menuButtonTargetId = target.dataset.octobaseHighlightId ?? null;
}

function scheduleMenuButtonHide() {
  if (menuButtonHideTimer) clearTimeout(menuButtonHideTimer);
  menuButtonHideTimer = window.setTimeout(() => {
    if (menuButton) menuButton.style.display = "none";
    menuButtonTargetId = null;
  }, 250);
}
```

- [ ] **Step 2: Bind hover events on highlight fragments inside `attachFragmentBehavior`**

Add to the function that wraps `onElementCreate`:

```ts
htmlEl.addEventListener("mouseenter", () => showMenuButton(htmlEl));
htmlEl.addEventListener("mouseleave", scheduleMenuButtonHide);
```

And on the menu button itself (inside `ensureMenuButton`):

```ts
btn.addEventListener("mouseenter", () => {
  if (menuButtonHideTimer) { clearTimeout(menuButtonHideTimer); menuButtonHideTimer = null; }
});
btn.addEventListener("mouseleave", scheduleMenuButtonHide);
```

- [ ] **Step 3: Stub `openEditPanel` (full implementation in next task)**

```ts
function openEditPanel(highlightId: string, anchorRect: DOMRect): void {
  console.log("openEditPanel", highlightId, anchorRect);
}
```

- [ ] **Step 4: Manual verification**

Run: `npm run electron-dev`
1. Create a highlight.
2. Hover the highlight → ⋯ button appears at top-right.
3. Move cursor onto the button → button stays visible.
4. Move cursor off both → button disappears after ~250 ms.
5. Click the button → console logs `openEditPanel <id> <rect>`.

- [ ] **Step 5: Commit**

```bash
git add src/components/highlighter/highlighter.ts
git commit -m "feat(highlighter): hover-revealed menu button on highlights"
```

---

## Task 13: Edit panel + delete + undo toast

**Files:**
- Create: `src/components/highlighter/undo-toast.ts`
- Modify: `src/components/highlighter/highlighter.ts`

- [ ] **Step 1: Write `src/components/highlighter/undo-toast.ts`**

```ts
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("octo-undo-toast")
export class UndoToast extends LitElement {
  static styles = css`
    :host {
      position: fixed; bottom: 24px; left: 50%;
      transform: translateX(-50%); z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .toast {
      display: inline-flex; gap: 12px; align-items: center;
      padding: 10px 14px; background: #1f2937; color: white;
      border-radius: 8px; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    button {
      background: transparent; border: none; color: white;
      text-decoration: underline; cursor: pointer; font: inherit;
      opacity: 0.9; padding: 0;
    }
    button:hover { opacity: 1; }
  `;
  @property({ type: String }) message: string = "Highlight deleted";
  private onUndo() {
    this.dispatchEvent(new CustomEvent("undo-clicked"));
  }
  render() {
    return html`<div class="toast"><span>${this.message}</span><button @click=${this.onUndo}>Undo</button></div>`;
  }
}
```

- [ ] **Step 2: Implement `openEditPanel` in `highlighter.ts`**

Replace the stub with:

```ts
let editPanelEl: HTMLElement | null = null;
let editPanelTargetId: string | null = null;
let editPanelLocal: { color: HighlightColor | null; tags: string[]; notes: string } | null = null;

async function openEditPanel(highlightId: string, anchorRect: DOMRect): Promise<void> {
  closeEditPanel();
  const record = await loadHighlightById(highlightId);
  if (!record) return;

  const form = document.createElement("octo-edit-form") as any;
  form.color = record.color;
  form.tags = [...record.tags];
  form.notes = record.notes;
  form.suggestions = (await window.electronAPI?.listTags()) ?? [];
  form.showDelete = true;

  form.style.position = "absolute";
  form.style.top = `${anchorRect.bottom + window.scrollY + 6}px`;
  form.style.left = `${Math.min(anchorRect.left + window.scrollX, window.scrollX + window.innerWidth - 320)}px`;
  form.style.zIndex = "10000";

  editPanelLocal = { color: record.color, tags: [...record.tags], notes: record.notes };
  editPanelTargetId = highlightId;

  form.addEventListener("color-changed", async (e: CustomEvent) => {
    if (!editPanelTargetId || !editPanelLocal) return;
    const c = e.detail.color as HighlightColor;
    editPanelLocal.color = c;
    await changeHighlightColor(editPanelTargetId, c);
  });
  form.addEventListener("tags-changed", async (e: CustomEvent) => {
    if (!editPanelTargetId || !editPanelLocal) return;
    editPanelLocal.tags = e.detail.tags;
    await persistEdit();
  });
  form.addEventListener("notes-changed", async (e: CustomEvent) => {
    if (!editPanelTargetId || !editPanelLocal) return;
    editPanelLocal.notes = e.detail.notes;
    await persistEdit();
  });
  form.addEventListener("delete-requested", async () => {
    const id = editPanelTargetId!;
    closeEditPanel();
    await deleteHighlightWithUndo(id);
  });

  document.body.appendChild(form);
  editPanelEl = form;
}

function closeEditPanel(): void {
  if (editPanelEl && editPanelEl.parentNode) editPanelEl.parentNode.removeChild(editPanelEl);
  editPanelEl = null;
  editPanelTargetId = null;
  editPanelLocal = null;
}

async function persistEdit(): Promise<void> {
  if (!editPanelTargetId || !editPanelLocal) return;
  const record = await loadHighlightById(editPanelTargetId);
  if (!record) return;
  await window.electronAPI?.saveHighlight({
    ...record,
    color: editPanelLocal.color ?? record.color,
    tags: editPanelLocal.tags,
    notes: editPanelLocal.notes,
    updatedAt: Date.now(),
  });
}

document.addEventListener("mousedown", (e) => {
  if (!editPanelEl) return;
  if (editPanelEl.contains(e.target as Node)) return;
  if (menuButton && menuButton.contains(e.target as Node)) return;
  closeEditPanel();
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && editPanelEl) closeEditPanel();
});
```

- [ ] **Step 3: Implement `deleteHighlightWithUndo`**

```ts
import "./undo-toast.ts";

async function deleteHighlightWithUndo(id: string): Promise<void> {
  const record = await loadHighlightById(id);
  if (!record) return;

  // Remove DOM fragments and unwrap.
  const fragments = Array.from(document.querySelectorAll(`[data-octobase-highlight-id="${id}"]`)) as HTMLElement[];
  for (const el of fragments) {
    while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
    el.remove();
  }
  await window.electronAPI?.deleteHighlight(id);

  // Show toast.
  const toast = document.createElement("octo-undo-toast") as any;
  let undone = false;
  toast.addEventListener("undo-clicked", async () => {
    undone = true;
    toast.remove();
    // Re-apply highlight from the saved record.
    try {
      const range = rangy.deserializeRange(record.anchor.serialized, document.body);
      const sel = rangy.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const h = rangy.createHighlighter();
      h.addClassApplier(appliers[record.color]);
      h.highlightSelection(classNameFor(record.color));
      sel.removeAllRanges();
      for (const el of document.querySelectorAll(`.${classNameFor(record.color)}:not([data-octobase-highlight-id])`)) {
        const html = el as HTMLElement;
        html.dataset.octobaseHighlightId = record.id;
        html.dataset.octobaseHighlightText = record.text;
      }
      await window.electronAPI?.saveHighlight({ ...record, updatedAt: Date.now() });
    } catch (err) {
      console.warn("Undo re-apply failed", err);
    }
  });
  document.body.appendChild(toast);
  setTimeout(() => { if (!undone) toast.remove(); }, 5000);
}
```

- [ ] **Step 4: Manual verification**

Run: `npm run electron-dev`
1. Create a highlight, hover, click ⋯ → edit panel opens.
2. Change color → in-page color updates immediately. Reload → color persists.
3. Add a tag, blur → reload, tag persists.
4. Edit notes, blur → reload, notes persist.
5. Click 🗑 → highlight disappears; toast appears at the bottom.
6. Click Undo within 5 s → highlight reappears at the same place.
7. Repeat delete; let toast time out (5 s) → reload → highlight is gone.
8. Click outside the panel → panel closes.

- [ ] **Step 5: Commit**

```bash
git add src/components/highlighter/undo-toast.ts src/components/highlighter/highlighter.ts
git commit -m "feat(highlighter): edit panel, color change, delete with undo"
```

---

## Task 14: Whiteboard reads cards from store + listens for updates

**Files:**
- Modify: `src/app/whiteboard.tsx`

- [ ] **Step 1: Replace the file with the persistence-aware version**

```tsx
import { Box, Paper, Typography, Chip } from '@mui/material';
import * as React from 'react';
import { PALETTE } from '../components/highlighter/colors';
import type { Card } from '../types/highlight';

interface WhiteboardElectronAPI {
  loadCards?: () => Promise<Card[]>;
  saveCard?: (card: Card) => Promise<{ ok: true }>;
  deleteCard?: (id: string) => Promise<{ ok: true }>;
  onCardUpdated?: (cb: (c: Card) => void) => void;
  onCardDeleted?: (cb: (data: { id: string }) => void) => void;
  onHighlightDropped?: (cb: (data: { text: string; sourceUrl: string; x: number; y: number; highlightId: string }) => void) => void;
}

function getElectronAPI(): WhiteboardElectronAPI | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI;
}

function CardView({ card, onMove, onDelete }: { card: Card; onMove: (id: string, x: number, y: number) => void; onDelete: (id: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const offset = React.useRef({ x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - card.x, y: e.clientY - card.y };
    ref.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onMove(card.id, e.clientX - offset.current.x, e.clientY - offset.current.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    ref.current?.releasePointerCapture(e.pointerId);
  };

  let hostname = '';
  try { hostname = new URL(card.sourceUrl).hostname; } catch { hostname = card.sourceUrl; }

  const palette = PALETTE[card.color] ?? PALETTE.yellow;

  return (
    <Paper
      ref={ref}
      elevation={3}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      sx={{
        position: 'absolute',
        left: card.x, top: card.y,
        transform: 'translate(-50%, -50%)',
        width: 240, maxHeight: 260, p: 1.5,
        borderRadius: 2,
        cursor: 'grab', userSelect: 'none', overflow: 'hidden',
        '&:active': { cursor: 'grabbing' },
        display: 'flex', flexDirection: 'column', gap: 0.75,
        backgroundColor: palette.fill,
        borderBottom: `4px solid ${palette.underline}`,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: '0 6px 20px rgba(0,0,0,0.18)' },
      }}
    >
      <Typography
        variant="body2"
        sx={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', lineHeight: 1.5, fontSize: '0.8rem' }}
      >{card.text}</Typography>
      {card.tags?.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {card.tags.map(t => (
            <Chip key={t} label={t} size="small" sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'rgba(255,255,255,0.6)' }} />
          ))}
        </Box>
      )}
      {card.notes && (
        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'rgba(0,0,0,0.7)', whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'hidden' }}>
          {card.notes}
        </Typography>
      )}
      {hostname && (
        <Chip label={hostname} size="small" variant="outlined" sx={{ fontSize: '0.6rem', maxWidth: 180, alignSelf: 'flex-start', mt: 'auto', bgcolor: 'rgba(255,255,255,0.5)' }} />
      )}
    </Paper>
  );
}

export default function Whiteboard(): React.ReactElement {
  const [cards, setCards] = React.useState<Card[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const initial = (await getElectronAPI()?.loadCards?.()) ?? [];
      if (!cancelled) setCards(initial);
    })();
    getElectronAPI()?.onCardUpdated?.((c: Card) => {
      setCards(prev => {
        const idx = prev.findIndex(x => x.id === c.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = c;
          return next;
        }
        return [...prev, c];
      });
    });
    getElectronAPI()?.onCardDeleted?.(({ id }) => {
      setCards(prev => prev.filter(c => c.id !== id));
    });
    return () => { cancelled = true; };
  }, []);

  const handleMove = React.useCallback(async (id: string, x: number, y: number) => {
    setCards(prev => {
      const next = prev.map(c => c.id === id ? { ...c, x, y, updatedAt: Date.now() } : c);
      const moved = next.find(c => c.id === id);
      if (moved) getElectronAPI()?.saveCard?.(moved);
      return next;
    });
  }, []);

  const handleDelete = React.useCallback(async (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    await getElectronAPI()?.deleteCard?.(id);
  }, []);

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {cards.map(c => <CardView key={c.id} card={c} onMove={handleMove} onDelete={handleDelete} />)}
    </Box>
  );
}
```

Note: card delete UI (a button on the card) is intentionally not exposed yet; the spec marks card-side editing as out-of-scope this round. `handleDelete` is wired so adding the trigger later is one line.

- [ ] **Step 2: Manual verification**

Run: `npm run electron-dev`
1. Create a highlight in the right view with a color, tags, notes.
2. Drag it to the whiteboard → card appears with the right color (background fill + underline border), tags as chips, notes below the text.
3. Edit color/tags/notes in the right-view edit panel → card updates without a manual refresh.
4. Drag card on whiteboard → reload app → card position persists.
5. Delete the highlight (right view) → toast → card on whiteboard remains (no cascade).
6. Inspect `whiteboard.json` in `userData` — entries match what's on screen.

- [ ] **Step 3: Commit**

```bash
git add src/app/whiteboard.tsx
git commit -m "feat(whiteboard): persist cards and sync from highlights"
```

---

## Task 15: Final verification pass against the spec

- [ ] **Step 1: Walk through the spec's "Testing" section step by step**

The spec lists 11 manual checks (sec. "Testing"). Run each one in order; check off when verified:

1. Pill appears on selection.
2. Color click applies fill+underline; expanded form shows.
3. Reload preserves all fields.
4. Color change persists across reload.
5. Drag highlight → card with same data.
6. Highlight edit propagates to card live.
7. Card position persists; highlight unaffected.
8. Highlight delete leaves card alone.
9. Undo within 5 s restores highlight.
10. Card delete (via direct `deleteCard` call from devtools — UI deferred) leaves highlight alone.
11. Tag autocomplete offers another highlight's tags.

- [ ] **Step 2: Run all unit tests**

Run: `npm test`
Expected: PASS — all `node:test` files green.

- [ ] **Step 3: Final commit if any fixups**

If anything failed, write a focused fix and commit. If everything passed, skip.

```bash
git add -p   # review
git commit -m "fix(highlighter): <focused fix>"
```

---

## Self-Review

**Spec coverage:**

- ✅ Six pastel colors w/ fill + underline → Tasks 2, 7
- ✅ Free-text tags + autocomplete → Task 9
- ✅ Notes per highlight → Task 10
- ✅ Add tags/notes at create AND edit → Tasks 11, 13
- ✅ Delete with undo → Task 13
- ✅ Survives reload via JSON → Tasks 3, 8
- ✅ Bidirectional sync, last-write-wins → Tasks 4, 14
- ✅ Hover ⋯ trigger → Task 12
- ✅ Whiteboard renders color/tags/notes → Task 14
- ✅ One IPC channel per spec table row → Tasks 4, 5, 6
- ✅ Re-anchoring via Rangy serialize/deserialize → Task 8
- ✅ Per-color class appliers → Task 7

**Placeholder scan:** every step has either explicit code or an explicit command. No "TBD", "TODO", or "fill in details".

**Type consistency:** `Highlight` and `Card` defined in Task 1 are imported by every consumer; field names (`color`, `tags`, `notes`, `anchor.serialized`, `updatedAt`) match across tasks. `classNameFor` and `PALETTE` are defined once (Task 2) and reused.

**Scope check:** one feature, four phases, ends with a working highlighter widget with all features wired end-to-end. No subsystem split needed.

**Ambiguity check:** the "color change after first save" branch in Task 11 uses `changeHighlightColor` which is also reused by the edit panel in Task 13 — same code path, same DOM mutation.
