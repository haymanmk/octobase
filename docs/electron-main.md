# Electron main process

`src/electron/main.js` is the entry point. It owns the parent
`BrowserWindow`, creates the three `WebContentsView`s (`appView`,
`browserView`, `overlayView`), registers every `ipcMain` handler, runs the
capture server and clip protocol, brokers the drag/drop flow, and
supervises renderers so a dead process reloads instead of leaving a blank
window.

## Boot sequence

1. `protocol.registerSchemesAsPrivileged` registers `octobase-clip://` and
   the fetch-capable `octobase-pdf://` (must happen before `app.whenReady`).
2. `app.whenReady()` — open the diagnostics log
   (`userData/octobase.log`), hook `child-process-gone`, then
   `createMainWindow()`.
3. `createMainWindow` constructs the parent window and the three views.
   `appView` and `browserView` are attached immediately; `overlayView` is
   attached only during a drag. `browserView` starts `setVisible(false)`
   until the shell docks it.
4. The highlighter bundle (`dist/highlighter/highlighter.iife.js`) is read
   from disk once at boot and re-injected into the browser view on every
   `did-finish-load` event via `executeJavaScript`, so the widget re-mounts
   on every page navigation. Navigation/title/loading events push
   `browser:state` to the shell's URL bar.
5. A `createStore(app.getPath('userData'))` instance owns
   `highlights.json` and `whiteboard.json` for the lifetime of the app.
6. `ipcMain.handle` / `ipcMain.on` handlers are registered after the store
   exists. The capture-server pairing token is loaded from (or written to)
   `userData/capture-token.txt` and the loopback capture server starts.
   Privileged clip/PDF protocols, PDF storage, and the AI bridge are also
   registered after ready — see below and `capture-extension.md`.

## Window chrome — no native title bar

On macOS the parent window is created with `titleBarStyle: 'hidden'`, so the
shell's own top row runs to the window edge. The traffic lights remain (macOS
draws them above the content views) and are positioned by hand via
`trafficLightPosition: TRAFFIC_LIGHTS`, which centres them on the shell's
topbar row so the buttons and the board title share one line. That couples the
constant to `--ws-topbar-h` in `workspace.css` — see `workspace-kb.md`.

