import * as React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

export interface CardMarkdownEditorProps {
  /** Initial markdown body (the editing session owns it afterwards). */
  value: string;
  /** Streams the markdown serialization on every keystroke. */
  onChange: (markdown: string) => void;
}

function markdownOf(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } })
    .markdown.getMarkdown();
}

/**
 * WYSIWYG markdown surface for the in-place card editor: typing `## `, `- `,
 * `**bold**`, `> ` etc. renders immediately (Typora-style input rules), while
 * the value streamed to the parent stays plain markdown. Session semantics
 * (commit on blur/⌘↵, cancel on Esc) belong to the parent card.
 */
export function CardMarkdownEditor({ value, onChange }: CardMarkdownEditorProps): React.ReactElement {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Write markdown…" }),
      Markdown.configure({ html: false, linkify: false, breaks: false }),
    ],
    content: value,
    autofocus: "end",
    onUpdate: ({ editor: e }) => onChange(markdownOf(e)),
    editorProps: {
      attributes: { class: "ws-card-md-edit ws-md" },
      handleKeyDown: (_view, event) =>
        // ⌘↵ ends the edit session (parent handles it) — keep the default
        // hard-break binding from swallowing it.
        event.key === "Enter" && (event.metaKey || event.ctrlKey),
    },
  }, []);

  return <EditorContent editor={editor} />;
}
