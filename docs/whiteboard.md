# Whiteboard canvas

The whiteboard is the infinite pan/zoom canvas at the centre of the
Workspace UI. Source: `src/workspace/Canvas.tsx` (view state, pointer
gestures, edge orchestration) and `src/workspace/CanvasCard.tsx` (one
placed card). For the store, card model, and the shell around the canvas
(sidebar, library, viewer pane) see `workspace-kb.md`.

> The original left-pane MUI whiteboard this document used to describe
> (`src/app/whiteboard.tsx`, `cards:load/save/delete` IPC) is legacy. It is
> no longer mounted — `index.html` loads `src/App.tsx`, which renders
> `Workspace` directly — and survives only behind the react-router config
> used by `npm run dev-react`. Its IPC channels still exist in `main.js`
> but nothing in the Workspace uses them.

## View state and gestures

The canvas holds a `View { tx, ty, scale }` and applies it as a CSS
transform on `.ws-canvas-surface`. Scale is clamped to 0.35–2.2.

| Gesture | Effect |
|---|---|
| Wheel | Zoom, anchored at the cursor. Pinch arrives as ctrl+wheel and zooms faster. Scrollable card content under the cursor (the editor, or a selected card's overflowing body) gets the wheel first. |
| Right-drag | Pan, from anywhere — even over cards. A `panned` flag distinguishes a drag from a plain right-click. |
| Right-click (no drag) | Context menu on release: card menu, edge menu, or the new-card menu on empty canvas. The native `contextmenu` event is suppressed because macOS fires it on press, which would beat the pan. |
| Left-drag on empty canvas | Marquee multi-select; placements intersecting the rectangle become the selection. |
| Left click on empty canvas | Clears the selection. |
| Double-click on empty canvas | Creates a note card there and opens it for editing. |
| ⌖ topbar button | `zoomToFit()` — recenter/zoom so every placement is visible. |

The canvas exposes a `CanvasHandle` (`screenToWorld`, `containsPoint`,
`zoomToFit`) so the shell can convert drop points arriving in screen
coordinates — highlight drops from the Electron browser pane, holds
dragged out of the reader — into world coordinates.

## Cards

Each `CanvasCard` renders a `Placement` (x/y/w/h/z, see
`workspace-kb.md`): color accent bar, kind label (Note / Highlight /
Article / Clip), title, markdown body via `MarkdownView`, tag chips, and a
source-hostname footer for captured kinds. Image cards show their clipped
PNG via the `octobase-clip://` protocol.

- **Move**: drag anywhere on the card, window-level listeners, 3 px
  threshold so plain clicks still reach links and checkboxes. Dragging one
  card of a multi-selection moves the whole group.
- **Resize**: corner handle, min 180×120. A resize counts as movement from
  the start, so releasing the handle never falls through to edit mode.
- **Select → edit**: a motionless click on an already-selected card enters
  edit mode (no double-click needed); double-click also opens. Selecting
  brings the placement to front (`bringToFront`).

## In-place editing

Edit mode swaps the body for a title input plus `CardMarkdownEditor`
(`src/workspace/CardMarkdownEditor.tsx`) — a TipTap WYSIWYG surface
(StarterKit, task lists, `tiptap-markdown`) where typing `## `, `- `,
`**bold**` renders immediately while the value streamed back stays plain
markdown. Session semantics live in the card: commit when focus leaves the
card or on ⌘↵, Esc cancels. The body draft goes through a ref, not state,
so keystrokes don't re-render the card.

While typing, the card **auto-grows** so the editor never overflows
(`growToFit` in `CanvasCard.tsx`): grow-only, capped at 900 px, measured in
pre-transform layout px so it maps 1:1 onto placement units.

## Edges (mind-map connectors)

Edges are board-scoped records (`Edge` in `src/lib/model/types.ts`:
`whiteboardId`, `fromCardId`, `toCardId`, `label`, `directed`) stored in
`WorkspaceData.edges` and cleaned up when a card leaves the board or is
deleted. Rendering is `src/workspace/EdgeLayer.tsx`; the math is
`src/workspace/edge-geometry.ts`, framework-free and unit-testable.

- **Create**: hover a card → four side handles appear; drag from a handle
  to another card. A dashed preview curve follows the cursor and the
  hovered target card lights up.
- **Routing**: cubic bézier between the closest pair of side midpoints
  (`nearestAnchors`), so edges re-route as cards move.
- **Label**: a pill at the curve midpoint; double-click the edge (or use
  its menu) to edit inline.
- **Arrowhead**: SVG marker at the target end, toggled by `directed`;
  the menu can also flip direction.
- **Select / delete**: click selects (endpoint dots appear);
  Delete/Backspace or the right-click menu removes it.

The SVG layer renders *before* the cards inside the pan/zoom surface, so
cards paint on top; each path carries a fat transparent twin
(`.ws-edge-hit`) as the click target.

## Nesting (`![[embed]]`)

Any card kind can host embeds in its body (`acceptsEmbed` in
`CanvasCard.tsx` — only an open editor opts out). A card nests via:

- dragging a **library tile** onto a card (embed-target ring), or
- **releasing a board-card drag over another card** (no modifier needed;
  ⌥ still works) — this also removes the dragged card's placement
  (undoable via toast). Multi-selection drags are group moves and never
  nest, or
- **hold-dragging a highlight/clip out of a reader** (article or PDF) or
  the browser pane and releasing it over a card — the highlight embeds
  there (placement untouched) instead of landing on the canvas. The
  shared hit-test is `embedHostAt` in `drop-caret.ts`.

Un-nesting is the same gesture in reverse: drag an embed **mini-card out
of a card's read view** — released on the canvas it takes a placement
there (`removeEmbed` + `placeCard`); released over another card the embed
moves there at the drop caret; released back on its own host, nothing
happens.

While either drag hovers a note, a **drop caret** (`drop-caret.ts`) marks
the block boundary nearest the pointer; the drop calls
`store.embedCard(host, child, { at })`, splicing the `![[Child Title]]`
block in at that index (blank-line-separated, fence-aware; appended when
no caret position applies). `MarkdownView` renders a resolved depth-0
embed as a **mini-card** (title, image thumb, snippet; click opens the
card); unresolved targets and embeds-inside-embeds render as plain chips,
which is also where cycles die. Inside the TipTap editor the block is an
inert atom node (`src/workspace/card-embed-node.ts`) whose node view shows
the same mini-card, and it round-trips to the same markdown.

## Groups (named collapsible frames)

**⌘G** wraps the selected cards in a named frame (`Group` entity in
`types.ts`; CRUD + `moveGroup` in the store). Membership is **derived,
never stored**: a placement belongs to the frame whose bounds contain its
center — smallest frame wins on overlap (`src/lib/model/groups.ts`). Drag
a card in or out to change membership; groups are flat (no nesting).

The frame's interior is `pointer-events: none`, so marquee/pan/double-click
still work inside it. Interactions live on the **name pill** (drag moves
the frame *and* its members via `moveGroup`; double-click renames; chevron
collapses; right-click opens rename/collapse/ungroup) and a corner resize
handle. Ungroup deletes the frame only.

**Collapse** hides member cards, leaving a compact chip (name + count) at
the frame position; placements are untouched, so expanding restores the
exact layout. An edge from an outside card to a hidden member **stays
visible, redrawn dashed to the chip** (`routeEdge`; the pinned side is
dropped for the substituted end — it belongs to the card, not the chip);
only edges fully inside one collapsed group disappear. Any jump to a
hidden card — TOC row, ⌘K, wikilink/embed click — auto-expands the group
first (`expandGroupOf` in `Workspace.tsx`). In the TOC, named frames are
the only headlines (foldable, collapsed by default); loose cards render as
flat rows in reading order — spatial islands order rows but never make a
heading; see `toc.ts`.

## Drops onto the canvas

All card drags share one HTML5 payload, `CARD_DRAG_MIME` (`src/workspace/dnd.ts`).

| Source | Path |
|---|---|
| Library tile / sidebar | HTML5 drop → `onDropCard` → `placeCard` at the drop point. |
| Highlight from the Electron browser pane | `highlight-dropped` IPC → `applyHighlightDrop` (`drop-highlight.ts`) upserts by highlight id and places (or inboxes) the card. See `workspace-kb.md`. |
| Highlight hold-dragged out of a reader tab | `onDropHighlight` → `placeCard` at the release point. |
