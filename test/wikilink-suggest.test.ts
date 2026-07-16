import assert from "node:assert/strict";
import test from "node:test";

import { buildLinkRows, unescapeWikilinks } from "../src/workspace/wikilink-suggest.ts";
import type { Card } from "../src/lib/model/types.ts";

const card = (id: string, title: string, kind = "note"): Card =>
  ({
    id,
    kind,
    title,
    body: "",
    tags: [],
    color: "yellow",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  }) as Card;

test("matches map to rows, capped at seven", () => {
  const many = Array.from({ length: 12 }, (_, i) => card(`c${i}`, `Card ${i}`));
  const rows = buildLinkRows("card", many);
  assert.equal(rows.filter((r) => !r.isNew).length, 7);
  assert.equal(rows[0].title, "Card 0");
});

test("duplicate titles collapse — wikilinks resolve by title", () => {
  const rows = buildLinkRows("mind", [
    card("a", "The Extended Mind"),
    card("b", "the extended mind"),
    card("c", "Mind maps"),
  ]);
  assert.deepEqual(rows.filter((r) => !r.isNew).map((r) => r.title), [
    "The Extended Mind",
    "Mind maps",
  ]);
});

test("a non-empty query with no exact title match offers a create row", () => {
  const rows = buildLinkRows("Embodied cognition", [card("a", "The Extended Mind")]);
  const last = rows[rows.length - 1];
  assert.equal(last.isNew, true);
  assert.equal(last.title, "Embodied cognition");
  assert.equal(last.id, null);
});

test("an exact title match suppresses the create row", () => {
  const rows = buildLinkRows("the extended mind", [card("a", "The Extended Mind")]);
  assert.ok(rows.every((r) => !r.isNew));
});

test("an empty query (just typed [[) lists matches with no create row", () => {
  const rows = buildLinkRows("", [card("a", "Recent one"), card("b", "Recent two")]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !r.isNew));
});

test("unescapeWikilinks undoes the serializer's bracket escaping", () => {
  // tiptap-markdown escapes every "[" on serialize, killing wikilinks.
  assert.equal(
    unescapeWikilinks("Link cards with \\[\\[Text anchoring\\]\\] now"),
    "Link cards with [[Text anchoring]] now",
  );
  assert.equal(
    unescapeWikilinks("embed !\\[\\[A clip\\]\\] here"),
    "embed ![[A clip]] here",
  );
  // Single escaped brackets (task syntax etc.) are left alone.
  assert.equal(unescapeWikilinks("- \\[x] done"), "- \\[x] done");
  assert.equal(unescapeWikilinks("no links at all"), "no links at all");
});

test("cards excluded by id do not appear (no self-links)", () => {
  const rows = buildLinkRows("mind", [card("self", "Mind palace"), card("b", "Mind maps")], "self");
  assert.deepEqual(rows.filter((r) => !r.isNew).map((r) => r.title), ["Mind maps"]);
});
