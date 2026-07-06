import { locateAnchorRange } from "../../lib/anchor/highlight-dom.ts";
import type { HighlightColor, TextAnchor } from "../../lib/model/types.ts";

export interface OverlayHighlight {
  cardId: string;
  color: HighlightColor;
  anchor: TextAnchor;
}

export interface PlacedHighlight extends OverlayHighlight {
  start: number;
  end: number;
  /** The live DOM range, for scroll-into-view, hit ghosts, and band rects. */
  range: Range;
}

/** A marker band rectangle, relative to the reader body element. */
export interface HighlightBand {
  cardId: string;
  color: HighlightColor;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Resolve highlight anchors against the rendered article. Painting is done by
 * the caller with geometry bands (see bandsFor) — the CSS Highlight API can't
 * draw the partial-height marker stroke shared with the live browser.
 */
export function locateHighlights(
  container: HTMLElement,
  highlights: OverlayHighlight[],
): PlacedHighlight[] {
  const placed: PlacedHighlight[] = [];
  for (const hl of highlights) {
    const located = locateAnchorRange(container, hl.anchor);
    if (!located) continue;
    placed.push({ ...hl, start: located.start, end: located.end, range: located.range });
  }
  return placed.sort((a, b) => a.start - b.start);
}

/**
 * Marker-band rectangles for the placed highlights: one per line box, spanning
 * the middle 50% of the line — the same stroke the live-browser highlighter
 * paints, which keeps inline-code chips recognizable underneath.
 */
export function bandsFor(
  container: HTMLElement,
  placed: PlacedHighlight[],
): HighlightBand[] {
  const base = container.getBoundingClientRect();
  const bands: HighlightBand[] = [];
  for (const p of placed) {
    for (const r of p.range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      bands.push({
        cardId: p.cardId,
        color: p.color,
        x: r.left - base.left,
        y: r.top - base.top + r.height * 0.25,
        w: r.width,
        h: r.height * 0.5,
      });
    }
  }
  return bands;
}

/** Map a click point to a global text offset within the container. */
export function offsetFromPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = container.ownerDocument;
  let node: Node | null = null;
  let offset = 0;
  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const cdoc = doc as CaretDoc;
  if (cdoc.caretPositionFromPoint) {
    const pos = cdoc.caretPositionFromPoint(clientX, clientY);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (cdoc.caretRangeFromPoint) {
    const r = cdoc.caretRangeFromPoint(clientX, clientY);
    if (!r) return null;
    node = r.startContainer;
    offset = r.startOffset;
  } else {
    return null;
  }
  if (!node || !container.contains(node)) return null;

  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let cur = walker.nextNode();
  while (cur) {
    if (cur === node) return acc + offset;
    acc += cur.textContent?.length ?? 0;
    cur = walker.nextNode();
  }
  return null;
}

/** The highlight covering a given offset, if any (last-registered wins on overlap). */
export function highlightAtOffset(
  placed: PlacedHighlight[],
  offset: number,
): PlacedHighlight | null {
  let hit: PlacedHighlight | null = null;
  for (const p of placed) {
    if (offset >= p.start && offset < p.end) hit = p;
  }
  return hit;
}
