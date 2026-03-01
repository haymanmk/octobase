# The Design of This Application

## Plan

Octobase is a split-pane Electron app for visual note-taking. The right pane embeds any website where users can highlight text. Highlights can be dragged from the browser into the left pane — a freeform whiteboard — where they appear as repositionable cards. A card-shaped preview follows the cursor during the drag. Each card retains its source URL for traceability.

## IPCs

### Dragging Hightlight from Browser to Whiteboard 
RIGHT VIEW (website)          MAIN PROCESS              OVERLAY VIEW              LEFT VIEW (whiteboard)
────────────────              ────────────              ────────────              ──────────────────────
User drags highlight
→ sendDragText({text, sourceUrl})
    ─── drag-drop-text-selection ──►
                              Adds overlayView
                              Forwards data ───────────►
                                                        Creates card-shaped proxy
                                                        Tracks mousemove
                                                        On mouseup:
                                                        sendDrop({text, sourceUrl, x, y})
                              ◄── highlight-dropped ────
                              Removes overlayView
                              Gets leftView.getBounds()
                              If drop inside left half:
                              Translates coords ────────────────────────────────►
                                                                                onHighlightDropped
                                                                                Creates card in state
                                                                                Renders at (x, y)