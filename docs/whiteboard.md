# Whiteboard

The left-pane whiteboard is the React side of the app. Source:
`src/app/whiteboard.tsx`. UI is MUI (Material UI) on top of React Router.

## Mount path

Electron's `leftView` loads `dist/index.html`. React Router resolves the
root route to `app/whiteboard.tsx`. The whiteboard component fills the
view with `position: relative; overflow: hidden` and renders each card
absolutely positioned at its `(x, y)`.

## Card data flow

```
Cards on disk (whiteboard.json)
        |
        | cards:load on mount
        v
useState<Card[]>  <----  card:updated broadcast (append or replace)
        |        <----  card:deleted broadcast (filter out)
        |
        +---- drag move -> cards:save (debounced via React state)
        +---- menu Delete -> cards:delete + pendingDelete state -> Snackbar
        +---- menu Edit notes -> cards:save (notes only)
```

The whiteboard subscribes to `onCardUpdated` and `onCardDeleted` once on
mount. Each broadcast updates local state by id; new ids are appended.
Saves trigger the broadcast that the same component then receives back,
but the resulting state replace is a no-op because the payload is
byte-identical to what was just sent.

## CardView

`CardView` (one per card) renders a `Paper` styled with the highlight's
fill colour and a matching underline border. Children:

- `text` — `Typography` with `WebkitLineClamp: 4`.
- `tags` — chips, hidden when empty.
- `notes` — clickable; collapsed to a single line with ellipsis by
  default, click toggles to a scrollable expanded view.
- hostname chip — pulled from `card.sourceUrl`.

The card also carries:

- A hover-revealed `card-menu-btn` (three dots) in the top-right that
  toggles a small menu with `Edit notes` and `Delete` entries.
- Inline editing for notes: clicking `Edit notes` replaces the
  `Typography` with an autofocused multiline `TextField`. Blur or
  Cmd/Ctrl+Enter commits via `cards:save`; Escape cancels and restores
  the prior text.
- Delete: removes the card locally, stashes the record in
  `pendingDelete`, and surfaces a bottom-centre `Snackbar` with Undo for
  5 seconds. Clicking Undo re-saves the original record (with a fresh
  `updatedAt`); the resulting `card:updated` broadcast re-adds it to
  state.

## Pointer events on cards

Cards are draggable by their `Paper` via `setPointerCapture`. The notes
area and the menu button both call `e.stopPropagation()` on
`onPointerDown` so clicking them does not start a card drag. The menu
popup is rendered inside the Paper; the Paper does *not* set
`overflow: hidden` because the menu can otherwise be clipped on short
cards. Children that need clipping (`Typography` text clamp, collapsed
notes) declare their own overflow rules.
