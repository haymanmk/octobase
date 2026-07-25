import * as React from "react";
import { createPortal } from "react-dom";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { Node } from "@tiptap/pm/model";
import { moveTopLevelBlock } from "./block-move.ts";
import { CARD_DRAG_MIME } from "./dnd.ts";
import { consumeCardDropHandled, hideDropCaret, showCaretLine } from "./drop-caret.ts";
import { useWorkspaceStore } from "./store-context.ts";

/**
 * Milkdown/Notion-style block handle: hovering a top-level block shows a ⋮⋮
 * grip hanging just outside the block's top-left, so the editor keeps the
 * exact text layout of read mode (no reserved gutter). Hold and drag to move
 * the block; click to open a small action menu (add line below · duplicate ·
 * delete).
 *
 * The drag deliberately does NOT go through ProseMirror's drop handling. That
 * handler removes the source with `tr.deleteSelection()` — whatever is
 * selected when the drop lands, which stops being the dragged block as soon as
 * focus moves to this grip (a portal button outside the editor) — and it
 * inserts at its own `dropPoint`, which can nest a block inside whatever list
 * sits under the cursor rather than at the caret the user is watching. Both
 * are handled here instead, by index, through `block-move.ts`.
 *
 * The grip renders in a body-level portal with fixed positioning taken
 * straight from the hovered block's client rect — the same coordinate space
 * as the pointer, so the canvas scale() transform cancels out. (The previous
 * tippy-based plugin ran popper offset math on those rects and drifted.)
 */

/** Cursor must be this close (px) to a block to claim its handle. */
const SNAP_PX = 14;
/** The grip hangs this far left of the block's text edge. */
const GRIP_GAP = 24;

