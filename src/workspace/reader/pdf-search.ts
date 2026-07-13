/**
 * Pure text-search helpers for the PDF reader. Page text is extracted once
 * (pdf.js getTextContent) and cached; these functions turn a query into a flat,
 * ordered list of hits the toolbar walks with ‹ ›. Framework-free so it can be
 * unit-tested without pdf.js or the DOM.
 */

export interface SearchHit {
  /** 1-based page number. */
  page: number;
  /** Character offset of the match within that page's text. */
  index: number;
  /** Matched length (== query length). */
  length: number;
}

/** Every case-insensitive occurrence of `query`, ordered by page then offset. */
export function findHits(pageTexts: string[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (let p = 0; p < pageTexts.length; p++) {
    const hay = pageTexts[p].toLowerCase();
    let from = 0;
    for (;;) {
      const i = hay.indexOf(q, from);
      if (i === -1) break;
      hits.push({ page: p + 1, index: i, length: q.length });
      from = i + q.length;
    }
  }
  return hits;
}

/** Wrap an index into range, or -1 when there are no hits. */
export function stepHit(count: number, current: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  return (current + dir + count) % count;
}
