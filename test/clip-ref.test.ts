import { test } from "node:test";
import assert from "node:assert/strict";
import { clipRef, parseClipRef, resolveClipSrc } from "../src/workspace/clip-ref.ts";

test("clipRef and parseClipRef round-trip a clip file name", () => {
  const src = clipRef("a1b2-c3.png");
  assert.equal(src, "clip:a1b2-c3.png");
  assert.equal(parseClipRef(src), "a1b2-c3.png");
});

test("parseClipRef rejects non-clip srcs and path escapes", () => {
  assert.equal(parseClipRef("https://x.test/a.png"), null);
  assert.equal(parseClipRef("clips:a.png"), null);
  assert.equal(parseClipRef("clip:../secrets.png"), null);
  assert.equal(parseClipRef("clip:sub/dir.png"), null);
  assert.equal(parseClipRef("clip:"), null);
});

test("resolveClipSrc maps refs to the protocol and passes others through", () => {
  assert.equal(resolveClipSrc("clip:a.png"), "octobase-clip://c/a.png");
  assert.equal(resolveClipSrc("https://x.test/a.png"), "https://x.test/a.png");
  assert.equal(resolveClipSrc(""), "");
});
