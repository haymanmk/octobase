import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";
import { applyHighlightDrop } from "../src/workspace/drop-highlight.ts";

// Exercises the contract main.js relies on: a highlight dragged out of the
// browser pane and dropped on the whiteboard becomes a placed highlight card
// (minus the Electron IPC hop, which only forwards).

const payload = {
  highlightId: "hl-123-abc",
  text: "information lies beyond the skin",
  sourceUrl: "https://example.com/extended-mind",
  color: "pink",
  tags: ["philosophy"],
  notes: "core claim",
  x: 400,
  y: 300,
} as const;

async function makeStore() {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  const board = store.createWhiteboard("Board");
  return { store, boardId: board.id };
}

test("drop on the canvas creates a highlight card placed at the drop point", async () => {
  const { store, boardId } = await makeStore();

  const card = applyHighlightDrop(store, payload, { boardId, wx: 120, wy: 80 });

  assert.equal(card.kind, "highlight");
  assert.equal(card.id, payload.highlightId); // stable id — owned by the page highlighter
  assert.equal(card.sourceUrl, payload.sourceUrl);
  assert.equal(card.color, "pink");
  assert.deepEqual(card.tags, ["philosophy"]);
  assert.match(card.body, /information lies beyond the skin/);
  assert.match(card.body, /core claim/);
  assert.equal(card.anchor.exact, payload.text);

  const placements = store.getPlacements(boardId);
  assert.equal(placements.length, 1);
  assert.equal(placements[0].cardId, card.id);
  assert.equal(placements[0].x, 120);
  assert.equal(placements[0].y, 80);
});

test("re-dropping the same highlight moves its placement instead of duplicating", async () => {
  const { store, boardId } = await makeStore();

  applyHighlightDrop(store, payload, { boardId, wx: 120, wy: 80 });
  applyHighlightDrop(store, payload, { boardId, wx: 500, wy: 420 });

  const cards = store.getCards().filter((c) => c.kind === "highlight");
  assert.equal(cards.length, 1);
  const placements = store.getPlacements(boardId);
  assert.equal(placements.length, 1);
  assert.equal(placements[0].x, 500);
  assert.equal(placements[0].y, 420);
});

test("drop outside the canvas lands in the inbox with no placement", async () => {
  const { store, boardId } = await makeStore();

  const card = applyHighlightDrop(store, payload, null);

  assert.equal(store.getPlacements(boardId).length, 0);
  assert.ok(store.getInboxCards().some((c) => c.id === card.id));
});

test("missing optional fields fall back to defaults", async () => {
  const { store, boardId } = await makeStore();

  const card = applyHighlightDrop(
    store,
    { highlightId: "hl-9", text: "bare text", sourceUrl: "https://a.b", x: 0, y: 0 },
    { boardId, wx: 10, wy: 10 },
  );

  assert.equal(card.color, "yellow");
  assert.deepEqual(card.tags, []);
  assert.match(card.body, /bare text/);
});
