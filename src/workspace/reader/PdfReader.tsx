import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeftRight, ListTree, Minus, Plus, Scissors, Search } from "lucide-react";
import { useWorkspace } from "../store-context.ts";
import { PALETTE } from "../../components/highlighter/colors.ts";
import { ensureToolbarStyles } from "../../components/highlighter/toolbar-ui.ts";
import { HIGHLIGHT_COLORS } from "../../types/highlight.ts";
import { describeAnchorFromRange } from "../../lib/anchor/text-anchor.ts";
import { pdfSourceUrl, type HighlightCard, type HighlightColor, type ImageCard, type PdfCard } from "../../lib/model/types.ts";
import { getPdfBridge, pdfUrl } from "../electron-bridge.ts";
import {
  locateHighlights,
  bandsFor,
  highlightAtOffset,
  offsetFromPoint,
  type PlacedHighlight,
  type HighlightBand,
} from "./highlight-overlay.ts";
import {
  destToPageIndex,
  loadPdf,
  pageBaseSizes,
  pageText,
  renderPage,
  type PDFDocumentProxy,
} from "./pdf-doc.ts";
import { findHits, stepHit, type SearchHit } from "./pdf-search.ts";
import { flattenOutline, type FlatOutlineItem } from "./pdf-outline.ts";

export interface PdfReaderProps {
  cardId: string;
  /** Scroll this highlight into view (at: nonce so repeats re-fire). */
  focusHighlight?: { id: string; at: number } | null;
  /** Scroll this clip's frame into view (at: nonce so repeats re-fire). */
  focusClip?: { id: string; at: number } | null;
  /** A highlight was hold-dragged out of the PDF and released here. */
  onDropHighlight?: (cardId: string, clientX: number, clientY: number) => void;
}

const HOLD_MS = 250;
const MOVE_CANCEL_PX = 5;
const PAGE_GAP = 16;
const FIT_PAD = 32;

/** A highlight card's body is its note. */
function noteOfHighlight(card: HighlightCard): string {
  return card.body;
}

