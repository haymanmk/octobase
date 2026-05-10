# Build chain

Two separate Vite builds run end-to-end on every `npm run build`:

1. **Main app bundle** — `vite.config.ts`. Bundles the React Router app
   under `src/app/` plus the rest of the React/MUI tree under
   `src/components/`. Output is `dist/index.html` and a `dist/assets/` set
   that Electron loads into `leftView`. Two extra HTML entries
   (`searchbar.html`, `overlay-canva.html`) are emitted for the search
   bar and drag-overlay views.

2. **Highlighter IIFE bundle** — `vite.highlighter.config.ts`. Bundles
   only `src/components/highlighter/highlighter.ts` (and what it imports)
   into a single self-executing script at
   `dist/highlighter/highlighter.iife.js`. The main process reads that
   file at startup and injects it into the right-view page via
   `executeJavaScript` on every `did-finish-load`.

`npm run build` chains them: `tsc -b && vite build && npm run build:highlighter`.

## Why two bundles

The highlighter widget runs *inside* whatever third-party page the user
is reading. It cannot share the React app's module graph because:

- The third-party page does not load our React bundle. The IIFE must
  bring everything it needs (Lit, Rangy, the per-color CSS) in a single
  script that runs from a fresh global.
- The widget must coexist with arbitrary host page CSS. Lit + shadow DOM
  is the cleanest tool for that; the React bundle uses MUI emotion-in-JS
  which has no such isolation story.
- The injected payload must be small. Bundling separately lets us
  tree-shake to roughly 120 KB (gzip ~ 39 KB).

## Vite library mode quirk

`vite.highlighter.config.ts` uses Vite's library mode (`build.lib`).
That mode runs each entry-graph module through esbuild for transforms,
then concatenates with Rollup. But it has a subtle ordering bug: Rollup
parses the *entry* module before Vite's esbuild transform layer has run
on it. Rollup's parser is acorn, which does not understand the
standard-decorator `accessor` keyword.

Symptom: any `@property` or `@state` decorated `accessor` field in the
entry file (`highlighter.ts`) fails the build with a parser error
pointing at `accessor`. Imported files (`edit-form.ts`, `tag-input.ts`,
`undo-toast.ts`) are fine because they go through esbuild first.

The config works around this in two ways:

1. An explicit `esbuild` block declares
   `{ target: 'es2022', include: /\.(m?[jt]s|[jt]sx)$/ }` so Vite forces
   esbuild over the entry file too.
2. The entry file still uses plain class fields and manual
   `requestUpdate()` calls in its `<highlighter-widget>` class as a
   belt-and-braces guard. Imported component classes use the
   decorated-`accessor` pattern Lit recommends.

If you upgrade Vite or Rollup and want to clean this up, verify that the
entry-file `accessor` form survives a clean build before deleting the
workaround.

## Tooling

- `tsconfig.app.json` — the React app and renderer-facing modules.
  `experimentalDecorators: false` (standard decorators).
- `tsconfig.node.json` — Vite config files, node:test, anything that
  runs in Node directly.
- `eslint.config.js` — flat config.
- `node --test test/**/*.test.ts` — the test runner. Tests are plain
  TypeScript executed by node's loader. Run via `npm test`.

## Where things end up

```
dist/
  index.html                                    Whiteboard entry
  src/components/searchbar/searchbar.html       Search bar entry
  src/components/overlay-canva/overlay-canva.html  Drag overlay entry
  assets/<hashed>.{css,js}                      React app chunks
  highlighter/highlighter.iife.js               Right-view injected bundle
```

Electron's `main.js` loads these by relative path; nothing else outside
`dist/` is referenced at runtime.
