import * as React from "react";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import type { Node } from "@tiptap/pm/model";

/**
 * Milkdown/Notion-style block gutter: hovering a top-level block floats a
 * single ⋮⋮ handle at its left. Hold and drag to move the block; click to
 * open a small action menu (add line below · duplicate · delete). While the
 * menu is open the plugin is locked so the handle doesn't jump blocks; a
 * browser drag suppresses the click, so the two gestures don't collide.
 */
export function BlockHandles({ editor }: { editor: Editor }): React.ReactElement {
  // The hovered block, updated by the plugin. A ref, not state: it changes on
  // every hover and nothing needs to re-render for it.
  const current = React.useRef<{ node: Node | null; pos: number }>({ node: null, pos: -1 });
  const [menuOpen, setMenuOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const onNodeChange = React.useCallback(
    ({ node, pos }: { node: Node | null; editor: Editor; pos: number }) => {
      current.current = { node, pos };
    },
    [],
  );

  // Memoized per the DragHandle docs — a fresh object would re-init the
  // handle every render and break dragging.
  const tippyOptions = React.useMemo(
    () => ({ placement: "left" as const, offset: [0, 4] as [number, number] }),
    [],
  );

  // Lock/unlock via transaction meta. The React DragHandle registers only the
  // ProseMirror plugin — not the extension that defines the lockDragHandle()
  // command — so calling the command throws. The plugin itself just watches
  // for this meta, which the core setMeta command can send directly.
  const openMenu = () => {
    editor.commands.setMeta("lockDragHandle", true);
    setMenuOpen(true);
  };
  const closeMenu = React.useCallback(() => {
    setMenuOpen(false);
    editor.commands.setMeta("lockDragHandle", false);
  }, [editor]);

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

  return (
    <DragHandle
      editor={editor}
      onNodeChange={onNodeChange}
      tippyOptions={tippyOptions}
      className="ws-block-handles"
    >
      <div ref={wrapRef} className="ws-block-handle-wrap">
        <button
          type="button"
          className="ws-block-handle-btn ws-block-grip"
          title="Drag to move · click for actions"
          // No preventDefault on mousedown here: starting a native drag is
          // part of mousedown's default action, so preventing it would kill
          // dragging. Menu actions restore editor focus themselves.
          onClick={() => (menuOpen ? closeMenu() : openMenu())}
        >
          <GripVertical size={14} strokeWidth={2} aria-hidden />
        </button>
        {menuOpen && (
          <div className="ws-block-menu" role="menu">
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
    </DragHandle>
  );
}
