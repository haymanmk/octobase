import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";

async function freshStore(): Promise<WorkspaceStore> {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  return store;
}

test("init seeds a default whiteboard", async () => {
  const store = await freshStore();
  const boards = store.getWhiteboards();
  assert.equal(boards.length, 1);
  assert.ok(boards[0].name.length > 0);
});

test("createNoteOnBoard creates a card and a placement", async () => {
  const store = await freshStore();
  const board = store.getWhiteboards()[0];
  const { card, placement } = store.createNoteOnBoard(board.id, 100, 200, {
    title: "Hello",
    body: "world",
  });
  assert.equal(card.kind, "note");
  assert.equal(store.getPlacements(board.id).length, 1);
  assert.equal(placement.x, 100);
  assert.equal(placement.y, 200);
  assert.equal(store.getInboxCards().length, 0);
});

test("deleting a card soft-deletes and removes its placements", async () => {
  const store = await freshStore();
  const board = store.getWhiteboards()[0];
  const { card } = store.createNoteOnBoard(board.id, 0, 0);
  store.deleteCard(card.id);
  assert.equal(store.getCard(card.id), undefined);
  assert.equal(store.getPlacements(board.id).length, 0);
  // Soft-deleted record still present in the snapshot for sync.
  assert.ok(store.snapshot().cards.some((c) => c.id === card.id && c.deletedAt));
});

test("backlinks and outgoing links resolve via [[wikilinks]]", async () => {
  const store = await freshStore();
  const board = store.getWhiteboards()[0];
  const a = store.createNoteCard({ title: "Alpha", body: "see [[Beta]] now" });
  const b = store.createNoteCard({ title: "Beta", body: "standalone" });
  store.placeCard(board.id, a.id, 0, 0);

  const outgoing = store.getOutgoingLinks(a.id);
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].id, b.id);

  const backlinks = store.getBacklinks(b.id);
  assert.equal(backlinks.length, 1);
  assert.equal(backlinks[0].id, a.id);
});

test("unresolved links surface missing targets", async () => {
  const store = await freshStore();
  const a = store.createNoteCard({ title: "Alpha", body: "link to [[Ghost]]" });
  assert.deepEqual(store.getUnresolvedLinks(a.id), ["Ghost"]);
});

test("search ranks title over body and respects tags", async () => {
  const store = await freshStore();
  store.createNoteCard({ title: "Quantum mechanics", body: "physics" });
  store.createNoteCard({ title: "Cooking", body: "a quantum of soup", tags: ["food"] });
  const hits = store.search("quantum");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].card.title, "Quantum mechanics");

  const byTag = store.search("food");
  assert.equal(byTag[0].card.title, "Cooking");
});

test("inbox holds unplaced cards only", async () => {
  const store = await freshStore();
  const board = store.getWhiteboards()[0];
  store.createNoteCard({ title: "loose" });
  store.createNoteOnBoard(board.id, 0, 0, { title: "placed" });
  const inbox = store.getInboxCards();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].title, "loose");
});

test("createImageCard stores the clip file reference and dimensions", async () => {
  const store = await freshStore();
  const card = store.createImageCard({
    title: "Clip · example.com",
    sourceUrl: "https://example.com/page",
    image: { file: "abc.png", w: 640, h: 400 },
  });
  assert.equal(card.kind, "image");
  assert.deepEqual(card.image, { file: "abc.png", w: 640, h: 400 });
  const loaded = store.getCard(card.id);
  assert.ok(loaded && loaded.kind === "image");
  assert.equal(loaded.sourceUrl, "https://example.com/page");
  // Unplaced by default — it lands in the library.
  assert.ok(store.getInboxCards().some((c) => c.id === card.id));
});

test("data persists through the backend across reloads", async () => {
  const backend = new MemoryPersistence();
  const store = new WorkspaceStore(backend);
  await store.init({ seed: false });
  const board = store.getWhiteboards()[0];
  store.createNoteOnBoard(board.id, 5, 5, { title: "Persisted" });
  // Allow the debounced save to flush.
  await new Promise((r) => setTimeout(r, 200));

  const reopened = new WorkspaceStore(backend);
  await reopened.init({ seed: false });
  assert.ok(reopened.getCards().some((c) => c.title === "Persisted"));
});

test("highlight titles carry the full quoted text untrimmed", async () => {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  const long = "The goal of reducing sequential computation also forms the foundation of the Extended Neural GPU and ByteNet architectures.";
  const anchor = { exact: long, prefix: "", suffix: "", startHint: 0 };
  const a = store.createHighlightCard({ text: long, sourceUrl: "https://x.test", anchor });
  assert.equal(a.title, long);
  const b = store.upsertHighlight({ text: long, sourceUrl: "https://x.test", anchor });
  assert.equal(b.title, long);
});

test("legacy truncated highlight titles are restored from the anchor on load", async () => {
  const backend = new MemoryPersistence();
  const store = new WorkspaceStore(backend);
  await store.init({ seed: false });
  const long = "A quotation that was previously cut off at sixty-four characters by the old title cap.";
  const card = store.createHighlightCard({
    text: long,
    sourceUrl: "https://x.test",
    anchor: { exact: long, prefix: "", suffix: "", startHint: 0 },
  });
  // Simulate the legacy cap.
  store.updateCard(card.id, { title: long.slice(0, 64) + "…" });
  await new Promise((r) => setTimeout(r, 200));

  const reloaded = new WorkspaceStore(backend);
  await reloaded.init({ seed: false });
  assert.equal(reloaded.getCard(card.id)!.title, long);
});