export function BlockHandles({ editor }: { editor: Editor }): React.ReactElement {
  const store = useWorkspaceStore();
  // The hovered block. A ref, not state: it changes on every hover and only
  // the handle element's inline position needs to follow.
  const current = React.useRef<{ node: Node | null; pos: number; index: number }>({
    node: null,
    pos: -1,
    index: -1,
  });
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuOpenRef = React.useRef(false);
  const draggingRef = React.useRef(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const setShown = React.useCallback((at: { top: number; left: number } | null) => {
    const el = rootRef.current;
    if (!el) return;
    if (at == null) {
      el.style.display = "none";
    } else {
      el.style.display = "flex";
      el.style.top = `${at.top}px`;
      el.style.left = `${at.left}px`;
    }
  }, []);

  // Track the hovered top-level block on window mousemove: the grip hangs
  // outside the editor's box, so an editor-scoped listener would hide it
  // before the pointer could reach it. Everything is client-rect math — the
  // same coordinate space as the pointer at any canvas zoom.
  React.useEffect(() => {
    const pm = editor.view.dom as HTMLElement;
    const scroller = pm.closest(".ws-card-md-scroll") as HTMLElement | null;
    if (!scroller) return;
    const onMove = (e: MouseEvent) => {
      if (menuOpenRef.current || draggingRef.current) return;
      // instanceof guard: synthetic events can target non-Node objects, and
      // contains() throws on those. (globalThis.Node — the PM Node type
      // import shadows the DOM one.)
      if (e.target instanceof globalThis.Node && rootRef.current?.contains(e.target)) return;
      const box = scroller.getBoundingClientRect();
      if (
        e.clientX < box.left - GRIP_GAP - 12 ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      ) {
        current.current = { node: null, pos: -1, index: -1 };
        setShown(null);
        return;
      }
      let hit: HTMLElement | null = null;
      let hitDist = Infinity;
      for (const child of pm.children) {
        const r = (child as HTMLElement).getBoundingClientRect();
        const dist =
          e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
        if (dist < hitDist) {
          hitDist = dist;
          hit = child as HTMLElement;
        }
      }
      if (!hit || hitDist > SNAP_PX) {
        current.current = { node: null, pos: -1, index: -1 };
        setShown(null);
        return;
      }
      // Index-based position lookup: top-level DOM children map 1:1 onto doc
      // children (posAtDOM throws on block atoms like embeds).
      const idx = Array.prototype.indexOf.call(pm.children, hit);
      const doc = editor.state.doc;
      if (idx < 0 || idx >= doc.childCount) {
        setShown(null);
        return;
      }
      let pos = 0;
      for (let i = 0; i < idx; i++) pos += doc.child(i).nodeSize;
      current.current = { node: doc.child(idx), pos, index: idx };
      const r = hit.getBoundingClientRect();
      setShown({ top: r.top, left: r.left - GRIP_GAP });
    };
    // Scrolling shifts every block under a motionless pointer — hide until
    // the next move rather than track mid-scroll.
    const onScroll = () => {
      if (!menuOpenRef.current && !draggingRef.current) setShown(null);
    };
    // The zone that owns a grip drag's drop: the whole card (canvas) or the
    // note-editor pane (viewer). The ProseMirror element stops at the text
    // column, but the card's padding and the grip gutter sit just outside
    // it — a drop there used to bubble to the canvas, which placed the card
    // on the board while the caret still promised an in-note position.
    const zone = (scroller.closest(".ws-card, .ws-note-editor") as HTMLElement | null) ?? scroller;
    /** Block boundary nearest clientY: insertion index + caret line y. */
    const nearestBoundary = (clientY: number): { index: number; y: number } | null => {
      const rects = [...pm.children].map((el) => el.getBoundingClientRect());
      if (rects.length === 0) return null;
      let index = 0;
      let y = rects[0].top;
      let best = Math.abs(clientY - y);
      for (let i = 0; i < rects.length; i++) {
        const cand = i + 1 < rects.length ? (rects[i].bottom + rects[i + 1].top) / 2 : rects[i].bottom;
        const d = Math.abs(clientY - cand);
        if (d < best) {
          best = d;
          index = i + 1;
          y = cand;
        }
      }
      return { index, y };
    };
    // Both listeners run in the CAPTURE phase and swallow the event, so a grip
    // drag reaches neither ProseMirror below (whose drop handler would delete
    // the selection instead of the dragged block — see block-move.ts) nor the
    // canvas above (which would place the card on the board). Anything that is
    // not a grip drag — a library tile heading for an embed, dragged text —
    // falls through untouched.
    const claim = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // Drop feedback: prosemirror-dropcursor mis-positions inside the canvas
    // transform, so place the app's fixed-overlay caret at the block boundary
    // nearest the pointer (all client-rect math).
    const onDragOver = (e: DragEvent) => {
      if (!draggingRef.current) return;
      const b = nearestBoundary(e.clientY);
      if (!b) return;
      // Chromium forbids the drop outright without a preventDefault here, and
      // nothing below us is left to supply one.
      claim(e);
      const box = pm.getBoundingClientRect();
      showCaretLine(box.left, box.width, b.y);
    };
    const onDrop = (e: DragEvent) => {
      if (!draggingRef.current) return;
      claim(e);
      hideDropCaret();
      const b = nearestBoundary(e.clientY);
      const { index } = current.current;
      if (!b || index < 0) return;
      // Indices into the live document — no positions captured at hover time,
      // no selection consulted. The drop lands on the boundary the caret drew.
      const tr = moveTopLevelBlock(editor.state, index, b.index);
      if (tr) editor.view.dispatch(tr);
    };
    // Anywhere else in the app, the caret must not linger and lie: while a
    // grip drag is outside the zone the drop belongs to the canvas.
    const onWindowDragOver = (e: DragEvent) => {
      if (!draggingRef.current) return;
      if (!(e.target instanceof globalThis.Node && zone.contains(e.target))) hideDropCaret();
    };
    window.addEventListener("mousemove", onMove);
    scroller.addEventListener("scroll", onScroll);
    zone.addEventListener("dragover", onDragOver, true);
    zone.addEventListener("drop", onDrop, true);
    window.addEventListener("dragover", onWindowDragOver);
    return () => {
      window.removeEventListener("mousemove", onMove);
      scroller.removeEventListener("scroll", onScroll);
      zone.removeEventListener("dragover", onDragOver, true);
      zone.removeEventListener("drop", onDrop, true);
      window.removeEventListener("dragover", onWindowDragOver);
    };
  }, [editor, setShown]);

  const openMenu = () => {
    menuOpenRef.current = true;
    setMenuOpen(true);
  };
  const closeMenu = React.useCallback(() => {
    menuOpenRef.current = false;
    setMenuOpen(false);
  }, []);

  // Dismiss on outside press or Esc while the menu is open.
  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as HTMLElement)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  /** Close the menu, then run an action on the block it was opened for. */
  const withBlock = (fn: (node: Node, pos: number) => void) => () => {
    const { node, pos } = current.current;
    closeMenu();
    if (!node || pos < 0) return;
    fn(node, pos);
  };

  const addLineBelow = withBlock((node, pos) => {
    const after = pos + node.nodeSize;
    editor
      .chain()
      .insertContentAt(after, { type: "paragraph" })
      .setTextSelection(after + 1)
      .focus()
      .run();
  });

  const duplicateBlock = withBlock((node, pos) => {
    editor.chain().insertContentAt(pos + node.nodeSize, node.toJSON()).focus().run();
  });

  const deleteBlock = withBlock((node, pos) => {
    editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).focus().run();
  });

  /** Start a native drag carrying only what the OS needs. The document move
   *  is this component's own business (onDrop → moveTopLevelBlock), so the
   *  view is deliberately NOT handed a `dragging` slice: ProseMirror's drop
   *  handler would then delete the current selection rather than the dragged
   *  block. Embed blocks additionally carry the card payload, so dropping them
   *  outside the editor — on the canvas or another card — un-nests them (see
   *  onDragEnd). */
  const onDragStart = (e: React.DragEvent) => {
    const { node, pos } = current.current;
    if (!node || pos < 0) {
      e.preventDefault();
      return;
    }
    const view = editor.view;
    const blockEl = view.nodeDOM(pos) as HTMLElement | null;
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", node.textContent || " ");
    if (node.type.name === "cardEmbed") {
      const target = store.resolveRef(String(node.attrs.target ?? ""));
      if (target) e.dataTransfer.setData(CARD_DRAG_MIME, target.id);
    }
    if (blockEl) {
      // Drag image from an offscreen, untransformed clone: rasterizing the
      // live block inside the canvas's scale() transform yields a giant
      // black slab on Chromium. The clone is captured synchronously at
      // dragstart, so it can be removed on the next tick.
      const ghost = document.createElement("div");
      ghost.className = "ws-block-drag-image";
      ghost.style.width = `${Math.min(280, Math.round(blockEl.getBoundingClientRect().width))}px`;
      ghost.appendChild(blockEl.cloneNode(true));
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      setTimeout(() => ghost.remove(), 0);
    }
    draggingRef.current = true;
  };

  const onDragEnd = (e: React.DragEvent) => {
    draggingRef.current = false;
    hideDropCaret();
    // Nothing to unwind on the view: a grip drag never hands ProseMirror a
    // dragging slice, and PM's own drags never start from this portal button.
    // An embed block dropped OUTSIDE the editor (canvas placement or another
    // card's caret — both accept CARD_DRAG_MIME and mark the handshake) is
    // un-nested: remove the block here; in-editor drops never reach this.
    const { node, pos } = current.current;
    const external = consumeCardDropHandled();
    const overEditor = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest(".ws-card-md-edit");
    if (node?.type.name === "cardEmbed" && external && !overEditor) {
      editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    }
    setShown(null);
  };

  return createPortal(
    <div ref={rootRef} className="ws-block-handles" style={{ display: "none" }}>
      <div ref={wrapRef} className="ws-block-handle-wrap">
        <button
          type="button"
          draggable
          className="ws-block-handle-btn ws-block-grip"
          title="Drag to move · click for actions"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          // No preventDefault on mousedown: starting a native drag is part of
          // mousedown's default action. Menu actions restore focus themselves.
          onClick={() => (menuOpen ? closeMenu() : openMenu())}
        >
          <GripVertical size={14} strokeWidth={2} aria-hidden />
        </button>
        {menuOpen && (
          // preventDefault keeps focus in the editor: menu items are plain
          // divs, and losing focus to body would end the edit session.
          <div className="ws-block-menu" role="menu" onMouseDown={(e) => e.preventDefault()}>
            <div className="ws-block-menu-item" role="menuitem" onClick={addLineBelow}>
              <Plus size={13} strokeWidth={2} aria-hidden /> Add line below
            </div>
            <div className="ws-block-menu-item" role="menuitem" onClick={duplicateBlock}>
              <Copy size={13} strokeWidth={2} aria-hidden /> Duplicate
            </div>
            <div className="ws-block-menu-item danger" role="menuitem" onClick={deleteBlock}>
              <Trash2 size={13} strokeWidth={2} aria-hidden /> Delete
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
