# Workspace / knowledge-base core

The knowledge base added in 2026-06 (specs:
`docs/superpowers/specs/2026-06-22-kb-core-design.md`). This is the Heptabase-
style core: multiple whiteboards of cards (notes / highlights / articles /
image clips), linked, tagged, and searchable. `src/App.tsx` mounts
`Workspace` directly — it is the app's UI.

## Layout

```
src/lib/                         framework-free foundation
  model/types.ts                 Card (note|highlight|article|image), Whiteboard,
                                 Placement, Link, Edge, WorkspaceData
  model/ids.ts                   prefixed unique IDs
  model/wikilinks.ts             [[Title]] / [[Title|alias]] / ![[embed]] parsers
  anchor/text-anchor.ts          durable text-quote+position anchoring
                                 (describeAnchor / locateAnchor / DOM Range)
  store/persistence.ts           PersistenceBackend (localStorage + memory)
  store/workspace-store.ts       WorkspaceStore: CRUD, inbox, edges, embeds,
                                 link graph, search

src/workspace/                   React UI
  store-context.ts               StoreContext + useWorkspace/useWorkspaceStore
  WorkspaceProvider.tsx          creates + inits the store; extension IPC intake
  Workspace.tsx                  shell: grid layout, topbar, menus, toast,
                                 drop routing, viewer-tab state
  Sidebar.tsx                    whiteboards, library toggle, tags, search trigger
  LibraryPanel.tsx               all cards as searchable/filterable drag tiles
  Canvas.tsx / CanvasCard.tsx    the whiteboard canvas — see whiteboard.md
  EdgeLayer.tsx / edge-geometry.ts   mind-map connectors — see whiteboard.md
  CardMarkdownEditor.tsx         TipTap WYSIWYG markdown (in-place card editor)
  card-embed-node.ts             TipTap atom keeping ![[embeds]] intact
  MarkdownView.tsx               react-markdown + GFM + wikilinks + embed mini-cards
  CommandPalette.tsx             ⌘K search: results + live preview pane
  ViewerHost.tsx / viewer-layout.ts  tabbed right pane: live browser + readers
  reader/Reader.tsx              captured-article reader with highlight overlay
  drop-highlight.ts              browser-pane highlight drop → card
  electron-bridge.ts             typed accessors for every preload-exposed API
  dnd.ts                         CARD_DRAG_MIME (shared card drag payload)
  workspace.css                  editorial-library design system
```

## Key facts

- **Storage is pluggable.** `WorkspaceStore` talks to a `PersistenceBackend`.
  Today that is `LocalStoragePersistence` (key `octobase.workspace.v1`), so the
  whole app runs and is verifiable in a plain browser via `npm run vite-dev`
  (only the live-browser tab and clipping need Electron). An Electron JSON
  backend and a sync backend slot in without UI changes.
- **React reactivity** uses a monotonic `version` counter via
  `useSyncExternalStore` — components call store methods directly and re-render
  on `version` change. Do not put `store.getVersion()` inside a dep array
  expression (lint); hoist it to a `const version = store.getVersion()` first.
- **Wikilinks and embeds** are markdown text. `MarkdownView` rewrites
  `[[Title]]` to a `wikilink:` URL and `![[Title]]` to an `embed:` image URL
  (`urlTransform` whitelists both schemes), then renders custom spans — a
  resolved depth-0 embed becomes a mini-card, everything else a chip. In the
  editor, embeds are an inert TipTap atom (`card-embed-node.ts`) whose React
  node view (`card-embed-view.tsx`) renders the same mini-card as the read
  view, so entering edit mode doesn't reflow embeds into chips.
- **Markdown round-trip**: cards store markdown. TipTap loads it via
  tiptap-markdown and serializes back with `editor.storage.markdown.getMarkdown()`.
- **The link graph is derived**, not stored — `getBacklinks` /
  `getOutgoingLinks` / `getChildCards` scan card bodies by normalized title
  ([[links]] and ![[embeds]] both count). Currently store-API only; the
  Inspector panel that surfaced it was dropped in the July shell refit.
- **Edges are stored** (unlike wikilinks): board-scoped connector records in
  `WorkspaceData.edges`, deleted with their board, card, or placement.
  Mechanics in `whiteboard.md`.

## Shell layout

`Workspace.tsx` lays the window out as a CSS grid:
`[sidebar] [library] [board] [divider + viewer]`, each side pane optional.

| Pane | Notes | Persisted as |
|---|---|---|
| Sidebar | boards (rename/delete), library toggle with unplaced-card count, tag chips | section fold state: `octobase.sidebar.closed` |
| Library panel | every live card as a drag tile; search box + kind filters (All/Unplaced/Notes/Highlights/Articles/Clips); drag payload is `CARD_DRAG_MIME`, accepted by the canvas (place) and by notes (embed) | open flag: `octobase.library.open` |
| Viewer pane | tab strip over one slot: a pinned 🌐 tab hosting the native browser `WebContentsView`, plus 📖 reader tabs (one per article card, deduped by source URL). Resizable divider (double-click = 50/50). | `octobase.viewer.layout` (open, width, sidebar, tabs) |

The native browser view paints above the DOM, so `ViewerHost` streams the
slot rectangle to main (`paneSetBounds`) only while the browser tab is
front, and hides the view during divider drags and full-window overlays
(⌘K, dialogs). Reader tabs are plain DOM, so the problem can't occur there.
Opening a card routes by kind: articles → reader tab; notes/highlights →
placed on the active board (if needed) and edited in place. "Read" on a
highlight opens its source article and scrolls to the highlight. Library
tiles and ⌘K results don't place cards anymore: tiles select on click
(drag is the add gesture; right-click/⋯ opens the board card menu minus
"Remove from board", with inline rename), and ⌘K Enter jumps to where
the card lives — readable cards via `readCard`, board-dwelling cards via
`centerOn` (switching boards when needed).

## Capture and clip intake

All Electron-only inputs arrive through typed bridges in
`electron-bridge.ts`; everything degrades gracefully in a plain browser.

| Input | Path | Lands as |
|---|---|---|
| Chrome-extension capture / highlight | localhost capture server → IPC → `WorkspaceProvider` | article card (re-capture updates in place) / highlight card upserted by extension id |
| Highlight dragged out of the browser pane | `highlight-dropped` IPC → `Workspace` → `applyHighlightDrop` | highlight card placed at the drop point, or inbox if dropped elsewhere; re-drops move rather than duplicate |
| Browser clip (✂ in the browser tab, drag a rectangle) | main saves a PNG under `userData/clips`, served via `octobase-clip://` → `clip:captured` IPC | image card in the library (unplaced); the panel opens to show it |

## Relationship to the older subsystems

The pre-Workspace UI is legacy: `src/app/*` (React Router routes,
`layout.tsx`, the MUI `whiteboard.tsx`) is reachable only via
`npm run dev-react`, and the `cards:*` IPC / `whiteboard.json` store in
`main.js` serves nothing the Workspace uses. The browser-pane highlighter
(`highlighter.md`) still persists its own records to `highlights.json`
(`persistence.md`) — the workspace copy created on drop is keyed by the
same highlight id, but there is no ongoing sync between the two stores.
The page highlighter anchors with rangy-serialized ranges the workspace
can't reuse, so `drop-highlight.ts` synthesizes a text-quote anchor from
the highlight text. `architecture.md` still describes the pre-Workspace
four-view shell; the current shell is one app view plus the docked browser
view and drag overlay.
