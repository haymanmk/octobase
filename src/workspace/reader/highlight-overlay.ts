import {
  locateAnchorRange,
  supportsCustomHighlight,
} from "../../lib/anchor/highlight-dom.ts";
import type { HighlightColor, TextAnchor } from "../../lib/model/types.ts";

export interface OverlayHighlight {
  cardId: string;
  color: HighlightColor;
  anchor: TextAnchor;
}

export interface PlacedHighlight extends OverlayHighlight {
  start: number;
  end: number;
}

const HL_PREFIX = "octo-reader-";

/**
 * Paint highlights over already-rendered article content using the CSS Custom
 * Highlight API (no DOM mutation, multi-node ranges just work). Returns the
 * resolved placements so callers can hit-test clicks back to a card.
 */
export function applyHighlights(
  container: HTMLElement,
  highlights: OverlayHighlight[],
): PlacedHighlight[] {
  const placed: PlacedHighlight[] = [];
  const rangesByColor = new Map<HighlightColor, Range[]>();

  for (const hl of highlights) {
    const located = locateAnchorRange(container, hl.anchor);
    if (!located) continue;
    placed.push({ ...hl, start: located.start, end: located.end });
    const list = rangesByColor.get(hl.color) ?? [];
    list.push(located.range);
    rangesByColor.set(hl.color, list);
  }

  if (supportsCustomHighlight()) {
    const highlightsApi = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
    // Clear our previous registrations.
    for (const key of [...highlightsApi.keys()]) {
      if (key.startsWith(HL_PREFIX)) highlightsApi.delete(key);
    }
    const HighlightCtor = (globalThis as unknown as {
      Highlight: new (...ranges: Range[]) => unknown;
    }).Highlight;
    for (const [color, ranges] of rangesByColor) {
      highlightsApi.set(`${HL_PREFIX}${color}`, new HighlightCtor(...ranges));
    }
  }

  return placed.sort((a, b) => a.start - b.start);
}

export function clearHighlights(): void {
  if (!supportsCustomHighlight()) return;
  const highlightsApi = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  for (const key of [...highlightsApi.keys()]) {
    if (key.startsWith(HL_PREFIX)) highlightsApi.delete(key);
  }
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