/** Build a Range over [start, end) character offsets of a container's text. */
function rangeFromOffsets(container: HTMLElement, start: number, end: number): Range | null {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let a: { node: Node; offset: number } | null = null;
  let b: { node: Node; offset: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    if (!a && acc + len >= start) a = { node, offset: start - acc };
    if (acc + len >= end) { b = { node, offset: end - acc }; break; }
    acc += len;
  }
  if (!a || !b) return null;
  const range = container.ownerDocument.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/**
 * The PDF reader tab: pdf.js pages with a selectable text layer, annotated
 * with the same pill / edit popover / marker bands as the article reader,
 * plus a floating toolbar (pages, zoom, search, outline, clip). Highlights
 * anchor to a page's text; clips crop the rendered page canvas.
 */
export function PdfReader({
  cardId,
  focusHighlight,
  focusClip,
  onDropHighlight,
}: PdfReaderProps): React.ReactElement | null {
  const store = useWorkspace();
  const version = store.getVersion();
  const card = store.getCard(cardId) as PdfCard | undefined;
  const bridge = React.useMemo(() => getPdfBridge(), []);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pageRefs = React.useRef(new Map<number, HTMLDivElement>());
  const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null);
  const [baseSizes, setBaseSizes] = React.useState<Array<{ width: number; height: number }>>([]);
  const [scale, setScale] = React.useState(1);
  const [fitMode, setFitMode] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // Which pages have a live render at which scale.
  const renderedRef = React.useRef(new Map<number, number>());
  const renderingRef = React.useRef(new Set<number>());
  const [renderTick, setRenderTick] = React.useState(0);
  const [visible, setVisible] = React.useState<Set<number>>(new Set([1]));
  const [currentPage, setCurrentPage] = React.useState(1);

  // Annotation state (mirrors Reader.tsx).
  const placedRef = React.useRef(new Map<number, PlacedHighlight[]>());
  const [bandsByPage, setBandsByPage] = React.useState<Map<number, HighlightBand[]>>(new Map());
  const [selToolbar, setSelToolbar] = React.useState<{ x: number; y: number } | null>(null);
  const [pulse, setPulse] = React.useState(false);
  const pendingSel = React.useRef<{ range: Range; page: number } | null>(null);
  const [editPop, setEditPop] = React.useState<{ cardId: string; x: number; y: number } | null>(null);
  const [dragGhost, setDragGhost] = React.useState<{ text: string; color: HighlightColor; x: number; y: number } | null>(null);
  const ghostUp = !!dragGhost;
  React.useEffect(() => {
    if (!ghostUp) return;
    document.body.style.cursor = "grabbing";
    return () => { document.body.style.cursor = ""; };
  }, [ghostUp]);
  // Backfill covers for PDFs imported before covers existed.
  React.useEffect(() => {
    if (!card || card.cover) return;
    void import("../pdf-cover.ts").then(({ ensurePdfCover }) => ensurePdfCover(card, store));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);
  const hold = React.useRef<null | { cardId: string; sx: number; sy: number; timer: ReturnType<typeof setTimeout> }>(null);
  const draggedRef = React.useRef(false);
  const focusDoneRef = React.useRef(0);
  const clipFocusDoneRef = React.useRef(0);
  const [clipPing, setClipPing] = React.useState<{ id: string; at: number } | null>(null);

  // Toolbar features.
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [hitIdx, setHitIdx] = React.useState(-1);
  const [flash, setFlash] = React.useState<null | { page: number; index: number; length: number; at: number }>(null);
  const [flashBands, setFlashBands] = React.useState<HighlightBand[]>([]);
  const [flashPage, setFlashPage] = React.useState(0);
  const pageTextsRef = React.useRef<string[]>([]);
  const [outlineOpen, setOutlineOpen] = React.useState(false);
  const [outline, setOutline] = React.useState<FlatOutlineItem[]>([]);
  const [clipMode, setClipMode] = React.useState(false);
  const clipDrag = React.useRef<null | { page: number; sx: number; sy: number }>(null);
  const [clipRect, setClipRect] = React.useState<null | { page: number; x: number; y: number; w: number; h: number }>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const noteTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlights = React.useMemo(
    () => (card ? store.getHighlightsForUrl(pdfSourceUrl(card.id)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, card?.id, version],
  );

  // Image cards clipped from this PDF that still know where they came from.
  const clips = React.useMemo(
    () =>
      card
        ? store
            .getCards()
            .filter(
              (c): c is ImageCard =>
                c.kind === "image" && c.sourceUrl === pdfSourceUrl(card.id) && !!c.clip,
            )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, card?.id, version],
  );

  const toast = (text: string) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote(text);
    noteTimer.current = setTimeout(() => setNote(null), 2600);
  };

  React.useEffect(() => { ensureToolbarStyles(); }, []);

  // ---- document load --------------------------------------------------------

  React.useEffect(() => {
    if (!card?.file) return;
    let gone = false;
    setDoc(null);
    setLoadError(null);
    renderedRef.current.clear();
    loadPdf(pdfUrl(card.file))
      .then(async (d) => {
        if (gone) return;
        setDoc(d);
        setBaseSizes(await pageBaseSizes(d));
        setOutline(flattenOutline(await d.getOutline()));
        // Page texts power search; extract in the background.
        const texts: string[] = [];
        for (let n = 1; n <= d.numPages; n++) {
          texts.push(await pageText(await d.getPage(n)));
          if (gone) return;
        }
        pageTextsRef.current = texts;
      })
      .catch((err) => { if (!gone) setLoadError(String(err?.message ?? err)); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.file]);

  // Fit-width: track the pane size while fit mode is on.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !fitMode || baseSizes.length === 0) return;
    const fit = () => {
      const maxW = Math.max(...baseSizes.map((s) => s.width));
      setScale(Math.max(0.3, Math.min(3, (el.clientWidth - FIT_PAD * 2) / maxW)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitMode, baseSizes]);

  // ---- page rendering (lazy, scale-aware) -----------------------------------

  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root || baseSizes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n); else next.delete(n);
          }
          return next;
        });
      },
      { root, rootMargin: "50% 0px" },
    );
    for (const el of pageRefs.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [baseSizes]);

  React.useEffect(() => {
    if (!doc) return;
    const wanted = [...visible].sort((a, b) => a - b);
    for (const n of wanted) {
      if (renderedRef.current.get(n) === scale || renderingRef.current.has(n)) continue;
      const host = pageRefs.current.get(n);
      if (!host) continue;
      renderingRef.current.add(n);
      void (async () => {
        try {
          const page = await doc.getPage(n);
          const canvas = host.querySelector("canvas")!;
          const textDiv = host.querySelector(".ws-pdf-text") as HTMLDivElement;
          await renderPage(page, canvas, textDiv, scale);
          renderedRef.current.set(n, scale);
          setRenderTick((t) => t + 1); // triggers band relocation
        } catch (err) {
          console.error(`pdf page ${n} render failed:`, err);
        } finally { renderingRef.current.delete(n); }
      })();
    }
    // renderTick must be a dep: if the scale changes while a page is mid-render,
    // that pass skips it (renderingRef); the finished render bumps the tick so
    // this effect re-runs and re-renders the page at the now-current scale.
    // Without it the page sticks at the old scale — canvas content drifts from
    // the div-based overlay geometry (bands, clip frames) and its highlights
    // vanish (the locate pass skips pages whose rendered scale is stale).
  }, [doc, visible, scale, version, renderTick]);

  // Track the page shown at the viewport middle for the toolbar.
  const onScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    const middle = root.scrollTop + root.clientHeight / 2;
    let acc = PAGE_GAP;
    for (let i = 0; i < baseSizes.length; i++) {
      acc += baseSizes[i].height * scale + PAGE_GAP;
      if (middle < acc) { setCurrentPage(i + 1); return; }
    }
    setCurrentPage(baseSizes.length);
  };

  // ---- highlights: locate + bands per rendered page -------------------------

  React.useEffect(() => {
    const next = new Map<number, HighlightBand[]>();
    placedRef.current = new Map();
    for (const [n, atScale] of renderedRef.current) {
      if (atScale !== scale) continue;
      const host = pageRefs.current.get(n);
      const textEl = host?.querySelector(".ws-pdf-text") as HTMLElement | null;
      if (!host || !textEl) continue;
      const pageHls = highlights.filter((h) => h.page === n);
      if (pageHls.length === 0) continue;
      const placed = locateHighlights(
        textEl,
        pageHls.map((h) => ({ cardId: h.id, color: h.color, anchor: h.anchor })),
      );
      placedRef.current.set(n, placed);
      next.set(n, bandsFor(host, placed));
    }
    setBandsByPage(next);

    // Honor a pending scroll-to-highlight once its page has been located.
    if (focusHighlight && focusHighlight.at !== focusDoneRef.current) {
      const target = highlights.find((h) => h.id === focusHighlight.id);
      if (target?.page) {
        const placed = placedRef.current.get(target.page)?.find((p) => p.cardId === target.id);
        if (placed) {
          focusDoneRef.current = focusHighlight.at;
          const root = scrollRef.current;
          const r = placed.range.getBoundingClientRect();
          if (root && r.height > 0) {
            const s = root.getBoundingClientRect();
            root.scrollTop += r.top - s.top - root.clientHeight / 2 + r.height / 2;
          }
        } else {
          // Bring the page on-screen so the next locate pass can center it.
          pageRefs.current.get(target.page)?.scrollIntoView({ block: "start" });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, renderTick, scale, focusHighlight]);

  // Scroll a clip's frame into view when Read is hit on its image card.
  // Frames are pure geometry (no text locate needed), so this only waits for
  // the page layout (baseSizes) to exist.
  React.useEffect(() => {
    if (!focusClip || focusClip.at === clipFocusDoneRef.current) return;
    const rect = clips.find((c) => c.id === focusClip.id)?.clip;
    if (!rect) return;
    const host = pageRefs.current.get(rect.page);
    const root = scrollRef.current;
    if (!host || !root) return;
    clipFocusDoneRef.current = focusClip.at;
    const r = host.getBoundingClientRect();
    const s = root.getBoundingClientRect();
    root.scrollTop += r.top - s.top + (rect.y + rect.h / 2) * scale - root.clientHeight / 2;
    setClipPing({ id: focusClip.id, at: focusClip.at });
  }, [focusClip, clips, scale, baseSizes]);

  // Search flash: once the hit's page is rendered, band its range briefly.
  React.useEffect(() => {
    if (!flash) return;
    const host = pageRefs.current.get(flash.page);
    const textEl = host?.querySelector(".ws-pdf-text") as HTMLElement | null;
    if (!host || !textEl || renderedRef.current.get(flash.page) !== scale) return;
    const range = rangeFromOffsets(textEl, flash.index, flash.index + flash.length);
    if (!range) return;
    const base = host.getBoundingClientRect();
    const bands: HighlightBand[] = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      bands.push({ cardId: "flash", color: "yellow", x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    }
    setFlashBands(bands);
    setFlashPage(flash.page);
    const r0 = range.getBoundingClientRect();
    const root = scrollRef.current;
    if (root && r0.height > 0) {
      const s = root.getBoundingClientRect();
      root.scrollTop += r0.top - s.top - root.clientHeight / 2;
    }
    const t = setTimeout(() => setFlashBands([]), 1400);
    return () => clearTimeout(t);
  }, [flash, renderTick, scale]);

  // Close the edit popover on outside clicks or Esc.
  React.useEffect(() => {
    if (!editPop) return;
    const onDown = () => setEditPop(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditPop(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [editPop]);

  if (!card) return null;

  // The popover edits highlights and clip frames alike (note/tags/color).
  const editCard = editPop
    ? (store.getCard(editPop.cardId) as HighlightCard | ImageCard | undefined)
    : undefined;

  // ---- pointer plumbing (page hit tests, pill, popover, hold-drag) ----------

  const pageAt = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest(".ws-pdf-page") as HTMLElement | null;
    return el ? Number(el.dataset.page) : null;
  };

  const highlightAtPoint = (clientX: number, clientY: number): PlacedHighlight | null => {
    const n = pageAt(clientX, clientY);
    if (!n) return null;
    const textEl = pageRefs.current.get(n)?.querySelector(".ws-pdf-text") as HTMLElement | null;
    if (!textEl) return null;
    const off = offsetFromPoint(textEl, clientX, clientY);
    if (off == null) return null;
    return highlightAtOffset(placedRef.current.get(n) ?? [], off);
  };

  /** The clip frame (if any) under the pointer — frames are pointer-events:
   *  none so text under them stays selectable; hit-test geometrically. */
  const clipAtPoint = (clientX: number, clientY: number): ImageCard | null => {
    const n = pageAt(clientX, clientY);
    const host = n ? pageRefs.current.get(n) : null;
    if (!n || !host) return null;
    const b = host.getBoundingClientRect();
    const x = clientX - b.left;
    const y = clientY - b.top;
    return (
      clips.find((c) => {
        const r = c.clip!;
        return (
          r.page === n &&
          x >= r.x * scale && x <= (r.x + r.w) * scale &&
          y >= r.y * scale && y <= (r.y + r.h) * scale
        );
      }) ?? null
    );
  };

  /** Hold-to-drag (shared by highlights and clip frames): after HOLD_MS the
   *  card follows the pointer as a ghost; release hands it to the workspace. */
  const startHoldDrag = (cardId: string, ghost: { text: string; color: HighlightColor }, start: { x: number; y: number }) => {
    const timer = setTimeout(() => {
      draggedRef.current = true;
      setSelToolbar(null);
      window.getSelection()?.removeAllRanges();
      setDragGhost({ text: ghost.text, color: ghost.color, x: start.x, y: start.y });
      const onMove = (me: PointerEvent) =>
        setDragGhost((g) => (g ? { ...g, x: me.clientX, y: me.clientY } : g));
      const onUp = (ue: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setDragGhost(null);
        onDropHighlight?.(cardId, ue.clientX, ue.clientY);
        setTimeout(() => { draggedRef.current = false; }, 0);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }, HOLD_MS);
    hold.current = { cardId, sx: start.x, sy: start.y, timer };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (clipMode) {
      const n = pageAt(e.clientX, e.clientY);
      if (n) clipDrag.current = { page: n, sx: e.clientX, sy: e.clientY };
      return;
    }
    if (e.button !== 0 || !onDropHighlight) return;
    const start = { x: e.clientX, y: e.clientY };
    const hit = highlightAtPoint(e.clientX, e.clientY);
    if (hit) {
      const h = store.getCard(hit.cardId) as HighlightCard | undefined;
      if (h) startHoldDrag(h.id, { text: h.anchor.exact, color: h.color }, start);
      return;
    }
    const clip = clipAtPoint(e.clientX, e.clientY);
    if (clip) startHoldDrag(clip.id, { text: clip.title, color: clip.color }, start);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (clipDrag.current) {
      const d = clipDrag.current;
      const host = pageRefs.current.get(d.page);
      if (!host) return;
      const b = host.getBoundingClientRect();
      const x1 = Math.max(b.left, Math.min(d.sx, e.clientX));
      const y1 = Math.max(b.top, Math.min(d.sy, e.clientY));
      const x2 = Math.min(b.right, Math.max(d.sx, e.clientX));
      const y2 = Math.min(b.bottom, Math.max(d.sy, e.clientY));
      setClipRect({ page: d.page, x: x1 - b.left, y: y1 - b.top, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) });
      return;
    }
    const h = hold.current;
    if (!h) return;
    if (Math.abs(e.clientX - h.sx) > MOVE_CANCEL_PX || Math.abs(e.clientY - h.sy) > MOVE_CANCEL_PX) {
      clearTimeout(h.timer);
      hold.current = null;
    }
  };

  const onPointerUp = () => {
    if (clipDrag.current) {
      void finishClip();
      return;
    }
    if (hold.current) {
      clearTimeout(hold.current.timer);
      hold.current = null;
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if (clipMode || draggedRef.current) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const hit = highlightAtPoint(e.clientX, e.clientY);
    if (hit) {
      setEditPop({ cardId: hit.cardId, x: e.clientX, y: e.clientY + 12 });
      return;
    }
    // Clip frames edit like highlights do: click opens the same popover.
    const clip = clipAtPoint(e.clientX, e.clientY);
    if (clip) setEditPop({ cardId: clip.id, x: e.clientX, y: e.clientY + 12 });
  };

  const onMouseUp = () => {
    if (clipMode) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelToolbar(null); return; }
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const pageEl = (container instanceof Element ? container : container.parentElement)
      ?.closest(".ws-pdf-page") as HTMLElement | null;
    if (!pageEl) { setSelToolbar(null); return; }
    pendingSel.current = { range: range.cloneRange(), page: Number(pageEl.dataset.page) };
    const rect = range.getBoundingClientRect();
    setSelToolbar({ x: rect.left, y: rect.bottom + 10 });
  };

  const makeHighlight = (color: HighlightColor) => {
    const pending = pendingSel.current;
    const at = selToolbar;
    setSelToolbar(null);
    window.getSelection()?.removeAllRanges();
    if (!pending || !card) return;
    const textEl = pageRefs.current.get(pending.page)?.querySelector(".ws-pdf-text") as HTMLElement | null;
    if (!textEl) return;
    const anchor = describeAnchorFromRange(textEl, pending.range);
    if (!anchor || !anchor.exact.trim()) return;
    const created = store.createHighlightCard({
      text: anchor.exact,
      sourceUrl: pdfSourceUrl(card.id),
      anchor,
      color,
      page: pending.page,
    });
    if (at) setEditPop({ cardId: created.id, x: at.x, y: at.y });
  };

  const updateEditCard = (patch: { color?: HighlightColor; note?: string }) => {
    if (!editCard) return;
    if (editCard.kind === "highlight") {
      // upsert's update branch spreads the previous card, so `page` survives.
      store.upsertHighlight({
        id: editCard.id,
        text: editCard.anchor.exact,
        sourceUrl: editCard.sourceUrl,
        anchor: editCard.anchor,
        color: patch.color ?? editCard.color,
        note: patch.note ?? noteOfHighlight(editCard),
      });
      return;
    }
    // Clip frame: the image card's body is its note.
    store.updateCard(editCard.id, {
      ...(patch.color ? { color: patch.color } : {}),
      ...(patch.note !== undefined ? { body: patch.note } : {}),
    });
  };

  const noteOfEditCard = (c: HighlightCard | ImageCard): string =>
    c.kind === "highlight" ? noteOfHighlight(c) : c.body;

  // ---- clipping --------------------------------------------------------------

  const finishClip = async () => {
    const rect = clipRect;
    clipDrag.current = null;
    setClipRect(null);
    setClipMode(false);
    if (!rect || rect.w < 8 || rect.h < 8 || !card) return;
    const host = pageRefs.current.get(rect.page);
    const canvas = host?.querySelector("canvas");
    if (!canvas || !bridge) return;
    const factor = canvas.width / canvas.clientWidth; // physical px per CSS px
    const off = document.createElement("canvas");
    off.width = Math.round(rect.w * factor);
    off.height = Math.round(rect.h * factor);
    off.getContext("2d")!.drawImage(
      canvas,
      Math.round(rect.x * factor), Math.round(rect.y * factor),
      off.width, off.height,
      0, 0, off.width, off.height,
    );
    const saved = await bridge.clipSave({ dataUrl: off.toDataURL("image/png"), w: off.width, h: off.height });
    if (!saved) { toast("Clip failed"); return; }
    store.createImageCard({
      title: `${card.title} — p.${rect.page}`,
      sourceUrl: pdfSourceUrl(card.id),
      image: { file: saved.file, w: saved.w, h: saved.h },
      // Remember where on the page the clip came from, in scale-1 units, so
      // the reader can frame it and Read can scroll back to it.
      clip: { page: rect.page, x: rect.x / scale, y: rect.y / scale, w: rect.w / scale, h: rect.h / scale },
    });
    toast("Clipped ✓ — find it in the Library");
  };

  // ---- search / outline / toolbar -------------------------------------------

  const runSearch = (q: string) => {
    setQuery(q);
    const found = findHits(pageTextsRef.current, q);
    setHits(found);
    const idx = found.length > 0 ? 0 : -1;
    setHitIdx(idx);
    if (idx >= 0) gotoHit(found, idx);
  };

  const gotoHit = (list: SearchHit[], idx: number) => {
    const hit = list[idx];
    if (!hit) return;
    pageRefs.current.get(hit.page)?.scrollIntoView({ block: "center" });
    setFlash({ page: hit.page, index: hit.index, length: hit.length, at: Date.now() });
  };

  const step = (dir: 1 | -1) => {
    const idx = stepHit(hits.length, hitIdx, dir);
    setHitIdx(idx);
    if (idx >= 0) gotoHit(hits, idx);
  };

  const gotoPage = (n: number) => {
    const clamped = Math.max(1, Math.min(baseSizes.length || card.pages, Math.round(n)));
    pageRefs.current.get(clamped)?.scrollIntoView({ block: "start" });
  };

  const zoomTo = (s: number) => {
    setFitMode(false);
    setScale(Math.max(0.3, Math.min(3, s)));
  };

  const openOutlineItem = async (item: FlatOutlineItem) => {
    if (!doc) return;
    const idx = await destToPageIndex(doc, item.dest);
    if (idx != null) gotoPage(idx + 1);
    setOutlineOpen(false);
  };

  return (
    <div className="ws-pdf-pane">
      <div
        ref={scrollRef}
        className={`ws-pdf-scroll${clipMode ? " clipping" : ""}`}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
        onMouseUp={onMouseUp}
      >
        {loadError && <div className="ws-pdf-status">Couldn’t open this PDF: {loadError}</div>}
        {!loadError && baseSizes.length === 0 && <div className="ws-pdf-status">Opening PDF…</div>}
        {baseSizes.map((s, i) => {
          const n = i + 1;
          return (
            <div
              key={n}
              data-page={n}
              className="ws-pdf-page"
              ref={(el) => { if (el) pageRefs.current.set(n, el); else pageRefs.current.delete(n); }}
              style={{ width: s.width * scale, height: s.height * scale, marginTop: PAGE_GAP }}
            >
              <canvas />
              <div className="ws-pdf-text textLayer" />
              <div className="ws-hl-layer" aria-hidden="true">
                {(bandsByPage.get(n) ?? []).map((b, j) => (
                  <div key={`${b.cardId}-${j}`} className="ws-hl-band"
                    style={{ left: b.x, top: b.y, width: b.w, height: b.h, background: PALETTE[b.color].fill }} />
                ))}
                {flashPage === n && flashBands.map((b, j) => (
                  <div key={`flash-${j}`} className="ws-hl-band ws-hl-flash"
                    style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
                ))}
                {clips.map((c) =>
                  c.clip!.page === n ? (
                    <div
                      key={clipPing?.id === c.id ? `${c.id}-${clipPing.at}` : c.id}
                      className={`ws-clip-frame${clipPing?.id === c.id ? " ping" : ""}`}
                      style={{
                        left: c.clip!.x * scale,
                        top: c.clip!.y * scale,
                        width: c.clip!.w * scale,
                        height: c.clip!.h * scale,
                      }}
                    />
                  ) : null,
                )}
                {clipRect?.page === n && clipRect.w > 0 && (
                  <div className="ws-clip-rect"
                    style={{ left: clipRect.x, top: clipRect.y, width: clipRect.w, height: clipRect.h }} />
                )}
              </div>
            </div>
          );
        })}
        <div style={{ height: PAGE_GAP }} />
      </div>

      {/* Floating toolbar */}
      <div className="ws-pdf-toolbar">
        <button className="ws-tb-btn" title="Previous page" onClick={() => gotoPage(currentPage - 1)}><ChevronLeft size={15} strokeWidth={2} aria-hidden /></button>
        <input
          key={currentPage}
          className="ws-pdf-pageinput"
          defaultValue={String(currentPage)}
          onKeyDown={(e) => {
            if (e.key === "Enter") gotoPage(Number((e.target as HTMLInputElement).value) || currentPage);
          }}
          onFocus={(e) => e.target.select()}
        />
        <span className="ws-pdf-pagecount">/ {baseSizes.length || card.pages}</span>
        <button className="ws-tb-btn" title="Next page" onClick={() => gotoPage(currentPage + 1)}><ChevronRight size={15} strokeWidth={2} aria-hidden /></button>
        <span className="ws-tb-sep" />
        <button className="ws-tb-btn" title="Zoom out" onClick={() => zoomTo(scale / 1.2)}><Minus size={15} strokeWidth={2} aria-hidden /></button>
        <span className="ws-pdf-zoom">{Math.round(scale * 100)}%</span>
        <button className="ws-tb-btn" title="Zoom in" onClick={() => zoomTo(scale * 1.2)}><Plus size={15} strokeWidth={2} aria-hidden /></button>
        <button className={`ws-tb-btn${fitMode ? " active" : ""}`} title="Fit width"
          onClick={() => setFitMode(true)}><ChevronsLeftRight size={15} strokeWidth={2} aria-hidden /></button>
        <span className="ws-tb-sep" />
        <button className={`ws-tb-btn${searchOpen ? " active" : ""}`} title="Search in PDF"
          onClick={() => { setSearchOpen((o) => !o); setOutlineOpen(false); }}><Search size={15} strokeWidth={2} aria-hidden /></button>
        <button className={`ws-tb-btn${outlineOpen ? " active" : ""}`} title="Outline"
          disabled={outline.length === 0}
          onClick={() => { setOutlineOpen((o) => !o); setSearchOpen(false); }}><ListTree size={15} strokeWidth={2} aria-hidden /></button>
        <button className={`ws-tb-btn${clipMode ? " active" : ""}`} title="Clip a region"
          onClick={() => { setClipMode((m) => !m); setClipRect(null); }}><Scissors size={15} strokeWidth={2} aria-hidden /></button>
      </div>

      {searchOpen && (
        <div className="ws-pdf-search">
          <input
            autoFocus
            placeholder="Search in PDF…"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") setSearchOpen(false);
            }}
          />
          <span className="ws-pdf-hits">{hits.length === 0 ? "0" : `${hitIdx + 1} / ${hits.length}`}</span>
          <button className="ws-tb-btn" title="Previous match" onClick={() => step(-1)}><ChevronLeft size={13} strokeWidth={2} aria-hidden /></button>
          <button className="ws-tb-btn" title="Next match" onClick={() => step(1)}><ChevronRight size={13} strokeWidth={2} aria-hidden /></button>
        </div>
      )}

      {outlineOpen && (
        <div className="ws-pdf-outline">
          {outline.map((it, i) => (
            <div key={i} className="ws-pdf-outline-item" style={{ paddingLeft: 10 + it.depth * 14 }}
              onClick={() => void openOutlineItem(it)}>
              {it.title}
            </div>
          ))}
        </div>
      )}

      {selToolbar && (
        <div className={`octo-pill${pulse ? " pulse" : ""}`}
          style={{ position: "fixed", left: selToolbar.x, top: selToolbar.y, zIndex: 60 }}
          onMouseDown={(e) => e.preventDefault()}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c} className="octo-swatch" title={`Highlight ${c}`}
              style={{ background: PALETTE[c].fill }} onClick={() => makeHighlight(c)} />
          ))}
          <span className="octo-divider" />
          <button className="octo-add-note" onClick={() => {
            setPulse(true);
            setTimeout(() => setPulse(false), 1300);
          }}>+ note</button>
        </div>
      )}

      {editPop && editCard && (
        <div
          key={editPop.cardId}
          className="octo-pop"
          style={{ position: "fixed", left: editPop.x, top: editPop.y, transform: "translateX(-50%)", zIndex: 61 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="octo-pop-row">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c}
                className={`octo-swatch${editCard.color === c ? " current" : ""}`}
                title={c}
                style={{ background: PALETTE[c].fill }}
                onClick={() => updateEditCard({ color: c })} />
            ))}
          </div>
          <input
            className="octo-pop-input"
            placeholder="Tags, comma separated"
            defaultValue={editCard.tags.join(", ")}
            onBlur={(e) => {
              const tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
              store.updateCard(editCard.id, { tags });
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <textarea
            className="octo-pop-input"
            placeholder="Add a note…"
            rows={2}
            defaultValue={noteOfEditCard(editCard)}
            onBlur={(e) => updateEditCard({ note: e.target.value.trim() })}
          />
          <div className="octo-pop-foot">
            <button className="octo-pop-delete"
              onClick={() => { store.deleteCard(editCard.id); setEditPop(null); }}>Delete</button>
            <button className="octo-pop-primary" onClick={() => setEditPop(null)}>Done</button>
          </div>
        </div>
      )}

      {dragGhost && (
        <div className="ws-drag-ghost"
          style={{ left: dragGhost.x + 10, top: dragGhost.y + 12, borderTopColor: PALETTE[dragGhost.color].underline }}>
          {dragGhost.text.length > 80 ? dragGhost.text.slice(0, 80) + "…" : dragGhost.text}
        </div>
      )}

      {note && <div className="ws-pdf-note">{note}</div>}
    </div>
  );
}
