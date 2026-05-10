# Architecture

## Process model

Octobase is a single Electron app with one main process and four renderer
processes, each backing a different `WebContentsView`. The main process owns
the parent `BrowserWindow` and all persisted state; renderers talk to each
other only through main-mediated IPC.

```
              BrowserWindow (parentWin)
+------------------+--------------------------+
|                  |    SearchBarView         |
|                  +--------------------------+
|                  |                          |
|    LeftView      |        RightView         |
|   (whiteboard)   |   (article browser +     |
|                  |    highlighter widget)   |
|                  |                          |
+------------------+--------------------------+

       OverlayView (full window, added only during a drag)
       Main process (Node) — owns highlights.json + whiteboard.json
```

Bounds are recomputed on every window `resize` event by
`updateViewBounds()` in `src/electron/main.js`. The window is split 50/50
horizontally with the search bar pinned to the top of the right column.

## Renderer responsibilities

| Renderer | Loaded content | Preload script | Purpose |
|---|---|---|---|
| `leftView` | `dist/index.html` (React app, whiteboard route) | `preload.js` | Whiteboard pane; renders persisted cards from the JSON store. |
| `searchBarView` | `dist/src/components/searchbar/searchbar.html` | — | URL bar / search input above the right pane. |
| `rightView` | Any user-supplied URL (defaults to a remote docs page) | `preload-highlighter.js` | The article browser. Main injects the highlighter IIFE bundle into this view on `did-finish-load`. |
| `overlayView` | `dist/src/components/overlay-canva/overlay-canva.html` | `preload-overlay.js` | Drag proxy — added to the parent window only while a highlight is being dragged. |

The whiteboard renderer is React + MUI + React Router (file-based routes
under `src/app/`). The right-pane highlighter is *not* React; it is a set of
Lit web components bundled as a single IIFE and side-loaded into whatever
page the user is reading. See `highlighter.md` for the rationale.

## IPC matrix

The full set of channels is below. Renderer → main lines are split between
`ipcMain.handle` (request/reply via `ipcRenderer.invoke`) and `ipcMain.on`
(fire-and-forget via `ipcRenderer.send`). Main → renderer lines all use
`webContents.send`.

Request/reply (persistence layer):

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `highlights:load` | right view → main | `{ url }` | `Highlight[]` filtered to the URL |
| `highlights:save` | right view → main | `Highlight` | `{ ok: true }` |
| `highlights:delete` | right view → main | `{ id }` | `{ ok: true }` |
| `tags:list` | right view → main | — | `string[]` |
| `cards:load` | left view → main | — | `Card[]` |
| `cards:save` | left view → main | `Card` | `{ ok: true }` |
| `cards:delete` | left view → main | `{ id }` | `{ ok: true }` |

Fire-and-forget (drag flow):

| Channel | Direction | Payload |
|---|---|---|
| `drag-drop-text-selection` | right view → main | `{ text, sourceUrl, cursorX, cursorY, highlightId }` |
| `drag-drop-text-position` | right view → main | `{ x, y }` (mouse move while holding drag) |
| `drag-drop-text-end` | right view → main | `{ x, y }` (mouseup) |
| `highlight-dropped` | overlay → main | `{ text, sourceUrl, x, y, highlightId }` |

Broadcasts (main → renderer, after each successful write):

| Channel | Target | Payload | Triggered by |
|---|---|---|---|
| `highlight:updated` | right view | `Highlight` | `highlights:save`, `cards:save` (when content changed) |
| `highlight:deleted` | right view | `{ id }` | `highlights:delete` |
| `card:updated` | left view | `Card` | `cards:save`, `highlights:save` (when matching card exists), `highlight-dropped` |
| `card:deleted` | left view | `{ id }` | `cards:delete` |

## Sync rules

Both directions of the sync are mediated by main and propagated through the
broadcasts above.

- Each save stamps `updatedAt = Date.now()` in the sending renderer. Main
  writes the record verbatim and does no merge.
- After `highlights:save`, main updates the matching card via
  `syncCardFromHighlight` (color, text, sourceUrl, tags, notes; *not* x/y)
  and broadcasts `card:updated`.
- After `cards:save`, main updates the matching highlight via
  `syncHighlightFromCard` (color, tags, notes; *not* text or anchor)
  and broadcasts `highlight:updated` if anything changed.
- Delete is one-sided: deleting a highlight leaves the card; deleting a
  card leaves the highlight.

See `persistence.md` for details on each store function and the JSON
on-disk layout.
