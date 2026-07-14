import assert from "node:assert/strict";
import test from "node:test";

// Plain-JS module (main-process side), imported like capture-server in its tests.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- untyped main-process module
import { chatRequestInit, createDeltaParser } from "../src/electron/openai-client.js";

test("chatRequestInit builds a streaming chat completion request", () => {
  const init = chatRequestInit("sk-test", "gpt-5-mini", [
    { role: "user", content: "hi" },
  ]);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer sk-test");
  const body = JSON.parse(init.body);
  assert.equal(body.model, "gpt-5-mini");
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});

test("delta parser yields content across chunk boundaries", () => {
  const feed = createDeltaParser();
  // One SSE event split mid-JSON across two network chunks.
  const a = feed('data: {"choices":[{"delta":{"con');
  assert.deepEqual(a, { deltas: [], done: false });
  const b = feed('tent":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
  assert.deepEqual(b, { deltas: ["Hel", "lo"], done: false });
});

test("delta parser flags [DONE] and ignores role/empty deltas", () => {
  const feed = createDeltaParser();
  const out = feed(
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":""}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
    "data: [DONE]\n\n",
  );
  assert.deepEqual(out, { deltas: ["ok"], done: true });
});

test("delta parser survives junk lines and comments", () => {
  const feed = createDeltaParser();
  const out = feed(': keepalive\n\ndata: not-json\n\ndata: {"choices":[{"delta":{"content":"x"}}]}\n\n');
  assert.deepEqual(out, { deltas: ["x"], done: false });
});
