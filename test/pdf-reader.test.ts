import assert from "node:assert/strict";
import test from "node:test";

import { findHits, stepHit } from "../src/workspace/reader/pdf-search.ts";
import { flattenOutline } from "../src/workspace/reader/pdf-outline.ts";
import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";
import { pdfSourceUrl } from "../src/lib/model/types.ts";

test("findHits returns every match, ordered by page then offset", () => {
  const pages = ["the cat sat on the mat", "no felines here", "cat and cat"];
  const hits = findHits(pages, "cat");
  assert.deepEqual(hits, [
    { page: 1, index: 4, length: 3 },
    { page: 3, index: 0, length: 3 },
    { page: 3, index: 8, length: 3 },
  ]);
});

test("findHits is case-insensitive and ignores empty queries", () => {
  assert.equal(findHits(["Foo FOO foo"], "foo").length, 3);
  assert.deepEqual(findHits(["anything"], "   "), []);
});

test("stepHit wraps forward and backward, -1 when empty", () => {
  assert.equal(stepHit(3, 0, 1), 1);
  assert.equal(stepHit(3, 2, 1), 0); // wrap
  assert.equal(stepHit(3, 0, -1), 2); // wrap back
  assert.equal(stepHit(0, -1, 1), -1);
});

test("flattenOutline indents a nested bookmark tree depth-first", () => {
  const flat = flattenOutline([
    { title: "Ch 1", dest: "d1", items: [
      { title: "1.1", dest: "d1a" },
      { title: "1.2", dest: "d1b" },
    ] },
    { title: "Ch 2", dest: "d2" },
  ]);
  assert.deepEqual(flat.map((f) => [f.title, f.depth]), [
    ["Ch 1", 0], ["1.1", 1], ["1.2", 1], ["Ch 2", 0],
  ]);
});

test("flattenOutline tolerates a missing outline", () => {
  assert.deepEqual(flattenOutline(null), []);
  assert.deepEqual(flattenOutline(undefined), []);
});

test("createPdfCard stores the file reference and page count", async () => {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  const card = store.createPdfCard({ title: "Paper", file: "abc.pdf", pages: 12 });
  assert.equal(card.kind, "pdf");
  assert.equal(card.file, "abc.pdf");
  assert.equal(card.pages, 12);
  assert.equal(store.getCard(card.id)?.kind, "pdf");
});

test("PDF highlights carry a page and share the pdf: source key", async () => {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  const pdf = store.createPdfCard({ title: "Paper", file: "a.pdf", pages: 3 });
  const src = pdfSourceUrl(pdf.id);
  const hl = store.createHighlightCard({
    text: "an important claim",
    sourceUrl: src,
    anchor: { exact: "an important claim", prefix: "", suffix: "", startHint: 0 },
    color: "pink",
    page: 2,
  });
  assert.equal(hl.page, 2);
  assert.equal(hl.sourceUrl, src);
  assert.deepEqual(store.getHighlightsForUrl(src).map((h) => h.id), [hl.id]);
});
