/**
 * The mark that says "this highlight has a note".
 *
 * One definition, three renderers: the reader panes drop it into JSX, the
 * browser-pane overlay and the extension build it as a DOM node. It has to
 * read on a printed PDF page, a dark web page and a pastel highlight band
 * alike, so it is a small dark rounded tile with a white note glyph rather
 * than a tinted dot — shape carries the meaning, not colour.
 */

/** Rendered size in CSS pixels. */
export const NOTE_BADGE_SIZE = 14;

/** The badge's inner SVG markup (no wrapper element). */
export const NOTE_BADGE_SVG = [
  '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false" opacity="0.55">',
  '<rect x="0" y="0" width="14" height="14" rx="4" fill="#22252b"/>',
  // Two short lines of "writing", and a third shorter one.
  '<rect x="3.5" y="4" width="7" height="1.4" rx="0.7" fill="#fff"/>',
  '<rect x="3.5" y="6.6" width="7" height="1.4" rx="0.7" fill="#fff"/>',
  '<rect x="3.5" y="9.2" width="4" height="1.4" rx="0.7" fill="#fff"/>',
  "</svg>",
].join("");

/** The badge as a positioned DOM node, for the overlay and the extension. */
export function createNoteBadge(doc: Document): HTMLElement {
  const el = doc.createElement("div");
  el.style.cssText =
    `position:absolute;width:${NOTE_BADGE_SIZE}px;height:${NOTE_BADGE_SIZE}px;` +
    "line-height:0;pointer-events:none;" +
    "filter:drop-shadow(0 1px 2px rgba(0,0,0,.28));";
  el.innerHTML = NOTE_BADGE_SVG;
  return el;
}
