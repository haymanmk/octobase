/**
 * Card autocomplete for [[wikilinks]] and ![[embeds]] in the note editor:
 * typing "[[" opens a caret popover of the most likely cards (ranked by the
 * store's search), ↑↓/↵/Esc, plus a create row for titles that don't exist
 * yet. Picking a row inserts the link — or the embed node when the trigger
 * was "![[" . Row building is pure and unit-tested; the popup mirrors the
 * slash menu's plain-DOM approach.
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, {
  type SuggestionProps,
  type SuggestionKeyDownProps,
  type SuggestionOptions,
} from "@tiptap/suggestion";
import { normalizeTitle } from "../lib/model/wikilinks.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import type { Card } from "../lib/model/types.ts";

export interface LinkRow {
  /** null for the create row — the link stays unresolved until clicked. */
  id: string | null;
  title: string;
  kind: string;
  color: keyof typeof PALETTE;
  isNew?: boolean;
}

const MAX_ROWS = 7;

/** Ranked matches → popup rows: dedupe by resolved title, cap, create row. */
export function buildLinkRows(
  query: string,
  matches: Card[],
  excludeCardId?: string,
): LinkRow[] {
  const seen = new Set<string>();
  const rows: LinkRow[] = [];
  for (const c of matches) {
    if (c.id === excludeCardId) continue;
    const key = normalizeTitle(c.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: c.id, title: c.title, kind: c.kind, color: c.color });
    if (rows.length >= MAX_ROWS) break;
  }
  const q = query.trim();
  if (q && !seen.has(normalizeTitle(q))) {
    rows.push({ id: null, title: q, kind: "note", color: "yellow", isNew: true });
  }
  return rows;
}

export { unescapeWikilinks } from "../lib/model/wikilinks.ts";

/**
 * Anchor the suggestion at the LAST "[[" before the caret. The default
 * matcher (with allowSpaces) anchors at an earlier "[[" already in the text
 * and swallows everything after it — completed links included. A query stops
 * being one once it contains "]]" or grows implausibly long.
 */
const findWikilinkMatch: SuggestionOptions<LinkRow>["findSuggestionMatch"] = ({ $position }) => {
  const start = $position.start();
  const text = $position.doc.textBetween(start, $position.pos, "\0", "\0");
  const idx = text.lastIndexOf("[[");
  if (idx < 0) return null;
  const query = text.slice(idx + 2);
  if (query.includes("]]") || query.includes("[[") || query.length > 80) return null;
  return {
    range: { from: start + idx, to: $position.pos },
    query,
    text: text.slice(idx),
  };
};

/** Insert the picked card as a [[link]] — or an embed if triggered by "![[". */
function insertRow(editor: Editor, range: Range, row: LinkRow): void {
  const before = editor.state.doc.textBetween(Math.max(0, range.from - 1), range.from);
  if (before === "!") {
    editor
      .chain()
      .focus()
      .deleteRange({ from: range.from - 1, to: range.to })
      .insertContent([
        { type: "cardEmbed", attrs: { target: row.title } },
        { type: "text", text: " " },
      ])
      .run();
    return;
  }
  // A text node, like typing — a plain string would go through the markdown
  // parser, which escapes the brackets.
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({ type: "text", text: `[[${row.title}]] ` })
    .run();
}

const KIND_GLYPH: Record<string, string> = {
  note: "✎",
  highlight: "▂",
  article: "¶",
  image: "▣",
  pdf: "📄",
};

