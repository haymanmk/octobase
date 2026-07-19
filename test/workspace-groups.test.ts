import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";
import type { WorkspaceData } from "../src/lib/model/types.ts";

async function freshStore(): Promise<{ store: WorkspaceStore; boardId: string }> {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  return { store, boardId: store.getWhiteboards()[0].id };
}

test("createGroup stores name, bounds, and expanded state on the board", async () => {
  const { store, boardId } = await freshStore();
  const g = store.createGroup(boardId, { name: "Research", x: 100, y: 80, w: 400, h: 300 });
  assert.equal(g.name, "Research");
  assert.equal(g.collapsed, false);
  assert.deepEqual(store.getGroups(boardId).map((x) => x.id), [g.id]);
  // Scoped to its board.
  const other = store.createWhiteboard("Other");
  assert.deepEqual(store.getGroups(other.id), []);
});

test("updateGroup renames, moves bounds, and toggles collapse", async () => {
  const { store, boardId } = await freshStore();
  const g = store.createGroup(boardId, { name: "A", x: 0, y: 0, w: 100, h: 100 });
  store.updateGroup(g.id, { name: "B", collapsed: true, w: 240 });
  const got = store.getGroups(boardId)[0];
  assert.equal(got.name, "B");
  assert.equal(got.collapsed, true);
  assert.equal(got.w, 240);
});

test("deleteGroup removes the group but leaves cards and placements alone", async () => {
  const { store, boardId } = await freshStore();
  const card = store.createNoteCard({ title: "Kept" });
  store.placeCard(boardId, card.id, 10, 10);
  const g = store.createGroup(boardId, { name: "Doomed", x: 0, y: 0, w: 200, h: 200 });
  store.deleteGroup(g.id);
  assert.deepEqual(store.getGroups(boardId), []);
  assert.equal(store.getPlacements(boardId).length, 1);
  assert.ok(store.getCard(card.id));
});

test("documents saved before groups existed load with an empty group list", async () => {
  const legacy = {
    version: 1,
    cards: [],
    whiteboards: [{ id: "wb_x", name: "Old", createdAt: 1, updatedAt: 1, deletedAt: null }],
    placements: [],
    edges: [],
  } as unknown as WorkspaceData; // deliberately missing `groups`
  const store = new WorkspaceStore(new MemoryPersistence(legacy));
  await store.init({ seed: false });
  assert.deepEqual(store.getGroups("wb_x"), []);
  const g = store.createGroup("wb_x", { name: "New", x: 0, y: 0, w: 50, h: 50 });
  assert.equal(store.getGroups("wb_x")[0].id, g.id);
});

test("deleting a whiteboard removes its groups", async () => {
  const { store, boardId } = await freshStore();
  const other = store.createWhiteboard("Keep");
  store.createGroup(boardId, { name: "Gone", x: 0, y: 0, w: 10, h: 10 });
  const kept = store.createGroup(other.id, { name: "Stays", x: 0, y: 0, w: 10, h: 10 });
  store.deleteWhiteboard(boardId);
  assert.deepEqual(store.getGroups(boardId), []);
  assert.deepEqual(store.getGroups(other.id).map((g) => g.id), [kept.id]);
});

test("moveGroup shifts the frame and its member placements together", async () => {
  const { store, boardId } = await freshStore();
  const inCard = store.createNoteCard({ title: "In" });
  const outCard = store.createNoteCard({ title: "Out" });
  store.placeCard(boardId, inCard.id, 50, 50, 100, 60);
  store.placeCard(boardId, outCard.id, 900, 900, 100, 60);
  const g = store.createGroup(boardId, { name: "G", x: 0, y: 0, w: 300, h: 300 });

  store.moveGroup(g.id, 20, -10);

  const got = store.getGroups(boardId)[0];
  assert.deepEqual([got.x, got.y], [20, -10]);
  const byCard = new Map(store.getPlacements(boardId).map((p) => [p.cardId, p]));
  assert.deepEqual([byCard.get(inCard.id)!.x, byCard.get(inCard.id)!.y], [70, 40]);
  assert.deepEqual([byCard.get(outCard.id)!.x, byCard.get(outCard.id)!.y], [900, 900]);
});

test("moveGroup while collapsed still carries the hidden members", async () => {
  const { store, boardId } = await freshStore();
  const card = store.createNoteCard({ title: "Hidden" });
  store.placeCard(boardId, card.id, 10, 10, 100, 60);
  const g = store.createGroup(boardId, { name: "G", x: 0, y: 0, w: 300, h: 300 });
  store.updateGroup(g.id, { collapsed: true });

  store.moveGroup(g.id, 100, 100);

  const p = store.getPlacements(boardId).find((x) => x.cardId === card.id)!;
  assert.deepEqual([p.x, p.y], [110, 110]);
});

test("groups persist through the backend across reloads", async () => {
  const backend = new MemoryPersistence();
  const store = new WorkspaceStore(backend);
  await store.init({ seed: false });
  const boardId = store.getWhiteboards()[0].id;
  store.createGroup(boardId, { name: "Durable", x: 5, y: 6, w: 70, h: 80 });
  await new Promise((r) => setTimeout(r, 200)); // debounced save

  const reloaded = new WorkspaceStore(backend);
  await reloaded.init({ seed: false });
  const g = reloaded.getGroups(boardId)[0];
  assert.equal(g.name, "Durable");
  assert.deepEqual([g.x, g.y, g.w, g.h], [5, 6, 70, 80]);
});
