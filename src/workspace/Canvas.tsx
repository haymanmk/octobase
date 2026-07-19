import * as React from "react";
import { ArrowLeftRight, MousePointer2, Pencil, RotateCw, Trash2, Ungroup } from "lucide-react";
import { useWorkspace } from "./store-context.ts";
import { CanvasCard } from "./CanvasCard.tsx";
import { EdgeLayer } from "./EdgeLayer.tsx";
import { GroupLayer } from "./GroupLayer.tsx";
import { edgePath, nearestSide, sideMidpoint, type Anchor, type Point, type Side } from "./edge-geometry.ts";
import type { Card, Group } from "../lib/model/types.ts";
import { CHIP_H, CHIP_W, groupOf, hiddenCardIds, membersOf, routeEdge } from "../lib/model/groups.ts";

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
  /** OS files (e.g. .pdf) dropped onto the canvas. */
  onDropFiles: (files: File[], wx: number, wy: number) => void;
  onContextMenu: (cardId: string, x: number, y: number) => void;
  /** Right-click on empty canvas: canvas coords (wx,wy) + screen coords (x,y). */
  onBackgroundContextMenu: (wx: number, wy: number, x: number, y: number) => void;
  /** Nest a card into a note (library-tile drop, or ⌥-release of a card drag). */
  onEmbed: (hostCardId: string, childCardId: string, opts: { removePlacement: boolean }) => void;
  /**
   * A reference (embed mini-card / wikilink) inside a card body was clicked.
   * `near` is a world position close to the host card, for placing targets
   * that aren't on the board yet.
   */
  onOpenRef: (cardId: string, near: { x: number; y: number }) => void;
}

/** Imperative surface for callers that receive screen-space points (drops). */
export interface CanvasHandle {
  /** Convert renderer-local screen coords to canvas world coords. */
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Whether a renderer-local screen point is over the canvas element. */
  containsPoint: (clientX: number, clientY: number) => boolean;
  /** Recenter/zoom the view so every placed card is visible. */
  zoomToFit: () => void;
  /** Pan (animated) so this world rect is centered; zoom stays, clamped ≥0.5. */
  centerOn: (rect: { x: number; y: number; w: number; h: number }) => void;
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
  onDropFiles,
  onContextMenu,
  onBackgroundContextMenu,
  onEmbed,
  onOpenRef,
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
  // Group state: inline rename and the frame context menu.
  const [renamingGroupId, setRenamingGroupId] = React.useState<string | null>(null);
  const [groupMenu, setGroupMenu] = React.useState<null | { groupId: string; x: number; y: number }>(null);
  // Measured sizes of collapsed chips (world units), so rerouted edges anchor
  // on the pill the user sees; CHIP_W/H are only the pre-measure fallback.
  const [chipSizes, setChipSizes] = React.useState<Map<string, { w: number; h: number }>>(
    () => new Map(),
  );
  const reportChipSize = React.useCallback(
    (groupId: string, size: { w: number; h: number } | null) => {
      setChipSizes((prev) => {
        const cur = prev.get(groupId);
        if (size ? cur && cur.w === size.w && cur.h === size.h : !cur) return prev;
        const next = new Map(prev);
        if (size) next.set(groupId, size);
        else next.delete(groupId);
        return next;
      });
    },
    [],
  );
  // Window-level drag handlers need the live view, not the closed-over one.
  const viewRef = React.useRef(view);
  viewRef.current = view;

  // Reset the view when switching boards.
  React.useEffect(() => {
    setView(DEFAULT_VIEW);
  }, [boardId]);

  const version = store.getVersion();
  const placements = store.getPlacements(boardId);
  const groups = store.getGroups(boardId);
  // Members of collapsed frames stay in the data but leave the render.
  const hiddenIds = hiddenCardIds(groups, placements);
  const visiblePlacements = hiddenIds.size === 0
    ? placements
    : placements.filter((p) => !hiddenIds.has(p.cardId));
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

