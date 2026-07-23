import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CardEmbedView } from "./card-embed-view.tsx";

/**
 * TipTap atom for ![[Card Title]] embed blocks. A BLOCK node, not inline:
 * an inline atom styled display:block left a phantom caret line under the
 * embed (the cursor after the atom wrapped below it), which read as a
 * spurious empty line. As a block there is no text position beside it —
 * the caret lands on real paragraphs only.
 *
 * Rendered as the same mini-card as the read view (see CardEmbedView),
 * deleted like a character, and serialized back to the same markdown by
 * tiptap-markdown. renderHTML stays a chip — it only serves clipboard/static
 * HTML, never the live editor.
 */

interface MarkdownItLike {
  block: {
    ruler: { before: (b: string, n: string, fn: unknown) => void };
  };
  renderer: { rules: Record<string, unknown> };
  utils: { escapeHtml: (s: string) => string };
}

interface BlockStateLike {
  src: string;
  line: number;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  isEmpty: (line: number) => boolean;
  push: (type: string, tag: string, nesting: number) => { content: string; map: [number, number] };
}

// Targets may span softbreaks — highlight titles keep the full quoted text,
// newlines included — so match anything but "]"/"|", like the view renderer.
// The alias (second group) is the card's title for id-form ![[id|title]].
const EMBED_BLOCK_RE = /^!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\s*$/;

export const CardEmbedNode = Node.create({
  name: "cardEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return { target: { default: "" }, label: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-card-embed]",
        getAttrs: (el) => ({
          target: (el as HTMLElement).getAttribute("data-card-embed") ?? "",
          label: (el as HTMLElement).getAttribute("data-embed-label") ?? "",
        }),
      },
      // Legacy inline form (old clipboard HTML).
      {
        tag: "span[data-card-embed]",
        getAttrs: (el) => ({
          target: (el as HTMLElement).getAttribute("data-card-embed") ?? "",
          label: (el as HTMLElement).getAttribute("data-embed-label") ?? "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-card-embed": node.attrs.target,
        "data-embed-label": node.attrs.label,
        class: "ws-embed-chip",
      }),
      `⊞ ${node.attrs.label || node.attrs.target}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CardEmbedView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { target: string; label: string } },
        ) {
          const { target, label } = node.attrs;
          state.write(label ? `![[${target}|${label}]]` : `![[${target}]]`);
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            // Block rule: a run of lines forming exactly one ![[…]] (titles
            // may span lines). Registered before "paragraph" so embeds never
            // end up as inline content.
            markdownit.block.ruler.before(
              "paragraph",
              "card_embed",
              (state: BlockStateLike, startLine: number, endLine: number, silent: boolean) => {
                const first = state.src.slice(
                  state.bMarks[startLine] + state.tShift[startLine],
                  state.eMarks[startLine],
                );
                if (!first.startsWith("![[")) return false;
                let line = startLine;
                let content = first;
                for (;;) {
                  const m = EMBED_BLOCK_RE.exec(content);
                  if (m) {
                    if (!silent) {
                      const token = state.push("card_embed", "", 0) as {
                        content: string;
                        info: string;
                        map: [number, number];
                      };
                      token.content = m[1].trim();
                      token.info = (m[2] ?? "").trim();
                      token.map = [startLine, line + 1];
                    }
                    state.line = line + 1;
                    return true;
                  }
                  line += 1;
                  if (line >= endLine || state.isEmpty(line)) return false;
                  content +=
                    "\n" +
                    state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
                }
              },
            );
            markdownit.renderer.rules.card_embed = (
              tokens: { content: string; info?: string }[],
              idx: number,
            ) =>
              `<div data-card-embed="${markdownit.utils.escapeHtml(tokens[idx].content)}"` +
              ` data-embed-label="${markdownit.utils.escapeHtml(tokens[idx].info ?? "")}"></div>`;
          },
        },
      },
    };
  },
});
