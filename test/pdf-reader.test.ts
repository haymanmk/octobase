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

test("PDF clips remember the page region they were taken from", async () => {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  const pdf = store.createPdfCard({ title: "Paper", file: "a.pdf", pages: 3 });
  const clip = store.createImageCard({
    title: "Paper — p.2",
    sourceUrl: pdfSourceUrl(pdf.id),
    image: { file: "clip.png", w: 400, h: 300 },
    clip: { page: 2, x: 10, y: 20, w: 200, h: 150 },
  });
  const stored = store.getCard(clip.id);
  assert.equal(stored?.kind, "image");
  assert.deepEqual(
    stored?.kind === "image" ? stored.clip : undefined,
    { page: 2, x: 10, y: 20, w: 200, h: 150 },
  );
  // Web clips (no clip region) stay undefined rather than gaining a key.
  const webClip = store.createImageCard({
    title: "Web clip",
    sourceUrl: "https://example.com",
    image: { file: "w.png", w: 10, h: 10 },
  });
  assert.equal("clip" in webClip, false);
});

test("anchorFromScroll names the page and the fraction of it under the viewport middle", async () => {
  const { anchorFromScroll } = await import("../src/workspace/reader/pdf-layout.ts");
  const baseHeights = Array(10).fill(800);
  // Page 3 (index 2) spans [16 + 2*(400+16), ... + 400) at scale 0.5 = [848, 1248).
  // Put the viewport middle a quarter of the way down it.
  const mid = 848 + 0.25 * 400;
  const anchor = anchorFromScroll({
    scrollTop: mid - 300, clientHeight: 600, baseHeights, scale: 0.5, gap: 16,
  });
  assert.deepEqual(anchor, { page: 3, frac: 0.25 });
});

test("scrollTopForAnchor re-centres an anchor at a different scale", async () => {
  const { scrollTopForAnchor } = await import("../src/workspace/reader/pdf-layout.ts");
  const baseHeights = Array(10).fill(800);
  const scrollTop = scrollTopForAnchor({
    anchor: { page: 3, frac: 0.25 }, clientHeight: 600, baseHeights, scale: 1, gap: 16,
  });
  // Page 3 at scale 1 starts at 16 + 2*(800+16) = 1648.
  assert.equal(scrollTop + 600 / 2, 1648 + 0.25 * 800);
});

test("an anchor captured before a shrink survives a scale drop that clamps the scroll position", async () => {
  const { anchorFromScroll, scrollTopForAnchor, rescaledScrollTop } =
    await import("../src/workspace/reader/pdf-layout.ts");
  // The real case: 541 pages, reading the middle of page 400, pane shrunk so
  // fit-width drops the scale from 1.06 to 0.55.
  const baseHeights = Array(541).fill(792);
  const gap = 16, clientHeight = 847, prevScale = 1.06, nextScale = 0.55;
  const pageMid = (i: number, scale: number) =>
    gap + i * (792 * scale + gap) + (792 * scale) / 2;
  const scrollTop = pageMid(399, prevScale) - clientHeight / 2;

  // Captured before the pages resize, the spot comes back intact.
  const anchor = anchorFromScroll({ scrollTop, clientHeight, baseHeights, scale: prevScale, gap });
  assert.equal(anchor.page, 400);
  const restored = scrollTopForAnchor({ anchor, clientHeight, baseHeights, scale: nextScale, gap });
  assert.ok(Math.abs(restored + clientHeight / 2 - pageMid(399, nextScale)) < 1);

  // Read after the resize instead, the browser has already clamped scrollTop to
  // the shorter document — and no amount of math recovers the page from that.
  const newMax = gap + 541 * (792 * nextScale + gap) - clientHeight;
  assert.ok(newMax < scrollTop, "the shrink must actually clamp for this to be the bug");
  const fromClamped = rescaledScrollTop({
    scrollTop: newMax, clientHeight, prevScale, nextScale, baseHeights, gap,
  });
  const clampedAnchor = anchorFromScroll({
    scrollTop: fromClamped, clientHeight, baseHeights, scale: nextScale, gap,
  });
  assert.notEqual(clampedAnchor.page, 400);
});

test("rescaledScrollTop keeps the viewport middle on the same spot across a scale change", async () => {
  const { rescaledScrollTop } = await import("../src/workspace/reader/pdf-layout.ts");
  // 100 pages, 800pt tall at scale 1, 16px fixed gaps. Reader is on page 51:
  // viewport middle sits at the middle of page 51 (index 50) at scale 0.5.
  const heights = Array(100).fill(800);
  const gap = 16;
  const clientHeight = 600;
  const midOfPage50 = (i: number, scale: number) =>
    gap + 50 * (800 * scale + gap) + (800 * scale) / 2;
  const scrollTop = midOfPage50(50, 0.5) - clientHeight / 2;
  const next = rescaledScrollTop({
    scrollTop, clientHeight, prevScale: 0.5, nextScale: 1,
    baseHeights: heights, gap,
  });
  // After doubling the scale the same spot — middle of page 51 — must still
  // be under the viewport middle.
  assert.equal(next + clientHeight / 2, midOfPage50(50, 1));
});

test("rescaledScrollTop is proportional when there are no gaps", async () => {
  const { rescaledScrollTop } = await import("../src/workspace/reader/pdf-layout.ts");
  const next = rescaledScrollTop({
    scrollTop: 700, clientHeight: 600, prevScale: 1, nextScale: 2,
    baseHeights: [800, 800, 800], gap: 0,
  });
  assert.equal(next, (700 + 300) * 2 - 300);
});

test("rescaledScrollTop is the identity when the scale is unchanged", async () => {
  const { rescaledScrollTop } = await import("../src/workspace/reader/pdf-layout.ts");
  const next = rescaledScrollTop({
    scrollTop: 1234, clientHeight: 600, prevScale: 0.8, nextScale: 0.8,
    baseHeights: [800, 800, 800], gap: 16,
  });
  assert.equal(next, 1234);
});
