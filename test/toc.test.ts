import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToc, filterToc, type TocEntry } from "../src/workspace/toc.ts";
import type { Card, Placement } from "../src/lib/model/types.ts";

let seq = 0;
function entry(
  title: string,
  x: number,
  y: number,
  opts: { w?: number; h?: number; kind?: Card["kind"]; body?: string } = {},
): TocEntry {
  const id = `c${++seq}`;
  const card = {
    id,
    kind: opts.kind ?? "note",
    title,
    body: opts.body ?? "",
    tags: [],
    color: "blue",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  } as Card;
  const placement: Placement = {
    id: `p${seq}`,
    whiteboardId: "wb",
    cardId: id,
    x,
    y,
    w: opts.w ?? 260,
    h: opts.h ?? 160,
    z: 0,
  };
  return { card, placement };
}

test("nearby cards cluster; distant ones form separate groups in reading order", () => {
  const a1 = entry("Paper summary", 0, 0, { w: 320, h: 220 });
  const a2 = entry("Highlight", 380, 0, { kind: "highlight" }); // 60px gap → same cluster
  const b1 = entry("Roadmap", 1200, 900, { w: 300, h: 200 });
  const b2 = entry("Idea", 1200, 1120, { h: 100 }); // 60px below b1
  const stray = entry("Stray", 40, 2400);
  const groups = buildToc([b2, stray, a2, b1, a1], new Map());
  assert.deepEqual(
    groups.map((g) => [g.label, g.rows.length]),
    [["Paper summary", 2], ["Roadmap", 2], [null, 1]],
  );
  // Reading order inside the first cluster: left card first.
  assert.deepEqual(groups[0].rows.map((r) => r.title), ["Paper summary", "Highlight"]);
});

test("cluster label prefers the largest note over a larger non-note", () => {
  const img = entry("Big clip", 0, 0, { kind: "image", w: 600, h: 400 });
  const note = entry("The note", 640, 0, { w: 260, h: 160 });
  const [g] = buildToc([img, note], new Map());
  assert.equal(g.label, "The note");
  assert.equal(g.anchorCardId, note.card.id);
});

test("embedded members indent under their host; non-members are ignored", () => {
  const host = entry("Host", 0, 0);
  const child = entry("Child", 300, 0);
  const other = entry("Other", 0, 200);
  const embeds = new Map([[host.card.id, [child.card.id, "not-on-board"]]]);
  const [g] = buildToc([host, child, other], embeds);
  assert.deepEqual(
    g.rows.map((r) => [r.title, r.depth]),
    [["Host", 0], ["Child", 1], ["Other", 0]],
  );
});

test("isolated cards have no group label and jump to themselves", () => {
  const solo = entry("Alone", 0, 0);
  const [g] = buildToc([solo], new Map());
  assert.equal(g.label, null);
  assert.equal(g.anchorCardId, solo.card.id);
  assert.equal(g.rows[0].depth, 0);
});

test("filter keeps structure: matching child retains its host row", () => {
  const host = entry("Alpha host", 0, 0);
  const child = entry("Beta child", 300, 0);
  const noise = entry("Gamma", 0, 200);
  const embeds = new Map([[host.card.id, [child.card.id]]]);
  const groups = buildToc([host, child, noise], embeds);
  const hit = filterToc(groups, "beta");
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0].rows.map((r) => r.title), ["Alpha host", "Beta child"]);
  // Group-label matches keep the whole island.
  const byLabel = filterToc(groups, "alpha host");
  assert.equal(byLabel[0].rows.length, 3);
  assert.deepEqual(filterToc(groups, "zzz"), []);
});
