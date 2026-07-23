import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToc, filterToc, type TocEntry } from "../src/workspace/toc.ts";
import type { Card, Group, Placement } from "../src/lib/model/types.ts";

function frame(name: string, x: number, y: number, w: number, h: number, collapsed = false): Group {
  return { id: `g_${name}`, whiteboardId: "wb", name, x, y, w, h, collapsed };
}

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
  // Islands are flat: they order rows but never make a headline.
  assert.deepEqual(
    groups.map((g) => [g.label, g.rows.length]),
    [[null, 2], [null, 2], [null, 1]],
  );
  // Reading order inside the first cluster: left card first.
  assert.deepEqual(groups[0].rows.map((r) => r.title), ["Paper summary", "Highlight"]);
});

test("island anchor (jump target) prefers the largest note; label stays null", () => {
  const img = entry("Big clip", 0, 0, { kind: "image", w: 600, h: 400 });
  const note = entry("The note", 640, 0, { w: 260, h: 160 });
  const [g] = buildToc([img, note], new Map());
  assert.equal(g.label, null);
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

test("named groups claim their members and use the group name as label", () => {
  const inA = entry("First", 20, 20);
  const inB = entry("Second", 20, 220);
  const loose = entry("Loose", 2000, 20);
  const g = frame("Research", 0, 0, 400, 500);
  const groups = buildToc([loose, inB, inA], new Map(), [g]);
  assert.deepEqual(
    groups.map((x) => [x.label, x.groupId ?? null, x.rows.map((r) => r.title)]),
    [
      ["Research", "g_Research", ["First", "Second"]],
      [null, null, ["Loose"]],
    ],
  );
});

test("group headings interleave with islands in reading order of frame position", () => {
  const island = entry("Island note", 0, 0, { w: 300, h: 200 });
  const member = entry("Member", 820, 20);
  const g = frame("Later", 800, 0, 400, 300);
  const groups = buildToc([member, island], new Map(), [g]);
  // Island starts at x=0, frame at x=800 → island first.
  assert.deepEqual(groups.map((x) => x.label), [null, "Later"]);
});

test("embeds still indent inside a named group", () => {
  // Host and child are farther apart than the spatial-cluster gap, so only
  // the frame (not proximity) puts them in one TOC group.
  const host = entry("Host", 20, 20);
  const child = entry("Child", 600, 20);
  const g = frame("Pack", 0, 0, 900, 300);
  const embeds = new Map([[host.card.id, [child.card.id]]]);
  const [tg] = buildToc([host, child], embeds, [g]);
  assert.deepEqual(tg.rows.map((r) => [r.title, r.depth]), [["Host", 0], ["Child", 1]]);
});

test("collapsed groups carry the collapsed flag; empty groups are omitted", () => {
  const member = entry("Inside", 20, 20);
  const shut = frame("Shut", 0, 0, 300, 300, true);
  const empty = frame("Empty", 900, 900, 200, 200);
  const groups = buildToc([member], new Map(), [shut, empty]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].collapsed, true);
  assert.equal(groups[0].label, "Shut");
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
  assert.deepEqual(filterToc(groups, "zzz"), []);
});

test("filter on a frame's name keeps the whole group", () => {
  const inA = entry("First", 20, 20);
  const inB = entry("Second", 20, 220);
  const g = frame("Research", 0, 0, 400, 500);
  const groups = buildToc([inB, inA], new Map(), [g]);
  const byLabel = filterToc(groups, "research");
  assert.equal(byLabel.length, 1);
  assert.equal(byLabel[0].rows.length, 2);
});
