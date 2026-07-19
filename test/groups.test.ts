import assert from "node:assert/strict";
import test from "node:test";

import { groupOf, membersOf, hiddenCardIds, routeEdge } from "../src/lib/model/groups.ts";
import type { Group, Placement } from "../src/lib/model/types.ts";

function pl(cardId: string, x: number, y: number, w = 100, h = 60): Placement {
  return { id: `pl_${cardId}`, whiteboardId: "wb", cardId, x, y, w, h, z: 1 };
}

function gr(id: string, x: number, y: number, w: number, h: number, collapsed = false): Group {
  return { id, whiteboardId: "wb", name: id, x, y, w, h, collapsed };
}

test("groupOf uses the placement center, not mere overlap", () => {
  const g = gr("g1", 0, 0, 200, 200);
  // Center (50, 30) inside.
  assert.equal(groupOf(pl("in", 0, 0), [g])?.id, "g1");
  // Overlaps the frame but center (250, 30) is outside.
  assert.equal(groupOf(pl("edge", 200 - 10, 0), [g]), null);
  assert.equal(groupOf(pl("out", 500, 500), [g]), null);
});

test("groupOf prefers the smallest containing frame when frames overlap", () => {
  const big = gr("big", 0, 0, 1000, 1000);
  const small = gr("small", 0, 0, 300, 300);
  assert.equal(groupOf(pl("a", 100, 100), [big, small])?.id, "small");
  assert.equal(groupOf(pl("b", 600, 600), [big, small])?.id, "big");
});

test("membersOf returns the placements whose centers sit inside", () => {
  const g = gr("g1", 0, 0, 300, 300);
  const inside = pl("a", 50, 50);
  const outside = pl("b", 400, 50);
  assert.deepEqual(membersOf(g, [inside, outside]).map((p) => p.cardId), ["a"]);
});

test("hiddenCardIds hides members of collapsed groups only", () => {
  const open = gr("open", 0, 0, 300, 300, false);
  const shut = gr("shut", 500, 0, 300, 300, true);
  const placements = [pl("a", 50, 50), pl("b", 550, 50), pl("c", 900, 900)];
  const hidden = hiddenCardIds([open, shut], placements);
  assert.deepEqual([...hidden].sort(), ["b"]);
});

test("routeEdge sends a hidden endpoint to its collapsed group's chip", () => {
  const shut = gr("shut", 0, 0, 300, 300, true);
  const placements = [pl("in", 50, 50), pl("out", 900, 50)];
  const r = routeEdge("out", "in", [shut], placements);
  assert.equal(r.fromChip, null);
  assert.equal(r.toChip?.id, "shut");
  assert.equal(r.hidden, false);
});

test("routeEdge leaves edges between visible cards untouched", () => {
  const open = gr("open", 0, 0, 300, 300, false);
  const placements = [pl("a", 50, 50), pl("b", 900, 50)];
  const r = routeEdge("a", "b", [open], placements);
  assert.equal(r.fromChip, null);
  assert.equal(r.toChip, null);
  assert.equal(r.hidden, false);
});

test("routeEdge hides an edge whose both ends live in the same collapsed group", () => {
  const shut = gr("shut", 0, 0, 300, 300, true);
  const placements = [pl("a", 20, 20), pl("b", 150, 150)];
  const r = routeEdge("a", "b", [shut], placements);
  assert.equal(r.hidden, true);
});

test("routeEdge draws chip-to-chip between two different collapsed groups", () => {
  const g1 = gr("g1", 0, 0, 300, 300, true);
  const g2 = gr("g2", 500, 0, 300, 300, true);
  const r = routeEdge("a", "b", [g1, g2], [pl("a", 20, 20), pl("b", 520, 20)]);
  assert.equal(r.fromChip?.id, "g1");
  assert.equal(r.toChip?.id, "g2");
  assert.equal(r.hidden, false);
});

test("a card overlapped by a collapsed frame it is not a member of stays visible", () => {
  // Card center inside a small OPEN frame that itself sits inside a big
  // collapsed frame's bounds: smallest-area membership keeps it visible.
  const bigShut = gr("bigShut", 0, 0, 1000, 1000, true);
  const smallOpen = gr("smallOpen", 0, 0, 300, 300, false);
  const hidden = hiddenCardIds([bigShut, smallOpen], [pl("a", 50, 50)]);
  assert.deepEqual([...hidden], []);
});
