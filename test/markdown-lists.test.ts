import assert from "node:assert/strict";
import test from "node:test";

import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import type { Node as PMNode } from "@tiptap/pm/model";

import {
  BULLET_MARKERS,
  SeparatedBulletList,
  SeparatedTaskList,
  bulletMarkerFor,
} from "../src/workspace/markdown-lists.ts";

/**
 * Cards round-trip through markdown, which cannot express "two adjacent lists"
 * when both use the same bullet character — they re-parse as one list, so a
 * bullet list dragged next to a task list came back merged, its plain items
 * wearing checkboxes' clothing. The marker alternates to keep them apart;
 * these tests pin that down against BOTH parsers the app actually uses.
 */

const schema = getSchema([
  StarterKit.configure({ bulletList: false }),
  SeparatedBulletList,
  SeparatedTaskList,
  TaskItem.configure({ nested: true }),
]);

const para = (t: string) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null);
const bullets = (...items: string[]) =>
  schema.nodes.bulletList.create(null, items.map((t) => schema.nodes.listItem.create(null, para(t))));
const tasks = (...items: string[]) =>
  schema.nodes.taskList.create(null, items.map((t) => schema.nodes.taskItem.create({ checked: false }, para(t))));
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

/** Lists in the markdown as markdown-it (the editor's parser) sees them. */
function listsViaMarkdownIt(src: string): number {
  const html = new MarkdownIt().use(taskLists).render(src);
  return (html.match(/<ul/g) ?? []).length;
}

/** Lists in the markdown as remark-gfm (the read view's parser) sees them. */
async function listsViaRemark(src: string): Promise<{ length: number; items: number[] }> {
  const proc = unified().use(remarkParse).use(remarkGfm);
  const tree = proc.parse(src);
  await proc.run(tree);
  const lists = (tree as { children: { type: string; children: unknown[] }[] }).children
    .filter((n) => n.type === "list");
  return { length: lists.length, items: lists.map((l) => l.children.length) };
}

test("the marker alternates along a run of adjacent bullet lists", () => {
  const doc = docOf(bullets("a"), tasks("b"), bullets("c"), para("break"), tasks("d"));
  assert.equal(bulletMarkerFor(doc, 0), BULLET_MARKERS[0], "first list");
  assert.equal(bulletMarkerFor(doc, 1), BULLET_MARKERS[1], "second in the run flips");
  assert.equal(bulletMarkerFor(doc, 2), BULLET_MARKERS[0], "third flips back");
  // A non-list block breaks the run, so the next list starts over.
  assert.equal(bulletMarkerFor(doc, 4), BULLET_MARKERS[0], "run restarts after a paragraph");
});

test("a list with no parent context still gets a valid marker", () => {
  assert.equal(bulletMarkerFor(null, 0), BULLET_MARKERS[0]);
  assert.equal(bulletMarkerFor(undefined, 3), BULLET_MARKERS[0]);
});

test("regression: same-marker adjacent lists merge — this is what we avoid", async () => {
  const merged = "- first approach\n- second approach\n\n- [ ] check list\n- [ ] check list 2";
  assert.equal(listsViaMarkdownIt(merged), 1, "markdown-it merges them");
  const viaRemark = await listsViaRemark(merged);
  assert.equal(viaRemark.length, 1, "remark merges them too");
  assert.deepEqual(viaRemark.items, [4], "all four items land in one list");
});

test("alternating markers survive both parsers as two separate lists", async () => {
  const [a, b] = BULLET_MARKERS;
  const src = `${a} first approach\n${a} second approach\n\n${b} [ ] check list\n${b} [ ] check list 2`;
  assert.equal(listsViaMarkdownIt(src), 2, "markdown-it keeps them apart");
  const viaRemark = await listsViaRemark(src);
  assert.equal(viaRemark.length, 2, "remark keeps them apart");
  assert.deepEqual(viaRemark.items, [2, 2], "two items each");
});

test("task items still parse as tasks under the alternate marker", async () => {
  const [, b] = BULLET_MARKERS;
  const src = `${b} [ ] unchecked\n${b} [x] checked`;
  const html = new MarkdownIt().use(taskLists).render(src);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2, "markdown-it sees checkboxes");

  const proc = unified().use(remarkParse).use(remarkGfm);
  const tree = proc.parse(src);
  await proc.run(tree);
  const list = (tree as { children: { type: string; children: { checked: boolean | null }[] }[] })
    .children.find((n) => n.type === "list");
  assert.ok(list, "a list was parsed");
  assert.deepEqual(list.children.map((i) => i.checked), [false, true], "checked state preserved");
});

test("every adjacent pairing of list kinds stays separate", async () => {
  const [a, b] = BULLET_MARKERS;
  const pairs: [string, string][] = [
    [`${a} plain one`, `${b} [ ] task one`],       // bullets then tasks
    [`${a} [ ] task one`, `${b} plain one`],       // tasks then bullets
    [`${a} plain one`, `${b} plain two`],          // bullets then bullets
    [`${a} [ ] task one`, `${b} [x] task two`],    // tasks then tasks
  ];
  for (const [first, second] of pairs) {
    const src = `${first}\n\n${second}`;
    assert.equal(listsViaMarkdownIt(src), 2, `markdown-it: ${JSON.stringify(src)}`);
    const viaRemark = await listsViaRemark(src);
    assert.equal(viaRemark.length, 2, `remark: ${JSON.stringify(src)}`);
  }
});
