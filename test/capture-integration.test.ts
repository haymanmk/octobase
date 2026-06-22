import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureServer } from "../src/electron/capture-server.js";
import { WorkspaceStore } from "../src/lib/store/workspace-store.ts";
import { MemoryPersistence } from "../src/lib/store/persistence.ts";

// Exercises the contract main.js relies on: a capture/highlight POST lands as a
// card in the workspace store (minus the Electron IPC hop, which only forwards).
test("posted capture + highlight become cards in the store", async () => {
  const store = new WorkspaceStore(new MemoryPersistence());
  await store.init({ seed: false });

  const server = createCaptureServer({
    port: 0,
    token: "t",
    onCapture: (d) =>
      store.createArticleCard({
        title: d.title,
        body: d.markdown,
        sourceUrl: d.url,
        siteName: d.siteName,
        byline: d.byline,
      }),
    onHighlight: (d) =>
      store.createHighlightCard({
        text: d.exact ?? d.anchor.exact,
        sourceUrl: d.url,
        anchor: d.anchor,
        color: d.color,
      }),
  });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  const headers = { "Content-Type": "application/json", "X-Octobase-Token": "t" };

  try {
    const cap = await fetch(`${base}/capture`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "https://site.com/post",
        title: "A Captured Post",
        markdown: "# A Captured Post\n\nBody text here.",
        byline: "Writer",
        siteName: "site.com",
      }),
    });
    assert.equal((await cap.json()).ok, true);

    const hl = await fetch(`${base}/highlight`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "https://site.com/post",
        color: "green",
        exact: "Body text",
        anchor: { exact: "Body text", prefix: "\n\n", suffix: " here.", startHint: 20 },
      }),
    });
    assert.equal((await hl.json()).ok, true);

    const cards = store.getCards();
    const article = cards.find((c) => c.kind === "article");
    assert.ok(article, "article card created");
    assert.equal(article!.title, "A Captured Post");

    const highlights = store.getHighlightsForUrl("https://site.com/post");
    assert.equal(highlights.length, 1);
    assert.equal(highlights[0].color, "green");

    // Both are in the inbox (no placement) — the intended landing spot.
    assert.equal(store.getInboxCards().length, 2);
  } finally {
    await server.stop();
  }
});
