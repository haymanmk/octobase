# Highlighter Widget Redesign

## Context

The right pane is a browser where users read articles and create highlights via the in-page widget defined in `src/components/highlighter/highlighter.ts`. Today the widget supports a single yellow background fill applied through one Rangy class applier; there are no colors, tags, notes, persistence, or post-creation editing. Each highlight exists only in the page DOM and is lost on reload.

This change makes the widget a richer reading tool: six pastel colors (each rendered as fill + matching underline), free-text tags with autocomplete, free-form notes, edit-after-create via a hover-revealed `⋯` button, and delete with undo. Highlights persist in an app-managed JSON file and survive reload. Whiteboard cards stay synchronized with their originating highlights through bidirectional broadcast on save.

The grouped-highlight contract from `2026-05-05-grouped-highlight-drag-design.md` continues to hold: one logical highlight may be rendered as multiple Rangy DOM fragments that share `data-octobase-highlight-id` and `data-octobase-highlight-text`.

## Goals

- Six pastel highlight colors, each rendered as a layered fill + matching underline.
- Multiple free-text tags per highlight with autocomplete from the user's prior tags.
- Free-form notes per highlight, plain text.
- Add tags/notes both at creation time and on existing highlights.
- Delete a highlight with undo (no confirmation dialog).
- Highlights survive app reload; persisted state lives in an app-managed JSON file.
- Bidirectional sync between a highlight and its dragged whiteboard card; last-write-wins.

## Non-Goals

- Card-side editing on the whiteboard (cards remain read-only this round; only position is mutable).
- Hover tooltips that surface tags inline next to highlights.
- Confirmation dialog before delete.
- Migration of any pre-existing highlight data (none persists today).
- Search/filter UI over highlights or cards.
- Recovery UI for highlights whose Rangy anchor fails to deserialize on revisit.
- SQLite or any database; JSON is the storage format for this round.
- Re-injection of the highlighter bundle on SPA in-page navigation. Tracked separately.
- Gating devtools behind a build flag. Tracked separately.

## Data Model

A `Highlight` is the canonical record. Each highlight has a corresponding `Card` only if it has been dragged to the whiteboard.

```ts
type HighlightId = string;          // "hl-<epoch>-<rand>", reused across grouped fragments

type HighlightColor =
  | "yellow" | "green" | "pink" | "blue" | "purple" | "orange";

interface Highlight {
  id: HighlightId;
  text: string;                      // captured via selection.toString() at create time
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];                    // lowercase, deduped, order-preserved by user
  notes: string;                     // plain text; "" when empty
  anchor: { serialized: string };    // rangy.serializeRange(range, true, document.body)
  createdAt: number;
  updatedAt: number;                 // epoch ms; used for last-write-wins reconciliation
}

interface Card {
  id: HighlightId;                   // matches the originating Highlight.id
  text: string;
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  x: number;
  y: number;
  updatedAt: number;
}
```

The pastel palette CSS values:

| Color | Fill | Underline |
|---|---|---|
| yellow | `#fff3b0` | `#f59e0b` |
| green  | `#c8e6c9` | `#16a34a` |
| pink   | `#fbcfe8` | `#ec4899` |
| blue   | `#bfdbfe` | `#2563eb` |
| purple | `#e9d5ff` | `#9333ea` |
| orange | `#fed7aa` | `#ea580c` |

## Persistence

Two files in `app.getPath('userData')`:

- `highlights.json` — `Highlight[]`
- `whiteboard.json` — `Card[]`

The main process owns both files and is the only writer. Reads are naive (load-on-demand, no in-memory cache beyond a single read per IPC call); writes are read-modify-write of the full array. Both files are created on first write if absent. No migrations this round.

## IPC

Renderer → main:

| Channel | Sender | Payload | Reply |
|---|---|---|---|
| `highlights:load` | right view | `{ url: string }` | `Highlight[]` |
| `highlights:save` | right view | `Highlight` | `{ ok: true }` |
| `highlights:delete` | right view | `{ id: HighlightId }` | `{ ok: true }` |
| `tags:list` | right view | `()` | `string[]` |
| `cards:load` | left view | `()` | `Card[]` |
| `cards:save` | left view | `Card` | `{ ok: true }` |
| `cards:delete` | left view | `{ id: HighlightId }` | `{ ok: true }` |
| `highlight-dropped` *(existing)* | overlay → main → left | extended to include the originating `Highlight` so main can persist a synced `Card` | — |

