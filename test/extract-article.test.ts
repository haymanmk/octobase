import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

import { extractArticle } from "../src/lib/extract/extract-article.ts";

function docFrom(html: string): Document {
  const { document } = parseHTML(html);
  return document as unknown as Document;
}

const ARTICLE_HTML = `<!doctype html><html><head>
  <title>The Art of Anchoring</title>
  <meta name="author" content="Ada Lovelace">
</head><body>
  <nav>home about contact</nav>
  <header><h1>site banner</h1></header>
  <article>
    <h1>The Art of Anchoring</h1>
    <p>Durable highlights survive page changes by storing surrounding context.</p>
    <h2>How it works</h2>
    <p>We keep a <strong>prefix</strong>, the <em>exact</em> quote, and a suffix.</p>
    <ul><li>Quote match</li><li>Context disambiguation</li><li>Fuzzy fallback</li></ul>
    <blockquote>Context is the anchor's anchor.</blockquote>
  </article>
  <footer>copyright 2026</footer>
</body></html>`;

test("extractArticle pulls title, byline and markdown body", () => {
  const result = extractArticle(docFrom(ARTICLE_HTML), {
    url: "https://example.com/art-of-anchoring",
  });
  assert.ok(result, "expected an article");
  assert.equal(result!.title, "The Art of Anchoring");
  assert.match(result!.byline, /Ada Lovelace/);
  assert.equal(result!.siteName, "example.com");
});

test("extractArticle converts headings, emphasis and lists to markdown", () => {
  const result = extractArticle(docFrom(ARTICLE_HTML))!;
  assert.match(result.markdown, /## How it works/);
  assert.match(result.markdown, /\*\*prefix\*\*/);
  assert.match(result.markdown, /\*exact\*/);
  assert.match(result.markdown, /-\s+Quote match/);
  assert.match(result.markdown, /> Context is the anchor/);
});

test("extractArticle strips nav/footer chrome from the body", () => {
  const result = extractArticle(docFrom(ARTICLE_HTML))!;
  assert.doesNotMatch(result.markdown, /home about contact/);
  assert.doesNotMatch(result.markdown, /copyright 2026/);
  assert.ok(result.textContent.includes("Durable highlights"));
});

test("extractArticle returns null for content-free pages", () => {
  const result = extractArticle(docFrom("<html><body><div></div></body></html>"));
  assert.equal(result, null);
});
