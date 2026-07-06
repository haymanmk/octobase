# Architecture

## Process model

Octobase is a single Electron app with one main process and three renderer
processes, each backing a `WebContentsView`. The main process owns the
parent `BrowserWindow`, the JSON stores, and the capture server; renderers
talk to each other only through main-mediated IPC.

```
              BrowserWindow (parentWin)
+---------------------------------------------------+
|  appView — the React shell, spans the window      |
|                                                   |
|  +---------+------------------+--+-------------+  |
|  | Sidebar |     Canvas       |‖ | Viewer pane |  |
|  | library |   (whiteboard)   |‖ | tabs: 🌐 📖 |  |
|  |         |                  |‖ | [viewer     |  |
|  |         |                  |‖ |  slot]◄─────┼──┼── browserView docked
|  +---------+------------------+--+-------------+  |    here when the 🌐
|                                 divider            |    tab is active
+---------------------------------------------------+

       overlayView (full window, added only during a highlight drag)
       Main process (Node) — highlights.json + whiteboard.json,
                             capture server, clip PNGs
```

| View | Role |
|---|---|
| `appView` | The React shell (`Workspace`): whiteboard canvas, sidebar/library, viewer tab strip, browser URL bar. Full-window, always attached. |
| `browserView` | A live web page with the highlighter injected. Hidden at boot; docked into the shell's viewer slot while the pinned 🌐 tab is active. |
| `overlayView` | Drag proxy — attached to the window only while a highlight is being dragged. |

**Bounds are renderer-owned.** Main's `updateViewBounds()` (window `resize`)
only sizes the full-window views (`appView`, `overlayView`). The shell
renders an empty viewer slot and streams its rectangle to main over
`pane:set-bounds` (a `ResizeObserver` + rAF loop in `ViewerHost.tsx`); main
just applies the rect to `browserView`. `pane:set-visible` hides the native
view whenever the browser tab is not front, or while the divider is dragged
or a shell overlay (command palette, pairing dialog) is up — the native view
paints above the DOM, so it must get out of the way. 📖 reader tabs render
captured articles as plain DOM inside the shell; the native view stays
hidden for those. See `workspace-kb.md` for the shell itself.

## Renderer responsibilities

| Renderer | Loaded content | Preload script | Purpose |
|---|---|---|---|
| `appView` | `dist/index.html` (React app → `App.tsx` → `Workspace`) | `preload.js` | Knowledge-base shell: canvas, cards, viewer chrome, layout ownership. |
| `browserView` | Any user-supplied URL (defaults to a remote docs page) | `preload-highlighter.js` | The article browser. Main injects the highlighter IIFE bundle on every `did-finish-load`. |
| `overlayView` | `dist/src/components/overlay-canva/overlay-canva.html` | `preload-overlay.js` | Drag proxy — follows the cursor during a highlight drag. |

There is no separate search-bar view any more: the URL bar and nav buttons
are React components in the shell (`ViewerHost.tsx`) that drive the native
view over `browser:*` IPC.

The shell is React (no router — `App.tsx` mounts `Workspace` directly; the
old file-based routes under `src/app/` are legacy). The in-page highlighter
is *not* React; it is a set of Lit web components bundled as a single IIFE
and side-loaded into whatever page the user is reading. See `highlighter.md`
for the rationale.

## IPC matrix

Renderer → main lines are split between `ipcMain.handle` (request/reply via
`ipcRenderer.invoke`) and `ipcMain.on` (fire-and-forget via
`ipcRenderer.send`). Main → renderer lines all use `webContents.send`.

Request/reply:

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `highlights:load` | browser view → main | `{ url }` | `Highlight[]` filtered to the URL |
| `highlights:save` | browser view → main | `Highlight` | `{ ok: true }` |
| `highlights:delete` | browser view → main | `{ id }` | `{ ok: true }` |
| `tags:list` | browser view → main | — | `string[]` |
| `cards:load` | app view → main | — | `Card[]` (legacy†) |
| `cards:save` | app view → main | `Card` | `{ ok: true }` (legacy†) |
| `cards:delete` | app view → main | `{ id }` | `{ ok: true }` (legacy†) |
| `extension:info` | app view → main | — | `{ port, token }` for extension pairing |

