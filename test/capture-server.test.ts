import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureServer } from "../src/electron/capture-server.js";

async function withServer(opts, fn) {
  const captures = [];
  const highlights = [];
  const deletes = [];
  const server = createCaptureServer({
    port: 0,
    token: "test-token",
    onCapture: (b) => { captures.push(b); return { id: "card_1" }; },
    onHighlight: (b) => { highlights.push(b); return { id: b.id ?? "card_2" }; },
    onHighlightDelete: (id) => { deletes.push(id); },
    onListHighlights: () => [{ id: "h1", color: "yellow", anchor: { exact: "x", prefix: "", suffix: "", startHint: 0 } }],
    ...opts,
  });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn({ base, captures, highlights, deletes, server });
  } finally {
    await server.stop();
  }
}

const authHeaders = { "Content-Type": "application/json", "X-Octobase-Token": "test-token" };

test("health needs no token", async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.app, "octobase");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

test("capture without token is rejected", async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://x.com", markdown: "# hi" }),
    });
    assert.equal(res.status, 401);
  });
});

test("valid capture is parsed and forwarded", async () => {
  await withServer({}, async ({ base, captures }) => {
    const res = await fetch(`${base}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Octobase-Token": "test-token" },
      body: JSON.stringify({ url: "https://x.com/a", title: "A", markdown: "# A\n\nbody", byline: "Me" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, "card_1");
    assert.equal(captures.length, 1);
    assert.equal(captures[0].title, "A");
    assert.equal(captures[0].markdown, "# A\n\nbody");
  });
});

test("capture missing required fields is a 400", async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Octobase-Token": "test-token" },
      body: JSON.stringify({ title: "no url or markdown" }),
    });
    assert.equal(res.status, 400);
  });
});

test("valid highlight is parsed and forwarded", async () => {
  await withServer({}, async ({ base, highlights }) => {
    const res = await fetch(`${base}/highlight`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Octobase-Token": "test-token" },
      body: JSON.stringify({
        url: "https://x.com/a",
        color: "yellow",
        anchor: { exact: "hello", prefix: "say ", suffix: " world", startHint: 4 },
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(highlights.length, 1);
    assert.equal(highlights[0].anchor.exact, "hello");
    assert.equal(highlights[0].color, "yellow");
  });
});

test("highlight carries a shared id for upsert", async () => {
  await withServer({}, async ({ base, highlights }) => {
    const res = await fetch(`${base}/highlight`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "hl_abc",
        url: "https://x.com/a",
        color: "pink",
        note: "my note",
        anchor: { exact: "hi", prefix: "", suffix: "", startHint: 0 },
      }),
    });
    assert.equal((await res.json()).id, "hl_abc");
    assert.equal(highlights[0].id, "hl_abc");
    assert.equal(highlights[0].note, "my note");
  });
});

test("highlight delete forwards the id", async () => {
  await withServer({}, async ({ base, deletes }) => {
    const res = await fetch(`${base}/highlight/delete`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ id: "hl_abc" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(deletes, ["hl_abc"]);
  });
});

test("GET /highlights returns the app's highlights for a url", async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/highlights?url=${encodeURIComponent("https://x.com/a")}`, {
      headers: { "X-Octobase-Token": "test-token" },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.highlights.length, 1);
    assert.equal(body.highlights[0].id, "h1");
  });
});

test("OPTIONS preflight returns CORS headers", async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/capture`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /X-Octobase-Token/i);
  });
});
