import * as React from "react";
import { addTag, filterSuggestions, removeTag } from "./tags.ts";

interface TagEditorProps {
  tags: string[];
  /** All known workspace tags, for autocomplete (store.getAllTags()). */
  suggestions: string[];
  onChange: (tags: string[]) => void;
  autoFocus?: boolean;
}

/**
 * Chip-style tag input for the canvas card's edit box. Restates the highlighter's
 * octo-tag-input behavior in React, themed via --ws-* tokens so it works in
 * light and dark. Controlled: holds only the transient input text and dropdown
 * cursor locally; the tag list itself lives in the parent's edit draft.
 */
export function TagEditor(props: TagEditorProps): React.ReactElement {
  const { tags, suggestions, onChange } = props;
  const [input, setInput] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const filtered = filterSuggestions(suggestions, input, tags);

  const commit = (value: string) => {
    const next = addTag(tags, value);
    if (next !== tags) onChange(next);
    setInput("");
    setActiveIndex(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const pick = activeIndex >= 0 && filtered[activeIndex] ? filtered[activeIndex] : input;
      commit(pick);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      onChange(removeTag(tags, tags[tags.length - 1]));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Tab" && activeIndex >= 0 && filtered[activeIndex]) {
      e.preventDefault();
      commit(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      // Only swallow Escape when there's something to clear; otherwise let it
      // bubble so the card's edit box cancels as usual.
      if (activeIndex >= 0 || input) {
        e.stopPropagation();
        setInput("");
        setActiveIndex(-1);
      }
    }
  };

  return (
    <div className="ws-tag-editor">
      <div className="ws-tag-wrap">
        {tags.map((t) => (
          <span key={t} className="ws-tag-chip">
            #{t}
            <span
              className="ws-tag-chip-x"
              title="Remove tag"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(removeTag(tags, t));
              }}
            >
              ×
            </span>
          </span>
        ))}
        <input
          className="ws-tag-input"
          autoFocus={props.autoFocus}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (input.trim()) commit(input);
          }}
          // Teach the interaction while empty; once chips exist, stay terse
          // (the input shares the row with them and a long hint would wrap).
          placeholder={tags.length ? "+ tag…" : "Add a tag — press Enter or , to confirm"}
        />
        {filtered.length > 0 && (
          <div className="ws-tag-dropdown">
            {filtered.map((s, i) => (
              <div
                key={s}
                className={`ws-tag-suggest${i === activeIndex ? " active" : ""}`}
                // mousedown + preventDefault: picking a suggestion must not blur
                // (and thereby commit/close) the surrounding edit box.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s);
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
