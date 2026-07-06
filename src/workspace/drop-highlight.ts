import type { WorkspaceStore } from "../lib/store/workspace-store.ts";
import type { HighlightCard, HighlightColor } from "../lib/model/types.ts";

/**
 * Payload forwarded by the Electron main process when a highlight is dragged
 * out of the browser pane and dropped. `x`/`y` are renderer-local screen
 * coordinates; the caller decides whether they land on the canvas.
 */
export interface HighlightDropPayload {
  highlightId: string;
  text: string;
  sourceUrl: string;
  color?: HighlightColor;
  tags?: string[];
  notes?: string;
  x: number;
  y: number;
}

/** Where the drop landed: a canvas point in world coords, or null → inbox. */
export interface DropTarget {
  boardId: string;
  wx: number;
  wy: number;
}

/**
 * Materialize a dropped page-highlight as a card. Keyed by the highlight's
 * stable id, so re-dropping the same highlight moves its placement instead of
 * duplicating the card. The page highlighter anchors with a rangy-serialized
 * range we can't reuse, so the card gets a text-quote anchor synthesized from
 * the highlight text (enough for the reader to re-locate it in a capture).
 */
export function applyHighlightDrop(
  store: WorkspaceStore,
  payload: HighlightDropPayload,
  target: DropTarget | null,
): HighlightCard {
  const card = store.upsertHighlight({
    id: payload.highlightId,
    text: payload.text,
    sourceUrl: payload.sourceUrl,
    anchor: { exact: payload.text, prefix: "", suffix: "", startHint: 0 },
    color: payload.color,
    note: payload.notes,
  });
  if (payload.tags?.length) {
    store.updateCard(card.id, { tags: payload.tags });
  }
  if (target) {
    store.placeCard(target.boardId, card.id, target.wx, target.wy);
  }
  return store.getCard(card.id) as HighlightCard;
}