Two consequences the renderer handles (see `workspace-kb.md` → "Window
chrome"):

- Content must stay clear of the buttons — of *both* corners, since
  Windows and Linux draw their controls top-right. The shell reserves those
  gutters, and its top row is a `-webkit-app-region: drag` handle so the
  window can still be moved.
- Fullscreen hides the buttons, so main pushes `window:fullscreen` to the
  shell and the gutter collapses. Leaving fullscreen also resets the custom
  button position, so `leave-full-screen` re-applies it with
  `setWindowButtonPosition`.

## View bounds — renderer-owned

Main's `updateViewBounds()` (creation + window `resize`) only sizes the
full-window views:

```
appView       x=0, y=0, w=width, h=height
overlayView   x=0, y=0, w=width, h=height   (attached only during a drag)
```

`browserView` is *not* laid out by main. The shell renders an empty viewer
slot and streams its rectangle over `pane:set-bounds`
(`ViewerHost.tsx` — `ResizeObserver` + `requestAnimationFrame`); main
rounds and applies it. `pane:set-visible` shows the view only while the
pinned 🌐 browser tab is front and the pane is not suspended (divider drag,
command palette, pairing dialog — the native view paints above the DOM and
would swallow pointer events). Showing the view re-pushes `browser:state`
so a freshly remounted viewer has navigation state.

`browser:navigate` runs the input through `normalizeAddress()`
(`url-normalize.js`): full URLs pass through, bare domains get `https://`,
anything else becomes a Google search. `browser:back` / `browser:forward` /
`browser:reload` drive `webContents.navigationHistory`.

## Self-heal and diagnostics

A renderer crash paints the window white while the chrome still works, so
main leaves a trail and recovers on its own:

- `dlog(...)` appends every diagnostic line to `userData/octobase.log`.
- `superviseView(name, wc)` wraps each of the three views:
  `render-process-gone` is logged and answered with `wc.reload()`;
  `unresponsive` / `responsive` are logged; renderer `console.error`
  messages are mirrored into the log.
- `app.on('child-process-gone')` logs GPU/utility process exits — a GPU
  exit is the classic "everything went blank but the window still moves".
- On the renderer side, `App.tsx` logs uncaught errors and unhandled
  rejections (mirrored into the log) and wraps the shell in an
  `ErrorBoundary`.

## Drag flow

State lives across three processes: the browser-view renderer (where the
user starts the drag from a highlight), main (router), and the overlay-view
renderer (where the drag proxy follows the cursor).

```
browser view              main                  overlay view
------------              ----                  ------------
pointerdown on .octo-hl-*
hold 250 ms
   triggerDrag()
   send('drag-drop-text-selection') ─►
                          addChildView(overlayView)
                          overlayView.setBackgroundColor('#00000001')
                          translate cursor by browserView.getBounds()
                          send('drag-drop-text-selection') ─►
                                                  onDragText -> render proxy

mousemove
   send('drag-drop-text-position') ─►
                          translate, send 'drag-position-update' ─►
                                                  move proxy

mouseup
   send('drag-drop-text-end') ─►
                          send 'drag-end' ─►
                                                  sendDrop({ x, y, ... })
                                                  send('highlight-dropped') ─►
                          restore overlay bg, removeChildView(overlayView)
                          drop outside window? discard
                          else: look up highlight (loadAllHighlights),
                          send enriched 'highlight-dropped' to appView
```

Main no longer persists the dropped card. The shell owns card creation and
placement — it knows the canvas pan/zoom, so it converts the drop point
(sent in appView-local coordinates) to world coordinates, decides what the
point means (over the canvas → placed card, anywhere else → unplaced inbox
card), and saves via `applyHighlightDrop` into the renderer-owned workspace
store — not the legacy `cards:save` IPC. See `workspace-kb.md`.

The `#00000001` background colour on the overlay (alpha = 1/255) is what
makes Chromium hit-test the overlay as opaque so the cursor stays on it
without the user-visible content changing. It is reset to `#00000000`
when the drag ends.

The highlighter widget disables `document.body.style.pointerEvents` for the
duration of the drag so the browser view does not fight the overlay for the
cursor. A defensive `mouseup` listener restores it if `onDragEnd` ever
misses its restore call.

## Region clipping

The shell's ✂ button sends `clip:start`; main injects `CLIP_OVERLAY_JS`
into the live page — a one-shot crosshair/rubber-band overlay that removes
itself and waits two frames before reporting (so its own chrome is never in
the pixels), then reports through the highlighter preload bridge
(`clip:region` or `clip:cancel`). Main runs
`browserView.webContents.capturePage(rect)`, writes the PNG to
`userData/clips/<uuid>.png`, and sends `clip:captured` to the app view,
which turns the reference into an image card. The PNGs are served to the
renderer over the privileged `octobase-clip://c/<file>` protocol
(`protocol.handle` → `net.fetch` of the file URL). Any failure or an
Esc/tiny rect ends in `clip:cancelled`.

After a successful browser clip, main also sends `clip:edit-form` back to the
page. The highlighter-style one-shot form returns color/tags/note metadata over
`clip:annotate`; main relays it to the shell as `clip:annotated`. PDF clipping
does not use `capturePage`: the renderer crops its already-rendered page canvas
and invokes `clip:save`, which persists the PNG into the same clips directory.

## PDF files and parsed-text cache

`pdf:open` uses Electron's native file picker; `pdf:import` accepts the
sandbox-safe absolute path resolved by `webUtils.getPathForFile` for a dropped
file. Both copy the source to `userData/pdfs/<uuid>.pdf`. The renderer loads it
through `octobase-pdf://`, uses PDF.js for rendering/page count/text layers,
and stores only the generated filename on the workspace card.

For AI context, the renderer extracts whole-document markdown once and uses
`pdftext:save` / `pdftext:load` to cache it under `userData/pdf-text`.
`pdf:delete` removes both the imported PDF and that cache entry.

## In-app AI

The OpenAI key and selected model live in `userData/ai.json`. Main encrypts and
decrypts the key with Electron `safeStorage`; only status, configuration
results, and streamed answer deltas cross the preload boundary. `ai:chat`
performs the request in main, sends text chunks as `ai:chat-delta`, and resolves
when streaming ends. `ai:chat-abort` cancels the request by its renderer-minted
request id. Chat history is session-only in `ChatDrawer.tsx`.

## IPC handlers

Persistence handlers thinly wrap the store and broadcast on writes. See
`persistence.md` for store semantics and `architecture.md` for the full
channel matrix.

```js
ipcMain.handle('highlights:load',   ({ url }) => store.loadHighlightsForUrl(url));
ipcMain.handle('highlights:save',   highlight => store.saveHighlight(highlight)
                                                 + broadcast highlight:updated
                                                 + maybe syncCardFromHighlight + broadcast card:updated);
ipcMain.handle('highlights:delete', ({ id })  => store.deleteHighlight(id)
                                                 + broadcast highlight:deleted);
ipcMain.handle('tags:list',         ()        => store.listTags());

ipcMain.handle('cards:load',        ()        => store.loadCards());
ipcMain.handle('cards:save',        card      => store.saveCard(card)
                                                 + broadcast card:updated
                                                 + maybe syncHighlightFromCard + broadcast highlight:updated);
ipcMain.handle('cards:delete',      ({ id })  => store.deleteCard(id)
                                                 + broadcast card:deleted);

ipcMain.handle('extension:info',    ()        => ({ port, token }));  // capture pairing
ipcMain.handle('pdf:*',             ...);                             // import/delete
ipcMain.handle('pdftext:*',         ...);                             // AI text cache
ipcMain.handle('clip:save',         ...);                             // renderer PDF crop
ipcMain.handle('ai:*',              ...);                             // settings/test/chat
```

Both syncs return `null` when nothing of substance changed so the matching
broadcast is skipped — that prevents broadcast loops.

The `ipcMain.on` side covers the pane docking (`pane:set-bounds`,
`pane:set-visible`), browser chrome (`browser:*`), clipping (`clip:*`), AI
abort, and the drag channels — all listed in `architecture.md`.

## Preload scripts

Each renderer has its own preload. They expose only what that renderer
needs; the browser view does not see card APIs and the app view does not
see highlight-persistence APIs.

- `preload.js` — app view (shell) — `loadCards`, `saveCard`, `deleteCard`,
  `onCardUpdated`, `onCardDeleted`, `onHighlightDropped`, pane docking
  (`paneSetBounds`, `paneSetVisible`), browser chrome (`browserNavigate`,
  `browserBack`, `browserForward`, `browserReload`, `onBrowserState`),
  clipping (including annotation and renderer-crop save), PDF import/delete
  and parsed-text cache, AI settings/chat/abort/streaming, and fullscreen
  state. Also exposes
  the `octobaseCapture` bridge (`getInfo`, `onCapture`, `onHighlight`, plus
  reverse-sync hooks main does not send yet) — see `capture-extension.md`.
- `preload-highlighter.js` — browser view — drag IPC senders, clip
  reporting (`clipRegion`, `clipCancel`), `loadHighlights`,
  `saveHighlight`, `deleteHighlight`, `listTags`, `onHighlightUpdated`,
  `onHighlightDeleted`.
- `preload-overlay.js` — overlay view — `onDragText`, `onDragPosition`,
  `onDragEnd`, `sendDrop`.
- `browser-preload.js` — unused; its original job (loading the highlighter
  bundle from disk and calling `highlighterInit`) is done in main via
  `executeJavaScript`.
