# Highlighter widget

The viewer pane's pinned live-browser tab is a native `WebContentsView`
that loads arbitrary web pages (the renderer owns the pane layout and
streams the slot rectangle to main over `pane:set-bounds` — see
`architecture.md`). Octobase injects its own UI on top of those pages
without changing their markup. That UI is the **highlighter widget**: a
Lit-based set of web components, bundled as a single IIFE, and injected
via `executeJavaScript` on every page load.

Source: `src/components/highlighter/`. Bundle: `dist/highlighter/highlighter.iife.js`
(produced by `vite.highlighter.config.ts` — see `build.md`).

## Module layout

```
src/components/highlighter/
  highlighter.ts     Entry. Bootstraps everything; defines the widget custom element.
  toolbar-ui.ts      Shared pill + popover CSS for widget / extension / reader.
  colors.ts          PALETTE, classNameFor, paletteCss.
  widget-styles.ts   injectGlobalStyles — appends paletteCss to document.head.
  highlight-id.ts    Helpers for stamping fragments with shared id + text.
  edit-form.ts       <octo-edit-form>: color row + tags + notes + delete.
  tag-input.ts       <octo-tag-input>: chip editor with autocomplete.
  undo-toast.ts      <octo-undo-toast>: dark toast with Undo action.
```

## Bootstrap

`main.js` reads the bundle from disk once at window creation and runs
`executeJavaScript(bundleSource)` on the browser view's every
`did-finish-load`, so the widget re-mounts on each navigation. The IIFE
then:

1. Defines `<octobase-widget-root>`, the host custom element, and appends
   one instance to `document.body`. The widget itself lives inside that
   host's shadow DOM so its styles do not leak into the page.
2. Defines `<highlighter-widget>` and appends one instance to the shadow
   root.
3. Calls `injectGlobalStyles()` — this writes `paletteCss()` to a single
   `<style id="octobase-highlighter-styles">` in `document.head` so the
   six `.octo-hl-*` classes are visible to the host page (Rangy's class
   appliers wrap text directly in the page DOM, outside shadow DOM, so the
   styles must live in the host document).
4. Wires document-level `mouseup`, `mousedown`, `keydown` listeners.
5. Schedules `reapplyOnLoad` to fire on `window.load + 500 ms` (or
   immediately + 500 ms if the document is already `complete`) so any
   persisted highlights for the current URL are restored.

## Per-color class appliers

`HIGHLIGHT_COLORS` (yellow / green / pink / blue / purple / orange) lives
in `src/types/highlight.ts`. For each, `makeApplier(color)` creates a
`rangy.createClassApplier(classNameFor(color), { onElementCreate })` where
the `onElementCreate` callback attaches the fragment behaviour (drag,
hover-menu).

The class name format is `octo-hl-<color>`. The CSS rule is a
single linear-gradient stripe centred vertically:

```css
.octo-hl-yellow {
  background-image: linear-gradient(transparent 25%, #fff3b0 25%, #fff3b0 75%, transparent 75%);
  padding: 0;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.octo-hl-yellow:hover { filter: brightness(0.97); }
```

`box-decoration-break: clone` is what lets a highlight that wraps onto
multiple visual lines paint its background on every line. `padding: 0`
keeps partial-word selections flush against adjacent characters so the
highlight does not visually split a word.

## Shared toolbar UI

The selection pill and the edit popover look identical across three
surfaces on purpose. `toolbar-ui.ts` is the single source of truth for
that look:

- `pillCss()` — `.octo-pill` / `.octo-swatch` / `.octo-divider` /
  `.octo-add-note`: the white creation pill with 22 px (`SWATCH_SIZE`)
  fill swatches.
- `popoverCss()` — the `.octo-pop*` edit popover: color row, note input,
  Delete / primary buttons.
- `ensureToolbarStyles(root)` — idempotently installs both into a
  `Document` head or a `ShadowRoot`.

| Surface | How it consumes the module |
|---|---|
| `<highlighter-widget>` (this bundle) | `unsafeCSS(pillCss())` in its static styles |
| Chrome extension content script (`src/extension/content.ts`) | `ensureToolbarStyles(shadow)` into each toolbar / popover host's shadow root |
| In-app reader (`src/workspace/reader/Reader.tsx`) | `ensureToolbarStyles()` into the app document |

Positioning (`fixed` / `left` / `top` / `z-index`) stays with each caller;
the module covers look and feel only. One nuance: the Lit
`<octo-edit-form>` keeps its own component styles — the `.octo-pop*`
classes serve the extension's and the reader's popovers, which are plain
DOM rather than Lit.

