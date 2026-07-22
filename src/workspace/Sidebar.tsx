import * as React from "react";
import { ChevronDown, ChevronRight, Frame, Library, Plus, Search, X } from "lucide-react";
import { BrandMark } from "./BrandMark.tsx";
import { useWorkspace } from "./store-context.ts";

export interface SidebarProps {
  activeBoardId: string | null;
  onSelectBoard: (id: string) => void;
  onOpenCard: (cardId: string) => void;
  onOpenSearch: (seed?: string) => void;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
}

export function Sidebar({
  activeBoardId,
  onSelectBoard,
  onOpenSearch,
  libraryOpen,
  onToggleLibrary,
}: SidebarProps): React.ReactElement {
  const store = useWorkspace();
  const boards = store.getWhiteboards();
  const inbox = store.getInboxCards();
  const tags = store.getAllTags();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  // Collapsible sections, persisted across launches.
  const [closed, setClosed] = React.useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("octobase.sidebar.closed") ?? "{}"); }
    catch { return {}; }
  });
  const toggleSection = (key: string) =>
    setClosed((c) => {
      const next = { ...c, [key]: !c[key] };
      try { localStorage.setItem("octobase.sidebar.closed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  const sectionHead = (key: string, label: string, extra?: React.ReactNode) => (
    <div className="ws-section-label clickable" onClick={() => toggleSection(key)}>
      <span><span className="ws-chevron">{closed[key] ? <ChevronRight size={11} strokeWidth={2} aria-hidden /> : <ChevronDown size={11} strokeWidth={2} aria-hidden />}</span>{label}</span>
      <span onClick={(e) => e.stopPropagation()}>{extra}</span>
    </div>
  );

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameDraft(name);
  };
  const commitRename = () => {
    if (renamingId) store.renameWhiteboard(renamingId, renameDraft);
    setRenamingId(null);
  };

  const addBoard = () => {
    const wb = store.createWhiteboard("Untitled whiteboard");
    onSelectBoard(wb.id);
    startRename(wb.id, wb.name);
  };

  const deleteBoard = (id: string, name: string) => {
    if (boards.length <= 1) {
      window.alert("Keep at least one whiteboard.");
      return;
    }
    if (!window.confirm(`Delete “${name}”? Its cards stay in the Library.`)) return;
    store.deleteWhiteboard(id);
    if (activeBoardId === id) {
      const next = store.getWhiteboards()[0];
      if (next) onSelectBoard(next.id);
    }
  };

  return (
    <aside className="ws-sidebar">
      <div className="ws-brand">
        <BrandMark variant="light" size={32} />
        <h1>octo<span className="ws-brand-dot">·</span>base</h1>
      </div>

      <div className="ws-search-trigger" onClick={() => onOpenSearch()}>
        <span><Search size={14} strokeWidth={2} aria-hidden /></span>
        <span>Search everything</span>
        <kbd>⌘K</kbd>
      </div>

      <nav className="ws-nav">
        {sectionHead("boards", "Whiteboards", <button title="New whiteboard" onClick={addBoard}><Plus size={13} strokeWidth={2} aria-hidden /></button>)}
        {!closed.boards && boards.map((b) => {
          const count = store.getPlacements(b.id).length;
          const active = b.id === activeBoardId;
          return (
            <div
              key={b.id}
              className={`ws-nav-item${active ? " active" : ""}`}
              onClick={() => onSelectBoard(b.id)}
              onDoubleClick={() => startRename(b.id, b.name)}
            >
              <span className="ws-ico"><Frame size={14} strokeWidth={2} aria-hidden /></span>
              {renamingId === b.id ? (
                <input
                  autoFocus
                  className="ws-rename"
                  value={renameDraft}
                  // Select-all so typing replaces the placeholder/old name
                  // (new boards arrive as "Untitled whiteboard").
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                />
              ) : (
                <>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.name}
                  </span>
                  {!active && <span className="ws-count">{count}</span>}
                  <span
                    className="ws-kebab"
                    title="Delete whiteboard"
                    onClick={(e) => { e.stopPropagation(); deleteBoard(b.id, b.name); }}
                  ><X size={13} strokeWidth={2} aria-hidden /></span>
                </>
              )}
            </div>
          );
        })}

        <div className="ws-section-label">
          <span>Cards</span>
        </div>
        <div
          className={`ws-nav-item${libraryOpen ? " active" : ""}`}
          onClick={onToggleLibrary}
          title={libraryOpen ? "Close the card library" : "Browse all cards"}
        >
          <span className="ws-ico"><Library size={15} strokeWidth={2} aria-hidden /></span>
          <span>Library</span>
          {inbox.length > 0 && <span className="ws-count" title="Unplaced cards">{inbox.length}</span>}
        </div>

        {sectionHead("tags", "Tags")}
        {closed.tags ? null : tags.length === 0 ? (
          <div className="ws-empty-hint">No tags yet</div>
        ) : (
          <div className="ws-tag-row">
            {tags.map((t) => (
              <span key={t} className="ws-tag-chip" onClick={() => onOpenSearch(`#${t}`)}>#{t}</span>
            ))}
          </div>
        )}
      </nav>
    </aside>
  );
}
