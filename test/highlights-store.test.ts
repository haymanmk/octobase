import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStore } from "../src/electron/highlights-store.js";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "octobase-store-"));
}

function sampleHighlight(overrides: Record<string, unknown> = {}) {
  return {
    id: "hl-1",
    text: "selected text",
    sourceUrl: "https://x",
    color: "yellow",
    tags: [] as string[],
    notes: "",
    anchor: { serialized: "anchor-string" },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function sampleCard(overrides: Record<string, unknown> = {}) {
  return {
    id: "hl-1",
    text: "selected text",
    sourceUrl: "https://x",
    color: "yellow",
    tags: [] as string[],
    notes: "",
    x: 0,
    y: 0,
    updatedAt: 1,
    ...overrides,
  };
}

test("loadHighlightsForUrl returns [] when file missing", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    assert.deepEqual(await store.loadHighlightsForUrl("https://x"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveHighlight upserts by id and returns the saved record", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    const a = sampleHighlight({ id: "hl-1", color: "yellow", tags: ["read"] });
    const b = { ...a, color: "green" };
    await store.saveHighlight(a);
    await store.saveHighlight(b);
    const records = await store.loadHighlightsForUrl(a.sourceUrl);
    assert.equal(records.length, 1);
    assert.equal(records[0].color, "green");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteHighlight removes by id; missing id is a no-op", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveHighlight(sampleHighlight({ id: "hl-1" }));
    await store.deleteHighlight("hl-2"); // no-op
    await store.deleteHighlight("hl-1");
    assert.deepEqual(await store.loadHighlightsForUrl("https://x"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listTags dedupes lowercase across all highlights and sorts ascending", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveHighlight(sampleHighlight({ id: "hl-1", tags: ["Read", "todo"] }));
    await store.saveHighlight(sampleHighlight({ id: "hl-2", tags: ["read", "Important"] }));
    assert.deepEqual(await store.listTags(), ["important", "read", "todo"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveCard upserts by id; loadCards returns all", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveCard(sampleCard({ id: "hl-1", x: 10 }));
    await store.saveCard(sampleCard({ id: "hl-1", x: 20 }));
    await store.saveCard(sampleCard({ id: "hl-2", x: 30 }));
    const cards = await store.loadCards();
    assert.equal(cards.length, 2);
    const c1 = cards.find((c: any) => c.id === "hl-1");
    assert.ok(c1);
    assert.equal(c1.x, 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncCardFromHighlight updates content fields but preserves x/y", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    await store.saveCard(sampleCard({ id: "hl-1", x: 99, y: 42, color: "yellow" }));
    const updated = await store.syncCardFromHighlight(
      sampleHighlight({ id: "hl-1", color: "blue", tags: ["new"] }),
    );
    assert.ok(updated);
    assert.equal(updated!.x, 99);
    assert.equal(updated!.y, 42);
    assert.equal(updated!.color, "blue");
    assert.deepEqual(updated!.tags, ["new"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncCardFromHighlight returns null when no matching card exists", async () => {
  const dir = freshDir();
  try {
    const store = createStore(dir);
    const result = await store.syncCardFromHighlight(sampleHighlight({ id: "hl-missing" }));
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