Main → renderer (broadcast after each successful write):

| Channel | Receiver | Payload | Triggered by |
|---|---|---|---|
| `highlight:updated` | right view | `Highlight` | `highlights:save` (any source) |
| `highlight:deleted` | right view | `{ id }` | `highlights:delete` |
| `card:updated` | left view | `Card` | `cards:save`, `highlights:save` (when matching card exists), `highlight-dropped` |
| `card:deleted` | left view | `{ id }` | `cards:delete` |

Sync rules:

- Each save stamps `updatedAt = Date.now()` in the sending renderer. Main writes the record verbatim — no merge.
- After saving a `Highlight`, main updates the matching `Card` in `whiteboard.json` (color, text, tags, notes; not x/y) if one exists, then broadcasts `card:updated`.
- After saving a `Card`, main does **not** push card-side edits back into the highlight this round (cards are read-only this round; only x/y changes via save). The card's other fields are kept in sync from the highlight side, never the other way.
- Originating views ignore broadcasts whose `updatedAt` matches their last local save.
- Delete is one-sided: `highlights:delete` does not touch `whiteboard.json`; `cards:delete` does not touch `highlights.json`.

## Widget UX

### Creation

1. User releases the mouse after selecting text. The existing `handleTextSelection` positions the widget under the selection.
2. The widget renders as a horizontal pill containing six color swatches, a thin divider, and a `+ note` chip. Compact resting state.
3. Clicking a color applies the highlight immediately via that color's Rangy class applier (one applier per color: `hl-yellow`, `hl-green`, …). The pill morphs in place into the expanded form: color row stays with the chosen swatch ringed, tag chip-input and notes textarea appear below.
4. Clicking `+ note` (no color picked yet) expands the form without applying a highlight; the color row pulses until a color is chosen.
5. Saves auto-flush on blur of the tag input or notes textarea, and immediately on color-swatch change after the first save. Each save calls `highlights:save`.
6. Click outside the pill or press `Esc` closes it; in-flight typing flushes via blur.

### Edit (existing highlights)

1. Hovering any DOM fragment of a highlight reveals a `⋯` button at the top-right of the fragment. Mouseleave hides it after a short grace timeout so the cursor can travel onto the button. The button's `pointerdown` stops propagation so it does not start a hold-to-drag.
2. Clicking `⋯` opens an edit panel near the button position. The panel contains: color row (current color ringed), removable tag chips with an inline input, notes textarea, and a delete (`🗑`) button at the top-right.
3. Edits auto-save on blur (tags, notes) or on click (color). Each save calls `highlights:save` for the highlight `id` shared by every fragment in the group.
4. Clicking `🗑` closes the panel, removes every DOM fragment for that `id` from the article, posts an undo toast in the right view (~5 s), and calls `highlights:delete`. Clicking `Undo` within the toast window re-creates the highlight from the in-memory record kept until expiry and calls `highlights:save` to re-assert it.
5. Click outside the panel or press `Esc` closes it; saves are already flushed via blur.
6. Clicking a different highlight while a panel is open closes the current panel and opens the new one.

### Tag input

- Typing fuzzy-matches against the result of one `tags:list` call made when the panel opens; suggestions render in a small dropdown.
- `Enter` or `,` commits the current input as a chip and clears the input.
- `Backspace` on an empty input removes the last chip.
- `Tab` while the dropdown is open accepts the highlighted suggestion.
- `Esc` while the dropdown is open closes only the dropdown, not the panel.

### Visual

- Pill and panel live in the existing shadow DOM host; CSS is isolated from the host page.
- White background, rounded 12 px, 1 px `#eee` border, `box-shadow: 0 8px 24px rgba(0,0,0,0.15)`, `z-index: 9999`.
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.
- Picked-color indicator: 2 px dark ring around the swatch.
- Tag chips: pale indigo background `#e0e7ff`, text `#3730a3`, removable via `×`.
- Highlights render as `background-color: <fill>; border-bottom: 3px solid <underline>; border-radius: 3px; padding: 2px 4px`.

