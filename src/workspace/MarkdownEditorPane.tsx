import * as React from "react";
import { Code, Type } from "lucide-react";
import { CardMarkdownEditor } from "./CardMarkdownEditor.tsx";

export interface MarkdownEditorPaneProps {
  /** Initial values — the editing session owns them afterwards. */
  title: string;
  body: string;
  /** Streamed on every keystroke; the parent decides when to persist. */
  onTitleChange: (title: string) => void;
  onBodyChange: (markdown: string) => void;
  /** The card being edited — excluded from [[ suggestions. */
  cardId?: string;
}

type Mode = "wysiwyg" | "source";

/**
 * Full-height markdown editor for the viewer pane: TipTap WYSIWYG by default,
 * toggleable to raw markdown source. Pure — knows nothing about cards or the
 * store, so a future file-backed tab can reuse it with a different binding.
 *
 * One source of truth: the latest markdown lives in a ref fed by whichever
 * mode is active, so toggling never loses content. The inactive editor is
 * unmounted (keyed remount seeds it from the ref).
 */
export function MarkdownEditorPane(props: MarkdownEditorPaneProps): React.ReactElement {
  const [mode, setMode] = React.useState<Mode>("wysiwyg");
  const [titleDraft, setTitleDraft] = React.useState(props.title);
  // Body streams through a ref — state would re-render (and disturb) the
  // editor on every keystroke for no benefit. Source mode needs state for the
  // controlled textarea; it seeds from the ref on toggle.
  const bodyRef = React.useRef(props.body);
  const [sourceDraft, setSourceDraft] = React.useState("");
  // What TipTap seeds from when (re)mounting — refreshed on each toggle back
  // from source mode, since refs must not be read during render.
  const [wysiwygSeed, setWysiwygSeed] = React.useState(props.body);

  const onBody = (md: string) => {
    bodyRef.current = md;
    props.onBodyChange(md);
  };

  const toggleMode = () => {
    if (mode === "wysiwyg") {
      setSourceDraft(bodyRef.current);
      setMode("source");
    } else {
      setWysiwygSeed(bodyRef.current);
      setMode("wysiwyg");
    }
  };

  return (
    <div
      className="ws-note-editor"
      // Same shortcut as the in-card editor: ⌘/ flips WYSIWYG ↔ source.
      onKeyDown={(e) => {
        if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          toggleMode();
        }
      }}
    >
      <div className="ws-note-editor-bar">
        <input
          className="ws-note-editor-title"
          value={titleDraft}
          placeholder="Untitled"
          onChange={(e) => {
            setTitleDraft(e.target.value);
            props.onTitleChange(e.target.value);
          }}
        />
        <button
          className="ws-icon-btn"
          title={mode === "wysiwyg" ? "Edit markdown source" : "Back to rich editing"}
          aria-pressed={mode === "source"}
          onClick={toggleMode}
        >
          {mode === "wysiwyg"
            ? <Code size={15} strokeWidth={2} aria-hidden />
            : <Type size={15} strokeWidth={2} aria-hidden />}
        </button>
      </div>
      <div className="ws-note-editor-scroll">
        {mode === "wysiwyg" ? (
          // Keyed on mode so returning from source remounts TipTap with the
          // (possibly edited) markdown from the ref.
          <div className="ws-note-editor-doc" key="wysiwyg">
            <CardMarkdownEditor value={wysiwygSeed} cardId={props.cardId} onChange={onBody} />
          </div>
        ) : (
          <textarea
            key="source"
            className="ws-note-editor-source"
            value={sourceDraft}
            spellCheck={false}
            onChange={(e) => {
              setSourceDraft(e.target.value);
              onBody(e.target.value);
            }}
          />
        )}
      </div>
    </div>
  );
}
