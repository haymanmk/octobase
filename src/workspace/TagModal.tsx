import * as React from "react";
import type { Card } from "../lib/model/types.ts";
import { TagEditor } from "./TagEditor.tsx";
import { sameTags } from "./tags.ts";

export interface TagModalProps {
  card: Card;
  /** All known workspace tags, for autocomplete (store.getAllTags()). */
  suggestions: string[];
  /** Called with the final tag list on Save; not called on Cancel. */
  onSave: (tags: string[]) => void;
  onClose: () => void;
}

/**
 * "Edit tags" dialog, opened from the card context menu. Same overlay/dialog
 * shell as the settings modals. Draft semantics: edits live here until Save;
 * Cancel, backdrop click, or Esc discard them.
 */
export function TagModal({ card, suggestions, onSave, onClose }: TagModalProps): React.ReactElement {
  const [draft, setDraft] = React.useState<string[]>(card.tags);

  const save = () => {
    if (!sameTags(draft, card.tags)) onSave(draft);
    onClose();
  };

  // Esc cancels the dialog. The chip input stops propagation of Esc while it
  // has text or an open dropdown to clear, so this only fires once it's empty.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
  };

  return (
    <div
      className="ws-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div className="ws-editor" style={{ width: "min(420px, 92vw)" }}>
        <div className="ws-editor-accent" style={{ background: "var(--ws-accent)" }} />
        <div className="ws-editor-titlebar">
          <div className="ws-editor-title-input" style={{ fontSize: 22 }}>Edit tags</div>
        </div>
        <div className="ws-editor-scroll" style={{ fontSize: 14, lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--ws-ink-soft)" }}>
            {card.title || "Untitled"}
          </p>
          <TagEditor tags={draft} suggestions={suggestions} onChange={setDraft} autoFocus />
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ws-ink-muted)" }}>
            Enter or comma adds a tag · Backspace removes the last one
          </p>
        </div>
        <div className="ws-editor-foot">
          <button className="ws-btn" onClick={onClose}>Cancel</button>
          <button className="ws-btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
