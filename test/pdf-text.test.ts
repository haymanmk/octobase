import assert from "node:assert/strict";
import test from "node:test";

import { pageParagraphs, assembleDocument } from "../src/workspace/reader/pdf-text.ts";

// Simplified pdf.js text items: x/y are PDF-space (y grows upward), h is the
// font height, w the rendered width.
const item = (str: string, x: number, y: number, w = str.length * 5, h = 10) =>
  ({ str, x, y, w, h });

test("items on one baseline become one line in x order", () => {
  const paras = pageParagraphs([
    item("world", 40, 700),
    item("hello", 10, 700),
  ]);
  assert.deepEqual(paras, ["hello world"]);
});

test("mid-word splits join without a space; gapped items get one", () => {
  // "Sev" ends at x=25; "eral" starts at 25 → same word.
  // "events" starts far after "eral" ends → word boundary.
  const paras = pageParagraphs([
    item("Sev", 10, 700, 15),
    item("eral", 25, 700, 20),
    item("events", 60, 700, 30),
  ]);
  assert.deepEqual(paras, ["Several events"]);
});

test("consecutive lines with normal leading join into one paragraph", () => {
  const paras = pageParagraphs([
    item("first line", 10, 700),
    item("second line", 10, 688),
    item("third line", 10, 676),
  ]);
  assert.deepEqual(paras, ["first line second line third line"]);
});

test("a large vertical gap starts a new paragraph", () => {
  const paras = pageParagraphs([
    item("intro paragraph", 10, 700),
    item("still intro", 10, 688),
    item("new paragraph", 10, 640),
  ]);
  assert.deepEqual(paras, ["intro paragraph still intro", "new paragraph"]);
});

test("hyphenated line endings re-join the split word", () => {
  const paras = pageParagraphs([
    item("this is naviga-", 10, 700),
    item("tion in progress", 10, 688),
  ]);
  assert.deepEqual(paras, ["this is navigation in progress"]);
});

test("empty and whitespace-only pages yield no paragraphs", () => {
  assert.deepEqual(pageParagraphs([]), []);
  assert.deepEqual(pageParagraphs([item("  ", 10, 700)]), []);
});

test("two-column pages read left column first, then right", () => {
  // Left column at x≈10..100, right at x≈150..240 — a clear gutter between.
  const paras = pageParagraphs([
    item("left one", 10, 700, 90),
    item("right one", 150, 700, 90),
    item("left two", 10, 688, 90),
    item("right two", 150, 688, 90),
  ]);
  assert.deepEqual(paras, ["left one left two", "right one right two"]);
});

test("full-width lines (titles) stay in place above the columns", () => {
  const paras = pageParagraphs([
    item("Spanning Paper Title", 10, 720, 230),
    item("left one", 10, 700, 90),
    item("right one", 150, 700, 90),
    item("left two", 10, 688, 90),
    item("right two", 150, 688, 90),
  ]);
  assert.equal(paras[0], "Spanning Paper Title");
  assert.deepEqual(paras.slice(1), ["left one left two", "right one right two"]);
});

test("single-column pages are unaffected by column logic", () => {
  const paras = pageParagraphs([
    item("a full width line of text here", 10, 700, 230),
    item("and another full width line too", 10, 688, 230),
  ]);
  assert.deepEqual(paras, ["a full width line of text here and another full width line too"]);
});

test("assembleDocument emits title, page markers, and outline headings", () => {
  const md = assembleDocument({
    title: "The Extended Mind",
    pages: [
      ["Where does the mind stop?"],
      ["Active externalism begins here.", "The notebook plays the role of memory."],
      [],
    ],
    headings: [
      { title: "Introduction", depth: 0, page: 1 },
      { title: "Active externalism", depth: 0, page: 2 },
      { title: "The notebook", depth: 1, page: 2 },
    ],
  });
  assert.match(md, /^# The Extended Mind\n/);
  // Page markers in order, headings placed at their page, depth → heading level.
  assert.ok(md.indexOf("[page 1]") < md.indexOf("## Introduction"));
  assert.ok(md.indexOf("## Introduction") < md.indexOf("Where does the mind stop?"));
  assert.ok(md.indexOf("[page 2]") < md.indexOf("## Active externalism"));
  assert.match(md, /### The notebook/);
  // Text-less page is marked so agents know it isn't silently missing.
  assert.match(md, /\[page 3 — no text layer\]/);
});
