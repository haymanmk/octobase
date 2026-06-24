import { locateAnchor } from "./text-anchor.ts";
import type { HighlightColor, TextAnchor } from "../model/types.ts";

/** Find the text node + local offset for a global character offset in `root`. */
function locateNode(
  root: HTMLElement,
  target: number,
): { node: Text; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

/** Re-locate an anchor inside a live DOM subtree and return a Range over it. */
export function locateAnchorRange(
  root: HTMLElement,
  anchor: TextAnchor,
): { range: Range; start: number; end: number } | null {
  const text = root.textContent ?? "";
  const loc = locateAnchor(text, anchor);
  if (!loc) return null;
  const a = locateNode(root, loc.start);
  const b = locateNode(root, loc.end);
  if (!a || !b) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return { range, start: loc.start, end: loc.end };
}

export function supportsCustomHighlight(): boolean {
  return (
    typeof CSS !== "undefined" &&
    !!(CSS as unknown as { highlights?: unknown }).highlights &&
    typeof (globalThis as { Highlight?: unknown }).Highlight !== "undefined"
  );
}

interface AnchoredHighlight {
  color: HighlightColor;
  anchor: TextAnchor;
}

/** Where a highlight landed in the current DOM (index into the input array). */
export interface Placement {
  index: number;
  start: number;
  end: number;
}

/**
 * Paint a set of anchored highlights over a live DOM subtree using the CSS
 * Custom Highlight API (no DOM mutation, multi-node ranges just work). One
 * registry per color, namespaced by `prefix`. Returns the resolved placements
 * so callers can hit-test clicks back to a highlight.
 */
export function paintAnchors(
  root: HTMLElement,
  highlights: AnchoredHighlight[],
  prefix: string,
): Placement[] {
  const placements: Placement[] = [];
  if (!supportsCustomHighlight()) return placements;
  const highlightsApi = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  const HighlightCtor = (globalThis as unknown as {
    Highlight: new (...ranges: Range[]) => unknown;
  }).Highlight;

  const rangesByColor = new Map<HighlightColor, Range[]>();
  highlights.forEach((hl, index) => {
    const located = locateAnchorRange(root, hl.anchor);
    if (!located) return;
    placements.push({ index, start: located.start, end: located.end });
    const list = rangesByColor.get(hl.color) ?? [];
    list.push(located.range);
    rangesByColor.set(hl.color, list);
  });

  for (const key of [...highlightsApi.keys()]) {
    if (key.startsWith(prefix)) highlightsApi.delete(key);
  }
  for (const [color, ranges] of rangesByColor) {
    highlightsApi.set(`${prefix}${color}`, new HighlightCtor(...ranges));
  }
  return placements;
}

/** Map a viewport point to a global text offset within `root` (browser only). */
export function offsetFromPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = root.ownerDocument;
  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const cdoc = doc as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
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
  if (!node || !root.contains(node)) return null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let cur = walker.nextNode();
  while (cur) {
    if (cur === node) return acc + offset;
    acc += cur.textContent?.length ?? 0;
    cur = walker.nextNode();
  }
  return null;
}
