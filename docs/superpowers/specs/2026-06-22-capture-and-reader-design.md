# octobase — Article Reader + Capture Extension (Phase 3 + Phase 4) Design

Date: 2026-06-22
Status: **Implemented** (P3 reader + P4 server/extension built). Foundation (P1)
and KB core (P2) were done first. See `docs/capture-extension.md` for how to run
and what is verified vs. needs a desktop run.

This is the concrete answer to "do we need a Chrome extension?" — **yes**, and
here is how it plugs into what now exists.

## Why an extension (recap)

The in-app Electron browser cannot carry the user's real sessions, logins,
paywall access, or ad-blockers. To highlight/capture *any* article the user
actually reads, meet them in their own browser. The extension reuses the P1
anchoring + card model; nothing is built twice.

## Phase 3 — Article reader + capture rendering (in-app)

Goal: render a captured article inside octobase with the app's own typography,
overlay its highlights, and link back to the source.

- New card kind already modeled: `ArticleCard { sourceUrl, siteName, byline,
  body(markdown) }` + `HighlightCard { sourceUrl, anchor }`.
- **Extraction**: Readability/Defuddle-style DOM → clean markdown. In Electron
  this can run in the right-pane `WebContentsView` (inject an extractor, return
  markdown over IPC). Store as an `ArticleCard`.
- **Reader view**: open an article card full-screen; render its markdown with
  the workspace's font/size/theme controls (reuse `MarkdownView`, add a reader
  chrome with font-size + measure controls).
- **Highlight overlay**: for each `HighlightCard` whose `sourceUrl` matches,
  `locateAnchor(articlePlainText, anchor)` (P1) → wrap the range with the
  six-color marker styling. Clicking a highlight selects its card.
- **Locate original**: "open original ↗" (already in the Inspector) loads the
  live URL in the in-app browser / external browser, and re-applies anchors via
  the existing highlighter bundle.

Reuse: `text-anchor.ts`, `MarkdownView`, `PALETTE`, card model. New: extractor
adapter, reader chrome, overlay renderer.

## Phase 4 — Chrome extension

Goal: highlight any site + capture the full article from the user's own Chrome,
delivered into the desktop app.

### Transport (user-chosen): localhost server

The Electron main process runs a small loopback HTTP+WebSocket server (e.g.
`127.0.0.1:7373`, token-guarded). The extension POSTs captures/highlights; the
app persists them via the same store and broadcasts to the renderer.

```
Chrome extension ──POST /capture {url, title, markdown, byline}──▶ localhost:7373 ──▶ WorkspaceStore.addCard(ArticleCard)
                 ──POST /highlight {url, anchor, exact, color}───▶               ──▶ WorkspaceStore.addCard(HighlightCard)
```

- No accounts, offline, single-machine — matches "local-first".
- Health/handshake endpoint so the extension shows connected/disconnected.
- Same-origin token written to a known location the extension reads on pairing.

### Extension pieces (MV3)

- **Content script**: selection → `describeAnchorFromRange(root, range)` (P1,
  shared verbatim) → POST `/highlight`; draws the marker locally for feedback.
- **"Capture article" action**: run the SAME extractor as P3 (shared module,
  bundled into the extension) → POST `/capture`.
- **Service worker**: connection state, retry/queue when the app is closed
  (buffer in `chrome.storage`, flush on next handshake).
- **Popup**: connection status + recent captures.

### Shared-code strategy

Factor `text-anchor.ts` and the extractor into a framework-free package
consumed by both the Electron app and the extension build (a third Vite build
target, like the existing highlighter IIFE). The anchor format is already
plain strings — portable as-is.

### Round-trip / "locate where it came from"

Captured `HighlightCard.anchor` works against both the captured article body
(P3 reader overlay) and the live page (extension re-highlight on revisit), so a
highlight is findable in-app and on the original site.

## Phase 5 — Sync (future)

The model is already sync-ready (stable IDs, `updatedAt`, `deletedAt`). A sync
backend implements `PersistenceBackend` (or wraps it with a merge layer); the
localhost server can forward to it. Out of scope until P3/P4 land.

## Open decisions for the next session

- Extractor library: Defuddle (already available via the obsidian plugin) vs
  Mozilla Readability — prototype both on 3–4 real articles.
- Port + token UX for first-run pairing.
- Whether the Electron right-pane browser stays or is de-emphasized once the
  extension covers arbitrary sites.
