# octobase — Knowledge-Base Core (Phase 1 + Phase 2) Design

Date: 2026-06-22
Status: Approved (roadmap + full rich markdown editor confirmed by user)

## Goal

Turn octobase from a "highlight-in-built-in-browser → cards on one whiteboard"
app into a local-first **Heptabase alternative**: a knowledge base of cards
(notes, highlights, captured articles) arranged on multiple whiteboards, linked
together, tagged, and searchable — with a web-capture pipeline (Chrome
extension) layered on later.

## Roadmap (decomposition)

| Phase | Name | Status |
|---|---|---|
| 1 | Foundation: unified data model + durable text anchoring + persistence layer | **this build** |
| 2 | Knowledge-base core (Heptabase parity): markdown note-cards, multiple whiteboards, card links + backlinks, card library/inbox, tags, search | **this build** |
| 3 | Article reader + capture rendering (in-app reader, locate source, highlight overlay) | spec/stub only |
| 4 | Chrome extension (highlight any site + capture article → localhost server) | spec/stub only |
| 5 | Sync layer (cloud, on top of local-first model) | future |

User decisions: build all phases eventually; **localhost server** transport for
the extension; **local-first with future sync**; **full rich markdown editor**.

## Phase 1 — Foundation

### Unified data model (`src/lib/model`)

A single `Card` discriminated by `kind`:

- `note` — rich markdown content authored in-app.
- `highlight` — captured text selection with a source URL + text anchor.
- `article` — a captured full article (markdown body + metadata + anchor base).

```ts
type CardKind = 'note' | 'highlight' | 'article';

interface BaseCard {
  id: string;
  kind: CardKind;
  title: string;
  body: string;            // markdown
  tags: string[];
  color: HighlightColor;   // reuses existing 6-color palette
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null; // soft-delete for sync-friendliness
}

interface NoteCard extends BaseCard { kind: 'note'; }
interface HighlightCard extends BaseCard {
  kind: 'highlight';
  sourceUrl: string;
  anchor: TextAnchor;      // durable anchoring (P1)
}
interface ArticleCard extends BaseCard {
  kind: 'article';
  sourceUrl: string;
  siteName?: string;
  byline?: string;
}
```

Whiteboards and placements are separate from cards (a card can sit on many
boards, or none — "inbox"):

```ts
interface Whiteboard { id; name; createdAt; updatedAt; deletedAt; }
interface Placement { id; whiteboardId; cardId; x; y; w; h; z; }
interface Link { id; fromCardId; toCardId; createdAt; } // derived from [[wikilinks]]
```

Sync-ready: stable string IDs, monotonically-increasing `updatedAt`, soft
delete via `deletedAt`. No server now; the shape supports last-write-wins later.

### Durable text anchoring (`src/lib/anchor`)

A `TextAnchor` that re-locates a highlight even after page DOM changes, reused
by the in-app highlighter AND the future extension. W3C-style text-quote +
text-position hybrid:

```ts
interface TextAnchor {
  exact: string;            // the highlighted text
  prefix: string;           // up to 32 chars before
  suffix: string;           // up to 32 chars after
  startHint: number;        // char offset hint into the plain text
}
```

- `describeAnchor(root, range) -> TextAnchor` — build from a DOM selection.
- `locateAnchor(text, anchor) -> {start,end} | null` — find in plain text using
  exact+prefix/suffix, falling back to fuzzy/position search.

Pure functions over strings/DOM, unit-tested with `node:test`.

### Persistence (`src/lib/store`)

`PersistenceBackend` interface (async) with a `LocalStoragePersistence`
implementation now; an Electron/JSON backend and a sync backend slot in later.
A `WorkspaceStore` sits on top providing CRUD, an in-memory **backlink index**
(from `[[wikilinks]]`), and a **search index** (title/body/tags). React access
via `WorkspaceProvider` + `useWorkspace()` hook with subscription-based updates.

## Phase 2 — Knowledge-base core (UI)

App shell (replaces the index route's single whiteboard):

- **Left sidebar**: whiteboard list (create/rename/delete), Library (all cards /
  inbox of unplaced cards), Tags browser, search trigger.
- **Center**: the active whiteboard canvas — pan, draggable + resizable cards,
  double-click empty space to create a note, drop from library to place.
- **Right inspector** (toggle): backlinks + outgoing links + metadata for the
  selected card.
- **Command palette / search** (Cmd/Ctrl-K): full-text search → jump to card.

Cards:

- **Note card**: markdown preview (react-markdown + GFM); double-click / Enter to
  open the **full rich markdown editor** (TipTap + tiptap-markdown, storing
  markdown). Toolbar: headings, bold/italic/strike/code, lists, task list,
  quote, code block, link, `[[card]]` link insert.
- **Highlight / article cards**: rendered with existing palette styling; show
  source host; "open original" affordance (wired in P3).
- `[[Card Title]]` wikilinks resolve to cards; clicking navigates; unresolved
  links offer "create card". Backlinks derived and shown in inspector.

Reuses: `HIGHLIGHT_COLORS`/`PALETTE`, card visual language from the current
whiteboard, MUI + theme.

## Verification

- `node:test` unit tests for anchoring + store/backlink/search indices.
- Browser verification via `npm run vite-dev` + Chrome DevTools MCP:
  create whiteboards, create/edit note cards with rich markdown, link cards,
  see backlinks, tag + filter, search-jump. Screenshot the result.
- `npm run lint`, `tsc`, `npm run build` clean.

## Non-goals (this build)

Electron wiring of the new model (kept working in browser; Electron path
unchanged), the extension, the article reader, cloud sync. Those are P3–P5.
