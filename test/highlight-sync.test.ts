import assert from "node:assert/strict";
import test from "node:test";
import { reconcileHighlights, type SavedHighlight } from "../src/extension/highlight-sync.ts";
import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";

const item: SavedHighlight = { id: "a", exact: "a phrase", anchor: { exact: "a phrase", prefix: "", suffix: "", startHint: 0 }, color: "yellow", note: "old note" };
test("reverse sync transfers and clears notes as well as colours", () => {
  assert.equal(reconcileHighlights([item], [{ ...item, note: "reader edit", color: "green" }], new Set(["a"]))[0].note, "reader edit");
  assert.equal(reconcileHighlights([item], [{ ...item, note: "reader edit", color: "green" }], new Set(["a"]))[0].color, "green");
  assert.equal(reconcileHighlights([item], [{ ...item, note: undefined }], new Set(["a"]))[0].note, "");
  assert.equal(reconcileHighlights([], [item], new Set())[0].note, "old note");
});
test("reverse sync honours remote deletion without removing unsent local highlights", () => {
  assert.deepEqual(reconcileHighlights([item, { ...item, id: "offline" }], [], new Set(["a"])).map((h) => h.id), ["offline"]);
});
test("reader and browser fragment URLs resolve to the same highlight set", async () => {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });
  store.createHighlightCard({ text: item.exact, anchor: item.anchor, sourceUrl: "https://example.com/article#section", notes: "note" });
  assert.equal(store.getHighlightsForUrl("https://example.com/article").length, 1);
  assert.equal(store.getHighlightsForUrl("https://example.com/article#other")[0].body, "note");
  assert.equal(store.getHighlightsForUrl("https://example.com/other").length, 0);
});
