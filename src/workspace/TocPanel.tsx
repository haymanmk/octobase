import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { parseEmbeds, normalizeTitle } from "../lib/model/wikilinks.ts";
import { buildToc, filterToc, type TocEntry } from "./toc.ts";

const KIND_GLYPH: Record<string, string> = {
  note: "✎",
  highlight: "▂",
  article: "¶",
  image: "▣",
  pdf: "📄",
};

export interface TocPanelProps {
  boardId: string;
  /** A row (or group header) was clicked — jump the canvas to this card. */
  onJump: (cardId: string) => void;
  onClose: () => void;
}

/**
 * Floating table of contents for the active whiteboard: spatial clusters
 * labeled by their anchor card, embedded cards indented under their host,
 * with a title filter. Clicking anything jumps the canvas to the card.
 */
export function TocPanel({ boardId, onJump, onClose }: TocPanelProps): React.ReactElement {
  const store = useWorkspace();
  const version = store.getVersion();
  const [query, setQuery] = React.useState("");

  const groups = React.useMemo(() => {
    const entries: TocEntry[] = store
      .getPlacements(boardId)
      .map((placement) => {
        const card = store.getCard(placement.cardId);
        return card ? { card, placement } : null;
      })
      .filter((e): e is TocEntry => e !== null);
    // Resolve each member's ![[embeds]] to card ids (board members only —
    // buildToc drops non-members anyway, this just keeps the map small).
    const byTitle = new Map(entries.map((e) => [normalizeTitle(e.card.title), e.card.id]));
    const embeds = new Map<string, string[]>();
    for (const e of entries) {
      const ids = parseEmbeds(e.card.body)
        .map((em) => byTitle.get(normalizeTitle(em.target)))
        .filter((id): id is string => !!id);
      if (ids.length > 0) embeds.set(e.card.id, ids);
    }
    return buildToc(entries, embeds, store.getGroups(boardId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, boardId, version]);

  const shown = React.useMemo(() => filterToc(groups, query), [groups, query]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <aside className="ws-toc" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ws-toc-head">
        <span className="ws-toc-title">Contents</span>
        <span className="ws-toc-count">{total} card{total === 1 ? "" : "s"}</span>
        <button className="ws-toc-close" title="Close" onClick={onClose}>×</button>
      </div>
      <input
        className="ws-toc-filter"
        placeholder="Filter…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); (e.target as HTMLElement).blur(); } }}
      />
      <div className="ws-toc-list">
        {shown.length === 0 && <div className="ws-toc-empty">No matching cards</div>}
        {shown.map((g, gi) => (
          <React.Fragment key={`${g.anchorCardId}-${gi}`}>
            {g.label !== null && (
              <div className="ws-toc-group" onClick={() => onJump(g.anchorCardId)}>
                {g.groupId && (
                  <span className="ws-toc-fold" title={g.collapsed ? "Collapsed on the board" : undefined}>
                    {g.collapsed ? "▸" : "▾"}
                  </span>
                )}
                {g.label}
                <span className="ws-toc-count">{g.rows.length}</span>
              </div>
            )}
            {g.rows.map((r) => (
              <div
                key={r.cardId}
                className={`ws-toc-item${r.depth === 1 ? " child" : ""}${g.label === null ? " lone" : ""}`}
                onClick={() => onJump(r.cardId)}
                title={r.title || "Untitled"}
              >
                <span className="ws-toc-glyph">{KIND_GLYPH[r.kind] ?? "•"}</span>
                <span className="ws-toc-label">{r.title || "Untitled"}</span>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </aside>
  );
}