### Drag coexistence

- The 250 ms hold-to-drag listener on `.highlighted-text` fragments stays untouched. The `⋯` button is the only new interactive surface on the highlight.
- The grouped-highlight contract still holds: every fragment carries the shared `data-octobase-highlight-id` and `data-octobase-highlight-text`; drag payloads use those values.

## Re-Anchoring on Page Revisit

On `did-finish-load` for the right view, after the highlighter bundle injects, it calls `highlights:load` with `window.location.href` and re-applies each returned `Highlight`:

1. Deserialize the stored Rangy range with `rangy.deserializeRange(record.anchor.serialized, document.body)`.
2. Apply the matching color's class applier to that range.
3. Stamp every produced fragment with the shared `data-octobase-highlight-id` and `data-octobase-highlight-text`.
4. If deserialization throws (page content has changed), skip the highlight; do not delete it. The record stays in `highlights.json` and waits for the page to come back.

## Error Handling

- IPC writes that fail (disk full, permissions) reject the renderer's `invoke`. The renderer surfaces a transient inline error in the panel ("Couldn't save — try again") and keeps the field's local state so the user can retry by re-blurring.
- Deserialization failures during re-application are silently skipped (the record persists, the page just shows no highlight).
- Tag autocomplete failure falls back to no-suggestions; the user can still type freely.
- Delete-undo data is held in memory in the right view only; if the right view reloads before undo is clicked, the undo is forfeit.

## Testing

Manual Electron verification, in order:

1. Select text on any article; the new pill appears.
2. Click a color → fill + matching underline applied; pill expands; tag/notes save on blur.
3. Reload the right view → highlight reappears with all attributes; opening the panel shows tags + notes intact.
4. Open panel; change color → fill + underline change immediately; reload → new color persists.
5. Drag a highlight to the whiteboard → card appears with the same color/tags/notes.
6. Edit the highlight (color/tags/notes) → the card updates without manual refresh.
7. Edit a card position by dragging → highlight is unaffected; reload → card position persists.
8. Delete a highlight → fragments removed, card on the whiteboard remains.
9. Delete a highlight, click Undo within 5 s → highlight returns at the same position with the same data.
10. Delete a card on the whiteboard → highlight in the article remains.
11. Two highlights on the same page with overlapping tags ("research", "todo") → opening either panel offers the other tag in autocomplete.

Programmatic checks (where they fit cleanly without setting up a full Electron test harness this round):

- `tags:list` returns deduped, lowercase tags from a fixture `highlights.json`.
- `highlights:save` writes the record verbatim with the incoming `updatedAt`.
- A renderer's local `updatedAt` matching the broadcast's `updatedAt` causes the broadcast to be ignored.

## Files Touched

- `src/components/highlighter/highlighter.ts` — widget redesign, edit panel, six color appliers, autocomplete, undo toast, re-application on load.
- `src/electron/preload-highlighter.js` — expose new IPC: `loadHighlights`, `saveHighlight`, `deleteHighlight`, `listTags`, listeners for `highlight:updated`, `highlight:deleted`.
- `src/electron/preload.js` — expose new IPC: `loadCards`, `saveCard`, `deleteCard`, listeners for `card:updated`, `card:deleted`. Drop `text-selection` if it's no longer used.
- `src/electron/main.js` — IPC handlers for the channels above; broadcast wiring; updates to `highlight-dropped` to persist a synced `Card` and broadcast `card:updated`.
- `src/app/whiteboard.tsx` — load `cards:load` on mount, listen for `card:updated` / `card:deleted`, render `color`/`tags`/`notes`, persist position changes via `cards:save`, persist deletes via `cards:delete`.
- `src/types/` (new file) — shared `Highlight`/`Card` types reused by the renderer code; main process imports the same types via path mapping or duplicates them in JS.

## Open Implementation Decisions Deferred to the Plan

- Whether `Highlight` types are shared via a `src/types/highlight.ts` imported on both sides, or duplicated in main's JS.
- Exact debounce on tag input dropdown (50 ms vs no debounce).
- Whether `tags:list` is recomputed lazily or cached in main with invalidation on every `highlights:save`.
