# Persistence

Persistent state now lives in two layers:

1. **The workspace document** — the whole knowledge base (cards, whiteboards,
   placements, edges) as one JSON document, owned by the renderer and stored
   in `localStorage`.
2. **Main-process JSON files** under the Electron `userData` directory
   (typically `~/Library/Application Support/octobase-react-ui/` on macOS) —
   page highlights for the in-app browser pane, plus a legacy card file.

On disk (`userData`):

- `highlights.json` — `Highlight[]` (rangy-anchored page highlights, live)
- `whiteboard.json` — legacy `Card[]` (pre-workspace whiteboard; see below)
- `clips/*.png` — region clips of the browser pane, served to the renderer
  via the `octobase-clip://c/<file>` protocol
- `capture-token.txt` — Chrome-extension pairing token
- `octobase.log` — diagnostics, not a store

Renderer `localStorage` (app view):

- `octobase.workspace.v1` — `WorkspaceData` (the whole knowledge base)
- `octobase.viewer.layout` — `ViewerLayout` (viewer pane + reader tabs)
- `octobase.library.open`, `octobase.sidebar.closed`,
  `octobase.reader.prefs` — small UI preferences

## The workspace document

Source: `src/lib/store/persistence.ts` + `src/lib/store/workspace-store.ts`.
Types in `src/lib/model/types.ts`:

```ts
interface WorkspaceData {
  version: 1;
  cards: Card[];          // note | highlight | article | image
  whiteboards: Whiteboard[];
  placements: Placement[];
  edges: Edge[];
}

// All cards share: id, kind, title, body (markdown), tags, color,
// createdAt, updatedAt, deletedAt (soft delete; null = live). Then:
interface HighlightCard { kind: "highlight"; sourceUrl; anchor: TextAnchor }
interface ArticleCard   { kind: "article"; sourceUrl; siteName?; byline? }
interface ImageCard     { kind: "image"; sourceUrl;
                          image: { file; w; h } }   // file inside userData/clips

interface Placement { id; whiteboardId; cardId; x; y; w; h; z }
interface Edge      { id; whiteboardId; fromCardId; toCardId;
                      label; directed }             // board-scoped connector
```

`TextAnchor` is the durable text-quote anchor
(`{ exact, prefix, suffix, startHint }`) — not the rangy serialization the
page highlighter uses.

Storage is pluggable through `PersistenceBackend`
(`load(): Promise<WorkspaceData | null>` / `save(data)`). Today the app uses
`LocalStoragePersistence` (key `octobase.workspace.v1`); `MemoryPersistence`
backs tests. Swapping in an Electron JSON file backend is a one-file change.

`WorkspaceStore` holds the document in memory and saves a `snapshot()`
through the backend, debounced 150 ms after every mutation. Deletes are
soft (`deletedAt`); deleting a card also drops its placements and edges.
`init()` fills `edges` for pre-edges documents, runs
`migrateHighlightBodies()` (strips the legacy quoted text from highlight
card bodies), and seeds a Welcome board on first run.

The mutation surface (see `workspace-kb.md` for reads, link graph, search):
`createNoteCard`, `addCard`, `createHighlightCard`, `upsertHighlight`,
`createArticleCard`, `createImageCard`, `updateCard`, `deleteCard`,
`restoreCard`; `createWhiteboard`, `renameWhiteboard`, `deleteWhiteboard`;
`placeCard`, `updatePlacement`, `bringToFront`, `removePlacement`,
`createNoteOnBoard`; `createEdge`, `updateEdge`, `flipEdge`, `deleteEdge`;
`embedCard`.

IDs come from `src/lib/model/ids.ts`: `<prefix>_<base36 time><base36 rand>`
(`card_…`, `wb_…`, `pl_…`, `ed_…`) — except highlight cards, which adopt the
stable id minted by the page highlighter (`hl-<epoch>-<rand>`) or the
extension (`hl_<rand><time>`), so edits round-trip by id instead of
duplicating.

## Shell layout

`src/workspace/viewer-layout.ts` persists the viewer pane and its tab strip
under `octobase.viewer.layout`:

```ts
interface ViewerLayout {
  open: boolean;        // viewer pane visible
  width: number;        // pane width in px
  sidebarOpen: boolean;
  readerTabs: string[]; // article card ids, in strip order
  activeTab: string;    // "browser" or one of readerTabs
}
```

`loadViewerLayout` runs everything through `sanitizeLayout`, which fills
defaults, drops reader tabs whose card no longer exists, and forces
`activeTab` back to the pinned browser tab when unresolvable.

## The main-process store

Source: `src/electron/highlights-store.js`, created once at boot by
`createStore(app.getPath('userData'))` in `main.js`. Record types in
`src/types/highlight.ts`:

