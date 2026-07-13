import assert from "node:assert/strict";
import test from "node:test";

import {
  sideMidpoint,
  nearestAnchors,
  nearestSide,
  edgePath,
  previewPath,
} from "../src/workspace/edge-geometry.ts";

const A = { x: 0, y: 0, w: 200, h: 100 };

test("sideMidpoint returns the middle of each rect side", () => {
  assert.deepEqual(sideMidpoint(A, "top"), { x: 100, y: 0 });
  assert.deepEqual(sideMidpoint(A, "right"), { x: 200, y: 50 });
  assert.deepEqual(sideMidpoint(A, "bottom"), { x: 100, y: 100 });
  assert.deepEqual(sideMidpoint(A, "left"), { x: 0, y: 50 });
});

test("nearestAnchors picks facing sides for horizontal neighbors", () => {
  const B = { x: 500, y: 0, w: 200, h: 100 };
  const { from, to } = nearestAnchors(A, B);
  assert.equal(from.side, "right");
  assert.equal(to.side, "left");
});

test("nearestAnchors picks facing sides for vertical neighbors", () => {
  const B = { x: 0, y: 400, w: 200, h: 100 };
  const { from, to } = nearestAnchors(A, B);
  assert.equal(from.side, "bottom");
  assert.equal(to.side, "top");
});

test("edgePath yields a cubic bezier with a midpoint between the anchors", () => {
  const B = { x: 500, y: 300, w: 200, h: 100 };
  const { d, mid, from, to } = edgePath(A, B);
  assert.match(d, /^M [\d.-]+ [\d.-]+ C /);
  // The label midpoint sits inside the bounding box spanned by the anchors.
  assert.ok(mid.x > Math.min(from.x, to.x) && mid.x < Math.max(from.x, to.x));
  assert.ok(mid.y >= Math.min(from.y, to.y) && mid.y <= Math.max(from.y, to.y));
});

test("edgePath honors pinned sides on both ends", () => {
  const B = { x: 500, y: 0, w: 200, h: 100 };
  // User drew bottom→top even though right→left is nearer: keep their dots.
  const { from, to } = edgePath(A, B, "bottom", "top");
  assert.deepEqual({ x: from.x, y: from.y, side: from.side }, { x: 100, y: 100, side: "bottom" });
  assert.deepEqual({ x: to.x, y: to.y, side: to.side }, { x: 600, y: 0, side: "top" });
});

test("edgePath with one pinned side routes the free end nearest to it", () => {
  const B = { x: 500, y: 0, w: 200, h: 100 };
  const { from, to } = edgePath(A, B, "bottom", null);
  assert.equal(from.side, "bottom");
  // Free end picks whichever of B's dots is closest to A's bottom anchor.
  assert.equal(to.side, "left");
});

test("edgePath without pins keeps the auto nearest-sides routing", () => {
  const B = { x: 500, y: 0, w: 200, h: 100 };
  const { from, to } = edgePath(A, B);
  assert.equal(from.side, "right");
  assert.equal(to.side, "left");
});

test("nearestSide finds the side dot closest to a point", () => {
  assert.equal(nearestSide(A, { x: 100, y: 130 }), "bottom");
  assert.equal(nearestSide(A, { x: -20, y: 50 }), "left");
  assert.equal(nearestSide(A, { x: 195, y: 45 }), "right");
});

test("previewPath curves from a fixed side anchor to a free point", () => {
  const d = previewPath({ x: 200, y: 50, side: "right" }, { x: 400, y: 200 });
  assert.match(d, /^M 200 50 C /);
  assert.match(d, / 400 200$/);
});
