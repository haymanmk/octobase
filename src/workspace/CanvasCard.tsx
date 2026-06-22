import * as React from "react";
import type { Card, Placement } from "../lib/model/types.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import { MarkdownView } from "./MarkdownView.tsx";

export interface CanvasCardProps {
  card: Card;
  placement: Placement;
  selected: boolean;
  scale: number;
  onSelect: (cardId: string) => void;
  onMove: (placementId: string, x: number, y: number) => void;
  onResize: (placementId: string, w: number, h: number) => void;
  onOpen: (cardId: string) => void;
  onContextMenu: (cardId: string, clientX: number, clientY: number) => void;
  resolve: (title: string) => Card | undefined;
  onOpenCard: (card: Card) => void;
  onCreateLink: (title: string) => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function CanvasCard(props: CanvasCardProps): React.ReactElement {
  const { card, placement, selected, scale } = props;
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<null | {
    mode: "move" | "resize";
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  }>(null);

  const palette = PALETTE[card.color] ?? PALETTE.yellow;

  const beginMove = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onSelect(card.id);
    drag.current = {
      mode: "move",
      sx: e.clientX,
      sy: e.clientY,
      ox: placement.x,
      oy: placement.y,
    };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const beginResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = {
      mode: "resize",
      sx: e.clientX,
      sy: e.clientY,
      ox: placement.w,
      oy: placement.h,
    };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (d.mode === "move") {
      props.onMove(placement.id, d.ox + dx, d.oy + dy);
    } else {
      props.onResize(
        placement.id,
        Math.max(180, d.ox + dx),
        Math.max(120, d.oy + dy),
      );
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const kindLabel = card.kind === "note" ? "Note" : card.kind === "article" ? "Article" : "Highlight";

  return (
    <div
      className={`ws-card${selected ? " selected" : ""}${dragging ? " dragging" : ""}`}
      style={{ left: placement.x, top: placement.y, width: placement.w, height: placement.h, zIndex: placement.z }}
      onPointerDown={() => props.onSelect(card.id)}
      onDoubleClick={(e) => { e.stopPropagation(); props.onOpen(card.id); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); props.onContextMenu(card.id, e.clientX, e.clientY); }}
    >
      <div className="ws-card-accent" style={{ background: palette.underline }} />
      <div className="ws-card-head" onPointerDown={beginMove} onPointerMove={onMove} onPointerUp={endDrag}>
        <span className="ws-card-kind">{kindLabel}</span>
        <span
          className="ws-card-menu-btn"
          title="Card menu"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); props.onContextMenu(card.id, e.clientX, e.clientY); }}
        >⋯</span>
      </div>
      <div className="ws-card-title" onPointerDown={beginMove} onPointerMove={onMove} onPointerUp={endDrag}>
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
      <div className="ws-resize" onPointerDown={beginResize} onPointerMove={onMove} onPointerUp={endDrag} />
    </div>
  );
}
