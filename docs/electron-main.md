# Electron main process

`src/electron/main.js` is the entry point. It owns the parent
`BrowserWindow`, creates the four `WebContentsView`s, registers every
`ipcMain` handler, and brokers the drag/drop flow between the right view
and the overlay view.

## Boot sequence

1. `app.whenReady().then(() => createSplitView())`.
2. `createSplitView` constructs the parent window, the four views, and
   sets their initial bounds. It also opens DevTools for each view.
3. The highlighter bundle (`dist/highlighter/highlighter.iife.js`) is read
   from disk once at boot and re-injected into the right view on every
   `did-finish-load` event via `executeJavaScript`. This means the widget
   re-mounts on every page navigation in the article browser.
4. A `createStore(app.getPath('userData'))` instance owns
   `highlights.json` and `whiteboard.json` for the lifetime of the app.
5. `ipcMain.handle` and `ipcMain.on` handlers are registered after the
   store exists.

## View bounds

`updateViewBounds()` runs on creation and on every window resize. The
parent is split 50/50 horizontally; the search bar takes the top 50 px of
the right column.

```
LeftView      x=0,            y=0,           w=width/2,        h=height
SearchBarView x=width/2,      y=0,           w=width/2,        h=50
RightView     x=width/2,      y=50,          w=width/2,        h=height-50
OverlayView   x=0,            y=0,           w=width,          h=height
```

`OverlayView` is sized to cover the entire window but is only attached to
`parentWin.contentView` during a drag.

## Drag flow

The drag flow is the most subtle thing the main process does. State lives
across three processes: the right-view renderer (where the user starts the
drag from a highlight), main (router), and the overlay-view renderer (where
the drag proxy follows the cursor).

```
right view                main                  overlay view
----------                ----                  ------------
pointerdown on .octo-hl-*
hold 250 ms
   triggerDrag()
   send('drag-drop-text-selection') ─►
                          addChildView(overlayView)
                          overlayView.setBackgroundColor('#00000001')
                          translate cursor to window coords
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
                          decide if drop is on whiteboard
                          remove overlayView
                          if on whiteboard:
                            persist Card, broadcast 'card:updated'
                          send 'highlight-dropped' to leftView (legacy)
```

The `#00000001` background colour on the overlay (alpha = 1/255) is what
makes Chromium hit-test the overlay as opaque so the cursor stays on it
without the user-visible content changing. It is reset to `#00000000`
when the drag ends.

The highlighter widget disables `document.body.style.pointerEvents` for the
duration of the drag so the right view does not fight the overlay for the
cursor. A defensive `mouseup` listener restores it if `onDragEnd` ever
misses its restore call.

## IPC handlers

Persistence handlers thinly wrap the store and broadcast on writes. See
`persistence.md` for store semantics.

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
```

Both syncs return `null` when nothing of substance changed so the matching
broadcast is skipped — that prevents broadcast loops.

## Preload scripts

Each renderer has its own preload. They expose only what that renderer
needs; the right view does not see card APIs and the left view does not
see highlight APIs.

- `preload.js` — left view (whiteboard) — `loadCards`, `saveCard`,
  `deleteCard`, `onCardUpdated`, `onCardDeleted`, plus legacy
  `onHighlightDropped` from before the broadcast model.
- `preload-highlighter.js` — right view (article browser) — drag IPC
  senders + `loadHighlights`, `saveHighlight`, `deleteHighlight`,
  `listTags`, `onHighlightUpdated`, `onHighlightDeleted`.
- `preload-overlay.js` — overlay view — `onDragText`, `onDragPosition`,
  `onDragEnd`, `sendDrop`.
- `browser-preload.js` — currently unused on the right view; its original
  job (loading the highlighter bundle from disk and calling
  `highlighterInit`) is now done in main via `executeJavaScript`.
