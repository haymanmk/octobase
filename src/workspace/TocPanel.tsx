import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { parseEmbeds, normalizeTitle } from "../lib/model/wikilinks.ts";
import { buildToc, filterToc, type TocEntry } from "./toc.ts";

import { ChevronDown, ChevronRight, X } from "lucide-react";
import { KindIcon } from "./kind-icons.tsx";

export interface TocPanelProps {
  boardId: string;
  /** A row (or group header) was clicked — jump the canvas to this card. */
  onJump: (cardId: string) => void;
  onClose: () => void;
}

/**
 * Floating table of contents for the active whiteboard: named frames as
 * foldable headlines (collapsed by default), loose cards as flat rows in
 * reading order, embedded cards indented under their host, with a title
 * filter. Clicking anything jumps the canvas to the card.
 */
export function TocPanel({ boardId, onJump, onClose }: TocPanelProps): React.ReactElement {
  const store = useWorkspace();
  const version = store.getVersion();
  const [query, setQuery] = React.useState("");
  // Groups whose rows are unfolded — only headers show by default; filtering
  // unfolds everything so matches stay visible.
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(new Set());

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
        <button className="ws-toc-close" title="Close" onClick={onClose}><X size={13} strokeWidth={2} aria-hidden /></button>
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
        {shown.map((g, gi) => {
          // Only named frames have headlines and fold; islands render flat.
          const foldable = !!g.groupId;
          const open = !foldable || query.trim() !== "" || openGroups.has(g.groupId!);
          return (
            <React.Fragment key={`${g.anchorCardId}-${gi}`}>
              {g.label !== null && (
                <div className="ws-toc-group" onClick={() => onJump(g.anchorCardId)}>
                  {foldable && (
                    <span
                      className="ws-toc-fold"
                      title={open ? "Collapse" : "Expand"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.groupId!)) next.delete(g.groupId!);
                          else next.add(g.groupId!);
                          return next;
                        });
                      }}
                    >
                      {open
                        ? <ChevronDown size={14} strokeWidth={2} aria-hidden />
                        : <ChevronRight size={14} strokeWidth={2} aria-hidden />}
                    </span>
                  )}
                  {g.label}
                  <span className="ws-toc-count">{g.rows.length}</span>
                </div>
              )}
              {open && g.rows.map((r) => (
                <div
                  key={r.cardId}
                  className={`ws-toc-item${r.depth === 1 ? " child" : ""}${g.label === null ? " lone" : ""}`}
                  onClick={() => onJump(r.cardId)}
                  title={r.title || "Untitled"}
                >
                  <span className="ws-toc-glyph"><KindIcon kind={r.kind} size={13} /></span>
                  <span className="ws-toc-label">{r.title || "Untitled"}</span>
                </div>
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </aside>
  );
}
