import type { TextAnchor } from "../model/types.ts";

const CONTEXT = 32;

/**
 * Build a durable anchor from a slice of plain text. `start`/`end` are character
 * offsets into `text`. Used directly when we already have the plain-text body of
 * a captured article; the DOM variant (`describeAnchorFromRange`) delegates here.
 */
export function describeAnchor(
  text: string,
  start: number,
  end: number,
): TextAnchor {
  const exact = text.slice(start, end);
  const prefix = text.slice(Math.max(0, start - CONTEXT), start);
  const suffix = text.slice(end, Math.min(text.length, end + CONTEXT));
  return { exact, prefix, suffix, startHint: start };
}

/**
 * Re-locate an anchor inside (possibly changed) text. Strategy, most-precise
 * first:
 *   1. exact + matching prefix/suffix context near the hint
 *   2. exact + matching context anywhere
 *   3. exact match nearest to the hint
 *   4. fuzzy: longest common run of the exact string near the hint
 * Returns null when nothing plausible is found.
 */
export function locateAnchor(
  text: string,
  anchor: TextAnchor,
): { start: number; end: number } | null {
  const { exact, prefix, suffix, startHint } = anchor;
  if (!exact) return null;

  const candidates = allIndexesOf(text, exact);
  if (candidates.length === 0) {
    return fuzzyLocate(text, anchor);
  }

  // Score each candidate by context match + closeness to the hint.
  let best: { start: number; score: number } | null = null;
  for (const idx of candidates) {
    const before = text.slice(Math.max(0, idx - prefix.length), idx);
    const after = text.slice(idx + exact.length, idx + exact.length + suffix.length);
    const prefixScore = commonSuffixLen(before, prefix);
    const suffixScore = commonPrefixLen(after, suffix);
    const contextScore = prefixScore + suffixScore;
    // Distance penalty, normalized so context always dominates.
    const distance = Math.abs(idx - startHint);
    const score = contextScore * 1000 - distance;
    if (!best || score > best.score) best = { start: idx, score };
  }
  if (!best) return null;
  return { start: best.start, end: best.start + exact.length };
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Fallback when the exact string is gone: slide a window the size of `exact`
 * across the text near the hint and pick the position with the most matching
 * characters, accepting it only above a similarity threshold.
 */
function fuzzyLocate(
  text: string,
  anchor: TextAnchor,
): { start: number; end: number } | null {
  const { exact, startHint } = anchor;
  const len = exact.length;
  if (len === 0 || text.length < Math.ceil(len / 2)) return null;

  const radius = Math.max(200, len * 4);
  const lo = Math.max(0, startHint - radius);
  const hi = Math.min(text.length - len, startHint + radius);
  if (hi < lo) return null;

  let bestStart = -1;
  let bestMatches = -1;
  for (let s = lo; s <= hi; s++) {
    let matches = 0;
    for (let k = 0; k < len; k++) {
      if (text[s + k] === exact[k]) matches++;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestStart = s;
    }
  }
  if (bestStart < 0) return null;
  if (bestMatches / len < 0.7) return null; // not similar enough
  return { start: bestStart, end: bestStart + len };
}

/**
 * Browser-only: build an anchor from a live DOM Range relative to a root
 * element's textContent. Kept thin so the heavy logic stays pure + testable.
 */
export function describeAnchorFromRange(
  root: HTMLElement,
  range: Range,
): TextAnchor | null {
  const full = root.textContent ?? "";
  const start = offsetWithin(root, range.startContainer, range.startOffset);
  const end = offsetWithin(root, range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;
  return describeAnchor(full, start, end);
}

function offsetWithin(
  root: HTMLElement,
  node: Node,
  nodeOffset: number,
): number | null {
  const doc = root.ownerDocument;
  if (!doc || !root.contains(node)) return null;
  // Measure the text between the root's start and the boundary. Unlike a
  // text-node walk keyed on identity, this is exact for element boundaries
  // too (e.g. a drag ending in the PDF text layer's blank space yields
  // (layer div, childIndex) — which used to resolve to the whole page).
  const r = doc.createRange();
  r.setStart(root, 0);
  try {
    r.setEnd(node, nodeOffset);
  } catch {
    return null;
  }
  return r.toString().length;
}
