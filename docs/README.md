# Octobase docs

These docs describe the runtime architecture and each of the pillars the app
is built on. Skim `architecture.md` first; the rest can be read in any order.

| File | Topic |
|---|---|
| [`architecture.md`](architecture.md) | Process model, the WebContentsView layout, IPC channel matrix |
| [`electron-main.md`](electron-main.md) | Main process responsibilities, view bounds, drag flow |
| [`highlighter.md`](highlighter.md) | Injected browser-view bundle: Lit components, Rangy, the widget state machine |
| [`whiteboard.md`](whiteboard.md) | Workspace canvas: pan/zoom gestures, card editing/resize, mind-map edges, `![[embed]]` nesting |
| [`workspace-kb.md`](workspace-kb.md) | Knowledge-base core: `src/lib` model/store, multi-whiteboard cards, links, tags, search |
| [`capture-extension.md`](capture-extension.md) | In-app article reader, shared Readability/Turndown extractor, MV3 capture extension |
| [`persistence.md`](persistence.md) | Renderer workspace store (localStorage) + main-process JSON files, schemas, sync rules |
| [`build.md`](build.md) | Build chain: type-check, app + highlighter Vite bundles, extension bundle, Vite gotchas |

The `superpowers/` subdirectory holds historical specs and implementation
plans (highlighter widget redesign, the 2026-06 knowledge-base core, and the
capture/reader work). They are still useful when considering changes near the
highlighter, the JSON store, or the highlight ↔ card sync rules.
