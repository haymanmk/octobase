/**
 * Scroll-position math for the PDF reader's page column.
 *
 * The column lays pages out vertically: a fixed `gap` above every page (and
 * one after the last), page heights scaled by the current zoom. Only the
 * pages scale — the gaps don't — so a scroll offset can't be carried across
 * a zoom change by simple proportion: the fixed-gap portion of the offset
 * would get scaled too, drifting the view by (ratio − 1) · gap · pageIndex.
 *
 * Zoom changes therefore travel as an *anchor* — a page and a fraction of it —
 * rather than as a scroll offset. The anchor must be read before the pages
 * resize: a zoom-out shortens the document, and the browser clamps scrollTop
 * to the shorter scrollHeight during that layout, so a reading position deep
 * in a long document is already gone by the time the new pages are in the DOM.
 */

/** A reading position: the page under the viewport middle, and where on it. */
export interface PageAnchor {
  /** 1-based page number. */
  page: number;
  /** Fraction of that page's height sitting under the viewport middle. */
  frac: number;
}

/** Read the current reading position. Call before the pages resize. */
export function anchorFromScroll(opts: {
  scrollTop: number;
  clientHeight: number;
  baseHeights: number[];
  scale: number;
  gap: number;
}): PageAnchor {
  const { scrollTop, clientHeight, baseHeights, scale, gap } = opts;
  if (baseHeights.length === 0) return { page: 1, frac: 0 };
  const mid = scrollTop + clientHeight / 2;
  let top = gap;
  let i = 0;
  for (; i < baseHeights.length - 1; i++) {
    const span = baseHeights[i] * scale + gap;
    if (mid < top + span) break;
    top += span;
  }
  return { page: i + 1, frac: (mid - top) / (baseHeights[i] * scale) };
}

/** The scrollTop that puts `anchor` back under the viewport middle at `scale`. */
export function scrollTopForAnchor(opts: {
  anchor: PageAnchor;
  clientHeight: number;
  baseHeights: number[];
  scale: number;
  gap: number;
}): number {
  const { anchor, clientHeight, baseHeights, scale, gap } = opts;
  if (baseHeights.length === 0) return 0;
  const i = Math.min(Math.max(anchor.page - 1, 0), baseHeights.length - 1);
  let top = gap;
  for (let j = 0; j < i; j++) top += baseHeights[j] * scale + gap;
  return top + anchor.frac * baseHeights[i] * scale - clientHeight / 2;
}

/**
 * The scrollTop that holds the viewport middle steady across a scale change,
 * for a `scrollTop` still measured at `prevScale`.
 */
export function rescaledScrollTop(opts: {
  scrollTop: number;
  clientHeight: number;
  prevScale: number;
  nextScale: number;
  baseHeights: number[];
  gap: number;
}): number {
  const { scrollTop, clientHeight, prevScale, nextScale, baseHeights, gap } = opts;
  const anchor = anchorFromScroll({ scrollTop, clientHeight, baseHeights, scale: prevScale, gap });
  return scrollTopForAnchor({ anchor, clientHeight, baseHeights, scale: nextScale, gap });
}
