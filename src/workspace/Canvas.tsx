import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { CanvasCard } from "./CanvasCard.tsx";
import type { Card } from "../lib/model/types.ts";

export interface CanvasProps {
  boardId: string;
  selectedCardId: string | null;
  /** Card being edited in place (double-click); null = none. */
  editingCardId: string | null;
  onEndEdit: () => void;
  onSelect: (cardId: string | null) => void;
  onOpen: (cardId: string) => void;
  /** A card was dropped from outside the canvas (sidebar inbox drag). */
  onDropCard: (cardId: string, wx: number, wy: number) => void;
  onContextMenu: (cardId: string, x: number, y: number) => void;
  /** Right-click on empty canvas: canvas coords (wx,wy) + screen coords (x,y). */
  onBackgroundContextMenu: (wx: number, wy: number, x: number, y: number) => void;
}

/** Imperative surface for callers that receive screen-space points (drops). */
export interface CanvasHandle {
  /** Convert renderer-local screen coords to canvas world coords. */
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Whether a renderer-local screen point is over the canvas element. */
  containsPoint: (clientX: number, clientY: number) => boolean;
  /** Recenter/zoom the view so every placed card is visible. */
  zoomToFit: () => void;
}

export const CARD_DRAG_MIME = "application/x-octobase-card";

interface View {
  tx: number;
  ty: number;
  scale: number;
}

const DEFAULT_VIEW: View = { tx: 60, ty: 60, scale: 1 };

export const Canvas = React.forwardRef<CanvasHandle, CanvasProps>(function Canvas({
  boardId,
  selectedCardId,
  editingCardId,
  onEndEdit,
  onSelect,
  onOpen,
  onDropCard,
  onContextMenu,
  onBackgroundContextMenu,
}: CanvasProps, handleRef): React.ReactElement {
  const store = useWorkspace();
  const ref = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<View>(DEFAULT_VIEW);
  const [panning, setPanning] = React.useState(false);
  const pan = React.useRef<null | { sx: number; sy: number; tx: number; ty: number }>(null);

  // Reset the view when switching boards.
  React.useEffect(() => {
    setView(DEFAULT_VIEW);
  }, [boardId]);

  const version = store.getVersion();
  const placements = store.getPlacements(boardId);
  const cardById = React.useMemo(() => {
    const m = new Map<string, Card>();
    for (const c of store.getCards()) m.set(c.id, c);
    return m;
    // `version` changes on every store mutation, driving the re-memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version]);

  const resolve = React.useCallback(
    (title: string) =>
      store.getCards().find((c) => c.title.trim().toLowerCase() === title.trim().toLowerCase()),
    [store],
  );

  const screenToCanvas = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  };

  // Recenter/zoom so the bounding box of all placements fits the viewport.
  const zoomToFit = React.useCallback(() => {
    const el = ref.current;
    const pls = store.getPlacements(boardId);
    if (!el || pls.length === 0) {
      setView(DEFAULT_VIEW);
      return;
    }
    const minX = Math.min(...pls.map((p) => p.x));
    const minY = Math.min(...pls.map((p) => p.y));
    const maxX = Math.max(...pls.map((p) => p.x + p.w));
    const maxY = Math.max(...pls.map((p) => p.y + p.h));
    const pad = 60;
    const rect = el.getBoundingClientRect();
    const scale = Math.min(
      2.2,
      Math.max(
        0.35,
        Math.min(
          (rect.width - pad * 2) / Math.max(1, maxX - minX),
          (rect.height - pad * 2) / Math.max(1, maxY - minY),
          1.4,
        ),
      ),
    );
    setView({
      scale,
      tx: (rect.width - (maxX - minX) * scale) / 2 - minX * scale,
      ty: (rect.height - (maxY - minY) * scale) / 2 - minY * scale,
    });
  }, [store, boardId]);

  React.useImperativeHandle(
    handleRef,
    () => ({
      screenToWorld: (clientX, clientY) => screenToCanvas(clientX, clientY),
      containsPoint: (clientX, clientY) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return false;
        return (
          clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top && clientY <= rect.bottom
        );
      },
      zoomToFit,
    }),
    // screenToCanvas closes over `view`; refresh the handle when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, zoomToFit],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("ws-canvas-surface")) {
      return;
    }
    onSelect(null);
    if (e.button !== 0) return;
    pan.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    setView((v) => ({
      ...v,
      tx: pan.current!.tx + (e.clientX - pan.current!.sx),
      ty: pan.current!.ty + (e.clientY - pan.current!.sy),
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pan.current = null;
    setPanning(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  // Wheel zooms, anchored at the cursor (panning is left-drag on the canvas).
  // Trackpad pinch arrives as ctrl+wheel and zooms too, just faster.
  const onWheel = (e: React.WheelEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const speed = e.ctrlKey || e.metaKey ? 0.008 : 0.0015;
    setView((v) => {
      const factor = Math.exp(-e.deltaY * speed);
      const scale = Math.min(2.2, Math.max(0.35, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("ws-canvas-surface")) return;
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const { card } = store.createNoteOnBoard(boardId, x - 130, y - 20, { title: "Untitled" });
    onOpen(card.id);
  };

  const onBgContextMenu = (e: React.MouseEvent) => {
    // Only on empty canvas — cards stop propagation in their own handler.
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("ws-canvas-surface")) return;
    e.preventDefault();
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    onBackgroundContextMenu(x, y, e.clientX, e.clientY);
  };

  return (
    <div
      ref={ref}
      className={`ws-canvas${panning ? " panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onContextMenu={onBgContextMenu}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(CARD_DRAG_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(CARD_DRAG_MIME);
        if (!id) return;
        e.preventDefault();
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        onDropCard(id, x, y);
      }}
    >
      <div
        className="ws-canvas-surface"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
      >
        {placements.map((p) => {
          const card = cardById.get(p.cardId);
          if (!card) return null;
          return (
            <CanvasCard
              key={p.id}
              card={card}
              placement={p}
              selected={card.id === selectedCardId}
              editing={card.id === editingCardId}
              onCommitEdit={(patch) => store.updateCard(card.id, patch)}
              onEndEdit={onEndEdit}
              scale={view.scale}
              onSelect={(id) => { onSelect(id); store.bringToFront(p.id); }}
              onMove={(id, x, y) => store.updatePlacement(id, { x, y })}
              onResize={(id, w, h) => store.updatePlacement(id, { w, h })}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              resolve={resolve}
              onOpenCard={(c) => {
                // Ensure the linked card is on this board, then open it.
                if (!store.getPlacements(boardId).some((pl) => pl.cardId === c.id)) {
                  store.placeCard(boardId, c.id, p.x + 40, p.y + 40);
                }
                onOpen(c.id);
              }}
              onCreateLink={(title) => {
                const created = store.createNoteOnBoard(boardId, p.x + 40, p.y + 60, { title });
                onOpen(created.card.id);
              }}
            />
          );
        })}
      </div>

      {placements.length === 0 && (
        <div className="ws-canvas-empty">
          <div>
            <strong>An empty page awaits</strong>
            Double-click anywhere to write your first card.
          </div>
        </div>
      )}
    </div>
  );
});
