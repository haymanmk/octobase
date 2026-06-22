import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { PALETTE } from "../components/highlighter/colors.ts";

export interface SidebarProps {
  activeBoardId: string | null;
  onSelectBoard: (id: string) => void;
  onOpenCard: (cardId: string) => void;
  onOpenSearch: (seed?: string) => void;
}

export function Sidebar({
  activeBoardId,
  onSelectBoard,
  onOpenCard,
  onOpenSearch,
}: SidebarProps): React.ReactElement {
  const store = useWorkspace();
  const boards = store.getWhiteboards();
  const inbox = store.getInboxCards();
  const tags = store.getAllTags();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");

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
    if (!window.confirm(`Delete “${name}”? Its cards move to the inbox.`)) return;
    store.deleteWhiteboard(id);
    if (activeBoardId === id) {
      const next = store.getWhiteboards()[0];
      if (next) onSelectBoard(next.id);
    }
  };

  return (
    <aside className="ws-sidebar">
      <div className="ws-brand">
        <h1>octo<span className="ws-brand-dot">·</span>base</h1>
      </div>

      <div className="ws-search-trigger" onClick={() => onOpenSearch()}>
        <span>⌕</span>
        <span>Search everything</span>
        <kbd>⌘K</kbd>
      </div>

      <nav className="ws-nav">
        <div className="ws-section-label">
          <span>Whiteboards</span>
          <button title="New whiteboard" onClick={addBoard}>+</button>
        </div>
        {boards.map((b) => {
          const count = store.getPlacements(b.id).length;
          const active = b.id === activeBoardId;
          return (
            <div
              key={b.id}
              className={`ws-nav-item${active ? " active" : ""}`}
              onClick={() => onSelectBoard(b.id)}
              onDoubleClick={() => startRename(b.id, b.name)}
            >
              <span className="ws-ico">▦</span>
              {renamingId === b.id ? (
                <input
                  autoFocus
                  className="ws-rename"
                  value={renameDraft}
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
                  >×</span>
                </>
              )}
            </div>
          );
        })}

        <div className="ws-section-label"><span>Inbox</span><span className="ws-count">{inbox.length}</span></div>
        {inbox.length === 0 ? (
          <div className="ws-empty-hint">No loose cards</div>
        ) : (
          inbox.slice(0, 30).map((c) => (
            <div key={c.id} className="ws-nav-item" onClick={() => onOpenCard(c.id)} title="Open card">
              <span className="ws-ico" style={{ color: PALETTE[c.color].underline }}>●</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title || "Untitled"}
              </span>
            </div>
          ))
        )}

        <div className="ws-section-label"><span>Tags</span></div>
        {tags.length === 0 ? (
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
