import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import { CARD_DRAG_MIME } from "./Canvas.tsx";
import type { Card, CardKind } from "../lib/model/types.ts";

export interface LibraryPanelProps {
  onOpenCard: (cardId: string) => void;
  onClose: () => void;
}

type Filter = "all" | "unplaced" | CardKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unplaced", label: "Unplaced" },
  { key: "note", label: "Notes" },
  { key: "highlight", label: "Highlights" },
  { key: "article", label: "Articles" },
];

/** Markdown body → short plain-text preview for a tile. */
function snippet(body: string): string {
  return body
    .replace(/!\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

const KIND_GLYPH: Record<string, string> = {
  note: "✎",
  highlight: "▂",
  article: "¶",
  image: "▣",
};

/**
 * The card library: every live card, searchable and filterable, as a grid of
 * draggable preview tiles. The drag payload is the same card MIME the canvas
 * and (later) note embeds accept — the panel is the universal drag source.
 */
export function LibraryPanel({ onOpenCard, onClose }: LibraryPanelProps): React.ReactElement {
  const store = useWorkspace();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const version = store.getVersion();

  const cards = React.useMemo(() => {
    const base = q.trim()
      ? store.search(q).map((h) => h.card)
      : [...store.getCards()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (filter === "all") return base;
    if (filter === "unplaced") {
      const unplaced = new Set(store.getInboxCards().map((c) => c.id));
      return base.filter((c) => unplaced.has(c.id));
    }
    return base.filter((c) => c.kind === filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, q, filter]);

  return (
    <aside className="ws-library">
      <div className="ws-lib-head">
        <input
          className="ws-lib-search"
          placeholder="Search cards…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); (e.target as HTMLElement).blur(); } }}
        />
        <button className="ws-lib-close" title="Close library" onClick={onClose}>×</button>
      </div>
      <div className="ws-lib-chips">
        {FILTERS.map((f) => (
          <span
            key={f.key}
            className={`ws-lib-chip${filter === f.key ? " active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </span>
        ))}
      </div>
      {cards.length === 0 ? (
        <div className="ws-lib-empty">No cards match</div>
      ) : (
        <div className="ws-lib-grid">
          {cards.map((c) => (
            <LibraryTile key={c.id} card={c} onOpen={() => onOpenCard(c.id)} />
          ))}
        </div>
      )}
    </aside>
  );
}

function LibraryTile({ card, onOpen }: { card: Card; onOpen: () => void }): React.ReactElement {
  const palette = PALETTE[card.color] ?? PALETTE.yellow;
  const text = snippet(card.body);
  return (
    <div
      className="ws-lib-tile"
      title="Open card · drag onto the board or into a note"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_DRAG_MIME, card.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onOpen}
    >
      <div className="ws-lib-accent" style={{ background: palette.underline }} />
      <div className="ws-lib-title">{card.title || "Untitled"}</div>
      {text && <div className="ws-lib-snippet">{text}</div>}
      <div className="ws-lib-kind">{KIND_GLYPH[card.kind] ?? "•"}</div>
    </div>
  );
}
