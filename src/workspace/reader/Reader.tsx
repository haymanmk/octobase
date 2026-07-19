import * as React from "react";
import { ExternalLink } from "lucide-react";
import { useWorkspace } from "../store-context.ts";
import { MarkdownView } from "../MarkdownView.tsx";
import { PALETTE } from "../../components/highlighter/colors.ts";
import { ensureToolbarStyles } from "../../components/highlighter/toolbar-ui.ts";
import { HIGHLIGHT_COLORS } from "../../types/highlight.ts";
import { describeAnchorFromRange } from "../../lib/anchor/text-anchor.ts";
import type { Card, HighlightCard, HighlightColor } from "../../lib/model/types.ts";
import {
  locateHighlights,
  bandsFor,
  highlightAtOffset,
  offsetFromPoint,
  type PlacedHighlight,
  type HighlightBand,
} from "./highlight-overlay.ts";

interface ReaderPrefs {
  family: "serif" | "sans";
  scale: number; // 0.85 – 1.5
  measure: number; // body max-width in px
}
const PREFS_KEY = "octobase.reader.prefs";
const DEFAULT_PREFS: ReaderPrefs = { family: "serif", scale: 1, measure: 680 };

function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_PREFS;
}

export interface ReaderProps {
  cardId: string;
  onOpenCard: (cardId: string) => void;
  /** Route the source URL to the live browser tab (host decides/confirms). */
  onOpenOriginal?: (url: string) => void;
  /** Scroll this highlight into view (at: nonce so repeats re-fire). */
  focusHighlight?: { id: string; at: number } | null;
  /** A highlight was hold-dragged out of the article and released here. */
  onDropHighlight?: (cardId: string, clientX: number, clientY: number) => void;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** A highlight card's body is its note (legacy bodies carried the quote too). */
function noteOfHighlight(card: HighlightCard): string {
  const quote = `> ${card.anchor.exact}`;
  if (card.body.startsWith(quote)) return card.body.slice(quote.length).trimStart();
  return card.body;
}

const HOLD_MS = 250;
const MOVE_CANCEL_PX = 5;

/**
 * Captured-article reader. Fills whatever container it's given — it renders
 * as a tab inside the viewer pane, not as a modal. Highlighting mirrors the
 * live-browser widget (shared toolbar-ui styles): a white pill on selection,
 * an edit popover on click, and hold-to-drag to place a highlight card on
 * the whiteboard.
 */
export function Reader({
  cardId,
  onOpenCard,
  onOpenOriginal,
  focusHighlight,
  onDropHighlight,
}: ReaderProps): React.ReactElement | null {
  const store = useWorkspace();
  const version = store.getVersion();
  const card = store.getCard(cardId);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = React.useState<ReaderPrefs>(loadPrefs);
  const placedRef = React.useRef<PlacedHighlight[]>([]);
  const [selToolbar, setSelToolbar] = React.useState<{ x: number; y: number } | null>(null);
  const [pulse, setPulse] = React.useState(false);
  const pendingRange = React.useRef<Range | null>(null);
  const [editPop, setEditPop] = React.useState<{ cardId: string; x: number; y: number } | null>(null);
  const [dragGhost, setDragGhost] = React.useState<{ cardId: string; text: string; color: HighlightColor; x: number; y: number } | null>(null);
  const ghostUp = !!dragGhost;
  React.useEffect(() => {
    if (!ghostUp) return;
    document.body.style.cursor = "grabbing";
    return () => { document.body.style.cursor = ""; };
  }, [ghostUp]);
  const [bands, setBands] = React.useState<HighlightBand[]>([]);
  const [reflowTick, setReflowTick] = React.useState(0);
  const hold = React.useRef<null | { cardId: string; sx: number; sy: number; timer: ReturnType<typeof setTimeout> }>(null);
  const draggedRef = React.useRef(false);
  const focusDoneRef = React.useRef(0);

  const sourceUrl = card && "sourceUrl" in card ? card.sourceUrl : "";
  const highlights = sourceUrl ? store.getHighlightsForUrl(sourceUrl) : [];
  const editCard = editPop
    ? (store.getCard(editPop.cardId) as HighlightCard | undefined)
    : undefined;

  React.useEffect(() => { ensureToolbarStyles(); }, []);

  React.useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  // Re-measure the marker bands when the pane resizes and text reflows.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setReflowTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Paint highlights whenever the body or the highlight set changes; then
  // honor a pending scroll-to-highlight request once per nonce.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    placedRef.current = locateHighlights(
      el,
      highlights.map((h) => ({ cardId: h.id, color: h.color, anchor: h.anchor })),
    );
    setBands(bandsFor(el, placedRef.current));
    if (focusHighlight && focusHighlight.at !== focusDoneRef.current) {
      const target = placedRef.current.find((p) => p.cardId === focusHighlight.id);
      if (target) {
        focusDoneRef.current = focusHighlight.at;
        // Center the range itself (not its whole paragraph), and correct once
        // more after images/fonts settle and shift the layout.
        const center = () => {
          const scroller = scrollRef.current;
          const r = target.range.getBoundingClientRect();
          if (!scroller || r.height === 0) return;
          const s = scroller.getBoundingClientRect();
          scroller.scrollTop += r.top - s.top - scroller.clientHeight / 2 + r.height / 2;
        };
        center();
        setTimeout(center, 400);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, version, prefs.family, prefs.scale, prefs.measure, focusHighlight, reflowTick]);

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

