import * as React from "react";
import { FileText, Link } from "lucide-react";
import { useWorkspace } from "./store-context.ts";
import { KindIcon } from "./kind-icons.tsx";
import type { Card, Placement } from "../lib/model/types.ts";
import type { Side } from "./edge-geometry.ts";
import { clipUrl } from "./electron-bridge.ts";
import { CARD_DRAG_MIME } from "./dnd.ts";
import {
  embedHostAt,
  hideDropCaret,
  insertionIndexAt,
  markCardDropHandled,
  showDropCaret,
} from "./drop-caret.ts";
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
  /** A card (library tile / board drag) was dropped onto this note to nest it —
   *  `at` is the block index the drop caret pointed at. */
  onEmbedDrop: (hostCardId: string, droppedCardId: string, at: number) => void;
  /** A board card drag ended over another note — embed instead of move. */
  onDropOnCard: (draggedCardId: string, hostCardId: string, at: number) => void;
  /** An embed mini-card was dragged out of this card's body and released. */
  onEmbedDragOut: (hostCardId: string, childCardId: string, clientX: number, clientY: number) => void;
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
  const store = useWorkspace();
  /** "pdf:<id>" sources point at a PDF card in this workspace — name it. */
  const sourcePdfTitle = (sourceUrl: string): string | null =>
    store.getCard(sourceUrl.slice(4))?.title ?? null;
  const [dragging, setDragging] = React.useState(false);
  // A library tile (or other card payload) hovering this note for embedding.
  const [embedHover, setEmbedHover] = React.useState(false);
  // Block index the drop caret points at while a drag hovers this note.
  const dropIdxRef = React.useRef(0);
  // Every card kind hosts embeds in its body; only an active editor opts out.
  const acceptsEmbed = !editing;
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
      const el = editBoxRef.current?.querySelector(".ws-card-md-scroll");
      if (!el) return;
      const overflow = el.scrollHeight - el.clientHeight;
      const p = placementRef.current;
      if (overflow > 2 && p.h < MAX_AUTO_H) {
        props.onResize(p.id, p.w, Math.min(MAX_AUTO_H, p.h + overflow + 6));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The in-card editor's two faces: rich WYSIWYG or raw markdown source.
  const [srcMode, setSrcMode] = React.useState(false);

  // Entering edit mode: seed the body draft synchronously (the editor mounts
  // this same render, so an effect would hand it a stale draft) and reset to
  // the rich face.
  const wasEditing = React.useRef(false);
  if (editing && !wasEditing.current) {
    bodyDraft.current = card.body;
    if (srcMode) setSrcMode(false); // guarded render-time adjust
  }
  wasEditing.current = editing;

  // Title seeding + grow-to-fit still run post-render.
  React.useEffect(() => {
    if (!editing) return;
    setTitleDraft(card.title);
    growToFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Focus the freshly mounted face after a mode switch (TipTap autofocuses
  // itself on mount; the source textarea does not).
  React.useEffect(() => {
    if (!editing || !srcMode) return;
    (editBoxRef.current?.querySelector(".ws-card-body-input") as HTMLElement | null)?.focus();
  }, [srcMode, editing]);

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
    // ⌘/ flips between rich editing and raw markdown source.
    if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setSrcMode((m) => !m);
    }
  };

  // Commit when focus leaves the card entirely (click on canvas, other card…).
  const onEditBlur = (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return; // moved between fields
    // The ⋮⋮ block handle lives in a body-level portal — grabbing or
    // clicking it must not end the session.
    if ((e.relatedTarget as HTMLElement | null)?.closest?.(".ws-block-handles")) return;
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

  /** The embeddable card under the pointer (excluding this card) during a
   *  board drag — the embed-drop host. */
  const embedHostUnder = (me: PointerEvent): HTMLElement | null =>
    embedHostAt(me.clientX, me.clientY, card.id);

  const startDrag = (
    e: React.PointerEvent,
    mode: "move" | "resize",
    origin: { ox: number; oy: number },
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    wasSelectedAtDown.current = selected;
    // A resize counts as movement from the start — otherwise releasing the
    // corner handle reads as a motionless click and falsely enters edit mode.
    movedRef.current = mode === "resize";
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
        // Hovering another note previews the embed insertion point.
        const host = embedHostUnder(me);
        if (host) showDropCaret(host, me.clientY);
        else hideDropCaret();
      } else {
        props.onResize(
          placement.id,
          Math.max(180, origin.ox + dx),
          Math.max(120, origin.oy + dy),
        );
      }
    };
    const onWinUp = (me: PointerEvent) => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      if (active) setDragging(false);
      hideDropCaret();
      // Release over another note nests instead of moving (⌥ not required).
      if (active && mode === "move") {
        const host = embedHostUnder(me);
        if (host?.dataset.cardId) {
          props.onDropOnCard(card.id, host.dataset.cardId, insertionIndexAt(host, me.clientY));
        }
      }
    };
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
  };

  const beginMove = (e: React.PointerEvent) =>
    startDrag(e, "move", { ox: placement.x, oy: placement.y });
  const beginResize = (e: React.PointerEvent) =>
    startDrag(e, "resize", { ox: placement.w, oy: placement.h });

  const kindLabel =
    card.kind === "note" ? "Note"
    : card.kind === "article" ? "Article"
    : card.kind === "image" ? "Clip"
    : card.kind === "pdf" ? "PDF"
    : "Highlight";

  return (
    <div
      className={`ws-card${selected ? " selected" : ""}${dragging ? " dragging" : ""}${editing ? " editing" : ""}${props.edgeTarget ? " edge-target" : ""}${embedHover ? " embed-target" : ""}`}
      data-card-id={card.id}
      data-embeddable={acceptsEmbed ? "true" : undefined}
      style={{ left: placement.x, top: placement.y, width: placement.w, height: placement.h, zIndex: placement.z }}
      onPointerDown={(e) => { if (!editing) beginMove(e); else props.onSelect(card.id); }}
      onClick={(e) => {
        // Click on an already-selected card (that didn't move and didn't hit
        // an interactive element) opens it for editing.
        if (editing || movedRef.current || !wasSelectedAtDown.current) return;
        if ((e.target as HTMLElement).closest("a, button, input, .ws-wikilink, .ws-card-menu-btn, .ws-resize, .ws-handle")) return;
        props.onOpen(card.id);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!editing) props.onOpen(card.id); }}
      // The canvas opens context menus on right-button release (macOS fires
      // this event already on press, which would beat a right-drag pan).
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      // A card dragged from the library nests into a note on drop. Stop
      // propagation so the canvas doesn't also treat it as a board placement.
      onDragOver={(e) => {
        if (!acceptsEmbed || !e.dataTransfer.types.includes(CARD_DRAG_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        dropIdxRef.current = showDropCaret(e.currentTarget as HTMLElement, e.clientY);
        if (!embedHover) setEmbedHover(true);
      }}
      onDragLeave={() => {
        hideDropCaret();
        setEmbedHover(false);
      }}
      onDrop={(e) => {
        if (!acceptsEmbed) return;
        const id = e.dataTransfer.getData(CARD_DRAG_MIME);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        markCardDropHandled();
        hideDropCaret();
        setEmbedHover(false);
        props.onEmbedDrop(card.id, id, dropIdxRef.current);
      }}
    >
      {/* Inner wrapper owns the rounded-corner clipping so the connector
          handles (positioned half outside the card) don't get sliced. */}
      <div className="ws-card-clip">
      <div className="ws-card-accent" style={{ background: palette.underline }} />
      <div className="ws-card-head">
        <KindIcon kind={card.kind} size={13} />
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
          {/* A textarea so long titles wrap while editing; Enter never inserts
              a newline — it hops into the body instead. */}
          <textarea
            className="ws-card-title-input"
            rows={1}
            value={titleDraft}
            placeholder="Untitled"
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget.closest(".ws-card-edit")
                  ?.querySelector(".ws-card-md-edit, .ws-card-body-input") as HTMLElement | null)?.focus();
              }
            }}
          />
          {card.kind === "image" && (
            <div className="ws-card-imgwrap">
              <img
                className="ws-card-img"
                src={clipUrl(card.image.file)}
                alt={card.title}
                draggable={false}
              />
            </div>
          )}
          {srcMode ? (
            <textarea
              key="src"
              className="ws-card-body-input"
              defaultValue={bodyDraft.current}
              spellCheck={false}
              onChange={(e) => { bodyDraft.current = e.target.value; }}
            />
          ) : (
            <CardMarkdownEditor
              key="wysiwyg"
              value={bodyDraft.current}
              cardId={card.id}
              onChange={(md) => { bodyDraft.current = md; growToFit(); }}
            />
          )}
          <div className="ws-card-edit-hint" aria-hidden="true">
            {navigator.platform.includes("Mac")
              ? `⌘↵ to save · esc to cancel · ⌘/ ${srcMode ? "rich text" : "markdown"}`
              : `Ctrl↵ to save · esc to cancel · Ctrl+/ ${srcMode ? "rich text" : "markdown"}`}
          </div>
        </div>
      ) : (
        <>
          <div className="ws-card-title">
            {card.title || "Untitled"}
          </div>
          {card.kind === "pdf" && card.cover && (
            <div className="ws-card-imgwrap ws-card-pdfcover">
              <img className="ws-card-img" src={clipUrl(card.cover)} alt="" draggable={false} />
            </div>
          )}
          {card.kind === "image" && (
            <div className="ws-card-imgwrap">
              <img
                className="ws-card-img"
                src={clipUrl(card.image.file)}
                alt={card.title}
                draggable={false}
              />
            </div>
          )}
          {/* An empty flex:1 body would steal height from the pdf cover. */}
          {(card.kind !== "pdf" || card.body.trim() !== "") && (
            <div className="ws-card-body">
              <MarkdownView
                body={card.body}
                resolve={props.resolve}
                onOpenCard={props.onOpenCard}
                onCreateLink={props.onCreateLink}
                hostCardId={card.id}
                onEmbedDragOut={(child, x, y) => props.onEmbedDragOut(card.id, child.id, x, y)}
              />
            </div>
          )}
          {card.kind === "pdf" && (
            <div className="ws-card-pdfmeta">
              <KindIcon kind="pdf" size={13} /> {card.pages > 0 ? `${card.pages} page${card.pages === 1 ? "" : "s"}` : "PDF"}
              <span className="ws-card-pdfhint">double-click to read</span>
            </div>
          )}
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
        card.sourceUrl.startsWith("pdf:") ? (
          <div className="ws-card-source">
            <FileText size={11} strokeWidth={2} aria-hidden />{" "}
            {sourcePdfTitle(card.sourceUrl) ?? "PDF"}
          </div>
        ) : (
          <div className="ws-card-source"><Link size={11} strokeWidth={2} aria-hidden /> {hostOf(card.sourceUrl)}</div>
        )
      )}
      </div>
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
