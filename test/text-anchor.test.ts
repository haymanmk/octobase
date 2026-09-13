import assert from "node:assert/strict";
import test from "node:test";

import {
  describeAnchor,
  locateAnchor,
} from "../src/lib/anchor/text-anchor.ts";

const TEXT =
  "The quick brown fox jumps over the lazy dog. " +
  "Pack my box with five dozen liquor jugs. " +
  "How vexingly quick daft zebras jump.";

test("describeAnchor captures exact text with bounded context", () => {
  const start = TEXT.indexOf("brown fox");
  const anchor = describeAnchor(TEXT, start, start + "brown fox".length);
  assert.equal(anchor.exact, "brown fox");
  assert.ok(anchor.prefix.endsWith("quick "));
  assert.ok(anchor.suffix.startsWith(" jumps"));
  assert.equal(anchor.startHint, start);
});

test("locateAnchor finds the exact slice in unchanged text", () => {
  const start = TEXT.indexOf("five dozen");
  const anchor = describeAnchor(TEXT, start, start + "five dozen".length);
  const found = locateAnchor(TEXT, anchor);
  assert.deepEqual(found, { start, end: start + "five dozen".length });
});

test("locateAnchor disambiguates repeated text via context", () => {
  const doc = "alpha target beta. gamma target delta.";
  const second = doc.lastIndexOf("target");
  const anchor = describeAnchor(doc, second, second + "target".length);
  // Prepend content so offsets shift; context must still pick the gamma one.
  const shifted = "PREFIX PADDING. " + doc;
  const found = locateAnchor(shifted, anchor);
  assert.ok(found);
  assert.equal(shifted.slice(found!.start, found!.end), "target");
  assert.ok(shifted.slice(0, found!.start).includes("gamma"));
});

test("locateAnchor survives small edits via fuzzy fallback", () => {
  const start = TEXT.indexOf("lazy dog");
  const anchor = describeAnchor(TEXT, start, start + "lazy dog".length);
  // Mutate one character inside the exact run.
  const edited = TEXT.replace("lazy dog", "lazy dop");
  const found = locateAnchor(edited, anchor);
  assert.ok(found, "expected a fuzzy match");
  assert.ok(edited.slice(found!.start, found!.end).startsWith("lazy do"));
});

test("locateAnchor returns null when text is unrelated", () => {
  const start = TEXT.indexOf("brown fox");
  const anchor = describeAnchor(TEXT, start, start + "brown fox".length);
  assert.equal(locateAnchor("completely different content here", anchor), null);
});

test("noteDotBands marks the last band of each noted highlight only", async () => {
  const { noteDotBands } = await import("../src/workspace/reader/highlight-overlay.ts");
  const band = (cardId: string, x: number, y: number) =>
    ({ cardId, color: "yellow" as const, x, y, w: 50, h: 12 });
  // "a" wraps across three lines, "b" has no note, "c" is a single band.
  const bands = [band("a", 10, 0), band("a", 0, 20), band("b", 0, 40), band("c", 0, 60), band("a", 0, 10)];
  const dots = noteDotBands(bands, (id) => id !== "b");
  assert.deepEqual([...dots.entries()].sort(), [["a", 1], ["c", 3]]);
});
