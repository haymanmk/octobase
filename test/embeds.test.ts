import assert from "node:assert/strict";
import test from "node:test";

import { parseEmbeds, parseWikilinks } from "../src/lib/model/wikilinks.ts";
import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";

async function freshStore(): Promise<WorkspaceStore> {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  return store;
}

test("parseEmbeds finds ![[Card Title]] blocks", () => {
  const found = parseEmbeds("intro\n\n![[Alpha]]\n\ntext ![[Beta|shown]] end");
  assert.deepEqual(found.map((e) => e.target), ["Alpha", "Beta"]);
  assert.equal(found[0].raw, "![[Alpha]]");
});

test("parseWikilinks does not double-count embeds as plain links", () => {
  const links = parseWikilinks("see [[Alpha]] and ![[Beta]]");
  assert.deepEqual(links.map((l) => l.target), ["Alpha"]);
});

test("getChildCards resolves embedded cards in body order, deduped", async () => {
  const store = await freshStore();
  const a = store.createNoteCard({ title: "Alpha" });
  const b = store.createNoteCard({ title: "Beta" });
  const host = store.createNoteCard({
    title: "Host",
    body: "notes\n\n![[Beta]]\n\n![[Alpha]]\n\n![[Beta]]\n\n![[Ghost]]",
  });
  const children = store.getChildCards(host.id);
  assert.deepEqual(children.map((c) => c.id), [b.id, a.id]);
});

test("embedCard appends the embed block and refuses self/duplicates", async () => {
  const store = await freshStore();
  const host = store.createNoteCard({ title: "Host", body: "some notes" });
  const child = store.createNoteCard({ title: "Child" });
  assert.equal(store.embedCard(host.id, child.id), true);
  assert.equal(store.getCard(host.id)!.body, "some notes\n\n![[Child]]");
  // Duplicate embed is a no-op.
  assert.equal(store.embedCard(host.id, child.id), false);
  assert.equal(store.getCard(host.id)!.body, "some notes\n\n![[Child]]");
  // Self-embed refused.
  assert.equal(store.embedCard(host.id, host.id), false);
  // Empty body hosts don't get a leading blank line.
  const empty = store.createNoteCard({ title: "Empty" });
  store.embedCard(empty.id, child.id);
  assert.equal(store.getCard(empty.id)!.body, "![[Child]]");
});

test("embeds count as outgoing links for the graph", async () => {
  const store = await freshStore();
  const child = store.createNoteCard({ title: "Child" });
  const host = store.createNoteCard({ title: "Host", body: "![[Child]]" });
  assert.deepEqual(store.getOutgoingLinks(host.id).map((c) => c.id), [child.id]);
  assert.deepEqual(store.getBacklinks(child.id).map((c) => c.id), [host.id]);
});
