import { locateAnchor } from "../../lib/anchor/text-anchor.ts";
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

/** Find the text node + local offset for a global character offset in `container`. */
function locateNode(
  container: HTMLElement,
  target: number,
): { node: Text; offset: number } | null {
  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
  );
  let acc = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (acc + len >= target) return { node, offset: target - acc };
    acc += len;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

function offsetRange(container: HTMLElement, start: number, end: number): Range | null {
  const a = locateNode(container, start);
  const b = locateNode(container, end);
  if (!a || !b) return null;
  const range = container.ownerDocument.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function supportsCustomHighlight(): boolean {
  return (
    typeof CSS !== "undefined" &&
    !!(CSS as unknown as { highlights?: unknown }).highlights &&
    typeof (globalThis as { Highlight?: unknown }).Highlight !== "undefined"
  );
}

/**
 * Paint highlights over already-rendered article content using the CSS Custom
 * Highlight API (no DOM mutation, multi-node ranges just work). Returns the
 * resolved placements so callers can hit-test clicks back to a card.
 */
export function applyHighlights(
  container: HTMLElement,
  highlights: OverlayHighlight[],
): PlacedHighlight[] {
  const text = container.textContent ?? "";
  const placed: PlacedHighlight[] = [];
  const rangesByColor = new Map<HighlightColor, Range[]>();

  for (const hl of highlights) {
    const loc = locateAnchor(text, hl.anchor);
    if (!loc) continue;
    const range = offsetRange(container, loc.start, loc.end);
    if (!range) continue;
    placed.push({ ...hl, start: loc.start, end: loc.end });
    const list = rangesByColor.get(hl.color) ?? [];
    list.push(range);
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