† The `cards:*` channels serve the legacy `src/app/whiteboard.tsx` route
only. The live shell (`App.tsx` → `Workspace`) persists cards in its own
renderer-owned store (localStorage) and never calls them — see
`persistence.md`.

Fire-and-forget:

| Channel | Direction | Payload |
|---|---|---|
| `pane:set-bounds` | app view → main | `{ x, y, width, height }` viewer-slot rect |
| `pane:set-visible` | app view → main | `boolean` |
| `browser:navigate` | app view → main | raw address-bar input (normalized in main) |
| `browser:back` / `browser:forward` / `browser:reload` | app view → main | — |
| `clip:start` | app view → main | — (injects the region-select overlay) |
| `clip:region` | browser view → main | `{ x, y, width, height }` selected rect |
| `clip:cancel` | browser view → main | — |
| `drag-drop-text-selection` | browser view → main | `{ text, sourceUrl, cursorX, cursorY, highlightId }` |
| `drag-drop-text-position` | browser view → main | `{ x, y }` (mouse move while holding drag) |
| `drag-drop-text-end` | browser view → main | `{ x, y }` (mouseup) |
| `highlight-dropped` | overlay → main | `{ text, sourceUrl, x, y, highlightId }` |
| `text-selection` | browser view → main | registered but a no-op stub |

Broadcasts (main → renderer):

| Channel | Target | Payload | Triggered by |
|---|---|---|---|
| `browser:state` | app view | `{ url, title, canGoBack, canGoForward, loading }` | every navigation/title/loading event, and `pane:set-visible(true)` |
| `highlight:updated` | browser view | `Highlight` | `highlights:save`; `cards:save` when the sync changed something |
| `highlight:deleted` | browser view | `{ id }` | `highlights:delete` |
| `card:updated` | app view | `Card` | `cards:save`; `highlights:save` when a matching card exists |
| `card:deleted` | app view | `{ id }` | `cards:delete` |
| `highlight-dropped` | app view | enriched drop `{ highlightId, text, sourceUrl, color, tags, notes, x, y }` | overlay's drop landing inside the window |
| `clip:captured` | app view | `{ file, w, h, sourceUrl, title }` | successful region capture |
| `clip:cancelled` | app view | — | Esc / tiny rect / capture failure |
| `capture:received` | app view | capture payload | Chrome extension `POST /capture` |
| `highlight:received` | app view | highlight payload | Chrome extension `POST /highlight` |
| `drag-drop-text-selection` | overlay | drag data, cursor in window coords | relay of the browser-view channel |
| `drag-position-update` | overlay | `{ x, y }` window coords | relay of `drag-drop-text-position` |
| `drag-end` | overlay | — | relay of `drag-drop-text-end` |

`preload.js` also declares an `octobaseCapture` bridge for
`capture:highlight-remove`, `capture:highlights-request` and a
`capture:highlights-response` sender; main does not send or listen on these
yet (the capture server's `onHighlightDelete` / `onListHighlights` hooks are
not wired up). See `capture-extension.md`.

## Sync rules

Both directions of the highlight↔card sync are mediated by main and
propagated through the broadcasts above. Note that the `cards:save` side
only fires for the legacy whiteboard route; in the live shell the workspace
store owns cards and this sync degenerates to the highlights side plus the
drop flow below.

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
- Dropping a highlight does **not** persist a card in main. Main enriches
  the drop with the stored highlight's color/tags/notes and forwards it to
  the shell, which knows the canvas pan/zoom and decides what the drop point
  means (over the canvas → placed card, anywhere else → unplaced inbox
  card). The shell saves through `applyHighlightDrop` into the
  renderer-owned workspace store (localStorage) — the legacy `cards:save`
  IPC is never involved. See `persistence.md`.

See `persistence.md` for details on each store function and the JSON
on-disk layout.