/** Caret-anchored popup; same chrome as the slash menu (shared CSS classes). */
class LinkPopup {
  private el: HTMLDivElement;
  private rows: LinkRow[] = [];
  private sel = 0;
  private command: (row: LinkRow) => void = () => {};
  private dismissed = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "ws-slash";
    (document.querySelector(".ws-root") ?? document.body).appendChild(this.el);
  }

  update(props: SuggestionProps<LinkRow>): void {
    this.rows = props.items;
    this.sel = Math.min(this.sel, Math.max(0, this.rows.length - 1));
    this.command = (row) => props.command(row);
    const rect = props.clientRect?.();
    if (rect) {
      const width = 250;
      const x = Math.min(rect.left, window.innerWidth - width - 8);
      const below = rect.bottom + 6;
      const height = Math.min(this.rows.length, 8) * 30 + 12;
      const y = below + height > window.innerHeight - 8 ? rect.top - height - 6 : below;
      this.el.style.left = `${Math.max(8, x)}px`;
      this.el.style.top = `${Math.max(8, y)}px`;
    }
    this.render();
  }

  move(dir: 1 | -1): void {
    if (this.rows.length === 0) return;
    this.sel = (this.sel + dir + this.rows.length) % this.rows.length;
    this.render();
  }

  pick(): boolean {
    const row = this.rows[this.sel];
    if (row) this.command(row);
    return !!row;
  }

  dismiss(): void {
    this.dismissed = true;
    this.render();
  }

  isDismissed(): boolean {
    return this.dismissed;
  }

  private render(): void {
    this.el.style.display = this.rows.length && !this.dismissed ? "block" : "none";
    this.el.innerHTML = "";
    this.rows.forEach((row, i) => {
      const el = document.createElement("div");
      el.className = `ws-slash-item${i === this.sel ? " sel" : ""}`;
      const dot = document.createElement("span");
      dot.className = "ws-slash-dot";
      dot.style.background = row.isNew ? "transparent" : (PALETTE[row.color] ?? PALETTE.yellow).underline;
      if (row.isNew) dot.textContent = "＋";
      const label = document.createElement("span");
      label.className = "ws-slash-label";
      label.textContent = row.title;
      const hint = document.createElement("span");
      hint.className = "ws-slash-hint";
      hint.textContent = row.isNew ? "new" : (KIND_GLYPH[row.kind] ?? "");
      el.append(dot, label, hint);
      el.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep the editor focused
        this.command(row);
      });
      el.addEventListener("mouseenter", () => { this.sel = i; this.render(); });
      this.el.appendChild(el);
    });
  }

  destroy(): void {
    this.el.remove();
  }
}

export interface WikilinkSuggestOptions {
  /** Ranked card candidates for a query ("" = recent cards). */
  searchCards: (query: string) => Card[];
  /** The card being edited — excluded so a card can't link to itself. */
  excludeCardId?: string;
}

export const WikilinkSuggest = Extension.create<WikilinkSuggestOptions, { popup: LinkPopup | null }>({
  name: "wikilinkSuggest",

  addOptions() {
    return { searchCards: () => [], excludeCardId: undefined };
  },

  addStorage() {
    return { popup: null };
  },

  onDestroy() {
    this.storage.popup?.destroy();
    this.storage.popup = null;
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const options = this.options;
    return [
      Suggestion<LinkRow>({
        editor: this.editor,
        // The slash menu's Suggestion holds the default key — two keyed
        // plugins with one key crash the editor on mount.
        pluginKey: new PluginKey("ws-wikilink-suggest"),
        char: "[[",
        findSuggestionMatch: findWikilinkMatch,
        items: ({ query }) =>
          buildLinkRows(query, options.searchCards(query), options.excludeCardId),
        command: ({ editor, range, props: row }) => insertRow(editor, range, row),
        render: () => ({
          onStart: (props) => {
            storage.popup = new LinkPopup();
            storage.popup.update(props);
          },
          onUpdate: (props) => storage.popup?.update(props),
          onKeyDown: (props: SuggestionKeyDownProps) => {
            const popup = storage.popup;
            if (!popup) return false;
            // Once dismissed, stop eating keys — a second Escape must reach
            // the card and cancel the edit session as usual.
            if (popup.isDismissed()) return false;
            if (props.event.key === "ArrowDown") { popup.move(1); return true; }
            if (props.event.key === "ArrowUp") { popup.move(-1); return true; }
            if (props.event.key === "Enter") return popup.pick();
            if (props.event.key === "Escape") {
              props.event.stopPropagation(); // don't cancel the edit session
              popup.dismiss();
              return true;
            }
            return false;
          },
          onExit: () => {
            storage.popup?.destroy();
            storage.popup = null;
          },
        }),
      }),
    ];
  },
});
