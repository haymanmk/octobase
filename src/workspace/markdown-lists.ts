import BulletList from "@tiptap/extension-bullet-list";
import TaskList from "@tiptap/extension-task-list";
import type { Node } from "@tiptap/pm/model";

/**
 * Keeping adjacent bullet lists apart across the markdown round-trip.
 *
 * Cards are stored as markdown, and markdown has no way to say "two separate
 * lists" when both use the same bullet character — `- a` … blank line …
 * `- [ ] b` re-parses as ONE list. So a document with a bullet list directly
 * followed by a task list (easy to produce by dragging one block next to the
 * other) came back merged: the plain items joined the task list, inherited its
 * `contains-task-list` class, and lost their markers.
 *
 * CommonMark does start a new list when the bullet character changes, so the
 * marker alternates along any run of adjacent bullet lists. Verified against
 * both parsers in play — markdown-it for the editor, remark-gfm for the read
 * view — in `test/markdown-lists.test.ts`.
 *
 * Ordered lists don't need this: `1.` and `-` are already different list
 * types, and two adjacent ordered lists are indistinguishable from one
 * continuing list in any case.
 */

/** Node types markdown writes with a `-`/`*` bullet. */
const BULLET_LIST_TYPES = new Set(["bulletList", "taskList"]);

export const BULLET_MARKERS = ["-", "*"] as const;

/**
 * Bullet character for the list at `index`, chosen so it differs from the list
 * immediately before it. Counts the unbroken run of bullet lists ending at this
 * one, so a run of any length keeps alternating rather than just the first pair.
 */
export function bulletMarkerFor(parent: Node | null | undefined, index: number): string {
  if (!parent) return BULLET_MARKERS[0];
  let preceding = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (!BULLET_LIST_TYPES.has(parent.child(i).type.name)) break;
    preceding++;
  }
  return BULLET_MARKERS[preceding % BULLET_MARKERS.length];
}

/** prosemirror-markdown's serializer state, narrowed to what's used here. */
interface ListSerializerState {
  renderList: (node: Node, delim: string, firstDelim: (i: number) => string) => void;
}

function serializeBulletList(
  this: unknown,
  state: ListSerializerState,
  node: Node,
  parent: Node | null,
  index: number,
): void {
  const marker = bulletMarkerFor(parent, index);
  state.renderList(node, "  ", () => `${marker} `);
}

/**
 * Both list flavours get the alternating serializer. Only `serialize` is
 * overridden: tiptap-markdown merges this spec over its built-in one shallowly,
 * so supplying `parse` here would drop the task-list parser plugin with it.
 */
export const SeparatedBulletList = BulletList.extend({
  addStorage() {
    return { markdown: { serialize: serializeBulletList } };
  },
});

export const SeparatedTaskList = TaskList.extend({
  addStorage() {
    return { markdown: { serialize: serializeBulletList } };
  },
});
