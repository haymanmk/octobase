import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import { CARD_DRAG_MIME } from "./dnd.ts";
import type { Card } from "../lib/model/types.ts";

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const r = results[active]; if (r) onPick(r.card); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="ws-cmdk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws-cmdk" role="dialog" aria-label="Search">
        <input
          ref={inputRef}
          value={query}
          placeholder="Search cards by title, text, or #tag…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
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
                title="Open · drag onto the board or into a note"
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
                <span className="ws-dotmark" style={{ background: PALETTE[r.card.color].underline }} />
                <span className="ws-cmdk-title">{r.card.title || "Untitled"}</span>
                <span className="ws-cmdk-snip">{snippet(r.card, query)}</span>
                <span className="ws-cmdk-kind">{r.card.kind}</span>
              </div>
            ))
          )}
        </div>
        <div className="ws-cmdk-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
