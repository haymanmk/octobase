import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
// @ts-expect-error - turndown-plugin-gfm ships no types
import { gfm } from "turndown-plugin-gfm";

export interface ExtractedArticle {
  title: string;
  byline: string;
  siteName: string;
  /** Clean article content as markdown. */
  markdown: string;
  /** Short plain-text excerpt. */
  excerpt: string;
  /** Full plain text of the article body — the anchoring substrate. */
  textContent: string;
}

let _turndown: TurndownService | null = null;
function turndown(): TurndownService {
  if (_turndown) return _turndown;
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.use(gfm);
  // Drop noise that Readability sometimes leaves behind.
  td.remove(["script", "style", "noscript", "iframe"]);
  _turndown = td;
  return td;
}

/**
 * Extract the readable article from a DOM Document and convert it to markdown.
 * Works in any DOM context — a browser tab (extension / Electron view) or a
 * linkedom-parsed document in Node tests.
 *
 * Readability mutates the document, so callers should pass a clone when they
 * still need the original (e.g. `document.cloneNode(true)` in a live tab).
 */
export function extractArticle(
  doc: Document,
  opts: { url?: string } = {},
): ExtractedArticle | null {
  const reader = new Readability(doc, { charThreshold: 200 });
  const article = reader.parse();
  if (!article || !article.content) return null;

  // Convert the extracted HTML to markdown via a real node (no DOMParser dep),
  // so this path is identical in the browser and under linkedom.
  const holder = doc.createElement("div");
  holder.innerHTML = article.content;
  const markdown = turndown().turndown(holder).trim();

  return {
    title: (article.title || "Untitled").trim(),
    byline: (article.byline || "").trim(),
    siteName: (article.siteName || siteNameFromUrl(opts.url)).trim(),
    markdown,
    excerpt: (article.excerpt || "").trim(),
    textContent: (article.textContent || "").replace(/\s+\n/g, "\n").trim(),
  };
}

function siteNameFromUrl(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
