import * as React from "react";
import type { Card, Placement } from "../lib/model/types.ts";
import type { Side } from "./edge-geometry.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import { MarkdownView } from "./MarkdownView.tsx";
import { CardMarkdownEditor } from "./CardMarkdownEditor.tsx";

export interface CanvasCardProps {
  card: Card;
  placement: Placement;
  selected: boolean;
  /** True while this card's title/body are being edited in place. */
  editing: boolean;
  onCommitEdit: (patch: { title?: string; body?: string }) => void;
  onEndEdit: () => void;
  scale: number;
  onSelect: (cardId: string) => void;
  onMove: (placementId: string, x: number, y: number) => void;
  onResize: (placementId: string, w: number, h: number) => void;
  onOpen: (cardId: string) => void;
  onContextMenu: (cardId: string, clientX: number, clientY: number) => void;
  resolve: (title: string) => Card | undefined;
  onOpenCard: (card: Card) => void;
  onCreateLink: (title: string) => void;
  /** Pointer went down on a connector handle — Canvas runs the edge drag. */
  onStartEdge: (cardId: string, side: Side, e: React.PointerEvent) => void;
  /** True while an edge drag hovers this card as its drop target. */
  edgeTarget: boolean;
}

const HANDLE_SIDES: Side[] = ["top", "right", "bottom", "left"];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function CanvasCard(props: CanvasCardProps): React.ReactElement {
  const { card, placement, selected, editing, scale } = props;
  const [dragging, setDragging] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(card.title);
  // The WYSIWYG editor streams markdown into this ref on every keystroke;
  // state would re-render the card for no benefit.
  const bodyDraft = React.useRef(card.body);
  const editBoxRef = React.useRef<HTMLDivElement>(null);

  // While typing, grow the card so the editor never overflows (grow-only —
  // shrinking back automatically would fight manual resizes). Measurements
  // are pre-transform layout px, so they map 1:1 onto placement units.
  // Live values go through a ref: the editor's onUpdate closure is created
  // once, so anything it captures directly would be a stale first render.
  const placementRef = React.useRef(placement);
  placementRef.current = placement;
  const MAX_AUTO_H = 900;
  const growToFit = React.useCallback(() => {
    requestAnimationFrame(() => {
      const el = editBoxRef.current?.querySelector(".ws-card-md-edit");
      if (!el) return;
      const overflow = el.scrollHeight - el.clientHeight;
      const p = placementRef.current;
      if (overflow > 2 && p.h < MAX_AUTO_H) {
        props.onResize(p.id, p.w, Math.min(MAX_AUTO_H, p.h + overflow + 6));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Entering edit mode: seed drafts from the card (the editor autofocuses),
  // and grow immediately if the existing content already overflows.
  React.useEffect(() => {
    if (!editing) return;
    setTitleDraft(card.title);
    bodyDraft.current = card.body;
    growToFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commitEdit = () => {
    const patch: { title?: string; body?: string } = {};
    if (titleDraft !== card.title) patch.title = titleDraft.trim() || "Untitled";
    if (bodyDraft.current.trim() !== card.body.trim()) patch.body = bodyDraft.current;
    if (Object.keys(patch).length > 0) props.onCommitEdit(patch);
  };

  const onEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setTitleDraft(card.title);
      bodyDraft.current = card.body;
      props.onEndEdit();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitEdit();
      props.onEndEdit();
    }
  };

  // Commit when focus leaves the card entirely (click on canvas, other card…).
  const onEditBlur = (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return; // moved between fields
    commitEdit();
    props.onEndEdit();
  };
  const palette = PALETTE[card.color] ?? PALETTE.yellow;

  // Drags run on window-level listeners: they can't lose a fast pointer the
  // way element events do, and — unlike pointer capture on pointerdown —
  // they leave plain clicks alone so links/checkboxes in the body still work.
  // Moves start anywhere on the card after a small threshold.
  // Whether the card was selected before this press, and whether the press
  // turned into a drag — a motionless click on an already-selected card
  // enters edit mode (no double-click needed).
  const wasSelectedAtDown = React.useRef(false);
  const movedRef = React.useRef(false);

  const startDrag = (
    e: React.PointerEvent,
    mode: "move" | "resize",
    origin: { ox: number; oy: number },
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    wasSelectedAtDown.current = selected;
    movedRef.current = false;
    props.onSelect(card.id);
    const sx = e.clientX;
    const sy = e.clientY;
    let active = mode === "resize"; // the resize handle is unambiguous
    if (active) setDragging(true);
    const onWinMove = (me: PointerEvent) => {
      if (!active) {
        if (Math.abs(me.clientX - sx) + Math.abs(me.clientY - sy) <= 3) return;
        active = true;
        movedRef.current = true;
        setDragging(true);
      }
      const dx = (me.clientX - sx) / scale;
      const dy = (me.clientY - sy) / scale;
      if (mode === "move") {
        props.onMove(placement.id, origin.ox + dx, origin.oy + dy);
      } else {
        props.onResize(
          placement.id,
          Math.max(180, origin.ox + dx),
          Math.max(120, origin.oy + dy),
        );
      }
    };
    const onWinUp = () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      if (active) setDragging(false);
    };
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
  };

  const beginMove = (e: React.PointerEvent) =>
    startDrag(e, "move", { ox: placement.x, oy: placement.y });
  const beginResize = (e: React.PointerEvent) =>
    startDrag(e, "resize", { ox: placement.w, oy: placement.h });

  const kindLabel = card.kind === "note" ? "Note" : card.kind === "article" ? "Article" : "Highlight";

  return (
    <div
      className={`ws-card${selected ? " selected" : ""}${dragging ? " dragging" : ""}${editing ? " editing" : ""}${props.edgeTarget ? " edge-target" : ""}`}
      data-card-id={card.id}
      style={{ left: placement.x, top: placement.y, width: placement.w, height: placement.h, zIndex: placement.z }}
      onPointerDown={(e) => { if (!editing) beginMove(e); else props.onSelect(card.id); }}
      onClick={(e) => {
        // Click on an already-selected card (that didn't move and didn't hit
        // an interactive element) opens it for editing.
        if (editing || movedRef.current || !wasSelectedAtDown.current) return;
        if ((e.target as HTMLElement).closest("a, button, input, .ws-wikilink, .ws-card-menu-btn")) return;
        props.onOpen(card.id);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!editing) props.onOpen(card.id); }}
      // The canvas opens context menus on right-button release (macOS fires
      // this event already on press, which would beat a right-drag pan).
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="ws-card-accent" style={{ background: palette.underline }} />
      <div className="ws-card-head">
        <span className="ws-card-kind">{kindLabel}</span>
        <span
          className="ws-card-menu-btn"
          title="Card menu"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); props.onContextMenu(card.id, e.clientX, e.clientY); }}
        >⋯</span>
      </div>
      {editing ? (
        <div ref={editBoxRef} className="ws-card-edit" onBlur={onEditBlur} onKeyDown={onEditKeyDown}
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <input
            className="ws-card-title-input"
            value={titleDraft}
            placeholder="Untitled"
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget.closest(".ws-card-edit")
                  ?.querySelector(".ws-card-md-edit") as HTMLElement | null)?.focus();
              }
            }}
          />
          <CardMarkdownEditor
            value={card.body}
            onChange={(md) => { bodyDraft.current = md; growToFit(); }}
          />
          <div className="ws-card-edit-hint" aria-hidden="true">
            {navigator.platform.includes("Mac") ? "⌘↵" : "Ctrl↵"} to save · esc to cancel
          </div>
        </div>
      ) : (
        <>
          <div className="ws-card-title">
            {card.title || "Untitled"}
          </div>
          <div className="ws-card-body">
            <MarkdownView
              body={card.body}
              resolve={props.resolve}
              onOpenCard={props.onOpenCard}
              onCreateLink={props.onCreateLink}
            />
          </div>
        </>
      )}
      {card.tags.length > 0 && (
        <div className="ws-card-tags">
          {card.tags.slice(0, 5).map((t) => (
            <span key={t} className="ws-card-tag">#{t}</span>
          ))}
        </div>
      )}
      {card.kind !== "note" && "sourceUrl" in card && card.sourceUrl && (
        <div className="ws-card-source">◉ {hostOf(card.sourceUrl)}</div>
      )}
      {!editing &&
        HANDLE_SIDES.map((side) => (
          <div
            key={side}
            className={`ws-handle ws-handle-${side}`}
            title="Drag to connect"
            onPointerDown={(e) => props.onStartEdge(card.id, side, e)}
          />
        ))}
      <div className="ws-resize" onPointerDown={beginResize} />
    </div>
  );
}
