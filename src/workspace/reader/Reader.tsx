import * as React from "react";
import { useWorkspace } from "../store-context.ts";
import { MarkdownView } from "../MarkdownView.tsx";
import { PALETTE } from "../../components/highlighter/colors.ts";
import { HIGHLIGHT_COLORS } from "../../types/highlight.ts";
import { describeAnchorFromRange } from "../../lib/anchor/text-anchor.ts";
import type { Card, HighlightColor } from "../../lib/model/types.ts";
import {
  applyHighlights,
  clearHighlights,
  highlightAtOffset,
  offsetFromPoint,
  type PlacedHighlight,
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
  onClose: () => void;
  onOpenCard: (cardId: string) => void;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function Reader({ cardId, onClose, onOpenCard }: ReaderProps): React.ReactElement | null {
  const store = useWorkspace();
  const version = store.getVersion();
  const card = store.getCard(cardId);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = React.useState<ReaderPrefs>(loadPrefs);
  const placedRef = React.useRef<PlacedHighlight[]>([]);
  const [selToolbar, setSelToolbar] = React.useState<{ x: number; y: number } | null>(null);
  const pendingRange = React.useRef<Range | null>(null);

  const sourceUrl = card && "sourceUrl" in card ? card.sourceUrl : "";
  const highlights = sourceUrl ? store.getHighlightsForUrl(sourceUrl) : [];

  React.useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  // Paint highlights whenever the body or the highlight set changes.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    placedRef.current = applyHighlights(
      el,
      highlights.map((h) => ({ cardId: h.id, color: h.color, anchor: h.anchor })),
    );
    return () => clearHighlights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, version, prefs.family, prefs.scale, prefs.measure]);

  if (!card) return null;

  const onBodyClick = (e: React.MouseEvent) => {
    const el = bodyRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // selecting, not clicking a highlight
    const off = offsetFromPoint(el, e.clientX, e.clientY);
    if (off == null) return;
    const hit = highlightAtOffset(placedRef.current, off);
    if (hit) onOpenCard(hit.cardId);
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
    setSelToolbar({ x: rect.left + rect.width / 2, y: rect.top - 8 });
  };

  const makeHighlight = (color: HighlightColor) => {
    const el = bodyRef.current;
    const range = pendingRange.current;
    if (!el || !range) return;
    const anchor = describeAnchorFromRange(el, range);
    setSelToolbar(null);
    window.getSelection()?.removeAllRanges();
    if (!anchor || !anchor.exact.trim()) return;
    store.createHighlightCard({ text: anchor.exact, sourceUrl: sourceUrl || card.id, anchor, color });
  };

  const resolve = (title: string) =>
    store.getCards().find((c) => c.title.trim().toLowerCase() === title.trim().toLowerCase());

  const bump = (delta: number) =>
    setPrefs((p) => ({ ...p, scale: Math.min(1.5, Math.max(0.85, +(p.scale + delta).toFixed(2))) }));

  return (
    <div className="ws-reader-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws-reader" role="dialog" aria-label="Article reader">
        <header className="ws-reader-bar">
          <button className="ws-btn ghost" onClick={onClose} title="Close reader">← Close</button>
          <div className="ws-topbar-spacer" />
          <div className="ws-reader-typo">
            <button className={`ws-tb-btn${prefs.family === "serif" ? " active" : ""}`} title="Serif"
              onClick={() => setPrefs((p) => ({ ...p, family: "serif" }))} style={{ fontFamily: "var(--ws-font-display)" }}>Aa</button>
            <button className={`ws-tb-btn${prefs.family === "sans" ? " active" : ""}`} title="Sans"
              onClick={() => setPrefs((p) => ({ ...p, family: "sans" }))} style={{ fontFamily: "var(--ws-font-ui)" }}>Aa</button>
            <span className="ws-tb-sep" />
            <button className="ws-tb-btn" title="Smaller" onClick={() => bump(-0.1)}>A−</button>
            <button className="ws-tb-btn" title="Larger" onClick={() => bump(0.1)}>A+</button>
            <span className="ws-tb-sep" />
            <button className="ws-tb-btn" title="Narrower" onClick={() => setPrefs((p) => ({ ...p, measure: Math.max(520, p.measure - 80) }))}>›‹</button>
            <button className="ws-tb-btn" title="Wider" onClick={() => setPrefs((p) => ({ ...p, measure: Math.min(960, p.measure + 80) }))}>‹›</button>
          </div>
          {sourceUrl && (
            <a className="ws-btn" href={sourceUrl} target="_blank" rel="noreferrer" title="Open the original page">
              Open original ↗
            </a>
          )}
        </header>

        <div className="ws-reader-scroll">
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
            >
              <MarkdownView body={card.body} resolve={resolve} onOpenCard={(c: Card) => onOpenCard(c.id)} />
            </div>
          </article>
        </div>

        {selToolbar && (
          <div className="ws-sel-toolbar" style={{ left: selToolbar.x, top: selToolbar.y }}
            onMouseDown={(e) => e.preventDefault()}>
            {HIGHLIGHT_COLORS.map((c) => (
              <span key={c} className="ws-sel-dot" title={`Highlight ${c}`}
                style={{ background: PALETTE[c].underline }} onClick={() => makeHighlight(c)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
