import * as React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { CardEmbedNode } from "./card-embed-node.ts";
import { CardMath, MathAwareText } from "./math-extension.ts";
import { SlashMenu } from "./slash-menu.ts";
import { WikilinkSuggest, unescapeWikilinks } from "./wikilink-suggest.ts";
import { useWorkspace } from "./store-context.ts";
import { clipRef, resolveClipSrc } from "./clip-ref.ts";
import { imageFileOf, savePastedImage } from "./image-paste.ts";
import "katex/dist/katex.min.css";

/**
 * Image node whose stored src may be a clip: ref — the document (and the
 * serialized markdown) keeps the portable ref; only the rendered <img>
 * resolves it to the octobase-clip:// URL.
 */
const ClipImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { src: resolveClipSrc(HTMLAttributes.src ?? "") })];
  },
});

export interface CardMarkdownEditorProps {
  /** Initial markdown body (the editing session owns it afterwards). */
  value: string;
  /** Streams the markdown serialization on every keystroke. */
  onChange: (markdown: string) => void;
  /** The card being edited — its own title is excluded from [[ suggestions. */
  cardId?: string;
}

function markdownOf(editor: Editor): string {
  const md = (editor.storage as unknown as { markdown: { getMarkdown: () => string } })
    .markdown.getMarkdown();
  // The serializer escapes "[[" to "\[\[", which would kill every wikilink
  // on commit; the store also repairs already-saved bodies on load.
  return unescapeWikilinks(md);
}

/**
 * WYSIWYG markdown surface for the in-place card editor: typing `## `, `- `,
 * `**bold**`, `> ` etc. renders immediately (Typora-style input rules), while
 * the value streamed to the parent stays plain markdown. Session semantics
 * (commit on blur/⌘↵, cancel on Esc) belong to the parent card.
 */
export function CardMarkdownEditor({ value, onChange, cardId }: CardMarkdownEditorProps): React.ReactElement {
  const store = useWorkspace();
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      CardEmbedNode,
      CardMath,
      MathAwareText, // after StarterKit: replaces its "text" node's serializer
      SlashMenu,
      WikilinkSuggest.configure({
        // Reads the store live at call time; "" (just typed "[[") = recents.
        searchCards: (q) =>
          q.trim()
            ? store.search(q).map((h) => h.card)
            : [...store.getCards()].sort((a, b) => b.updatedAt - a.updatedAt),
        excludeCardId: cardId,
      }),
      ClipImage,
      Placeholder.configure({ placeholder: "Write markdown… (/ for blocks)" }),
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
      handlePaste: (view, event) => {
        const file = imageFileOf(event.clipboardData);
        if (!file) return false;
        event.preventDefault();
        void savePastedImage(file).then((saved) => {
          if (!saved || view.isDestroyed) return;
          const node = view.state.schema.nodes.image.create({ src: clipRef(saved.file) });
          view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
        });
        return true;
      },
    },
  }, []);

  return <EditorContent editor={editor} />;
}
