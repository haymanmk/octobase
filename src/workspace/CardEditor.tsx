import * as React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import type { Card, HighlightColor } from "../lib/model/types.ts";
import { HIGHLIGHT_COLORS } from "../types/highlight.ts";
import { PALETTE } from "../components/highlighter/colors.ts";

/**
 * tiptap-markdown escapes markdown-significant characters when serializing, so
 * [[Card link]] comes back as \[\[Card link\]\]. Restore the wikilink brackets
 * so the link survives a round-trip through the rich editor.
 */
function unescapeWikilinks(md: string): string {
  return md.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
}

export interface CardEditorProps {
  card: Card;
  onChange: (
    patch: Partial<Pick<Card, "title" | "body" | "tags" | "color">>,
  ) => void;
  onClose: () => void;
  onDelete: () => void;
}

function ToolbarButton({
  label,
  title,
  active,
  onClick,
}: {
  label: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`ws-tb-btn${active ? " active" : ""}`}
      // Keep editor focus/selection while clicking the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function CardEditor({
  card,
  onChange,
  onClose,
  onDelete,
}: CardEditorProps): React.ReactElement {
  const [title, setTitle] = React.useState(card.title);
  const [tags, setTags] = React.useState<string[]>(card.tags);
  const [color, setColor] = React.useState<HighlightColor>(card.color);
  const [tagDraft, setTagDraft] = React.useState("");
  const bodyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "Write in markdown. Use [[Title]] to link cards…",
      }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
    ],
    content: card.body,
    autofocus: card.body ? false : "end",
    editorProps: { attributes: { class: "ws-prose" } },
    onUpdate({ editor }) {
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
      bodyTimer.current = setTimeout(() => {
        const md = editor.storage.markdown.getMarkdown();
        onChange({ body: unescapeWikilinks(md) });
      }, 250);
    },
  });

  // Commit pending edits when unmounting.
  React.useEffect(() => {
    return () => {
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
    };
  }, []);

  const commitTitle = (value: string) => {
    setTitle(value);
    onChange({ title: value.trim() || "Untitled" });
  };

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, "");
    if (!t) return;
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      const next = [...tags, t];
      setTags(next);
      onChange({ tags: next });
    }
    setTagDraft("");
  };
  const removeTag = (t: string) => {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    onChange({ tags: next });
  };

  const chooseColor = (c: HighlightColor) => {
    setColor(c);
    onChange({ color: c });
  };

  const insertWikilink = () => {
    if (!editor) return;
    const { from } = editor.state.selection;
    editor.chain().focus().insertContent("[[]]").setTextSelection(from + 2).run();
  };

  const setExternalLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const onOverlayKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const accent = PALETTE[color]?.underline ?? PALETTE.yellow.underline;

  return (
    <div
      className="ws-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onOverlayKey}
    >
      <div className="ws-editor" role="dialog" aria-label="Edit card">
        <div className="ws-editor-accent" style={{ background: accent }} />
        <div className="ws-editor-titlebar">
          <input
            className="ws-editor-title-input"
            value={title}
            placeholder="Untitled"
            onChange={(e) => commitTitle(e.target.value)}
          />
        </div>

        <div className="ws-toolbar">
          <ToolbarButton label="H1" title="Heading 1" active={editor?.isActive("heading", { level: 1 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
          <ToolbarButton label="H2" title="Heading 2" active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
          <span className="ws-tb-sep" />
          <ToolbarButton label={<b>B</b>} title="Bold (⌘B)" active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()} />
          <ToolbarButton label={<i>I</i>} title="Italic (⌘I)" active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()} />
          <ToolbarButton label={<s>S</s>} title="Strikethrough" active={editor?.isActive("strike")}
            onClick={() => editor?.chain().focus().toggleStrike().run()} />
          <ToolbarButton label={<span style={{ fontFamily: "var(--ws-font-mono)" }}>{"</>"}</span>} title="Inline code" active={editor?.isActive("code")}
            onClick={() => editor?.chain().focus().toggleCode().run()} />
          <span className="ws-tb-sep" />
          <ToolbarButton label="•" title="Bullet list" active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()} />
          <ToolbarButton label="1." title="Numbered list" active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
          <ToolbarButton label="☑" title="Task list" active={editor?.isActive("taskList")}
            onClick={() => editor?.chain().focus().toggleTaskList().run()} />
          <ToolbarButton label="❝" title="Quote" active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
          <ToolbarButton label="{ }" title="Code block" active={editor?.isActive("codeBlock")}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
          <span className="ws-tb-sep" />
          <ToolbarButton label="🔗" title="External link" active={editor?.isActive("link")}
            onClick={setExternalLink} />
          <ToolbarButton label="[[ ]]" title="Link a card" onClick={insertWikilink} />
        </div>

        <div className="ws-editor-scroll">
          <EditorContent editor={editor} />
        </div>

        <div className="ws-editor-foot">
          <div className="ws-tagedit">
            {tags.map((t) => (
              <span key={t} className="ws-card-tag" style={{ cursor: "pointer" }}
                title="Remove tag" onClick={() => removeTag(t)}>
                #{t} ✕
              </span>
            ))}
            <input
              value={tagDraft}
              placeholder="add tag…"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
                if (e.key === "Backspace" && !tagDraft && tags.length) removeTag(tags[tags.length - 1]);
              }}
              onBlur={addTag}
            />
          </div>
          <div className="ws-color-dots">
            {HIGHLIGHT_COLORS.map((c) => (
              <span
                key={c}
                className={`ws-color-dot${c === color ? " active" : ""}`}
                title={c}
                style={{ background: PALETTE[c].underline }}
                onClick={() => chooseColor(c)}
              />
            ))}
          </div>
          <button className="ws-btn ghost" onClick={onDelete} title="Delete card"
            style={{ color: "var(--ws-danger)" }}>Delete</button>
          <button className="ws-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
