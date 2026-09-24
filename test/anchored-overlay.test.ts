import assert from "node:assert/strict";
import test from "node:test";

import { hitPlacement, badgeAnchorPoint } from "../src/components/highlighter/anchored-overlay.ts";

test("hitPlacement finds the highlight covering a text offset", () => {
  const placements = [
    { index: 0, start: 10, end: 20 },
    { index: 1, start: 40, end: 60 },
  ];
  assert.equal(hitPlacement(placements, 10)?.index, 0);
  assert.equal(hitPlacement(placements, 19)?.index, 0);
  assert.equal(hitPlacement(placements, 20), null); // end is exclusive
  assert.equal(hitPlacement(placements, 55)?.index, 1);
  assert.equal(hitPlacement(placements, 5), null);
});

test("hitPlacement prefers the innermost of two overlapping highlights", () => {
  // A short highlight sitting inside a longer one: the click means the short.
  const placements = [
    { index: 0, start: 0, end: 100 },
    { index: 1, start: 40, end: 50 },
  ];
  assert.equal(hitPlacement(placements, 45)?.index, 1);
  assert.equal(hitPlacement(placements, 80)?.index, 0);
});

test("badgeAnchorPoint picks the upper-left of the first visual line", () => {
  // Two line boxes for one wrapped highlight; the badge belongs to the upper.
  const rects = [
    { left: 100, top: 10, right: 300, bottom: 24, width: 200, height: 14 },
    { left: 20, top: 30, right: 180, bottom: 44, width: 160, height: 14 },
  ] as DOMRect[];
  assert.deepEqual(badgeAnchorPoint(rects), { x: 100, y: 10 });
});

test("badgeAnchorPoint uses the first inline box at the start of the range", () => {
  // An inline <code> chip early in the line has a taller box than the plain
  // text after it; the badge belongs at the start of the highlight.
  const rects = [
    { left: 20, top: 8, right: 120, bottom: 30, width: 100, height: 22 },
    { left: 120, top: 12, right: 400, bottom: 28, width: 280, height: 16 },
  ] as DOMRect[];
  assert.deepEqual(badgeAnchorPoint(rects), { x: 20, y: 8 });
});

test("badgeAnchorPoint ignores zero-size rects and returns null when there are none", () => {
  const rects = [{ left: 5, top: 5, right: 5, bottom: 5, width: 0, height: 0 }] as DOMRect[];
  assert.equal(badgeAnchorPoint(rects), null);
  assert.equal(badgeAnchorPoint([]), null);
});

test("bandRectsFor strokes the middle half of each line box, like the readers", async () => {
  const { bandRectsFor } = await import("../src/components/highlighter/anchored-overlay.ts");
  const rects = [
    { left: 10, top: 100, right: 210, bottom: 120, width: 200, height: 20 },
    { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, // collapsed, skipped
  ] as DOMRect[];
  assert.deepEqual(bandRectsFor(rects), [{ x: 10, y: 105, w: 200, h: 10 }]);
});
