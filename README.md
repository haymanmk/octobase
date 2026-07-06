# Octobase

A note-taking app built for your brain.

Octobase is an Electron app that pairs a card-based whiteboard workspace with
a built-in article browser. Read any web page in the right pane, highlight it
in place, and drag highlights onto whiteboards as cards — then link, tag, and
search them as a knowledge base. A companion Chrome extension (MV3) captures
articles from your regular browser into the same store.

## Quick start

```sh
npm install
npm run dev        # build everything, then launch Electron
```

Other useful scripts:

```sh
npm run build             # type-check + bundle app and highlighter into dist/
npm run build:extension   # bundle the Chrome capture extension into dist-extension/
npm test                  # node --test test/**/*.test.ts
npm run lint              # eslint
```

There is no watch mode for the Electron app — re-run `npm run dev` after
changes. `npm run vite-dev` serves the React tree in a plain browser for
quick UI iteration (Electron IPC bridges won't be available there).

## Documentation

Architecture and subsystem docs live in [`docs/`](docs/README.md) — start
with [`docs/architecture.md`](docs/architecture.md) for the process model,
and [`docs/build.md`](docs/build.md) for the build chain.