  // Pan (tweened) so a world rect sits centered in the viewport — the TOC's
  // jump-to-card. Keeps the current zoom, but never lands below a readable
  // minimum. A new jump cancels the tween in flight.
  const centerTweenRef = React.useRef(0);
  const centerOn = React.useCallback(
    (r: { x: number; y: number; w: number; h: number }) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      cancelAnimationFrame(centerTweenRef.current);
      const from = viewRef.current;
      const scale = Math.max(from.scale, 0.5);
      const to = {
        scale,
        tx: rect.width / 2 - (r.x + r.w / 2) * scale,
        ty: rect.height / 2 - (r.y + r.h / 2) * scale,
      };
      const t0 = performance.now();
      const DUR = 260;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / DUR);
        const e = 1 - (1 - t) ** 3; // ease-out cubic
        setView({
          scale: from.scale + (to.scale - from.scale) * e,
          tx: from.tx + (to.tx - from.tx) * e,
          ty: from.ty + (to.ty - from.ty) * e,
        });
        if (t < 1) centerTweenRef.current = requestAnimationFrame(step);
      };
      centerTweenRef.current = requestAnimationFrame(step);
    },
    [],
  );

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
      centerOn,
    }),
    // screenToCanvas closes over `view`; refresh the handle when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, zoomToFit, centerOn],
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

  /** Client point → world coords, reading the live view (drag handlers). */
  const toWorld = (me: PointerEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (me.clientX - rect.left - v.tx) / v.scale,
      y: (me.clientY - rect.top - v.ty) / v.scale,
    };
  };

  /**
   * The card an edge drag would drop onto — a world-space hit test against
   * placement rects inflated by a screen-constant margin. The tolerance is
   * the point: the connector dots sit half OUTSIDE the card border, and
   * aiming at one must count as hitting the card, not the empty canvas.
   */
  const cardUnder = (me: PointerEvent): string | null => {
    const w = toWorld(me);
    const pad = 14 / viewRef.current.scale;
    let best: { id: string; z: number } | null = null;
    for (const p of visiblePlacements) {
      if (
        w.x >= p.x - pad && w.x <= p.x + p.w + pad &&
        w.y >= p.y - pad && w.y <= p.y + p.h + pad
      ) {
        if (!best || p.z > best.z) best = { id: p.cardId, z: p.z };
      }
    }
    return best?.id ?? null;
  };

  /** Drag from a connector handle: preview curve, then create on release. */
  const startEdgeDrag = (cardId: string, side: Side, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = store.getPlacements(boardId).find((pl) => pl.cardId === cardId);
    if (!p) return;
    const from: Anchor = { ...sideMidpoint({ x: p.x, y: p.y, w: p.w, h: p.h }, side), side };
    edgeDragRef.current = { fromCardId: cardId, from };
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
        // Pin both anchors to the dots the user drew: the handle they
        // started from and the target side nearest to their release point.
        const tp = store.getPlacements(boardId).find((pl) => pl.cardId === tid);
        const toSide = tp
          ? nearestSide({ x: tp.x, y: tp.y, w: tp.w, h: tp.h }, toWorld(me))
          : null;
        const edge = store.createEdge(boardId, d.fromCardId, tid, {
          fromSide: d.from.side,
          toSide,
        });
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
    const geo = edgePath(a, b, edge.fromSide ?? null, edge.toSide ?? null);
    const fixedCardId = end === "from" ? edge.toCardId : edge.fromCardId;
    const fixedAnchor = end === "from" ? geo.to : geo.from;
    setRewiringEdgeId(edgeId);
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
      if (tid && tid !== fixedCardId) {
        // Pin the endpoint to the dot it was dropped on — including a
        // different dot of the same card (moving the anchor).
        const tp = store.getPlacements(boardId).find((pl) => pl.cardId === tid);
        const side = tp
          ? nearestSide({ x: tp.x, y: tp.y, w: tp.w, h: tp.h }, toWorld(me))
          : null;
        store.reconnectEdge(edgeId, end, tid, side);
      }
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

  // ---- group interactions ---------------------------------------------------

  /** Drag a frame pill or collapsed chip; a motionless chip click expands. */
  const startGroupMove = (group: Group, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    let last = toWorld(e.nativeEvent);
    let moved = false;
    const onMove = (me: PointerEvent) => {
      if (!moved && Math.abs(me.clientX - sx) + Math.abs(me.clientY - sy) <= 3) return;
      moved = true;
      const w = toWorld(me);
      store.moveGroup(group.id, w.x - last.x, w.y - last.y);
      last = w;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved && group.collapsed) store.updateGroup(group.id, { collapsed: false });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startGroupResize = (group: Group, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const start = toWorld(e.nativeEvent);
    const { w: ow, h: oh } = group;
    const onMove = (me: PointerEvent) => {
      const w = toWorld(me);
      store.updateGroup(group.id, {
        w: Math.max(160, ow + (w.x - start.x)),
        h: Math.max(100, oh + (w.y - start.y)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ⌘G wraps the current selection in a new named frame, name ready to type.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "g") return;
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, [contenteditable=true]")) return;
      const selected = placements.filter((p) => selectedCardIds.includes(p.cardId));
      if (selected.length === 0) return;
      e.preventDefault();
      const minX = Math.min(...selected.map((p) => p.x));
      const minY = Math.min(...selected.map((p) => p.y));
      const maxX = Math.max(...selected.map((p) => p.x + p.w));
      const maxY = Math.max(...selected.map((p) => p.y + p.h));
      // Extra headroom on top so the name pill doesn't sit on a card.
      const g = store.createGroup(boardId, {
        name: "Group",
        x: minX - 24,
        y: minY - 48,
        w: maxX - minX + 48,
        h: maxY - minY + 72,
      });
      setRenamingGroupId(g.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCardIds, boardId, store, version]);

  // Dismiss the group menu on any outside press (same pattern as edge menu).
  React.useEffect(() => {
    if (!groupMenu) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.(".ws-ctx")) return;
      setGroupMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [groupMenu]);

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
        const hit = visiblePlacements
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
        const t = e.dataTransfer.types;
        if (t.includes(CARD_DRAG_MIME) || t.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        const id = e.dataTransfer.getData(CARD_DRAG_MIME);
        if (id) {
          e.preventDefault();
          onDropCard(id, x, y);
          return;
        }
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault();
          onDropFiles(Array.from(e.dataTransfer.files), x, y);
        }
      }}
    >
      <div
        className="ws-canvas-surface"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
      >
        <GroupLayer
          groups={groups}
          memberCount={(g) => membersOf(g, placements, groups).length}
          renamingId={renamingGroupId}
          onBeginRename={(g) => setRenamingGroupId(g.id)}
          onCommitRename={(g, name) => store.updateGroup(g.id, { name: name.trim() || "Untitled" })}
          onEndRename={() => setRenamingGroupId(null)}
          onToggleCollapse={(g) => store.updateGroup(g.id, { collapsed: !g.collapsed })}
          onStartMove={startGroupMove}
          onStartResize={startGroupResize}
          onMenu={(g, x, y) => setGroupMenu({ groupId: g.id, x, y })}
          onChipSize={reportChipSize}
        />
        <EdgeLayer
          // Edges into a collapsed group stay visible, redrawn (dashed) to the
          // chip; only edges fully inside one collapsed group disappear. A
          // rerouted end drops its pinned side — the pin belongs to the card,
          // not the chip standing in for it.
          edges={store.getEdges(boardId).flatMap((e) => {
            const r = routeEdge(e.fromCardId, e.toCardId, groups, placements);
            if (r.hidden) return [];
            return [{
              ...e,
              fromSide: r.fromChip ? null : e.fromSide,
              toSide: r.toChip ? null : e.toSide,
            }];
          })}
          indirectEdgeIds={new Set(
            store.getEdges(boardId)
              .filter((e) => {
                const r = routeEdge(e.fromCardId, e.toCardId, groups, placements);
                return !r.hidden && (r.fromChip || r.toChip);
              })
              .map((e) => e.id),
          )}
          rectOf={(cardId) => {
            const p = placements.find((pl) => pl.cardId === cardId);
            if (!p) return null;
            const g = groupOf(p, groups);
            if (g?.collapsed) {
              const size = chipSizes.get(g.id);
              return { x: g.x, y: g.y, w: size?.w ?? CHIP_W, h: size?.h ?? CHIP_H };
            }
            return { x: p.x, y: p.y, w: p.w, h: p.h };
          }}
          selectedEdgeId={selectedEdgeId}
          editingLabelEdgeId={labelEdgeId}
          onCommitLabel={(id, label) => store.updateEdge(id, { label })}
          onEndLabelEdit={() => setLabelEdgeId(null)}
          preview={edgePreview}
          onEndpointDown={startEndpointDrag}
          rewiringEdgeId={rewiringEdgeId}
        />
        {visiblePlacements.map((p) => {
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
              onOpenCard={(c) => onOpenRef(c.id, { x: p.x + 40, y: p.y + 40 })}
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
              <span className="ws-ctx-ico"><Pencil size={13} strokeWidth={2} aria-hidden /></span> {edge.label ? "Edit label" : "Add label"}
            </div>
            <div className="ws-ctx-item" onClick={() => { store.flipEdge(edge.id); setEdgeMenu(null); }}>
              <span className="ws-ctx-ico"><ArrowLeftRight size={13} strokeWidth={2} aria-hidden /></span> Flip direction
            </div>
            <div className="ws-ctx-item" onClick={() => { store.updateEdge(edge.id, { directed: !edge.directed }); setEdgeMenu(null); }}>
              <span className="ws-ctx-ico"><MousePointer2 size={13} strokeWidth={2} aria-hidden /></span> {edge.directed ? "Hide arrowhead" : "Show arrowhead"}
            </div>
            {(edge.fromSide || edge.toSide) && (
              <div className="ws-ctx-item" onClick={() => { store.updateEdge(edge.id, { fromSide: null, toSide: null }); setEdgeMenu(null); }}>
                <span className="ws-ctx-ico"><RotateCw size={13} strokeWidth={2} aria-hidden /></span> Route automatically
              </div>
            )}
            <div className="ws-ctx-sep" />
            <div className="ws-ctx-item danger" onClick={() => { store.deleteEdge(edge.id); setSelectedEdgeId(null); setEdgeMenu(null); }}>
              <span className="ws-ctx-ico"><Trash2 size={13} strokeWidth={2} aria-hidden /></span> Delete connection
            </div>
          </div>
        );
      })()}

      {groupMenu && (() => {
        const group = groups.find((g) => g.id === groupMenu.groupId);
        if (!group) return null;
        return (
          <div
            className="ws-ctx"
            style={{ left: groupMenu.x, top: groupMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="ws-ctx-item" onClick={() => { setRenamingGroupId(group.id); setGroupMenu(null); }}>
              <span className="ws-ctx-ico"><Pencil size={13} strokeWidth={2} aria-hidden /></span> Rename group
            </div>
            <div className="ws-ctx-item" onClick={() => { store.updateGroup(group.id, { collapsed: !group.collapsed }); setGroupMenu(null); }}>
              <span className="ws-ctx-ico">{group.collapsed ? "▾" : "▸"}</span> {group.collapsed ? "Expand" : "Collapse"}
            </div>
            <div className="ws-ctx-sep" />
            <div className="ws-ctx-item danger" onClick={() => { store.deleteGroup(group.id); setGroupMenu(null); }}>
              <span className="ws-ctx-ico"><Ungroup size={13} strokeWidth={2} aria-hidden /></span> Ungroup (keep cards)
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
