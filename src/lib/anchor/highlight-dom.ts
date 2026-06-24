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

/**
 * Paint a set of anchored highlights over a live DOM subtree using the CSS
 * Custom Highlight API (no DOM mutation, multi-node ranges just work). One
 * registry per color, namespaced by `prefix`. Returns how many resolved.
 */
export function paintAnchors(
  root: HTMLElement,
  highlights: AnchoredHighlight[],
  prefix: string,
): number {
  if (!supportsCustomHighlight()) return 0;
  const highlightsApi = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  const HighlightCtor = (globalThis as unknown as {
    Highlight: new (...ranges: Range[]) => unknown;
  }).Highlight;

  const rangesByColor = new Map<HighlightColor, Range[]>();
  let painted = 0;
  for (const hl of highlights) {
    const located = locateAnchorRange(root, hl.anchor);
    if (!located) continue;
    const list = rangesByColor.get(hl.color) ?? [];
    list.push(located.range);
    rangesByColor.set(hl.color, list);
    painted++;
  }

  for (const key of [...highlightsApi.keys()]) {
    if (key.startsWith(prefix)) highlightsApi.delete(key);
  }
  for (const [color, ranges] of rangesByColor) {
    highlightsApi.set(`${prefix}${color}`, new HighlightCtor(...ranges));
  }
  return painted;
}