## Widget state machine

`<highlighter-widget>` has two modes:

- `pill` — the compact creation pill that appears below the user's text
  selection. Six color swatches and a `+ note` chip.
- `expanded` — `<octo-edit-form>` rendered in the same position, with the
  chosen color ringed and the tags / notes inputs visible.

Transitions:

- `show()` after a non-empty selection (driven by `handleTextSelection` on
  document `mouseup` / `mousedown`) shows the widget in `pill` mode.
- Clicking a swatch calls `applyHighlightFromSelection(color)` which
  serializes the range, applies the Rangy class applier, stamps each
  produced fragment with a shared id + the full selected text, and saves a
  `Highlight` record. The widget then enters `expanded` mode with that
  record loaded.
- Clicking `+ note` before a color is chosen pulses the swatches.
- Clicking outside the host element, or pressing Escape, calls
  `reset()` + `hide()`.

`handleTextSelection` ignores the `expanded` branch: once the user has
committed to a highlight, document selection no longer drives widget
visibility — otherwise the post-click `removeAllRanges()` would immediately
hide the form.

## Edit panel (existing highlights)

A separate flow handles editing an *existing* highlight:

1. `attachFragmentBehavior` adds `mouseenter` / `mouseleave` listeners to
   every produced fragment. Enter → `showMenuButton(fragment)`. Leave →
   `scheduleMenuButtonHide(250 ms)`.
2. `showMenuButton` repositions a single reusable `<button class="octo-hl-menubtn">`
   anchored to the fragment's top-right.
3. Clicking the button runs `openEditPanel(highlightId, rect)`. The panel
   is an `<octo-edit-form>` created via `document.createElement`,
   populated from the persisted record + the current tag suggestion list,
   and positioned absolutely next to the menu button.
4. Edits flow through dedicated handlers per event (`color-changed`,
   `tags-changed`, `notes-changed`). Each handler updates the local
   in-panel state and re-saves through `highlights:save`. A snapshot is
   taken before any `await` so an outside-click closing the panel mid-save
   does not throw on a nulled state object.
5. Delete unwraps every fragment back into its parent text node, calls
   `highlights:delete`, and posts an `<octo-undo-toast>` for 5 s. Clicking
   Undo deserializes the saved range, re-applies the same color applier,
   re-stamps fragments with the original id + text, and re-saves the
   record.

## Grouped fragments

A single selection that crosses inline element boundaries produces
multiple Rangy spans — for example `<span>Read </span><strong><span>the</span></strong><span> docs</span>`.
All of those spans share:

- `data-octobase-highlight-id` — the highlight's unique id
- `data-octobase-highlight-text` — the full selected text, *not* the
  per-fragment textContent

`stampHighlightGroup(fragments, text, generateId)` writes both attributes
on every fragment in one selection.
`getHighlightDragPayload(el)` reads them so dragging any fragment carries
the entire selection's text into the dropped card.

## Hold-to-drag

Mousedown on a highlight fragment starts a 250 ms hold timer. If the
pointer stays within 5 px, the timer fires and sends `drag-drop-text-selection`
with the grouped payload. If it moves further, the hold is cancelled and
the user can text-select normally. See `electron-main.md` for the rest of
the drag flow.

## Persistence and reapply

The browser view persists highlights via `highlights:save` and re-applies
them on every page load:

```ts
async function reapplyOnLoad() {
  const records = await electronAPI.loadHighlights(window.location.href);
  for (const r of records) {
    const range = rangy.deserializeRange(r.anchor.serialized, document.body);
    // apply per-color class applier, stamp fragments with persisted id + text
  }
}
```

Anchors are produced by `rangy.serializeRange(range, true, document.body)`
at save time and resolved with `rangy.deserializeRange` at load time.
Rangy's plugins (`rangy-classapplier`, `rangy-highlighter`,
`rangy-serializer`) auto-initialize on `DOMContentLoaded`; the reapply
runs on `window.load + 500 ms` so script-driven content has had a chance
to render before we resolve node-index offsets.

## Listening for sync broadcasts

The browser view subscribes to `highlight:updated` so card-side edits that
propagate back through `syncHighlightFromCard` reflect in the page DOM. If
the broadcast color differs from the current class on each fragment, the
class is swapped without re-creating the range, and the fragment's
`data-octobase-highlight-text` is refreshed from the broadcast record.
