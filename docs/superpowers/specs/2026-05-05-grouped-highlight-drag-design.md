# Grouped Highlight Drag Design

## Context

Octobase lets users highlight text in the right article pane and drag that highlight into the left whiteboard as a Card. Rangy may split one user selection into multiple `.highlighted-text` DOM fragments when the selected text crosses elements such as `<p>`, `<a>`, or `<code>`.

Today each physical fragment behaves like an independent highlight. That causes two related problems:

- Dragging a fragment can send only that fragment's text instead of the full selected passage.
- Re-dragging fragments can create duplicate cards if the fragments emit different highlight IDs.

## Goal

Treat one user selection as one logical Octobase highlight, even when Rangy renders it as multiple DOM fragments. Dragging any fragment from that group should create at most one whiteboard Card containing the full selected text.

## Non-Goals

- Do not physically wrap arbitrary mixed article DOM in one parent element.
- Do not change whiteboard card rendering or persistence.
- Do not add editing, deletion, or visual group controls in this change.

## Recommended Approach

Keep Rangy's split DOM fragments, but attach shared Octobase metadata to every fragment created from one selection:

- `data-octobase-highlight-id`: the logical highlight group ID.
- `data-octobase-highlight-text`: the full selected text captured before Rangy mutates the DOM.

The drag handler for each fragment reads the shared metadata instead of using only `htmlEl.textContent`. Any fragment can act as the drag handle, but all fragments emit the same `{ text, highlightId }` payload.

## Data Flow

1. User selects text in the article.
2. User clicks the highlighter widget.
3. Before calling Rangy, the highlighter captures `selection.toString()` as `highlightText` and creates one `highlightGroupId`.
4. Rangy applies `.highlighted-text` to each physical fragment.
5. In Rangy's `onElementCreate`, each fragment receives the same group metadata and the existing pointer-drag listener.
6. On hold-drag, the fragment sends:
   - `text`: `data-octobase-highlight-text`
   - `highlightId`: `data-octobase-highlight-id`
   - `sourceUrl`: current article URL
   - cursor coordinates
7. The existing main-process and overlay flow forwards the drop.
8. The whiteboard's existing `highlightId` dedupe prevents duplicate Cards for the same logical highlight.

## Error Handling

If a fragment is missing `data-octobase-highlight-text`, the drag handler falls back to `htmlEl.textContent`. If a fragment is missing `data-octobase-highlight-id`, it falls back to creating and storing one stable ID for that fragment. This preserves current behavior for old or partially migrated highlights.

## Testing

Add focused tests for the grouping helper:

- Multiple fragment-like elements from one selected text receive the same `highlightId`.
- Each fragment receives the full selected text, not only its own text content.
- Existing single-fragment ID reuse continues to pass.

Manual Electron testing should verify:

- Select across mixed inline elements, highlight once, drag any fragment to the whiteboard.
- Only one Card appears.
- Re-dragging any fragment from the same highlighted selection does not create another Card.