  const highlightAtPoint = (clientX: number, clientY: number): PlacedHighlight | null => {
    const el = bodyRef.current;
    if (!el) return null;
    const off = offsetFromPoint(el, clientX, clientY);
    if (off == null) return null;
    return highlightAtOffset(placedRef.current, off);
  };

  // Hold-to-drag a highlight (mirrors the live-browser gesture): press and
  // hold on a painted highlight, then carry the ghost onto the whiteboard.
  const onBodyPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !onDropHighlight) return;
    const hit = highlightAtPoint(e.clientX, e.clientY);
    if (!hit) return;
    const start = { x: e.clientX, y: e.clientY };
    const timer = setTimeout(() => {
      const h = store.getCard(hit.cardId) as HighlightCard | undefined;
      if (!h) return;
      draggedRef.current = true;
      setSelToolbar(null);
      window.getSelection()?.removeAllRanges();
      setDragGhost({ cardId: h.id, text: h.anchor.exact, color: h.color, x: start.x, y: start.y });
      const onMove = (me: PointerEvent) =>
        setDragGhost((g) => (g ? { ...g, x: me.clientX, y: me.clientY } : g));
      const onUp = (ue: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setDragGhost(null);
        onDropHighlight(hit.cardId, ue.clientX, ue.clientY);
        // Let the click that follows pointerup be ignored, then reset.
        setTimeout(() => { draggedRef.current = false; }, 0);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }, HOLD_MS);
    hold.current = { cardId: hit.cardId, sx: start.x, sy: start.y, timer };
  };

  const onBodyPointerMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (!h) return;
    if (Math.abs(e.clientX - h.sx) > MOVE_CANCEL_PX || Math.abs(e.clientY - h.sy) > MOVE_CANCEL_PX) {
      clearTimeout(h.timer); // moved too far — it's a text selection
      hold.current = null;
    }
  };

  const onBodyPointerUp = () => {
    if (hold.current) {
      clearTimeout(hold.current.timer);
      hold.current = null;
    }
  };

  const onBodyClick = (e: React.MouseEvent) => {
    if (draggedRef.current) return; // this click ended a drag
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // selecting, not clicking a highlight
    const hit = highlightAtPoint(e.clientX, e.clientY);
    if (hit) setEditPop({ cardId: hit.cardId, x: e.clientX, y: e.clientY + 12 });
  };

  const onBodyMouseUp = () => {
    const el = bodyRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      setSelToolbar(null);
      return;
    }
    pendingRange.current = range.cloneRange();
    const rect = range.getBoundingClientRect();
    // Below the selection, left-aligned — same placement as the live widget.
    setSelToolbar({ x: rect.left, y: rect.bottom + 10 });
  };

  const makeHighlight = (color: HighlightColor) => {
    const el = bodyRef.current;
    const range = pendingRange.current;
    const at = selToolbar;
    if (!el || !range) return;
    const anchor = describeAnchorFromRange(el, range);
    setSelToolbar(null);
    window.getSelection()?.removeAllRanges();
    if (!anchor || !anchor.exact.trim()) return;
    const created = store.createHighlightCard({ text: anchor.exact, sourceUrl: sourceUrl || card.id, anchor, color });
    // Like the live widget: creating expands straight into the edit form.
    if (at) setEditPop({ cardId: created.id, x: at.x, y: at.y });
  };

  const updateHighlight = (patch: { color?: HighlightColor; note?: string }) => {
    if (!editCard) return;
    store.upsertHighlight({
      id: editCard.id,
      text: editCard.anchor.exact,
      sourceUrl: editCard.sourceUrl,
      anchor: editCard.anchor,
      color: patch.color ?? editCard.color,
      note: patch.note ?? noteOfHighlight(editCard),
    });
  };

  const resolve = (title: string) =>
    store.getCards().find((c) => c.title.trim().toLowerCase() === title.trim().toLowerCase());

  const bump = (delta: number) =>
    setPrefs((p) => ({ ...p, scale: Math.min(1.5, Math.max(0.85, +(p.scale + delta).toFixed(2))) }));

  return (
    <div className="ws-reader-pane">
      <div className="ws-reader-tools">
        <div className="ws-reader-typo">
          <button className={`ws-tb-btn${prefs.family === "serif" ? " active" : ""}`} title="Serif font"
            onClick={() => setPrefs((p) => ({ ...p, family: "serif" }))} style={{ fontFamily: "var(--ws-font-display)" }}>Aa</button>
          <button className={`ws-tb-btn${prefs.family === "sans" ? " active" : ""}`} title="Sans-serif font"
            onClick={() => setPrefs((p) => ({ ...p, family: "sans" }))} style={{ fontFamily: "var(--ws-font-ui)" }}>Aa</button>
          <span className="ws-tb-sep" />
          <button className="ws-tb-btn" title="Decrease font size" onClick={() => bump(-0.1)}>A−</button>
          <button className="ws-tb-btn" title="Increase font size" onClick={() => bump(0.1)}>A+</button>
        </div>
        <div className="ws-topbar-spacer" />
        {sourceUrl && (
          <button
            className="ws-tb-btn"
            title="Open in browser"
            aria-label="Open in browser"
            onClick={() => {
              if (onOpenOriginal) onOpenOriginal(sourceUrl);
              else window.open(sourceUrl, "_blank", "noreferrer");
            }}
          ><ExternalLink size={15} strokeWidth={2} aria-hidden /></button>
        )}
      </div>

      <div ref={scrollRef} className="ws-reader-scroll">
        <article
          className={`ws-reader-doc fam-${prefs.family}`}
          style={{ maxWidth: prefs.measure, fontSize: `${prefs.scale}rem` }}
        >
          <h1 className="ws-reader-title">{card.title}</h1>
          <div className="ws-reader-meta">
            {card.kind === "article" && card.byline ? <span>{card.byline}</span> : null}
            {sourceUrl ? <span>{hostOf(sourceUrl)}</span> : null}
            {highlights.length > 0 ? <span>{highlights.length} highlight{highlights.length > 1 ? "s" : ""}</span> : null}
          </div>
          <div
            ref={bodyRef}
            className="ws-reader-body"
            onClick={onBodyClick}
            onMouseUp={onBodyMouseUp}
            onPointerDown={onBodyPointerDown}
            onPointerMove={onBodyPointerMove}
            onPointerUp={onBodyPointerUp}
          >
            <MarkdownView body={card.body} resolve={resolve} onOpenCard={(c: Card) => onOpenCard(c.id)} />
            <div className="ws-hl-layer" aria-hidden="true">
              {bands.map((b, i) => (
                <div key={`${b.cardId}-${i}`} className="ws-hl-band"
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h, background: PALETTE[b.color].fill }} />
              ))}
            </div>
          </div>
        </article>
      </div>

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
                onClick={() => updateHighlight({ color: c })} />
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
            defaultValue={noteOfHighlight(editCard)}
            onBlur={(e) => updateHighlight({ note: e.target.value.trim() })}
          />
          <div className="octo-pop-foot">
            <button className="octo-pop-delete"
              onClick={() => { store.deleteCard(editCard.id); setEditPop(null); }}>Delete</button>
            <button className="octo-pop-primary"
              onClick={() => setEditPop(null)}>Done</button>
          </div>
        </div>
      )}

      {dragGhost && (
        <div className="ws-drag-ghost"
          style={{ left: dragGhost.x + 10, top: dragGhost.y + 12, borderTopColor: PALETTE[dragGhost.color].underline }}>
          {dragGhost.text.length > 80 ? dragGhost.text.slice(0, 80) + "…" : dragGhost.text}
        </div>
      )}
    </div>
  );
}
