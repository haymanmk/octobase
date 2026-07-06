# Workspace / knowledge-base core

The knowledge base added in 2026-06 (specs:
`docs/superpowers/specs/2026-06-22-kb-core-design.md`). This is the Heptabase-
style core: multiple whiteboards of cards (notes / highlights / articles),
linked, tagged, and searchable.

## Layout

```
src/lib/                         framework-free foundation (Phase 1)
  model/types.ts                 Card (note|highlight|article), Whiteboard,
                                 Placement, Link, WorkspaceData
  model/ids.ts                   prefixed unique IDs
  model/wikilinks.ts             [[Title]] / [[Title|alias]] parser
  anchor/text-anchor.ts          durable text-quote+position anchoring
                                 (describeAnchor / locateAnchor / DOM Range)
  store/persistence.ts           PersistenceBackend (localStorage + memory)
  store/workspace-store.ts       WorkspaceStore: CRUD, inbox, link graph, search

src/workspace/                   React UI (Phase 2)
  store-context.ts               StoreContext + useWorkspace/useWorkspaceStore
  WorkspaceProvider.tsx          creates + inits the store
  Workspace.tsx                  shell: topbar, context menu, toast, modal orchestration
  Sidebar.tsx                    whiteboards, inbox, tags, search trigger
  Canvas.tsx / CanvasCard.tsx    pan/zoom dot-grid canvas + draggable/resizable cards
  CardEditor.tsx                 TipTap rich markdown editor (stores markdown)
  MarkdownView.tsx               react-markdown + GFM + [[wikilink]] rendering
  Inspector.tsx                  backlinks / outgoing / unresolved / metadata
  CommandPalette.tsx             ⌘K search
  workspace.css                  editorial-library design system
```

## Key facts

- **Storage is pluggable.** `WorkspaceStore` talks to a `PersistenceBackend`.
  Today that is `LocalStoragePersistence` (key `octobase.workspace.v1`), so the
  whole app runs and is verifiable in a plain browser via `npm run vite-dev`.
  An Electron JSON backend and a sync backend slot in without UI changes.
- **React reactivity** uses a monotonic `version` counter via
  `useSyncExternalStore` — components call store methods directly and re-render
  on `version` change. Do not put `store.getVersion()` inside a dep array
  expression (lint); hoist it to a `const version = store.getVersion()` first.
- **Wikilinks** are markdown text `[[Title]]`. `MarkdownView` rewrites them to a
  `wikilink:` URL scheme then renders custom spans; `urlTransform` whitelists
  the scheme. `CardEditor` un-escapes the brackets tiptap-markdown adds on
  serialization (`unescapeWikilinks`) so links survive a round-trip.
- **Markdown round-trip**: cards store markdown. TipTap loads it via
  tiptap-markdown and serializes back with `editor.storage.markdown.getMarkdown()`.
- **The link graph is derived**, not stored — `getBacklinks` / `getOutgoingLinks`
  scan card bodies by normalized title. Fine at local scale.

## Relationship to the older subsystems

`src/App.tsx` now renders `Workspace` (previously `electron-layout` →
`Whiteboard`). The legacy `src/app/whiteboard.tsx` and the Electron
highlight→card drop flow (`highlights-store.js`, `whiteboard.json`) still exist
but are **not wired into the new Workspace yet** — that reunification is Phase 3
(see `docs/superpowers/specs/2026-06-22-capture-and-reader-design.md`). Until
then, highlights dropped from the in-app browser persist to `whiteboard.json`
but do not appear on the new canvas.
