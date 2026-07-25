import type { Node } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/**
 * Moving whole top-level blocks around a document — the transformation behind
 * the block grip's drag.
 *
 * It lives apart from the drag machinery on purpose. Letting ProseMirror's own
 * drop handler do the move meant the deletion target was
 * `tr.deleteSelection()` — whatever happened to be selected when the drop
 * landed, which is not reliably the dragged block once focus has moved to the
 * grip (a portal button outside the editor). A stale selection there deletes
 * the wrong range and leaves the original in place, duplicating a block while
 * chewing a hole in an unrelated one.
 *
 * So the block is identified by its index in the CURRENT document and nothing
 * else: no positions captured at hover time, no selection state, no slice
 * handed to a third party. That also makes the drop land exactly where the
 * app's own caret promised — ProseMirror's `dropPoint` would happily nest a
 * block inside whatever list sits under the cursor.
 */

/** Document position of the boundary before top-level child `index`. */
export function topLevelPos(doc: Node, index: number): number {
  const clamped = Math.max(0, Math.min(index, doc.childCount));
  let pos = 0;
  for (let i = 0; i < clamped; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/**
 * Top-level child index whose start is at (or contains) `pos` — the inverse of
 * `topLevelPos`, for callers holding a position rather than an index.
 */
export function topLevelIndexAt(doc: Node, pos: number): number {
  let at = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const next = at + doc.child(i).nodeSize;
    if (pos < next) return i;
    at = next;
  }
  return doc.childCount - 1;
}

/**
 * Move top-level block `fromIndex` to the insertion boundary `toIndex`, both
 * indices into the document as it stands (`toIndex` ranges 0…childCount, so
 * childCount means "past the last block").
 *
 * Returns null when the move would be a no-op — including the two boundaries
 * that touch the block itself, where a drop should leave the document alone
 * rather than dispatch a transaction that dirties the editor.
 */
export function moveTopLevelBlock(
  state: EditorState,
  fromIndex: number,
  toIndex: number,
): Transaction | null {
  const doc = state.doc;
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= doc.childCount) return null;
  if (!Number.isInteger(toIndex)) return null;
  const to = Math.max(0, Math.min(toIndex, doc.childCount));
  // Either side of the block is where it already is.
  if (to === fromIndex || to === fromIndex + 1) return null;

  const node = doc.child(fromIndex);
  const from = topLevelPos(doc, fromIndex);
  const insertAt = topLevelPos(doc, to);

  const tr = state.tr;
  tr.delete(from, from + node.nodeSize);
  // Mapping through the delete is what makes a downward move land correctly:
  // every boundary past the removed block shifts left by its size.
  tr.insert(tr.mapping.map(insertAt), node);
  return tr;
}
