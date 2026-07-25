import assert from "node:assert/strict";
import test from "node:test";

import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { moveTopLevelBlock, topLevelIndexAt, topLevelPos } from "../src/workspace/block-move.ts";

/**
 * Block dragging used to hand the move to ProseMirror's drop handler, which
 * deletes `tr.deleteSelection()` — whatever is selected when the drop lands,
 * not what was dragged. A stale selection duplicated the dragged block and
 * deleted a range out of an unrelated one. These tests pin the transformation
 * down: it is a function of (document, fromIndex, toIndex) and nothing else.
 */

const schema = getSchema([StarterKit, TaskList, TaskItem.configure({ nested: true })]);

const text = (t: string) => schema.text(t);
const para = (t: string) => schema.nodes.paragraph.create(null, t ? text(t) : null);
const head = (level: number, t: string) => schema.nodes.heading.create({ level }, text(t));
const bullets = (...items: string[]) =>
  schema.nodes.bulletList.create(null, items.map((t) => schema.nodes.listItem.create(null, para(t))));
const tasks = (...items: [string, boolean][]) =>
  schema.nodes.taskList.create(
    null,
    items.map(([t, checked]) => schema.nodes.taskItem.create({ checked }, para(t))),
  );

const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);
const stateOf = (doc: PMNode) => EditorState.create({ schema, doc });
/** One string per top-level block — the shape assertions compare. */
const blockTexts = (doc: PMNode): string[] => {
  const out: string[] = [];
  doc.forEach((n) => out.push(n.textContent));
  return out;
};

/** The document from the bug report. */
const reportDoc = () => docOf(
  head(2, "Analogy"),
  tasks(["check list", false], ["check list 2", true]),
  head(2, "Method"),
  bullets("first approach", "second approach"),
);

const move = (doc: PMNode, from: number, to: number) => {
  const tr = moveTopLevelBlock(stateOf(doc), from, to);
  return tr ? tr.doc : null;
};

test("topLevelPos walks the boundaries between top-level blocks", () => {
  const doc = docOf(para("a"), para("bb"), para("ccc"));
  assert.equal(topLevelPos(doc, 0), 0);
  assert.equal(topLevelPos(doc, 1), doc.child(0).nodeSize);
  assert.equal(topLevelPos(doc, 3), doc.content.size);
  // Out-of-range clamps rather than running off the end.
  assert.equal(topLevelPos(doc, 99), doc.content.size);
  assert.equal(topLevelPos(doc, -5), 0);
});

test("topLevelIndexAt inverts topLevelPos for every block", () => {
  const doc = reportDoc();
  for (let i = 0; i < doc.childCount; i++) {
    assert.equal(topLevelIndexAt(doc, topLevelPos(doc, i)), i, `index ${i}`);
  }
});

test("a block dropped on either of its own boundaries is a no-op", () => {
  const doc = reportDoc();
  for (let i = 0; i < doc.childCount; i++) {
    assert.equal(moveTopLevelBlock(stateOf(doc), i, i), null, `from ${i} to ${i}`);
    assert.equal(moveTopLevelBlock(stateOf(doc), i, i + 1), null, `from ${i} to ${i + 1}`);
  }
});

test("out-of-range and non-integer indices are refused, not guessed at", () => {
  const s = stateOf(reportDoc());
  for (const bad of [-1, 4, 99, 1.5, NaN]) {
    assert.equal(moveTopLevelBlock(s, bad, 0), null, `fromIndex ${bad}`);
  }
  assert.equal(moveTopLevelBlock(s, 0, NaN), null);
  // A target past the end clamps to "after the last block" instead of failing.
  const past = moveTopLevelBlock(s, 0, 999);
  assert.ok(past);
  assert.deepEqual(blockTexts(past.doc).at(-1), "Analogy");
});

