import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { CanvasCard } from "./CanvasCard.tsx";
import { EdgeLayer } from "./EdgeLayer.tsx";
import { edgePath, sideMidpoint, type Anchor, type Point, type Side } from "./edge-geometry.ts";
import type { Card } from "../lib/model/types.ts";

export interface CanvasProps {
  boardId: string;
  selectedCardIds: string[];
  /** Card being edited in place (double-click); null = none. */
  editingCardId: string | null;
  onEndEdit: () => void;
  onSelect: (cardId: string | null) => void;
  /** Marquee selection result (possibly empty). */
  onSelectMany: (cardIds: string[]) => void;
  onOpen: (cardId: string) => void;
  /** A card was dropped from outside the canvas (sidebar inbox drag). */
  onDropCard: (cardId: string, wx: number, wy: number) => void;
  onContextMenu: (cardId: string, x: number, y: number) => void;
  /** Right-click on empty canvas: canvas coords (wx,wy) + screen coords (x,y). */
  onBackgroundContextMenu: (wx: number, wy: number, x: number, y: number) => void;
  /** Nest a card into a note (library-tile drop, or ⌥-release of a card drag). */
  onEmbed: (hostCardId: string, childCardId: string, opts: { removePlacement: boolean }) => void;
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

export { CARD_DRAG_MIME } from "./dnd.ts";
import { CARD_DRAG_MIME } from "./dnd.ts";

interface View {
  tx: number;
  ty: number;
  scale: number;
}

const DEFAULT_VIEW: View = { tx: 60, ty: 60, scale: 1 };

export const Canvas = React.forwardRef<CanvasHandle, CanvasProps>(function Canvas({
  boardId,
  selectedCardIds,
  editingCardId,
  onEndEdit,
  onSelect,
  onSelectMany,
  onOpen,
  onDropCard,
  onContextMenu,
  onBackgroundContextMenu,
  onEmbed,
}: CanvasProps, handleRef): React.ReactElement {
  const store = useWorkspace();
  const ref = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<View>(DEFAULT_VIEW);
  const [panning, setPanning] = React.useState(false);
  // Right-button drag pans; `panned` distinguishes a drag from a plain
  // right-click (which opens a context menu on release).
  const pan = React.useRef<null | { sx: number; sy: number; tx: number; ty: number; panned: boolean }>(null);
  // Left-button drag on empty canvas rubber-bands a selection.
  const marq = React.useRef<null | { sx: number; sy: number; active: boolean }>(null);
  const [marquee, setMarquee] = React.useState<null | { x: number; y: number; w: number; h: number }>(null);
  // Edge state: selection, inline label editing, context menu, and the
  // in-flight handle drag (preview curve + hovered target card).
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const [labelEdgeId, setLabelEdgeId] = React.useState<string | null>(null);
  const [edgeMenu, setEdgeMenu] = React.useState<null | { edgeId: string; x: number; y: number }>(null);
  const [edgePreview, setEdgePreview] = React.useState<null | { from: Anchor; to: Point }>(null);
  const [rewiringEdgeId, setRewiringEdgeId] = React.useState<string | null>(null);
  const [edgeTargetId, setEdgeTargetId] = React.useState<string | null>(null);
  const edgeDragRef = React.useRef<null | { fromCardId: string; from: Anchor }>(null);
  // Window-level drag handlers need the live view, not the closed-over one.
  const viewRef = React.useRef(view);
  viewRef.current = view;

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

  // Reset edge UI when switching boards.
  React.useEffect(() => {
    setSelectedEdgeId(null);
    setLabelEdgeId(null);
    setEdgeMenu(null);
  }, [boardId]);

  // Delete/Backspace removes the selected edge; Escape deselects.
  React.useEffect(() => {
    if (!selectedEdgeId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, [contenteditable=true]")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        store.deleteEdge(selectedEdgeId);
        setSelectedEdgeId(null);
        setEdgeMenu(null);
      }
      if (e.key === "Escape") setSelectedEdgeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdgeId, store]);

  // Dismiss the edge menu on any outside press (same capture-phase pattern
  // as the Workspace menus — cards stop pointer propagation).
  React.useEffect(() => {
    if (!edgeMenu) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.(".ws-ctx")) return;
      setEdgeMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [edgeMenu]);

  /** Drag from a connector handle: preview curve, then create on release. */
  const startEdgeDrag = (cardId: string, side: Side, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = store.getPlacements(boardId).find((pl) => pl.cardId === cardId);
    if (!p) return;
    const from: Anchor = { ...sideMidpoint({ x: p.x, y: p.y, w: p.w, h: p.h }, side), side };
    edgeDragRef.current = { fromCardId: cardId, from };
    const toWorld = (me: PointerEvent): Point => {
      const rect = ref.current!.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: (me.clientX - rect.left - v.tx) / v.scale,
        y: (me.clientY - rect.top - v.ty) / v.scale,
      };
    };
    const cardUnder = (me: PointerEvent) => {
      const el = document
        .elementFromPoint(me.clientX, me.clientY)
        ?.closest(".ws-card") as HTMLElement | null;
      return el?.dataset.cardId ?? null;
    };
    const onMove = (me: PointerEvent) => {
      const d = edgeDragRef.current;
      if (!d) return;
      setEdgePreview({ from: d.from, to: toWorld(me) });
      const tid = cardUnder(me);
      setEdgeTargetId(tid && tid !== d.fromCardId ? tid : null);
    };
    const onUp = (me: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = edgeDragRef.current;
      edgeDragRef.current = null;
      setEdgePreview(null);
      setEdgeTargetId(null);
      if (!d) return;
      const tid = cardUnder(me);
      if (tid && tid !== d.fromCardId) {
        const edge = store.createEdge(boardId, d.fromCardId, tid);
        setSelectedEdgeId(edge.id);
        onSelect(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /**
   * Drag an endpoint dot of the selected edge to re-attach that end to a
   * different card (release elsewhere cancels). This is the wire's "edit
   * mode" — it only exists once an edge is selected, so it can't be confused
   * with drawing a new wire from a card handle.
   */
  const startEndpointDrag = (edgeId: string, end: "from" | "to", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const edge = store.getEdges(boardId).find((ed) => ed.id === edgeId);
    if (!edge) return;
    const rectOfCard = (cardId: string) => {
      const p = store.getPlacements(boardId).find((pl) => pl.cardId === cardId);
      return p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null;
    };
    const a = rectOfCard(edge.fromCardId);
    const b = rectOfCard(edge.toCardId);
    if (!a || !b) return;
    const geo = edgePath(a, b);
    const fixedCardId = end === "from" ? edge.toCardId : edge.fromCardId;
    const fixedAnchor = end === "from" ? geo.to : geo.from;
    setRewiringEdgeId(edgeId);
    const toWorld = (me: PointerEvent): Point => {
      const rect = ref.current!.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: (me.clientX - rect.left - v.tx) / v.scale,
        y: (me.clientY - rect.top - v.ty) / v.scale,
      };
    };
    const cardUnder = (me: PointerEvent) => {
      const el = document
        .elementFromPoint(me.clientX, me.clientY)
        ?.closest(".ws-card") as HTMLElement | null;
      return el?.dataset.cardId ?? null;
    };
    const onMove = (me: PointerEvent) => {
      setEdgePreview({ from: fixedAnchor, to: toWorld(me) });
      const tid = cardUnder(me);
      setEdgeTargetId(tid && tid !== fixedCardId ? tid : null);
    };
    const onUp = (me: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setEdgePreview(null);
      setEdgeTargetId(null);
      setRewiringEdgeId(null);
      const tid = cardUnder(me);
      if (tid && tid !== fixedCardId) store.reconnectEdge(edgeId, end, tid);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const edgeAt = (target: Element | null): string | null =>
    target?.closest?.(".ws-edge-hit, .ws-edge-label")?.getAttribute("data-edge-id") ?? null;

  const isBackground = (target: EventTarget) =>
    target === ref.current || (target as HTMLElement).classList?.contains("ws-canvas-surface");

  const localPoint = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // Right-drag pans from anywhere (even over cards); left-drag on empty
  // canvas rubber-bands a selection. Plain right-click opens the menu on
  // release (macOS fires contextmenu on press, so menus are deferred here).
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      pan.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, panned: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && isBackground(e.target)) {
      marq.current = { sx: e.clientX, sy: e.clientY, active: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Snapshot before queueing state: the updater runs later, and a quick
    // pointerup can null the ref first — dereferencing it inside the updater
    // crashes React mid-render (the "blank screen while panning" bug).
    const p = pan.current;
    if (p) {
      if (!p.panned && Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 3) {
        p.panned = true;
        setPanning(true);
      }
      if (p.panned) {
        const tx = p.tx + (e.clientX - p.sx);
        const ty = p.ty + (e.clientY - p.sy);
        setView((v) => ({ ...v, tx, ty }));
      }
      return;
    }
    const m = marq.current;
    if (m) {
      if (!m.active && Math.abs(e.clientX - m.sx) + Math.abs(e.clientY - m.sy) > 4) m.active = true;
      if (m.active) {
        const a = localPoint(m.sx, m.sy);
        const b = localPoint(e.clientX, e.clientY);
        setMarquee({
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(a.x - b.x),
          h: Math.abs(a.y - b.y),
        });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (e.button === 2 && pan.current) {
      const wasPanned = pan.current.panned;
      pan.current = null;
      setPanning(false);
      if (!wasPanned) {
        // Plain right-click → context menu for the card under the cursor,
        // or the new-card menu on empty canvas. Hit-test by point: pointer
        // capture retargets e.target to the canvas itself.
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const cardEl = under?.closest(".ws-card") as HTMLElement | null;
        const cardId = cardEl?.dataset.cardId;
        const edgeId = cardId ? null : edgeAt(under);
        if (cardId) {
          onContextMenu(cardId, e.clientX, e.clientY);
        } else if (edgeId) {
          setSelectedEdgeId(edgeId);
          setEdgeMenu({ edgeId, x: e.clientX, y: e.clientY });
        } else {
          const { x, y } = screenToCanvas(e.clientX, e.clientY);
          onBackgroundContextMenu(x, y, e.clientX, e.clientY);
        }
      }
      return;
    }
    const m = marq.current;
    if (m) {
      marq.current = null;
      setMarquee(null);
      if (m.active) {
        const a = screenToCanvas(m.sx, m.sy);
        const b = screenToCanvas(e.clientX, e.clientY);
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        const hit = placements
          .filter((p) => p.x < maxX && p.x + p.w > minX && p.y < maxY && p.y + p.h > minY)
          .map((p) => p.cardId);
        onSelectMany(hit);
        setSelectedEdgeId(null);
      } else {
        onSelect(null); // plain click on empty canvas clears the selection
        setSelectedEdgeId(null);
      }
    }
  };

  // Wheel zooms, anchored at the cursor (panning is right-drag).
  // Trackpad pinch arrives as ctrl+wheel and zooms too, just faster.
  const onWheel = (e: React.WheelEvent) => {
    // Scrollable card content under the cursor gets the wheel first: the
    // editor while writing, or a selected card's overflowing body.
    const t = e.target as HTMLElement;
    const scroller =
      t.closest(".ws-card-md-edit") ??
      (t.closest(".ws-card.selected") ? t.closest(".ws-card-body") : null);
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) return;
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
    const edgeId = edgeAt(e.target as Element);
    if (edgeId) {
      setSelectedEdgeId(edgeId);
      setLabelEdgeId(edgeId);
      return;
    }
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("ws-canvas-surface")) return;
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const { card } = store.createNoteOnBoard(boardId, x - 130, y - 20, { title: "Untitled" });
    onOpen(card.id);
  };

  // Menus open from pointerup (right-click without drag) — suppress the
  // native event, which macOS fires already on press.
  const onBgContextMenu = (e: React.MouseEvent) => e.preventDefault();

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
      onClick={(e) => {
        const edgeId = edgeAt(e.target as Element);
        if (edgeId) {
          setSelectedEdgeId(edgeId);
          onSelect(null);
        }
      }}
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
        <EdgeLayer
          edges={store.getEdges(boardId)}
          rectOf={(cardId) => {
            const p = placements.find((pl) => pl.cardId === cardId);
            return p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null;
          }}
          selectedEdgeId={selectedEdgeId}
          editingLabelEdgeId={labelEdgeId}
          onCommitLabel={(id, label) => store.updateEdge(id, { label })}
          onEndLabelEdit={() => setLabelEdgeId(null)}
          preview={edgePreview}
          onEndpointDown={startEndpointDrag}
          rewiringEdgeId={rewiringEdgeId}
        />
        {placements.map((p) => {
          const card = cardById.get(p.cardId);
          if (!card) return null;
          return (
            <CanvasCard
              key={p.id}
              card={card}
              placement={p}
              selected={selectedCardIds.includes(card.id)}
              editing={card.id === editingCardId}
              onCommitEdit={(patch) => store.updateCard(card.id, patch)}
              onEndEdit={onEndEdit}
              scale={view.scale}
              onSelect={(id) => { onSelect(id); setSelectedEdgeId(null); store.bringToFront(p.id); }}
              onStartEdge={startEdgeDrag}
              edgeTarget={card.id === edgeTargetId}
              onEmbedDrop={(hostId, childId) => onEmbed(hostId, childId, { removePlacement: false })}
              onAltDropOnCard={(draggedId, hostId) => onEmbed(hostId, draggedId, { removePlacement: true })}
              onMove={(id, x, y) => {
                // Dragging one card of a multi-selection moves the group.
                // `placements` is the drag-start snapshot (the handler closure
                // is captured then), so deltas stay origin-based.
                const dx = x - p.x;
                const dy = y - p.y;
                if (selectedCardIds.length > 1 && selectedCardIds.includes(p.cardId)) {
                  for (const pl of placements) {
                    if (selectedCardIds.includes(pl.cardId)) {
                      store.updatePlacement(pl.id, { x: pl.x + dx, y: pl.y + dy });
                    }
                  }
                } else {
                  store.updatePlacement(id, { x, y });
                }
              }}
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

      {marquee && (
        <div
          className="ws-marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}

      {edgeMenu && (() => {
        const edge = store.getEdges(boardId).find((ed) => ed.id === edgeMenu.edgeId);
        if (!edge) return null;
        return (
          <div
            className="ws-ctx"
            style={{ left: edgeMenu.x, top: edgeMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="ws-ctx-item" onClick={() => { setLabelEdgeId(edge.id); setEdgeMenu(null); }}>
              <span className="ws-ctx-ico">✎</span> {edge.label ? "Edit label" : "Add label"}
            </div>
            <div className="ws-ctx-item" onClick={() => { store.flipEdge(edge.id); setEdgeMenu(null); }}>
              <span className="ws-ctx-ico">⇄</span> Flip direction
            </div>
            <div className="ws-ctx-item" onClick={() => { store.updateEdge(edge.id, { directed: !edge.directed }); setEdgeMenu(null); }}>
              <span className="ws-ctx-ico">➤</span> {edge.directed ? "Hide arrowhead" : "Show arrowhead"}
            </div>
            <div className="ws-ctx-sep" />
            <div className="ws-ctx-item danger" onClick={() => { store.deleteEdge(edge.id); setSelectedEdgeId(null); setEdgeMenu(null); }}>
              <span className="ws-ctx-ico">🗑</span> Delete connection
            </div>
          </div>
        );
      })()}

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
