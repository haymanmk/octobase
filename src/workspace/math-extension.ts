/**
 * Live KaTeX math for the card editor, Typora-style: expressions render in
 * place, and the one your caret is inside reveals its LaTeX source. Built on
 * @tiptap/extension-mathematics' decoration plugin — math stays plain text in
 * the document ($…$ / $$…$$), so tiptap-markdown round-trips it untouched and
 * the stored body remains Obsidian-compatible.
 *
 * The stock extension is a single plugin with one regex and one katexOptions,
 * so display math can't differ from inline math. Instantiating the plugin
 * twice (block first, displayMode on) gets both without forking it.
 */
import { Extension } from "@tiptap/core";
import Text from "@tiptap/extension-text";
import { MathematicsPlugin, defaultShouldRender } from "@tiptap/extension-mathematics";

/** Display math: $$…$$ on one line (text nodes never span paragraphs). */
export const BLOCK_MATH_RE = /\$\$([^$\n]+?)\$\$/g;
/**
 * Inline math: $…$ not touching another $ (so $$…$$ stays block-only), and —
 * per Obsidian's rule — content can't start or end with whitespace, so prose
 * like "us$100 and $200" never renders as math.
 */
export const INLINE_MATH_RE = /(?<!\$)\$([^\s$\n](?:[^$\n]*?[^\s$\n])?)\$(?!\$)/g;

/** Both forms, for splitting text into math / non-math runs. */
const ANY_MATH_RE = new RegExp(`${BLOCK_MATH_RE.source}|${INLINE_MATH_RE.source}`, "g");

/**
 * tiptap-markdown's default text serializer escapes markdown specials, which
 * corrupts LaTeX ($\lambda$ → $\\lambda$, a_b → a\_b). This override writes
 * math spans verbatim and only escapes the prose between them. Registered
 * after StarterKit so it replaces the stock "text" node.
 */
export const MathAwareText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { text: (s: string, escape?: boolean) => void },
          node: { text?: string },
        ) {
          const text = node.text ?? "";
          const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
          let last = 0;
          ANY_MATH_RE.lastIndex = 0;
          for (let m = ANY_MATH_RE.exec(text); m; m = ANY_MATH_RE.exec(text)) {
            if (m.index > last) state.text(esc(text.slice(last, m.index)));
            state.text(m[0], false); // verbatim — no markdown escaping
            last = m.index + m[0].length;
          }
          if (last < text.length) state.text(esc(text.slice(last)));
        },
        parse: {},
      },
    };
  },
});

export const CardMath = Extension.create({
  name: "cardMath",

  addProseMirrorPlugins() {
    return [
      MathematicsPlugin({
        editor: this.editor,
        regex: BLOCK_MATH_RE,
        katexOptions: { displayMode: true, throwOnError: false },
        shouldRender: defaultShouldRender,
      }),
      MathematicsPlugin({
        editor: this.editor,
        regex: INLINE_MATH_RE,
        katexOptions: { throwOnError: false },
        shouldRender: defaultShouldRender,
      }),
    ];
  },
});
