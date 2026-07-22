import assert from "node:assert/strict";
import test from "node:test";

import {
  addTag,
  filterSuggestions,
  normalizeTag,
  removeTag,
  sameTags,
} from "../src/workspace/tags.ts";

test("normalizeTag trims and lower-cases", () => {
  assert.equal(normalizeTag("  Reading List  "), "reading list");
  assert.equal(normalizeTag("IDEA"), "idea");
});

test("addTag appends normalized, skips blanks and duplicates", () => {
  assert.deepEqual(addTag([], "Idea"), ["idea"]);
  assert.deepEqual(addTag(["idea"], "  "), ["idea"]);
  // Duplicate after normalization returns the same array reference (no-op).
  const tags = ["idea"];
  assert.equal(addTag(tags, "IDEA"), tags);
});

test("removeTag drops the matching tag only", () => {
  assert.deepEqual(removeTag(["a", "b", "c"], "b"), ["a", "c"]);
  assert.deepEqual(removeTag(["a"], "missing"), ["a"]);
});

test("filterSuggestions: substring match, excludes applied, caps, empty on blank", () => {
  const all = ["react", "reading", "recipes", "rust", "ml"];
  assert.deepEqual(filterSuggestions(all, "re", []), ["react", "reading", "recipes"]);
  assert.deepEqual(filterSuggestions(all, "re", ["react"]), ["reading", "recipes"]);
  assert.deepEqual(filterSuggestions(all, "", []), []);
  assert.equal(filterSuggestions(["aa", "ab", "ac", "ad", "ae", "af", "ag"], "a", [], 3).length, 3);
});

test("sameTags is order-insensitive", () => {
  assert.ok(sameTags(["a", "b"], ["b", "a"]));
  assert.ok(!sameTags(["a"], ["a", "b"]));
  assert.ok(!sameTags(["a", "b"], ["a", "c"]));
});
