## Plan: Drag-Highlight-to-Whiteboard Card System

Highlighted text from the right-side browser view can be dragged onto the left-side whiteboard, becoming a repositionable card. A card-shaped preview follows the cursor during the drag. The main process handles coordinate translation, cards live in React state (in-memory), and each card stores its source URL.

### IPC Flow

```
Right View → main.js → Overlay View → main.js → Left View (Whiteboard)
```

1. **Highlighter** sends `{ text, sourceUrl }` on drag start
2. **Main process** activates the overlay and forwards the data
3. **Overlay** shows a card-shaped proxy following the cursor; on drop sends `{ text, sourceUrl, x, y }`
4. **Main process** removes the overlay, translates coordinates using `leftView.getBounds()`, and forwards to the whiteboard if the drop landed in the left half
5. **Whiteboard** receives the drop event and renders a new draggable card at the translated position

### Files Changed (6 total)

1. highlighter.ts — Enriched drag payload with `sourceUrl`; fixed `postMessage` data shape
2. overlay-canva.ts — Restyled proxy as a card preview (white, rounded, shadow, truncated text + hostname); sends drop coordinates via `sendDrop` on `mouseup`
3. preload-overlay.js — Exposed `sendDrop` IPC method
4. preload.js — Exposed `onHighlightDropped` and `removeHighlightDroppedListener`
5. main.js — Hoisted `leftView` with preload; added `highlight-dropped` handler that translates overlay coords → whiteboard-local coords and cleans up overlay
6. whiteboard.tsx — Built `WhiteboardCard` component (MUI `Paper`, truncated text, source `Chip`) with pointer-event-based repositioning; `useEffect` listens for drops and appends cards to in-memory state

### Design Decisions

- **Coordinate translation** happens in `main.js` using `leftView.getBounds()` — the whiteboard receives ready-to-use local coordinates
- **In-memory state** only — cards don't persist across restarts
- **Source traceability** — each card stores `sourceUrl` and displays the hostname as a chip, enabling future back-navigation
