# Octobase docs

These docs describe the runtime architecture and each of the pillars the app
is built on. Skim `architecture.md` first; the rest can be read in any order.

| File | Topic |
|---|---|
| [`architecture.md`](architecture.md) | Process model, the four WebContentsViews, IPC channel matrix |
| [`electron-main.md`](electron-main.md) | Main process responsibilities, view bounds, drag flow |
| [`highlighter.md`](highlighter.md) | Right-view bundle: Lit components, Rangy, the widget state machine |
| [`whiteboard.md`](whiteboard.md) | Left-view React/MUI whiteboard |
| [`persistence.md`](persistence.md) | JSON store, sync rules, broadcast channels |
| [`build.md`](build.md) | Dual-bundle build chain and Vite gotchas |

The `superpowers/` subdirectory holds historical specs and implementation
plans from the highlighter widget redesign. They are still useful when
considering changes near the highlighter, the JSON store, or the
highlight ↔ card sync rules.
