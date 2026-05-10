# Agent guide — octobase

A note-taking desktop app where the user reads articles in a built-in browser
(right pane), highlights interesting text, and drops those highlights as cards
onto a whiteboard (left pane).

Electron app, multi-WebContentsView layout, with two distinct front-end stacks
sharing a single main process and a single JSON-backed store.

## Repo at a glance

```
src/
  electron/             Main process + preload scripts + JSON store
    main.js               Window/view layout, IPC handlers
    highlights-store.js   highlights.json and whiteboard.json (userData)
    preload.js            Whiteboard renderer API
    preload-highlighter.js Right-view (article browser) renderer API
    preload-overlay.js    Drag overlay renderer API
    browser-preload.js    Injects highlighter IIFE into the article page
  components/
    highlighter/        Lit web components, bundled as a single IIFE
                        and injected into whatever page the right view loads.
                        Six color appliers, persistence, edit panel, undo toast.
    overlay-canva/      Lit components for the drag-text proxy overlay.
    ... other React/MUI UI components (whiteboard layout, sidebar, etc.)
  app/                  React Router routes / layouts
    whiteboard.tsx        Whiteboard pane (MUI cards rendered from store)
  types/
    highlight.ts          Shared Highlight/Card types + HIGHLIGHT_COLORS
    rangy.d.ts            Module augmentation for Rangy globals
test/                   node:test --test files (run via `npm test`)
docs/                   Architecture + per-subsystem docs (start here)
docs/superpowers/       Specs and implementation plans (historical)
vite.config.ts          Main React app bundler
vite.highlighter.config.ts  Bundles the highlighter as an injectable IIFE
```

## Commands

```bash
npm run dev          # Builds everything, then launches Electron.
npm run build        # tsc + main vite build + highlighter IIFE build.
npm test             # node:test on test/**/*.test.ts.
npm run lint         # eslint.
```

There is no hot reload for Electron — `npm run dev` rebuilds from scratch.
For UI-only iteration on the React side: `npm run vite-dev` or
`npm run dev-react`.

## Where to read more

- `docs/architecture.md` — multi-process / multi-view layout and IPC matrix
- `docs/electron-main.md` — main process responsibilities, view bounds, drag flow
- `docs/highlighter.md` — the right-view bundle (Lit + Rangy + shadow DOM)
- `docs/whiteboard.md` — left-view React/MUI cards
- `docs/persistence.md` — JSON store, sync rules, broadcast channels
- `docs/build.md` — the dual-bundle build chain and a known Vite gotcha

## Conventions and gotchas

1. **Two bundlers in one repo.** The whiteboard renderer is built with the
   default `vite.config.ts`. The highlighter widget is built separately as an
   IIFE via `vite.highlighter.config.ts` so it can be injected via
   `executeJavaScript` into the right pane's loaded page. The two bundles do
   not share runtime; they communicate only through main-process IPC.

2. **Standard-decorator quirk.** `tsconfig.app.json` sets
   `experimentalDecorators: false`. Lit fields decorated with `@property` or
   `@state` therefore need the `accessor` keyword. Inside the highlighter
   bundle's *entry file* (`src/components/highlighter/highlighter.ts`),
   Vite library mode parses through Rollup's acorn before esbuild gets to
   transform — acorn does not understand `accessor`. The entry file therefore
   uses plain class fields plus manual `requestUpdate()`, while imported
   component files (`edit-form.ts`, `tag-input.ts`, `undo-toast.ts`) use the
   `accessor` keyword normally. `vite.highlighter.config.ts` declares an
   explicit `esbuild` block so this transform chain actually runs.

3. **Highlight ↔ card sync.** Saves on either side push content fields
   (color, tags, notes) to the matching record on the other side via
   `syncCardFromHighlight` / `syncHighlightFromCard`, then broadcast
   `card:updated` / `highlight:updated`. The originating view ignores or
   no-ops on its own echo because the broadcast is byte-identical to what
   it just sent.

4. **Drag flow uses a separate WebContentsView as an overlay.** During a
   drag, main attaches `overlayView` over the parent window with a near-
   transparent background to capture the cursor. Releasing the mouse fires
   `highlight-dropped` from the overlay; main decides if the drop lands on
   the whiteboard and persists a `Card`. See `docs/electron-main.md` for
   the full state machine.

5. **Rangy plugins initialize lazily.** `rangy.createClassApplier` and
   `rangy.serializeRange` are not available until rangy's auto-init runs
   on `DOMContentLoaded`. The highlighter bundle's module init creates the
   per-color appliers immediately, so the bundle must be loaded *after*
   DOM is parsed — which is why `main.js` injects it from
   `did-finish-load` and `reapplyOnLoad` waits for `window.load` + 500 ms.

6. **No emoji-laden commits.** Match the existing commit style:
   `<type>(<scope>): <subject>` with a body explaining the why. See
   `git log --oneline` for examples.
