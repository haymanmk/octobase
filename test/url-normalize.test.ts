import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAddress } from "../src/electron/url-normalize.js";

test("full URLs pass through untouched", () => {
  assert.equal(normalizeAddress("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(normalizeAddress("http://localhost:5173/x"), "http://localhost:5173/x");
});

test("bare domains get https://", () => {
  assert.equal(normalizeAddress("example.com"), "https://example.com");
  assert.equal(normalizeAddress("docs.rs/serde/latest"), "https://docs.rs/serde/latest");
  assert.equal(normalizeAddress("localhost:3000"), "https://localhost:3000");
});

test("free text becomes a search query", () => {
  assert.equal(
    normalizeAddress("extended mind thesis"),
    "https://www.google.com/search?q=extended%20mind%20thesis",
  );
});

test("whitespace is trimmed; empty input yields null", () => {
  assert.equal(normalizeAddress("  example.com  "), "https://example.com");
  assert.equal(normalizeAddress("   "), null);
  assert.equal(normalizeAddress(""), null);
});
