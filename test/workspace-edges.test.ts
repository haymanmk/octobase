import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";
import type { WorkspaceData } from "../src/lib/model/types.ts";

/** A board with two placed cards — the minimal edge fixture. */
async function boardWithTwoCards() {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  const board = store.getWhiteboards()[0];
  const { card: a } = store.createNoteOnBoard(board.id, 0, 0, { title: "A" });
  const { card: b } = store.createNoteOnBoard(board.id, 400, 0, { title: "B" });
  return { store, board, a, b };
}

test("createEdge connects two cards on a board", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const edge = store.createEdge(board.id, a.id, b.id);
  assert.equal(edge.fromCardId, a.id);
  assert.equal(edge.toCardId, b.id);
  assert.equal(edge.directed, true);
  assert.equal(edge.label, "");
  const edges = store.getEdges(board.id);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].id, edge.id);
});

test("createEdge dedupes same from→to pair and rejects self-edges", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const first = store.createEdge(board.id, a.id, b.id);
  const dup = store.createEdge(board.id, a.id, b.id);
  assert.equal(dup.id, first.id);
  assert.equal(store.getEdges(board.id).length, 1);
  // Opposite direction is a distinct edge.
  store.createEdge(board.id, b.id, a.id);
  assert.equal(store.getEdges(board.id).length, 2);
  assert.throws(() => store.createEdge(board.id, a.id, a.id));
});

test("updateEdge sets label, direction flag, and flips endpoints", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const edge = store.createEdge(board.id, a.id, b.id);
  store.updateEdge(edge.id, { label: "supports", directed: false });
  let e = store.getEdges(board.id)[0];
  assert.equal(e.label, "supports");
  assert.equal(e.directed, false);
  store.updateEdge(edge.id, { fromSide: "bottom", toSide: "left" });
  store.flipEdge(edge.id);
  e = store.getEdges(board.id)[0];
  assert.equal(e.fromCardId, b.id);
  assert.equal(e.toCardId, a.id);
  // Pinned anchors travel with their card when the direction flips.
  assert.equal(e.fromSide, "left");
  assert.equal(e.toSide, "bottom");
});

test("createEdge pins the sides the user drew from and to", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const edge = store.createEdge(board.id, a.id, b.id, { fromSide: "bottom", toSide: "top" });
  assert.equal(edge.fromSide, "bottom");
  assert.equal(edge.toSide, "top");
  // Legacy/optionless edges stay auto-routed.
  const { card: c } = store.createNoteOnBoard(board.id, 0, 400, { title: "C" });
  const auto = store.createEdge(board.id, a.id, c.id);
  assert.equal(auto.fromSide, null);
  assert.equal(auto.toSide, null);
});

test("reconnectEdge can re-pin a side on the same card", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const edge = store.createEdge(board.id, a.id, b.id, { fromSide: "right", toSide: "left" });
  // Same card, different dot: allowed — that's how you move the anchor.
  assert.equal(store.reconnectEdge(edge.id, "to", b.id, "bottom"), true);
  const e = store.getEdges(board.id)[0];
  assert.equal(e.toCardId, b.id);
  assert.equal(e.toSide, "bottom");
  // Same card, same dot: nothing to do.
  assert.equal(store.reconnectEdge(edge.id, "to", b.id, "bottom"), false);
});

test("reconnectEdge moves one endpoint to another card", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const { card: c } = store.createNoteOnBoard(board.id, 0, 400, { title: "C" });
  const edge = store.createEdge(board.id, a.id, b.id);

  assert.equal(store.reconnectEdge(edge.id, "to", c.id), true);
  let e = store.getEdges(board.id)[0];
  assert.equal(e.fromCardId, a.id);
  assert.equal(e.toCardId, c.id);

  assert.equal(store.reconnectEdge(edge.id, "from", b.id), true);
  e = store.getEdges(board.id)[0];
  assert.equal(e.fromCardId, b.id);
  assert.equal(e.toCardId, c.id);
});

test("reconnectEdge refuses self-loops, duplicates, and unknown edges", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const { card: c } = store.createNoteOnBoard(board.id, 0, 400, { title: "C" });
  const edge = store.createEdge(board.id, a.id, b.id);
  store.createEdge(board.id, a.id, c.id);

  // Would become a self-loop.
  assert.equal(store.reconnectEdge(edge.id, "to", a.id), false);
  // Would duplicate the existing a→c edge.
  assert.equal(store.reconnectEdge(edge.id, "to", c.id), false);
  // Unknown edge / unknown card.
  assert.equal(store.reconnectEdge("ed_missing", "to", c.id), false);
  assert.equal(store.reconnectEdge(edge.id, "to", "card_missing"), false);
  // Reconnecting to where it already points is a harmless no-op.
  assert.equal(store.reconnectEdge(edge.id, "to", b.id), false);
  const e = store.getEdges(board.id).find((x) => x.id === edge.id)!;
  assert.equal(e.fromCardId, a.id);
  assert.equal(e.toCardId, b.id);
});

test("deleteEdge removes the edge", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const edge = store.createEdge(board.id, a.id, b.id);
  store.deleteEdge(edge.id);
  assert.equal(store.getEdges(board.id).length, 0);
});

test("removing a placement drops that card's edges on that board only", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const other = store.createWhiteboard("Other");
  store.placeCard(other.id, a.id, 0, 0);
  store.placeCard(other.id, b.id, 400, 0);
  store.createEdge(board.id, a.id, b.id);
  store.createEdge(other.id, a.id, b.id);

  const pl = store.getPlacements(board.id).find((p) => p.cardId === a.id)!;
  store.removePlacement(pl.id);
  assert.equal(store.getEdges(board.id).length, 0);
  assert.equal(store.getEdges(other.id).length, 1);
});

test("deleting a card drops its edges on every board", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  const other = store.createWhiteboard("Other");
  store.placeCard(other.id, a.id, 0, 0);
  store.placeCard(other.id, b.id, 400, 0);
  store.createEdge(board.id, a.id, b.id);
  store.createEdge(other.id, b.id, a.id);

  store.deleteCard(a.id);
  assert.equal(store.getEdges(board.id).length, 0);
  assert.equal(store.getEdges(other.id).length, 0);
});

test("deleting a whiteboard drops its edges", async () => {
  const { store, board, a, b } = await boardWithTwoCards();
  store.createEdge(board.id, a.id, b.id);
  store.deleteWhiteboard(board.id);
  assert.equal(store.getEdges(board.id).length, 0);
});

test("edges survive a persistence round-trip", async () => {
  const backend = new MemoryPersistence();
  const store = new WorkspaceStore(backend);
  await store.init({ seed: false });
  const board = store.getWhiteboards()[0];
  const { card: a } = store.createNoteOnBoard(board.id, 0, 0, { title: "A" });
  const { card: b } = store.createNoteOnBoard(board.id, 400, 0, { title: "B" });
  store.createEdge(board.id, a.id, b.id);
  await new Promise((r) => setTimeout(r, 200)); // debounced save

  const reopened = new WorkspaceStore(backend);
  await reopened.init({ seed: false });
  assert.equal(reopened.getEdges(board.id).length, 1);
});

test("legacy data without an edges field loads and defaults to none", async () => {
  const legacy = {
    version: 1,
    cards: [],
    whiteboards: [
      { id: "wb_x", name: "Old", createdAt: 1, updatedAt: 1, deletedAt: null },
    ],
    placements: [],
  } as unknown as WorkspaceData;
  const store = new WorkspaceStore(new MemoryPersistence(legacy));
  await store.init({ seed: false });
  assert.deepEqual(store.getEdges("wb_x"), []);
});
