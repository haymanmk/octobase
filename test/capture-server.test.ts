import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureServer } from "../src/electron/capture-server.js";

async function withServer(opts, fn) {
  const captures = [];
  const highlights = [];
  const server = createCaptureServer({
    port: 0,
    token: "test-token",
    onCapture: (b) => { captures.push(b); return { id: "card_1" }; },
    onHighlight: (b) => { highlights.push(b); return { id: "card_2" }; },
    ...opts,
  });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn({ base, captures, highlights, server });
  } finally {
    await server.stop();
  }
}

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

test("OPTIONS preflight returns CORS headers", async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/capture`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /X-Octobase-Token/i);
  });
});