test("every from/to pair preserves the blocks exactly — none lost, none duplicated", () => {
  const base = reportDoc();
  const before = blockTexts(base);
  for (let from = 0; from < base.childCount; from++) {
    for (let to = 0; to <= base.childCount; to++) {
      const result = move(reportDoc(), from, to);
      if (result === null) continue; // no-op boundaries, asserted above
      const after = blockTexts(result);
      const label = `from=${from} to=${to}`;
      assert.equal(after.length, before.length, `${label}: block count`);
      assert.deepEqual([...after].sort(), [...before].sort(), `${label}: same blocks`);
      // The dragged block lands where the caret promised.
      const landed = from < to ? to - 1 : to;
      assert.equal(after[landed], before[from], `${label}: dragged block position`);
      // And everything else keeps its relative order.
      const restBefore = before.filter((_, i) => i !== from);
      const restAfter = after.filter((_, i) => i !== landed);
      assert.deepEqual(restAfter, restBefore, `${label}: other blocks' order`);
    }
  }
});

test("regression: the move ignores the selection entirely", () => {
  // The old path deleted the selection. Point the selection deep inside an
  // unrelated block — the bullet list's "second approach" — and drag the task
  // list upward, which is exactly the reported sequence.
  const doc = reportDoc();
  const bulletPos = topLevelPos(doc, 3);
  // Two characters into "second approach", where the old bug truncated it.
  const inside = bulletPos + doc.child(3).nodeSize - 3;
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, inside),
  });
  const tr = moveTopLevelBlock(state, 1, 0);
  assert.ok(tr, "task list should move");
  const after = blockTexts(tr.doc);
  assert.deepEqual(after, [
    "check listcheck list 2",
    "Analogy",
    "Method",
    "first approachsecond approach",
  ]);
  // The block that merely held the cursor is untouched — no "se" left behind.
  assert.ok(after[3].includes("second approach"), `bullet list intact, got ${after[3]}`);
  assert.equal(tr.doc.childCount, 4);
});

test("nested children and their attributes survive the move", () => {
  const result = move(reportDoc(), 1, 4);
  assert.ok(result);
  const list = result.child(3);
  assert.equal(list.type.name, "taskList");
  assert.equal(list.childCount, 2, "both task items travel with the list");
  assert.equal(list.child(0).attrs.checked, false);
  assert.equal(list.child(1).attrs.checked, true, "checked state preserved");
  assert.equal(list.child(1).textContent, "check list 2");
});

test("moving a block away and back restores the original document", () => {
  const base = reportDoc();
  for (let from = 0; from < base.childCount; from++) {
    for (let to = 0; to <= base.childCount; to++) {
      const moved = move(reportDoc(), from, to);
      if (moved === null) continue;
      const landed = from < to ? to - 1 : to;
      // Send it back to where it started.
      const backTo = landed < from ? from + 1 : from;
      const restored = move(moved, landed, backTo);
      const finalDoc = restored ?? moved;
      assert.deepEqual(
        blockTexts(finalDoc),
        blockTexts(base),
        `round trip from=${from} to=${to}`,
      );
    }
  }
});

test("fuzz: random documents survive random moves intact", () => {
  // Deterministic PRNG so a failure is reproducible.
  let seed = 0x2f6e2b1;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const kinds = [
    (i: number) => para(`p${i}`),
    (i: number) => head(2, `h${i}`),
    (i: number) => bullets(`b${i}a`, `b${i}b`),
    (i: number) => tasks([`t${i}a`, false], [`t${i}b`, true]),
    (i: number) => schema.nodes.codeBlock.create(null, text(`code${i}`)),
    (i: number) => schema.nodes.blockquote.create(null, para(`q${i}`)),
  ];
  for (let round = 0; round < 300; round++) {
    const count = 2 + rand(7);
    const blocks: PMNode[] = [];
    for (let i = 0; i < count; i++) blocks.push(kinds[rand(kinds.length)](i));
    const doc = docOf(...blocks);
    const before = blockTexts(doc);
    const from = rand(count);
    const to = rand(count + 1);
    const result = move(doc, from, to);
    if (result === null) continue;
    const after = blockTexts(result);
    const label = `round ${round} from=${from} to=${to} [${before.join("|")}]`;
    assert.equal(after.length, before.length, `${label}: count`);
    assert.deepEqual([...after].sort(), [...before].sort(), `${label}: contents`);
    const landed = from < to ? to - 1 : to;
    assert.equal(after[landed], before[from], `${label}: landing`);
    // The document still satisfies the schema.
    result.check();
  }
});
