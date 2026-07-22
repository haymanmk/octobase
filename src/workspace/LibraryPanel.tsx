import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import { CARD_DRAG_MIME } from "./dnd.ts";
import { clipUrl } from "./electron-bridge.ts";
import { snippet } from "./MarkdownView.tsx";
import type { Card, CardKind } from "../lib/model/types.ts";

export interface LibraryPanelProps {
  /** Cards whose Read action leads somewhere useful (mirrors the board menu). */
  canRead: (cardId: string) => boolean;
  onRead: (cardId: string) => void;
  /** Present only when the AI bridge is up. */
  onAskAi?: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  onClose: () => void;
}

type Filter = "all" | "unplaced" | CardKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unplaced", label: "Unplaced" },
  { key: "note", label: "Notes" },
  { key: "highlight", label: "Highlights" },
  { key: "article", label: "Articles" },
  { key: "image", label: "Clips" },
  { key: "pdf", label: "PDFs" },
];

import { BookOpen, MoreHorizontal, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { KindIcon } from "./kind-icons.tsx";

interface TileMenuState {
  cardId: string;
  x: number;
  y: number;
}

/**
 * The card library: every live card, searchable and filterable, as a grid of
 * draggable preview tiles. The drag payload is the same card MIME the canvas
 * and note embeds accept — the panel is the universal drag source. Click only
 * selects; the context menu (right-click or ⋯) carries the actions.
 */
export function LibraryPanel({ canRead, onRead, onAskAi, onDelete, onClose }: LibraryPanelProps): React.ReactElement {
  const store = useWorkspace();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<TileMenuState | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const version = store.getVersion();

  // Dismiss the tile menu on any outside press (capture phase, same reasons
  // as the board menus).
  React.useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.(".ws-ctx")) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [menu]);

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

  const menuCard = menu ? store.getCard(menu.cardId) : null;

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
        <button className="ws-lib-close" title="Close library" onClick={onClose}><X size={13} strokeWidth={2} aria-hidden /></button>
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
            <LibraryTile
              key={c.id}
              card={c}
              selected={c.id === selectedId}
              renaming={c.id === renamingId}
              readable={canRead(c.id)}
              onSelect={() => setSelectedId(c.id)}
              onRead={() => onRead(c.id)}
              onMenu={(x, y) => setMenu({ cardId: c.id, x, y })}
              onRenameDone={(title) => {
                if (title !== null) store.updateCard(c.id, { title: title.trim() || "Untitled" });
                setRenamingId(null);
              }}
            />
          ))}
        </div>
      )}

      {menu && menuCard && (
        <div
          className="ws-ctx"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {canRead(menu.cardId) && (
            <div className="ws-ctx-item" onClick={() => { onRead(menu.cardId); setMenu(null); }}>
              <span className="ws-ctx-ico"><BookOpen size={13} strokeWidth={2} aria-hidden /></span> Read
            </div>
          )}
          {canRead(menu.cardId) && onAskAi && (
            <div className="ws-ctx-item" onClick={() => { onAskAi(menu.cardId); setMenu(null); }}>
              <span className="ws-ctx-ico"><Sparkles size={13} strokeWidth={2} aria-hidden /></span> Ask AI
            </div>
          )}
          {menuCard.kind !== "note" && (
            <div className="ws-ctx-item" onClick={() => { setRenamingId(menu.cardId); setSelectedId(menu.cardId); setMenu(null); }}>
              <span className="ws-ctx-ico"><Pencil size={13} strokeWidth={2} aria-hidden /></span> Rename
            </div>
          )}
          {(canRead(menu.cardId) || menuCard.kind !== "note") && <div className="ws-ctx-sep" />}
          <div className="ws-ctx-item danger" onClick={() => { onDelete(menu.cardId); setMenu(null); }}>
            <span className="ws-ctx-ico"><Trash2 size={13} strokeWidth={2} aria-hidden /></span> Delete card
          </div>
        </div>
      )}
    </aside>
  );
}

function LibraryTile({ card, selected, renaming, readable, onSelect, onRead, onMenu, onRenameDone }: {
  card: Card;
  selected: boolean;
  renaming: boolean;
  readable: boolean;
  onSelect: () => void;
  onRead: () => void;
  onMenu: (x: number, y: number) => void;
  onRenameDone: (title: string | null) => void;
}): React.ReactElement {
  const palette = PALETTE[card.color] ?? PALETTE.yellow;
  const text = snippet(card.body);
  return (
    <div
      className={`ws-lib-tile${selected ? " selected" : ""}`}
      title="Drag onto the board or into a note · right-click for actions"
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_DRAG_MIME, card.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onSelect}
      onDoubleClick={readable ? onRead : undefined}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
    >
      <div className="ws-lib-accent" style={{ background: palette.underline }} />
      <div className="ws-lib-title">
        <KindIcon kind={card.kind} size={12} />
        {renaming ? (
          <input
            className="ws-lib-rename"
            autoFocus
            defaultValue={card.title}
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameDone((e.target as HTMLInputElement).value);
              else if (e.key === "Escape") onRenameDone(null);
            }}
            onBlur={(e) => onRenameDone(e.target.value)}
          />
        ) : (
          <span className="ws-lib-title-text">{card.title || "Untitled"}</span>
        )}
        <span
          className="ws-lib-menu-btn"
          title="Card menu"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onMenu(r.left, r.bottom + 4);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        ><MoreHorizontal size={14} strokeWidth={2} aria-hidden /></span>
      </div>
      {card.kind === "image" && (
        <div className="ws-lib-thumb">
          <img src={clipUrl(card.image.file)} alt="" draggable={false} />
        </div>
      )}
      {card.kind === "pdf" && card.cover && (
        <div className="ws-lib-thumb">
          <img src={clipUrl(card.cover)} alt="" draggable={false} />
        </div>
      )}
      {text && <div className="ws-lib-snippet">{text}</div>}
    </div>
  );
}
