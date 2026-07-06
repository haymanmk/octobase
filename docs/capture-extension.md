# Article reader + web capture (Phases 3–4)

Design: `docs/superpowers/specs/2026-06-22-capture-and-reader-design.md`.

## Shared extractor (P1-adjacent)

`src/lib/extract/extract-article.ts` — Readability + Turndown(+gfm) turns a DOM
Document into `{ title, byline, siteName, markdown, excerpt, textContent }`.
Runs in any DOM context (a browser tab or linkedom in Node tests) and is used by
**both** the in-app reader and the extension, so capture behaves identically
either way.

## In-app reader (P3) — `src/workspace/reader/`

- `Reader.tsx` renders article cards as 📖 tabs in the dockable viewer pane
  (`ViewerHost.tsx`), next to the pinned live-browser tab — not full-screen.
  Serif/sans toggle and font-size controls (persisted to
  `octobase.reader.prefs`); "↗ Open in browser" routes the source URL to the
  live-browser tab.
- `highlight-overlay.ts` resolves a card's highlights against the rendered
  article (shared `locateAnchorRange`) and returns **marker-band rects**
  (`bandsFor`: one per line box, spanning the middle 50% of the line — the
  same stroke the live-browser highlighter paints, so inline-code chips stay
  legible). `Reader.tsx` paints them as absolutely-positioned divs and
  re-measures on reflow; the CSS Custom Highlight API can't draw the
  partial-height stroke, so the reader no longer uses it (the extension still
  does). Clicks hit-test back to the card via `offsetFromPoint` /
  `highlightAtOffset` (caret-from-point).
- Selecting text shows the shared toolbar pill (`toolbar-ui.ts` — same styles
  as the injected widget and the extension; see `highlighter.md`); picking a
  color creates an anchored `HighlightCard` and expands straight into the edit
  popover. **Click an existing highlight** to edit it (recolor / tags / note /
  delete); **hold-drag** one out of the article to place its card on the
  whiteboard — the capture loop, fully in-app.
- Opening an article card opens a reader tab; notes/highlights are placed on
  the board and edited in place. Context-menu "Read" on a highlight card opens
  its captured source article and scrolls to the highlight.

## Capture server (P4) — `src/electron/capture-server.js`

Loopback HTTP server (default `127.0.0.1:7373`) the extension posts to.

| Method | Path | Auth | Body / Query |
|---|---|---|---|
| GET | `/health` | none | — |
| POST | `/capture` | `X-Octobase-Token` | `{ url, title, markdown, byline?, siteName? }` |
| POST | `/highlight` | `X-Octobase-Token` | `{ id, url, color, exact, anchor, note? }` — upsert by `id` |
| POST | `/highlight/delete` | `X-Octobase-Token` | `{ id }` |
| GET | `/highlights?url=` | `X-Octobase-Token` | → `{ highlights: [{ id, color, anchor, exact }] }` (reverse sync) |

`main.js` starts it and forwards captures/highlights to the KB renderer over IPC
(`capture:received` / `highlight:received`); they land in the **inbox**. The
pairing token + port are shown in-app via "Connect extension" in the topbar's
⋯ menu (Electron only) → `extension:info`.

## Chrome extension (P4) — `src/extension/`

MV3. Reuses `src/lib` anchoring + extractor verbatim.

- `content.ts` — selection → toolbar pill (shared `toolbar-ui.ts` styles in a
  shadow-DOM host) → `describeAnchorFromRange` → POST `/highlight` (via the
  worker). Each highlight carries a stable `id`, is cached in
  `chrome.storage.local` keyed by URL, and **re-painted on every page load**
  via the shared `paintAnchors` (CSS Custom Highlight API) over
  `locateAnchorRange` (the same anchor→DOM-range logic the reader uses), so
  highlights survive refreshes.
  **Click an existing highlight** to open an edit popover: recolor, add a note,
  or delete — each updates the cache, re-paints, and syncs to the app card
  (same `id`). "Capture article" runs the shared extractor.

  **Two-way sync:** edits/deletes on the page upsert/delete the matching app
  card by `id`. On page load the content script also pulls the app's current
  highlights (`GET /highlights?url`) and reconciles: app values win for known
  ids, app-side deletes are honored (tracked via a synced-id set so unsynced
  local highlights are never wiped), and app-only highlights are added. Falls
  back to the local cache when the app is unreachable.
- `background.ts` — the only network talker: adds the token, posts, and queues
  failed sends in `chrome.storage` to retry (alarm + on next `/health` ok).
  Badge shows queued count. Context-menu entries mirror the popup.
- `popup.ts/html` — connection status, "Capture this article", pairing settings.

### Build & load

```bash
npm run build:extension      # → dist-extension/ (esbuild bundle)
```

Then chrome://extensions → enable Developer mode → **Load unpacked** →
`dist-extension/`. Open the popup → Connection settings → paste the port + token
from octobase's "Connect extension" panel.

Notes:
- The **Capture** button and the **right-click menu** inject the content script
  on demand, so they work on any tab — including tabs that were already open
  before you loaded the extension.
- The **inline selection highlighter** (the color toolbar on text selection) is a
  declared content script, so it only appears on pages loaded *after* the
  extension was installed/reloaded. **Reload an already-open tab** to enable it
  there.
- The pairing **token is persisted** by the app (`<userData>/capture-token.txt`),
  so it stays valid across restarts — pair once.

## What's verified vs. what needs a desktop run

- **Verified (CI-able):** the extractor (4 tests, linkedom), the capture server
  (9 HTTP tests), the server→store contract (`capture-integration.test.ts`), the
  shared toolbar CSS (`toolbar-ui.test.ts`), and all P1/P2/P3 unit + in-browser
  checks. The extension bundles clean and type-checks.
- **Needs a desktop run:** the Electron IPC hop (server → renderer card) and the
  extension running inside real Chrome (content script, service-worker fetch,
  popup). These can't be exercised headlessly here; load-unpacked + `npm run dev`
  to try the full loop.
