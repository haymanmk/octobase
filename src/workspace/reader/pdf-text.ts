/**
 * Whole-document text extraction: turns pdf.js text items into readable
 * markdown for the in-app AI (page markers for citation, outline headings,
 * rebuilt paragraphs). The geometry heuristics are pure and unit-tested;
 * only `extractPdfMarkdown` at the bottom touches pdf.js.
 */
import type { PDFDocumentProxy } from "./pdf-doc.ts";
import { flattenOutline, type RawOutlineItem } from "./pdf-outline.ts";

/** Simplified pdf.js text item (PDF space: y grows upward). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Line {
  y: number;
  items: TextItem[];
}

/** Group items into baseline lines, top→bottom, items left→right. */
function groupLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const tol = Math.max(2, it.h * 0.5);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y); // PDF y-up: larger y = higher
}

/** Join one line's items, inserting spaces only across real word gaps. */
function lineText(line: Line): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const it of line.items) {
    if (prevEnd !== null) {
      const gap = it.x - prevEnd;
      if (gap > Math.max(1, it.h * 0.15) && !out.endsWith(" ") && !it.str.startsWith(" ")) {
        out += " ";
      }
    }
    out += it.str;
    prevEnd = it.x + it.w;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Append a line to the paragraph, resolving end-of-line hyphenation. */
function joinLines(para: string, next: string): string {
  if (/[a-z]-$/.test(para) && /^[a-z]/.test(next)) {
    return para.slice(0, -1) + next;
  }
  return `${para} ${next}`;
}

/**
 * A vertical gutter splitting the page into two columns, or null. Detected
 * as the widest x-coverage gap in the middle of the page, ignoring items
 * wide enough to span both columns (titles, figures' captions).
 */
function detectGutter(items: TextItem[]): number | null {
  if (items.length < 4) return null;
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const width = maxX - minX;
  if (width <= 0) return null;
  // Scan the middle band for the x that the fewest items straddle. (A
  // coverage-gap search fails here: full-width lines arrive as many narrow
  // fragments that collectively cover the gutter without any one crossing it.)
  let minCross = Infinity;
  const winners: number[] = [];
  for (let t = 0.35; t <= 0.651; t += 0.01) {
    const x = minX + width * t;
    const crossings = items.reduce(
      (n, i) => (i.x < x && i.x + i.w > x ? n + 1 : n),
      0,
    );
    if (crossings < minCross) {
      minCross = crossings;
      winners.length = 0;
    }
    if (crossings === minCross) winners.push(x);
  }
  // A handful of crossers is normal — titles, figure captions, and margin
  // stamps legitimately span both columns.
  if (minCross > Math.max(2, items.length * 0.08)) return null;
  const gutter = winners[Math.floor(winners.length / 2)];
  // Both columns need a real share of the content.
  const left = items.filter((i) => i.x + i.w <= gutter).length;
  const right = items.filter((i) => i.x >= gutter).length;
  const enough = items.length * 0.2;
  return left >= enough && right >= enough ? gutter : null;
}

/**
 * Reading order for a two-column page. Items are split into left / right /
 * spanning streams (columns share baselines, so lines must be grouped per
 * stream), then walked top-to-bottom: contiguous column lines form bands
 * read left-column-first; runs of spanning lines (title, authors) break the
 * bands and stay in vertical position.
 */
function readingOrder(items: TextItem[], gutter: number): Line[][] {
  const left: TextItem[] = [];
  const right: TextItem[] = [];
  const span: TextItem[] = [];
  for (const it of items) {
    if (it.x + it.w <= gutter + 2) left.push(it);
    else if (it.x >= gutter - 2) right.push(it);
    else span.push(it);
  }
  type Tagged = Line & { tag: "L" | "R" | "S" };
  const tagged: Tagged[] = [
    ...groupLines(left).map((l) => ({ ...l, tag: "L" as const })),
    ...groupLines(right).map((l) => ({ ...l, tag: "R" as const })),
    ...groupLines(span).map((l) => ({ ...l, tag: "S" as const })),
  ].sort((a, b) => b.y - a.y);

  const segments: Line[][] = [];
  let curL: Line[] = [];
  let curR: Line[] = [];
  let curS: Line[] = [];
  const flushCols = () => {
    if (curL.length) segments.push(curL);
    if (curR.length) segments.push(curR);
    curL = [];
    curR = [];
  };
  const flushSpan = () => {
    if (curS.length) segments.push(curS);
    curS = [];
  };
  for (const line of tagged) {
    if (line.tag === "S") {
      flushCols();
      curS.push(line);
    } else {
      flushSpan();
      (line.tag === "L" ? curL : curR).push(line);
    }
  }
  flushCols();
  flushSpan();
  return segments;
}

/** Paragraphs of one reading-order segment (a column band or spanning run). */
function segmentParagraphs(lines: Line[]): string[] {
  // The smallest real baseline distance is the leading; anything clearly
  // larger separates paragraphs. (A median would skew high on segments with
  // few lines and many section breaks.)
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 1) gaps.push(g);
  }
  const typicalGap = gaps.length ? Math.min(...gaps) : 0;

  const paras: string[] = [];
  let current = "";
  lines.forEach((line, i) => {
    const text = lineText(line);
    if (!text) return;
    const gap = i === 0 ? 0 : lines[i - 1].y - line.y;
    if (current && typicalGap > 0 && gap > typicalGap * 1.6) {
      paras.push(current);
      current = text;
    } else {
      current = current ? joinLines(current, text) : text;
    }
  });
  if (current) paras.push(current);
  return paras;
}

