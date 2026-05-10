# Persistence

All persistent state lives in two JSON files inside the Electron
`userData` directory (typically
`~/Library/Application Support/octobase-react-ui/` on macOS):

- `highlights.json` — `Highlight[]`
- `whiteboard.json` — `Card[]`

Source: `src/electron/highlights-store.js`. The store is created once at
boot by `createStore(app.getPath('userData'))` in `main.js`.

## Types

Defined in `src/types/highlight.ts`:

```ts
const HIGHLIGHT_COLORS = ["yellow","green","pink","blue","purple","orange"];
type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
type HighlightId = string;  // "hl-<epoch>-<rand>"

interface RangyAnchor { serialized: string }

interface Highlight {
  id: HighlightId;
  text: string;        // full selected text, including grouped fragments
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  anchor: RangyAnchor; // rangy.serializeRange output
  createdAt: number;
  updatedAt: number;
}

interface Card {
  id: HighlightId;     // same as the originating Highlight.id
  text: string;
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  x: number;
  y: number;
  updatedAt: number;
}
```

`Card.id === Highlight.id` is what links the two records for sync.

## Store API

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

`syncHighlightFromCard` skips the write and returns null when
`color`, `notes`, and `tags` are byte-identical to the existing record;
the IPC handler uses that signal to skip the broadcast. This is what
keeps bidirectional sync from looping back on itself.

## Sync rules

Recap from `architecture.md`:

- Saves on either side push their content fields (color, tags, notes)
  to the matching record on the *other* side. Text and anchor are
  never updated from the card side — those are highlight-immutable.
- After every successful sync the matching `card:updated` or
  `highlight:updated` broadcast fires.
- Delete is one-sided. Deleting a highlight leaves the card; deleting a
  card leaves the highlight. The card-side and highlight-side `Undo`
  toasts each re-save the original record via the same path that
  created it — including a fresh `updatedAt` — so the corresponding
  cross-side broadcast still fires after Undo.

## Tests

`test/highlights-store.test.ts` exercises the store against
`mkdtempSync`-backed scratch directories. The suite covers upserts,
delete no-ops, tag dedup, and both sync helpers (substantive changes,
no-op short circuits, missing-record returns).
