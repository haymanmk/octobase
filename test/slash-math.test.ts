import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSlashItems, SLASH_ITEMS } from "../src/workspace/slash-items.ts";
import { BLOCK_MATH_RE, INLINE_MATH_RE } from "../src/workspace/math-extension.ts";

function matches(re: RegExp, text: string): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  return out;
}

test("empty slash query returns the full catalog in order", () => {
  assert.deepEqual(filterSlashItems(""), SLASH_ITEMS);
});

test("slash filter matches labels and aliases, prefix first", () => {
  // "Math block" is a prefix match for "mat"; "Inline math" only a substring.
  const math = filterSlashItems("mat").map((i) => i.id);
  assert.deepEqual(math, ["math-block", "math-inline"]);
  assert.equal(filterSlashItems("todo")[0].id, "task");
  assert.equal(filterSlashItems("latex")[0].id, "math-inline");
  assert.equal(filterSlashItems("H1")[0].id, "h1"); // case-insensitive
  assert.deepEqual(filterSlashItems("no-such-block"), []);
});

test("substring matches rank after prefix matches", () => {
  const ids = filterSlashItems("li").map((i) => i.id);
  // "list" prefixes nothing; Bullet/Numbered/Task list match as substrings.
  assert.ok(ids.includes("bullet") && ids.includes("numbered") && ids.includes("task"));
});

test("inline math regex: $…$ but never $$…$$ or dollar amounts", () => {
  assert.deepEqual(matches(INLINE_MATH_RE, "a $x+y$ b"), ["x+y"]);
  assert.deepEqual(matches(INLINE_MATH_RE, "$$E=mc^2$$"), []);
  assert.deepEqual(matches(INLINE_MATH_RE, "us$100 and $200"), []);
  assert.deepEqual(matches(INLINE_MATH_RE, "$\\lambda$"), ["\\lambda"]);
  assert.deepEqual(matches(INLINE_MATH_RE, "$a$ then $b$"), ["a", "b"]);
});

test("block math regex: $$…$$ on one line", () => {
  assert.deepEqual(matches(BLOCK_MATH_RE, "$$E=mc^2$$"), ["E=mc^2"]);
  assert.deepEqual(matches(BLOCK_MATH_RE, "$x$"), []);
  assert.deepEqual(matches(BLOCK_MATH_RE, "$$a$$ and $$b$$"), ["a", "b"]);
});