/**
 * Rebuild a page's paragraphs from its text items, in reading order —
 * two-column pages (research papers) read down the left column before the
 * right instead of interleaving.
 */
export function pageParagraphs(items: TextItem[]): string[] {
  const clean = items.filter((i) => i.str.trim());
  if (clean.length === 0) return [];
  const gutter = detectGutter(clean);
  const segments = gutter === null ? [groupLines(clean)] : readingOrder(clean, gutter);
  return segments.flatMap(segmentParagraphs);
}

export interface DocHeading {
  title: string;
  /** Outline depth: 0 = chapter → "##", 1 → "###", … */
  depth: number;
  /** 1-based page the heading points to. */
  page: number;
}

/** Assemble the whole document: title, page markers, headings, paragraphs. */
export function assembleDocument(opts: {
  title: string;
  /** Paragraphs per page, page order. */
  pages: string[][];
  headings: DocHeading[];
}): string {
  const parts: string[] = [`# ${opts.title.trim() || "Untitled PDF"}`];
  opts.pages.forEach((paras, i) => {
    const pageNo = i + 1;
    if (paras.length === 0) {
      parts.push(`[page ${pageNo} — no text layer]`);
      return;
    }
    parts.push(`[page ${pageNo}]`);
    for (const h of opts.headings.filter((x) => x.page === pageNo)) {
      parts.push(`${"#".repeat(Math.min(6, 2 + h.depth))} ${h.title.trim()}`);
    }
    parts.push(...paras);
  });
  return parts.join("\n\n") + "\n";
}

// ---- pdf.js integration (verified live, not unit-tested) -------------------

interface PdfJsTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

/** Resolve the outline to per-page headings; unresolvable entries drop out. */
async function outlineHeadings(doc: PDFDocumentProxy): Promise<DocHeading[]> {
  const raw = (await doc.getOutline().catch(() => null)) as RawOutlineItem[] | null;
  const flat = flattenOutline(raw);
  const out: DocHeading[] = [];
  for (const item of flat) {
    try {
      const dest =
        typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
      const ref = Array.isArray(dest) ? dest[0] : null;
      if (!ref) continue;
      const pageIndex = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
      out.push({ title: item.title, depth: item.depth, page: pageIndex + 1 });
    } catch {
      /* named destination didn't resolve — skip the heading */
    }
  }
  return out;
}

/** Extract the full document as markdown. */
export async function extractPdfMarkdown(
  doc: PDFDocumentProxy,
  title: string,
): Promise<string> {
  const pages: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: TextItem[] = (content.items as PdfJsTextItem[])
      .filter((it) => typeof it.str === "string" && it.transform)
      .map((it) => ({
        str: it.str!,
        x: it.transform![4],
        y: it.transform![5],
        w: it.width ?? 0,
        h: it.height ?? Math.abs(it.transform![3]) ?? 10,
      }));
    pages.push(pageParagraphs(items));
    page.cleanup();
  }
  return assembleDocument({ title, pages, headings: await outlineHeadings(doc) });
}
