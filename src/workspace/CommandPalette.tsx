import * as React from "react";
import { Search } from "lucide-react";
import { KindIcon } from "./kind-icons.tsx";
import { useWorkspace } from "./store-context.ts";
import { CARD_DRAG_MIME } from "./dnd.ts";
import { clipUrl } from "./electron-bridge.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import type { Card } from "../lib/model/types.ts";
import type { WorkspaceStore } from "../lib/store/workspace-store.ts";

export interface CommandPaletteProps {
  seed?: string;
  onClose: () => void;
  onPick: (card: Card) => void;
}

function snippet(card: Card, query: string): string {
  const body = card.body.replace(/\s+/g, " ").trim();
  if (!body) return card.tags.map((t) => `#${t}`).join(" ");
  const term = query.replace(/#/g, "").trim().split(/\s+/)[0]?.toLowerCase();
  if (term) {
    const i = body.toLowerCase().indexOf(term);
    if (i >= 0) {
      const start = Math.max(0, i - 24);
      return (start > 0 ? "…" : "") + body.slice(start, start + 80);
    }
  }
  return body.slice(0, 80);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap every query-term occurrence in <mark> so the preview shows the hit. */
function markMatches(text: string, query: string): React.ReactNode {
  const terms = [...new Set(query.replace(/#/g, " ").trim().toLowerCase().split(/\s+/).filter(Boolean))];
  if (terms.length === 0 || !text) return text;
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** One line saying where ↵ will land — the card's home, not the palette's. */
function locationOf(card: Card, store: WorkspaceStore): string {
  if (card.kind === "highlight") {
    if (card.sourceUrl.startsWith("pdf:")) {
      const pdf = store.getCard(card.sourceUrl.slice(4));
      if (pdf) return `Highlight in “${pdf.title}” — ↵ jumps to it`;
    }
    const article = store
      .getCards()
      .find((c) => c.kind === "article" && c.sourceUrl === card.sourceUrl);
    if (article) return `Highlight in “${article.title}” — ↵ jumps to it`;
    const host = hostOf(card.sourceUrl);
    return host ? `Highlight from ${host}` : "Highlight";
  }
  if (card.kind === "article" || card.kind === "pdf") return "↵ opens in the reader";
  if (card.kind === "image") {
    if (card.sourceUrl.startsWith("pdf:") && card.clip) {
      const pdf = store.getCard(card.sourceUrl.slice(4));
      if (pdf) return `Clip from “${pdf.title}” — ↵ jumps to it`;
    }
    if (/^https?:/.test(card.sourceUrl)) {
      return `Clip from ${hostOf(card.sourceUrl)} — ↵ opens the page`;
    }
  }
  const boards = store
    .snapshot()
    .placements.filter((p) => p.cardId === card.id)
    .map((p) => store.getWhiteboard(p.whiteboardId)?.name)
    .filter(Boolean);
  if (boards.length) return `On ${boards.map((b) => `“${b}”`).join(", ")} — ↵ jumps to it`;
  return "Not on any board yet — drag it onto one";
}

function Preview({ card, query }: { card: Card; query: string }): React.ReactElement {
  const store = useWorkspace();
  const bodyRef = React.useRef<HTMLDivElement>(null);
  // Bring the first hit into view so the reader sees where the match lives.
  React.useEffect(() => {
    bodyRef.current?.querySelector("mark")?.scrollIntoView({ block: "center" });
  }, [card.id, query]);

  const palette = PALETTE[card.color] ?? PALETTE.yellow;
  const body = card.body.trim();
  return (
    <div className="ws-cmdk-preview">
      <div className="ws-cmdk-prev-head">
        <KindIcon kind={card.kind} size={15} />
        <span className="ws-cmdk-prev-title">{card.title || "Untitled"}</span>
        <span className="ws-cmdk-prev-kind">{card.kind}</span>
      </div>
      <div className="ws-cmdk-prev-loc">{locationOf(card, store)}</div>
      {card.kind === "image" && (
        <img className="ws-cmdk-prev-img" src={clipUrl(card.image.file)} alt="" draggable={false} />
      )}
      {card.kind === "pdf" && card.cover && (
        <img className="ws-cmdk-prev-img" src={clipUrl(card.cover)} alt="" draggable={false} />
      )}
      {card.kind === "pdf" && card.pages > 0 && (
        <div className="ws-cmdk-prev-loc">{card.pages} pages</div>
      )}
      {card.kind === "highlight" ? (
        // The quoted text lives in the title; the body is the user's note.
        <div ref={bodyRef} className="ws-cmdk-prev-body quote" style={{ borderLeftColor: palette.underline }}>
          {markMatches(card.title, query)}
          {body && <div className="ws-cmdk-prev-note">{markMatches(body, query)}</div>}
        </div>
      ) : body ? (
        <div ref={bodyRef} className="ws-cmdk-prev-body">
          {markMatches(body, query)}
        </div>
      ) : (
        card.kind !== "image" && card.kind !== "pdf" && (
          <div className="ws-cmdk-prev-none">No content</div>
        )
      )}
      {card.tags.length > 0 && (
        <div className="ws-cmdk-prev-tags">{card.tags.map((t) => `#${t}`).join("  ")}</div>
      )}
    </div>
  );
}

export function CommandPalette({ seed, onClose, onPick }: CommandPaletteProps): React.ReactElement {
  const store = useWorkspace();
  const [query, setQuery] = React.useState(seed ?? "");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const version = store.getVersion();
  const results = React.useMemo(() => {
    const cleaned = query.replace(/#/g, " ").trim();
    if (!cleaned) {
      // Show most-recently-updated cards when empty.
      return [...store.getCards()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8)
        .map((card) => ({ card, score: 0 }));
    }
    return store.search(cleaned).slice(0, 20);
    // `version` re-runs the search after any store mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store, version]);

  React.useEffect(() => { setActive(0); }, [query]);

  const activeCard = results[Math.min(active, results.length - 1)]?.card ?? null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const r = results[active]; if (r) onPick(r.card); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="ws-cmdk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws-cmdk" role="dialog" aria-label="Search">
        <div className="ws-cmdk-inputrow">
        <Search className="ws-cmdk-searchico" size={17} strokeWidth={2} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search cards by title, text, or #tag…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        </div>
        <div className="ws-cmdk-body">
          <div className="ws-cmdk-results">
            {results.length === 0 ? (
              <div className="ws-cmdk-empty">No cards match “{query}”.</div>
            ) : (
              results.map((r, i) => (
                <div
                  key={r.card.id}
                  className={`ws-cmdk-item${i === active ? " active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(r.card)}
                  title="Jump to it · drag onto the board or into a note"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(CARD_DRAG_MIME, r.card.id);
                    e.dataTransfer.effectAllowed = "copy";
                    // Close the palette so the drag can reach the canvas — but
                    // only after this tick: removing the source element inside
                    // dragstart makes Chromium cancel the drag outright.
                    setTimeout(onClose, 0);
                  }}
                >
                  <KindIcon kind={r.card.kind} size={15} />
                  <span className="ws-cmdk-title">{r.card.title || "Untitled"}</span>
                  <span className="ws-cmdk-snip">{snippet(r.card, query)}</span>
                  <span className="ws-cmdk-kind">{r.card.kind}</span>
                </div>
              ))
            )}
          </div>
          {activeCard && <Preview card={activeCard} query={query} />}
        </div>
        <div className="ws-cmdk-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> jump to it</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