```ts
const HIGHLIGHT_COLORS = ["yellow","green","pink","blue","purple","orange"];

interface Highlight {
  id: string;          // "hl-<epoch>-<rand>"
  text: string;        // full selected text, including grouped fragments
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  anchor: { serialized: string };  // rangy.serializeRange output
  createdAt: number;
  updatedAt: number;
}

interface Card {       // legacy whiteboard.json shape — NOT the workspace Card
  id: string;          // same as the originating Highlight.id
  text: string; sourceUrl: string; color: HighlightColor;
  tags: string[]; notes: string;
  x: number; y: number; updatedAt: number;
}
```

Store API (unchanged):

```js
createStore(dataDir) => {
  loadAllHighlights():    Promise<Highlight[]>,
  loadHighlightsForUrl(url): Promise<Highlight[]>,
  saveHighlight(h):        Promise<Highlight>,         // upsert by id
  deleteHighlight(id):     Promise<void>,
  listTags():              Promise<string[]>,          // deduped, lowercase, sorted

  loadCards():             Promise<Card[]>,
  saveCard(c):             Promise<Card>,              // upsert by id
  deleteCard(id):          Promise<void>,

  syncCardFromHighlight(h): Promise<Card | null>,      // null if no matching card
  syncHighlightFromCard(c): Promise<Highlight | null>, // null if nothing changed
}
```

Writes go through `writeJson(path, data)` which writes to a `.tmp`
sibling and renames over the target file. That keeps the on-disk JSON
either fully valid or unchanged even if the app crashes mid-write.

**What is still live:** the highlights side. The browser-pane highlighter
persists through `highlights:load` / `highlights:save` / `highlights:delete`
and `tags:list` (`preload-highlighter.js`), and `main.js` reads
`highlights.json` to enrich a drag-drop with the highlight's
color/tags/notes.

**What is legacy:** the cards side. `whiteboard.json`, the `cards:*` IPC
handlers, and both `sync*` helpers only serve the old whiteboard
(`src/app/whiteboard.tsx`). The current shell (`App.tsx` → `Workspace`)
never calls `cards:save` and does not listen to `card:updated` /
`card:deleted` — its cards live in the workspace document above.

`syncHighlightFromCard` still skips the write and returns null when
`color`, `notes`, and `tags` are byte-identical to the existing record;
the `cards:save` handler uses that signal to skip the broadcast, which is
what kept the legacy bidirectional sync from looping back on itself.

## Sync rules

The IPC/broadcast tables live in `architecture.md`; the persistence-level
rules are:

- **Page highlight → workspace card is copy-on-event, keyed by the
  highlight's stable id.** Dragging a highlight out of the browser pane
  (`highlight-dropped`) or pushing one from the Chrome extension
  (`highlight:received`) runs `store.upsertHighlight({ id, … })` in the
  renderer — re-dropping or re-editing the same id updates the existing
  card instead of duplicating it. The rangy anchor is not reusable, so the
  drop path synthesizes a `TextAnchor` from the highlight text.
- **After `highlights:save`** main broadcasts `highlight:updated` to the
  browser view and still runs `syncCardFromHighlight` → `card:updated`,
  but only the legacy whiteboard consumed that broadcast. In-page edits to
  an already-dropped highlight therefore update `highlights.json` and
  `whiteboard.json`, not the workspace card.
- **Extension reverse sync (app → page) is declared but unwired.**
  `preload.js` exposes `capture:highlight-remove` /
  `capture:highlights-request` / `capture:highlights-response`, and
  `WorkspaceProvider` answers them from `getHighlightsForUrl`, but `main.js`
  does not currently pass `onHighlightDelete` / `onListHighlights` to the
  capture server (dropped in the renderer-owned-pane refactor). See
  `capture-extension.md`.
- **Delete is one-sided everywhere.** `highlights:delete` broadcasts
  `highlight:deleted` to the browser view only; workspace `deleteCard`
  soft-deletes the card and drops its placements/edges without touching
  `highlights.json`. Clip PNGs in `userData/clips` are not garbage-collected
  when their image card is deleted — the card holds only the file reference.
- **Captures upsert by URL, clips always create.** `capture:received`
  refreshes an existing article card with the same `sourceUrl` instead of
  duplicating it; `clip:captured` creates a new image card each time.

## Tests

- `test/highlights-store.test.ts` — the JSON store against
  `mkdtempSync`-backed scratch directories: upserts, delete no-ops, tag
  dedup, and both sync helpers (substantive changes, no-op short circuits,
  missing-record returns).
- `test/workspace-store.test.ts` — seeding, placements, soft delete,
  links, search, image cards, and persistence round-trips through
  `MemoryPersistence`.
- `test/drop-highlight.test.ts`, `test/viewer-layout.test.ts`,
  `test/workspace-edges.test.ts` — the drop upsert, layout sanitizing, and
  edge lifecycle.
- `test/capture-server.test.ts` / `test/capture-integration.test.ts` — the
  extension's HTTP contract, including `/highlight` upsert-by-id.
