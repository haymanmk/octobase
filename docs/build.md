# Build chain

`npm run build` runs four steps end-to-end:

```
tsc -b && tsc -p src/extension/tsconfig.json && vite build && npm run build:highlighter
```

1. **Type-check** — `tsc -b` checks the two project references in
   `tsconfig.json` (`tsconfig.app.json` for `src/`, `tsconfig.node.json`
   for `vite.config.ts`), then `tsc -p src/extension/tsconfig.json`
   checks the browser extension (which the app tsconfig excludes). All
   three are `noEmit`; no JS comes out of this step.

2. **Main app bundle** — `vite build` with `vite.config.ts`. Two HTML
   entries: `index.html` (loads `src/App.tsx`, which mounts the
   `Workspace` React tree directly — no router in the built app) and
   `src/components/overlay-canva/overlay-canva.html` (the drag-overlay
   view). Output is `dist/index.html`,
   `dist/src/components/overlay-canva/overlay-canva.html`, and hashed
   chunks in `dist/assets/`. Electron's `main.js` loads both entries by
   relative path (`loadFile`).

3. **Highlighter IIFE bundle** — `npm run build:highlighter` runs Vite
   with `vite.highlighter.config.ts`. It bundles only
   `src/components/highlighter/highlighter.ts` (and what it imports)
   into a single self-executing script at
   `dist/highlighter/highlighter.iife.js`. The main process reads that
   file at startup and injects it into the browser-view page via
   `executeJavaScript` on every `did-finish-load`. The config `define`s
   `process.env.NODE_ENV` / `process.env` as constants so the bundle
   doesn't drag in a `process` polyfill.

Separately, **`npm run build:extension`** bundles the MV3 capture
extension (`src/extension/`) into `dist-extension/` via
`scripts/build-extension.mjs`. This is esbuild, not Vite: `content.ts`,
`popup.ts`, and `background.ts` are each bundled as IIFE (target
`chrome114`), and `manifest.json` + `popup.html` are copied alongside.
Load `dist-extension/` unpacked at `chrome://extensions`. Note the
extension is *type-checked* by `npm run build` but only *bundled* by
`npm run build:extension` — esbuild does no type-checking of its own.
The extension shares `src/lib/` (anchor + extractor) with the app.

## Dev scripts

- `npm run dev` — full `npm run build`, then launches Electron. There is
  no watch mode for the Electron app; rebuild to see changes.
- `npm run vite-dev` — plain Vite dev server for the React tree in a
  browser (no Electron IPC, so anything touching `window.*Api` bridges
  won't work).
- `npm run dev-react` — `react-router dev`. Legacy browser-only path
  using `react-router.config.ts` (`appDirectory: "src"`, `ssr: false`)
  and the `src/root.tsx` / `src/routes.ts` files; the built app does not
  go through React Router.
- `npm run preview` — `vite preview` over the built `dist/`.

## Why two Vite bundles

The highlighter widget runs *inside* whatever third-party page the user
is reading. It cannot share the React app's module graph because:

- The third-party page does not load our React bundle. The IIFE must
  bring everything it needs (Lit, Rangy, the per-color CSS) in a single
  script that runs from a fresh global.
- The widget must coexist with arbitrary host page CSS. Lit + shadow DOM
  is the cleanest tool for that; the React bundle uses MUI emotion-in-JS
  which has no such isolation story.
- The injected payload must be small. Bundling separately keeps it
  around 120 KB (gzip ~ 39 KB).

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
`undo-toast.ts`, etc.) are fine because they go through esbuild first.

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
  `experimentalDecorators: false` (standard decorators). Includes `src/`,
  excludes `src/extension/`. Declares the `@/*`, `@components/*`, etc.
  path aliases (resolved at bundle time by `vite-tsconfig-paths`).
- `tsconfig.node.json` — Node-side config files (currently just
  `vite.config.ts`).
- `src/extension/tsconfig.json` — extends `tsconfig.app.json`, adds the
  `chrome` types for the MV3 extension.
- `eslint.config.js` — flat config. Run via `npm run lint`.
- `node --test test/**/*.test.ts` — the test runner. Tests are plain
  TypeScript executed by node's loader (DOM-dependent tests use
  linkedom). Run via `npm test`.

## Where things end up

```
dist/
  index.html                                    Workspace entry
  src/components/overlay-canva/overlay-canva.html  Drag overlay entry
  assets/<hashed>.{css,js}                      React app chunks
  highlighter/highlighter.iife.js               Injected browser-view bundle

dist-extension/                                 (from npm run build:extension)
  manifest.json  popup.html
  content.js  popup.js  background.js
```

Electron's `main.js` loads the `dist/` files by relative path; nothing
else outside `dist/` is referenced at app runtime. `dist-extension/` is
only ever loaded by Chrome.
