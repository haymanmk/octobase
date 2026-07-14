import assert from "node:assert/strict";
import test from "node:test";

import { buildCardContext, CONTEXT_CHAR_LIMIT } from "../src/workspace/ai-context.ts";
import type { Card } from "../src/lib/model/types.ts";

const base = {
  id: "card_x",
  title: "The Extended Mind",
  tags: [],
  color: "blue" as const,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

test("pdf cards use the parsed full text and ask for page citations", () => {
  const card = { ...base, kind: "pdf", file: "a.pdf", pages: 18, body: "" } as Card;
  const { system, truncated } = buildCardContext(card, "# Doc\n\n[page 1]\n\nHello.");
  assert.match(system, /\[page 1\]/);
  assert.match(system, /Hello\./);
  assert.match(system, /cite .*\[page N\]/i);
  assert.equal(truncated, false);
});

test("pdf cards without parsed text say so instead of sending nothing", () => {
  const card = { ...base, kind: "pdf", file: "a.pdf", pages: 18, body: "" } as Card;
  const { system } = buildCardContext(card, null);
  assert.match(system, /could not be extracted/i);
});

test("note cards send title and body", () => {
  const card = { ...base, kind: "note", body: "Some **markdown** body." } as Card;
  const { system } = buildCardContext(card, null);
  assert.match(system, /The Extended Mind/);
  assert.match(system, /Some \*\*markdown\*\* body\./);
});

test("highlight cards include the quote, note, and source", () => {
  const card = {
    ...base,
    kind: "highlight",
    body: "my note",
    sourceUrl: "https://example.com/a",
    anchor: { exact: "quoted text", prefix: "", suffix: "", startHint: 0 },
  } as Card;
  const { system } = buildCardContext(card, null);
  assert.match(system, /The Extended Mind/); // the quote lives in the title
  assert.match(system, /my note/);
  assert.match(system, /example\.com/);
});

test("oversized context truncates at the limit with a visible marker", () => {
  const card = { ...base, kind: "pdf", file: "a.pdf", pages: 999, body: "" } as Card;
  const huge = "x".repeat(CONTEXT_CHAR_LIMIT + 50_000);
  const { system, truncated } = buildCardContext(card, huge);
  assert.equal(truncated, true);
  assert.ok(system.length < CONTEXT_CHAR_LIMIT + 2_000);
  assert.match(system, /\[context truncated\]/);
});
