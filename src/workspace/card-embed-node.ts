import { mergeAttributes, Node } from "@tiptap/core";

/**
 * TipTap atom for ![[Card Title]] embed blocks, so the in-place editor keeps
 * them intact: rendered as an inert chip, deleted like a character, and
 * serialized back to the same markdown by tiptap-markdown.
 */

interface MarkdownItLike {
  inline: { ruler: { before: (b: string, n: string, fn: unknown) => void } };
  renderer: { rules: Record<string, unknown> };
  utils: { escapeHtml: (s: string) => string };
}

interface InlineStateLike {
  src: string;
  pos: number;
  push: (type: string, tag: string, nesting: number) => { content: string };
}

const EMBED_START_RE = /^!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/;

export const CardEmbedNode = Node.create({
  name: "cardEmbed",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return { target: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-card-embed]",
        getAttrs: (el) => ({
          target: (el as HTMLElement).getAttribute("data-card-embed") ?? "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-card-embed": node.attrs.target,
        class: "ws-embed-chip",
      }),
      `⊞ ${node.attrs.target}`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: { target: string } },
        ) {
          state.write(`![[${node.attrs.target}]]`);
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            markdownit.inline.ruler.before(
              "image",
              "card_embed",
              (state: InlineStateLike, silent: boolean) => {
                const m = EMBED_START_RE.exec(state.src.slice(state.pos));
                if (!m) return false;
                if (!silent) {
                  const token = state.push("card_embed", "", 0);
                  token.content = m[1].trim();
                }
                state.pos += m[0].length;
                return true;
              },
            );
            markdownit.renderer.rules.card_embed = (
              tokens: { content: string }[],
              idx: number,
            ) =>
              `<span data-card-embed="${markdownit.utils.escapeHtml(tokens[idx].content)}"></span>`;
          },
        },
      },
    };
  },
});
